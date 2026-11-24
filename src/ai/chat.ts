import { createStore } from '../core/store';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { uid } from '../core/dates';
import { toast, ui } from '../ui/ui';
import { chatTurn, type ChatTurn } from './gemini';
import { buildAppData } from './context';
import { macrosOf, tray } from '../ui/tray';
import { enabledDocs } from './docs';
import { extractReply, isCombined, itemMacros, type AiItem, type AiProduct, type Source } from './pure';
import { foodHints, nowBlock } from './hints';

/**
 * שיחה עם ה-AI: הודעות, וכרטיס ארוחה שנבנה ומתעדכן במהלך השיחה.
 * כרטיס "draft" ניתן לעריכה ולהוספה ליום. כשה-AI מעדכן, הכרטיס הקודם מוחלף בחדש (card = "old").
 */
export type ProdProp = AiProduct & { status: 'pending' | 'saved' | 'dismissed' };

export interface Msg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  images?: string[]; // תצוגה מקדימה בלבד, לא נשמרת
  fileNames?: string[]; // קבצי PDF שצורפו להודעה
  sent?: AiItem[]; // מה שה-AI החזיר (להיסטוריית השיחה)
  items?: AiItem[]; // הכרטיס הנוכחי (ניתן לעריכה)
  card?: 'draft' | 'added' | 'old';
  memoryAsk?: string[]; // דברים שה-AI מציע לזכור עליך, מחכים לאישור
  edited?: boolean;
  addedIds?: string[];
  addedLabel?: string;
  streaming?: boolean;
  meta?: { model: string; ms: number; thinking?: string; web?: boolean; calls?: number; trace?: string[] };
  sources?: Source[];
  remembered?: string[];
  suggestions?: string[];
  webFailed?: boolean;
  products?: ProdProp[]; // הצעות למוצרים חדשים, מחכות לאישור שלך
  hint?: string; // הנחיה נסתרת שנשלחת ל-AI עם ההודעה (לא מוצגת)
}
interface ChatState { messages: Msg[]; busy: boolean; product?: boolean; error?: string; detail?: string; web: boolean; deep: boolean; stage?: { text: string; n: number }; quota?: { kind: 'minute' | 'day'; until: number; limit?: string; model?: string } }

export interface Attachment { url?: string; data: string; mime: string; name?: string }

const LS = 'wo:ai-chat';
function load(): ChatState {
  const web = store.get().settings.ai.web;
  try {
    const j = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (j && Array.isArray(j.messages)) return { messages: j.messages, busy: false, web, deep: false };
  } catch { /* ignore */ }
  return { messages: [], busy: false, web, deep: false };
}
export const chat = createStore<ChatState>(load());

const fileData = new Map<string, { mime: string; data: string }[]>();

function setChat(fn: (s: ChatState) => ChatState) {
  chat.set(fn);
  try {
    if (chat.get().messages.some((m) => m.streaming)) return;
    const msgs = chat.get().messages.slice(-40).map((m) => ({ ...m, images: undefined }));
    localStorage.setItem(LS, JSON.stringify({ messages: msgs }));
  } catch { /* ignore */ }
}

/**
 * שורת סטטוס חיה: כל שלב מוצג לפחות רגע, ואז מתחלף בבא (בלי וי). התשובה עצמה לא מחכה לשלבים.
 * שלבים שמגיעים מהר מדי נכנסים לתור קצר; כשהתשובה מגיעה, הכל נעלם.
 */
let stageQ: string[] = [];
let stageTimer: ReturnType<typeof setTimeout> | undefined;
let stageN = 0;
let stageShown = '';
function pumpStage() {
  if (stageTimer) return;
  const next = stageQ.shift();
  if (!next) return;
  stageShown = next;
  chat.set((s) => ({ ...s, stage: { text: next, n: ++stageN } }));
  stageTimer = setTimeout(() => { stageTimer = undefined; pumpStage(); }, 650);
}
function stage(text: string) {
  if (text === stageShown || stageQ[stageQ.length - 1] === text) return;
  stageQ.push(text);
  if (stageQ.length > 3) stageQ.splice(0, stageQ.length - 3);
  pumpStage();
}
function clearStages() {
  stageQ = [];
  stageShown = '';
  if (stageTimer) clearTimeout(stageTimer);
  stageTimer = undefined;
  chat.set((s) => ({ ...s, stage: undefined }));
}

