import { createStore } from '../core/store';
import { store } from '../core/state';
import { addDays, uid } from '../core/dates';
import { dayInfo } from '../core/calc';
import { BUILTIN_FOODS, PORTION_G } from '../data/foods';
import type { Entry, Macros } from '../core/types';

/**
 * מגש הארוחה: כל מה שנבחר ועוד לא נוסף ליום. כל פריט הוא בגרמים (unit "g", ערכים ל-100 גרם)
 * או במנות (unit "p", ערכים למנה אחת), עם כמות שאפשר לדייק.
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
}

export const macrosOf = (it: { amount: number; base: number; per: Macros }): Macros => ({
  k: Math.round((it.per.k * it.amount) / it.base),
  p: Math.round((it.per.p * it.amount) / it.base),
  c: Math.round((it.per.c * it.amount) / it.base),
  f: Math.round((it.per.f * it.amount) / it.base),
});

export const tray = createStore<{ items: TItem[] }>({ items: [] });

/** מועמד לאריח או לתוצאת חיפוש */
export interface Cand {
  key: string;
  name: string;
  unit: 'g' | 'p';
  base: number;
  per: Macros;
  amount: number; // כמות ברירת מחדל להוספה בלחיצה
  est?: boolean;
  w: number; // משקל דירוג
}

const step = (unit: 'g' | 'p') => (unit === 'g' ? 10 : 0.5);

export function trayAdd(c: Cand) {
  tray.set((s) => {
    const hit = s.items.find((i) => i.src === 'm' && i.name === c.name);
    if (hit) return { items: s.items.map((i) => (i === hit ? { ...i, amount: Math.round((i.amount + c.amount) * 10) / 10 } : i)) };
    return { items: [...s.items, { id: uid(), name: c.name, unit: c.unit, amount: c.amount, step: step(c.unit), base: c.base, per: c.per, est: c.est, src: 'm' }] };
  });
}
export const traySet = (id: string, amount: number) =>
  tray.set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, amount: Math.max(i.unit === 'g' ? 5 : 0.5, Math.round(amount * 10) / 10) } : i)) }));
export const trayRemove = (id: string) => tray.set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
export const trayClear = () => tray.set({ items: [] });
export const trayCount = (name: string) => tray.get().items.find((i) => i.src === 'm' && i.name === name);

/** מפרק שם מנה שנשמרה ביומן: "אורז · 160 ג׳" או "שייק ×2" או "בננה (קטן)" */
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
  return { name, unit: 'p', base: 1, amount: 1, per: { k: e.k / qty, p: e.p / qty, c: e.c / qty, f: e.f / qty } };
}

/** כל המזונות שאפשר להציע: מה שאכלת (לפי תדירות ושעה), מועדפים, ומאגר מובנה */
export function buildCandidates(slot: string): Cand[] {
  const s = store.get();
  const today = addDays(s.entries.length ? s.entries.reduce((m, e) => (e.date > m ? e.date : m), '0000') : '0000', 0);
  void today;
  const map = new Map<string, Cand>();
  const upsert = (c: Cand) => {
    const cur = map.get(c.key);
    if (cur) { cur.w += c.w; return; }
    map.set(c.key, c);
  };
  const newest = [...s.entries].sort((a, b) => b.ts - a.ts);
  const nowDay = new Date().toISOString().slice(0, 10);
  for (const e of newest) {
    const p = parseEntry(e);
    const ageDays = Math.max(0, (Date.parse(nowDay) - Date.parse(e.date)) / 86400_000);
    if (ageDays > 60) continue;
    upsert({
      key: p.name, name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: e.est,
      w: 1 + (e.slot === slot ? 2 : 0) + (ageDays < 7 ? 1 : 0),
    });
  }
  for (const fav of s.favorites) {
    const p = parseEntry({ name: fav.name, k: fav.k, p: fav.p, c: fav.c, f: fav.f });
    upsert({ key: p.name, name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: fav.est, w: 3 });
  }
  // בלי היסטוריה עדיין: מנות פתיחה סבירות למאסה
  const STARTERS = ['שייק חלבון', 'ביצים ולחם', 'לחמנייה עם גבינה צהובה', 'חזה עוף מבושל', 'אורז מבושל', 'בננה', 'יוגורט חלבון', 'פיתה', 'חטיף חלבון'];
  for (const b of BUILTIN_FOODS) {
    const gr = PORTION_G[b.name];
    const idx = STARTERS.indexOf(b.name);
    const w = 0.1 + (idx >= 0 ? 0.5 - idx * 0.03 : 0);
    if (gr) {
      const f = 100 / gr;
      upsert({ key: b.name, name: b.name, unit: 'g', base: 100, per: { k: b.k * f, p: b.p * f, c: b.c * f, f: b.f * f }, amount: gr, est: true, w });
    } else {
      upsert({ key: b.name, name: b.name, unit: 'p', base: 1, per: { k: b.k, p: b.p, c: b.c, f: b.f }, amount: 1, est: true, w });
    }
  }
  return [...map.values()];
}

/** "הרגילים שלך": 6-9 הראשונים לפי משקל */
export const topTiles = (cands: Cand[], n: number) => [...cands].sort((a, b) => b.w - a.w).slice(0, n);

export const candMacros = (c: Cand) => macrosOf({ amount: c.amount, base: c.base, per: c.per });

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
  return cands.filter((c) => c.name.includes(t)).sort((a, b) => b.w - a.w).slice(0, 8);
}
