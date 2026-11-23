import type { Plan, PlanBlock, PlanDay, PlanEx, Session } from './types';

/**
 * תוכנית אימונים: ימים ← בלוקים (למשל "גב", "חזה") ← תרגילים (סטים × חזרות או שניות).
 * המערכת כללית: כל משתמש בונה תוכנית משלו, והתוכנית נשמרת רק במכשיר שלו.
 */
type Id = () => string;

const NUMW: Record<string, number> = {
  אחד: 1, אחת: 1, שני: 2, שתי: 2, שניים: 2, שתיים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6,
  שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, עשרים: 20, שלושים: 30,
};
const numOf = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : w in NUMW ? NUMW[w] : null);

const clean = (s: string) => s.replace(/[:：]+\s*$/, '').replace(/\s+/g, ' ').trim();

/** שורת תרגיל: "מתח רחב: שלושה סטים של חמישה חזרות", "פלאנק שלושה סטים של דקה", "פטישים 3 סטים 10 חזרות לכל יד" */
export function parseExerciseLine(line: string, id: Id): PlanEx | null {
  const toks = line.replace(/[:：,]/g, ' ').trim().split(/\s+/);
  const si = toks.findIndex((t) => /^סטים?$/.test(t));
  if (si < 1) return null;
  const sets = numOf(toks[si - 1]);
  if (!sets || sets > 20) return null;
  const name = clean(toks.slice(0, si - 1).join(' '));
  if (!name) return null;
  const rest = toks.slice(si + 1).filter((t) => t !== 'של' && t !== 'עם');
  let reps = 0;
  let unit: PlanEx['unit'] = 'reps';
  for (let i = 0; i < rest.length; i++) {
    const n = numOf(rest[i]);
    if (/^דקה$/.test(rest[i])) { reps = 60; unit = 'sec'; break; }
    if (/^דקות$/.test(rest[i]) && n === null && i > 0 && numOf(rest[i - 1])) { reps = (numOf(rest[i - 1]) ?? 1) * 60; unit = 'sec'; break; }
    if (n !== null) {
      const nx = rest[i + 1] ?? '';
      if (/^שני(ו)?ת$/.test(nx)) { reps = n; unit = 'sec'; break; }
      if (/^דקות?$/.test(nx)) { reps = n * 60; unit = 'sec'; break; }
      reps = n;
      break;
    }
  }
  const note = /לכל\s+(יד|רגל|צד)/.exec(line)?.[0];
  return { id: id(), name, sets, reps: reps || 10, unit, note };
}

/**
 * מנתח טקסט חופשי לתוכנית. כותרת שמתחילה ב"יום" פותחת יום, כותרת אחרת פותחת בלוק,
 * ושורה עם "סטים" היא תרגיל. כותרת בלי תרגילים שאחריה כותרת נוספת מתחברת אליה ("סיבוב ראשון · יד קידמית").
 */
export function parsePlanText(text: string, id: Id, fallbackName = 'התוכנית שלי'): Plan {
  const days: PlanDay[] = [];
  let day = null as PlanDay | null;
  let block = null as PlanBlock | null;
  let parent = '';
  let planName = fallbackName;
  const ensureDay = () => { if (!day) { day = { id: id(), name: 'יום אימון', blocks: [] }; days.push(day); } return day; };

  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;
    const ex = parseExerciseLine(line, id);
    if (ex) {
      const d = ensureDay();
      if (!block) { block = { id: id(), title: parent || 'תרגילים', exercises: [] }; d.blocks.push(block); }
      block.exercises.push(ex);
      continue;
    }
    if (/^(תוכנית|תכנית)\b/.test(line)) { planName = line.replace(/^(תוכנית|תכנית)\s*(אימונים)?\s*/, '').trim() || fallbackName; continue; }
    if (/^יום\s/.test(line)) {
      day = { id: id(), name: line, blocks: [] };
      days.push(day);
      block = null;
      parent = '';
      continue;
    }
    // כותרת בלוק
    const d = ensureDay();
    if (block && block.exercises.length === 0) {
      // כותרת בלי תרגילים אחרי כותרת קודמת: מחברים ("סיבוב ראשון · יד קידמית")
      parent = block.title;
      block.title = `${parent} · ${line}`;
      continue;
    }
    const sibling: string[] | null = block?.title.includes(' · ') ? block.title.split(' · ') : null;
    const firstWord = (s: string) => s.split(' ')[0];
    if (sibling && firstWord(sibling[sibling.length - 1]) === firstWord(line)) {
      block = { id: id(), title: `${sibling.slice(0, -1).join(' · ')} · ${line}`, exercises: [] };
    } else {
      block = { id: id(), title: line, exercises: [] };
    }
    d.blocks.push(block);
  }
  for (const dd of days) dd.blocks = dd.blocks.filter((b) => b.exercises.length > 0);
  return { id: id(), name: planName, days: days.filter((d) => d.blocks.length > 0), ts: Date.now() };
}

