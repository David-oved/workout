import type { Dish, Macros, State } from './types';
import { norm, searchFoods, type FoodRec } from '../data/foodDb';
import { defaultPortion, lastAmount, portionOfDish } from '../ui/tray';

/**
 * שפה חופשית בלי AI: "200 אורז, חצי חזה עוף וכף קטשופ" → רכיבים עם גרמים.
 * מנתח מקומית מול המאגר, הסירים והמזונות האישיים. מה שלא זוהה מסומן, ואפשר להוסיף אותו כמוצר חדש או לשאול AI.
 */
export interface Parsed {
  raw: string;
  name: string; // מה שנשאר מהטקסט אחרי הוצאת כמות ויחידה
  food?: FoodRec;
  dish?: Dish;
  alts: FoodRec[]; // חלופות להחלפה בלחיצה
  amount: number; // גרמים (unit g) או מנות (unit p)
  unit: 'g' | 'p';
  note: string; // איך הובנה הכמות, למשל "2 כפות"
  qty: boolean; // המשתמש ציין כמות
}

const NUMW: Record<string, number> = {
  חצי: 0.5, רבע: 0.25, שליש: 0.33, אחד: 1, אחת: 1, שתי: 2, שני: 2, שתיים: 2, שניים: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, עשר: 10,
};
type U = 'g' | 'tbsp' | 'tsp' | 'cup' | 'slice' | 'unit' | 'handful' | 'can';
const UNITW: [RegExp, U, string][] = [
  [/^(גרם|גרמים|גר|גר׳|ג׳|ג)$/, 'g', ''],
  [/^(כף|כפות)$/, 'tbsp', 'כף'],
  [/^(כפית|כפיות)$/, 'tsp', 'כפית'],
  [/^(כוס|כוסות)$/, 'cup', 'כוס'],
  [/^(פרוסה|פרוסות|סלייס|סלייסים)$/, 'slice', 'פרוסה'],
  [/^(יחידה|יחידות|יח׳|יח)$/, 'unit', 'יחידה'],
  [/^(חופן|חופנים)$/, 'handful', 'חופן'],
  [/^(פחית|פחיות)$/, 'can', 'פחית'],
];
const DEF_G: Record<U, number> = { g: 1, tbsp: 15, tsp: 5, cup: 240, slice: 30, unit: 0, handful: 30, can: 330 };

export const stems = (t: string): string[] => {
  const out = [t];
  if (t.endsWith('ים')) out.push(t.slice(0, -2), t.slice(0, -2) + 'ה');
  if (t.endsWith('ות')) out.push(t.slice(0, -2) + 'ה', t.slice(0, -2));
  if (t.length > 3 && t.startsWith('ה')) out.push(t.slice(1));
  return [...new Set(out)];
};

function findFood(name: string, s: State): { food?: FoodRec; dish?: Dish; alts: FoodRec[] } {
  const n = norm(name);
  if (!n) return { alts: [] };
  const dish = s.dishes.find((d) => norm(d.name).includes(n) || n.includes(norm(d.name)));
  if (dish) return { dish, alts: [] };
  const words = n.split(' ');
  for (const variant of [n, ...(words.length === 1 ? stems(words[0]).slice(1) : [words.map((w) => stems(w)[1] ?? w).join(' ')])]) {
    const all = searchFoods(variant, s, 12);
    const rawWord = /(נא|יבש|יבשה|גולמי|גולמית|לפני)/.test(n);
    // מעדיפים מזון רגיל: לא מנה מוכנה כללית ולא "גולמי" (אלא אם ביקשת)
    const good = all.filter((f) => f.src !== 'b' && (rawWord || f.kind !== 'raw'));
    const res = good.length ? good : all;
    if (res.length) return { food: res[0], alts: res.slice(1, 3) };
  }
  return { alts: [] };
}

