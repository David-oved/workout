import { createStore } from '../core/store';
import { uid } from '../core/dates';
import { store } from '../core/state';
import { buildSystemPrompt, allowedLevels, isNoQuota, parseAiJson, pickModel, resolveThinking, retryDelayMs, type AiResult, type Source, type Think } from './pure';

/**
 * חיבור ל-Gemini ישירות מהדפדפן (ה-API תומך ב-CORS). המפתח נשמר ב-localStorage בלבד, מחוץ לגיבויים.
 * שם המודל נבחר ונבדק בפועל מול המפתח (שמות המודלים משתנים), ואפשר לדרוס אותו בהגדרות.
 */
const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = 'wo:ai-key';
const MODEL = 'wo:ai-model';
const MODELS = 'wo:ai-models';
const PINNED = 'wo:ai-pinned';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

const readModels = (): string[] => { try { return JSON.parse(get(MODELS) ?? '[]'); } catch { return []; } };

/** מה נבדק בפועל על כל מודל במפתח הזה */
export interface Cap { status: 'ok' | 'noquota' | 'error'; levels: string[]; msg?: string; ms?: number; at: number; until?: number }
const CAPS = 'wo:ai-caps';
const readCaps = (): Record<string, Cap> => { try { return JSON.parse(get(CAPS) ?? '{}'); } catch { return {}; } };

export interface TestResult { ok: boolean; model: string; ms: number; msg?: string }
export const aiState = createStore({
  configured: !!get(KEY),
  model: get(MODEL) ?? '',
  models: readModels(),
  test: undefined as TestResult | undefined,
  testing: false,
  pinned: get(PINNED) === '1',
  caps: readCaps(),
  scan: { running: false, done: 0, total: 0, current: '', error: '' },
});
export const getAiKey = () => get(KEY) ?? '';
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');

/** מודלים שנבדקים לפי הסדר אם הבחירה האוטומטית נכשלת (לפי התיעוד, נובמבר 2026) */
const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

/** פרטי מכסה מתוך שגיאת 429: דקתית או יומית, בעוד כמה זמן אפשר לנסות, ומה המגבלה */
export interface QuotaInfo { kind: 'minute' | 'day'; retrySec: number; limit: string; quotaId: string; until: number; model?: string }

/** כמה מילישניות עד חצות לפי שעון קליפורניה (אז מתאפסת המכסה היומית של Google) */
export function msToDailyReset(): number {
  const now = new Date();
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const next = new Date(pt);
  next.setHours(24, 0, 0, 0);
  return Math.max(60_000, next.getTime() - pt.getTime());
}

class AiHttpError extends Error {
  public quota?: QuotaInfo;
  constructor(public status: number, msg: string, public raw = '', public fatal = false, public detail = '') { super(msg); }
}
async function httpError(r: Response): Promise<AiHttpError> {
  let raw = '';
  let st = '';
  let quotaId = '';
  let limit = '';
  let retrySec = 0;
  try {
    const j = await r.json();
    raw = j?.error?.message ?? '';
    st = j?.error?.status ?? '';
    for (const d of j?.error?.details ?? []) {
      for (const v of d?.violations ?? []) { quotaId = quotaId || String(v?.quotaId ?? ''); limit = limit || String(v?.quotaValue ?? ''); }
      if (d?.retryDelay) retrySec = parseFloat(String(d.retryDelay)) || retrySec;
    }
  } catch { /* ignore */ }
  if (!retrySec) retrySec = retryDelayMs(raw) / 1000;
  const tail = `${raw}${st ? ` [${st}]` : ''}`;
  if (r.status === 400 && /api key/i.test(raw)) return new AiHttpError(400, 'המפתח לא תקין', tail, true);
  if (r.status === 401 || r.status === 403) return new AiHttpError(r.status, 'אין הרשאה למפתח הזה. ודא שהוא פעיל ושה-Gemini API מופעל', tail, true);
  if (r.status === 404) return new AiHttpError(404, 'המודל לא נמצא', tail);
  if (r.status === 429) {
    const day = /perday/i.test(quotaId) || /per\s*day|daily/i.test(raw);
    const e = new AiHttpError(429, day ? 'נגמרה המכסה היומית של Gemini למודל הזה' : 'הגעת למגבלת הבקשות לדקה של Gemini', `${tail}${quotaId ? ` {${quotaId}${limit ? `=${limit}` : ''}}` : ''}`);
    e.quota = { kind: day ? 'day' : 'minute', retrySec: Math.ceil(retrySec) || 0, limit, quotaId, until: Date.now() + (day ? msToDailyReset() : Math.max(10, Math.ceil(retrySec) || 45) * 1000) };
    return e;
  }
  if (r.status >= 500) return new AiHttpError(r.status, 'השרת של Gemini עמוס כרגע. נסה שוב', tail);
  return new AiHttpError(r.status, `שגיאה מ-Gemini (${r.status})${raw ? `: ${raw.slice(0, 140)}` : ''}`, tail);
}

