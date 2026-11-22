import { Settings as Cog, ChevronLeft, ChevronRight, Plus, Dumbbell, Check, Copy, Download, Siren, RefreshCw, Utensils } from 'lucide-preact';
import { EventList } from '../ui/EventList';
import { bridge, refreshEvents, syncWorkouts } from '../core/bridge';
import { conflictsFor, eventsOn, hhmm, suggestSlot } from '../core/conflicts';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { DAY_NAMES, addDays, dayLabel, dayMonth, dow, todayKey } from '../core/dates';
import { ui, setUi, openAdd, toast } from '../ui/ui';
import { Ring } from '../ui/components';
import type { Workout } from '../core/types';

const MACROS = [
  { k: 'p', name: 'חלבון', color: 'var(--cp)' },
  { k: 'c', name: 'פחמימה', color: 'var(--cc)' },
  { k: 'f', name: 'שומן', color: 'var(--cf)' },
] as const;

export function WorkoutCard({ w }: { w: Workout }) {
  const done = w.status === 'done';
  const skipped = w.status === 'skipped';
  return (
    <div class={'g wcard' + (skipped ? ' skipped' : '')} onClick={() => setUi({ workoutSheet: { id: w.id, date: w.date } })}>
      <div class={'ic' + (done ? ' done' : '')}>{done ? <Check size={22} /> : <Dumbbell size={22} />}</div>
      <div class="tx">
        <b>{w.title}</b>
        <span class="mu">{w.time} · {done ? 'בוצע' : skipped ? 'בוטל' : 'מתוכנן'}</span>
      </div>
      {w.status === 'planned' && (
        <button
          class="btn primary sm"
          onClick={(e) => { e.stopPropagation(); actions.updateWorkout(w.id, { status: 'done' }); toast('האימון סומן כבוצע', () => actions.updateWorkout(w.id, { status: 'planned' })); }}
        >בוצע</button>
      )}
    </div>
  );
}

