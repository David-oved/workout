import { useEffect, useState } from 'preact/hooks';
import { Bell, X, Droplets, ListChecks, Minus, Settings as Cog, ChevronLeft, ChevronRight, Plus, Dumbbell, Check, Copy, Download, Siren, RefreshCw, Utensils } from 'lucide-preact';
import { EventList } from '../ui/EventList';
import { bridge, refreshEvents, syncWorkouts } from '../core/bridge';
import { conflictsFor, eventsOn, hhmm, suggestSlot } from '../core/conflicts';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { DAY_NAMES, addDays, dayLabel, dayMonth, dow, todayKey } from '../core/dates';
import { ui, setUi, openAdd, toast } from '../ui/ui';
import { Ring } from '../ui/components';
import { label } from '../core/meal';
import { nudgesFor, type Nudge } from '../core/reminders';
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
      {w.status !== 'skipped' && (
        <button class="btn sm tlog" aria-label="יומן אימון" onClick={(e) => { e.stopPropagation(); setUi({ training: { workoutId: w.id, date: w.date, title: w.title } }); }}><ListChecks />{done ? 'יומן' : 'רשום'}</button>
      )}
      {w.status === 'planned' && (
        <button
          class="btn primary sm"
          onClick={(e) => { e.stopPropagation(); actions.updateWorkout(w.id, { status: 'done' }); toast('האימון סומן כבוצע', () => actions.updateWorkout(w.id, { status: 'planned' })); }}
        >בוצע</button>
      )}
    </div>
  );
}

const nudgeKey = (d: string) => 'wo:nudge:' + d;
const readDismissed = (d: string): string[] => { try { return JSON.parse(localStorage.getItem(nudgeKey(d)) ?? '[]'); } catch { return []; } };

/** "דחיפות" חכמות: מה כדאי לעשות עכשיו, לפי השעה ומה שרשמת. כל אחת אפשר לסגור להיום */
function Nudges({ today }: { today: string }) {
  const s = store.use((x) => x);
  const [tick, setTick] = useState(0);
  const [gone, setGone] = useState<string[]>(() => readDismissed(today));
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    const v = () => { if (document.visibilityState === 'visible') { setTick((n) => n + 1); setGone(readDismissed(today)); } };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [today]);
  void tick;
  const list = nudgesFor(s).filter((n) => !gone.includes(n.id));
  if (!list.length) return null;
  const dismiss = (id: string) => { const next = [...gone, id]; setGone(next); try { localStorage.setItem(nudgeKey(today), JSON.stringify(next)); } catch { /* ignore */ } };
  const act = (n: Nudge) => {
    const c = n.cta;
    if (!c) return;
    if (c.kind === 'add') openAdd(c.slot, today);
    else if (c.kind === 'progress') setUi({ tab: 'progress' });
    else if (c.kind === 'train') setUi({ training: { workoutId: c.workoutId, date: c.date ?? today, title: c.title ?? 'אימון' } });
    else if (c.kind === 'water') actions.addWater(today, 250);
    if (c.kind !== 'water') dismiss(n.id);
  };
  return (
    <div class="nudges">
      {list.map((n) => (
        <div class="g nudge" key={n.id}>
          <Bell />
          <span class="tx">{n.text}</span>
          {n.cta && <button class="go" onClick={() => act(n)}>{n.cta.label}</button>}
          <button class="x" aria-label="סגור להיום" onClick={() => dismiss(n.id)}><X /></button>
        </div>
      ))}
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
  const waterGoal = Math.round((s.settings.profile.weightKg * 35) / 250) * 250 + (info.training ? 500 : 0);
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
                  {e.parts && e.parts.length > 1 && <span class="esub">{e.parts.map((p) => label(p.name)).join(' · ')}</span>}
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
              <div class="ate num"><b style={{ color: m.color }}>{eaten[m.k]}</b> ג׳ אכלתי</div>
              <div class="mu">{rem < 0 ? `מעל היעד (${target[m.k]})` : `מתוך ${target[m.k]} ג׳`}</div>
            </div>
          );
        })}
      </div>

      {date === today && <Nudges today={today} />}

      <div class="g wtr">
        <Droplets />
        <div class="tx">
          <b>מים</b>
          <span class="mu num">{((s.water[date] ?? 0) / 1000).toFixed(2)} מתוך {(waterGoal / 1000).toFixed(1)} ליטר</span>
          <div class="wbar"><i style={{ width: Math.min(100, ((s.water[date] ?? 0) / waterGoal) * 100) + '%' }} /></div>
        </div>
        <button class="wb" aria-label="הפחת כוס" onClick={() => actions.addWater(date, -250)}><Minus /></button>
        <button class="wb pl" aria-label="הוסף כוס" onClick={() => actions.addWater(date, 250)}><Plus /><small>250</small></button>
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
