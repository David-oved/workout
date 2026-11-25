import { store } from '../core/state';
import { dayInfo } from '../core/calc';
import { todayKey } from '../core/dates';
import { PUSH_URL } from '../push/config';

/**
 * "כמה נשאר לי היום": האפליקציה שומרת ב-Worker סיכום קצר (אכלת, יעד), והקיצור שואל אותו ומקריא תשובה.
 * נשלח רק כשמשהו השתנה, ולא יותר מפעם בכמה דקות (מגבלת הכתיבות החינמית של Cloudflare).
 */
const TOKEN = 'wo:siri-token';
const MIN_GAP = 4 * 60_000;
let last = '';
let lastAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function push(force: boolean) {
  let tok: string | null = null;
  try { tok = localStorage.getItem(TOKEN); } catch { /* ignore */ }
  if (!tok || !PUSH_URL) return;
  const s = store.get();
  const day = todayKey(s.settings.resetHour);
  const info = dayInfo(s, day);
  const body = JSON.stringify({ day, reset: s.settings.resetHour, eaten: info.eaten, target: info.target });
  if (body === last) return;
  if (!force && Date.now() - lastAt < MIN_GAP) { schedule(); return; }
  try {
    const r = await fetch(`${PUSH_URL}/siri/${tok}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (r.ok) { last = body; lastAt = Date.now(); }
  } catch { /* אין רשת: ננסה בשינוי הבא */ }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void push(false), Math.max(5_000, MIN_GAP - (Date.now() - lastAt)));
}

export function startStatusSync() {
  store.subscribe(schedule);
  // בסגירת האפליקציה שולחים את המצב האחרון מיד
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void push(true); });
  schedule();
}
