import type { Workout } from './types';

const CRLF = '\r\n';
const enc = new TextEncoder();

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** קיפול שורות לפי התקן: עד 75 בתים (UTF-8), שורת המשך מתחילה ברווח */
function fold(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join(CRLF);
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** תאריך ושעה "צפים" (בלי אזור זמן): מוצגים באותה שעה על הקיר בכל מכשיר */
function stamp(date: string, time: string, addMin = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, mi + addMin));
  return `${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}T${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}00`;
}

export interface IcsOptions { alertMin: number; durationMin: number; name: string }

/** בונה קובץ יומן (ICS) של האימונים. התוכן יציב: אותו קלט נותן אותו פלט, כדי שאפשר לדלג על עדכונים מיותרים. */
export function buildIcs(workouts: Workout[], o: IcsOptions): string {
  const list = workouts
    .filter((w) => w.status !== 'skipped')
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id.localeCompare(b.id));
  const L: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//workOut//he//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(o.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const w of list) {
    L.push(
      'BEGIN:VEVENT',
      `UID:${w.id}@workout`,
      'DTSTAMP:20260101T000000Z',
      `DTSTART:${stamp(w.date, w.time)}`,
      `DTEND:${stamp(w.date, w.time, o.durationMin)}`,
      `SUMMARY:${esc(w.title)}`,
      'DESCRIPTION:workOut',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
    );
    if (o.alertMin > 0) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(w.title)}`, `TRIGGER:-PT${o.alertMin}M`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join(CRLF) + CRLF;
}
