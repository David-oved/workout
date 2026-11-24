import { get } from 'idb-keyval';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { todayKey, uid } from '../core/dates';
import { parseMeal } from '../core/parse';
import { loadDb } from '../data/foodDb';
import { aiState, chatTurn } from '../ai/gemini';
import { buildAppData } from '../ai/context';
import { foodHints, nowBlock } from '../ai/hints';
import { sendMessage } from '../ai/chat';
import { macrosOf, makeEntries, tray, trayAddDish, trayAddFood, trayClear, type TItem } from '../ui/tray';
import { guessSlot, openAdd, toast } from '../ui/ui';
import type { InboxCard, InboxItem } from '../core/types';

/**
 * מכין כרטיס ארוחה מוכן מטקסט שהגיע מ-Siri, ברקע, כדי שתפתח את האפליקציה ותראה אותו מוכן:
 * עם AI מחובר הוא מנתח, ובלי AI (או אם נכשל) החיפוש במאגר. ההוספה ליום היא לחיצה אחת.
 */
const running = new Set<string>();

function viaTray(fn: () => void): TItem[] {
  const keep = tray.get();
  trayClear();
  try { fn(); return [...tray.get().items]; } finally { tray.set(keep); }
}

function cardOf(items: TItem[], src: 'db' | 'ai'): InboxCard {
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

const trayOf = (list: Awaited<ReturnType<typeof chatTurn>>['items']): TItem[] =>
  list.map((i) => ({
    id: uid(), name: i.name, unit: 'g', amount: i.grams, step: 10, base: 100,
    per: { k: i.kcal100, p: i.p100, c: i.c100, f: i.f100 }, est: i.source === 'estimate', src: 'm',
    unitG: i.unitGrams, portions: i.unitGrams ? [{ l: 'יחידה', g: i.unitGrams }] : undefined,
  }));

const PHOTO_HINT = '[PHOTO FROM SHORTCUT] He sent this photo from an iPhone shortcut, and may have added a short note. The photo shows what he ate, or a food package, or a nutrition label. Use his note as extra information (what it is, quantities, brand). Return one meal card in "items" as usual (source "label" when a nutrition label is readable). If you cannot tell what is in the photo, return no items and say in "reply" what you need (one short sentence).';

/** תמונה (מקיצור): ה-AI מנתח את התמונה יחד עם הטקסט שהוספת, ומכין כרטיס אחד מוכן */
async function prepareImage(it: InboxItem) {
  const img = await get<{ data: string; mime: string }>('wo:inbox-img:' + it.id).catch(() => undefined);
  if (!img) { patch(it.id, { status: 'fail', failWhy: 'התמונה לא נשמרה במכשיר, אפשר לשלוח שוב' }); return; }
  if (!aiState.get().configured) { patch(it.id, { status: 'fail', failWhy: 'ניתוח תמונה דורש חיבור AI (הגדרות ← AI תזונה)' }); return; }
  const today = todayKey(store.get().settings.resetHour);
  const hints = it.text ? await foodHints(it.text).catch(() => '') : '';
  const ask = it.text || 'זו תמונה של מה שאכלתי. זהה מה יש בה והערך כמויות.';
  const text = `${ask}

${PHOTO_HINT}${hints ? `

${hints}` : ''}

${nowBlock()}

${buildAppData(today)}`;
  try {
    const res = await chatTurn([{ role: 'user', text, images: [img] }], {});
    if (res.items.length) {
      patch(it.id, { status: 'ready', card: { ...cardOf(trayOf(res.items), 'ai'), note: res.reply } });
      return;
    }
    patch(it.id, { status: 'fail', failWhy: res.reply || 'לא הצלחתי לזהות מה בתמונה' });
  } catch (e) {
    patch(it.id, { status: 'fail', failWhy: (e as Error).message || 'הניתוח נכשל' });
  }
}

export async function prepareInbox(it: InboxItem) {
  if (running.has(it.id)) return;
  running.add(it.id);
  try {
    patch(it.id, { status: 'busy' });
    await loadDb().catch(() => undefined);
    if (it.hasImg) { await prepareImage(it); return; }
    // 1. עם AI מחובר: הוא מנתח בלי שיחה, כרטיס אחד מוכן (מדויק יותר מהחיפוש במאגר)
    if (aiState.get().configured) {
      try {
        const today = todayKey(store.get().settings.resetHour);
        const hints = await foodHints(it.text).catch(() => '');
        const text = `${it.text}${hints ? `

${hints}` : ''}

${nowBlock()}

${buildAppData(today)}`;
        const res = await chatTurn([{ role: 'user', text }], {});
        if (res.items.length) {
          const items = trayOf(res.items);
          patch(it.id, { status: 'ready', card: { ...cardOf(items, 'ai'), note: res.reply } });
          return;
        }
      } catch { /* ממשיכים למאגר */ }
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
      if (items.length) { patch(it.id, { status: 'ready', card: cardOf(items, 'db') }); return; }
    }
    patch(it.id, { status: 'fail' });
  } catch {
    patch(it.id, { status: 'fail' });
  } finally {
    running.delete(it.id);
  }
}

/** מוסיף את הכרטיס המוכן ליום בלחיצה אחת, עם ביטול */
export function logInbox(it: InboxItem, date: string) {
  const card = it.card;
  if (!card) return;
  const s = store.get();
  const slot = guessSlot();
  const slotName = s.settings.slots.find((x) => x.id === slot)?.name ?? 'ארוחה';
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
  toast(`נוסף ל${slotName}`, () => { undoDish.forEach((f) => f()); actions.removeEntries(ids); actions.addInbox([it]); });
}

/** פותח את ההוספה עם הפריטים במגש, לתיקון כמויות לפני האישור */
export function editInbox(it: InboxItem, date: string) {
  actions.dismissInbox(it.id);
  if (it.card) openAdd(undefined, date, null, undefined, it.card.items);
  else openAdd(undefined, date, null, it.text);
}

/** כשהניתוח האוטומטי של תמונה לא הצליח: פותח את הצ'אט ושולח אליו את אותה תמונה, כדי לדייק יחד */
export async function chatInbox(it: InboxItem, date: string) {
  const img = await get<{ data: string; mime: string }>('wo:inbox-img:' + it.id).catch(() => undefined);
  actions.dismissInbox(it.id);
  openAdd(undefined, date, 'chat');
  if (!aiState.get().configured) return;
  void sendMessage(it.text || 'זו תמונה של מה שאכלתי. מה יש בה?', img ? [{ data: img.data, mime: img.mime, url: `data:${img.mime};base64,${img.data}` }] : []);
}
