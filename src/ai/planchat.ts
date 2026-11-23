import { createStore } from '../core/store';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { DAY_NAMES, uid } from '../core/dates';
import { applyOps, cleanWeek, looksLikePlan, parseJsonLoose, planFromJson, planToText, weekFromRoutine, type Op, type WeekItem } from '../core/plan';
import { bridge } from '../core/bridge';
import { eventsOn, hhmm } from '../core/conflicts';
import { addDays, dow, todayKey } from '../core/dates';
import type { Plan } from '../core/types';
import { chatTurn, type ChatTurn } from './gemini';

/**
 * שיחה עם ה-AI על בניית התוכנית. יש "טיוטה" אחת חיה (התוכנית שמוצגת בכרטיס), וה-AI משנה אותה בפעולות מדויקות
 * (להוסיף, להחליף, לעדכן, להסיר, להעביר), כך שזה עובד גם על תוכנית של מאות תרגילים בלי לאבד כלום.
 * תוכנית שמודבקת בהודעה מנותחת מקומית לטיוטה, וה-AI בודק אותה ושואל מה לא ברור. כלום לא נשמר בלי אישור.
 */
export interface PMsg { id: string; role: 'user' | 'ai'; text: string; log?: string[] }
interface PState { messages: PMsg[]; busy: boolean; error?: string; draft: Plan | null; week: WeekItem[]; draftAt: string | null }

const LS = 'wo:plan-chat2';
function load(): PState {
  try {
    const j = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (j && Array.isArray(j.messages)) return { messages: j.messages, busy: false, draft: j.draft ?? null, week: j.week ?? [], draftAt: j.draftAt ?? null };
  } catch { /* ignore */ }
  return { messages: [], busy: false, draft: null, week: [], draftAt: null };
}
export const planChat = createStore<PState>(load());
const save = () => { try { const s = planChat.get(); localStorage.setItem(LS, JSON.stringify({ messages: s.messages.slice(-30), draft: s.draft, week: s.week, draftAt: s.draftAt })); } catch { /* ignore */ } };
const setS = (fn: (s: PState) => PState) => { planChat.set(fn); save(); };

const SYS = `You are a smart, practical strength and fitness coach who builds and edits the user's weekly workout plan through a short Hebrew conversation. Casual, warm, SHORT messages (max ~60 words), at most ONE question at a time.

THE DRAFT: the message ends with [CONTEXT] that includes THE DRAFT PLAN, which the user sees live as a card. It is the single source of truth. NEVER rewrite the whole plan to change it. Change it ONLY with "ops" (exact operations the app applies to the draft), so nothing gets lost, even if the plan has hundreds of exercises. Use a full "plan" only to build a brand new plan from scratch.

You must understand EXERCISES, not just names:
- Time-based exercises use unit "sec" and "reps" holds the SECONDS: plank, side plank, hang, dead hang, wall sit, L-sit, hollow hold, farmer walk, isometric holds, stretches. A one-minute plank is reps 60, unit "sec".
- Everything else uses unit "reps": push-ups, pull-ups, Australian rows, dips, squats, curls, presses, crunches, bicycle crunches and so on. Weighted exercises get "kg". Per-side exercises get note "לכל יד" or "לכל רגל".
- Every exercise needs sets, reps and unit. If he did not say, choose sensible defaults for his level and goal (for example 3 sets of 8-12 reps; holds 30-60 seconds) and say you assumed.
- When he tells you a day by muscle groups or by place ("park day: back and chest") and wants you to fill it in, propose the COMPLETE list of fitting exercises with sets, reps or seconds, using what equipment exists at that place (a park usually means pull-up bar, parallel bars, benches and rings; a room usually means bodyweight and light dumbbells). Ask about equipment only if it really changes the plan.
- When he sends a long text with many exercises, the app has ALREADY parsed it into the draft. Check it: typos, unclear or odd exercise names, wrong units, missing sets or reps, duplicates. Fix clear mistakes with ops and mention them, and ask about what is unclear. Do not re-send the exercises.
- Plan the week intelligently from the exercises: do not hit the same muscle group on consecutive days, keep at least one rest day, put the hardest days after rest, respect where he is on each weekday (the context lists it). Return the full "week" whenever you propose or change the split.
- THE CALENDAR: the [CONTEXT] also contains his real calendar ([CALENDAR]): events for the next 14 days and what usually repeats each week. Use it to schedule: put workouts in free windows, never on top of an event, leave time before and after, and tell him when a day is busy. If the calendar is not connected or sharing is off, say you cannot see it and ask about his busy hours.
- BE A PARTNER, DO NOT JUST DECIDE: do not lock the schedule on your own. When there is a real choice (which days, morning or evening, how long before or after his commitments), ask him a short question first, or offer two concrete options and let him pick. Ask at least one relevant question before you propose times for the first time. Once he agrees, put it in "week".
- You can also help him plan other things around training when he asks (meal timing, sleep, rest, a busy week), using the calendar.
- For users under 18: modest volume, no max-effort lifts, technique first. No steroids or risky advice.

Return ONE JSON object only:
{"reply":"Hebrew message","ops":[Op],"plan":{...optional, only to start from scratch},"week":[{"dow":0-6,"day":"exact day name in the draft","time":"HH:MM optional"}]}
"ops", "plan" and "week" are all OPTIONAL: omit them when nothing changes. "dow": 0 = Sunday ... 6 = Saturday; only training days appear in "week".
Op forms (day and exercise names are matched loosely, in Hebrew):
{"op":"addExercise","day":"יום פארק","block":"גב","exercise":{"name":string,"sets":number,"reps":number,"unit":"reps"|"sec","kg":number,"note":string},"after":"existing exercise name (optional)"}
{"op":"updateExercise","day":"optional","name":"existing name","set":{"name","sets","reps","unit","kg","note" - only the fields that change}}
{"op":"replaceExercise","day":"optional","name":"existing name","with":{...exercise}}
{"op":"removeExercise","day":"optional","name":"existing name"}
{"op":"moveExercise","name":string,"fromDay":"optional","toDay":string,"toBlock":"optional"}
{"op":"addDay","name":"יום רגליים","blocks":[{"title":string,"exercises":[{...exercise}]}]}
{"op":"removeDay","day":string} {"op":"renameDay","day":string,"to":string} {"op":"addBlock","day":string,"title":string,"exercises":[...]} {"op":"removeBlock","day":string,"block":string} {"op":"setPlanName","name":string}`;

