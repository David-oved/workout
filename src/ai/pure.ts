/** לוגיקה טהורה של ה-AI (בלי תלות בדפדפן), כדי שאפשר יהיה לבדוק אותה בנפרד */

export interface AiItem {
  id: string;
  name: string;
  grams: number;
  kcal100: number;
  p100: number;
  c100: number;
  f100: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'label' | 'known' | 'estimate';
  note?: string;
}
export interface AiResult { reply: string; items: AiItem[] }

export const SYSTEM_PROMPT = `You are the nutrition assistant inside a personal food-tracking app for a 17-year-old Israeli who is bulking (gaining muscle). You chat with him in Hebrew, like a friendly, sharp coach: short messages, no lectures, no medical advice.
He describes what he ate (text, photos of food, or photos of nutrition labels). Together you work out what he ate and how much. Then the app shows him an editable "meal card" built from your items, and he adds it to his day.

Reply with ONE JSON object only, no prose around it, exactly this shape:
{"reply":"short Hebrew chat message","items":[{"name":"שם בעברית","grams":number,"kcal100":number,"p100":number,"c100":number,"f100":number,"confidence":"high"|"medium"|"low","source":"label"|"known"|"estimate","note":"optional very short Hebrew note"}]}

How to behave:
- "items" is the COMPLETE current list for the meal under discussion, every time you reply. If nothing is known yet, or you only ask a question, return "items": [] when there is no card yet, or return the unchanged current list when a card already exists.
- If the user corrects something ("that's wrong", "it was half a pita", "I didn't eat the rice"), apply it and return the full updated list. In "reply" say briefly what you changed and the new total calories.
- Ask at most ONE short question, and only if the answer would change the total by more than about 25 percent (for example unknown amount of rice or oil). Otherwise assume a typical portion, mention the assumption in the item "note", and let him correct you.
- When the card is ready, "reply" gives a one-line summary with total calories and protein.
- Messages may include "[CARD EDITED BY USER]" followed by the card as he edited it by hand. Treat that as the truth and build on it.
- Split composite dishes into their main parts (a sandwich: bread, filling, spread). Use cooked weights for cooked foods.
- "grams" is the amount actually eaten. Convert quantities with typical weights: egg 50g, pita 70g, bun 60g, bread slice 30g, tablespoon 15g, teaspoon 5g, cup of cooked rice 160g, cup of milk 240g.
- kcal100, p100, c100, f100 are per 100 g (kcal; grams of protein, carbohydrate, fat) from standard nutrition databases (USDA, Israeli Ministry of Health). Be realistic and do not underestimate oil, tahini, schnitzel breading, or restaurant and street food.
- If a nutrition-label photo is provided, read the values from it exactly and use source "label". Convert per-serving values to per-100g using the printed serving size.
- source "known" for common foods with database values, "estimate" for mixed or unclear dishes. confidence "low" when the dish or portion is unclear.
- If the user asks a general question (what to eat now, how much protein is left), answer in "reply" and keep "items" as described above.
- Numbers only (no units) in numeric fields. Hebrew for all text.`;

const num = (v: unknown, lo: number, hi: number, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** מפענח תשובת מודל: מנקה גדרות קוד, מאמת ומנרמל. זורק שגיאה אם אין לא טקסט ולא מנות. */
export function parseAiJson(raw: string, makeId: () => string): AiResult {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('התשובה לא בפורמט צפוי');
  const j = JSON.parse(t.slice(a, b + 1));
  const arr: any[] = Array.isArray(j?.items) ? j.items : [];
  const items: AiItem[] = [];
  for (const x of arr) {
    const name = String(x?.name ?? '').trim();
    if (!name) continue;
    items.push({
      id: makeId(),
      name,
      grams: Math.round(num(x?.grams, 1, 3000, 100)),
      kcal100: num(x?.kcal100, 0, 950),
      p100: num(x?.p100, 0, 100),
      c100: num(x?.c100, 0, 100),
      f100: num(x?.f100, 0, 100),
      confidence: ['high', 'medium', 'low'].includes(x?.confidence) ? x.confidence : 'medium',
      source: ['label', 'known', 'estimate'].includes(x?.source) ? x.source : 'estimate',
      note: x?.note ? String(x.note) : undefined,
    });
  }
  const reply = String(j?.reply ?? j?.question ?? j?.summary ?? '').trim();
  if (!items.length && !reply) throw new Error('לא התקבלה תשובה שימושית. נסה לנסח אחרת');
  return { reply, items };
}

export const itemMacros = (it: { grams: number; kcal100: number; p100: number; c100: number; f100: number }) => ({
  k: Math.round((it.grams / 100) * it.kcal100),
  p: Math.round((it.grams / 100) * it.p100),
  c: Math.round((it.grams / 100) * it.c100),
  f: Math.round((it.grams / 100) * it.f100),
});

export interface ModelInfo { name: string; methods?: string[] }

/** בוחר את מודל ה-Flash היציב והחדש ביותר שתומך ב-generateContent */
export function pickModel(models: ModelInfo[]): string | null {
  // אם התשובה לא מציינת generateContent בכלל (השדה לא מתועד היטב), לא מסננים לפיו
  const withMethod = models.filter((m) => m.methods?.includes('generateContent'));
  const pool = withMethod.length ? withMethod : models;
  const ids = pool.map((m) => m.name.replace(/^models\//, ''));
  const bad = /(lite|preview|exp|image|tts|live|audio|robot|computer|embed|thinking|8b|latest|vision|-\d{3}$)/i;
  const ver = (id: string) => (id.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const cmp = (a: string, b: string) => {
    const va = ver(a), vb = ver(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const d = (vb[i] ?? 0) - (va[i] ?? 0);
      if (d) return d;
    }
    return a.length - b.length;
  };
  const stable = ids.filter((id) => /^gemini-[\d.]+-flash$/.test(id) && !bad.test(id)).sort(cmp);
  if (stable.length) return stable[0];
  const loose = ids.filter((id) => /flash/i.test(id) && !bad.test(id)).sort(cmp);
  if (loose.length) return loose[0];
  const lite = ids.filter((id) => /flash/i.test(id) && !/(preview|exp|image|tts|live|audio|embed)/i.test(id)).sort(cmp);
  return lite[0] ?? null;
}
