import fs from 'node:fs';
const rw = (f, fn) => { const s = fs.readFileSync(f, 'utf8'); const o = fn(s); fs.writeFileSync(f, o); };
const must = (s, a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); return s.replace(a, b); };

// 1. PHOTO_HINT משותף ב-pure.ts
const hint = fs.readFileSync('src/siri/prepare.ts', 'utf8').match(/const PHOTO_HINT = ('[^\n]*');/)[1];
rw('src/ai/pure.ts', (s) => s + `\n/** הנחיה נסתרת לניתוח תמונה שהגיעה מקיצור (משותף לאפליקציה ולשרת) */\nexport const PHOTO_HINT = ${hint};\n`);
rw('src/siri/prepare.ts', (s) => {
  s = s.replace(/const PHOTO_HINT = '[^\n]*';\n/, '');
  return must(s, "import { aiState, chatTurn } from '../ai/gemini';", "import { aiState, chatTurn } from '../ai/gemini';\nimport { PHOTO_HINT } from '../ai/pure';");
});

// 2. תיקון הלוגיקה בסוף runOne
rw('push-worker/src/queue.js', (s) => {
  s = must(s, "if ((temp || !lastErr) && n < MAX_TRIES)", "if (temp && n < MAX_TRIES)");
  return s;
});

// 3. index.js: ייבוא, פריטים עם st, מסלולים חדשים, waitUntil, cron
rw('push-worker/src/index.js', (s) => {
  s = must(s, "const ORIGINS =", "import { loadInbox as loadQ, loadCfg, processToken, processAll, saveCfg, deleteCfg } from './queue.js';\nconst ORIGINS =");
  s = must(s, "(add|photo|list|ack|img\/[a-f0-9]{12})$/);\n  if (sm) return siri(req, env, url, sm[1], sm[2]);", "(add|photo|list|ack|config|clear|img\/[a-f0-9]{12})$/);\n  if (sm) return siri(req, env, url, sm[1], sm[2], ctx);");
  s = must(s, "async function handle(req, env) {", "async function handle(req, env, ctx) {");
  s = must(s, "try { return await handle(req, env); }", "try { return await handle(req, env, ctx); }");
  s = must(s, "async fetch(req, env) {", "async fetch(req, env, ctx) {");
  s = must(s, "async function siri(req, env, url, token, action) {", "async function siri(req, env, url, token, action, ctx) {");
  s = must(s, "const item = { id, text: t, ts: Date.now() };", "const item = { id, text: t, ts: Date.now(), st: 'q' };");
  s = must(s, "    return new Response(img ? 'התמונה נרשמה ✓'", "    // ניתוח מיידי ברקע (ואם לא הספיק, השעון ממשיך כל דקה)\n    if (ctx) ctx.waitUntil(processToken(env, token, { budgetMs: 15_000, timeoutMs: 24_000 }).catch(() => undefined));\n    return new Response(img ? 'התמונה נרשמה ✓'");
  s = must(s, "  if (action === 'list') return json(req, { items: await loadInbox(env, token) });", `  if (action === 'config' && req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch { return json(req, { ok: false, error: 'bad json' }, 400); }
    const list = (v) => (Array.isArray(v) ? v.map(String).slice(0, 3) : []);
    if (typeof b.key !== 'string' || b.key.length < 20 || b.key.length > 200) return json(req, { ok: false, error: 'bad key' }, 400);
    const think = {};
    for (const [k, v] of Object.entries(b.think && typeof b.think === 'object' ? b.think : {})) if (typeof v === 'string') think[String(k).slice(0, 60)] = v.slice(0, 12);
    await saveCfg(env, token, { key: b.key, vision: list(b.vision), text: list(b.text), think, system: String(b.system ?? '').slice(0, 24000), ctx: String(b.ctx ?? '').slice(0, 24000), at: Date.now() });
    if (ctx) ctx.waitUntil(processToken(env, token, { budgetMs: 15_000, timeoutMs: 24_000 }).catch(() => undefined));
    return json(req, { ok: true });
  }
  if (action === 'clear') { await deleteCfg(env, token); return json(req, { ok: true }); }
  if (action === 'list') return json(req, { items: await loadQ(env, token), srv: !!(await loadCfg(env, token))?.key });`);
  s = must(s, "  async scheduled(_event, env) {", "  async scheduled(_event, env, ctx) {\n    ctx.waitUntil(processAll(env).catch(() => undefined));");
  return s;
});
console.log('ok');
