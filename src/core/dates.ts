export const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (k: string, n: number) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
/** התאריך של "היום" לפי שעת האיפוס שהוגדרה (0 = חצות) */
export const todayKey = (resetHour = 0) => dateKey(new Date(Date.now() - resetHour * 3600_000));
export const dow = (k: string) => parseKey(k).getDay(); // 0 = ראשון
export const weekStart = (k: string) => addDays(k, -dow(k));

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const DAY_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export const dayLabel = (k: string, today: string) => {
  if (k === today) return 'היום';
  if (k === addDays(today, -1)) return 'אתמול';
  if (k === addDays(today, 1)) return 'מחר';
  return `יום ${DAY_NAMES[dow(k)]}`;
};
export const dayMonth = (k: string) => {
  const d = parseKey(k);
  return `${d.getDate()} ב${MONTHS[d.getMonth()]}`;
};
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