async function listModels(key: string) {
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  return (j.models ?? []).map((m: any) => ({
    name: String(m.name),
    methods: (m.supportedGenerationMethods ?? m.supportedActions) as string[] | undefined,
  }));
}

/** מודלי שיחה שימושיים להצגה (בלי אודיו, תמונות, וידאו, הטמעות וכו') */
function usable(names: string[]) {
  const bad = /(embed|tts|image|live|audio|transcribe|robot|omni|decision|genie|lyria|veo|imagen|aqa|learnlm|nano)/i;
  return names.map((n) => n.replace(/^models\//, '')).filter((n) => /^gemini-/.test(n) && !bad.test(n));
}

/** בדיקה אמיתית: בקשה זעירה למודל. 429 נחשב "קיים" (רק חרגת מהמכסה). */
async function probe(key: string, model: string): Promise<TestResult> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ענה במילה אחת: בסדר' }] }], generationConfig: { maxOutputTokens: 64 } }),
    });
    const ms = Math.round(performance.now() - t0);
    if (r.ok) return { ok: true, model, ms };
    const e = await httpError(r);
    if (r.status === 429) return { ok: true, model, ms, msg: 'המודל קיים, אבל חרגת מהמכסה כרגע' };
    return { ok: false, model, ms, msg: e.message };
  } catch {
    return { ok: false, model, ms: Math.round(performance.now() - t0), msg: 'אין חיבור לאינטרנט' };
  }
}

/** בוחר מודל שבאמת עונה: קודם הבחירה האוטומטית, ואז הגיבויים */
async function chooseModel(key: string): Promise<{ model?: string; models: string[]; tried: TestResult[] }> {
  const raw = await listModels(key);
  const models = usable(raw.map((m: any) => m.name)).sort();
  const picked = pickModel(raw);
  const cands = [...new Set([picked, ...FALLBACKS].filter(Boolean) as string[])];
  const tried: TestResult[] = [];
  for (const c of cands) {
    const res = await probe(key, c);
    tried.push(res);
    if (res.ok) return { model: c, models, tried };
    if (res.msg === 'אין חיבור לאינטרנט') break;
  }
  return { models, tried };
}

const describeTried = (t: TestResult[]) => t.map((x) => `${x.model}: ${x.msg ?? 'נכשל'}`).join(' · ');

/** שומר מפתח אחרי שבדק שהוא עובד ובחר מודל שעונה בפועל */
export async function saveAiKey(key: string): Promise<{ ok: boolean; msg?: string }> {
  const k = key.trim();
  if (!k) return { ok: false, msg: 'הדבק את המפתח' };
  try {
    const { model, models, tried } = await chooseModel(k);
    if (!model) return { ok: false, msg: `המפתח תקין, אבל אף מודל לא ענה. ${describeTried(tried)}` };
    put(KEY, k);
    put(MODEL, model);
    put(MODELS, JSON.stringify(models));
    put(PINNED, null);
    put(CAPS, null);
    aiState.set((s) => ({ ...s, configured: true, model, models, test: tried[tried.length - 1], testing: false, pinned: false, caps: {} }));
    return { ok: true };
  } catch (e) {
    if (e instanceof AiHttpError) return { ok: false, msg: e.message };
    return { ok: false, msg: 'אין חיבור לאינטרנט' };
  }
}

