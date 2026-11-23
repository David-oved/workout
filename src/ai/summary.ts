import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { DAY_NAMES, addDays, dow, todayKey } from '../core/dates';
import { e1rm } from '../data/exercises';
import { chatTurn } from './gemini';
import { buildAppData } from './context';
import type { State } from '../core/types';

/**
 * סיכום סוף יום מה-AI: מה אכלת מול היעד, האימון (כולל סטים ושיאים), מה לשפר והמלצה למחר.
 * הסיכום נשמר לכל תאריך, כך שפותחים אותו שוב בלי לקרוא ל-API.
 */
export interface DayFacts { lines: string[]; stats: { k: number; tk: number; p: number; tp: number; training: string } }

const slotName = (s: State, id: string) => s.settings.slots.find((x) => x.id === id)?.name ?? id;

export function dayFacts(s: State, date: string): DayFacts {
  const info = dayInfo(s, date);
  const lines: string[] = [];
  lines.push(`date ${date} (${DAY_NAMES[dow(date)]}); location ${info.place}; ${info.training ? 'training day' : 'rest day'}.`);
  const e = info.eaten, t = info.target;
  lines.push(`eaten: ${e.k} kcal (${Math.round((e.k / t.k) * 100)}% of ${t.k}), protein ${e.p}g of ${t.p}, carbs ${e.c}g of ${t.c}, fat ${e.f}g of ${t.f}.`);
  const meals = info.entries.map((x) => `${slotName(s, x.slot)}: ${x.name} (${x.k} kcal, ${x.p}g protein)`);
  lines.push(meals.length ? `meals logged:\n- ${meals.join('\n- ')}` : 'no meals logged.');
  const ml = s.water[date] ?? 0;
  lines.push(`water: ${(ml / 1000).toFixed(2)} L.`);

  const planned = info.workouts.filter((w) => w.status !== 'skipped');
  const sess = s.sessions.filter((x) => x.date === date);
  let training = 'מנוחה';
  if (planned.length) {
    training = planned.every((w) => w.status === 'done') ? 'בוצע' : planned.some((w) => w.status === 'done') ? 'בוצע חלקית' : 'לא סומן';
    lines.push(`workouts: ${planned.map((w) => `${w.time} ${w.title} (${w.status})`).join('; ')}.`);
  } else lines.push('no workout planned (rest day).');
  for (const x of sess) {
    const vol = x.exercises.reduce((a, ex) => a + ex.sets.reduce((b, y) => b + y.kg * y.reps, 0), 0);
    lines.push(`training log "${x.title}": total volume ${Math.round(vol)} kg.\n- ${x.exercises.map((ex) => `${ex.name}: ${ex.sets.map((y) => (y.kg ? `${y.kg}x${y.reps}` : `${y.reps} reps`)).join(', ')}`).join('\n- ')}`);
    const prs: string[] = [];
    for (const ex of x.exercises) {
      const prev = s.sessions.filter((o) => o.id !== x.id && o.date < date).flatMap((o) => o.exercises.filter((y) => y.name === ex.name)).flatMap((y) => y.sets);
      if (prev.length && ex.sets.some((y) => y.kg > 0 && e1rm(y.kg, y.reps) > Math.max(...prev.map((z) => e1rm(z.kg, z.reps))) + 0.4)) prs.push(ex.name);
    }
    if (prs.length) lines.push(`new personal records today: ${prs.join(', ')}.`);
  }
  if (planned.length && !sess.length) lines.push('no sets were logged in the training log for this workout.');

  const prev7: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i);
    const di = dayInfo(s, d);
    if (di.entries.length) prev7.push(`${d.slice(5)} ${di.eaten.k} kcal / ${di.eaten.p}g protein`);
  }
  if (prev7.length) lines.push(`previous 7 days (kcal / protein): ${prev7.join('; ')}.`);
  const w = s.weights.slice(-6).map((x) => `${x.date.slice(5)} ${x.kg}`).join('; ');
  if (w) lines.push(`weight log: ${w}; goal ${s.settings.profile.goalKg} kg.`);
  return { lines, stats: { k: e.k, tk: t.k, p: e.p, tp: t.p, training } };
}

/** סיכום בסיסי בלי AI, שמוצג מיד (ואם אין חיבור ל-AI) */
export function ruleSummary(s: State, date: string): string[] {
  const f = dayFacts(s, date).stats;
  const out: string[] = [];
  out.push(`קלוריות: ${fmt(f.k)} מתוך ${fmt(f.tk)} (${Math.round((f.k / f.tk) * 100)}%)`);
  out.push(`חלבון: ${fmt(f.p)} מתוך ${fmt(f.tp)} ג׳${f.p < f.tp * 0.9 ? `, חסרו ${fmt(f.tp - f.p)}` : ''}`);
  out.push(`אימון: ${f.training}`);
  return out;
}

const INSTR = `Write his END-OF-DAY SUMMARY in Hebrew, as a short message with four bold headings. Be specific and use his real numbers, compare them with his targets, and do not invent anything that is not in the data below.
**איך אכלת** - what went well and what fell short today (calories, protein, meal timing/gaps).
**אימון** - what he trained and how it went (sets, volume, records). If he had no workout, say it was a rest day; if a workout was planned but nothing was logged, say so and ask him to log it next time.
**מה לשפר** - the 1 or 2 most important things, concrete.
**מחר** - one concrete recommendation: what to eat and roughly when (use that day's dorm/home location), and anything for training or recovery.
Keep it under 170 words, direct and warm, no lecture. If almost nothing was logged, say that honestly and keep it very short. Return "items": [] and "products": [].`;

export async function generateSummary(date: string): Promise<string> {
  const s = store.get();
  const facts = dayFacts(s, date).lines.join('\n');
  const text = `[DAY SUMMARY REQUEST]\n${INSTR}\n\n[DAY DATA]\n${facts}\n\n${buildAppData(date)}`;
  const res = await chatTurn([{ role: 'user', text }], { web: false, deep: false, docs: false, onStage: () => undefined, onDelta: () => undefined });
  const reply = res.reply.trim();
  if (!reply) throw new Error('לא התקבל סיכום. נסה שוב');
  actions.saveSummary(date, { text: reply, ts: Date.now(), model: res.model });
  return reply;
}

export const summaryDate = (s: State) => todayKey(s.settings.resetHour);
