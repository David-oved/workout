import { createStore } from './store';
import { store, update } from './state';
import { buildIcs } from './ics';
import { addDays, todayKey } from './dates';

/**
 * פיד יומן: האפליקציה בונה קובץ ICS של האימונים ודוחפת אותו לריפו ציבורי קטן ב-GitHub (Pages).
 * יומן אפל (או Google) נרשם לקישור פעם אחת ומתעדכן לבד, כולל התראות לפני כל אימון.
 * הטוקן של GitHub נשמר רק ב-localStorage של המכשיר, מחוץ לנתוני האפליקציה, כך שלא נכנס לגיבויים.
 */
export const CAL_REPO = 'David-oved/workout-calendar';
export const PAGES_BASE = 'https://david-oved.github.io/workout-calendar/';
const TOKEN_KEY = 'wo:gh-token';
const HASH_KEY = 'wo:cal-hash';
const AT_KEY = 'wo:cal-at';

export interface SyncState { status: 'idle' | 'syncing' | 'ok' | 'error'; at?: number; msg?: string }
export const feedState = createStore<SyncState>({
  status: 'idle',
  at: Number(safeGet(AT_KEY)) || undefined,
});

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null) {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ }
}

export const getToken = () => safeGet(TOKEN_KEY) ?? '';
export const hasToken = () => !!getToken();
export const feedUrl = (feedId: string) => (feedId ? `${PAGES_BASE}cal/${feedId}.ics` : '');
export const webcalUrl = (feedId: string) => feedUrl(feedId).replace(/^https:/, 'webcal:');

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

function b64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** בודק שהטוקן תקין ושיש לו הרשאת כתיבה לריפו של הפיד */
export async function verifyToken(token: string): Promise<{ ok: boolean; msg?: string }> {
  try {
    const r = await fetch(`https://api.github.com/repos/${CAL_REPO}`, { headers: headers(token) });
    if (r.status === 401) return { ok: false, msg: 'הטוקן לא תקין או שפג תוקפו' };
    if (r.status === 404) return { ok: false, msg: 'אין לטוקן גישה לריפו workout-calendar' };
    if (!r.ok) return { ok: false, msg: `שגיאה מ-GitHub (${r.status})` };
    const j = await r.json();
    if (!j?.permissions?.push) return { ok: false, msg: 'לטוקן חסרה הרשאת Contents: Read and write' };
    return { ok: true };
  } catch {
    return { ok: false, msg: 'אין חיבור לאינטרנט' };
  }
}

export function saveToken(token: string) {
  safeSet(TOKEN_KEY, token.trim());
}

function randomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** מפעיל את הפיד: יוצר כתובת אקראית (אם אין) ומפרסם */
export async function enableFeed() {
  update((s) => ({
    ...s,
    settings: { ...s.settings, cal: { ...s.settings.cal, enabled: true, feedId: s.settings.cal.feedId || randomId() } },
  }));
  await syncFeed(true);
}

export function disconnectFeed() {
  safeSet(TOKEN_KEY, null);
  safeSet(HASH_KEY, null);
  update((s) => ({ ...s, settings: { ...s.settings, cal: { ...s.settings.cal, enabled: false } } }));
  feedState.set({ status: 'idle', at: feedState.get().at });
}

let running = false;
export async function syncFeed(force = false) {
  const s = store.get();
  const c = s.settings.cal;
  const token = getToken();
  if (!c.enabled || !c.feedId || !token || running) return;

  const today = todayKey(s.settings.resetHour);
  const from = addDays(today, -14);
  const to = addDays(today, 90);
  const body = buildIcs(
    s.workouts.filter((w) => w.date >= from && w.date <= to),
    { alertMin: c.alertMin, durationMin: 90, name: 'workOut' },
  );
  const hash = await sha256(body + c.feedId);
  if (!force && safeGet(HASH_KEY) === hash) return;

  running = true;
  feedState.set((x) => ({ ...x, status: 'syncing', msg: undefined }));
  try {
    const url = `https://api.github.com/repos/${CAL_REPO}/contents/cal/${c.feedId}.ics`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let sha: string | undefined;
      const g = await fetch(`${url}?ref=main&t=${Date.now()}`, { headers: headers(token), cache: 'no-store' });
      if (g.ok) sha = (await g.json()).sha;
      else if (g.status !== 404) throw new Error(g.status === 401 ? 'הטוקן לא תקין' : `GitHub ${g.status}`);

      const p = await fetch(url, {
        method: 'PUT',
        headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'update feed', content: b64(body), sha, branch: 'main' }),
      });
      if (p.ok) {
        const at = Date.now();
        safeSet(HASH_KEY, hash);
        safeSet(AT_KEY, String(at));
        feedState.set({ status: 'ok', at });
        return;
      }
      if (p.status !== 409 && p.status !== 422) throw new Error(p.status === 401 ? 'הטוקן לא תקין' : `GitHub ${p.status}`);
    }
    throw new Error('העדכון נדחה, נסה שוב');
  } catch (e) {
    feedState.set((x) => ({ ...x, status: 'error', msg: e instanceof TypeError ? 'אין חיבור לאינטרנט' : (e as Error).message }));
  } finally {
    running = false;
  }
}

/** סנכרון אוטומטי: אחרי כל שינוי באימונים או בהגדרות היומן (עם השהיה), וגם בחזרה לאפליקציה */
export function startFeedSync() {
  let t: number | undefined;
  let lastKey = '';
  store.subscribe(() => {
    const s = store.get();
    const key = JSON.stringify([s.workouts, s.settings.cal]);
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(t);
    t = window.setTimeout(() => void syncFeed(), 4000);
  });
  const kick = () => document.visibilityState === 'visible' && void syncFeed();
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('online', () => void syncFeed());
  void syncFeed();
}
