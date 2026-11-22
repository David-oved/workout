import { createStore } from '../core/store';
import { uid } from '../core/dates';
import { SYSTEM_PROMPT, parseAiJson, pickModel, type AiResult } from './pure';

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

export interface TestResult { ok: boolean; model: string; ms: number; msg?: string }
export const aiState = createStore({
  configured: !!get(KEY),
  model: get(MODEL) ?? '',
  models: readModels(),
  test: undefined as TestResult | undefined,
  testing: false,
  pinned: get(PINNED) === '1',
});
export const getAiKey = () => get(KEY) ?? '';
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');

/** מודלים שנבדקים לפי הסדר אם הבחירה האוטומטית נכשלת (לפי התיעוד, נובמבר 2026) */
const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

class AiHttpError extends Error {
  constructor(public status: number, msg: string, public raw = '', public fatal = false, public detail = '') { super(msg); }
}
async function httpError(r: Response): Promise<AiHttpError> {
  let raw = '';
  let st = '';
  try {
    const j = await r.json();
    raw = j?.error?.message ?? '';
    st = j?.error?.status ?? '';
  } catch { /* ignore */ }
  const tail = `${raw}${st ? ` [${st}]` : ''}`;
  if (r.status === 400 && /api key/i.test(raw)) return new AiHttpError(400, 'המפתח לא תקין', tail, true);
  if (r.status === 401 || r.status === 403) return new AiHttpError(r.status, 'אין הרשאה למפתח הזה. ודא שהוא פעיל ושה-Gemini API מופעל', tail, true);
  if (r.status === 404) return new AiHttpError(404, 'המודל לא נמצא', tail);
  if (r.status === 429) return new AiHttpError(429, 'חרגת מהמכסה של Gemini. נסה שוב בעוד דקה', tail);
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
    aiState.set({ configured: true, model, models, test: tried[tried.length - 1], testing: false, pinned: false });
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
  aiState.set({ configured: false, model: '', models: [], test: undefined, testing: false, pinned: false });
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

/** חזרה לאוטומטי: מודל מהיר לטקסט ומודל חזק יותר לתמונות */
export function unpinModel() {
  put(PINNED, null);
  aiState.set((s) => ({ ...s, pinned: false }));
}

/**
 * רמת חשיבה לפי מודל (לפי התיעוד): ברירת המחדל של המודלים החדשים כוללת חשיבה והיא מאטה.
 * flash-lite ו-3.6 תומכים ב-minimal. ל-3.8 ול-Gemini 4 אסור minimal, אז low.
 */
const thinkingFor = (id: string): string | undefined => {
  if (/flash-lite/.test(id) || /^gemini-3\.[56]-flash$/.test(id)) return 'minimal';
  if (/^gemini-[34]/.test(id)) return 'low';
  return undefined;
};

/** סדר המודלים לניסיון: מהיר לטקסט, חזק יותר לתמונות. אם המשתמש נעל מודל, הוא קודם. */
function modelOrder(hasImages: boolean, current: string): string[] {
  const avail = aiState.get().models;
  const has = (m: string) => !avail.length || avail.includes(m);
  const auto = hasImages
    ? ['gemini-3.6-flash', 'gemini-3.8-flash', current, 'gemini-3.5-flash-lite']
    : ['gemini-3.5-flash-lite', 'gemini-3.6-flash', current, 'gemini-3.8-flash'];
  const base = aiState.get().pinned ? [current, ...auto] : auto;
  return [...new Set(base.filter((m) => m === current || has(m)))].slice(0, 3);
}

export interface ChatResult extends AiResult { model: string; ms: number }

/** תור בשיחה בזרימה (SSE): מחזיר הודעה ורשימת מנות, ומדווח על הטקסט החלקי תוך כדי. בשגיאת שרת מנסה מודלים אחרים. */
export async function chatTurn(turns: ChatTurn[], onDelta?: (acc: string) => void): Promise<ChatResult> {
  const key = getAiKey();
  if (!key) throw new Error('אין מפתח Gemini. חבר מפתח בהגדרות');
  const hasImages = !!turns[turns.length - 1]?.images?.length || turns.some((t) => t.images?.length);

  const bodyFor = (model: string, v: { x: boolean; j: boolean }) => {
    const gen: Record<string, unknown> = { temperature: 0.3 };
    if (v.j) gen.responseMimeType = 'application/json';
    if (v.x) {
      const lvl = thinkingFor(model);
      if (lvl) gen.thinkingConfig = { thinkingLevel: lvl };
      if (hasImages) gen.mediaResolution = 'MEDIA_RESOLUTION_MEDIUM';
    }
    return JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: turns.map((t) => ({
        role: t.role,
        parts: [
          { text: t.text || ' ' },
          ...(t.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })),
        ],
      })),
      generationConfig: gen,
    });
  };

  const stream = async (model: string, v: { x: boolean; j: boolean }) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 75_000);
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
        for (const p of j?.candidates?.[0]?.content?.parts ?? []) {
          if (p?.thought) continue;
          if (typeof p?.text === 'string') acc += p.text;
        }
        onDelta?.(acc);
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

  const log: string[] = [];
  const t0 = performance.now();
  try {
    const cur = await ensureModel(key);
    let last: AiHttpError | undefined;
    for (const model of modelOrder(hasImages, cur)) {
      for (const v of [{ x: true, j: true }, { x: false, j: true }, { x: false, j: false }]) {
        try {
          const { acc, blocked } = await stream(model, v);
          if (blocked) throw new Error('הבקשה נחסמה על ידי Gemini. נסה לנסח אחרת');
          if (!acc.trim()) { log.push(`${model}: תשובה ריקה`); continue; }
          const res = parseAiJson(acc, uid);
          return { ...res, model, ms: Math.round(performance.now() - t0) };
        } catch (e) {
          if (!(e instanceof AiHttpError)) {
            if ((e as Error).name === 'AbortError') { log.push(`${model}: פג הזמן`); break; }
            if (e instanceof SyntaxError) { log.push(`${model}: JSON שבור`); continue; }
            throw e;
          }
          log.push(`${model}${v.x ? '' : v.j ? ' (בלי הגדרות מהירות)' : ' (בלי JSON)'} → ${e.status}: ${e.raw || e.message}`);
          last = e;
          if (e.fatal) throw withDetail(e, log);
          if (e.status === 400) continue; // ננסה את אותו מודל בלי ההגדרות הנוספות
          if (e.status >= 500 || e.status === 429) await sleep(e.status === 429 ? 2000 : 700);
          break; // עוברים למודל הבא
        }
      }
    }
    if (last) throw withDetail(last, log);
    throw withDetail(new AiHttpError(0, 'Gemini לא החזיר תשובה שימושית. נסה שוב', '', false), log);
  } catch (e) {
    if (e instanceof AiHttpError) throw e;
    if (e instanceof TypeError) throw new Error('אין חיבור לאינטרנט');
    throw e;
  }
}
