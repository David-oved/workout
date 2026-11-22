import { createStore } from '../core/store';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { uid } from '../core/dates';
import { toast, ui } from '../ui/ui';
import { chatTurn, type ChatTurn } from './gemini';
import { buildAppData } from './context';
import { macrosOf, tray } from '../ui/tray';
import { enabledDocs } from './docs';
import { extractReply, itemMacros, type AiItem, type Source } from './pure';

/**
 * שיחה עם ה-AI: הודעות, וכרטיס ארוחה שנבנה ומתעדכן במהלך השיחה.
 * כרטיס "draft" ניתן לעריכה ולהוספה ליום. כשה-AI מעדכן, הכרטיס הקודם מוחלף בחדש (card = "old").
 */
export interface Msg {
  id: string;
  role: 'user' | 'ai';
  text: string;
  images?: string[]; // תצוגה מקדימה בלבד, לא נשמרת
  fileNames?: string[]; // קבצי PDF שצורפו להודעה
  sent?: AiItem[]; // מה שה-AI החזיר (להיסטוריית השיחה)
  items?: AiItem[]; // הכרטיס הנוכחי (ניתן לעריכה)
  card?: 'draft' | 'added' | 'old';
  edited?: boolean;
  addedIds?: string[];
  addedLabel?: string;
  streaming?: boolean;
  meta?: { model: string; ms: number; thinking?: string; web?: boolean };
  sources?: Source[];
  remembered?: string[];
  suggestions?: string[];
  webFailed?: boolean;
}
interface ChatState { messages: Msg[]; busy: boolean; error?: string; detail?: string; web: boolean; deep: boolean; stage?: { text: string; n: number }; quota?: { kind: 'minute' | 'day'; until: number; limit?: string; model?: string } }

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

export const draftOf = (msgs: Msg[]) => [...msgs].reverse().find((m) => m.card === 'draft');

const stripId = ({ id: _id, ...rest }: AiItem) => rest;

type Lib = Awaited<ReturnType<typeof enabledDocs>>;

function buildTurns(msgs: Msg[], lib: Lib): ChatTurn[] {
  // שולחים קבצים רק מ-3 ההודעות האחרונות שיש בהן קבצים
  const withFiles = msgs.filter((m) => m.role === 'user' && fileData.get(m.id)?.length).map((m) => m.id);
  const keep = new Set(withFiles.slice(-3));
  const turns: ChatTurn[] = msgs.map((m) => {
    if (m.role === 'user') {
      const files = keep.has(m.id) ? fileData.get(m.id) : undefined;
      const note = !files && (m.images?.length || m.fileNames?.length) ? ' (צורף קובץ קודם)' : '';
      return { role: 'user', text: m.text + note, images: files };
    }
    const items = m.items ?? m.sent ?? [];
    return { role: 'model', text: JSON.stringify({ reply: m.text, items: items.map(stripId) }) };
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
    last.text += `\n\n${buildAppData(ui.get().addDate)}`;
  }
  return turns;
}

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
  const { web, deep } = chat.get();
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
    const turns = buildTurns(chat.get().messages.filter((m) => m.id !== ph), lib);
    const res = await chatTurn(turns, {
      web,
      deep,
      docs: lib.parts.length + lib.texts.length > 0,
      onStage: stage,
      onDelta: (acc) => {
        const r = extractReply(acc);
        const text = r || (acc.trimStart().startsWith('{') ? '' : acc);
        if (text) { once('כותב תשובה'); patchMsg(ph, (m) => (m.text === text ? m : { ...m, text })); }
        if (/"items"\s*:\s*\[\s*\{/.test(acc)) once('מחשב כמויות וערכים תזונתיים');
      },
    });
    const remembered = saveMemory(res.memory);
    clearStages();
    setChat((s) => {
      let msgs = [...s.messages];
      const idx = msgs.findIndex((m) => m.id === ph);
      const ai: Msg = {
        id: ph,
        role: 'ai',
        text: res.reply,
        sent: res.items,
        meta: { model: res.model, ms: res.ms, thinking: res.thinking, web: web && !res.webFailed },
        sources: res.sources.length ? res.sources : undefined,
        remembered: remembered.length ? remembered : undefined,
        suggestions: res.suggestions.length ? res.suggestions : undefined,
        webFailed: res.webFailed || undefined,
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

export async function sendMessage(text: string, files: Attachment[]) {
  if (chat.get().busy) return;
  const m: Msg = {
    id: uid(),
    role: 'user',
    text: text.trim(),
    images: files.filter((f) => f.mime.startsWith('image/') && f.url).map((f) => f.url!),
    fileNames: files.filter((f) => !f.mime.startsWith('image/')).map((f) => f.name ?? 'מסמך'),
  };
  fileData.set(m.id, files.map((f) => ({ mime: f.mime, data: f.data })));
  setChat((s) => ({ ...s, messages: [...s.messages, m] }));
  await runTurn();
}

export const retryLast = () => (chat.get().busy ? undefined : runTurn());

export function resetChat() {
  fileData.clear();
  setChat((s) => ({ messages: [], busy: false, web: s.web, deep: false }));
}

function patchMsg(id: string, fn: (m: Msg) => Msg) {
  setChat((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));
}

export const setGrams = (msgId: string, itemId: string, grams: number) =>
  patchMsg(msgId, (m) => ({ ...m, edited: true, items: m.items?.map((i) => (i.id === itemId ? { ...i, grams: Math.max(1, Math.round(grams)) } : i)) }));

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
