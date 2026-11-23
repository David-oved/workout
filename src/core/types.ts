export interface Macros { k: number; p: number; c: number; f: number }
export type Place = 'dorm' | 'home';
export type TargetKey = 'dorm-rest' | 'dorm-train' | 'home-rest' | 'home-train';

export interface Slot { id: string; name: string; time: string }

/** רכיב בתוך ארוחה: כמות ב-g (ערכים ל-100 ג׳) או במנות (ערכים למנה אחת) */
export interface Part {
  id: string;
  name: string;
  unit: 'g' | 'p';
  amount: number;
  base: number; // 100 לגרמים, 1 למנות
  per: Macros; // לפי base
  est?: boolean;
  foodId?: string;
  unitG?: number; // משקל יחידה אחת (ביצה 50 ג׳), כדי להציג ×2 במקום 100 ג׳
  sub?: Part[]; // רכיבים גולמיים שנכנסו לחלק הזה (כשאוכלים מנה מסיר)
}

export interface Entry extends Macros {
  id: string;
  date: string; // YYYY-MM-DD
  slot: string;
  name: string;
  est?: boolean; // הערכה ולא מדידה מדויקת
  ts: number;
  parts?: Part[]; // ארוחה מורכבת: מה שבפנים
  dishId?: string; // אם נאכל מסיר שמור
}

export interface Food extends Macros {
  id: string;
  name: string;
  unit?: string;
  est?: boolean;
  parts?: Part[];
  foodId?: string; // מצרך מהמאגר (כדי לשמור מנות וגרמים מדויקים)
}

/** סיר/מתכון שמור: מצרכים גולמיים, משקל אחרי בישול ואחוז שומן שנשפך */
export interface Dish {
  id: string;
  name: string;
  parts: Part[];
  cookedG: number;
  measured: boolean; // המשקל נשקל בפועל (ולא הערכה)
  fatLoss: number; // 0..0.5, חלק מהשומן שנשפך בבישול
  remainG?: number; // כמה נשאר בסיר
  createdAt: number;
  last?: number;
}

export interface FoodEdit { k: number; p: number; c: number; f: number; name?: string }
export interface Portion { l: string; g: number }
/** מזון אישי שהוספת בעצמך (לכל 100 ג׳ או למנה) */
export interface CustomFood { id: string; name: string; unit: 'g' | 'p'; per: Macros; portions?: Portion[] }

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
export interface SetLog { kg: number; reps: number }
export interface ExLog { name: string; sets: SetLog[] }
/** אימון שנרשם בפועל: תרגילים, סטים, משקל וחזרות */
export interface Session { id: string; date: string; title: string; workoutId?: string; exercises: ExLog[]; ts: number }
export interface Weigh { date: string; kg: number }

export interface Profile { age: number; heightCm: number; weightKg: number; goalKg: number; pace: 'slow' | 'mid' | 'fast' }

/** תזכורות: ארוחות לפי שעות הארוחות, שקילה שבועית, סגירת יום, ו"דחיפות" בתוך האפליקציה */
export interface Remind {
  v?: number;
  meals: Record<string, boolean>;
  weigh: { on: boolean; dow: number; time: string };
  close: { on: boolean; time: string };
  nudges: boolean;
  /** "מצב היום": התראה עם כמה אכלת וכמה נשאר, כמה פעמים ביום (הטקסט מחושב ברגע ההתראה) */
  status: { on: boolean; times: string[]; quiet: { from: string; to: string } };
  workouts: boolean; // התראת Push לפני אימון
}

export interface Settings {
  profile: Profile;
  targets: Record<TargetKey, Macros>;
  places: Place[]; // לפי יום בשבוע, 0 = ראשון
  slots: Slot[];
  routine: Routine[];
  resetHour: number;
  cal: { enabled: boolean; feedId: string; alertMin: number };
  remind: Remind;
  ai: {
    provider: 'none' | 'gemini' | 'groq' | 'claude';
    apiKey: string;
    model: string;
    think: 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    textModel: string; // ריק = אוטומטי
    visionModel: string; // ריק = אוטומטי (גם לחיפוש, מסמכים ותמונות)
    web: boolean; // חיפוש באינטרנט כברירת מחדל
    shareData: boolean; // לשתף את נתוני האפליקציה עם ה-AI
    memory: string[]; // מה ש-AI זכר עליי
  };
}

export interface State {
  schema: number;
  settings: Settings;
  entries: Entry[];
  workouts: Workout[];
  weights: Weigh[];
  favorites: Food[];
  dishes: Dish[];
  foodEdits: Record<string, FoodEdit>;
  customFoods: CustomFood[];
  sessions: Session[];
  water: Record<string, number>; // מ״ל לפי תאריך
  hiddenTiles: string[]; // אריחים שהסתרת ממסך ההוספה
  meta: { createdAt: number; lastBackup?: number };
}
