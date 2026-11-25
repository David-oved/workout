/**
 * workOut Push: שרת קטן ב-Cloudflare Workers ששולח התראות Push לאייפון בשעה המדויקת.
 *
 * איך זה עובד:
 * 1. האפליקציה נרשמת (subscribe) ושולחת לכאן את לוח התזכורות הקרוב (שעות מוחלטות).
 * 2. שעון (cron) רץ כל דקה, ומי שהגיע זמנו מקבל Push (בלי תוכן, לפי VAPID).
 * 3. ה-Service Worker באפליקציה מקבל את ה-Push, שולף את הטקסט מ-/pending ומציג התראה.
 * אין כאן שום מידע אישי מעבר לטקסט התזכורות ולכתובת ה-Push של המכשיר. המפתח הפרטי (VAPID) נשמר כסוד ב-Cloudflare.
 */
import { loadInbox as loadQ, loadCfg, markActive, processToken, processAll, saveCfg, deleteCfg } from './queue.js';
const ORIGINS = ['https://david-oved.github.io', 'http://localhost:5173'];
const SUBJECT = 'https://david-oved.github.io/workout/';
const enc = new TextEncoder();

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (o) => b64u(enc.encode(JSON.stringify(o)));

async function idOf(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(endpoint));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const loadDb = async (env) => { const t = await env.SUBS.get('db'); return t ? JSON.parse(t) : { users: {} }; };
const saveDb = (env, db) => env.SUBS.put('db', JSON.stringify(db));

let signKey;
async function privateKey(env) {
  if (!signKey) signKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return signKey;
}

async function vapid(env, endpoint) {
  const head = b64uJson({ typ: 'JWT', alg: 'ES256' });
  const body = b64uJson({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await privateKey(env), enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

/** Push בלי תוכן: ה-Service Worker מושך את הטקסט מ-/pending. מחזיר את קוד התשובה של שירות ה-Push */
async function sendPush(env, sub) {
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await vapid(env, sub.endpoint), TTL: '3600', Urgency: 'high' } });
  return r.status;
}

const clean = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x.at === 'number' && typeof x.title === 'string')
    .slice(0, 400)
    .map((x) => ({ id: String(x.id ?? '').slice(0, 60), at: Math.round(x.at), title: x.title.slice(0, 80), body: String(x.body ?? '').slice(0, 140), kind: typeof x.kind === 'string' ? x.kind.slice(0, 12) : undefined }));

function cors(req) {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (req, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });

const TXT = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
const inboxKey = (t) => `inbox:${t}`;
const loadInbox = async (env, t) => { try { const s = await env.SUBS.get(inboxKey(t)); return s ? JSON.parse(s) : []; } catch { return []; } };

/**
 * תיבת דואר ל-Siri / אפליקציית קיצורים: הקיצור שולח טקסט מוכתב ל-/siri/<token>/add, והאפליקציה מושכת אותו
 * מ-/list ומאשרת ב-/ack. ה-token הוא סוד אקראי של המשתמש (אין חשבונות). הטקסט נשמר עד 14 יום או עד שנמשך.
 */
const MAX_IMG = 9 * 1024 * 1024;
const imgKey = (t, id) => `img:${t}:${id}`;
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

