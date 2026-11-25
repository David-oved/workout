import { createStore } from '../core/store';
import { actions, readGone } from '../core/actions';
import { PUSH_URL } from '../push/config';
import { toast } from '../ui/ui';
import { store } from '../core/state';
import { applyServerResult, kickInbox, prepareInbox } from './prepare';
import { clearServerConfig, startCfgSync, syncServerConfig } from './cfg';
import { startStatusSync } from './status';
import { set } from 'idb-keyval';
import { fileToJpeg } from '../ai/image';
import type { AiItem } from '../ai/pure';
import type { InboxItem } from '../core/types';

/**
 * הקיצור (טקסט או תמונה) שולח ל-Worker, והאפליקציה מושכת ומציגה כרטיסים לאישור.
 * כשהמפתח שמור בשרת, השרת מנתח כל פריט לפי הסדר גם כשהאפליקציה סגורה, ומנסה שוב לבד אחרי תקלה.
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
export const statusUrl = () => `${PUSH_URL}/siri/${get() ?? ''}/status`;
export const photoUrl = () => `${PUSH_URL}/siri/${get() ?? ''}/photo`;
const base = () => `${PUSH_URL}/siri/${get() ?? ''}`;

export function enableSiri() {
  if (!PUSH_URL) { toast('השרת לא מוגדר'); return; }
  if (!get()) put(newToken());
  siri.set((s) => ({ ...s, on: true, msg: '' }));
  void syncServerConfig(true);
}
export function disableSiri() {
  void clearServerConfig();
  put(null);
  siri.set((s) => ({ ...s, on: false, msg: '' }));
}
export function rotateSiri() {
  void clearServerConfig(); // הכתובת הישנה מפסיקה לעבוד, והמפתח נמחק ממנה
  put(newToken());
  siri.set((s) => ({ ...s, on: true, msg: 'נוצרה כתובת חדשה. עדכן אותה בקיצור.' }));
  void syncServerConfig(true);
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

interface SrvItem { id: string; text: string; ts: number; img?: string; st?: 'q' | 'w' | 'ok' | 'r' | 'fail'; n?: number; at?: number; err?: string; res?: { items: AiItem[]; reply?: string } }

let syncing = false;
let failures = 0; // כמה סנכרונים רצופים נכשלו (רשת חלשה): מאריך את ההמתנה בין ניסיונות
const TAKEOVER_MS = 10 * 60_000; // פריט שהשרת לא סיים תוך 10 דקות: האפליקציה משתלטת

/** מוריד תמונה מהשרת, מכווץ ושומר במכשיר. זורק שגיאה אם לא הצליח (ננסה שוב בסנכרון הבא) */
async function fetchImage(x: SrvItem): Promise<{ hasImg: true; thumb: string }> {
  const ir = await fetch(`${base()}/img/${x.id}`, { cache: 'no-store' });
  if (!ir.ok) throw new Error(String(ir.status));
  const file = new File([await ir.blob()], 'siri.jpg', { type: x.img });
  const [full, thumb] = await Promise.all([fileToJpeg(file, 1280), fileToJpeg(file, 140)]);
  await set('wo:inbox-img:' + x.id, { data: full.data, mime: full.mime });
  return { hasImg: true, thumb: thumb.url };
}

export async function syncInbox() {
  if (syncing || !get() || !PUSH_URL) return;
  syncing = true;
  try {
    const r = await fetch(`${base()}/list`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { items?: SrvItem[]; srv?: boolean };
    const raws = (j.items ?? []).filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string').sort((a, b) => a.ts - b.ts);
    failures = 0;
    const gone = readGone();
    const ack: string[] = [];
    const local = (id: string) => store.get().inbox.find((i) => i.id === id);

    for (const x of raws) {
      if (gone.has(x.id)) { ack.push(x.id); continue; }
      let it = local(x.id);
      if (!it) {
        // פריט חדש: קודם התמונה (אם יש) נשמרת במכשיר, ורק אז הוא נכנס. תמונה שלא ירדה תנסה שוב בסנכרון הבא
        let extra: Partial<InboxItem> = {};
        if (x.img) { try { extra = await fetchImage(x); } catch { continue; } }
        actions.addInbox([{ id: x.id, text: x.text, ts: x.ts, ...extra }]);
        it = local(x.id);
        if (!it) continue;
      }
      const st = x.st ?? 'q';
      if (it.status === 'ready') { ack.push(x.id); continue; }
      if (!j.srv) {
        // אין ניתוח בשרת: האפליקציה מנתחת בתור, והפריט נמחק מהשרת
        ack.push(x.id);
        if (!it.status) prepareInbox(it);
      } else if (st === 'ok' && x.res) {
        applyServerResult(it, x.res);
        ack.push(x.id);
      } else if (st === 'fail' || Date.now() - x.ts > TAKEOVER_MS) {
        // השרת נכשל או לא סיים: האפליקציה משתלטת (עובדת גם בלי השרת), והפריט נמחק משם
        ack.push(x.id);
        actions.patchInbox(it.id, { status: undefined, srv: false, tries: 0, failWhy: undefined });
        const cur = local(x.id);
        if (cur) prepareInbox(cur);
      } else {
        // ממתין בשרת: מציגים את המצב ובודקים שוב עוד רגע
        actions.patchInbox(it.id, { status: 'queued', srv: true, tries: x.n, retryAt: x.st === 'r' ? x.at : undefined, failWhy: x.st === 'r' ? x.err : undefined });
      }
    }
    // פריט שמסומן כממתין בשרת אבל נעלם משם (נמחק או הסתיים): האפליקציה משלימה בעצמה
    const present = new Set(raws.map((x) => x.id));
    for (const it of store.get().inbox) {
      if (it.srv && it.status === 'queued' && !present.has(it.id)) {
        actions.patchInbox(it.id, { status: undefined, srv: false, tries: 0, failWhy: undefined });
        const cur = local(it.id);
        if (cur) prepareInbox(cur);
      }
    }
    if (ack.length) await fetch(`${base()}/ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ack }) });
  } catch {
    failures++; // אין רשת או רשת חלשה: ננסה שוב, עם המתנה שגדלה
  } finally { syncing = false; }
}

/** כמה זמן עד הסנכרון הבא: מהר כשיש מה לחכות לו, ומאט כשהרשת חלשה */
function nextDelay(): number {
  if (failures) return Math.min(120_000, 10_000 * 2 ** Math.min(failures, 4));
  const waiting = store.get().inbox.some((i) => i.status === 'queued' || i.status === 'busy' || !i.status);
  return waiting ? 8_000 : 45_000;
}

export function startSiri() {
  void syncInbox();
  startCfgSync();
  startStatusSync();
  // פריטים שהניתוח המקומי שלהם נקטע (האפליקציה נסגרה באמצע) או שהמתינו להשהיה: ממשיכים בסדר הנכון
  for (const it of [...store.get().inbox].sort((a, b) => a.ts - b.ts)) if (!it.status || it.status === 'busy' || (it.status === 'queued' && !it.srv)) prepareInbox(it);
  const wake = () => { if (document.visibilityState === 'visible') { failures = 0; void syncInbox(); kickInbox(); } };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  const tick = () => {
    if (document.visibilityState === 'visible') void syncInbox();
    setTimeout(tick, nextDelay());
  };
  setTimeout(tick, nextDelay());
}
