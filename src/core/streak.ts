import { addDays } from './dates';
import type { State } from './types';

/** כמה ימים ברצף רשמת אוכל. אם עוד לא רשמת היום, הרצף של אתמול עדיין חי */
export function streakOf(s: State, today: string): number {
  const days = new Set(s.entries.map((e) => e.date));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d) && n < 999) { n++; d = addDays(d, -1); }
  return n;
}