async function siri(req, env, url, token, action, ctx) {
  // /add ו-/photo: טקסט, תמונה, או שניהם. תמונה מגיעה כקובץ בטופס (multipart), כגוף גולמי של תמונה, או כ-base64 ב-JSON
  if (action === 'add' || action === 'photo') {
    let t = url.searchParams.get('t') ?? url.searchParams.get('text') ?? '';
    let img = null; // { buf, mime }
    const seen = []; // מה הגיע בפועל (לאבחון)
    const ctype = req.headers.get('Content-Type') || '';
    if (req.method === 'POST') {
      const ct = req.headers.get('Content-Type') || '';
      if (ct.includes('multipart/form-data')) {
        const fd = await req.formData();
        t = String(fd.get('text') ?? fd.get('t') ?? t);
        for (const [k, v] of fd.entries()) {
          if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') {
            seen.push(`${k}=קובץ(${v.type || '?'},${v.size})`);
            if (!img) img = { buf: await v.arrayBuffer(), mime: v.type || 'image/jpeg' };
          } else {
            const str = String(v);
            seen.push(`${k}=טקסט(${str.length})`);
            // תמונה שהגיעה כטקסט base64 (או data URL)
            if (!img && str.length > 1000 && /^(data:[^,]*,)?[A-Za-z0-9+/= \r\n]+$/.test(str)) img = { buf: fromB64(str.replace(/^data:[^,]*,/, '').replace(/[\r\n]/g, '').replace(/ /g, '+')), mime: 'image/jpeg' };
          }
        }
      } else if (ct.startsWith('image/')) {
        img = { buf: await req.arrayBuffer(), mime: ct.split(';')[0] };
      } else {
        const raw = await req.text();
        if (ct.includes('json')) {
          try {
            const j = JSON.parse(raw);
            t = String(j.text ?? j.t ?? t);
            const b64 = j.image ?? j.photo;
            if (typeof b64 === 'string' && b64.length > 100) img = { buf: fromB64(b64.replace(/^data:[^,]*,/, '')), mime: String(j.mime ?? 'image/jpeg') };
          } catch { t = t || raw; }
        }
        else if (ct.includes('x-www-form-urlencoded')) {
          const p = new URLSearchParams(raw);
          t = p.get('text') ?? p.get('t') ?? t;
          for (const [k, v] of p.entries()) {
            seen.push(`${k}=טקסט(${v.length})`);
            // תמונה שנשלחה בתוך טופס רגיל כ-base64 (או data URL)
            if (!img && v.length > 1000 && /^(data:[^,]*,)?[A-Za-z0-9+/= \r\n_-]+$/.test(v)) img = { buf: fromB64(v.replace(/^data:[^,]*,/, '').replace(/[\r\n]/g, '').replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/')), mime: 'image/jpeg' };
          }
        }
        else t = t || raw;
      }
    }
    t = String(t).replace(/\s+/g, ' ').trim().slice(0, 400);
    if (img && img.buf.byteLength > MAX_IMG) return new Response('התמונה גדולה מדי', { status: 413, headers: { ...TXT, ...cors(req) } });
    if (img && !String(img.mime).startsWith('image/')) img.mime = 'image/jpeg';
    if (img && img.buf.byteLength < 200) img = null;
    console.log('siri add', ctype, JSON.stringify(seen), 'img:', !!img);
    if (!t && !img) return new Response('לא התקבל טקסט או תמונה', { status: 400, headers: { ...TXT, ...cors(req) } });
    const list = await loadInbox(env, token);
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const item = { id, text: t, ts: Date.now(), st: 'q' };
    if (img) {
      await env.SUBS.put(imgKey(token, id), img.buf, { expirationTtl: 14 * 86400 });
      item.img = img.mime;
    }
    list.push(item);
    await env.SUBS.put(inboxKey(token), JSON.stringify(list.slice(-20)), { expirationTtl: 14 * 86400 });
    await markActive(env, token);
    // ניתוח מיידי ברקע (ואם לא הספיק, השעון ממשיך כל דקה)
    if (ctx) ctx.waitUntil(processToken(env, token, { budgetMs: 15_000, timeoutMs: 24_000 }).catch(() => undefined));
    return new Response(img ? 'התמונה נרשמה ✓' : action === 'photo' ? `נרשם ✓ אבל בלי תמונה. הגיע: ${seen.join(' ') || ctype || 'כלום'}` : 'נרשם ✓', { headers: { ...TXT, ...cors(req) } });
  }
  if (action.startsWith('img/')) {
    const id = action.slice(4);
    const it = (await loadInbox(env, token)).find((x) => x.id === id);
    const buf = it?.img ? await env.SUBS.get(imgKey(token, id), 'arrayBuffer') : null;
    if (!buf) return json(req, { ok: false, error: 'no image' }, 404);
    return new Response(buf, { headers: { 'Content-Type': it.img, 'Cache-Control': 'no-store', ...cors(req) } });
  }
  if (action === 'config' && req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return json(req, { ok: false, error: 'bad json' }, 400); }
    const list = (v) => (Array.isArray(v) ? v.map(String).slice(0, 3) : []);
    if (typeof b.key !== 'string' || b.key.length < 20 || b.key.length > 200) return json(req, { ok: false, error: 'bad key' }, 400);
    const think = {};
    for (const [k, v] of Object.entries(b.think && typeof b.think === 'object' ? b.think : {})) if (typeof v === 'string') think[String(k).slice(0, 60)] = v.slice(0, 12);
    await markActive(env, token);
    await saveCfg(env, token, { key: b.key, vision: list(b.vision), text: list(b.text), think, system: String(b.system ?? '').slice(0, 24000), ctx: String(b.ctx ?? '').slice(0, 24000), at: Date.now() });
    if (ctx) ctx.waitUntil(processToken(env, token, { budgetMs: 15_000, timeoutMs: 24_000 }).catch(() => undefined));
    return json(req, { ok: true });
  }
  if (action === 'clear') { await deleteCfg(env, token); return json(req, { ok: true }); }
  if (action === 'list') return json(req, { items: await loadQ(env, token), srv: !!(await loadCfg(env, token))?.key });
  if (action === 'ack' && req.method === 'POST') {
    let ids = [];
    try { const b = await req.json(); ids = Array.isArray(b.ids) ? b.ids.map(String) : []; } catch { /* ignore */ }
    for (const id of ids) { try { await env.SUBS.delete(imgKey(token, id)); } catch { /* ignore */ } }
    const left = (await loadInbox(env, token)).filter((x) => !ids.includes(x.id));
    if (left.length) await env.SUBS.put(inboxKey(token), JSON.stringify(left), { expirationTtl: 14 * 86400 });
    else await env.SUBS.delete(inboxKey(token));
    return json(req, { ok: true, left: left.length });
  }
  return json(req, { ok: false, error: 'not found' }, 404);
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const sm = url.pathname.match(/^\/siri\/([A-Za-z0-9_-]{22,64})\/(add|photo|list|ack|config|clear|img\/[a-f0-9]{12})$/);
  if (sm) return siri(req, env, url, sm[1], sm[2], ctx);

  if (req.method === 'GET' && url.pathname === '/config') return json(req, { pub: env.VAPID_PUBLIC, v: 1 });

  if (req.method === 'GET' && url.pathname === '/pending') {
    const id = url.searchParams.get('e') || '';
    const db = await loadDb(env);
    const u = db.users[id];
    const items = u?.pending ?? [];
    if (u && items.length) { u.pending = []; await saveDb(env, db); }
    return json(req, { items });
  }

  if (req.method !== 'POST') return json(req, { ok: false, error: 'not found' }, 404);
  let b;
  try { b = await req.json(); } catch { return json(req, { ok: false, error: 'bad json' }, 400); }

  if (url.pathname === '/subscribe') {
    const sub = b.sub;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return json(req, { ok: false, error: 'bad subscription' }, 400);
    const id = await idOf(sub.endpoint);
    const db = await loadDb(env);
    db.users[id] = { sub: { endpoint: sub.endpoint, keys: sub.keys }, schedule: clean(b.schedule), pending: [], at: Date.now() };
    await saveDb(env, db);
    return json(req, { ok: true, id });
  }

  const db = await loadDb(env);
  const id = String(b.id || '');
  const u = db.users[id];
  if (!u) return json(req, { ok: false, error: 'unknown device' }, 404);

  if (url.pathname === '/schedule') {
    u.schedule = clean(b.schedule);
    await saveDb(env, db);
    return json(req, { ok: true, n: u.schedule.length });
  }
  if (url.pathname === '/unsubscribe') {
    delete db.users[id];
    await saveDb(env, db);
    return json(req, { ok: true });
  }
  if (url.pathname === '/test') {
    u.pending = [...(u.pending || []), { id: 'test', title: '🔔 התראות workOut עובדות', body: 'כך ייראו התזכורות שלך' }].slice(-10);
    await saveDb(env, db);
    const st = await sendPush(env, u.sub).catch(() => 0);
    return json(req, { ok: st >= 200 && st < 300, status: st });
  }
  return json(req, { ok: false, error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); } catch (e) { return json(req, { ok: false, error: String(e?.message ?? e) }, 500); }
  },

  /** רץ כל דקה: מי שהגיע זמנו מקבל Push */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processAll(env).catch(() => undefined));
    const db = await loadDb(env);
    const now = Date.now();
    let dirty = false;
    for (const [id, u] of Object.entries(db.users)) {
      const keep = u.schedule.filter((x) => x.at > now);
      const due = u.schedule.filter((x) => x.at <= now && x.at > now - 45 * 60000);
      if (keep.length !== u.schedule.length) { u.schedule = keep; dirty = true; }
      if (!due.length) continue;
      u.pending = [...(u.pending || []), ...due].slice(-10);
      dirty = true;
      const st = await sendPush(env, u.sub).catch(() => 0);
      if (st === 404 || st === 410) delete db.users[id];
    }
    if (dirty) await saveDb(env, db);
  },
};
