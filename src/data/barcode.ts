import { store } from '../core/state';
import type { CustomFood, Macros } from '../core/types';

/**
 * חיפוש מוצר לפי ברקוד: קודם מה ששמרת בעבר (מיידי, גם בלי רשת), ואז Open Food Facts (חינמי, בלי מפתח).
 * ערכים חסרים לא מומצאים: מוצר בלי ערכים תזונתיים חוזר כ"נמצא בלי ערכים", והמשתמש משלים אותם בעצמו.
 */
export interface ScanProduct {
  code: string;
  name: string;
  brand?: string;
  per: Macros; // ל-100 גרם
  servingG?: number; // משקל מנה אחת
  packG?: number; // משקל אריזה
  complete: boolean; // יש קלוריות לפחות
}
export type LookupResult =
  | { kind: 'local'; food: CustomFood }
  | { kind: 'off'; product: ScanProduct }
  | { kind: 'none'; reason: 'notfound' | 'offline' | 'error'; code: string };

/** ברקוד תקין: EAN-8, UPC-A, EAN-13 או GTIN-14 (ספרות בלבד) */
export const validCode = (c: string) => /^(\d{8}|\d{12,14})$/.test(c);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** "400 g", "1.5 l", "6 x 50 g" → גרם (או מ״ל כקירוב). אם לא ברור: undefined */
export function parseQuantity(q: unknown): number | undefined {
  if (typeof q !== 'string') return undefined;
  const t = q.toLowerCase().replace(',', '.').trim();
  const m = t.match(/(?:(\d+(?:\.\d+)?)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|ml|cl|l)\b/);
  if (!m) return undefined;
  const times = m[1] ? parseFloat(m[1]) : 1;
  const v = parseFloat(m[2]);
  const mul = { kg: 1000, g: 1, gr: 1, ml: 1, cl: 10, l: 1000 }[m[3] as 'kg'] ?? 1;
  const g = times * v * mul;
  return g > 0 && g <= 5000 ? Math.round(g) : undefined;
}

/** מפענח את התשובה של Open Food Facts (מופרד כדי שאפשר יהיה לבדוק) */
export function parseOff(code: string, p: any): ScanProduct | null {
  if (!p || typeof p !== 'object') return null;
  const nu = p.nutriments ?? {};
  const kcal = num(nu['energy-kcal_100g']) ?? (num(nu['energy_100g']) !== undefined ? num(nu['energy_100g'])! / 4.184 : undefined);
  const pr = num(nu['proteins_100g']);
  const c = num(nu['carbohydrates_100g']);
  const f = num(nu['fat_100g']);
  const name = String(p.product_name_he || p.product_name || p.generic_name || '').trim();
  const brand = String(p.brands ?? '').split(',')[0]?.trim() || undefined;
  if (!name && kcal === undefined && pr === undefined) return null;
  // בלי קלוריות אבל עם מאקרו: מחשבים (4/4/9)
  const k = kcal ?? (pr !== undefined || c !== undefined || f !== undefined ? (pr ?? 0) * 4 + (c ?? 0) * 4 + (f ?? 0) * 9 : undefined);
  const serving = num(p.serving_quantity) ?? parseQuantity(p.serving_size);
  return {
    code,
    name: name || 'מוצר ללא שם',
    brand,
    per: { k: Math.round(k ?? 0), p: r1(pr ?? 0), c: r1(c ?? 0), f: r1(f ?? 0) },
    servingG: serving && serving > 0 && serving <= 1500 ? Math.round(serving) : undefined,
    packG: parseQuantity(p.quantity),
    complete: k !== undefined && k > 0,
  };
}

const cache = new Map<string, LookupResult>();

export async function lookupBarcode(code: string): Promise<LookupResult> {
  const local = store.get().customFoods.find((x) => x.barcode === code);
  if (local) return { kind: 'local', food: local };
  const hit = cache.get(code);
  if (hit) return hit;
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const fields = 'code,product_name,product_name_he,generic_name,brands,quantity,serving_size,serving_quantity,nutriments';
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, { signal: ctl.signal });
    if (r.status === 404) return { kind: 'none', reason: 'notfound', code };
    if (!r.ok) return { kind: 'none', reason: 'error', code };
    const j = await r.json();
    const product = j?.status === 1 ? parseOff(code, j.product) : null;
    const res: LookupResult = product ? { kind: 'off', product } : { kind: 'none', reason: 'notfound', code };
    if (product) cache.set(code, res);
    return res;
  } catch {
    return { kind: 'none', reason: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error', code };
  } finally {
    clearTimeout(to);
  }
}
