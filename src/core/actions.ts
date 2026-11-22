import { update } from './state';
import type { Entry, Food, Routine, Settings, Workout, WorkoutStatus } from './types';
import { addDays, todayKey, uid } from './dates';
import { ensureWorkouts } from './state';

/**
 * כל שינוי נתונים באפליקציה עובר דרך הפעולות האלה (גם ה-UI וגם, בעתיד, ה-AI דרך src/ai/tools.ts).
 * כך יש מקום אחד ללוגיקה ואפשר לבטל כל פעולה.
 */
export const actions = {
  addEntry(e: Omit<Entry, 'id' | 'ts'> & { id?: string; ts?: number }): Entry {
    const entry: Entry = { ...e, id: e.id ?? uid(), ts: e.ts ?? Date.now() };
    update((s) => ({ ...s, entries: [...s.entries, entry] }));
    return entry;
  },
  updateEntry(id: string, patch: Partial<Entry>) {
    update((s) => ({ ...s, entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  },
  deleteEntry(id: string) {
    update((s) => ({ ...s, entries: s.entries.filter((e) => e.id !== id) }));
  },
  restoreEntry(e: Entry) {
    update((s) => (s.entries.some((x) => x.id === e.id) ? s : { ...s, entries: [...s.entries, e] }));
  },
  duplicateDay(from: string, to: string): number {
    let n = 0;
    update((s) => {
      const copies = s.entries
        .filter((e) => e.date === from)
        .map((e, i) => ({ ...e, id: uid(), date: to, ts: Date.now() + i }));
      n = copies.length;
      return { ...s, entries: [...s.entries, ...copies] };
    });
    return n;
  },
  removeEntries(ids: string[]) {
    update((s) => ({ ...s, entries: s.entries.filter((e) => !ids.includes(e.id)) }));
  },

  toggleFavorite(food: Omit<Food, 'id'> & { id?: string }) {
    update((s) => {
      const hit = s.favorites.find((x) => x.name === food.name);
      return hit
        ? { ...s, favorites: s.favorites.filter((x) => x.name !== food.name) }
        : { ...s, favorites: [...s.favorites, { ...food, id: food.id ?? uid() }] };
    });
  },

  addWorkout(w: Omit<Workout, 'id' | 'status'> & { status?: WorkoutStatus }) {
    const workout: Workout = { id: uid(), status: 'planned', ...w };
    update((s) => ({ ...s, workouts: [...s.workouts, workout] }));
    return workout;
  },
  updateWorkout(id: string, patch: Partial<Workout>) {
    update((s) => ({ ...s, workouts: s.workouts.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  },
  deleteWorkout(id: string) {
    update((s) => {
      const w = s.workouts.find((x) => x.id === id);
      // אימון משגרה לא נמחק אלא מסומן כמבוטל, כדי שלא ייווצר מחדש
      if (w?.routineId) return { ...s, workouts: s.workouts.map((x) => (x.id === id ? { ...x, status: 'skipped' as const } : x)) };
      return { ...s, workouts: s.workouts.filter((x) => x.id !== id) };
    });
  },

  logWeight(date: string, kg: number) {
    update((s) => ({ ...s, weights: [...s.weights.filter((w) => w.date !== date), { date, kg }].sort((a, b) => a.date.localeCompare(b.date)) }));
  },

  saveSettings(patch: Partial<Settings>) {
    update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  saveRoutine(routine: Routine[]) {
    update((s) => {
      const keep = new Set(routine.map((r) => r.id));
      const today = todayKey(s.settings.resetHour);
      // מנקים אימונים עתידיים של שגרות שנמחקו/שונו, ומייצרים מחדש
      const workouts = s.workouts.filter((w) => !(w.routineId && w.date >= today && w.status === 'planned'));
      const stale = workouts.filter((w) => w.routineId && !keep.has(w.routineId) && w.date >= today);
      const next = { ...s, settings: { ...s.settings, routine }, workouts: workouts.filter((w) => !stale.includes(w)) };
      return ensureWorkouts(next, today);
    });
  },
  markBackup() {
    update((s) => ({ ...s, meta: { ...s.meta, lastBackup: Date.now() } }));
  },
  yesterdayOf: (d: string) => addDays(d, -1),
};
