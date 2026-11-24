import { get } from 'idb-keyval';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dateKey, todayKey, uid } from '../core/dates';
import { parseMeal } from '../core/parse';
import { loadDb } from '../data/foodDb';
import { aiState, chatTurn } from '../ai/gemini';
import { PHOTO_HINT, sentAtBlock, type AiItem } from '../ai/pure';
import { buildAppData } from '../ai/context';
import { foodHints } from '../ai/hints';
import { sendMessage } from '../ai/chat';
import { macrosOf, makeEntries, tray, trayAddDish, trayAddFood, trayClear, type TItem } from '../ui/tray';
import { guessSlot, openAdd, toast } from '../ui/ui';
import type { InboxCard, InboxItem } from '../core/types';

/**
 * מכין כרטיס ארוחה מוכן מטקסט או תמונה שהגיעו מהקיצור, ברקע, כדי שתפתח את האפליקציה ותראה אותו מוכן.
 * כשהשרת מנתח (האפליקציה הייתה סגורה) התוצאה מגיעה מוכנה; כאן הניתוח המקומי הוא גיבוי וגם הדרך כשאין שרת.
 * הניתוח המקומי רץ בתור: פריט אחד בכל פעם לפי סדר ההגעה, ובתקלה זמנית (רשת, מכסה) מנסה שוב לבד עם השהיה גדלה.
 */
const MAX_TRIES = 5;
const BACKOFF_S = [15, 45, 120, 300, 600];

function viaTray(fn: () => void): TItem[] {
  const keep = tray.get();
  trayClear();
  try { fn(); return [...tray.get().items]; } finally { tray.set(keep); }
}

export function cardOf(items: TItem[], src: 'db' | 'ai'): InboxCard {
  const tot = { k: 0, p: 0, c: 0, f: 0 };
  const lines = items.map((it) => {
    const m = macrosOf(it);
    tot.k += m.k; tot.p += m.p; tot.c += m.c; tot.f += m.f;
    const g = Math.round(it.amount);
    const label = it.unit === 'p' ? (it.amount === 1 ? 'מנה' : `${it.amount} מנות`) : it.unitG ? `${Math.round((it.amount / it.unitG) * 10) / 10} יח׳ · ${g} ג׳` : `${g} ג׳`;
    return { name: it.name, label, k: m.k };
  });
  return { src, items, lines, k: Math.round(tot.k), p: Math.round(tot.p), c: Math.round(tot.c), f: Math.round(tot.f) };
}

const patch = (id: string, p: Partial<InboxItem>) => actions.patchInbox(id, p);

const trayOf = (list: AiItem[]): TItem[] =>
  list.map((i) => ({
    id: uid(), name: i.name, unit: 'g', amount: i.grams, step: 10, base: 100,
    per: { k: i.kcal100, p: i.p100, c: i.c100, f: i.f100 }, est: i.source === 'estimate', src: 'm',
    unitG: i.unitGrams, portions: i.unitGrams ? [{ l: 'יחידה', g: i.unitGrams }] : undefined,
  }));

/** תוצאה שהשרת הכין: כרטיס מוכן, או הסבר של ה-AI למה אי אפשר */
const validSlot = (id?: string) => (id && store.get().settings.slots.some((x) => x.id === id) ? id : undefined);

export function applyServerResult(it: InboxItem, res: { items: AiItem[]; reply?: string; slot?: string }) {
  if (res.items?.length) patch(it.id, { slot: it.slot ?? validSlot(res.slot), status: 'ready', srv: false, tries: undefined, retryAt: undefined, failWhy: undefined, card: { ...cardOf(trayOf(res.items), 'ai'), note: res.reply } });
  else patch(it.id, { status: 'fail', srv: false, tries: undefined, retryAt: undefined, failWhy: res.reply || (it.hasImg ? 'לא הצלחתי לזהות מה בתמונה' : 'לא הצלחתי להבין לבד') });
}

/** תקלה זמנית (אין רשת, הגבלת קצב, שגיאת שרת, איטי מדי): שווה לנסות שוב */
function transient(e: unknown): boolean {
  const x = e as { status?: number; message?: string; quota?: unknown };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (e instanceof TypeError || x.quota) return true;
  if (x.status === 0 || x.status === 429 || (x.status !== undefined && x.status >= 500)) return true;
  return /איטי|חיבור|רשת|timeout|network|fetch/i.test(x.message ?? '');
}

type Out = 'done' | { retry: string };

