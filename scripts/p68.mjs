import { readFileSync, writeFileSync } from 'node:fs';
const rw = (f, fn) => { const p = new URL('../' + f, import.meta.url); const a = readFileSync(p, 'utf8'); const b = fn(a); if (a === b) throw new Error('no change ' + f); writeFileSync(p, b); };
const mk = (o) => (a, b) => { if (!o.v.includes(a)) throw new Error('missing ' + a.slice(0, 70)); o.v = o.v.replace(a, () => b); };

rw('src/core/plan.ts', (t) => {
  const o = { v: t }; const rep = mk(o);
  rep("export interface WeekItem { dow: number; day: string }", "export interface WeekItem { dow: number; day: string; time?: string }");
  rep("    if (Number.isInteger(dow) && dow >= 0 && dow <= 6 && day && !out.some((o) => o.dow === dow)) out.push({ dow, day: day.name });", "    const time = typeof (x as { time?: unknown }).time === 'string' && /^([01]\\d|2[0-3]):[0-5]\\d$/.test((x as { time: string }).time) ? (x as { time: string }).time : undefined;\n    if (Number.isInteger(dow) && dow >= 0 && dow <= 6 && day && !out.some((o) => o.dow === dow)) out.push({ dow, day: day.name, time });");
  rep("  return routine.filter((r) => plan.days.some((d) => d.name === r.title)).map((r) => ({ dow: r.dow, day: r.title })).sort((a, b) => a.dow - b.dow);", "  return routine.filter((r) => plan.days.some((d) => d.name === r.title)).map((r) => ({ dow: r.dow, day: r.title, time: r.time })).sort((a, b) => a.dow - b.dow);");
  return o.v;
});

rw('src/ai/planchat.ts', (t) => {
  const o = { v: t }; const rep = mk(o);
  rep("import type { Plan } from '../core/types';", "import { bridge } from '../core/bridge';\nimport { eventsOn, hhmm } from '../core/conflicts';\nimport { addDays, dow, todayKey } from '../core/dates';\nimport type { Plan } from '../core/types';");
  rep("- For users under 18:", `- THE CALENDAR: the [CONTEXT] also contains his real calendar ([CALENDAR]): events for the next 14 days and what usually repeats each week. Use it to schedule: put workouts in free windows, never on top of an event, leave time before and after, and tell him when a day is busy. If the calendar is not connected or sharing is off, say you cannot see it and ask about his busy hours.
- BE A PARTNER, DO NOT JUST DECIDE: do not lock the schedule on your own. When there is a real choice (which days, morning or evening, how long before or after his commitments), ask him a short question first, or offer two concrete options and let him pick. Ask at least one relevant question before you propose times for the first time. Once he agrees, put it in "week".
- You can also help him plan other things around training when he asks (meal timing, sleep, rest, a busy week), using the calendar.
- For users under 18:`);
  rep('"week":[{"dow":0-6,"day":"exact day name in the draft"}]}', '"week":[{"dow":0-6,"day":"exact day name in the draft","time":"HH:MM optional"}]}');
  return o.v;
});
console.log('ok');
