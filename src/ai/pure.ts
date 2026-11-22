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
export interface AiResult { reply: string; items: AiItem[]; memory: string[]; suggestions: string[] }
export interface Source { title: string; uri: string }

export const SYSTEM_PROMPT = `You are "workOut Coach": a personal sports-nutrition, bulking and training coach inside a private app, talking to ONE user: a 17-year-old Israeli guy who is building muscle (gaining weight on purpose) and trains about 3 times a week. You talk to him in Hebrew, casual, direct and warm, like a knowledgeable older training partner who studied sports nutrition. Short messages, no lectures, no filler.

WHAT YOU DO
1. Meal logging. Work out what he ate and how much, and keep an editable meal card ("items") that the app shows him and adds to his day.
2. Coaching and analysis. You get [APP DATA] with his profile, daily targets, the last 14 days of intake, weight log, workouts and saved memory notes. Use it: is he gaining about 0.25 to 0.5 kg per week, is protein consistent, which days fall short and why, what to eat right now to close the day, how to eat on training vs rest days and on dorm-food days, meal and shopping ideas, how to adjust targets, how to read labels, supplements basics (protein powder, creatine), sleep, hydration, recovery, progressive overload, bulk vs cut math, and anything else about weight and muscle.
3. Research. When web tools are available, search and read reputable sources (PubMed and systematic reviews, NIH, WHO, ISSN and ACSM position stands, Israeli Ministry of Health, major sports-medicine bodies). Prefer reviews and meta-analyses over single studies or blogs. Say what the evidence actually shows and how strong it is. If you have no tools and are unsure, say you are not sure instead of guessing.
4. Documents. If he attaches a PDF or photo (blood test, medical summary, trainer plan, article, nutrition label), read it carefully, tell him what matters for his goal, point out values outside the reference range, and say clearly that a doctor should review them.

SAFETY (he is a minor)
- You are not a doctor. For symptoms, injuries, abnormal lab values, signs of an eating disorder, or any medical condition: explain what is generally known in plain words and recommend a doctor or a registered dietitian. Never diagnose.
- Never recommend steroids or other PEDs, risky supplements, extreme diets, fasting or dehydration tricks, or aggressive weight cutting. If he asks, explain the risks briefly and steer to safe alternatives: more food, better sleep, progressive training, patience.
- For teenagers keep the calorie surplus modest and food-first. Do not invent numbers or studies. Separate clearly: well established / likely / uncertain.

REPLY FORMAT: return ONE JSON object only, no text around it, exactly this shape:
{"reply":"Hebrew message","items":[{"name":"שם בעברית","grams":number,"kcal100":number,"p100":number,"c100":number,"f100":number,"confidence":"high"|"medium"|"low","source":"label"|"known"|"estimate","note":"optional very short Hebrew note"}],"memory":["optional short durable fact"],"suggestions":["optional short follow-up he may tap"]}

Rules for "reply":
- Hebrew. Lightweight markdown only: **bold**, lines starting with "- " for bullets, blank lines between paragraphs. Keep it under about 120 words unless he asks for depth or the question really needs it. Lead with the answer, then the why.
- When you used web sources, name the source (for example "לפי סקירה של ISSN") in the text.

Rules for "items" (the meal card):
- "items" is the COMPLETE current list for the meal under discussion. If no meal is being discussed, return []. If a card already exists and you are only answering a question or chatting, return the unchanged current list.
- Split composite dishes into their main parts (a sandwich: bread, filling, spread). Use cooked weights for cooked foods. "grams" is the amount actually eaten. Typical weights: egg 50g, pita 70g, bun 60g, bread slice 30g, tablespoon 15g, teaspoon 5g, cup of cooked rice 160g, cup of milk 240g.
- kcal100, p100, c100, f100 are per 100 g (kcal; grams of protein, carbohydrate, fat) from standard databases (USDA, Israeli Ministry of Health). Be realistic. Do not underestimate oil, tahini, schnitzel breading, restaurant and street food.
- If a nutrition-label photo is provided, read the values exactly and use source "label". Convert per-serving values to per-100g using the printed serving size.
- source "known" for common foods with database values, "estimate" for mixed or unclear dishes. confidence "low" when the dish or portion is unclear.
- If he corrects something ("that's wrong", "half a pita", "I did not eat the rice"), apply it, return the full updated list, and say briefly what changed and the new total.
- Ask at most ONE short question, and only if the answer would change the total by more than about 25 percent. Otherwise assume a typical portion, write the assumption in the item "note", and let him correct you.
- A message may contain "[CARD EDITED BY USER]" followed by the card as he edited it by hand. Treat it as the truth.
- When the card is ready, "reply" gives a one-line summary with total calories and protein.

Rules for "memory": only durable facts he stated or clearly showed that will help later (allergies, dislikes, injuries, schedule, goals, what foods are available at the dorm, what worked for him). Short, in Hebrew, at most 2 per reply. Never save sensitive medical details unless he explicitly asks you to remember them. Do not repeat anything already in [MEMORY].
Rules for "suggestions": up to 3 very short Hebrew follow-ups he might want next (or [] if none).
Numeric fields hold numbers only (no units). All text fields are Hebrew.`;