export function parseMeal(text: string, s: State): Parsed[] {
  const segs = text
    .replace(/(\d+(?:\.\d+)?)/g, ' $1 ')
    .split(/\s*[,;\n+]\s*|\s+ו(?=[א-ת])|\s+עם\s+|\s+ועוד\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: Parsed[] = [];
  for (const seg of segs) {
    let num: number | null = null;
    let unit: U | null = null;
    let unitLabel = '';
    const rest: string[] = [];
    for (const tok of seg.split(/\s+/)) {
      const d = tok.match(/^\d+(?:\.\d+)?$/);
      if (d) { num = (num ?? 0) + parseFloat(tok); continue; }
      if (tok in NUMW && !unit) { num = (num ?? 0) + NUMW[tok]; continue; }
      const u = UNITW.find((x) => x[0].test(tok));
      if (u && !unit) { unit = u[1]; unitLabel = u[2]; continue; }
      if (tok === 'של') continue;
      rest.push(tok);
    }
    const name = rest.join(' ').trim();
    if (!name) continue;
    const { food, dish, alts } = findFood(name, s);
    const qty = num !== null;
    const item: Parsed = { raw: seg, name, food, dish, alts, amount: 0, unit: 'g', note: '', qty };
    if (dish) {
      const portion = portionOfDish(dish);
      item.amount = unit === 'g' && num ? num : num && num >= 20 ? num : Math.round((num ?? 1) * portion);
      item.note = unit === 'g' || (num && num >= 20) ? '' : num ? `${num} מנות` : '';
      out.push(item);
      continue;
    }
    if (!food) { out.push(item); continue; }
    if (food.unit === 'p') {
      item.unit = 'p';
      item.amount = num && !unit ? num : 1;
      out.push(item);
      continue;
    }
    const portions = food.portions;
    const find = (label: string) => portions.find((p) => p.l.startsWith(label));
    const def = lastAmount(food.id) ?? defaultPortion(portions);
    let g: number;
    if (unit === 'g') { g = num ?? def; }
    else if (unit) {
      const p = unit === 'unit' ? portions.find((x) => /^(יחידה|ביצה|פיתה|חזה|ירך|שקית|סטייק|שיפוד|תמר|קלח|פלפל|בינונית|בינוני|שלם)/.test(x.l)) ?? portions.find((x) => !x.l.startsWith('כף')) : find(unitLabel);
      const per = p?.g ?? (DEF_G[unit] || def);
      g = (num ?? 1) * per;
      item.note = `${num ?? 1} ${unitLabel}`;
    } else if (num !== null) {
      if (num >= 20) g = num;
      else { g = num * defaultPortion(portions); item.note = num === 0.5 ? 'חצי' : `${num} מנות`; }
    } else g = def;
    item.amount = Math.max(1, Math.round(g));
    out.push(item);
  }
  return out;
}

/** "חריסה 100 גרם 150 קל 5 חלבון 20 פחמימה 6 שומן" → מוצר חדש. בלי "גרם" הערכים הם למנה אחת */
export interface NewProduct { name: string; unit: 'g' | 'p'; per: Macros; grams: number }
export function parseNewProduct(text: string): NewProduct | null {
  const t = text.replace(/[׳']/g, '׳');
  const g = (re: RegExp) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
  const k = g(/(\d+(?:\.\d+)?)\s*(?:קלוריות|קל׳|קל)/) ?? g(/(?:קלוריות|קל׳|קל)\s*(\d+(?:\.\d+)?)/);
  if (k === null) return null;
  const p = g(/(\d+(?:\.\d+)?)\s*(?:חלבון|ח׳)/) ?? g(/(?:חלבון|ח׳)\s*(\d+(?:\.\d+)?)/) ?? 0;
  const c = g(/(\d+(?:\.\d+)?)\s*(?:פחמימות|פחמימה|פ׳)/) ?? g(/(?:פחמימות|פחמימה|פ׳)\s*(\d+(?:\.\d+)?)/) ?? 0;
  const f = g(/(\d+(?:\.\d+)?)\s*(?:שומן|ש׳)/) ?? g(/(?:שומן|ש׳)\s*(\d+(?:\.\d+)?)/) ?? 0;
  const grams = g(/(\d+(?:\.\d+)?)\s*(?:גרם|גר׳|ג׳)/);
  const name = t.replace(/^(?:הוסף\s+)?(?:מוצר\s+חדש|מזון\s+חדש|מוצר)\s*:?\s*/, '').split(/\d|:/)[0].replace(/\s+(?:ל|כל)$/, '').trim();
  if (!name) return null;
  if (grams && grams > 0) {
    const r = 100 / grams;
    return { name, unit: 'g', grams, per: { k: k * r, p: p * r, c: c * r, f: f * r } };
  }
  return { name, unit: 'p', grams: 0, per: { k, p, c, f } };
}

