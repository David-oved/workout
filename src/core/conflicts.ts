import type { Workout } from './types';

export interface ExtEvent { id: string; title: string; start: string; end: string; allDay: boolean; cal: string }

export const WORKOUT_MIN = 90;

const p = (n: number) => String(n).padStart(2, '0');
/** דקות מוחלטות (UTC פיקטיבי) מתאריך ושעה מקומיים: מספיק להשוואות */
const abs = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, h, mi) / 60000);
};
const evAbs = (s: string) => abs(s.slice(0, 10), s.length > 10 ? s.slice(11, 16) : '00:00');

export const hhmm = (s: string) => s.slice(11, 16);

/** אירועים של יום מסוים: מתוזמנים (חופפים ליום) וכל-יום (מכסים את היום) */
export function eventsOn(events: ExtEvent[], date: string) {
  const dayStart = abs(date, '00:00');
  const dayEnd = dayStart + 24 * 60;
  const timed: ExtEvent[] = [];
  const allDay: ExtEvent[] = [];
  for (const e of events) {
    if (e.allDay) {
      if (e.start.slice(0, 10) <= date && e.end.slice(0, 10) >= date) allDay.push(e);
    } else if (evAbs(e.start) < dayEnd && evAbs(e.end) > dayStart) {
      timed.push(e);
    }
  }
  timed.sort((a, b) => a.start.localeCompare(b.start));
  return { timed, allDay };
}

/** אירועים מתוזמנים שחופפים לאימון (אירועי "כל היום" לא נחשבים התנגשות) */
export function conflictsFor(w: { date: string; time: string }, events: ExtEvent[], dur = WORKOUT_MIN) {
  const s = abs(w.date, w.time);
  const e = s + dur;
  return events.filter((x) => !x.allDay && evAbs(x.start) < e && evAbs(x.end) > s);
}

/**
 * מציע שעה פנויה באותו יום, הקרובה ביותר לשעה המועדפת.
 * מתחשב באירועי היומן ובאימונים אחרים, עם מרווח של 15 דקות.
 */
export function suggestSlot(
  date: string,
  events: ExtEvent[],
  workouts: Workout[],
  preferred: string,
  excludeId?: string,
  dur = WORKOUT_MIN,
  from = '06:30',
  to = '21:30',
): string | null {
  const busy: [number, number][] = [];
  for (const e of eventsOn(events, date).timed) busy.push([evAbs(e.start) - 15, evAbs(e.end) + 15]);
  for (const w of workouts) {
    if (w.date === date && w.id !== excludeId && w.status !== 'skipped') busy.push([abs(date, w.time) - 15, abs(date, w.time) + dur + 15]);
  }
  const pref = abs(date, preferred);
  let best: string | null = null;
  let bestD = Infinity;
  const lo = abs(date, from);
  const hi = abs(date, to) - dur;
  for (let t = lo; t <= hi; t += 15) {
    if (busy.some(([a, b]) => t < b && t + dur > a)) continue;
    const d = Math.abs(t - pref);
    if (d < bestD) {
      bestD = d;
      const mins = t - abs(date, '00:00');
      best = `${p(Math.floor(mins / 60))}:${p(mins % 60)}`;
    }
  }
  return best;
}
