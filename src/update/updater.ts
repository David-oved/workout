import { registerSW } from 'virtual:pwa-register';
import { createStore } from '../core/store';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

export const APP_VERSION = __APP_VERSION__;
export const BUILD_ID = __BUILD_ID__;

export interface Remote { version: string; buildId: string; builtAt: string; notes: string[] }
export interface UState {
  status: 'idle' | 'checking' | 'latest' | 'available' | 'applying' | 'error';
  remote?: Remote;
  lastCheck?: number;
  dismissed?: string; // buildId שהמשתמש דחה
}

export const updater = createStore<UState>({ status: 'idle' });

const BASE = import.meta.env.BASE_URL;
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
let reg: ServiceWorkerRegistration | undefined;
let needRefresh = false;

export function initUpdater() {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      updater.set((s) => ({ ...s, status: 'available' }));
    },
    onRegisteredSW(_url, r) {
      reg = r;
    },
  });
  void checkForUpdate();
  // בודקים בכל חזרה לאפליקציה (לפחות 2 דקות בין בדיקות) ובכל חצי שעה
  document.addEventListener('visibilitychange', () => {
    const last = updater.get().lastCheck ?? 0;
    if (document.visibilityState === 'visible' && Date.now() - last > 120_000) void checkForUpdate();
  });
  window.setInterval(() => void checkForUpdate(), 30 * 60_000);
}

/** בודק מול השרת (version.json, תמיד בלי מטמון) אם יש גרסה חדשה מזו שרצה עכשיו */
export async function checkForUpdate() {
  updater.set((s) => ({ ...s, status: 'checking' }));
  try {
    const res = await fetch(`${BASE}version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const remote = (await res.json()) as Remote;
    const newer = remote.buildId !== BUILD_ID;
    updater.set((s) => ({ ...s, remote, lastCheck: Date.now(), status: newer ? 'available' : 'latest' }));
    if (newer) void reg?.update().catch(() => {});
  } catch {
    updater.set((s) => ({ ...s, lastCheck: Date.now(), status: s.status === 'available' ? 'available' : 'error' }));
  }
}

/** מחיל את העדכון. אם ה-Service Worker החדש עוד לא מוכן, מנקה מטמון וטוען מחדש. */
export async function applyUpdate() {
  updater.set((s) => ({ ...s, status: 'applying' }));
  try { await reg?.update(); } catch { /* offline או שגיאה, ממשיכים */ }
  await new Promise((r) => setTimeout(r, 600));
  if (needRefresh && updateSW) {
    await updateSW(true);
    return;
  }
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* ignore */ }
  location.reload();
}

export const dismissUpdate = () =>
  updater.set((s) => ({ ...s, dismissed: s.remote?.buildId, status: s.status === 'available' ? 'latest' : s.status }));
