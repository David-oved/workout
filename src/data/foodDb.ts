import { createStore } from '../core/store';
import type { Macros, Portion, State } from '../core/types';
import { BUILTIN_FOODS, PORTION_G } from './foods';
import { STAPLES } from './staples';

/**
 * מאגר המזון: ~4,600 מזונות ממאגר משרד הבריאות (נטען בעצלתיים בחיפוש הראשון),
 * מעליו "מצרכי יסוד" עם שם קצר, מנות טיפוסיות ומקדמי בישול, וגם מזונות שהוספת בעצמך.
 * כל מזון אפשר לתקן, והתיקון נשמר אצלך ומשפיע על כל הפעמים הבאות.
 */
export interface FoodRec {
  id: string; // il:<קוד> | x:<שם> | b:<שם מנה> | c:<מזהה>
  name: string; // שם להצגה
  full?: string; // השם המלא במאגר
  per: Macros; // לכל base
  unit: 'g' | 'p';
  base: number; // 100 לגרמים, 1 למנה
  portions: Portion[];
  kind?: 'raw' | 'cooked';
  y?: number; // משקל מבושל / גולמי
  src: 'il' | 'x' | 'b' | 'c';
  edited?: boolean;
  est?: boolean;
  staple?: boolean;
  alias?: string;
}

type Row = [number, string, number, number, number, number];
let IL: Row[] = [];
let recs: FoodRec[] = [];
let texts: string[] = [];
let nameTexts: string[] = [];
const byId = new Map<string, FoodRec>();
let loading: Promise<void> | null = null;
export const dbState = createStore({ ready: false, error: '' });

export const norm = (s: string) => s.toLowerCase().replace(/[׳'’"״,.()/\-–:+%*]/g, ' ').replace(/\s+/g, ' ').trim();

/** שם קצר לתצוגה מתוך שם ארוך של המאגר */
export function shortName(full: string): string {
  const parts = full.replace(/\s+/g, ' ').split(', ');
  let out = parts[0];
  for (let i = 1; i < parts.length && out.length < 22; i++) out += ', ' + parts[i];
  return out.length > 44 ? out.slice(0, 42).trim() + '…' : out;
}

export const BUILTIN_DUP = new Set(['לחמנייה', 'פרוסת לחם', 'פיתה', 'ביצה קשה', 'בננה', 'תפוח', 'חזה עוף מבושל', 'אורז מבושל', 'פסטה מבושלת', 'תפוח אדמה', 'חלב', 'מיץ תפוזים', 'קולה', 'אבוקדו', 'טחינה', 'חמאת בוטנים', 'שקדים', 'שיבולת שועל', 'במבה', 'ביסלי', 'טונה', 'חומוס', 'קוטג׳', 'פרוסת גבינה צהובה']);

function build() {
  recs = [];
  byId.clear();
  const staples = new Map<number, (typeof STAPLES)[number]>();
  for (const s of STAPLES) if (s.code) staples.set(s.code, s);
  for (const r of IL) {
    const st = staples.get(r[0]);
    const rec: FoodRec = {
      id: 'il:' + r[0],
      name: st ? st.name : shortName(r[1]),
      full: r[1],
      per: { k: r[2], p: r[3], c: r[4], f: r[5] },
      unit: 'g', base: 100, portions: st?.portions ?? [],
      kind: st?.kind, y: st?.y, src: 'il', staple: !!st, alias: st?.alias,
    };
    recs.push(rec);
  }
  for (const st of STAPLES) {
    if (!st.x) continue;
    const [slug, k, p, c, f] = st.x;
    recs.push({ id: 'x:' + slug, name: st.name, per: { k, p, c, f }, unit: 'g', base: 100, portions: st.portions ?? [], kind: st.kind, y: st.y, src: 'x', staple: true, est: true, alias: st.alias });
  }
  for (const b of BUILTIN_FOODS) {
    if (BUILTIN_DUP.has(b.name)) continue;
    const gr = PORTION_G[b.name];
    if (gr) {
      const f = 100 / gr;
      recs.push({ id: 'b:' + b.name, name: b.name, per: { k: b.k * f, p: b.p * f, c: b.c * f, f: b.f * f }, unit: 'g', base: 100, portions: [{ l: b.unit ?? 'מנה', g: gr }], src: 'b', est: true, staple: true });
    } else {
      recs.push({ id: 'b:' + b.name, name: b.name, per: { k: b.k, p: b.p, c: b.c, f: b.f }, unit: 'p', base: 1, portions: [], src: 'b', est: true, staple: true });
    }
  }
  const clean = (t: string) => norm(t).replace(/לא מבושלS*/g, ' ').replace(/s+/g, ' ');
  nameTexts = recs.map((r) => clean(r.name + ' ' + (r.alias ?? '')));
  texts = recs.map((r) => clean(r.full ?? ''));
  recs.forEach((r) => byId.set(r.id, r));
}

export function loadDb(): Promise<void> {
  if (!loading) {
    loading = import('./il-foods.json')
      .then((m) => { IL = ((m as { default?: unknown }).default ?? m) as Row[]; build(); dbState.set({ ready: true, error: '' }); })
      .catch(() => { loading = null; dbState.set({ ready: false, error: 'לא הצלחתי לטעון את מאגר המזון' }); });
  }
  return loading;
}

/** מחיל תיקונים אישיים ומזונות אישיים */
function applyEdit(r: FoodRec, s: State): FoodRec {
  const e = s.foodEdits[r.id];
  if (!e) return r;
  return { ...r, per: { k: e.k, p: e.p, c: e.c, f: e.f }, name: e.name || r.name, edited: true };
}

export function customRecs(s: State): FoodRec[] {
  return s.customFoods.map((c) => ({
    id: 'c:' + c.id, name: c.name, per: c.per, unit: c.unit, base: c.unit === 'g' ? 100 : 1, portions: c.portions ?? [], src: 'c' as const, staple: true,
  }));
}

export function getFood(id: string, s: State): FoodRec | undefined {
  if (id.startsWith('c:')) return customRecs(s).find((r) => r.id === id);
  const r = byId.get(id);
  return r ? applyEdit(r, s) : undefined;
}

export function searchFoods(q: string, s: State, limit = 30): FoodRec[] {
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const out: { r: FoodRec; sc: number }[] = [];
  const score = (nameT: string, fullT: string, r: FoodRec) => {
    let sc = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      let at = nameT.indexOf(t);
      if (at >= 0) {
        sc += 100 + (at === 0 || nameT[at - 1] === ' ' ? 60 : 0);
        if (at === 0 && i === 0) sc += 120;
        continue;
      }
      at = fullT.indexOf(t);
      if (at < 0) return -1;
      sc += at === 0 || fullT[at - 1] === ' ' ? 20 : 0;
    }
    sc -= r.name.length * 0.6;
    if (r.staple) sc += 220;
    if (r.full?.startsWith('FFQ')) sc -= 200;
    return sc;
  };
  customRecs(s).forEach((r) => { const sc = score(norm(r.name), '', r); if (sc >= 0) out.push({ r, sc: sc + 400 }); });
  for (let i = 0; i < recs.length; i++) {
    const sc = score(nameTexts[i], texts[i], recs[i]);
    if (sc >= 0) out.push({ r: recs[i], sc });
  }
  out.sort((a, b) => b.sc - a.sc);
  return out.slice(0, limit).map((x) => applyEdit(x.r, s));
}

export const dbSize = () => recs.length;