/** היומן האמיתי שלו: אירועים ל-14 הימים הקרובים, ומה שחוזר כל שבוע (מ-4 השבועות האחרונים), כדי לתזמן אימונים בחלונות פנויים */
function calendarBlock(): string {
  const s = store.get();
  const b = bridge.get();
  if (!b.connected) return '[CALENDAR] not connected: you cannot see his calendar. Ask him about his busy hours.';
  if (!s.settings.ai.shareData) return '[CALENDAR] sharing of app data with the AI is turned off, so you cannot see his calendar. Ask him about his busy hours.';
  const today = todayKey(s.settings.resetHour);
  const ev = (list: { start: string; end: string; title: string; allDay: boolean }[]) => list.map((e) => (e.allDay ? 'all day ' + e.title : hhmm(e.start) + '-' + hhmm(e.end) + ' ' + e.title));
  const up: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, i);
    const x = eventsOn(b.events, d);
    const items = [...ev(x.timed), ...ev(x.allDay)];
    if (items.length) up.push(d.slice(5) + ' ' + DAY_NAMES[dow(d)] + ': ' + items.join('; '));
  }
  const rep = new Map<string, number>();
  for (let i = 1; i <= 28; i++) {
    const d = addDays(today, -i);
    for (const e of eventsOn(b.events, d).timed) { const k = DAY_NAMES[dow(d)] + ' ' + hhmm(e.start) + '-' + hhmm(e.end) + ' ' + e.title; rep.set(k, (rep.get(k) ?? 0) + 1); }
  }
  const usual = [...rep.entries()].filter(([, n]) => n >= 2).sort((a, c) => c[1] - a[1]).slice(0, 20).map(([k, n]) => k + ' (x' + n + ')');
  const NL = String.fromCharCode(10);
  return ['[CALENDAR]', up.length ? 'next 14 days:' + NL + up.slice(0, 30).join(NL) : 'no events in the next 14 days.', usual.length ? 'usually repeats weekly:' + NL + usual.join(NL) : ''].filter(Boolean).join(NL);
}

function context(parsed: boolean): string {
  const s = store.get();
  const p = s.settings.profile;
  const d = planChat.get().draft;
  const places = s.settings.places.map((x, i) => `${DAY_NAMES[i]}: ${x === 'dorm' ? 'dorm' : 'home'}`).join(', ');
  const routine = s.settings.routine.map((r) => `${DAY_NAMES[r.dow]} ${r.time} ${r.title}`).join('; ') || 'none';
  const mem = s.settings.ai.memory.slice(-8).join('; ');
  const wk = planChat.get().week.map((w) => `${DAY_NAMES[w.dow]}: ${w.day}`).join('; ') || 'not decided yet';
  return [
    '[CONTEXT]',
    `user: ${p.age}-year-old ${p.sex === 'f' ? 'woman' : 'guy'}, ${p.heightCm} cm, ${p.weightKg} kg, goal ${p.goalKg} kg. Address him in ${p.sex === 'f' ? 'feminine' : 'masculine'} Hebrew.`,
    `where he is on each weekday: ${places}.`,
    `his current fixed training days in the app: ${routine}.`,
    `weekly split in the draft: ${wk}.`,
    calendarBlock(),
    parsed ? '[APP NOTE] The message above contained a plan as text; the app parsed it and REPLACED the draft with it (see below). Review it.' : '',
    d && d.days.length ? `THE DRAFT PLAN (${d.days.reduce((a, x) => a + x.blocks.reduce((b, y) => b + y.exercises.length, 0), 0)} exercises):\n${planToText(d)}` : 'THE DRAFT PLAN is empty.',
    mem ? `things I know about him: ${mem}.` : '',
  ].filter(Boolean).join('\n');
}

