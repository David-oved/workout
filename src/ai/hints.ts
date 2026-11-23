import { store } from '../core/state';
import { stems } from '../core/parse';
import { loadDb, searchFoods } from '../data/foodDb';
import { bridge } from '../core/bridge';
import { eventsOn, hhmm } from '../core/conflicts';
import { DAY_NAMES, dow, todayKey } from '../core/dates';

/**
 * שני בלוקים שמצטרפים להודעה האחרונה ל-AI:
 * [NOW] שעה, זמנים, אימונים ויומן של היום, כדי שיידע "מה השעה ומה מחכה לי".
 * [DATABASE MATCHES] התאמות ממאגר משרד הבריאות ומהמזונות האישיים לכל מה שהזכרת, כדי שיעבוד עם ערכים אמיתיים.
 */
export function nowBlock(): string {
  const s = store.get();
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const today = todayKey(s.settings.resetHour);
  const hh = d.getHours();
  const part = hh < 5 ? 'night' : hh < 12 ? 'morning' : hh < 17 ? 'afternoon' : hh < 21 ? 'evening' : 'night';
  const out: string[] = ['[NOW]'];
  out.push(`local time ${today} ${p(hh)}:${p(d.getMinutes())} (${DAY_NAMES[dow(today)]}, ${part}); time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`);
  const meals = s.entries.filter((e) => e.date === today).sort((a, b) => b.ts - a.ts);
  if (meals.length) {
    const mins = Math.max(0, Math.round((Date.now() - meals[0].ts) / 60000));
    out.push(`last meal logged today: "${meals[0].name}" ${mins} minutes ago (${meals.length} entries today).`);
  } else out.push('nothing logged yet today.');
  const w = s.workouts.filter((x) => x.date === today && x.status !== 'skipped').map((x) => `${x.time} ${x.title}${x.status === 'done' ? ' (done)' : ''}`);
  if (w.length) out.push(`workouts today: ${w.join('; ')}.`);
  const ev = eventsOn(bridge.get().events, today);
  const evs = [...ev.timed.map((e) => `${hhmm(e.start)}-${hhmm(e.end)} ${e.title}`), ...ev.allDay.map((e) => `all day: ${e.title}`)].slice(0, 8);
  if (evs.length) out.push(`calendar today: ${evs.join('; ')}.`);
  return out.join('\n');
}

const STOP = new Set(['אכלתי', 'אכלנו', 'שתיתי', 'אכל', 'היה', 'הייתה', 'היו', 'קצת', 'בערך', 'כמו', 'עוד', 'גם', 'אבל', 'כל', 'יש', 'אין', 'של', 'עם', 'על', 'את', 'זה', 'זאת', 'הזה', 'אני', 'לי', 'מה', 'איך', 'כמה', 'האם', 'ארוחה', 'ארוחת', 'צהריים', 'בוקר', 'ערב', 'אחר', 'גרם', 'גרמים', 'כף', 'כפות', 'כפית', 'כוס', 'פרוסה', 'פרוסות', 'יחידה', 'יחידות', 'חלבון', 'קלוריות', 'פחמימה', 'שומן', 'הכל', 'משהו', 'היום', 'אתמול', 'עכשיו', 'מאוד', 'לפני', 'אחרי', 'בסוף', 'בסך', 'סך']);

export async function foodHints(text: string): Promise<string> {
  const t = text.trim();
  if (!t) return '';
  await loadDb();
  const s = store.get();
  const words = [...new Set(t.replace(/[0-9]+(?:[.,][0-9]+)?/g, ' ').split(/[^א-תa-zA-Z']+/).map((w) => w.replace(/^[והבלכמש](?=[א-ת]{4,})/, '')).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 10);
  const lines: string[] = [];
  const seen = new Set<string>();
  const fmt = (f: ReturnType<typeof searchFoods>[number]) => `${f.name}${f.src === 'c' ? ' [his own product]' : f.edited ? ' [his corrected values]' : ''}: ${f.unit === 'g' ? 'per 100 g' : 'per serving'} ${Math.round(f.per.k)} kcal, protein ${Math.round(f.per.p * 10) / 10}g, carbs ${Math.round(f.per.c * 10) / 10}g, fat ${Math.round(f.per.f * 10) / 10}g${f.portions.length ? `; portions ${f.portions.map((x) => `${x.l}=${x.g}g`).join(', ')}` : ''}`;
  for (const d of s.dishes) if (t.includes(d.name)) lines.push(`- his saved pot "${d.name}" (see [USER FOODS])`);
  for (const w of words) {
    let res: ReturnType<typeof searchFoods> = [];
    for (const v of stems(w)) { res = searchFoods(v, s, 6).filter((f) => f.src !== 'b'); if (res.length) break; }
    res = res.filter((f) => !seen.has(f.id)).slice(0, 2);
    if (!res.length) continue;
    res.forEach((f) => seen.add(f.id));
    lines.push(`- "${w}" → ${res.map(fmt).join(' | ')}`);
  }
  const head = '[DATABASE MATCHES]';
  if (!lines.length) return [head, 'no foods from his message were found in the database'].join(String.fromCharCode(10));
  return [head, ...lines].join(String.fromCharCode(10));
}
