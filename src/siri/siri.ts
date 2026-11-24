import { createStore } from '../core/store';
import { actions } from '../core/actions';
import { PUSH_URL } from '../push/config';
import { toast } from '../ui/ui';
import { store } from '../core/state';
import { prepareInbox } from './prepare';
import { set } from 'idb-keyval';
import { fileToJpeg } from '../ai/image';
import type { InboxItem } from '../core/types';

/**
 * Siri / אפליקציית קיצורים: הקיצור שולח טקסט מוכתב ל-Worker, והאפליקציה מושכת אותו ומציגה כרטיס לאישור.
 * ה-token הוא סוד אקראי שנשמר רק במכשיר (לא בגיבוי).
 */
const KEY = 'wo:siri-token';
const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const put = (v: string | null) => { try { v === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch { /* ignore */ } };

const newToken = () => {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const siri = createStore({ on: !!get(), busy: false, msg: '' });

export const siriUrl = () => `${PUSH_URL}/siri/${get() ?? ''}/add`;
export const photoUrl = () => `${PUSH_URL}/siri/${get() ?? ''}/photo`;
const base = () => `${PUSH_URL}/siri/${get() ?? ''}`;

export function enableSiri() {
  if (!PUSH_URL) { toast('השרת לא מוגדר'); return; }
  if (!get()) put(newToken());
  siri.set((s) => ({ ...s, on: true, msg: '' }));
}
export function disableSiri() {
  put(null);
  siri.set((s) => ({ ...s, on: false, msg: '' }));
}
export function rotateSiri() {
  put(newToken());
  siri.set((s) => ({ ...s, on: true, msg: 'נוצרה כתובת חדשה. עדכן אותה בקיצור.' }));
}

/** שולח טקסט בדיקה כמו שהקיצור היה שולח, ואז מושך */
export async function testSiri() {
  siri.set((s) => ({ ...s, busy: true, msg: '' }));
  try {
    const r = await fetch(siriUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'בדיקה: שתי ביצים ופיתה עם גבינה' }) });
    if (!r.ok) throw new Error(String(r.status));
    await syncInbox();
    siri.set((s) => ({ ...s, busy: false, msg: 'נשלח. הכרטיס מופיע במסך היום.' }));
  } catch {
    siri.set((s) => ({ ...s, busy: false, msg: 'השליחה נכשלה. בדוק חיבור לאינטרנט.' }));
  }
}

let syncing = false;
export async function syncInbox() {
  if (syncing || !get() || !PUSH_URL) return;
  syncing = true;
  try {
    const r = await fetch(`${base()}/list`, { cache: 'no-store' });
    if (!r.ok) return;
    const j = (await r.json()) as { items?: { id: string; text: string; ts: number; img?: string }[] };
    const raw = (j.items ?? []).filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string');
    if (!raw.length) return;
    // תמונות: מורידים, מכווצים ושומרים במכשיר (בנפרד מהנתונים), ורק אז מאשרים. תמונה שלא ירדה תנסה שוב בפעם הבאה
    const items: InboxItem[] = [];
    for (const x of raw) {
      if (!x.img) { items.push({ id: x.id, text: x.text, ts: x.ts }); continue; }
      try {
        const ir = await fetch(`${base()}/img/${x.id}`, { cache: 'no-store' });
        if (!ir.ok) throw new Error(String(ir.status));
        const blob = await ir.blob();
        const file = new File([blob], 'siri.jpg', { type: x.img });
        const [full, thumb] = await Promise.all([fileToJpeg(file, 1280), fileToJpeg(file, 140)]);
        await set('wo:inbox-img:' + x.id, { data: full.data, mime: full.mime });
        items.push({ id: x.id, text: x.text, ts: x.ts, hasImg: true, thumb: thumb.url });
      } catch { /* נשאר בשרת ויורד בפעם הבאה */ }
    }
    if (!items.length) return;
    actions.addInbox(items);
    for (const it of items) { const cur = store.get().inbox.find((x) => x.id === it.id); if (cur && !cur.status) void prepareInbox(cur); }
    await fetch(`${base()}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: items.map((x) => x.id) }) });
  } catch { /* אין רשת: ננסה שוב */ } finally { syncing = false; }
}

export function startSiri() {
  void syncInbox();
  // ארוחות שהניתוח שלהן נקטע (האפליקציה נסגרה באמצע): ממשיכים
  for (const it of store.get().inbox) if (!it.status || it.status === 'busy') void prepareInbox(it);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncInbox(); });
  setInterval(() => { if (document.visibilityState === 'visible') void syncInbox(); }, 45_000);
}
