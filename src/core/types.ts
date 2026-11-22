export interface Macros { k: number; p: number; c: number; f: number }
export type Place = 'dorm' | 'home';
export type TargetKey = 'dorm-rest' | 'dorm-train' | 'home-rest' | 'home-train';

export interface Slot { id: string; name: string; time: string }

export interface Entry extends Macros {
  id: string;
  date: string; // YYYY-MM-DD
  slot: string;
  name: string;
  est?: boolean; // הערכה ולא מדידה מדויקת
  ts: number;
}

export interface Food extends Macros {
  id: string;
  name: string;
  unit?: string;
  est?: boolean;
}

export type WorkoutStatus = 'planned' | 'done' | 'skipped';
export interface Workout {
  id: string;
  date: string;
  time: string;
  title: string;
  status: WorkoutStatus;
  routineId?: string;
}
export interface Routine { id: string; dow: number; time: string; title: string }
export interface Weigh { date: string; kg: number }

export interface Profile { age: number; heightCm: number; weightKg: number; goalKg: number; pace: 'slow' | 'mid' | 'fast' }

export interface Settings {
  profile: Profile;
  targets: Record<TargetKey, Macros>;
  places: Place[]; // לפי יום בשבוע, 0 = ראשון
  slots: Slot[];
  routine: Routine[];
  resetHour: number;
  ai: { provider: 'none' | 'gemini' | 'groq' | 'claude'; apiKey: string; model: string };
}

export interface State {
  schema: number;
  settings: Settings;
  entries: Entry[];
  workouts: Workout[];
  weights: Weigh[];
  favorites: Food[];
  meta: { createdAt: number; lastBackup?: number };
}
