import { createStore } from './store';
import { store } from './state';
import { addDays, todayKey } from './dates';
import { WORKOUT_MIN, type ExtEvent } from './conflicts';
import scriptTemplate from '../../apps-script/Code.gs?raw';

/**
 * גשר ליומן Google דרך Google Apps Script שרץ בחשבון של המשתמש.
 * הכתובת והמפתח נשמרים רק ב-localStorage של המכשיר (לא בגיבויים): מי שמחזיק בהם יכול לקרוא את היומן.
 */
const URL_KEY = 'wo:bridge-url';
const KEY_KEY = 'wo:bridge-key';
const EV_KEY = 'wo:ext-events';
const HASH_KEY = 'wo:bridge-hash';
const SYNC_AT = 'wo:bridge-sync-at';
const CALS_KEY = 'wo:bridge-cals';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

export interface BridgeState {
  connected: boolean;
  events: ExtEvent[];
  calendars: string[]; // היומנים ש-Google מצא בחשבון
  range?: { from: string; to: string };
  evStatus: 'idle' | 'loading' | 'ok' | 'error';
  evAt?: number;
  evMsg?: string;
  syncStatus: 'idle' | 'syncing' | 'ok' | 'error';
  syncAt?: number;
  syncMsg?: string;
}

function loadEvents(): { events: ExtEvent[]; at?: number } {
  try {
    const j = JSON.parse(get(EV_KEY) ?? 'null');
    if (j && Array.isArray(j.events)) return j;
  } catch { /* ignore */ }
  return { events: [] };
}

const cached = loadEvents();
export const bridge = createStore<BridgeState>({
  connected: !!get(URL_KEY) && !!get(KEY_KEY),
  events: cached.events,
  calendars: (() => { try { return JSON.parse(get(CALS_KEY) ?? '[]'); } catch { return []; } })(),
  evStatus: 'idle',
  evAt: cached.at,
  syncStatus: 'idle',
  syncAt: Number(get(SYNC_AT)) || undefined,
});

