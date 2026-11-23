import { createStore } from '../core/store';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { DAY_NAMES, uid } from '../core/dates';
import { cleanWeek, parseJsonLoose, planFromJson, planToText, type WeekItem } from '../core/plan';
import type { Plan } from '../core/types';
import { chatTurn, type ChatTurn } from './gemini';

/**
 * שיחה עם ה-AI על בניית תוכנית האימונים: מסבירים לו איך מתאמנים בכל יום, הוא שואל, ובסוף מציע תוכנית וחלוקה שבועית.
 * כלום לא משתנה עד שמאשרים את ההצעה.
 */
export interface PMsg { id: string; role: 'user' | 'ai'; text: string; plan?: Plan; week?: WeekItem[]; applied?: boolean }
interface PState { messages: PMsg[]; busy: boolean; error?: string }

const LS = 'wo:plan-chat';
function load(): PState {
  try {
    const j = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (j && Array.isArray(j.messages)) return { messages: j.messages, busy: false };
  } catch { /* ignore */ }
  return { messages: [], busy: false };
}
export const planChat = createStore<PState>(load());
const save = () => { try { localStorage.setItem(LS, JSON.stringify({ messages: planChat.get().messages.slice(-30) })); } catch { /* ignore */ } };
const setS = (fn: (s: PState) => PState) => { planChat.set(fn); save(); };

const SYS = `You are a friendly, practical strength and fitness coach helping the user BUILD or CHANGE their weekly workout plan through a short conversation in Hebrew. You talk casually, in short messages (about 60 words max), and ask at most ONE question at a time.
How to work:
- Listen to how he wants to train: how many days per week, where each day happens (park, gym, room, home), what equipment he has, how long, and what he does on each day. Take what he says as the truth and keep his exercises, names and order. Do not invent exercises he did not mention unless he asks for suggestions; then suggest a few with a one-line reason.
- Ask about what is missing (days, equipment, rest days, goal). When you have enough to draw a plan, or when he changes something, return the FULL updated plan AND the weekly split, and say in one or two sentences what is in it.
- The plan changes slowly over time; progression is handled by the app, so do not over-engineer.
- Respect safety: for users under 18 keep volume modest, no max-effort lifts, food and rest matter; no steroids or risky advice.
Return ONE JSON object only, nothing else:
{"reply":"Hebrew message","plan":{"name":string,"days":[{"name":string,"blocks":[{"title":string,"exercises":[{"name":string,"sets":number,"reps":number,"unit":"reps"|"sec","kg":number optional,"note":string optional}]}]}]},"week":[{"dow":0-6,"day":"exact day name from the plan"}]}
"plan" and "week" are OPTIONAL: include them only when you propose or change the plan (otherwise omit them). "dow" is the weekday: 0 = Sunday ... 6 = Saturday. Only training days appear in "week"; every other day is rest. unit "sec" means reps is seconds (a one-minute plank is reps 60). Day names are Hebrew, for example "יום פארק".`;

function context(): string {
  const s = store.get();
  const p = s.settings.profile;
  const plan = s.plans.find((x) => x.id === s.activePlan) ?? s.plans[0];
  const places = s.settings.places.map((x, i) => `${DAY_NAMES[i]}: ${x === 'dorm' ? 'dorm' : 'home'}`).join(', ');
  const routine = s.settings.routine.map((r) => `${DAY_NAMES[r.dow]} ${r.time} ${r.title}`).join('; ') || 'none';
  const mem = s.settings.ai.memory.slice(-8).join('; ');
  return [
    '[CONTEXT]',
    `user: ${p.age}-year-old ${p.sex === 'f' ? 'woman' : 'guy'}, ${p.heightCm} cm, ${p.weightKg} kg, goal ${p.goalKg} kg. Address him in ${p.sex === 'f' ? 'feminine' : 'masculine'} Hebrew.`,
    `where he is on each weekday: ${places}.`,
    `current weekly training days: ${routine}.`,
    plan ? `current plan (as text):\n${planToText(plan)}` : 'he has no plan yet.',
    mem ? `things I know about him: ${mem}.` : '',
  ].filter(Boolean).join('\n');
}

export async function sendPlanMessage(text: string) {
  const t = text.trim();
  if (!t || planChat.get().busy) return;
  const um: PMsg = { id: uid(), role: 'user', text: t };
  setS((s) => ({ ...s, messages: [...s.messages, um], busy: true, error: undefined }));
  try {
    const msgs = planChat.get().messages;
    const turns: ChatTurn[] = msgs.map((m, i) => {
      if (m.role === 'user') return { role: 'user', text: i === msgs.length - 1 ? `${m.text}\n\n${context()}` : m.text };
      return { role: 'model', text: JSON.stringify({ reply: m.text, ...(m.plan ? { plan: m.plan.days.length ? { name: m.plan.name, days: m.plan.days.map((d) => ({ name: d.name, blocks: d.blocks.map((b) => ({ title: b.title, exercises: b.exercises.map(({ id: _i, ...e }) => e) })) })) } : undefined, week: m.week } : {}) }) };
    });
    const r = await chatTurn(turns, { system: SYS, raw: true, web: false, deep: false, onStage: () => undefined });
    let reply = r.reply.trim();
    let plan: Plan | undefined;
    let week: WeekItem[] | undefined;
    try {
      const j = parseJsonLoose(r.reply);
      reply = String(j.reply ?? '').trim() || reply;
      const p = j.plan ? planFromJson(j, 'התוכנית שלי', uid) : null;
      if (p) { plan = p; week = cleanWeek(j.week, p); }
    } catch { /* תשובת טקסט רגילה */ }
    setS((s) => ({ ...s, busy: false, messages: [...s.messages, { id: uid(), role: 'ai', text: reply || 'לא הצלחתי לנסח תשובה. נסה שוב', plan, week }] }));
  } catch (e) {
    setS((s) => ({ ...s, busy: false, error: (e as Error).message }));
  }
}

export function resetPlanChat() { setS(() => ({ messages: [], busy: false })); }
export const markApplied = (id: string) => setS((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? { ...m, applied: true } : m)) }));

/** מאשר הצעה: שומר את התוכנית ומחליף את ימי האימון הקבועים בחלוקה השבועית. אפשר לבטל */
export function applyProposal(m: PMsg): void {
  if (!m.plan) return;
  const s = store.get();
  const oldPlans = s.plans, oldActive = s.activePlan, oldRoutine = s.settings.routine;
  const cur = s.plans.find((x) => x.id === s.activePlan) ?? s.plans[0];
  const plan: Plan = { ...m.plan, id: cur?.id ?? m.plan.id };
  actions.savePlan(plan);
  if (!cur) actions.setActivePlan(plan.id);
  if (m.week?.length) {
    const times = new Map(oldRoutine.map((r) => [r.dow, r.time] as const));
    const common = [...oldRoutine.reduce((a, r) => a.set(r.time, (a.get(r.time) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '18:00';
    actions.saveRoutine(m.week.map((w) => ({ id: uid(), dow: w.dow, time: times.get(w.dow) ?? common, title: w.day })));
  }
  markApplied(m.id);
  import('../ui/ui').then(({ toast }) => toast('התוכנית והחלוקה השבועית עודכנו', () => {
    actions.savePlan(cur ?? plan);
    if (!cur) actions.deletePlan(plan.id);
    actions.saveRoutine(oldRoutine);
    void oldPlans; void oldActive;
  }));
}