async function attemptImage(it: InboxItem): Promise<Out> {
  const img = await get<{ data: string; mime: string }>('wo:inbox-img:' + it.id).catch(() => undefined);
  if (!img) { patch(it.id, { status: 'fail', failWhy: 'התמונה לא נשמרה במכשיר, אפשר לשלוח שוב' }); return 'done'; }
  if (!aiState.get().configured) { patch(it.id, { status: 'fail', failWhy: 'ניתוח תמונה דורש חיבור AI (הגדרות ← AI תזונה)' }); return 'done'; }
  const today = todayKey(store.get().settings.resetHour);
  const hints = it.text ? await foodHints(it.text).catch(() => '') : '';
  const ask = it.text || 'זו תמונה של מה שאכלתי. זהה מה יש בה והערך כמויות.';
  const text = `${ask}\n\n${PHOTO_HINT}${hints ? `\n\n${hints}` : ''}\n\n${sentAtBlock(it.ts)}\n\n${buildAppData(today)}`;
  try {
    const res = await chatTurn([{ role: 'user', text, images: [img] }], {});
    applyServerResult(it, { items: res.items, reply: res.reply, slot: res.slot });
    return 'done';
  } catch (e) {
    if (transient(e)) return { retry: (e as Error).message || 'תקלה זמנית' };
    patch(it.id, { status: 'fail', failWhy: (e as Error).message || 'הניתוח נכשל' });
    return 'done';
  }
}

async function attemptText(it: InboxItem, last: boolean): Promise<Out> {
  // 1. עם AI מחובר: הוא מנתח בלי שיחה, כרטיס אחד מוכן (מדויק יותר מהחיפוש במאגר)
  if (aiState.get().configured) {
    try {
      const today = todayKey(store.get().settings.resetHour);
      const hints = await foodHints(it.text).catch(() => '');
      const text = `${it.text}${hints ? `\n\n${hints}` : ''}\n\n${sentAtBlock(it.ts)}\n\n${buildAppData(today)}`;
      const res = await chatTurn([{ role: 'user', text }], {});
      if (res.items.length) {
        patch(it.id, { slot: it.slot ?? validSlot(res.slot), status: 'ready', srv: false, tries: undefined, retryAt: undefined, failWhy: undefined, card: { ...cardOf(trayOf(res.items), 'ai'), note: res.reply } });
        return 'done';
      }
    } catch (e) {
      // תקלה זמנית: מנסים שוב את ה-AI (המאגר רק כשנגמרו הניסיונות)
      if (transient(e) && !last) return { retry: (e as Error).message || 'תקלה זמנית' };
    }
  }
  // 2. בלי AI (או שנכשל): מהמאגר, אם כל מה שנאמר זוהה
  const s = store.get();
  const parsed = parseMeal(it.text, s);
  if (parsed.length && parsed.every((p) => p.food || p.dish)) {
    const items = viaTray(() => {
      for (const p of parsed) {
        if (p.dish) { trayAddDish(p.dish, p.amount); continue; }
        const f = p.food ?? p.alts[0];
        if (f) trayAddFood(f, p.amount);
      }
    });
    if (items.length) { patch(it.id, { status: 'ready', srv: false, tries: undefined, retryAt: undefined, failWhy: undefined, card: cardOf(items, 'db') }); return 'done'; }
  }
  patch(it.id, { status: 'fail', failWhy: undefined });
  return 'done';
}

/* ---------------- תור מקומי ---------------- */
const waiting: string[] = [];
let pumping = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** מכניס פריט לתור הניתוח המקומי (לפי סדר ההגעה) */
export function prepareInbox(it: InboxItem) {
  clearTimeout(timers.get(it.id));
  timers.delete(it.id);
  if (!waiting.includes(it.id)) waiting.push(it.id);
  waiting.sort((a, b) => (store.get().inbox.find((x) => x.id === a)?.ts ?? 0) - (store.get().inbox.find((x) => x.id === b)?.ts ?? 0));
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const id = waiting.shift();
      if (!id) break;
      const it = store.get().inbox.find((x) => x.id === id);
      if (!it || it.status === 'ready') continue;
      await work(it);
    }
  } finally { pumping = false; }
}

async function work(it: InboxItem) {
  const tries = it.tries ?? 0;
  patch(it.id, { status: 'busy', retryAt: undefined });
  try {
    await loadDb().catch(() => undefined);
    const out = it.hasImg ? await attemptImage(it) : await attemptText(it, tries + 1 >= MAX_TRIES);
    if (out === 'done') return;
    const n = tries + 1;
    if (n >= MAX_TRIES) { patch(it.id, { status: 'fail', failWhy: `לא הצלחתי אחרי ${n} ניסיונות: ${out.retry}`, tries: n, retryAt: undefined }); return; }
    const wait = BACKOFF_S[Math.min(n - 1, BACKOFF_S.length - 1)];
    patch(it.id, { status: 'queued', srv: false, tries: n, retryAt: Date.now() + wait * 1000, failWhy: out.retry });
    timers.set(it.id, setTimeout(() => { const cur = store.get().inbox.find((x) => x.id === it.id); if (cur && cur.status === 'queued') prepareInbox(cur); }, wait * 1000));
  } catch {
    patch(it.id, { status: 'fail' });
  }
}

