import { hhmm, type ExtEvent } from '../core/conflicts';

const PALETTE = ['#B69CFF', '#8AB4FF', '#F5C97A', '#5CE1A8', '#FF9EC4', '#7FE0E8'];
/** צבע יציב לכל יומן */
export const colorFor = (cal: string) => {
  let h = 0;
  for (const c of cal) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));

/** רשימת אירועי יומן: כרטיסים עם שעת התחלה גדולה, פס צבע לפי יומן, הדגשת "עכשיו" ועמעום אירועים שעברו */
export function EventList({ timed, allDay, isToday }: { timed: ExtEvent[]; allDay: ExtEvent[]; isToday: boolean }) {
  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  return (
    <div class="evl">
      {allDay.length > 0 && (
        <div class="evad">
          {allDay.map((e) => <span class="adc" key={e.id} style={{ '--c': colorFor(e.cal) } as any}>{e.title}</span>)}
        </div>
      )}
      {timed.map((e) => {
        const sameDay = e.start.slice(0, 10) === e.end.slice(0, 10);
        const live = isToday && sameDay && mins(e.start) <= nowM && nowM < mins(e.end);
        const past = isToday && sameDay && mins(e.end) <= nowM;
        return (
          <div class={'evc' + (live ? ' live' : '') + (past ? ' past' : '')} key={e.id} style={{ '--c': colorFor(e.cal) } as any}>
            <div class="evt"><b>{hhmm(e.start)}</b><span>{hhmm(e.end)}</span></div>
            <span class="evbar" />
            <div class="evx">
              <b>{e.title}</b>
              {!e.cal.includes('@') && <small>{e.cal}</small>}
            </div>
            {live && <span class="evnow">עכשיו</span>}
          </div>
        );
      })}
    </div>
  );
}
