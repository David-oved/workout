import { createStore } from '../core/store';
import { store } from '../core/state';
import { buildSchedule, reminderKey } from '../core/reminders';
import { PUSH_URL } from './config';

/**
 * התראות Push אמיתיות: האפליקציה נרשמת ל-Worker ב-Cloudflare ושולחת לו את לוח התזכורות הקרוב.
 * ה-Worker שולח Push בשעה המדויקת, וה-Service Worker מציג אותה גם כשהאפליקציה סגורה.
 */
const ID_KEY = 'wo:push-id';
const HASH_KEY = 'wo:push-hash';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

export type Support = 'ok' | 'ios-install' | 'unsupported' | 'nourl';
export interface PushState { support: Support; perm: NotificationPermission | 'none'; on: boolean; busy: boolean; msg: string }

function detect(): Support {
  if (!PUSH_URL) return 'nourl';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  return 'ok';
}

export const push = createStore<PushState>({
  support: detect(),
  perm: typeof Notification === 'undefined' ? 'none' : Notification.permission,
  on: !!get(ID_KEY),
  busy: false,
  msg: '',
});
export const pushActive = () => !!get(ID_KEY);

const b64ToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function post(path: string, body: unknown) {
  const r = await fetch(PUSH_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const set = (p: Partial<PushState>) => push.set((s) => ({ ...s, ...p }));

export async function enablePush() {
  if (push.get().busy) return;
  set({ busy: true, msg: '' });
  try {
    if (detect() !== 'ok') throw new Error('המכשיר או המצב הנוכחי לא תומכים בהתראות');
    const perm = await Notification.requestPermission();
    set({ perm });
    if (perm !== 'granted') throw new Error('ההתראות חסומות. אפשר לאשר אותן בהגדרות של iOS ← workOut ← התראות');
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error('ה-Service Worker עוד לא פעיל. סגור ופתח את האפליקציה ונסה שוב');
    const cfg = await (await fetch(PUSH_URL + '/config')).json();
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.pub) }));
    const j = await post('/subscribe', { sub: sub.toJSON(), schedule: buildSchedule(store.get()) });
    if (!j?.ok) throw new Error(String(j?.error ?? 'הרישום נכשל'));
    put(ID_KEY, j.id);
    put(HASH_KEY, null);
    await (await caches.open('wo-push')).put('/cfg', new Response(JSON.stringify({ url: PUSH_URL, id: j.id })));
    set({ on: true, msg: 'ההתראות פעילות' });
  } catch (e) {
    set({ msg: (e as Error).message || 'משהו השתבש' });
  } finally {
    set({ busy: false });
  }
}

export async function disablePush() {
  set({ busy: true, msg: '' });
  try {
    const id = get(ID_KEY);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
    if (id && PUSH_URL) await post('/unsubscribe', { id }).catch(() => undefined);
    await caches.delete('wo-push');
  } catch { /* ignore */ }
  put(ID_KEY, null);
  put(HASH_KEY, null);
  set({ on: false, busy: false, msg: 'ההתראות כבויות' });
}

export async function testPush() {
  const id = get(ID_KEY);
  if (!id) return;
  set({ busy: true, msg: '' });
  try {
    const j = await post('/test', { id });
    set({ msg: j?.ok ? 'נשלחה התראת בדיקה. היא אמורה להגיע תוך שניות' : `השרת לא הצליח לשלוח (${j?.status ?? j?.error ?? 'שגיאה'})` });
    if (j?.error === 'unknown device') { put(ID_KEY, null); set({ on: false }); }
  } catch { set({ msg: 'אין חיבור לשרת' }); }
  set({ busy: false });
}

let syncing = false;
/** שולח לשרת את לוח התזכורות הקרוב (רק אם השתנה) */
export async function syncPush(force = false) {
  const id = get(ID_KEY);
  if (!id || !PUSH_URL || syncing) return;
  const schedule = buildSchedule(store.get());
  const hash = JSON.stringify(schedule);
  if (!force && get(HASH_KEY) === hash) return;
  syncing = true;
  try {
    const j = await post('/schedule', { id, schedule });
    if (j?.ok) put(HASH_KEY, hash);
    else if (j?.error === 'unknown device') { put(ID_KEY, null); set({ on: false, msg: 'המכשיר לא רשום בשרת. הפעל מחדש' }); }
  } catch { /* ננסה שוב בפעם הבאה */ } finally { syncing = false; }
}

export function startPush() {
  let t: number | undefined;
  let last = '';
  store.subscribe(() => {
    if (!pushActive()) return;
    const s = store.get();
    const key = JSON.stringify([s.workouts, s.settings.cal.alertMin, reminderKey(s)]);
    if (key === last) return;
    last = key;
    clearTimeout(t);
    t = window.setTimeout(() => void syncPush(), 4000);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncPush(); });
  void syncPush();
}