export function clearAiKey() {
  put(KEY, null);
  put(MODEL, null);
  put(MODELS, null);
  put(PINNED, null);
  put(CAPS, null);
  aiState.set((s) => ({ ...s, configured: false, model: '', models: [], test: undefined, testing: false, pinned: false, caps: {}, scan: { running: false, done: 0, total: 0, current: '', error: '' } }));
}

/** בדיקת חיבור חיה למודל הנוכחי (או לאחר שצוין) */
export async function testModel(model?: string) {
  const key = getAiKey();
  if (!key) return;
  const m = model || get(MODEL) || FALLBACKS[0];
  aiState.set((s) => ({ ...s, testing: true }));
  const res = await probe(key, m);
  if (res.ok && model) { put(MODEL, model); put(PINNED, '1'); aiState.set((s) => ({ ...s, model, pinned: true })); }
  aiState.set((s) => ({ ...s, test: res, testing: false }));
}

/** מרענן את רשימת המודלים של המפתח */
export async function refreshModels() {
  const key = getAiKey();
  if (!key) return;
  try {
    const models = usable((await listModels(key)).map((m: any) => m.name)).sort();
    put(MODELS, JSON.stringify(models));
    aiState.set((s) => ({ ...s, models }));
  } catch { /* ignore */ }
}

export function setAiModel(model: string) {
  const m = model.trim();
  put(MODEL, m || null);
  aiState.set((s) => ({ ...s, model: m }));
}

export interface ChatTurn { role: 'user' | 'model'; text: string; images?: { mime: string; data: string }[] }

async function ensureModel(key: string, force = false): Promise<string> {
  const cur = get(MODEL);
  if (cur && !force) return cur;
  const { model, models } = await chooseModel(key);
  if (!model) throw new Error('לא נמצא מודל Gemini שעונה. בדוק בהגדרות ← AI תזונה');
  put(MODEL, model);
  put(MODELS, JSON.stringify(models));
  aiState.set((s) => ({ ...s, model, models }));
  return model;
}

/** שגיאה עם פירוט טכני (קוד, מודל, ההודעה המקורית של Google ומה נוסה) להצגה למשתמש */
function withDetail(e: AiHttpError, log: string[]) {
  e.detail = log.join('\n');
  return e;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** (ישן) חזרה לאוטומטי */
export function unpinModel() {
  put(PINNED, null);
  aiState.set((s) => ({ ...s, pinned: false }));
}

const setCap = (id: string, cap: Cap) => {
  const caps = { ...aiState.get().caps, [id]: cap };
  put(CAPS, JSON.stringify(caps));
  aiState.set((s) => ({ ...s, caps }));
};

/** בקשה זעירה למודל, עם רמת חשיבה אם צוינה. מחזיר את התוצאה הגולמית. */
async function tinyCall(key: string, model: string, level?: string) {
  const t0 = performance.now();
  try {
    const gen: Record<string, unknown> = { maxOutputTokens: 64 };
    if (level) gen.thinkingConfig = { thinkingLevel: level };
    const r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ענה במילה אחת: בסדר' }] }], generationConfig: gen }),
    });
    const ms = Math.round(performance.now() - t0);
    if (r.ok) return { ok: true, status: 200, raw: '', ms };
    const e = await httpError(r);
    return { ok: false, status: r.status, raw: e.raw || e.message, ms };
  } catch {
    return { ok: false, status: 0, raw: 'אין חיבור לאינטרנט', ms: 0 };
  }
}

