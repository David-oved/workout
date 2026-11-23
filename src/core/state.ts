import { get, set } from 'idb-keyval';
import { createStore } from './store';
import type { State, Settings, Workout } from './types';
import { addDays, todayKey, dow, uid } from './dates';
import { suggestTargets } from './calc';

const KEY = 'workout:state';
const LS_KEY = 'workout:state:mirror';
export const SCHEMA = 1;

export function defaultSettings(): Settings {
  const profile = { age: 17, heightCm: 183, weightKg: 70, goalKg: 81, pace: 'mid' as const };
  return {
    profile,
    targets: suggestTargets(profile),
    places: ['dorm', 'dorm', 'dorm', 'dorm', 'dorm', 'home', 'home'],
    slots: [
      { id: 'breakfast', name: 'בוקר', time: '08:00' },
      { id: 'lunch', name: 'צהריים', time: '13:30' },
      { id: 'dinner', name: 'ערב', time: '20:00' },
      { id: 'snack', name: 'נשנוש', time: '16:30' },
    ],
    routine: [
      { id: 'r-sun', dow: 0, time: '18:00', title: 'חזה וכתפיים' },
      { id: 'r-tue', dow: 2, time: '18:00', title: 'רגליים' },
      { id: 'r-thu', dow: 4, time: '18:00', title: 'גב וידיים' },
    ],
    resetHour: 0,
    cal: { enabled: false, feedId: '', alertMin: 30 },
    remind: { v: 2, meals: { breakfast: false, lunch: false, dinner: false, snack: false }, weigh: { on: false, dow: 5, time: '09:00' }, close: { on: false, time: '21:30' }, nudges: true, status: { on: true, times: ['11:00', '14:00', '17:00', '20:00'], quiet: { from: '00:00', to: '10:00' } }, workouts: false },
    ai: { provider: 'none', apiKey: '', model: '', think: 'auto', textModel: '', visionModel: '', web: false, shareData: true, memory: [] },
  };
}

export function defaultState(): State {
  const settings = defaultSettings();
  return {
    schema: SCHEMA,
    settings,
    entries: [],
    workouts: [],
    weights: [{ date: todayKey(0), kg: settings.profile.weightKg }],
    favorites: [],
    dishes: [],
    foodEdits: {},
    customFoods: [],
    hiddenTiles: [],
    sessions: [],
    water: {},
    meta: { createdAt: Date.now() },
  };
}

/** מייצר אימונים קונקרטיים מהשגרה השבועית ל-28 הימים הקרובים (בלי לדרוס אימונים קיימים). */
export function ensureWorkouts(s: State, from: string, days = 28): State {
  const add: Workout[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    for (const r of s.settings.routine) {
      if (r.dow !== dow(date)) continue;
      if (s.workouts.some((w) => w.routineId === r.id && w.date === date)) continue;
      add.push({ id: uid(), date, time: r.time, title: r.title, status: 'planned', routineId: r.id });
    }
  }
  return add.length ? { ...s, workouts: [...s.workouts, ...add] } : s;
}

export const store = createStore<State>(defaultState());

function migrate(raw: any): State {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...raw.settings, ai: { ...base.settings.ai, ...(raw.settings?.ai ?? {}) }, cal: { ...base.settings.cal, ...(raw.settings?.cal ?? {}) }, remind: raw.settings?.remind?.v >= 2 ? { ...base.settings.remind, ...raw.settings.remind, status: { ...base.settings.remind.status, ...(raw.settings.remind.status ?? {}) }, meals: { ...base.settings.remind.meals, ...(raw.settings?.remind?.meals ?? {}) }, weigh: { ...base.settings.remind.weigh, ...(raw.settings?.remind?.weigh ?? {}) }, close: { ...base.settings.remind.close, ...(raw.settings?.remind?.close ?? {}) } } : base.settings.remind },
    dishes: Array.isArray(raw.dishes) ? raw.dishes : [],
    foodEdits: raw.foodEdits && typeof raw.foodEdits === 'object' ? raw.foodEdits : {},
    customFoods: Array.isArray(raw.customFoods) ? raw.customFoods : [],
    hiddenTiles: Array.isArray(raw.hiddenTiles) ? raw.hiddenTiles : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    water: raw.water && typeof raw.water === 'object' ? raw.water : {},
    meta: { ...base.meta, ...(raw.meta ?? {}) },
    schema: SCHEMA,
  };
}

let timer: number | undefined;
function persist() {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const s = store.get();
    try { await set(KEY, s); } catch { /* ignore */ }
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* מכסה מלאה: מדלגים על המראה */ }
  }, 150);
}

export function update(fn: (s: State) => State) {
  store.set((s) => fn(s));
  persist();
}

export async function loadState() {
  let raw: unknown;
  try { raw = await get(KEY); } catch { /* ignore */ }
  if (!raw) {
    try { const m = localStorage.getItem(LS_KEY); if (m) raw = JSON.parse(m); } catch { /* ignore */ }
  }
  const s = migrate(raw);
  store.set(ensureWorkouts(s, todayKey(s.settings.resetHour)));
  if (!raw) persist();
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
}

export function replaceAll(raw: unknown) {
  const s = migrate(raw);
  update(() => ensureWorkouts(s, todayKey(s.settings.resetHour)));
}
