import { store } from '../core/state';
import { dayInfo } from '../core/calc';
import { DAY_NAMES, addDays, dow, todayKey } from '../core/dates';
import { dishPer100 } from '../core/meal';
import { getFood } from '../data/foodDb';

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

  if (info.entries.length) {
    out.push(`[ENTRIES LOGGED ON ${date}] (id | meal | name | kcal | protein)`);
    for (const e of info.entries.slice(0, 40)) out.push(`- ${e.id} | ${s.settings.slots.find((x) => x.id === e.slot)?.name ?? e.slot} | ${e.name} | ${Math.round(e.k)} | ${Math.round(e.p)}g`);
  }

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

  if (ai.shareData) {
    const foods: string[] = [];
    for (const d of s.dishes.slice(0, 8)) {
      const p = dishPer100(d);
      foods.push(`pot "${d.name}": per 100g cooked ${Math.round(p.k)} kcal, protein ${Math.round(p.p * 10) / 10}g, carbs ${Math.round(p.c * 10) / 10}g, fat ${Math.round(p.f * 10) / 10}g; ingredients: ${d.parts.map((x) => `${x.name} ${Math.round(x.amount)}${x.unit === 'g' ? 'g' : ''}`).join(', ')}; cooked weight ${d.cookedG}g${d.remainG != null ? `, remaining ${Math.round(d.remainG)}g` : ''}`);
    }
    for (const c of s.customFoods.slice(0, 15)) foods.push(`custom food "${c.name}": ${c.unit === 'g' ? 'per 100g' : 'per serving'} ${Math.round(c.per.k)} kcal, protein ${c.per.p}g, carbs ${c.per.c}g, fat ${c.per.f}g`);
    for (const [id, e] of Object.entries(s.foodEdits).slice(0, 15)) {
      const r = getFood(id, s);
      if (r) foods.push(`user-corrected values for "${r.name}": per 100g ${e.k} kcal, protein ${e.p}g, carbs ${e.c}g, fat ${e.f}g`);
    }
    if (foods.length) { out.push('[USER FOODS]'); foods.forEach((x) => out.push('- ' + x)); }
  }

  if (ai.memory.length) {
    out.push('[MEMORY]');
    for (const m of ai.memory) out.push(`- ${m}`);
  }
  return out.join('\n');
}
