import { parseAiJson, retryDelayMs, isNoQuota, PHOTO_HINT, sentAtBlock } from '../../src/ai/pure.ts';

/**
 * תור ניתוח ארוחות בשרת: כך הכרטיסים מוכנים גם כשהאפליקציה סגורה כל היום.
 * - מפתח ה-Gemini וההגדרות (cfg:<token>) נשלחים מהאפליקציה ונשמרים ב-KV הפרטי שלך. אפשר למחוק אותם מהאפליקציה.
 * - כל פריט עובר: q (בתור) ← w (בעבודה) ← ok (מוכן) / r (נכשל זמנית, ינסה שוב) / fail (נכשל סופית).
 * - סדר: מהישן לחדש, פריט אחד בכל פעם. כשל זמני (רשת, מכסה, 5xx) עוצר את הסבב וממשיך כל דקה עם השהיה גדלה.
 */
const API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_TRIES = 6;
const BACKOFF_S = [20, 60, 150, 300, 600, 900];
const TTL = 14 * 86400;

const inboxKey = (t) => `inbox:${t}`;
const imgKey = (t, id) => `img:${t}:${id}`;
const cfgKey = (t) => `cfg:${t}`;
const lockKey = (t) => `lock:${t}`;

export const loadInbox = async (env, t) => { try { const s = await env.SUBS.get(inboxKey(t)); return s ? JSON.parse(s) : []; } catch { return []; } };
export const loadCfg = async (env, t) => { try { const s = await env.SUBS.get(cfgKey(t)); return s ? JSON.parse(s) : null; } catch { return null; } };

/** מעדכן פריט אחד בלבד (קורא מחדש לפני כתיבה, כדי לא לדרוס פריטים שנוספו בינתיים) */
async function patchItem(env, t, id, patch) {
  const list = await loadInbox(env, t);
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  await env.SUBS.put(inboxKey(t), JSON.stringify(list), { expirationTtl: TTL });
}

function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** קריאה אחת ל-Gemini. מחזיר { ok, res } או { ok:false, kind, status, raw } (kind: rate | quota | key | blocked | temp | bad) */
async function callGemini(cfg, model, level, system, parts, hasImg, timeoutMs, json) {
  const gen = { temperature: 0.3 };
  if (json) gen.responseMimeType = 'application/json';
  if (level) { gen.thinkingConfig = { thinkingLevel: level }; if (hasImg) gen.mediaResolution = 'MEDIA_RESOLUTION_MEDIUM'; }
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: gen }),
      signal: ctl.signal,
    });
    const raw = await r.text();
    if (!r.ok) {
      const kind = isNoQuota(r.status, raw) ? 'quota' : r.status === 429 ? 'rate' : (r.status === 401 || r.status === 403 || /API key not valid|API_KEY_INVALID/i.test(raw)) ? 'key' : r.status >= 500 ? 'temp' : 'bad';
      return { ok: false, kind, status: r.status, raw: raw.slice(0, 300) };
    }
    let j;
    try { j = JSON.parse(raw); } catch { return { ok: false, kind: 'temp', status: 200, raw: 'bad json' }; }
    if (j?.promptFeedback?.blockReason) return { ok: false, kind: 'blocked', status: 200, raw: String(j.promptFeedback.blockReason) };
    let text = '';
    for (const p of j?.candidates?.[0]?.content?.parts ?? []) if (!p?.thought && typeof p?.text === 'string') text += p.text;
    if (!text.trim()) return { ok: false, kind: 'temp', status: 200, raw: 'empty' };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, kind: 'temp', status: 0, raw: String(e?.name === 'AbortError' ? 'timeout' : e?.message ?? e) };
  } finally { clearTimeout(to); }
}