export const repsLabel = (e: PlanEx) => (e.unit === 'sec' ? (e.reps % 60 === 0 ? `${e.reps / 60} דק׳` : `${e.reps} שנ׳`) : `${e.reps}`);
export const exLabel = (e: PlanEx) => `${e.sets}×${repsLabel(e)}${e.kg ? ` · ${e.kg} ק״ג` : ''}${e.note ? ` · ${e.note}` : ''}`;

/** טקסט קריא של התוכנית: לשיתוף, ואותו אפשר להדביק שוב בייבוא */
export function planToText(plan: Plan): string {
  const out: string[] = [`תוכנית אימונים${plan.name ? ': ' + plan.name : ''}`];
  for (const d of plan.days) {
    out.push('', `${d.name}:`);
    for (const b of d.blocks) {
      out.push(`${b.title}:`);
      for (const e of b.exercises) {
        const reps = e.unit === 'sec' ? (e.reps % 60 === 0 ? (e.reps === 60 ? 'של דקה' : `של ${e.reps / 60} דקות`) : `של ${e.reps} שניות`) : `${e.reps} חזרות`;
        out.push(`   ${e.name}: ${e.sets} סטים ${reps}${e.note ? ' ' + e.note : ''}${e.kg ? ` (${e.kg} ק״ג)` : ''}`);
      }
    }
  }
  return out.join('\n');
}

/** מחזיר את היום בתוכנית שמתאים לשם האימון (שם זהה, או אחד מכיל את השני) */
export function dayForTitle(plans: Plan[], active: string | null, title: string): PlanDay | undefined {
  const order = [...plans].sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : 0));
  const t = title.trim();
  for (const p of order) {
    const hit = p.days.find((d) => d.name === t) ?? p.days.find((d) => t && (d.name.includes(t) || t.includes(d.name)));
    if (hit) return hit;
  }
  return undefined;
}

export interface Progress { text: string; next: Partial<PlanEx> }
/**
 * הצעת התקדמות: אם באימון האחרון עמדת בכל הסטים של התרגיל, מציעים להעלות קצת.
 * משקל: +2.5 ק״ג. משקל גוף: עוד חזרה (עד 15), ואחר כך עוד סט. זמן: +10 שניות.
 */
export function progressionFor(ex: PlanEx, sessions: Session[]): Progress | null {
  const last = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).find((s) => s.exercises.some((e) => e.name === ex.name));
  const done = last?.exercises.find((e) => e.name === ex.name);
  if (!done || done.sets.length < ex.sets) return null;
  if (!done.sets.every((s) => s.reps >= ex.reps)) return null;
  const maxKg = Math.max(0, ...done.sets.map((s) => s.kg));
  if (ex.unit === 'sec') return { text: `עמדת בכל הסטים. אפשר ${ex.sets}×${ex.reps + 10} שנ׳`, next: { reps: ex.reps + 10 } };
  if (maxKg > 0) return { text: `עמדת בכל הסטים עם ${maxKg} ק״ג. אפשר ${maxKg + 2.5} ק״ג`, next: { kg: maxKg + 2.5 } };
  if (ex.reps < 15) return { text: `עמדת בכל הסטים. אפשר ${ex.sets}×${ex.reps + 1}`, next: { reps: ex.reps + 1 } };
  return { text: `עמדת בכל הסטים עם ${ex.reps}. אפשר סט נוסף או גרסה קשה יותר`, next: { sets: ex.sets + 1 } };
}
