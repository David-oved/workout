import { createStore } from '../core/store';
import { store } from '../core/state';
import { uid } from '../core/dates';
import { dayInfo } from '../core/calc';
import { autoMealName, dishPer100, dishSub, partMacros, sumMacros } from '../core/meal';
import { BUILTIN_FOODS, PORTION_G } from '../data/foods';
import { BUILTIN_DUP, getFood, type FoodRec } from '../data/foodDb';
import type { Dish, Entry, Macros, Part, Portion, State } from '../core/types';

/**
 * מגש הארוחה: כל מה שנבחר ועוד לא נוסף ליום. כל פריט הוא בגרמים (unit "g", ערכים ל-100 גרם)
 * או במנות (unit "p", ערכים למנה אחת). כשמוסיפים כמה פריטים הם הופכים ל"ארוחה אחת" עם רכיבים.
 */
export interface TItem {
  id: string;
  name: string;
  unit: 'g' | 'p';
  amount: number;
  step: number;
  base: number; // 100 לגרמים, 1 למנות
  per: Macros; // לפי base
  est?: boolean;
  src: 'm' | 'ai';
  msgId?: string; // פריט שמגיע מכרטיס של ה-AI
  conf?: 'high' | 'medium' | 'low';
  foodId?: string; // il:… / x:… / b:… / c:… / d:<סיר>
  portions?: Portion[];
}

export const macrosOf = partMacros;

export const tray = createStore<{ items: TItem[]; name: string; one: boolean }>({ items: [], name: '', one: true });

/** מועמד לאריח או לתוצאת חיפוש */
export interface Cand {
  key: string;
  kind: 'meal' | 'food' | 'pot'; // ארוחה מוכנה | מצרך בודד | סיר
  fav?: boolean;
  name: string;
  unit: 'g' | 'p';
  base: number;
  per: Macros;
  amount: number; // כמות ברירת מחדל להוספה בלחיצה
  est?: boolean;
  w: number; // משקל דירוג
  foodId?: string;
  portions?: Portion[];
  parts?: Part[]; // ארוחה שלמה מהיסטוריה
  note?: string; // שורת משנה (למשל "סיר · נשארו 800 ג׳")
}

const stepOf = (unit: 'g' | 'p') => (unit === 'g' ? 10 : 0.5);
export const stepFor = (it: TItem) => (it.unit === 'g' ? (it.amount <= 40 ? 5 : it.amount >= 400 ? 25 : 10) : 0.5);

const round1 = (n: number) => Math.round(n * 10) / 10;

function pushItem(it: Omit<TItem, 'id' | 'step' | 'src'>) {
  tray.set((s) => {
    const hit = s.items.find((i) => i.src === 'm' && (it.foodId ? i.foodId === it.foodId : !i.foodId && i.name === it.name));
    if (hit) return { ...s, items: s.items.map((i) => (i === hit ? { ...i, amount: round1(i.amount + it.amount) } : i)) };
    return { ...s, items: [...s.items, { ...it, id: uid(), step: stepOf(it.unit), src: 'm' as const }] };
  });
}

export function trayAdd(c: Cand) {
  if (c.parts?.length) {
    const wasEmpty = tray.get().items.length === 0;
    const dishes = store.get().dishes;
    for (const p of c.parts) {
      const d = p.foodId?.startsWith('d:') ? dishes.find((x) => x.id === p.foodId!.slice(2)) : undefined;
      const per = d ? dishPer100(d) : p.per;
      pushItem({ name: p.name, unit: p.unit, amount: p.amount, base: p.base, per, est: p.est, foodId: p.foodId, portions: foodPortions(p.foodId) });
    }
    if (wasEmpty && c.parts.length > 1) tray.set((s) => ({ ...s, name: c.name }));
    return;
  }
  pushItem({ name: c.name, unit: c.unit, amount: c.amount, base: c.base, per: c.per, est: c.est, foodId: c.foodId, portions: c.portions });
}

