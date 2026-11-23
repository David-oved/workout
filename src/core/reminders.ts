import type { State } from './types';
import { addDays, dow, todayKey } from './dates';
import { dayInfo } from './calc';

/**
 * תזכורות מוכנות להתראות: הן נכתבות ליומן Google כאירועים קצרים עם התראה (דרך אותו גשר של האימונים),
 * ולכן מגיעות לאייפון כהתראות רגילות גם כשהאפליקציה סגורה. בנוסף יש "דחיפות" חכמות בתוך האפליקציה.
 */
export interface ReminderItem { id: string; title: string; date: string; time: string; status: 'planned'; durationMin: number; alertMin: number }

const HORIZON = 14;
const hm = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function buildReminders(s: State, from: string, to: string, now = new Date()): ReminderItem[] {
  const r = s.settings.remind;
  const today = todayKey(s.settings.resetHour);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const last = addDays(today, HORIZON) < to ? addDays(today, HORIZON) : to;
  const loggedToday = new Set(s.entries.filter((e) => e.date === today).map((e) => e.slot));
  const out: ReminderItem[] = [];
  const upcoming = (date: string, time: string) => date > today || (date === today && hm(time) > nowMin + 1);
  for (let d = from > today ? from : today; d <= last; d = addDays(d, 1)) {
    for (const sl of s.settings.slots) {
      if (!r.meals[sl.id]) continue;
      if (d === today && loggedToday.has(sl.id)) continue; // כבר רשמת: אין צורך להזכיר
      if (!upcoming(d, sl.time)) continue;
      out.push({ id: `rem:m:${d}:${sl.id}`, title: `🍽 ${sl.name}: רשום מה אכלת`, date: d, time: sl.time, status: 'planned', durationMin: 10, alertMin: 0 });
    }
    if (r.weigh.on && dow(d) === r.weigh.dow && upcoming(d, r.weigh.time)) {
      const had = s.weights.some((w) => w.date === d);
      if (!(d === today && had)) out.push({ id: `rem:w:${d}`, title: '⚖️ שקילה שבועית', date: d, time: r.weigh.time, status: 'planned', durationMin: 10, alertMin: 0 });
    }
    if (r.close.on && upcoming(d, r.close.time)) out.push({ id: `rem:c:${d}`, title: '📝 סגירת יום: רשמת הכל?', date: d, time: r.close.time, status: 'planned', durationMin: 10, alertMin: 0 });
  }
  return out;
}

export interface PushItem { id: string; at: number; title: string; body: string }
const localMs = (date: string, time: string) => { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };

/** לוח ההתראות לשרת ה-Push: תזכורות + התראה לפני כל אימון, בשעות מוחלטות */
export function buildSchedule(s: State, now = new Date()): PushItem[] {
  const today = todayKey(s.settings.resetHour);
  const to = addDays(today, HORIZON);
  const out: PushItem[] = [];
  for (const r of buildReminders(s, today, to, now)) {
    const kind = r.id.split(':')[1];
    const [title, body] = r.title.includes(': ') ? r.title.split(': ') : [r.title, ''];
    const b = kind === 'm' ? 'רשום מה אכלת' : kind === 'w' ? 'עדיף בבוקר, לפני אוכל ושתייה' : kind === 'c' ? 'חסר משהו ביומן של היום?' : body;
    out.push({ id: r.id, at: localMs(r.date, r.time), title: kind === 'c' ? '📝 סגירת יום' : title, body: b });
  }
  const lead = s.settings.cal.alertMin > 0 ? s.settings.cal.alertMin : 30;
  for (const w of s.workouts) {
    if (w.status !== 'planned' || w.date < today || w.date > to) continue;
    const at = localMs(w.date, w.time) - lead * 60000;
    if (at > now.getTime()) out.push({ id: `wk:${w.id}`, at, title: `🏋 ${w.title}`, body: `מתחיל ב-${w.time}` });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** מפתח שמשתנה רק כשהתזכורות צריכות להשתנות (הגדרות, ארוחות, מה נרשם היום) */
export function reminderKey(s: State): string {
  const today = todayKey(s.settings.resetHour);
  return JSON.stringify([s.settings.remind, s.settings.slots, [...new Set(s.entries.filter((e) => e.date === today).map((e) => e.slot))].sort(), s.weights.some((w) => w.date === today), today]);
}

export interface Nudge { id: string; text: string; cta?: { label: string; kind: 'add' | 'progress' | 'train' | 'water'; slot?: string; workoutId?: string; title?: string; date?: string } }

/** "דחיפות" חכמות שמוצגות במסך היום כשאתה בתוך האפליקציה */
export function nudgesFor(s: State, now = new Date()): Nudge[] {
  if (!s.settings.remind.nudges) return [];
  const today = todayKey(s.settings.resetHour);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const info = dayInfo(s, today);
  const out: Nudge[] = [];

  const slots = [...s.settings.slots].filter((x) => x.id !== 'snack').sort((a, b) => hm(a.time) - hm(b.time));
  const missed = slots.filter((sl) => hm(sl.time) + 45 < nowMin && !info.entries.some((e) => e.slot === sl.id));
  // מזכירים רק על הארוחה האחרונה שהוחמצה, כדי לא להציף
  if (missed.length) {
    const sl = missed[missed.length - 1];
    out.push({ id: `meal:${sl.id}`, text: `עוד לא רשמת ${sl.name} (היה ב-${sl.time})`, cta: { label: 'רשום', kind: 'add', slot: sl.id } });
  }

  const remP = info.target.p - info.eaten.p;
  if (nowMin >= 19 * 60 && info.entries.length > 0 && remP > 25) {
    out.push({ id: 'protein', text: `חסרים לך ${Math.round(remP)} ג׳ חלבון להיום`, cta: { label: 'מה לאכול', kind: 'add' } });
  }

  const lastW = s.weights[s.weights.length - 1];
  if (lastW) {
    const days = Math.floor((Date.parse(today) - Date.parse(lastW.date)) / 86400_000);
    if (days >= 7) out.push({ id: 'weigh', text: `עברו ${days} ימים מהשקילה האחרונה`, cta: { label: 'הישקל', kind: 'progress' } });
  }

  for (const w of info.workouts) {
    if (w.status === 'planned' && hm(w.time) + 100 < nowMin) {
      out.push({ id: `train:${w.id}`, text: `האימון "${w.title}" היה ב-${w.time}. עשית אותו?`, cta: { label: 'רשום', kind: 'train', workoutId: w.id, title: w.title, date: w.date } });
    }
  }

  const goal = Math.round((s.settings.profile.weightKg * 35) / 250) * 250 + (info.training ? 500 : 0);
  const ml = s.water[today] ?? 0;
  if (nowMin >= 14 * 60 && ml < goal * 0.4) out.push({ id: 'water', text: `שתית ${(ml / 1000).toFixed(1)} ליטר מתוך ${(goal / 1000).toFixed(1)}`, cta: { label: '+ כוס', kind: 'water' } });
  return out.slice(0, 3);
}