/** מנתח פריט אחד. מחזיר את מה שצריך לעדכן בפריט */
async function runOne(env, cfg, t, it, timeoutMs) {
  const n = (it.n ?? 0) + 1;
  let img = null;
  if (it.img) {
    const buf = await env.SUBS.get(imgKey(t, it.id), 'arrayBuffer');
    if (!buf) return { st: 'fail', n, err: 'התמונה לא נשמרה בשרת' };
    img = { mimeType: it.img, data: b64(buf) };
  }
  const ask = it.text || 'זו תמונה של מה שאכלתי. זהה מה יש בה והערך כמויות.';
  const text = `${ask}${img ? `\n\n${PHOTO_HINT}` : ''}\n\n${sentAtBlock(it.ts)}\n\n${cfg.ctx ?? ''}`;
  const parts = [{ text }, ...(img ? [{ inlineData: img }] : [])];
  const models = (img ? cfg.vision : cfg.text) ?? [];
  if (!models.length) return { st: 'fail', n, err: 'אין מודל מוגדר. פתח את האפליקציה פעם אחת' };

  let delay = 0; // השהיה מוצעת (שניות) אם הכשל זמני
  let temp = false;
  let lastErr = '';
  let permanent = '';
  for (const model of models.slice(0, 3)) {
    const lvl = cfg.think?.[model];
    for (const v of lvl ? [{ lvl, json: true }, { lvl: undefined, json: true }, { lvl: undefined, json: false }] : [{ lvl: undefined, json: true }, { lvl: undefined, json: false }]) {
      const r = await callGemini(cfg, model, v.lvl, cfg.system ?? '', parts, !!img, timeoutMs, v.json);
      if (r.ok) {
        let res;
        try { res = parseAiJson(r.text, () => crypto.randomUUID().replace(/-/g, '').slice(0, 8)); } catch (e) { lastErr = String(e?.message ?? e); continue; }
        if (res.fallback && v.json) { lastErr = 'התשובה לא הייתה JSON'; continue; }
        return { st: 'ok', n, err: undefined, res: { items: res.items, reply: res.reply, slot: res.slot } };
      }
      lastErr = `${model}: ${r.status} ${r.raw}`.slice(0, 160);
      if (r.kind === 'key') { permanent = 'מפתח ה-Gemini לא תקין או נחסם'; break; }
      if (r.kind === 'blocked') { permanent = 'Gemini חסם את הבקשה (' + r.raw + ')'; break; }
      if (r.kind === 'quota') break; // אין מכסה במודל הזה: למודל הבא
      if (r.kind === 'rate') { temp = true; delay = Math.max(delay, Math.ceil(retryDelayMs(r.raw) / 1000)); break; }
      if (r.kind === 'temp') { temp = true; continue; }
      // bad (400 וכד'): אולי רמת חשיבה לא נתמכת, מנסים בלי
    }
    if (permanent) break;
  }
  if (permanent) return { st: 'fail', n, err: permanent };
  if (temp && n < MAX_TRIES) return { st: 'r', n, at: Date.now() + Math.max(delay, BACKOFF_S[Math.min(n - 1, BACKOFF_S.length - 1)]) * 1000, err: lastErr, temp: true };
  if (!temp && n < 3) return { st: 'r', n, at: Date.now() + BACKOFF_S[Math.min(n - 1, BACKOFF_S.length - 1)] * 1000, err: lastErr };
  return { st: 'fail', n, err: lastErr || 'הניתוח נכשל' };
}

/**
 * עובר על התור של משתמש אחד לפי הסדר. budgetMs: כמה זמן מותר להתחיל פריטים חדשים.
 * בלי מפתח שמור בשרת לא עושה כלום (האפליקציה תנתח כשהיא נפתחת).
 */
export async function processToken(env, t, o) {
  const cfg = await loadCfg(env, t);
  if (!cfg?.key) return;
  const lock = Number(await env.SUBS.get(lockKey(t)));
  if (lock && Date.now() - lock < 150_000) return; // סבב אחר כבר רץ
  const started = Date.now();
  try {
    for (;;) {
      if (Date.now() - started > o.budgetMs) break;
      await env.SUBS.put(lockKey(t), String(Date.now()), { expirationTtl: 120 });
      const now = Date.now();
      const list = await loadInbox(env, t);
      const next = list
        .filter((x) => x.st === 'q' || x.st === undefined || (x.st === 'r' && (x.at ?? 0) <= now) || (x.st === 'w' && now - (x.wAt ?? 0) > 200_000))
        .sort((a, b) => a.ts - b.ts)[0];
      if (!next) break;
      await patchItem(env, t, next.id, { st: 'w', wAt: now });
      const r = await runOne(env, cfg, t, next, o.timeoutMs);
      await patchItem(env, t, next.id, r);
      // כשל זמני (רשת, מכסה): עוצרים את הסבב כדי לא להציף, וממשיכים בדקה הבאה
      if (r.st === 'r' && r.temp) break;
    }
  } finally {
    try { await env.SUBS.delete(lockKey(t)); } catch { /* ignore */ }
  }
}

/** כל התורים עם פריטים שממתינים (נקרא מהשעון, כל דקה) */
export async function processAll(env) {
  const l = await env.SUBS.list({ prefix: 'inbox:' });
  for (const k of l.keys) {
    const t = k.name.slice('inbox:'.length);
    try { await processToken(env, t, { budgetMs: 8 * 60_000, timeoutMs: 90_000 }); } catch { /* ממשיכים לבא */ }
  }
}

export const saveCfg = (env, t, cfg) => env.SUBS.put(cfgKey(t), JSON.stringify(cfg));
export const deleteCfg = (env, t) => env.SUBS.delete(cfgKey(t));