export const setWeb = (v: boolean) => chat.set((s) => ({ ...s, web: v }));
export const setDeep = (v: boolean) => chat.set((s) => ({ ...s, deep: v }));

const normName = (n: string) => n.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
/** האם שתי רשימות מייצגות אותה ארוחה (אותם שמות, כמויות דומות) */
function sameMeal(a: AiItem[], b: AiItem[]) {
  if (!a.length || a.length !== b.length) return false;
  return a.every((x) => b.some((y) => normName(x.name) === normName(y.name) && Math.abs(x.grams - y.grams) <= Math.max(5, y.grams * 0.12)));
}

export const draftOf = (msgs: Msg[]) => [...msgs].reverse().find((m) => m.card === 'draft');

const stripId = ({ id: _id, ...rest }: AiItem) => rest;

type Lib = Awaited<ReturnType<typeof enabledDocs>>;

function buildTurns(msgs: Msg[], lib: Lib, hints: string): ChatTurn[] {
  // שולחים קבצים רק מ-3 ההודעות האחרונות שיש בהן קבצים
  const withFiles = msgs.filter((m) => m.role === 'user' && fileData.get(m.id)?.length).map((m) => m.id);
  const keep = new Set(withFiles.slice(-3));
  const turns: ChatTurn[] = msgs.map((m) => {
    if (m.role === 'user') {
      const files = keep.has(m.id) ? fileData.get(m.id) : undefined;
      const note = !files && (m.images?.length || m.fileNames?.length) ? ' (צורף קובץ קודם)' : '';
      return { role: 'user', text: m.text + note + (m.hint ? `\n\n${m.hint}` : ''), images: files };
    }
    const items = m.card === 'added' ? [] : (m.items ?? m.sent ?? []);
    const prods = (m.products ?? []).filter((p) => p.status === 'pending').map(({ id: _i, status: _s, ...p }) => p);
    return { role: 'model', text: JSON.stringify({ reply: m.text, items: items.map(stripId), ...(prods.length ? { products: prods } : {}) }) };
  });
  // מסמכי הספרייה הכלולים: מצורפים להודעה הראשונה בשיחה
  const first = turns.find((t) => t.role === 'user');
  if (first && (lib.parts.length || lib.texts.length)) {
    first.text = `[LIBRARY DOCUMENTS the user chose to share: ${lib.names.join(', ')}]\n${lib.texts.join('\n\n')}\n\n${first.text}`;
    first.images = [...(first.images ?? []), ...lib.parts];
  }
  // כרטיס שהמשתמש ערך ידנית: מסמנים ל-AI שזו האמת. ובסוף: נתוני האפליקציה והזיכרון.
  const d = draftOf(msgs);
  const last = turns[turns.length - 1];
  if (last?.role === 'user') {
    if (d?.edited && d.items) last.text += `\n\n[CARD EDITED BY USER]\n${JSON.stringify(d.items.map(stripId))}`;
    const manual = tray.get().items.filter((i) => i.src === 'm');
    if (manual.length) {
      const lines = manual.map((i) => `- ${i.name}: ${i.unit === 'g' ? `${Math.round(i.amount)} g` : `${i.amount} portion`} (about ${macrosOf(i).k} kcal, ${macrosOf(i).p}g protein)`);
      last.text += `\n\n[ALSO IN THE USER'S MEAL TRAY, added by tapping tiles, not part of your card]\n${lines.join('\n')}`;
    }
    // ארוחות שכבר נוספו ליום בשיחה הזאת: ה-AI לא מחזיר אותן שוב לכרטיס
    const live = new Set(store.get().entries.map((e) => e.id));
    const addedLines = msgs.filter((m) => m.card === 'added' && m.addedIds?.some((id) => live.has(id))).map((m) => `- ${m.addedLabel ?? ''}: ${(m.items ?? []).map((i) => `${i.name} ${i.grams}g`).join(', ')}`);
    if (addedLines.length) last.text += `\n\n[ALREADY ADDED TO HIS DAY FROM THIS CHAT]\n${addedLines.join('\n')}`;
    if (hints) last.text += `\n\n${hints}`;
    last.text += `\n\n${nowBlock()}\n\n${buildAppData(ui.get().addDate)}`;
  }
  return turns;
}

