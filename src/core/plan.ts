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

/** תרגילים שנמדדים בזמן (החזקה) ולא בחזרות */
const TIME_RE = /פלאנק|plank|תלייה|תליה|הנגה|ישיבת קיר|wall sit|הליכת (איכר|חווה)|farmer|החזק|סטטי|hollow|הולואו|l-?sit|ספלט|מתיחה|מתיחות|סירה|גשר|בלט/i;
export const isTimeBased = (name: string) => TIME_RE.test(name);

/** מתקן יחידה לפי סוג התרגיל: פלאנק ותלייה בשניות, שכיבות סמיכה ומתח בחזרות */
export function normalizeEx(e: PlanEx): PlanEx {
  if (isTimeBased(e.name) && e.unit === 'reps') return { ...e, unit: 'sec', reps: e.reps >= 15 ? e.reps : 45 };
  return e;
}

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
  return normalizeEx({ id: id(), name, sets, reps: reps || 10, unit, note });
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

export interface WeekItem { dow: number; day: string; time?: string }

/** ממיר JSON של תוכנית (מה-AI) לתוכנית תקינה עם מזהים, ומסנן ערכים לא הגיוניים */
export function planFromJson(j: any, keepName: string, id: Id): Plan | null {
  const src = j?.plan ?? j;
  const days: PlanDay[] = [];
  for (const d of Array.isArray(src?.days) ? src.days : []) {
    const blocks: PlanBlock[] = [];
    for (const b of Array.isArray(d?.blocks) ? d.blocks : []) {
      const exercises: PlanEx[] = [];
      for (const e of Array.isArray(b?.exercises) ? b.exercises : []) {
        const name = String(e?.name ?? '').trim();
        if (!name) continue;
        exercises.push(normalizeEx({ id: id(), name, sets: Math.min(20, Math.max(1, Math.round(Number(e.sets) || 3))), reps: Math.min(600, Math.max(1, Math.round(Number(e.reps) || 10))), unit: e.unit === 'sec' ? 'sec' : 'reps', kg: Number(e.kg) > 0 ? Number(e.kg) : undefined, note: e.note ? String(e.note).slice(0, 40) : undefined }));
      }
      if (exercises.length) blocks.push({ id: id(), title: String(b?.title ?? 'תרגילים').slice(0, 60), exercises });
    }
    if (blocks.length) days.push({ id: id(), name: String(d?.name ?? 'יום אימון').slice(0, 40), blocks });
  }
  return days.length ? { id: id(), name: String(src?.name ?? keepName).slice(0, 40), days, ts: Date.now() } : null;
}

export function parseJsonLoose(raw: string): any {
  const t = raw.replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('התשובה לא הייתה JSON');
  return JSON.parse(t.slice(a, b + 1));
}

/** חלוקה שבועית מתוך ימי האימון הקבועים: איזה יום בתוכנית באיזה יום בשבוע */
export function weekFromRoutine(routine: { dow: number; title: string; time?: string }[], plan: Plan | undefined): WeekItem[] {
  if (!plan) return [];
  return routine.filter((r) => plan.days.some((d) => d.name === r.title)).map((r) => ({ dow: r.dow, day: r.title, time: r.time })).sort((a, b) => a.dow - b.dow);
}

export function cleanWeek(w: unknown, plan: Plan): WeekItem[] {
  if (!Array.isArray(w)) return [];
  const out: WeekItem[] = [];
  for (const x of w as { dow?: unknown; day?: unknown }[]) {
    const dow = Number(x?.dow);
    const day = plan.days.find((d) => d.name === String(x?.day ?? ''));
    const time = typeof (x as { time?: unknown }).time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test((x as { time: string }).time) ? (x as { time: string }).time : undefined;
    if (Number.isInteger(dow) && dow >= 0 && dow <= 6 && day && !out.some((o) => o.dow === dow)) out.push({ dow, day: day.name, time });
  }
  return out.sort((a, b) => a.dow - b.dow);
}

