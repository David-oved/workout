import type { Entry, Macros, Profile, State, TargetKey } from './types';
import { dow } from './dates';

export const ZERO: Macros = { k: 0, p: 0, c: 0, f: 0 };

export const sum = (list: Macros[]): Macros =>
  list.reduce((a, e) => ({ k: a.k + e.k, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f }), { ...ZERO });

export const scale = (m: Macros, x: number): Macros => ({
  k: Math.round(m.k * x),
  p: Math.round(m.p * x),
  c: Math.round(m.c * x),
  f: Math.round(m.f * x),
});

export function dayInfo(s: State, date: string) {
  const place = s.settings.places[dow(date)] ?? 'home';
  const workouts = s.workouts.filter((w) => w.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const training = workouts.some((w) => w.status !== 'skipped');
  const key = `${place}-${training ? 'train' : 'rest'}` as TargetKey;
  const target = s.settings.targets[key];
  const entries = s.entries.filter((e) => e.date === date).sort((a, b) => a.ts - b.ts);
  const eaten = sum(entries);
  return { place, training, key, target, entries, eaten, workouts };
}

/** חישוב יעדים מוצע: Mifflin-St Jeor ×1.6 + עודף לפי הקצב. התוצאה הערכה, לא תחליף לתזונאי. */
export function suggestTargets(p: Profile): Record<TargetKey, Macros> {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'f' ? -161 : 5);
  const surplus = { slow: 300, mid: 500, fast: 750 }[p.pace];
  const base = bmr * 1.6 + surplus;
  const round50 = (n: number) => Math.round(n / 50) * 50;
  const mk = (k: number): Macros => {
    const pr = Math.round(p.weightKg * 2);
    const f = Math.round(p.weightKg * 1.1);
    const c = Math.max(0, Math.round((k - pr * 4 - f * 9) / 4));
    return { k, p: pr, c, f };
  };
  const rest = mk(round50(base - 100));
  const train = mk(round50(base + 100));
  return { 'dorm-rest': rest, 'dorm-train': train, 'home-rest': { ...rest }, 'home-train': { ...train } };
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function recentFoods(entries: Entry[], limit = 14) {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of [...entries].sort((a, b) => b.ts - a.ts)) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
