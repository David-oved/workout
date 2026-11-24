import { store } from '../core/state';
import { todayKey } from '../core/dates';
import { PUSH_URL } from '../push/config';
import { aiState, getAiKey, serverModels } from '../ai/gemini';
import { buildSystemPrompt } from '../ai/pure';
import { buildAppData } from '../ai/context';

/**
 * ניתוח ארוחות בשרת (כשהאפליקציה סגורה): האפליקציה שומרת ב-Worker הפרטי שלך את מפתח ה-Gemini, ההנחיה והקשר קצר,
 * והשרת מנתח כל מה שנשלח מהקיצור לפי הסדר, ומנסה שוב לבד כשיש תקלה. אפשר לכבות בהגדרות, והמפתח נמחק מהשרת.
 */
const LS = 'wo:siri-srv';
const TOKEN = 'wo:siri-token';
const token = () => { try { return localStorage.getItem(TOKEN); } catch { return null; } };
export const srvEnabled = () => { try { return localStorage.getItem(LS) !== '0'; } catch { return true; } };

let lastSent = '';
let timer: ReturnType<typeof setTimeout> | undefined;

async function post(path: string, body?: unknown, tok = token()) {
  if (!tok || !PUSH_URL) return false;
  try {
    const r = await fetch(`${PUSH_URL}/siri/${tok}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return r.ok;
  } catch { return false; }
}

/** שולח את ההגדרות לשרת (רק אם השתנו). בלי מפתח או כשכבוי: לא שולח */
export async function syncServerConfig(force = false) {
  if (!token() || !srvEnabled() || !aiState.get().configured) return;
  const key = getAiKey();
  if (!key) return;
  const m = serverModels();
  const payload = {
    key, vision: m.vision, text: m.text, think: m.think,
    system: buildSystemPrompt(store.get().settings.profile),
    ctx: buildAppData(todayKey(store.get().settings.resetHour)),
  };
  const sig = JSON.stringify(payload);
  if (!force && sig === lastSent) return;
  if (await post('config', payload)) lastSent = sig;
}

/** מוחק את ההגדרות (כולל המפתח) מהשרת */
export async function clearServerConfig(tok = token()) {
  lastSent = '';
  return post('clear', undefined, tok);
}

export function setSrvEnabled(on: boolean) {
  try { localStorage.setItem(LS, on ? '1' : '0'); } catch { /* ignore */ }
  if (on) void syncServerConfig(true);
  else void clearServerConfig();
}

/** מעדכן את השרת אחרי שינויים (מפתח, מודל, זיכרון, ארוחות שנרשמו), בהשהיה קצרה */
export function startCfgSync() {
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => void syncServerConfig(), 4000); };
  store.subscribe(kick);
  aiState.subscribe(kick);
  kick();
}