/** הצעות לזיכרון שעוד לא שמורות */
function newMemory(notes: string[]): string[] {
  const have = store.get().settings.ai.memory.map((x) => x.toLowerCase());
  return [...new Set(notes)].filter((n) => !have.includes(n.toLowerCase()));
}

/** המשתמש אישר: שומרים את ההצעה בזיכרון */
export function confirmMemory(msgId: string, note: string) {
  const added = saveMemory([note]);
  patchMsg(msgId, (m) => ({ ...m, memoryAsk: (m.memoryAsk ?? []).filter((x) => x !== note), remembered: added.length ? [...(m.remembered ?? []), ...added] : m.remembered }));
}
export const dismissMemory = (msgId: string, note: string) =>
  patchMsg(msgId, (m) => ({ ...m, memoryAsk: (m.memoryAsk ?? []).filter((x) => x !== note) }));

function saveMemory(notes: string[]): string[] {
  if (!notes.length) return [];
  const ai = store.get().settings.ai;
  const have = ai.memory.map((x) => x.toLowerCase());
  const added: string[] = [];
  for (const n of notes) {
    if (!have.includes(n.toLowerCase()) && !added.some((x) => x.toLowerCase() === n.toLowerCase())) added.push(n);
  }
  if (added.length) actions.saveSettings({ ai: { ...ai, memory: [...ai.memory, ...added].slice(-60) } });
  return added;
}

