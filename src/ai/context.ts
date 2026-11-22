import { store } from '../core/state';
import { dayInfo } from '../core/calc';
import { DAY_NAMES, addDays, dow, todayKey } from '../core/dates';

/**
 * בונה את בלוק "נתוני האפליקציה" שנשלח ל-AI עם ההודעה האחרונה: פרופיל, יעדים, 14 הימים האחרונים,
 * משקל, אימונים וזיכרון. אם המשתמש כיבה שיתוף נתונים, נשלח רק מה שנאכל היום והזיכרון.
 */
export function buildAppData(date: string): string {
  const s = store.get();
  const ai = s.settings.ai;
  const today = todayKey(s.settings.resetHour);
  const info = dayInfo(s, date);
  const out: string[] = [];

  out.push('[TODAY SO FAR]');
  out.push(`date ${date} (${DAY_NAMES[dow(date)]}); location ${info.place === 'dorm' ? 'dorm' : 'home'}; training ${info.training ? 'yes' : 'no'}.`);
  out.push(`eaten: ${info.eaten.k} kcal, protein ${info.eaten.p}g, carbs ${info.eaten.c}g, fat ${info.eaten.f}g. Targets today: ${info.target.k} kcal, protein ${info.target.p}g, carbs ${info.target.c}g, fat ${info.target.f}g.`);

  if (ai.shareData) {
    const p = s.settings.profile;
    const w = s.weights;
    const lastW = w[w.length - 1]?.kg ?? p.weightKg;
    out.push('[APP DATA]');
    out.push(`profile: age ${p.age}, height ${p.heightCm} cm, current weight ${lastW} kg, goal ${p.goalKg} kg, chosen pace ${p.pace}.`);
    const t = s.settings.targets;
    out.push(`targets: rest day ${t['dorm-rest'].k} kcal / ${t['dorm-rest'].p}g protein; training day ${t['dorm-train'].k} kcal / ${t['dorm-train'].p}g protein.`);
    const days: string[] = [];
    for (let i = 14; i >= 1; i--) {
      const d = addDays(today, -i);
      const di = dayInfo(s, d);
      if (di.entries.length) days.push(`${d.slice(5)} ${di.eaten.k}/${di.eaten.p}g${di.training ? ' (training)' : ''}`);
    }
    out.push(`last 14 days (kcal/protein; empty days omitted): ${days.join('; ') || 'no data yet'}.`);
    out.push(`weight log (recent): ${w.slice(-8).map((x) => `${x.date.slice(5)} ${x.kg}`).join('; ')}.`);
    const from = addDays(today, -14);
    const past = s.workouts.filter((x) => x.date >= from && x.date < today);
    const done = past.filter((x) => x.status === 'done').length;
    const skipped = past.filter((x) => x.status === 'skipped').length;
    const upcoming = s.workouts
      .filter((x) => x.date >= today && x.date <= addDays(today, 7) && x.status !== 'skipped')
      .map((x) => `${DAY_NAMES[dow(x.date)]} ${x.time} ${x.title}`);
    out.push(`workouts last 14 days: ${done} done, ${skipped} skipped, ${past.length - done - skipped} not marked. Next 7 days: ${upcoming.join('; ') || 'none'}.`);
  }

  if (ai.memory.length) {
    out.push('[MEMORY]');
    for (const m of ai.memory) out.push(`- ${m}`);
  }
  return out.join('\n');
}
