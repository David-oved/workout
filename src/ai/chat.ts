import { createStore } from '../core/store';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo } from '../core/calc';
import { uid } from '../core/dates';
import { toast, ui } from '../ui/ui';
import { chatTurn, type ChatTurn } from './gemini';
import { itemMacros, type AiItem } from './pure';

/**
 * שיחה עם ה-AI: הודעות, וכרטיס ארוחה שנבנה ומתעדכן במהלך השיחה.
 * כרטיס "draft" ניתן לעריכה ולהוספה ליום. כשה-AI מעדכן, הכרטיס הקודם מוחלף בחדש (card = "old").
 */
export interface Msg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  images?: string[]; // תצוגה מקדימה בלבד, לא נשמרת
  sent?: AiItem[]; // מה שה-AI החזיר (להיסטוריית השיחה)
  items?: AiItem[]; // הכרטיס הנוכחי (ניתן לעריכה)
  card?: 'draft' | 'added' | 'old';
  edited?: boolean;
  addedIds?: string[];
  addedLabel?: string;
}
interface ChatState { messages: Msg[]; busy: boolean; error?: string; detail?: string }

const LS = 'wo:ai-chat';
function load(): ChatState {
  try {
    const j = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (j && Array.isArray(j.messages)) return { messages: j.messages, busy: false };
  } catch { /* ignore */ }
  return { messages: [], busy: false };
}
export const chat = createStore<ChatState>(load());

const imgData = new Map<string, { mime: string; data: string }[]>();

function setChat(fn: (s: ChatState) => ChatState) {
  chat.set(fn);
  try {
    const msgs = chat.get().messages.slice(-40).map((m) => ({ ...m, images: undefined }));
    localStorage.setItem(LS, JSON.stringify({ messages: msgs }));
  } catch { /* ignore */ }
}

export const draftOf = (msgs: Msg[]) => [...msgs].reverse().find((m) => m.card === 'draft');

/** הקשר היום (מה נאכל ומה היעד), כדי שאפשר לשאול "מה כדאי לאכול עכשיו" */
function dayContext() {
  const s = store.get();
  const i = dayInfo(s, ui.get().addDate);
  const e = i.eaten, t = i.target;
  return `[TODAY SO FAR] eaten: ${e.k} kcal, protein ${e.p}g, carbs ${e.c}g, fat ${e.f}g. Daily targets: ${t.k} kcal, protein ${t.p}g, carbs ${t.c}g, fat ${t.f}g.`;
}

function buildTurns(msgs: Msg[]): ChatTurn[] {
  // שולחים תמונות רק מ-3 ההודעות האחרונות שיש בהן תמונות
  const withImgs = msgs.filter((m) => m.role === 'user' && imgData.get(m.id)?.length).map((m) => m.id);
  const keep = new Set(withImgs.slice(-3));
  const turns: ChatTurn[] = msgs.map((m) => {
    if (m.role === 'user') {
      const imgs = keep.has(m.id) ? imgData.get(m.id) : undefined;
      const note = !imgs && m.images?.length ? ' (צורפה תמונה קודמת)' : '';
      return { role: 'user', text: m.text + note, images: imgs };
    }
    const items = m.items ?? m.sent ?? [];
    return { role: 'model', text: JSON.stringify({ reply: m.text, items: items.map(stripId) }) };
  });
  // כרטיס שהמשתמש ערך ידנית: מסמנים ל-AI שזו האמת
  const d = draftOf(msgs);
  const last = turns[turns.length - 1];
  if (last?.role === 'user') {
    if (d?.edited && d.items) last.text += `\n\n[CARD EDITED BY USER]\n${JSON.stringify(d.items.map(stripId))}`;
    last.text += `\n\n${dayContext()}`;
  }
  return turns;
}
const stripId = ({ id: _id, ...rest }: AiItem) => rest;

async function runTurn() {
  setChat((s) => ({ ...s, busy: true, error: undefined, detail: undefined }));
  try {
    const res = await chatTurn(buildTurns(chat.get().messages));
    setChat((s) => {
      const msgs = [...s.messages];
      const ai: Msg = { id: uid(), role: 'ai', text: res.reply, sent: res.items };
      if (res.items.length) {
        const prev = [...msgs].map((m, i) => [m, i] as const).reverse().find(([m]) => m.card === 'draft');
        if (prev) msgs[prev[1]] = { ...prev[0], items: undefined, card: 'old' };
        ai.items = res.items;
        ai.card = 'draft';
      }
      msgs.push(ai);
      return { ...s, messages: msgs, busy: false };
    });
  } catch (e) {
    setChat((s) => ({ ...s, busy: false, error: (e as Error).message, detail: (e as { detail?: string }).detail }));
  }
}

export async function sendMessage(text: string, imgs: { url: string; data: string; mime: string }[]) {
  if (chat.get().busy) return;
  const m: Msg = { id: uid(), role: 'user', text: text.trim(), images: imgs.map((i) => i.url) };
  imgData.set(m.id, imgs.map((i) => ({ mime: i.mime, data: i.data })));
  setChat((s) => ({ ...s, messages: [...s.messages, m] }));
  await runTurn();
}

export const retryLast = () => (chat.get().busy ? undefined : runTurn());

export function resetChat() {
  imgData.clear();
  setChat(() => ({ messages: [], busy: false }));
}

const patchMsg = (id: string, fn: (m: Msg) => Msg) =>
  setChat((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));

export const setGrams = (msgId: string, itemId: string, grams: number) =>
  patchMsg(msgId, (m) => ({ ...m, edited: true, items: m.items?.map((i) => (i.id === itemId ? { ...i, grams: Math.max(1, Math.round(grams)) } : i)) }));

export const removeItem = (msgId: string, itemId: string) =>
  patchMsg(msgId, (m) => ({ ...m, edited: true, items: m.items?.filter((i) => i.id !== itemId) }));

export const cardTotals = (items: AiItem[]) =>
  items.reduce((a, i) => { const m = itemMacros(i); return { k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { k: 0, p: 0, c: 0, f: 0 });

/** מוסיף את הכרטיס ליום: מנה לכל פריט, עם אפשרות ביטול */
export function addCardToDay(msgId: string, date: string, slot: string, slotName: string) {
  const m = chat.get().messages.find((x) => x.id === msgId);
  if (!m?.items?.length) return;
  const ids = m.items.map((it) => {
    const mm = itemMacros(it);
    return actions.addEntry({ date, slot, name: `${it.name} · ${it.grams} ג׳`, ...mm, est: it.source !== 'label' }).id;
  });
  patchMsg(msgId, (x) => ({ ...x, card: 'added', addedIds: ids, addedLabel: slotName }));
  toast(`נוסף ל${slotName}`, () => undoAdd(msgId));
}

export function undoAdd(msgId: string) {
  const m = chat.get().messages.find((x) => x.id === msgId);
  if (!m?.addedIds) return;
  actions.removeEntries(m.addedIds);
  patchMsg(msgId, (x) => ({ ...x, card: 'draft', addedIds: undefined, addedLabel: undefined }));
}