export function TodayScreen() {
  const s = store.use((x) => x);
  const date = ui.use((u) => u.date);
  const tab = ui.use((u) => u.tab);
  const today = todayKey(s.settings.resetHour);
  const info = dayInfo(s, date);
  const ext = bridge.use((x) => x.events);
  const connected = bridge.use((x) => x.connected);
  const evStatus = bridge.use((x) => x.evStatus);
  const syncStatus = bridge.use((x) => x.syncStatus);
  const evAt = bridge.use((x) => x.evAt);
  const busy = evStatus === 'loading' || syncStatus === 'syncing';
  const doSync = async () => {
    await Promise.all([refreshEvents(true), syncWorkouts(true)]);
    const b = bridge.get();
    toast(b.evStatus === 'error' || b.syncStatus === 'error' ? 'הסנכרון נכשל. בדוק חיבור' : 'היומן מסונכרן');
  };
  const agoTxt = evAt ? (Math.round((Date.now() - evAt) / 60000) < 1 ? 'עודכן הרגע' : `עודכן לפני ${Math.round((Date.now() - evAt) / 60000)} דק׳`) : 'סנכרן';
  const dayEv = eventsOn(ext, date);
  const { target, eaten } = info;
  const left = target.k - eaten.k;
  const slots = s.settings.slots;
  const known = new Set(slots.map((x) => x.id));
  const orphan = info.entries.filter((e) => !known.has(e.slot));
  const yesterday = addDays(date, -1);
  const canCopy = info.entries.length === 0 && s.entries.some((e) => e.date === yesterday);
  const weekAgo = Date.now() - 7 * 86400_000;
  const needBackup = s.entries.length > 6 && (s.meta.lastBackup ?? 0) < weekAgo;

  const go = (n: number) => setUi({ date: addDays(date, n) });
  const sub = `${DAY_NAMES[dow(date)]} ${dayMonth(date)} · ${info.place === 'dorm' ? 'מעונות' : 'בית'}`;

  const group = (id: string, name: string, time?: string) => {
    const list = id === '__other' ? orphan : info.entries.filter((e) => e.slot === id);
    const kc = list.reduce((a, e) => a + e.k, 0);
    return (
      <div class="slot" key={id}>
        <div class="slot-h">
          <span>{name}{time && <small class="mu" style={{ marginRight: 8 }}>{time}</small>}</span>
          <span class="k">
            {kc > 0 ? <span class="kpill num">{fmt(kc)} קל׳</span> : <span style={{ color: 'var(--mu2)' }}>עדיין לא</span>}
            {id !== '__other' && <button class="addmini" aria-label={`הוסף ל${name}`} onClick={() => openAdd(id, date)}><Plus /></button>}
          </span>
        </div>
        {list.length > 0 && (
          <div class="slot-b">
            {list.map((e) => (
              <button class="ent2" key={e.id} onClick={() => setUi({ editEntry: e.id })}>
                <span class="eic"><Utensils /></span>
                <span class="etx">
                  <b>{e.name}{e.est && <i class="etag">הערכה</i>}</b>
                  <span class="emac num"><i class="mp">{e.p} ח׳</i><i class="mc2">{e.c} פ׳</i><i class="mf">{e.f} ש׳</i></span>
                </span>
                <span class="ekc num"><b>{fmt(e.k)}</b><small>קל׳</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section class={'screen' + (tab === 'today' ? ' on' : '')} aria-label="היום">
      <div class="hd">
        <div>
          <button class="t" style={{ display: 'block', textAlign: 'right' }} onClick={() => setUi({ date: today })}>{dayLabel(date, today)}</button>
          <div class="s">{sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button class="g ib" aria-label="היום הקודם" onClick={() => go(-1)}><ChevronRight /></button>
          <button class="g ib" aria-label="היום הבא" onClick={() => go(1)}><ChevronLeft /></button>
          <button class="g ib" aria-label="הגדרות" onClick={() => setUi({ settingsOpen: true })}><Cog /></button>
        </div>
      </div>

      <div class="g hero">
        <Ring size={150} stroke={12} pct={eaten.k / target.k} color={left < 0 ? 'var(--warn)' : 'var(--accent)'}>
          <div class="rc">
            <div class="big num">{fmt(Math.abs(left))}</div>
            <div class="mu">{left < 0 ? 'קלוריות מעל היעד' : 'קלוריות נשארו'}</div>
          </div>
        </Ring>
        <div class="st">
          <div><span class="mu">אכלתי</span><b class="num">{fmt(eaten.k)}</b></div>
          <div><span class="mu">יעד {info.training ? '· יום אימון' : '· יום מנוחה'}</span><b class="num">{fmt(target.k)}</b></div>
        </div>
      </div>

      <div class="mini">
        {MACROS.map((m) => {
          const rem = target[m.k] - eaten[m.k];
          return (
            <div class="g mc" key={m.k}>
              <Ring size={70} stroke={6.5} pct={eaten[m.k] / target[m.k]} color={m.color} cls="mr">
                <span class="num">{Math.abs(rem)}</span>
              </Ring>
              <div style={{ fontSize: 14 }}>{m.name}</div>
              <div class="mu">{rem < 0 ? 'מעל היעד' : `מתוך ${target[m.k]} ג׳`}</div>
            </div>
          );
        })}
      </div>

      {info.workouts.map((w) => <WorkoutCard w={w} key={w.id} />)}
      {connected && info.workouts.filter((w) => w.status === 'planned').map((w) => {
        const cf = conflictsFor(w, ext);
        if (!cf.length) return null;
        const slot = suggestSlot(date, ext, s.workouts, w.time, w.id);
        return (
          <div class="g wcard warn" key={'c' + w.id}>
            <div class="ic"><Siren size={22} /></div>
            <div class="tx">
              <b>התנגשות ביומן</b>
              <span class="mu">{w.title} ב-{w.time} מול ״{cf[0].title}״ (<bdi style={{ direction: 'ltr' }}>{hhmm(cf[0].start)}–{hhmm(cf[0].end)}</bdi>){cf.length > 1 ? ` ועוד ${cf.length - 1}` : ''}</span>
            </div>
            {slot && (
              <button class="btn primary sm" onClick={() => { const old = w.time; actions.updateWorkout(w.id, { time: slot }); toast(`האימון הועבר ל-${slot}`, () => actions.updateWorkout(w.id, { time: old })); }}>הזז ל-{slot}</button>
            )}
          </div>
        );
      })}
      {connected && (
        <>
          <div class="sec">
            <span>ביומן שלך</span>
            <button class="syncb" onClick={() => void doSync()} aria-label="סנכרן יומן"><RefreshCw class={busy ? 'spin' : ''} />{busy ? 'מסנכרן…' : agoTxt}</button>
          </div>
          {dayEv.timed.length > 0 || dayEv.allDay.length > 0
            ? <EventList timed={dayEv.timed} allDay={dayEv.allDay} isToday={date === today} />
            : <div class="g card mu" style={{ textAlign: 'center' }}>אין אירועים ביומן ליום הזה</div>}
        </>
      )}
      {info.workouts.length === 0 && (
        <button class="btn block" style={{ marginTop: 12 }} onClick={() => setUi({ workoutSheet: { date } })}><Dumbbell /> הוסף אימון ליום הזה</button>
      )}

      <div class="sec"><span>ארוחות</span></div>
      <div class="g rows">
        {slots.map((sl) => group(sl.id, sl.name, sl.time))}
        {orphan.length > 0 && group('__other', 'אחר')}
      </div>

      {canCopy && (
        <button class="btn block" style={{ marginTop: 12 }} onClick={() => {
          const n = actions.duplicateDay(yesterday, date);
          toast(`הועתקו ${n} מנות מאתמול`);
        }}><Copy /> העתק את אתמול</button>
      )}
      {needBackup && (
        <button class="g card" style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'right' }} onClick={() => setUi({ settingsOpen: true })}>
          <Download size={20} color="var(--accent)" />
          <span style={{ flex: 1 }}>עבר יותר משבוע מהגיבוי האחרון<span class="mu" style={{ display: 'block' }}>הנתונים נשמרים רק בטלפון. כדאי לגבות.</span></span>
        </button>
      )}
    </section>
  );
}