/**
 * סורק את המודלים של המפתח: האם עונים, האם יש מכסה, ואילו רמות חשיבה מתקבלות.
 * זהיר במכסה: עד 6 מודלים, בקשה זעירה לכל אחד, רווח של שנייה וחצי, ועצירה מיד בהגבלת קצב.
 * מודל בלי מכסה מסומן ומוסתר מהבחירה, וה-AI לא ינסה אותו.
 */
export async function scanModels() {
  const key = getAiKey();
  if (!key || aiState.get().scan.running) return;
  const rank = (id: string) => (/flash-lite/.test(id) ? 0 : /^gemini-3\.[56]-flash$/.test(id) ? 1 : /flash/.test(id) ? 2 : /gemini-4/.test(id) ? 3 : 4);
  const ids = [...aiState.get().models].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 6);
  aiState.set((s) => ({ ...s, scan: { running: true, done: 0, total: ids.length, current: '', error: '' } }));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const finish = (error = '') => aiState.set((s) => ({ ...s, scan: { running: false, done: s.scan.done, total: ids.length, current: '', error } }));
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    aiState.set((s) => ({ ...s, scan: { running: true, done: i, total: ids.length, current: id, error: '' } }));
    const base = await tinyCall(key, id);
    if (!base.ok && base.status === 429 && !isNoQuota(429, base.raw)) {
      // הגבלת קצב (או מכסה יומית): לא ממשיכים להציף
      finish('הגעת למגבלת הבקשות של Gemini. חכה כדקה ונסה שוב. ' + (i ? 'מה שנבדק עד עכשיו נשמר.' : ''));
      return;
    }
    if (!base.ok) {
      setCap(id, { status: isNoQuota(base.status, base.raw) ? 'noquota' : 'error', levels: [], msg: base.raw.slice(0, 160), at: Date.now() });
    } else {
      const allowed = allowedLevels(id);
      const probeLevels = [...new Set([allowed[0], allowed[allowed.length - 1]].filter(Boolean))] as string[];
      const okLevels: string[] = [];
      for (const lv of probeLevels) {
        await wait(1500);
        const r = await tinyCall(key, id, lv);
        if (r.status === 429) { finish('הגעת למגבלת הבקשות של Gemini באמצע הבדיקה. חכה כדקה ונסה שוב.'); return; }
        if (r.ok) okLevels.push(lv);
      }
      // רמות באמצע הטווח נחשבות תקינות אם שני הקצוות עבדו
      const levels = okLevels.length === probeLevels.length ? allowed : okLevels;
      setCap(id, { status: 'ok', levels, ms: base.ms, at: Date.now() });
    }
    await wait(1500);
  }
  aiState.set((s) => ({ ...s, scan: { running: false, done: ids.length, total: ids.length, current: '', error: '' } }));
}

/**
 * סדר המודלים לניסיון. "חזק" (תמונות, מסמכים, חיפוש באינטרנט, חשיבה עמוקה) מול "מהיר" (טקסט רגיל).
 * מודל שהמשתמש בחר בהגדרות קודם, ואחריו האוטומטי.
 */
/** מודלים שנתקעו בהגבלת קצב דקתית: לא מנסים אותם עד שהזמן עובר */
const cooldown: Record<string, number> = {};
/** המודל שענה בהצלחה בפעם האחרונה (לטקסט רגיל / לחזק): מנסים אותו קודם, כדי שהתשובות יהיו עקביות */
const lastGood: Record<string, string> = {};
const cooling = (m: string) => (cooldown[m] ?? 0) > Date.now();

function modelOrder(strong: boolean, current: string): string[] {
  const avail = aiState.get().models;
  const has = (m: string) => !avail.length || avail.includes(m);
  const p = store.get().settings.ai;
  const pref = strong ? p.visionModel : p.textModel;
  const auto = strong
    ? ['gemini-3.6-flash', 'gemini-3.8-flash', current, 'gemini-3.5-flash-lite']
    : ['gemini-3.5-flash-lite', 'gemini-3.6-flash', current, 'gemini-3.8-flash'];
  const caps = aiState.get().caps;
  // מודל שנסרק ואין לו מכסה לא ינוסה (חוץ ממכסה יומית שכבר התאפסה)
  const okCap = (m: string) => !caps[m] || caps[m].status === 'ok' || (caps[m].until !== undefined && Date.now() > caps[m].until);
  const base = pref ? [pref, ...auto] : auto;
  const list = [...new Set(base.filter((m) => (m === pref || m === current || has(m)) && okCap(m)))].slice(0, 3);
  return list.length ? list : [current];
}