/** חזרה לרשת, או פתיחת האפליקציה: מנסים מיד פריטים שמחכים להשהיה */
export function kickInbox() {
  for (const it of store.get().inbox) if (it.status === 'queued' && !it.srv) prepareInbox(it);
}

/* ---------------- אישור והוספה ליום ---------------- */
const dayOf = (it: InboxItem) => dateKey(new Date(it.ts - store.get().settings.resetHour * 3600_000));
/** באיזו ארוחה לרשום: מה שבחרת, ואחרת לפי השעה שבה הארוחה נשלחה (לא לפי השעה שבה אתה מאשר) */
export const slotOf = (it: InboxItem) => {
  const slots = store.get().settings.slots;
  return it.slot && slots.some((s) => s.id === it.slot) ? it.slot : guessSlot(new Date(it.ts));
};
export const dateOfItem = dayOf;

/** מוסיף ליום בלי הודעה. מחזיר פעולת ביטול */
function logOne(it: InboxItem): (() => void) | null {
  const card = it.card;
  if (!card) return null;
  const s = store.get();
  const slot = slotOf(it);
  const date = dayOf(it);
  const drafts = makeEntries(card.items, s, true, '');
  const ids = drafts.map((d) => actions.addEntry({ date, slot, name: d.name, k: d.k, p: d.p, c: d.c, f: d.f, est: d.est, parts: d.parts, dishId: d.dishId }).id);
  // אכילה מסיר מורידה מה שנשאר בו (והביטול מחזיר)
  const used = new Map<string, number>();
  for (const i of card.items) if (i.foodId?.startsWith('d:')) used.set(i.foodId.slice(2), (used.get(i.foodId.slice(2)) ?? 0) + i.amount);
  const undoDish: Array<() => void> = [];
  for (const [did, g] of used) {
    const d = store.get().dishes.find((x) => x.id === did);
    if (!d) continue;
    const before = { remainG: d.remainG, last: d.last };
    actions.patchDish(did, { remainG: Math.max(0, (d.remainG ?? d.cookedG) - g), last: Date.now() });
    undoDish.push(() => actions.patchDish(did, before));
  }
  actions.dismissInbox(it.id);
  return () => { undoDish.forEach((f) => f()); actions.removeEntries(ids); actions.addInbox([it]); };
}

const slotName = (id: string) => store.get().settings.slots.find((x) => x.id === id)?.name ?? 'ארוחה';

/** מוסיף את הכרטיס המוכן ליום בלחיצה אחת, עם ביטול */
export function logInbox(it: InboxItem) {
  const sl = slotOf(it);
  const day = dayOf(it);
  const undo = logOne(it);
  if (!undo) return;
  toast(`נוסף ל${slotName(sl)}${day !== todayKey(store.get().settings.resetHour) ? ' (אתמול)' : ''}`, undo);
}

/** מוסיף את כל הכרטיסים המוכנים לפי הסדר, ביטול אחד מחזיר את כולם */
export function logAllInbox() {
  const ready = store.get().inbox.filter((x) => x.status === 'ready' && x.card).sort((a, b) => a.ts - b.ts);
  const undos = ready.map(logOne).filter((u): u is () => void => !!u);
  if (!undos.length) return;
  toast(`נוספו ${undos.length} ארוחות`, () => [...undos].reverse().forEach((u) => u()));
}

/** פותח את ההוספה עם הפריטים במגש, לתיקון כמויות לפני האישור */
export function editInbox(it: InboxItem) {
  const sl = slotOf(it);
  const date = dayOf(it);
  actions.dismissInbox(it.id);
  if (it.card) openAdd(sl, date, null, undefined, it.card.items);
  else openAdd(sl, date, null, it.text);
}

/** כשהניתוח האוטומטי של תמונה לא הצליח: פותח את הצ'אט ושולח אליו את אותה תמונה, כדי לדייק יחד */
export async function chatInbox(it: InboxItem) {
  const img = await get<{ data: string; mime: string }>('wo:inbox-img:' + it.id).catch(() => undefined);
  const sl = slotOf(it);
  const date = dayOf(it);
  actions.dismissInbox(it.id);
  openAdd(sl, date, 'chat');
  if (!aiState.get().configured) return;
  void sendMessage(it.text || 'זו תמונה של מה שאכלתי. מה יש בה?', img ? [{ data: img.data, mime: img.mime, url: `data:${img.mime};base64,${img.data}` }] : []);
}

/** ניסיון חוזר ידני אחרי כשל */
export function retryInbox(it: InboxItem) {
  patch(it.id, { status: undefined, tries: 0, retryAt: undefined, failWhy: undefined });
  const cur = store.get().inbox.find((x) => x.id === it.id);
  if (cur) prepareInbox(cur);
}