/* ===== עריכה בפעולות: ה-AI מחזיר "מה לשנות" והאפליקציה מבצעת בדיוק, גם בתוכנית עם מאות תרגילים ===== */
export interface ExIn { name?: string; sets?: number; reps?: number; unit?: string; kg?: number | null; note?: string | null }
export interface Op { op: string; day?: string; block?: string; name?: string; to?: string; after?: string; fromDay?: string; toDay?: string; toBlock?: string; exercise?: ExIn; with?: ExIn; set?: ExIn; title?: string; blocks?: unknown[]; exercises?: ExIn[] }

const norm = (s: unknown) => String(s ?? '').replace(/[״"׳'.,:()\-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

function mkEx(i: ExIn, id: Id, base?: PlanEx): PlanEx {
  const e: PlanEx = {
    id: base?.id ?? id(),
    name: String(i.name ?? base?.name ?? 'תרגיל').slice(0, 60),
    sets: Math.min(20, Math.max(1, Math.round(Number(i.sets ?? base?.sets ?? 3)))),
    reps: Math.min(600, Math.max(1, Math.round(Number(i.reps ?? base?.reps ?? 10)))),
    unit: (i.unit ?? base?.unit) === 'sec' ? 'sec' : 'reps',
    kg: i.kg === null ? undefined : Number(i.kg ?? base?.kg) > 0 ? Number(i.kg ?? base?.kg) : undefined,
    note: i.note === null ? undefined : (i.note ?? base?.note) ? String(i.note ?? base?.note).slice(0, 40) : undefined,
  };
  // אם ה-AI לא ציין יחידה מפורשת, הסוג נקבע לפי שם התרגיל
  return i.unit === undefined && !base ? normalizeEx(e) : e;
}

/** מבצע פעולות על עותק של התוכנית. מחזיר את התוכנית החדשה ורשימה קריאה של מה שבוצע (ושל מה שלא נמצא) */
export function applyOps(plan: Plan, ops: Op[], id: Id): { plan: Plan; log: string[] } {
  const p: Plan = JSON.parse(JSON.stringify(plan));
  const log: string[] = [];
  const findDay = (n?: string) => (n ? p.days.find((d) => d.name === n) ?? p.days.find((d) => same(d.name, n)) : undefined);
  const findEx = (name: string, dayName?: string) => {
    const days = dayName ? [findDay(dayName)].filter(Boolean) as PlanDay[] : p.days;
    for (const d of days) for (const b of d.blocks) {
      const e = b.exercises.find((x) => x.name === name) ?? b.exercises.find((x) => same(x.name, name));
      if (e) return { d, b, e };
    }
    return null;
  };
  const blockFor = (d: PlanDay, title?: string) => {
    if (title) { const b = d.blocks.find((x) => x.title === title) ?? d.blocks.find((x) => same(x.title, title)); if (b) return b; const nb: PlanBlock = { id: id(), title: title.slice(0, 60), exercises: [] }; d.blocks.push(nb); return nb; }
    if (!d.blocks.length) d.blocks.push({ id: id(), title: 'תרגילים', exercises: [] });
    return d.blocks[d.blocks.length - 1];
  };

  for (const o of ops) {
    try {
      switch (o.op) {
        case 'setPlanName': if (o.name) { p.name = o.name.slice(0, 40); log.push('שם התוכנית: ' + p.name); } break;
        case 'addDay': {
          const name = String(o.name ?? o.day ?? 'יום חדש').slice(0, 40);
          const blocks: PlanBlock[] = [];
          const src = (Array.isArray(o.blocks) ? o.blocks : []) as { title?: string; exercises?: ExIn[] }[];
          for (const b of src) blocks.push({ id: id(), title: String(b.title ?? 'תרגילים').slice(0, 60), exercises: (b.exercises ?? []).filter((e) => e?.name).map((e) => mkEx(e, id)) });
          p.days.push({ id: id(), name, blocks });
          log.push(`נוסף יום: ${name}`);
          break;
        }
        case 'removeDay': { const d = findDay(o.day); if (d) { p.days = p.days.filter((x) => x !== d); log.push(`הוסר יום: ${d.name}`); } else log.push(`לא נמצא יום: ${o.day}`); break; }
        case 'renameDay': { const d = findDay(o.day); if (d && o.to) { log.push(`${d.name} ← ${o.to}`); d.name = o.to.slice(0, 40); } break; }
        case 'addBlock': { const d = findDay(o.day); if (d) { d.blocks.push({ id: id(), title: String(o.title ?? 'קבוצה').slice(0, 60), exercises: (o.exercises ?? []).filter((e) => e?.name).map((e) => mkEx(e, id)) }); log.push(`נוספה קבוצה ${o.title} ל${d.name}`); } break; }
        case 'removeBlock': { const d = findDay(o.day); const b = d?.blocks.find((x) => same(x.title, String(o.block ?? o.title ?? ''))); if (d && b) { d.blocks = d.blocks.filter((x) => x !== b); log.push(`הוסרה קבוצה ${b.title}`); } break; }
        case 'addExercise': {
          const d = findDay(o.day) ?? p.days[0];
          if (!d || !o.exercise?.name) break;
          const b = blockFor(d, o.block);
          const e = mkEx(o.exercise, id);
          const at = o.after ? b.exercises.findIndex((x) => same(x.name, o.after!)) : -1;
          if (at >= 0) b.exercises.splice(at + 1, 0, e); else b.exercises.push(e);
          log.push(`נוסף: ${e.name} (${exLabel(e)}) ל${d.name}`);
          break;
        }
        case 'removeExercise': { const f = findEx(String(o.name ?? ''), o.day); if (f) { f.b.exercises = f.b.exercises.filter((x) => x !== f.e); log.push(`הוסר: ${f.e.name}`); } else log.push(`לא נמצא תרגיל: ${o.name}`); break; }
        case 'updateExercise': { const f = findEx(String(o.name ?? ''), o.day); if (f && o.set) { const n = mkEx(o.set, id, f.e); f.b.exercises = f.b.exercises.map((x) => (x === f.e ? n : x)); log.push(`עודכן: ${n.name} (${exLabel(n)})`); } else log.push(`לא נמצא תרגיל: ${o.name}`); break; }
        case 'replaceExercise': { const f = findEx(String(o.name ?? ''), o.day); if (f && o.with) { const n = mkEx(o.with, id, undefined); f.b.exercises = f.b.exercises.map((x) => (x === f.e ? n : x)); log.push(`${f.e.name} הוחלף ב-${n.name} (${exLabel(n)})`); } else log.push(`לא נמצא תרגיל: ${o.name}`); break; }
        case 'moveExercise': {
          const f = findEx(String(o.name ?? ''), o.fromDay);
          const to = findDay(o.toDay ?? o.day);
          if (f && to) { f.b.exercises = f.b.exercises.filter((x) => x !== f.e); blockFor(to, o.toBlock ?? o.block).exercises.push(f.e); log.push(`${f.e.name} הועבר ל${to.name}`); }
          break;
        }
        default: break;
      }
    } catch { /* פעולה שגויה: מדלגים */ }
  }
  p.days.forEach((d) => { d.blocks = d.blocks.filter((b) => b.exercises.length > 0); });
  p.days = p.days.filter((d) => d.blocks.length > 0 || ops.some((o) => o.op === 'addDay'));
  return { plan: p, log };
}

/** האם ההודעה נראית כמו תוכנית שלמה שהודבקה (מנתחים מקומית, בלי AI) */
export function looksLikePlan(text: string, id: Id): Plan | null {
  const p = parsePlanText(text, id);
  const n = p.days.reduce((a, d) => a + d.blocks.reduce((b, x) => b + x.exercises.length, 0), 0);
  return n >= 3 ? p : null;
}
