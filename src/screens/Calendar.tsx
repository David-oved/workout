import { useState } from 'preact/hooks';
import { Settings as Cog, ChevronLeft, ChevronRight, Dumbbell, Utensils, Check, CalendarPlus, Plus } from 'lucide-preact';
import { store } from '../core/state';
import { dayInfo, fmt } from '../core/calc';
import { DAY_NAMES, DAY_SHORT, MONTHS, addDays, dayMonth, dow, parseKey, todayKey, weekStart } from '../core/dates';
import { ui, setUi, openAdd } from '../ui/ui';

export function CalendarScreen() {
  const s = store.use((x) => x);
  const tab = ui.use((u) => u.tab);
  const today = todayKey(s.settings.resetHour);
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState(today);
  const ws = addDays(weekStart(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const selDate = days.includes(sel) ? sel : days[0];
  const info = dayInfo(s, selDate);
  const month = MONTHS[parseKey(days[3]).getMonth()];

  type Ev = { time: string; kind: 'meal' | 'work'; title: string; sub: string; done?: boolean; skipped?: boolean; onClick: () => void };
  const events: Ev[] = [];
  for (const sl of s.settings.slots) {
    const eaten = info.entries.filter((e) => e.slot === sl.id).reduce((a, e) => a + e.k, 0);
    events.push({ time: sl.time, kind: 'meal', title: `ארוחת ${sl.name}`, sub: eaten ? `${fmt(eaten)} קל׳ נרשמו` : 'עדיין לא נרשם', done: eaten > 0, onClick: () => openAdd(sl.id, selDate) });
  }
  for (const w of info.workouts) {
    events.push({ time: w.time, kind: 'work', title: w.title, sub: w.status === 'done' ? 'בוצע' : w.status === 'skipped' ? 'בוטל' : 'מתוכנן · תזכורת 30 דק׳ לפני', done: w.status === 'done', skipped: w.status === 'skipped', onClick: () => setUi({ workoutSheet: { id: w.id, date: w.date } }) });
  }
  events.sort((a, b) => a.time.localeCompare(b.time));

  return (
    <section class={'screen' + (tab === 'calendar' ? ' on' : '')} aria-label="לוח שנה">
      <div class="hd">
        <div><div class="t">לוח שנה</div><div class="s">{month} {parseKey(days[3]).getFullYear()}</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button class="g ib" aria-label="שבוע קודם" onClick={() => setOffset(offset - 1)}><ChevronRight /></button>
          <button class="g ib" aria-label="שבוע הבא" onClick={() => setOffset(offset + 1)}><ChevronLeft /></button>
          <button class="g ib" aria-label="הגדרות" onClick={() => setUi({ settingsOpen: true })}><Cog /></button>
        </div>
      </div>

      <div class="g card" style={{ padding: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {days.map((d) => {
            const hasW = s.workouts.some((w) => w.date === d && w.status !== 'skipped');
            return (
              <button class={'dy' + (d === selDate ? ' on' : '') + (d === today ? ' td' : '')} key={d} onClick={() => setSel(d)}>
                <span>{DAY_SHORT[dow(d)]}</span>
                <b class="num">{parseKey(d).getDate()}</b>
                <i class="dt" style={{ opacity: hasW ? 1 : 0 }} />
              </button>
            );
          })}
        </div>
      </div>

      <div class="sec">
        <span>{DAY_NAMES[dow(selDate)]} {dayMonth(selDate)} · {info.place === 'dorm' ? 'מעונות' : 'בית'} · {info.training ? 'יום אימון' : 'יום מנוחה'}</span>
      </div>
      <div class="g rows">
        {events.map((e, i) => (
          <button class="ev" key={i} onClick={e.onClick} style={{ opacity: e.skipped ? 0.5 : 1 }}>
            <span class="tm num">{e.time}</span>
            <span class="vb" style={{ background: e.kind === 'work' ? 'var(--accent)' : 'var(--cc)' }} />
            <div style={{ textDecoration: e.skipped ? 'line-through' : undefined }}>{e.title}<small>{e.sub}</small></div>
            {e.done ? <Check class="ok" /> : e.kind === 'work' ? <Dumbbell /> : <Utensils />}
          </button>
        ))}
      </div>
      <button class="btn block" style={{ marginTop: 12 }} onClick={() => setUi({ workoutSheet: { date: selDate } })}><Plus /> הוסף אימון</button>

      <button class="g card" style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'right' }} onClick={() => setUi({ settingsOpen: true, settingsPage: 'calendar' })}>
        <CalendarPlus size={22} color="var(--accent)" />
        <div style={{ flex: 1 }}>
          {s.settings.cal.enabled ? 'מסונכרן ליומן (אפל / Google)' : 'חבר את היומן של אפל או Google'}
          <div class="mu">{s.settings.cal.enabled ? 'האימונים מתעדכנים ביומן עם התראה לפני כל אימון' : 'תזכורות לאימונים ישר ליומן שלך'}</div>
        </div>
      </button>
    </section>
  );
}
