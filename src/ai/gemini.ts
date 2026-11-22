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
});
export const getAiKey = () => get(KEY) ?? '';
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');

/** מודלים שנבדקים לפי הסדר אם הבחירה האוטומטית נכשלת (לפי התיעוד, נובמבר 2026) */
const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

class AiHttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}
async function httpError(r: Response): Promise<AiHttpError> {
  let raw = '';
  try { raw = (await r.json())?.error?.message ?? ''; } catch { /* ignore */ }
  if (r.status === 400 && /api key/i.test(raw)) return new AiHttpError(400, 'המפתח לא תקין');
  if (r.status === 401 || r.status === 403) return new AiHttpError(r.status, 'אין הרשאה למפתח הזה. ודא שהוא פעיל ושה-Gemini API מופעל');
  if (r.status === 404) return new AiHttpError(404, 'המודל לא נמצא');
  if (r.status === 429) return new AiHttpError(429, 'חרגת מהמכסה של Gemini. נסה שוב בעוד דקה');
  if (r.status >= 500) return new AiHttpError(r.status, 'השרת של Gemini עמוס כרגע. נסה שוב');
  return new AiHttpError(r.status, `שגיאה מ-Gemini (${r.status})${raw ? `: ${raw.slice(0, 140)}` : ''}`);
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
    aiState.set({ configured: true, model, models, test: tried[tried.length - 1], testing: false });
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
  aiState.set({ configured: false, model: '', models: [], test: undefined, testing: false });
}

/** בדיקת חיבור חיה למודל הנוכחי (או לאחר שצוין) */
export async function testModel(model?: string) {
  const key = getAiKey();
  if (!key) return;
  const m = model || get(MODEL) || FALLBACKS[0];
  aiState.set((s) => ({ ...s, testing: true }));
  const res = await probe(key, m);
  if (res.ok && model) { put(MODEL, model); aiState.set((s) => ({ ...s, model })); }
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

/** תור בשיחה: שולח את כל ההיסטוריה ומקבל הודעה ורשימת מנות מעודכנת */
export async function chatTurn(turns: ChatTurn[]): Promise<AiResult> {
  const key = getAiKey();
  if (!key) throw new Error('אין מפתח Gemini. חבר מפתח בהגדרות');
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: turns.map((t) => ({
      role: t.role,
      parts: [
        { text: t.text || ' ' },
        ...(t.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })),
      ],
    })),
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  });

  const call = async (model: string) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 60_000);
    try {
      const r = await fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body,
        signal: ctl.signal,
      });
      if (!r.ok) throw await httpError(r);
      return r.json();
    } finally {
      clearTimeout(to);
    }
  };

  try {
    let model = await ensureModel(key);
    let j: any;
    try {
      j = await call(model);
    } catch (e) {
      if (e instanceof AiHttpError && (e.status === 404 || e.status === 400)) {
        model = await ensureModel(key, true);
        j = await call(model);
      } else throw e;
    }
    if (j?.promptFeedback?.blockReason) throw new Error('הבקשה נחסמה על ידי Gemini. נסה לנסח אחרת');
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
    if (!text.trim()) throw new Error('Gemini לא החזיר תשובה. נסה שוב');
    return parseAiJson(text, uid);
  } catch (e) {
    if (e instanceof AiHttpError) throw e;
    if ((e as Error).name === 'AbortError') throw new Error('הבקשה לקחה יותר מדי זמן. נסה שוב');
    if (e instanceof TypeError) throw new Error('אין חיבור לאינטרנט');
    throw e;
  }
}
