import { createStore } from '../core/store';
import { uid } from '../core/dates';
import { SYSTEM_PROMPT, parseAiJson, pickModel, type AiResult } from './pure';

/**
 * חיבור ל-Gemini ישירות מהדפדפן (ה-API תומך ב-CORS). המפתח נשמר ב-localStorage בלבד, מחוץ לגיבויים.
 * שם המודל נבחר אוטומטית מרשימת המודלים של המפתח (השמות משתנים), ואפשר לדרוס אותו בהגדרות.
 */
const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = 'wo:ai-key';
const MODEL = 'wo:ai-model';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

export const aiState = createStore({ configured: !!get(KEY), model: get(MODEL) ?? '' });
export const getAiKey = () => get(KEY) ?? '';
export const maskKey = (k: string) => (k.length > 10 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');

async function listModels(key: string) {
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw await httpError(r);
  const j = await r.json();
  return (j.models ?? []).map((m: any) => ({ name: String(m.name), methods: m.supportedGenerationMethods as string[] | undefined }));
}

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

/** שומר מפתח אחרי שבדק שהוא עובד ובחר מודל */
export async function saveAiKey(key: string): Promise<{ ok: boolean; msg?: string }> {
  const k = key.trim();
  if (!k) return { ok: false, msg: 'הדבק את המפתח' };
  try {
    const models = await listModels(k);
    const model = pickModel(models) ?? 'gemini-flash-latest';
    put(KEY, k);
    put(MODEL, model);
    aiState.set({ configured: true, model });
    return { ok: true };
  } catch (e) {
    if (e instanceof AiHttpError) return { ok: false, msg: e.message };
    return { ok: false, msg: 'אין חיבור לאינטרנט' };
  }
}

export function clearAiKey() {
  put(KEY, null);
  put(MODEL, null);
  aiState.set({ configured: false, model: '' });
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
  const models = await listModels(key);
  const m = pickModel(models) ?? 'gemini-flash-latest';
  put(MODEL, m);
  aiState.set((s) => ({ ...s, model: m }));
  return m;
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
      if (e instanceof AiHttpError && e.status === 404) {
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