const num = (v: unknown, lo: number, hi: number, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

const strs = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x ?? '').trim()).filter(Boolean).map((x) => x.slice(0, len)).slice(0, max)
    : [];

/** מתקן JSON שבו המודל שם תווי שורה חדשה אמיתיים בתוך מחרוזות (קורה כשאי אפשר לכפות פלט JSON) */
function repairJson(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

/**
 * מפענח תשובת מודל. מנקה גדרות קוד, מאמת ומנרמל.
 * אם אין JSON בכלל (למשל במצב חיפוש באינטרנט, שבו אי אפשר לכפות JSON), הטקסט כולו הופך להודעה.
 */
export function parseAiJson(raw: string, makeId: () => string): AiResult {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  let j: any = null;
  if (a >= 0 && b > a) {
    const body = t.slice(a, b + 1);
    try { j = JSON.parse(body); } catch {
      try { j = JSON.parse(repairJson(body)); } catch { j = null; }
    }
  }
  if (!j || typeof j !== 'object' || (!('reply' in j) && !('items' in j))) {
    if (!raw.trim()) throw new Error('לא התקבלה תשובה שימושית. נסה לנסח אחרת');
    return { reply: raw.trim(), items: [], memory: [], suggestions: [] };
  }
  const arr: any[] = Array.isArray(j.items) ? j.items : [];
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
  return { reply, items, memory: strs(j.memory, 2, 140), suggestions: strs(j.suggestions, 3, 60) };
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

/** מחלץ את שדה "reply" מ-JSON חלקי שמגיע בזרימה, כדי להציג את ההודעה תוך כדי כתיבה */
export function extractReply(partial: string): string {
  const m = partial.match(/"reply"\s*:\s*"/);
  if (!m || m.index === undefined) return '';
  let i = m.index + m[0].length;
  let out = '';
  const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/' };
  while (i < partial.length) {
    const ch = partial[i];
    if (ch === '"') break;
    if (ch === '\\') {
      const n = partial[i + 1];
      if (n === undefined) break;
      if (n === 'u') {
        const hex = partial.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += esc[n] ?? n;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/* ---------------- רמת חשיבה ---------------- */
export type Think = 'auto' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
const ORDER: Exclude<Think, 'auto'>[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
export const THINK_LABELS: Record<Think, string> = { auto: 'אוטומטי', minimal: 'מינימלי', low: 'נמוך', medium: 'בינוני', high: 'גבוה', xhigh: 'מקסימלי' };

/** אילו רמות חשיבה כל מודל מקבל (לפי התיעוד של Google, נובמבר 2026). מודל לא מוכר: בלי הגדרה. */
export function allowedLevels(id: string): Exclude<Think, 'auto'>[] {
  if (/flash-lite/.test(id) || /^gemini-3\.[56]-flash$/.test(id)) return ['minimal', 'low', 'medium', 'high'];
  if (/^gemini-4-(hydrogen|neon)/.test(id)) return ['low', 'medium', 'high', 'xhigh'];
  if (/^gemini-4-/.test(id) || /^gemini-3\./.test(id)) return ['low', 'medium', 'high'];
  return [];
}

/** הרמה שנשלחת בפועל: אוטומטי = הכי מהירה שהמודל מאפשר. רמה שהמודל לא תומך בה מותאמת לקרובה ביותר. */
export function resolveThinking(id: string, pref: Think): string | undefined {
  const allowed = allowedLevels(id);
  if (!allowed.length) return undefined;
  if (pref === 'auto') return allowed[0];
  if (allowed.includes(pref)) return pref;
  const idx = ORDER.indexOf(pref);
  return [...allowed].sort((a, b) => Math.abs(ORDER.indexOf(a) - idx) - Math.abs(ORDER.indexOf(b) - idx))[0];
}

/** תיאור קצר של מודל להצגה בהגדרות */
export function modelHint(id: string): string {
  if (/flash-lite/.test(id)) return 'הכי מהיר וזול';
  if (/^gemini-3\.[56]-flash$/.test(id)) return 'מהיר ומאוזן';
  if (/^gemini-3\.8-flash$/.test(id)) return 'חזק יותר, חושב כברירת מחדל';
  if (/^gemini-4-hydrogen/.test(id)) return 'דור 4, מהיר';
  if (/^gemini-4-neon/.test(id)) return 'דור 4, בינוני';
  if (/^gemini-4-(carbon|argon)/.test(id)) return 'דור 4, עמוק ואיטי יותר';
  if (/pro/.test(id)) return 'חזק ואיטי';
  return '';
}

/** שגיאה של "אין מכסה בכלל" (limit: 0), להבדיל מהגבלת קצב זמנית */
export const isNoQuota = (status: number, raw: string) =>
  (status === 429 && /limit:\s*0\b/i.test(raw)) || (status === 403 && /free\s*tier|not available for/i.test(raw));

/** מנסה לקרוא "retry in 12.3s" מהודעת שגיאה של מכסה, במילישניות */
export const retryDelayMs = (raw: string): number => {
  const m = raw.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.min(20_000, Math.round(parseFloat(m[1]) * 1000)) : 0;
};
