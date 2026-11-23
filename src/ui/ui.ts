import { createStore } from '../core/store';
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
});

export const setUi = (patch: Partial<Ui>) => ui.set((s) => ({ ...s, ...patch }));

/** ארוחה ברירת מחדל לפי השעה: הקרובה ביותר לשעה הנוכחית */
export function guessSlot(): string {
  const slots = store.get().settings.slots;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
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

export function openAdd(slot?: string, date?: string, view: 'chat' | null = null) {
  setUi({ addOpen: true, addSlot: slot ?? guessSlot(), addDate: date ?? ui.get().date, addView: view });
}