export function foodPortions(foodId?: string): Portion[] | undefined {
  if (!foodId) return undefined;
  if (foodId.startsWith('d:')) {
    const d = store.get().dishes.find((x) => x.id === foodId.slice(2));
    return d ? [{ l: 'מנה', g: portionOfDish(d) }] : undefined;
  }
  return getFood(foodId, store.get())?.portions;
}

/** הכמות האחרונה שאכלת ממזון מסוים (כדי שהפעם הבאה תהיה לחיצה אחת) */
export function lastAmount(foodId: string): number | undefined {
  const es = store.get().entries;
  for (let i = es.length - 1; i >= 0; i--) {
    const p = es[i].parts?.find((x) => x.foodId === foodId);
    if (p && p.unit === 'g') return p.amount;
  }
  return undefined;
}

export const defaultPortion = (ps: Portion[]) => (ps.find((p) => !p.l.startsWith('כף')) ?? ps[ps.length - 1])?.g ?? 100;

export const portionOfDish = (d: Dish) => Math.min(Math.round(d.cookedG / 10) * 10 || 250, 300);

export function trayAddFood(f: FoodRec, grams?: number) {
  const amount = grams ?? (f.unit === 'g' ? lastAmount(f.id) ?? defaultPortion(f.portions) : 1);
  pushItem({ name: f.name, unit: f.unit, amount, base: f.base, per: f.per, est: f.est, foodId: f.id, portions: f.portions });
}

export function trayAddDish(d: Dish, grams?: number) {
  const portion = portionOfDish(d);
  pushItem({ name: d.name, unit: 'g', amount: grams ?? Math.min(portion, d.remainG ?? portion), base: 100, per: dishPer100(d), foodId: 'd:' + d.id, portions: [{ l: 'מנה', g: portion }] });
}

export const traySet = (id: string, amount: number) =>
  tray.set((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, amount: Math.max(i.unit === 'g' ? 1 : 0.5, round1(amount)) } : i)) }));
