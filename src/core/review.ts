import type { Macros, State, TargetKey } from './types';
import { dayInfo } from './calc';
import { addDays } from './dates';

/**
 * סקירה שבועית בלי AI: משקל, קלוריות, חלבון ואימונים ב-14 הימים האחרונים,
 * והמלצה אחת קונקרטית ליעד הקלוריות (בזהירות: מתבגר, רק שינוי קטן בכל פעם).
 */
export interface ReviewLine { tone: 'good' | 'warn' | 'info'; text: string }
export interface Review {
  ready: boolean;
  lines: ReviewLine[];
  action?: { label: string; deltaK: number };
}

const PACE: Record<string, [number, number]> = { slow: [0.15, 0.3], mid: [0.25, 0.5], fast: [0.4, 0.7] };
export const TARGET_KEYS: TargetKey[] = ['dorm-rest', 'dorm-train', 'home-rest', 'home-train'];

export function weeklyReview(s: State, today: string): Review {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i - 1)).map((d) => ({ d, ...dayInfo(s, d) })).filter((x) => x.entries.length > 0);
  const lines: ReviewLine[] = [];
  if (days.length < 3) return { ready: false, lines: [{ tone: 'info', text: 'צריך לפחות 3 ימים מתועדים כדי לתת סקירה. ממשיכים לתעד.' }] };

  const avgK = days.reduce((a, x) => a + x.eaten.k, 0) / days.length;
  const avgT = days.reduce((a, x) => a + x.target.k, 0) / days.length;
  const avgP = days.reduce((a, x) => a + x.eaten.p, 0) / days.length;
  const avgPT = days.reduce((a, x) => a + x.target.p, 0) / days.length;
  const pDays = days.filter((x) => x.eaten.p >= x.target.p * 0.9).length;
  const ratio = avgK / avgT;

  const w = s.weights.filter((x) => x.date >= addDays(today, -21));
  let slope: number | null = null;
  if (w.length >= 2) {
    const a = w[0], b = w[w.length - 1];
    const span = (Date.parse(b.date) - Date.parse(a.date)) / (7 * 86400_000);
    if (span >= 0.9) slope = (b.kg - a.kg) / span;
  }
  const [lo, hi] = PACE[s.settings.profile.pace] ?? PACE.mid;

  lines.push({ tone: ratio >= 0.95 ? 'good' : ratio >= 0.85 ? 'info' : 'warn', text: `אכלת בממוצע ${Math.round(avgK).toLocaleString('en-US')} קל׳ ביום, ${Math.round(ratio * 100)}% מהיעד (${days.length} ימים מתועדים)` });
  lines.push({ tone: pDays >= days.length * 0.7 ? 'good' : 'warn', text: `חלבון: ${Math.round(avgP)} ג׳ ביום בממוצע, יעד ${Math.round(avgPT)}. עמדת ביעד ב-${pDays} מתוך ${days.length} ימים` });
  if (slope !== null) lines.push({ tone: slope >= lo ? (slope > hi + 0.15 ? 'warn' : 'good') : 'warn', text: `משקל: ${slope >= 0 ? '+' : ''}${slope.toFixed(2)} ק״ג בשבוע (הקצב שבחרת: ${lo}–${hi})` });
  else lines.push({ tone: 'info', text: 'אין מספיק שקילות כדי לראות מגמה. שקילה פעם בשבוע באותו יום ובאותה שעה מספיקה' });

  const wk = s.workouts.filter((x) => x.date >= addDays(today, -7) && x.date < today && x.status !== 'skipped');
  if (wk.length) lines.push({ tone: wk.filter((x) => x.status === 'done').length >= wk.length - 0 ? 'good' : 'info', text: `אימונים: ${wk.filter((x) => x.status === 'done').length} מתוך ${wk.length} בשבוע האחרון` });

  let action: Review['action'];
  if (slope !== null && slope < lo && ratio >= 0.92) action = { label: 'העלה את היעד ב-150 קל׳', deltaK: 150 };
  else if (slope !== null && slope < lo && ratio < 0.85) lines.push({ tone: 'warn', text: 'העלייה איטית בעיקר כי אתה לא מגיע ליעד. קודם מגיעים ליעד, ורק אז מעלים אותו' });
  else if (slope !== null && slope > hi + 0.15 && ratio >= 0.95) action = { label: 'הורד את היעד ב-150 קל׳', deltaK: -150 };
  return { ready: true, lines, action };
}

/** מעדכן את כל ארבעת יעדי הקלוריות: הקלוריות לפי הדלתא, והפחמימות סופגות את ההפרש (4 קל׳ לגרם) */
export function shiftTargets(t: Record<TargetKey, Macros>, deltaK: number): Record<TargetKey, Macros> {
  const out = { ...t };
  for (const k of TARGET_KEYS) {
    const m = t[k];
    out[k] = { ...m, k: Math.max(1500, m.k + deltaK), c: Math.max(50, m.c + Math.round(deltaK / 4)) };
  }
  return out;
}
