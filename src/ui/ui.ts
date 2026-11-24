import { createStore } from '../core/store';
import type { TItem } from './tray';
import { store } from '../core/state';
import { todayKey } from '../core/dates';

export type Tab = 'progress' | 'today' | 'calendar';
export interface Toast { id: number; msg: string; undo?: () => void }

export interface Ui {
  tab: Tab;
  date: string; // היום שמוצג במסך "היום"
  addOpen: boolean;
  addSlot: string;
  addDate: string;
  settingsOpen: boolean;
  settingsPage: string | null;
  aiOpen: boolean;
  addView: 'chat' | null;
  editEntry: string | null;
  workoutSheet: { id?: string; date: string } | null;
  training: { workoutId?: string; date: string; title: string } | null;
  summary: string | null; // תאריך הסיכום הפתוח
  plan: { dayId: string | null } | null; // מסך תוכנית האימונים
  toast: Toast | null;
  /** מבט מהיר: מסך היום נפתח רק עם המדדים וכפתור הוספה. מחליקים למעלה למצב רגיל */
  glance: boolean;
  stat: 'k' | 'p' | 'c' | 'f' | null; // פירוט מדד
  addText: string | null; // טקסט שנשלח אוטומטית כשמסך ההוספה נפתח (למשל מ-Siri)
  inboxOpen: boolean; // רשימת הארוחות שמחכות לאישור
  addTray: TItem[] | null; // פריטים שנכנסים למגש כשמסך ההוספה נפתח (כרטיס מוכן שרוצים לערוך)
}

const reset = store.get().settings.resetHour;
export const ui = createStore<Ui>({
  tab: 'today',
  date: todayKey(reset),
  addOpen: false,
  addSlot: guessSlot(),
  addDate: todayKey(reset),
  settingsOpen: false,
  settingsPage: null,
  aiOpen: false,
  addView: null,
  editEntry: null,
  workoutSheet: null,
  training: null,
  summary: null,
  plan: null,
  toast: null,
  glance: true,
  stat: null,
  addText: null,
  addTray: null,
  inboxOpen: false,
});

export const setUi = (patch: Partial<Ui>) => ui.set((s) => ({ ...s, ...patch }));

/** ארוחה ברירת מחדל לפי השעה: הקרובה ביותר לשעה הנוכחית */
export function guessSlot(at: Date = new Date()): string {
  const slots = store.get().settings.slots;
  const mins = at.getHours() * 60 + at.getMinutes();
  let best = slots[0]?.id ?? 'snack';
  let bestD = Infinity;
  for (const s of slots) {
    if (s.id === 'snack') continue;
    const [h, m] = s.time.split(':').map(Number);
    const d = Math.abs(h * 60 + m - mins);
    if (d < bestD) { bestD = d; best = s.id; }
  }
  return best;
}

let toastTimer: number | undefined;
export function toast(msg: string, undo?: () => void) {
  const id = Date.now();
  setUi({ toast: { id, msg, undo } });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), 4200);
}

export function openAdd(slot?: string, date?: string, view: 'chat' | null = null, text?: string, trayItems?: TItem[]) {
  setUi({ addOpen: true, addSlot: slot ?? guessSlot(), addDate: date ?? ui.get().date, addView: view, addText: text ?? null, addTray: trayItems ?? null });
}