export const trayPer = (id: string, per: Macros) => tray.set((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, per, est: false } : i)) }));
/** תיקון ערכי מזון שגם משפיע על כל הפריטים במגש מאותו מזון */
export const trayPerByFood = (foodId: string, per: Macros) => tray.set((s) => ({ ...s, items: s.items.map((i) => (i.foodId === foodId ? { ...i, per, est: false } : i)) }));
export const trayRemove = (id: string) => tray.set((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
export const trayClear = () => tray.set({ items: [], name: '', one: true });
export const traySetName = (name: string) => tray.set((s) => ({ ...s, name }));
export const traySetOne = (one: boolean) => tray.set((s) => ({ ...s, one }));
export const trayCount = (name: string) => tray.get().items.find((i) => i.src === 'm' && i.name === name);

/** פריט מגש → רכיב שנשמר בארוחה (כולל פירוק המצרכים כשזה חלק מסיר) */
export function toPart(it: TItem, s: State): Part {
  const part: Part = { id: uid(), name: it.name, unit: it.unit, amount: round1(it.amount), base: it.base, per: it.per, est: it.est, foodId: it.foodId };
  if (it.foodId?.startsWith('d:')) {
    const d = s.dishes.find((x) => x.id === it.foodId!.slice(2));
    if (d) part.sub = dishSub(d, it.amount);
  }
  return part;
}

export interface EntryDraft { name: string; k: number; p: number; c: number; f: number; est?: boolean; parts: Part[]; dishId?: string }

/** יוצר את הרשומות ליומן: "ארוחה אחת" עם רכיבים, או כל פריט בנפרד */
export function makeEntries(items: TItem[], s: State, one: boolean, mealName: string): EntryDraft[] {
  const parts = items.map((i) => toPart(i, s));
  const single = (p: Part): EntryDraft => {
    const m = partMacros(p);
    const nm = p.unit === 'g' ? `${p.name} · ${Math.round(p.amount)} ג׳` : p.amount !== 1 ? `${p.name} ×${p.amount}` : p.name;
    return { name: nm, ...m, est: p.est, parts: [p], dishId: p.foodId?.startsWith('d:') ? p.foodId.slice(2) : undefined };
  };
  if (parts.length === 1 || !one) return parts.map(single);
  const m = sumMacros(parts.map(partMacros));
  return [{ name: mealName.trim() || autoMealName(parts), ...m, est: parts.some((p) => p.est), parts }];
}

/** מפרק שם מנה שנשמרה ביומן (רשומות ישנות בלי רכיבים): "אורז · 160 ג׳" או "שייק ×2" או "בננה (קטן)" */
export function parseEntry(e: Pick<Entry, 'name' | 'k' | 'p' | 'c' | 'f'>): { name: string; unit: 'g' | 'p'; base: number; per: Macros; amount: number } {
  let name = e.name;
  let grams = 0;
  let qty = 1;
  const g = name.match(/\s·\s(\d+(?:\.\d+)?)\sג׳$/);
  if (g) { grams = parseFloat(g[1]); name = name.slice(0, g.index); }
  name = name.replace(/\s\((?:קטן|גדול)\)$/, '');
  const q = name.match(/\s×(\d+(?:\.\d+)?)$/);
  if (q) { qty = parseFloat(q[1]); name = name.slice(0, q.index); }
  if (grams > 0) {
    const f = 100 / grams;
    return { name, unit: 'g', base: 100, amount: grams, per: { k: e.k * f, p: e.p * f, c: e.c * f, f: e.f * f } };
  }
  return { name, unit: 'p', base: 1, per: { k: e.k / qty, p: e.p / qty, c: e.c / qty, f: e.f / qty }, amount: 1 };
}

/** כל מה שאפשר להציע בלחיצה: מה שאכלת (לפי תדירות ושעה), סירים, מועדפים, ומנות פתיחה */
export function buildCandidates(slot: string): Cand[] {
  const s = store.get();
  const hidden = new Set(s.hiddenTiles);
  const map = new Map<string, Cand>();
  const upsert = (c: Cand) => {
    if (hidden.has(c.key)) return;
    const cur = map.get(c.key);
    if (cur) { cur.w += c.w; return; }
    map.set(c.key, c);
  };
  for (const d of s.dishes) {
    const portion = portionOfDish(d);
    upsert({
      key: 'd:' + d.id, kind: 'pot', name: d.name, unit: 'g', base: 100, per: dishPer100(d), amount: Math.min(portion, d.remainG ?? portion), w: 5 + (d.last && Date.now() - d.last < 3 * 86400_000 ? 2 : 0),
      foodId: 'd:' + d.id, portions: [{ l: 'מנה', g: portion }], note: d.remainG != null ? `נשארו ${Math.round(d.remainG)} ג׳` : 'סיר שלי',
    });
  }
  const newest = [...s.entries].sort((a, b) => b.ts - a.ts);
  const nowDay = new Date().toISOString().slice(0, 10);
  for (const e of newest) {
    const ageDays = Math.max(0, (Date.parse(nowDay) - Date.parse(e.date)) / 86400_000);
    if (ageDays > 60) continue;
    const w = 1 + (e.slot === slot ? 2 : 0) + (ageDays < 7 ? 1 : 0);
    if (e.parts && e.parts.length > 1) {
      upsert({ key: 'meal:' + e.name, kind: 'meal', name: e.name, unit: 'p', base: 1, per: { k: e.k, p: e.p, c: e.c, f: e.f }, amount: 1, est: e.est, w, parts: e.parts, note: `${e.parts.length} רכיבים` });
      continue;
    }
    if (e.parts?.length === 1) {
      const p = e.parts[0];
      upsert({ key: p.foodId ?? p.name, kind: 'food', name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: p.est, w, foodId: p.foodId, portions: foodPortions(p.foodId) });
      continue;
    }
    const p = parseEntry(e);
    upsert({ key: p.name, kind: 'meal', name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: e.est, w });
  }
  for (const fav of s.favorites) {
    if (fav.parts?.length) {
      upsert({ key: 'meal:' + fav.name, kind: 'meal', name: fav.name, unit: 'p', base: 1, per: { k: fav.k, p: fav.p, c: fav.c, f: fav.f }, amount: 1, est: fav.est, w: 3, parts: fav.parts, note: `${fav.parts.length} רכיבים`, fav: true });
      continue;
    }
    const p = parseEntry({ name: fav.name, k: fav.k, p: fav.p, c: fav.c, f: fav.f });
    upsert({ key: fav.foodId ?? p.name, kind: p.unit === 'g' ? 'food' : 'meal', name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: fav.est, w: 3, foodId: fav.foodId, portions: foodPortions(fav.foodId), fav: true });
  }
  // בלי היסטוריה עדיין: מנות פתיחה סבירות למאסה
  const STARTERS = ['שייק חלבון', 'ביצים ולחם', 'לחמנייה עם גבינה צהובה', 'יוגורט חלבון', 'חטיף חלבון', 'סנדוויץ׳ טונה', 'שווארמה בפיתה', 'פסטה ברוטב עגבניות'];
  for (const b of BUILTIN_FOODS) {
    if (BUILTIN_DUP.has(b.name)) continue;
    const gr = PORTION_G[b.name];
    const idx = STARTERS.indexOf(b.name);
    const w = 0.1 + (idx >= 0 ? 0.5 - idx * 0.03 : 0);
    if (gr) {
      const f = 100 / gr;
      upsert({ key: b.name, kind: 'meal', name: b.name, unit: 'g', base: 100, per: { k: b.k * f, p: b.p * f, c: b.c * f, f: b.f * f }, amount: gr, est: true, w, portions: [{ l: b.unit ?? 'מנה', g: gr }] });
    } else {
      upsert({ key: b.name, kind: 'meal', name: b.name, unit: 'p', base: 1, per: { k: b.k, p: b.p, c: b.c, f: b.f }, amount: 1, est: true, w });
    }
  }
  // מצרכים נפוצים מהמאגר (אחרי שנטען)
  const FOOD_STARTERS = ['il:1561', 'il:805', 'il:2721', 'il:2062', 'il:10076', 'il:9707', 'il:500', 'il:1955', 'il:1858', 'il:8608', 'il:3663', 'il:3793', 'il:3223', 'il:15', 'il:2730', 'il:4443'];
  FOOD_STARTERS.forEach((id, i) => {
    const r = getFood(id, s);
    if (r) upsert({ key: r.id, kind: 'food', name: r.name, unit: r.unit, base: r.base, per: r.per, amount: lastAmount(r.id) ?? defaultPortion(r.portions), est: r.est, w: 0.5 - i * 0.02, foodId: r.id, portions: r.portions });
  });
  return [...map.values()];
}

/** "הרגילים שלך": 6-9 הראשונים לפי משקל */
export const topTiles = (cands: Cand[], n: number) => [...cands].sort((a, b) => b.w - a.w).slice(0, n);

export const candMacros = (c: Cand) => (c.parts ? { k: Math.round(c.per.k), p: Math.round(c.per.p), c: Math.round(c.per.c), f: Math.round(c.per.f) } : macrosOf({ amount: c.amount, base: c.base, per: c.per }));

/** "חסר לך היום": מנות עם הרבה חלבון שנכנסות בקלוריות שנשארו */
export function gapSuggestions(cands: Cand[], date: string, extra: Macros) {
  const s = store.get();
  const info = dayInfo(s, date);
  const remK = info.target.k - info.eaten.k - extra.k;
  const remP = info.target.p - info.eaten.p - extra.p;
  if (remP < 12) return { remP, remK, list: [] as Cand[] };
  const list = cands
    .filter((c) => { const m = candMacros(c); return m.p >= 12 && m.k <= remK + 80 && m.p / Math.max(1, m.k) > 0.05; })
    .sort((a, b) => candMacros(b).p - candMacros(a).p || b.w - a.w)
    .slice(0, 2);
  return { remP, remK, list };
}

export function searchCandidates(cands: Cand[], q: string) {
  const t = q.trim();
  if (!t) return [];
  return cands.filter((c) => c.w >= 1 && c.name.includes(t)).sort((a, b) => b.w - a.w).slice(0, 5);
}
