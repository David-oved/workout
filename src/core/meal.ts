import type { Dish, Macros, Part } from './types';

/** חישובי ארוחה מורכבת וסיר: מקום אחד לכל המתמטיקה */
export const ZERO: Macros = { k: 0, p: 0, c: 0, f: 0 };

export const partMacros = (p: { amount: number; base: number; per: Macros }): Macros => ({
  k: Math.round((p.per.k * p.amount) / p.base),
  p: Math.round((p.per.p * p.amount) / p.base),
  c: Math.round((p.per.c * p.amount) / p.base),
  f: Math.round((p.per.f * p.amount) / p.base),
});

export const sumMacros = (list: Macros[]): Macros =>
  list.reduce((a, m) => ({ k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }), { ...ZERO });

export const sumParts = (parts: Part[]): Macros => sumMacros(parts.map(partMacros));

/** סך הסיר אחרי בישול: מצרכים גולמיים פחות שומן שנשפך (9 קל׳ לגרם) */
export function dishTotals(d: Pick<Dish, 'parts' | 'fatLoss'>): Macros {
  const raw = d.parts.reduce(
    (a, p) => {
      const q = (p.amount / p.base);
      return { k: a.k + p.per.k * q, p: a.p + p.per.p * q, c: a.c + p.per.c * q, f: a.f + p.per.f * q };
    },
    { ...ZERO },
  );
  const lost = raw.f * d.fatLoss;
  return { k: Math.max(0, raw.k - lost * 9), p: raw.p, c: raw.c, f: raw.f - lost };
}

/** ערכים ל-100 גרם מוכן */
export function dishPer100(d: Pick<Dish, 'parts' | 'fatLoss' | 'cookedG'>): Macros {
  const t = dishTotals(d);
  const w = Math.max(1, d.cookedG);
  return { k: (t.k * 100) / w, p: (t.p * 100) / w, c: (t.c * 100) / w, f: (t.f * 100) / w };
}

/** המצרכים שנכנסו לחלק של X גרם מהסיר */
export function dishSub(d: Pick<Dish, 'parts' | 'cookedG'>, grams: number): Part[] {
  const r = grams / Math.max(1, d.cookedG);
  return d.parts.map((p) => ({ ...p, id: p.id + ':s', amount: Math.round(p.amount * r * 10) / 10 }));
}

/** הערכת משקל אחרי בישול לפי מקדם התנפחות/התכווצות של כל מצרך (בלי מקדם: משקל זהה) */
export const estimateCooked = (parts: Part[], yieldOf: (p: Part) => number | undefined): number =>
  Math.round(parts.reduce((a, p) => a + (p.unit === 'g' ? p.amount * (yieldOf(p) ?? 1) : 0), 0));

const NOISE = /\s+(מבושלת|מבושל|מבושלים|מבושלות|יבשה|יבש|יבשות|נא|צלוי|צלויה|אפוי|אפויה|טרי|טרייה|\(.*?\))$/;
export function label(name: string): string {
  let n = name.replace(/\s*\([^)]*\)/g, '').split(',')[0].trim();
  for (let i = 0; i < 2; i++) n = n.replace(NOISE, '').trim();
  return n || name;
}

/** שם אוטומטי לארוחה: "אורז, עוף וקטשופ" */
export function autoMealName(parts: { name: string }[]): string {
  const names: string[] = [];
  for (const p of parts) { const l = label(p.name); if (!names.includes(l)) names.push(l); }
  if (names.length <= 1) return names[0] ?? 'ארוחה';
  if (names.length <= 3) return names.slice(0, -1).join(', ') + ' ו' + names[names.length - 1];
  return names.slice(0, 2).join(', ') + ` ועוד ${names.length - 2}`;
}

export const partLabel = (p: Part): string => (p.unit === 'g' ? `${Math.round(p.amount)} ג׳` : p.amount !== 1 ? `×${p.amount}` : 'מנה');