/** מפתח סודי: נוצר פעם אחת ונשמר מקומית. הוא מוטמע בקוד שמעתיקים ל-Apps Script */
export function ensureKey(): string {
  let k = get(KEY_KEY);
  if (!k) {
    const a = new Uint8Array(20);
    crypto.getRandomValues(a);
    k = [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
    put(KEY_KEY, k);
  }
  return k;
}

export const scriptSource = () => scriptTemplate.replace('__KEY__', ensureKey());

export const bridgeUrl = () => get(URL_KEY) ?? '';

async function callGet(url: string, key: string, params: Record<string, string>) {
  const q = new URLSearchParams({ key, ...params }).toString();
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}${q}`, { redirect: 'follow', cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** בודק שהכתובת והמפתח עובדים מול ה-Script */
export async function pingBridge(url: string, key?: string): Promise<{ ok: boolean; msg?: string; calendars?: string[] }> {
  try {
    const j = await callGet(url.trim(), key ?? ensureKey(), { action: 'ping' });
    if (j?.ok) return { ok: true, calendars: j.calendars };
    if (j?.error === 'unauthorized') return { ok: false, msg: 'המפתח בקוד לא תואם. העתק שוב את הקוד מהאפליקציה, פרסם גרסה חדשה (Deploy ← Manage deployments ← Edit ← New version) ונסה שוב' };
    return { ok: false, msg: String(j?.error ?? 'תשובה לא צפויה') };
  } catch {
    return { ok: false, msg: 'לא הצלחתי להתחבר לכתובת. ודא שהפרסום הוא Web app עם גישה "Anyone", ושהעתקת את הכתובת שנגמרת ב-/exec' };
  }
}

export function connectBridge(url: string, calendars: string[] = [], key?: string) {
  if (key) put(KEY_KEY, key);
  put(URL_KEY, url.trim());
  put(CALS_KEY, JSON.stringify(calendars));
  bridge.set((s) => ({ ...s, connected: true, calendars }));
  void refreshEvents(true);
  void syncWorkouts(true);
}

export function disconnectBridge() {
  put(URL_KEY, null);
  put(KEY_KEY, null);
  put(EV_KEY, null);
  put(HASH_KEY, null);
  put(CALS_KEY, null);
  bridge.set({ connected: false, events: [], calendars: [], evStatus: 'idle', syncStatus: 'idle' });
}

let loading = false;
/** מביא את אירועי היומן: שבועיים אחורה ועד חודשיים קדימה */
export async function refreshEvents(force = false) {
  const url = bridgeUrl();
  const key = get(KEY_KEY);
  if (!url || !key || loading) return;
  const st = bridge.get();
  if (!force && st.evAt && Date.now() - st.evAt < 5 * 60_000) return;
  loading = true;
  bridge.set((s) => ({ ...s, evStatus: 'loading', evMsg: undefined }));
  try {
    const today = todayKey(store.get().settings.resetHour);
    const from = addDays(today, -14);
    const to = addDays(today, 60);
    const [j, pj] = await Promise.all([
      callGet(url, key, { action: 'events', from, to }),
      callGet(url, key, { action: 'ping' }).catch(() => null),
    ]);
    const calendars: string[] = Array.isArray(pj?.calendars) ? pj.calendars : bridge.get().calendars;
    put(CALS_KEY, JSON.stringify(calendars));
    if (!j?.ok) throw new Error(j?.error === 'unauthorized' ? 'המפתח לא תואם' : String(j?.error ?? 'שגיאה'));
    const at = Date.now();
    put(EV_KEY, JSON.stringify({ events: j.events, at }));
    bridge.set((s) => ({ ...s, events: j.events, calendars, range: { from, to }, evStatus: 'ok', evAt: at }));
  } catch (e) {
    bridge.set((s) => ({ ...s, evStatus: 'error', evMsg: e instanceof TypeError ? 'אין חיבור לאינטרנט' : (e as Error).message }));
  } finally {
    loading = false;
  }
}

let syncing = false;
/** כותב את האימונים ליומן "workOut" ב-Google (יוצר, מעדכן ומוחק לפי הצורך) */
export async function syncWorkouts(force = false) {
  const url = bridgeUrl();
  const key = get(KEY_KEY);
  if (!url || !key || syncing) return;
  const s = store.get();
  const today = todayKey(s.settings.resetHour);
  const from = addDays(today, -1);
  const to = addDays(today, 60);
  const workouts = s.workouts
    .filter((w) => w.date >= from && w.date <= to)
    .map((w) => ({ id: w.id, title: w.title, date: w.date, time: w.time, status: w.status, durationMin: WORKOUT_MIN }))
    .sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
  const payload = { key, action: 'sync', from, to, alertMin: s.settings.cal.alertMin, workouts };
  const hash = JSON.stringify([workouts, payload.alertMin, from]);
  if (!force && get(HASH_KEY) === hash) return;

  syncing = true;
  bridge.set((x) => ({ ...x, syncStatus: 'syncing', syncMsg: undefined }));
  try {
    const r = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j?.ok) throw new Error(String(j?.error ?? 'שגיאה'));
    const at = Date.now();
    put(HASH_KEY, hash);
    put(SYNC_AT, String(at));
    bridge.set((x) => ({ ...x, syncStatus: 'ok', syncAt: at }));
  } catch (e) {
    bridge.set((x) => ({ ...x, syncStatus: 'error', syncMsg: e instanceof TypeError ? 'אין חיבור לאינטרנט' : (e as Error).message }));
  } finally {
    syncing = false;
  }
}

/** סנכרון אוטומטי: שינוי באימונים ← כתיבה ליומן; חזרה לאפליקציה ← רענון אירועים */
export function startBridge() {
  let t: number | undefined;
  let last = '';
  store.subscribe(() => {
    if (!bridge.get().connected) return;
    const s = store.get();
    const key = JSON.stringify([s.workouts, s.settings.cal.alertMin]);
    if (key === last) return;
    last = key;
    clearTimeout(t);
    t = window.setTimeout(() => void syncWorkouts(), 4000);
  });
  const kick = () => {
    if (document.visibilityState !== 'visible' || !bridge.get().connected) return;
    void refreshEvents();
    void syncWorkouts();
  };
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('online', kick);
  window.setInterval(kick, 10 * 60_000);
  kick();
}