export async function sendPlanMessage(text: string) {
  const t = text.trim();
  if (!t || planChat.get().busy) return;
  const um: PMsg = { id: uid(), role: 'user', text: t };
  // התחלה: עובדים על התוכנית הקיימת. הדבקה של תוכנית: מנתחים מקומית לטיוטה
  const s0 = store.get();
  let draft = planChat.get().draft;
  let week = planChat.get().week;
  const active = s0.plans.find((x) => x.id === s0.activePlan) ?? s0.plans[0];
  if (!draft && active) { draft = JSON.parse(JSON.stringify(active)); week = weekFromRoutine(s0.settings.routine, active); }
  const pasted = looksLikePlan(t, uid);
  if (pasted) { draft = pasted; week = []; }
  setS((s) => ({ ...s, messages: [...s.messages, um], busy: true, error: undefined, draft, week, draftAt: pasted ? um.id : s.draftAt }));
  try {
    const msgs = planChat.get().messages;
    const turns: ChatTurn[] = msgs.map((m, i) => (m.role === 'user'
      ? { role: 'user', text: i === msgs.length - 1 ? `${m.text}\n\n${context(!!pasted)}` : m.text }
      : { role: 'model', text: JSON.stringify({ reply: m.text }) }));
    const r = await chatTurn(turns, { system: SYS, raw: true, web: false, deep: false, onStage: () => undefined });
    let reply = r.reply.trim();
    let log: string[] = [];
    let changed = false;
    let cur = planChat.get().draft;
    let wk = planChat.get().week;
    try {
      const j = parseJsonLoose(r.reply);
      reply = String(j.reply ?? '').trim() || reply;
      if (j.plan) { const np = planFromJson(j, 'התוכנית שלי', uid); if (np) { cur = np; changed = true; log.push(`נבנתה תוכנית חדשה: ${np.days.length} ימים`); } }
      if (Array.isArray(j.ops) && j.ops.length) {
        const base: Plan = cur ?? { id: uid(), name: 'התוכנית שלי', days: [], ts: Date.now() };
        const res = applyOps(base, j.ops as Op[], uid);
        cur = res.plan; log = [...log, ...res.log]; changed = changed || res.log.length > 0;
      }
      if (cur && Array.isArray(j.week)) { wk = cleanWeek(j.week, cur); changed = true; log.push(`חלוקה שבועית: ${wk.length} ימי אימון`); }
      else if (cur) wk = cleanWeek(wk, cur);
    } catch { /* תשובת טקסט רגילה */ }
    const am: PMsg = { id: uid(), role: 'ai', text: reply || 'לא הצלחתי לנסח תשובה. נסה שוב', log: log.length ? log : undefined };
    setS((s) => ({ ...s, busy: false, messages: [...s.messages, am], draft: cur, week: wk, draftAt: changed ? am.id : s.draftAt }));
  } catch (e) {
    setS((s) => ({ ...s, busy: false, error: (e as Error).message }));
  }
}

export function resetPlanChat() { setS(() => ({ messages: [], busy: false, draft: null, week: [], draftAt: null })); }

/** מאשר את הטיוטה: שומר את התוכנית ומחליף את ימי האימון הקבועים בחלוקה השבועית. אפשר לבטל */
export function applyDraft(): void {
  const { draft, week } = planChat.get();
  if (!draft || !draft.days.length) return;
  const s = store.get();
  const oldRoutine = s.settings.routine;
  const cur = s.plans.find((x) => x.id === s.activePlan) ?? s.plans[0];
  const plan: Plan = { ...draft, id: cur?.id ?? draft.id };
  actions.savePlan(plan);
  if (!cur) actions.setActivePlan(plan.id);
  if (week.length) {
    const times = new Map(oldRoutine.map((r) => [r.dow, r.time] as const));
    const common = [...oldRoutine.reduce((a, r) => a.set(r.time, (a.get(r.time) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '18:00';
    actions.saveRoutine(week.map((w) => ({ id: uid(), dow: w.dow, time: w.time ?? times.get(w.dow) ?? common, title: w.day })));
  }
  import('../ui/ui').then(({ toast }) => toast('התוכנית והחלוקה השבועית עודכנו', () => {
    actions.savePlan(cur ?? plan);
    if (!cur) actions.deletePlan(plan.id);
    actions.saveRoutine(oldRoutine);
  }));
  setS((x) => ({ ...x, draftAt: null }));
}