export interface ChatOpts {
  system?: string; // הנחיה מותאמת (למשל עריכת תוכנית). בלי זה: מאמן התזונה
  raw?: boolean; // מחזיר את הטקסט כמו שהוא ב-reply, בלי פענוח של כרטיס ארוחה
  onDelta?: (acc: string) => void;
  web?: boolean; // חיפוש באינטרנט וקריאת קישורים
  deep?: boolean; // חשיבה עמוקה להודעה הזו
  docs?: boolean; // יש מסמכי ספרייה בבקשה
  onStage?: (label: string) => void; // דיווח חי על מה שקורה
  onAttempt?: (n: number) => void; // מתחיל ניסיון מספר n (כל ניסיון הוא קריאה נפרדת ל-Gemini)
}
export interface ChatResult extends AiResult {
  model: string;
  ms: number;
  sources: Source[];
  thinking?: string;
  webFailed?: boolean;
  calls: number; // כמה קריאות ל-Gemini נדרשו לתשובה הזו
  trace: string[]; // מה נוסה ומה נכשל, לבדיקה
}

/** תור בשיחה בזרימה (SSE): הודעה, כרטיס, זיכרון והצעות. בשגיאה מנסה הגדרות ומודלים אחרים. */
export async function chatTurn(turns: ChatTurn[], opts: ChatOpts = {}): Promise<ChatResult> {
  const key = getAiKey();
  if (!key) throw new Error('אין מפתח Gemini. חבר מפתח בהגדרות');
  const hasImages = turns.some((t) => t.images?.some((i) => i.mime.startsWith('image/')));
  const strong = hasImages || !!opts.web || !!opts.deep || !!opts.docs || turns.some((t) => t.images?.some((i) => !i.mime.startsWith('image/')));
  const prefs = store.get().settings.ai;
  const wantThink: Think = opts.deep ? 'high' : prefs.think;

  type V = { x: boolean; j: boolean; t: boolean };
  const bodyFor = (model: string, v: V) => {
    const gen: Record<string, unknown> = { temperature: 0.3 };
    if (v.j) gen.responseMimeType = 'application/json';
    if (v.x) {
      const lvl = resolveThinking(model, wantThink);
      if (lvl) gen.thinkingConfig = { thinkingLevel: lvl };
      if (hasImages) gen.mediaResolution = 'MEDIA_RESOLUTION_MEDIUM';
    }
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: opts.system ?? buildSystemPrompt(store.get().settings.profile) }] },
      contents: turns.map((t) => ({
        role: t.role,
        parts: [
          { text: t.text || ' ' },
          ...(t.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })),
        ],
      })),
      generationConfig: gen,
    };
    if (v.t) body.tools = [{ google_search: {} }, { url_context: {} }];
    return JSON.stringify(body);
  };

  const sources: Source[] = [];
  const seenQ = new Set<string>();
  const stream = async (model: string, v: V) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 120_000);
    try {
      const r = await fetch(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: bodyFor(model, v),
        signal: ctl.signal,
      });
      if (!r.ok) throw await httpError(r);
      let acc = '';
      let blocked = '';
      const eat = (event: string) => {
        const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!data || data === '[DONE]') return;
        let j: any;
        try { j = JSON.parse(data); } catch { return; }
        if (j?.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
        const cand = j?.candidates?.[0];
        for (const p of cand?.content?.parts ?? []) {
          if (p?.thought) continue;
          if (typeof p?.text === 'string') acc += p.text;
        }
        for (const q of cand?.groundingMetadata?.webSearchQueries ?? []) {
          if (typeof q === 'string' && !seenQ.has(q)) { seenQ.add(q); opts.onStage?.(`חוקר באינטרנט: ״${q.slice(0, 40)}״`); }
        }
        for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
          const uri = c?.web?.uri;
          if (uri && !sources.some((x) => x.uri === uri) && sources.length < 6) {
            sources.push({ uri, title: String(c.web.title || uri).slice(0, 80) });
            opts.onStage?.(`קורא מקורות (${sources.length})`);
          }
        }
        opts.onDelta?.(acc);
      };
      const reader = r.body?.getReader();
      if (!reader) {
        for (const ev of (await r.text()).split(/\r?\n\r?\n/)) eat(ev);
      } else {
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split(/\r?\n\r?\n/);
          buf = parts.pop() ?? '';
          for (const ev of parts) eat(ev);
        }
        if (buf.trim()) eat(buf);
      }
      return { acc, blocked };
    } finally {
      clearTimeout(to);
    }
  };

  // כשמחפשים באינטרנט אי אפשר לכפות JSON: ההנחיה עושה את זה והפענוח סלחני
  const variants: V[] = opts.web
    ? [{ x: true, j: false, t: true }, { x: false, j: false, t: true }, { x: false, j: false, t: false }]
    : [{ x: true, j: true, t: false }, { x: false, j: true, t: false }, { x: false, j: false, t: false }];

  const log: string[] = [];
  const trace: string[] = [];
  let calls = 0;
  const t0 = performance.now();
  try {
    const cur = await ensureModel(key);
    let last: AiHttpError | undefined;
    let tried = 0;
    const hits: { model: string; q: QuotaInfo }[] = [];
    const order = modelOrder(strong, cur);
    const caps0 = aiState.get().caps;
    const dayBlocked = order.length > 0 && order.every((m) => caps0[m]?.status === 'noquota' && (caps0[m].until ?? 0) > Date.now());
    if (dayBlocked) {
      // המכסה היומית נגמרה בכל המודלים: לא שולחים בקשות סתם
      const until = Math.min(...order.map((m) => caps0[m].until ?? 0));
      const e = new AiHttpError(429, 'נגמרה המכסה היומית של Gemini', 'המכסה היומית נגמרה בכל המודלים הזמינים');
      e.quota = { kind: 'day', retrySec: Math.ceil((until - Date.now()) / 1000), limit: '', quotaId: '', until };
      throw withDetail(e, [`מכסה יומית נגמרה: ${order.join(', ')}`]);
    }
    const ready = order.filter((m) => !cooling(m));
    if (!ready.length) {
      // כל המודלים בהמתנה: לא שולחים בקשות סתם
      const wait = Math.max(5, Math.ceil(Math.min(...order.map((m) => cooldown[m] ?? 0)) - Date.now()) / 1000);
      const e = new AiHttpError(429, 'הגעת למגבלת הבקשות לדקה של Gemini', 'המודלים בהמתנה אחרי הגבלת קצב');
      e.quota = { kind: 'minute', retrySec: Math.ceil(wait), limit: '', quotaId: '', until: Date.now() + wait * 1000 };
      throw withDetail(e, [`בהמתנה: ${order.join(', ')}`]);
    }
    const lg = lastGood[strong ? 's' : 't'];
    if (lg && ready.includes(lg)) { ready.splice(ready.indexOf(lg), 1); ready.unshift(lg); }
    for (const model of ready) {
      for (const v of variants) {
        try {
          opts.onStage?.(tried++ === 0 ? `שולח ל-${model}` : `עובר ל-${model}`);
          if (v.t) opts.onStage?.('חוקר באינטרנט');
          else { const lv = v.x ? resolveThinking(model, wantThink) : undefined; opts.onStage?.(lv && lv !== 'minimal' && lv !== 'low' ? 'חושב לעומק' : 'חושב'); }
          calls++;
          trace.push(`#${calls} ${model}${v.t ? ' +web' : ''}${v.x ? '' : ' -think'}${v.j ? '' : ' -json'}`);
          opts.onAttempt?.(calls);
          const { acc, blocked } = await stream(model, v);
          if (blocked) throw new Error('הבקשה נחסמה על ידי Gemini. נסה לנסח אחרת');
          if (!acc.trim()) { log.push(`${model}: תשובה ריקה`); continue; }
          const res = opts.raw ? ({ reply: acc, items: [], products: [], memory: [], suggestions: [] } as AiResult) : parseAiJson(acc, uid);
          // כשכופים JSON והמודל החזיר שברי טקסט (למשל reply"}), לא מציגים את זה אלא עוברים לנסיון הבא
          if (res.fallback && v.j) { log.push(`${model}: תשובה לא תקינה (לא JSON): ${acc.trim().slice(0, 300)}`); continue; }
          lastGood[strong ? 's' : 't'] = model;
          return {
            ...res,
            calls,
            trace: [...trace, ...log.map((l) => '  ! ' + l)],
            model,
            ms: Math.round(performance.now() - t0),
            sources,
            thinking: v.x ? resolveThinking(model, wantThink) : undefined,
            webFailed: !!opts.web && !v.t,
          };
        } catch (e) {
          if (!(e instanceof AiHttpError)) {
            if ((e as Error).name === 'AbortError') { log.push(`${model}: פג הזמן`); break; }
            if (e instanceof SyntaxError) { log.push(`${model}: JSON שבור`); continue; }
            throw e;
          }
          log.push(`${model}${v.x ? '' : v.t ? ' (בלי הגדרות מהירות)' : ' (בלי כלים/JSON)'} → ${e.status}: ${e.raw || e.message}`);
          last = e;
          if (e.fatal) throw withDetail(e, log);
          if (isNoQuota(e.status, e.raw)) {
            setCap(model, { status: 'noquota', levels: [], msg: e.raw.slice(0, 160), at: Date.now() });
            opts.onStage?.(`אין מכסה ב-${model}, מחפש מודל אחר`);
            break;
          }
          if (e.status === 429 && e.quota) {
            // הגבלת קצב או מכסה יומית: לא מנסים שוב את אותו מודל, רק מודל אחר (לכל מודל מכסה משלו)
            hits.push({ model, q: e.quota });
            if (e.quota.kind === 'day') setCap(model, { status: 'noquota', levels: [], msg: 'המכסה היומית נגמרה', at: Date.now(), until: e.quota.until });
            else cooldown[model] = e.quota.until;
            opts.onStage?.(`הגעת למגבלה ב-${model}, מנסה מודל אחר`);
            break;
          }
          if (e.status === 400) continue;
          if (e.status >= 500 || e.status === 429) await sleep(e.status === 429 ? 2000 : 700);
          break;
        }
      }
    }
    if (hits.length && hits.length >= ready.length) {
      // כל המודלים נתקעו במכסה: שגיאה אחת ברורה עם שעון עצר
      const allDay = hits.every((h) => h.q.kind === 'day');
      const minuteHits = hits.filter((h) => h.q.kind === 'minute');
      const until = allDay ? Math.min(...hits.map((h) => h.q.until)) : Math.min(...minuteHits.map((h) => h.q.until));
      const e = new AiHttpError(429, allDay ? 'נגמרה המכסה היומית של Gemini' : 'הגעת למגבלת הבקשות לדקה של Gemini', last?.raw ?? '');
      e.quota = { kind: allDay ? 'day' : 'minute', retrySec: Math.max(5, Math.ceil((until - Date.now()) / 1000)), limit: hits[0].q.limit, quotaId: hits[0].q.quotaId, until, model: hits[0].model };
      throw withDetail(e, log);
    }
    if (last) throw withDetail(last, log);
    throw withDetail(new AiHttpError(0, 'Gemini לא החזיר תשובה שימושית. נסה שוב', '', false), log);
  } catch (e) {
    if (e instanceof AiHttpError) throw e;
    if (e instanceof TypeError) throw new Error('אין חיבור לאינטרנט');
    throw e;
  }
}