async function runTurn() {
  const ph = uid();
  const { deep } = chat.get();
  const web = chat.get().web || !!chat.get().product;
  const lastUser = [...chat.get().messages].reverse().find((m) => m.role === 'user');
  const seenStages = new Set<string>();
  const once = (t: string) => { if (!seenStages.has(t)) { seenStages.add(t); stage(t); } };
  stage('קיבל את ההודעה');
  if (lastUser?.images?.length || lastUser?.fileNames?.length) stage('קורא את הקבצים שצירפת');
  if (store.get().settings.ai.shareData) stage('בודק את הנתונים שלך מהאפליקציה');
  setChat((s) => ({
    ...s,
    busy: true,
    error: undefined,
    detail: undefined,
    quota: undefined,
    deep: false,
    messages: [...s.messages, { id: ph, role: 'ai', text: '', streaming: true }],
  }));
  try {
    const lib = await enabledDocs();
    if (lib.parts.length + lib.texts.length > 0) stage('קורא את המסמכים מהספרייה');
    const hints = lastUser?.text ? await foodHints(lastUser.text).catch(() => '') : '';
    const turns = buildTurns(chat.get().messages.filter((m) => m.id !== ph), lib, hints);
    // כל ניסיון נוסף (אחרי כשלון) הוא תשובה חדשה: לא מציגים אותה בזרימה, כדי שהטקסט לא יתחלף מול העיניים
    let attemptNo = 0;
    const callOpts = {
      web,
      deep,
      docs: lib.parts.length + lib.texts.length > 0,
      onStage: stage,
      onAttempt: (n: number) => { attemptNo = n; if (n > 1) patchMsg(ph, (m) => (m.text ? { ...m, text: '' } : m)); },
      onDelta: (acc: string) => {
        if (attemptNo > 1) return;
        // הכרטיס נכתב לפני התשובה: אם יש בו פריט משולב, התשובה הזו תוחלף בניסיון השני, אז לא מציגים אותה בכלל
        const ri = acc.search(/"reply"\s*:/);
        const ii = acc.search(/"items"\s*:/);
        if (ii >= 0 && (ri < 0 || ii < ri)) {
          const head = ri < 0 ? acc : acc.slice(0, ri);
          if ([...head.matchAll(/"name"\s*:\s*"([^"]*)"/g)].some((m) => isCombined(m[1]))) { once('מפרק פריט משולב לרכיבים'); return; }
        }
        const r = extractReply(acc);
        const text = r || (acc.trimStart().startsWith('{') ? '' : acc);
        if (text) { once('כותב תשובה'); patchMsg(ph, (m) => (m.text === text ? m : { ...m, text })); }
        if (/"items"\s*:\s*\[\s*\{/.test(acc)) once('מחשב כמויות וערכים תזונתיים');
      },
    };
    let res = await chatTurn(turns, callOpts);
    // פריט שמחבר כמה מזונות? מבקשים פעם אחת לפרק אותו לרכיבים נפרדים
    const bad = res.items.filter((i) => isCombined(i.name)).map((i) => i.name);
    if (bad.length) {
      stage('מפרק פריט משולב לרכיבים');
      const fixTurns: ChatTurn[] = [
        ...turns,
        { role: 'model', text: JSON.stringify({ reply: res.reply, items: res.items.map(stripId) }) },
        { role: 'user', text: `[SYSTEM FIX] These items combine several foods or carry a quantity in the name: ${bad.map((x) => JSON.stringify(x)).join(', ')}. One item must be ONE single food in the singular. Return the full updated card again (same reply style) with every combined item split into separate single-food items, and with count and unitGrams for whole units.` },
      ];
      // הניסיון השני שקט: בלי זרימה בטקסט ובלי להחליף את מה שמוצג עד שהוא מוכן
      const first = res;
      try {
        const again = await chatTurn(fixTurns, { ...callOpts, onDelta: undefined, onAttempt: undefined });
        res = { ...again, calls: first.calls + again.calls, trace: [...first.trace, '— פירוק פריט משולב —', ...again.trace] };
      } catch { /* נשארים עם התשובה הראשונה */ }
    }
    // ה-AI חזר עם אותה ארוחה שכבר נוספה? לא פותחים כרטיס כפול
    const lastCard = [...chat.get().messages].reverse().find((m) => m.card === 'added' || m.card === 'draft');
    if (lastCard?.card === 'added' && res.items.length && sameMeal(res.items, lastCard.items ?? [])) res = { ...res, items: [] };
    const memoryAsk = newMemory(res.memory); // רק הצעה: נשמר אחרי לחיצה שלך
    clearStages();
    setChat((s) => {
      let msgs = [...s.messages];
      const idx = msgs.findIndex((m) => m.id === ph);
      const ai: Msg = {
        id: ph,
        role: 'ai',
        text: res.reply,
        sent: res.items,
        meta: { model: res.model, ms: res.ms, thinking: res.thinking, web: web && !res.webFailed, calls: res.calls, trace: res.trace },
        sources: res.sources.length ? res.sources : undefined,
        memoryAsk: memoryAsk.length ? memoryAsk : undefined,
        suggestions: res.suggestions.length ? res.suggestions : undefined,
        webFailed: res.webFailed || undefined,
        products: res.products.length ? res.products.map((p) => ({ ...p, status: 'pending' as const })) : undefined,
      };
      if (res.items.length) {
        const prev = msgs.map((m, i) => [m, i] as const).reverse().find(([m]) => m.card === 'draft');
        if (prev) msgs[prev[1]] = { ...prev[0], items: undefined, card: 'old' };
        ai.items = res.items;
        ai.card = 'draft';
      }
      if (idx >= 0) msgs[idx] = ai;
      else msgs = [...msgs, ai];
      return { ...s, messages: msgs, busy: false };
    });
  } catch (e) {
    clearStages();
    setChat((s) => ({
      ...s,
      busy: false,
      messages: s.messages.filter((m) => m.id !== ph),
      error: (e as Error).message,
      detail: (e as { detail?: string }).detail,
      quota: (e as { quota?: { kind: 'minute' | 'day'; until: number; limit?: string; model?: string } }).quota,
    }));
  }
}

const PRODUCT_HINT = '[PRODUCT MODE] He wants to add a NEW product to his food list. Identify the product in the photo (name, brand, flavour or variant). If a nutrition label is visible, read it exactly (source "label"; convert per-serving values to per 100 g). If it is not visible, search the web for its nutrition values per 100 g, Israeli sources first (manufacturer site, supermarket product pages, the Ministry of Health database) and put the page in "url" (source "web"). Return exactly one entry in "products", add "unitLabel" and "unitGrams" if the pack shows a unit or serving weight. Do NOT put anything in "items" unless he says he ate it. If you could not find reliable values, say what is missing and ask for a photo of the back of the pack. He can correct you in the chat; return the full updated product each time.';

let lastSend = { text: '', at: 0 };
export async function sendMessage(text: string, files: Attachment[], opts?: { product?: boolean }) {
  if (chat.get().busy) return;
  // אותה הודעה פעמיים בתוך שנייה וחצי (לחיצה כפולה או אנטר + כפתור): לא שולחים שוב
  const now = Date.now();
  if (text.trim() && text.trim() === lastSend.text && now - lastSend.at < 1500) return;
  lastSend = { text: text.trim(), at: now };
  if (opts?.product) chat.set((s) => ({ ...s, product: true }));
  const m: Msg = {
    id: uid(),
    role: 'user',
    text: text.trim() || (opts?.product ? 'מוצר חדש מהתמונה' : ''),
    hint: opts?.product ? PRODUCT_HINT : undefined,
    images: files.filter((f) => f.mime.startsWith('image/') && f.url).map((f) => f.url!),
    fileNames: files.filter((f) => !f.mime.startsWith('image/')).map((f) => f.name ?? 'מסמך'),
  };
  fileData.set(m.id, files.map((f) => ({ mime: f.mime, data: f.data })));
  setChat((s) => ({ ...s, messages: [...s.messages, m] }));
  await runTurn();
}

export const retryLast = () => (chat.get().busy ? undefined : runTurn());

export function restoreChat(messages: Msg[]) {
  setChat((s) => ({ ...s, messages, busy: false }));
}

export function resetChat() {
  fileData.clear();
  setChat((s) => ({ messages: [], busy: false, web: s.web, deep: false }));
}

function patchMsg(id: string, fn: (m: Msg) => Msg) {
  setChat((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));
}

export const setGrams = (msgId: string, itemId: string, grams: number) =>
  patchMsg(msgId, (m) => ({ ...m, edited: true, items: m.items?.map((i) => (i.id === itemId ? { ...i, grams: Math.max(1, Math.round(grams)) } : i)) }));

/** המשתמש מתקן ערכי תזונה של פריט בכרטיס (ל-100 ג׳) */
export const setPer = (msgId: string, itemId: string, per: { k: number; p: number; c: number; f: number }) =>
  patchMsg(msgId, (m) => ({ ...m, edited: true, items: m.items?.map((i) => (i.id === itemId ? { ...i, kcal100: per.k, p100: per.p, c100: per.c, f100: per.f, source: 'label' as const } : i)) }));

export const removeItem = (msgId: string, itemId: string) =>
  patchMsg(msgId, (m) => ({ ...m, edited: true, items: m.items?.filter((i) => i.id !== itemId) }));

export const cardTotals = (items: AiItem[]) =>
  items.reduce((a, i) => { const m = itemMacros(i); return { k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { k: 0, p: 0, c: 0, f: 0 });

/** מסמן כרטיס כ"נוסף" אחרי שהמגש הוסיף את הפריטים שלו ליום (הביטול מוחק את כל מה שנוסף) */
export function markAdded(msgId: string, ids: string[], label: string) {
  patchMsg(msgId, (x) => ({ ...x, card: 'added', addedIds: ids, addedLabel: label }));
}

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

/** עריכת שדות של הצעת מוצר לפני האישור */
export const setProductField = (msgId: string, pid: string, patch: Partial<AiProduct>) =>
  patchMsg(msgId, (m) => ({ ...m, products: m.products?.map((p) => (p.id === pid ? { ...p, ...patch, source: patch.source ?? (p.source === 'estimate' ? 'user' : p.source) } : p)) }));

export const resolveProduct = (msgId: string, pid: string, status: 'saved' | 'dismissed') =>
  patchMsg(msgId, (m) => ({ ...m, products: m.products?.map((p) => (p.id === pid ? { ...p, status } : p)) }));

export const pendingProducts = (m?: Msg) => (m?.products ?? []).filter((p) => p.status === 'pending');
