import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X, Plus, Trash, Trophy, Copy, Check } from 'lucide-preact';
import { beep, celebrate, unlockAudio } from '../ui/fx';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { uid, dayLabel, todayKey } from '../core/dates';
import { ui, setUi, toast } from '../ui/ui';
import { BigSheet } from '../ui/components';
import { EXERCISES, e1rm, templateFor } from '../data/exercises';
import { dayForTitle, exLabel, progressionFor } from '../core/plan';
import { AmtInput } from './FoodPicker';
import type { ExLog, Session, SetLog } from '../core/types';

const blank = (): SetLog => ({ kg: 0, reps: 0 });
const fmtSet = (x: SetLog) => (x.kg ? `${x.kg}×${x.reps}` : `${x.reps}`);
void exLabel;
const REST_TIPS = ['נושמים. שותים. סבלנות 💧', 'השרירים בונים את עצמם עכשיו', 'תפסיק לגלול, תנוח 😅', 'הסט הבא כבר מפחד ממך', 'נשימה עמוקה 😮‍💨', 'אל תחשוב. פשוט תנוח'];

/** יומן אימון: תרגילים וסטים. הערכים מהאימון הקודם מוצעים מראש, כדי שרק תתקן מה שהשתנה */
export function TrainingSheet() {
  const t = ui.use((u) => u.training);
  const s = store.useWhen((x) => x, !!t);
  const lastT = useRef(t);
  if (t) lastT.current = t;
  const cur = t ?? lastT.current;
  const [ex, setEx] = useState<ExLog[]>([]);
  const [q, setQ] = useState('');
  const [sid, setSid] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // טיימר מנוחה: מסמנים סט כבוצע והטיימר מתחיל
  const [doneKeys, setDoneKeys] = useState<string[]>([]);
  const [rest, setRest] = useState<{ end: number; total: number; tip: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const restSec = s.settings.show.restSec;
  useEffect(() => { if (!rest) return; const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, [!!rest]);
  const left = rest ? Math.max(0, Math.ceil((rest.end - now) / 1000)) : 0;
  const fin = !!rest && left === 0;
  useEffect(() => {
    if (!fin) return;
    beep();
    const tm = setTimeout(() => setRest(null), 3200);
    return () => clearTimeout(tm);
  }, [fin]);
  const tick = (i: number, j: number) => {
    unlockAudio();
    const k = i + '-' + j;
    const on = !doneKeys.includes(k);
    setDoneKeys((l) => (on ? [...l, k] : l.filter((x) => x !== k)));
    if (on && restSec > 0) { setNow(Date.now()); setRest({ end: Date.now() + restSec * 1000, total: restSec, tip: REST_TIPS[Math.floor(Math.random() * REST_TIPS.length)] }); }
  };

  const history = useMemo(() => [...s.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts), [s.sessions]);
  const prevOf = (name: string, exclude?: string | null) => history.find((x) => x.id !== exclude && x.exercises.some((e) => e.name === name))?.exercises.find((e) => e.name === name);

  useEffect(() => {
    if (!t) { setRest(null); return; }
    setQ('');
    setDoneKeys([]);
    setRest(null);
    const mine = t.workoutId ? s.sessions.find((x) => x.workoutId === t.workoutId) : undefined;
    if (mine) { setSid(mine.id); setEx(JSON.parse(JSON.stringify(mine.exercises))); return; }
    setSid(null);
    const pday = dayForTitle(s.plans, s.activePlan, t.title);
    if (pday) {
      const list: ExLog[] = [];
      for (const b of pday.blocks) for (const e of b.exercises) {
        const pv = prevOf(e.name);
        list.push({
          name: e.name, unit: e.unit, group: b.title, target: { sets: e.sets, reps: e.reps },
          sets: Array.from({ length: e.sets }, (_, i) => ({ kg: pv?.sets[i]?.kg ?? pv?.sets[pv.sets.length - 1]?.kg ?? e.kg ?? 0, reps: e.reps })),
        });
      }
      setEx(list);
      return;
    }
    const sameTitle = history.find((x) => x.title === t.title);
    if (sameTitle) {
      setEx(sameTitle.exercises.map((e) => ({ name: e.name, sets: e.sets.map((y) => ({ ...y })) })));
    } else {
      setEx(templateFor(t.title).map((name) => ({ name, sets: (prevOf(name)?.sets ?? [blank(), blank(), blank()]).map((y) => ({ ...y })) })));
    }
  }, [t?.workoutId, t?.date, t?.title, !!t]);

  const close = () => setUi({ training: null });
  const setSet = (i: number, j: number, patch: Partial<SetLog>) => setEx((l) => l.map((e, a) => (a === i ? { ...e, sets: e.sets.map((y, b) => (b === j ? { ...y, ...patch } : y)) } : e)));
  const addSet = (i: number) => setEx((l) => l.map((e, a) => (a === i ? { ...e, sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? blank()) }] } : e)));
  const rmSet = (i: number, j: number) => setEx((l) => l.map((e, a) => (a === i ? { ...e, sets: e.sets.filter((_, b) => b !== j) } : e)));
  const rmEx = (i: number) => setEx((l) => l.filter((_, a) => a !== i));
  const addEx = (name: string) => {
    if (ex.some((e) => e.name === name)) { toast('התרגיל כבר באימון'); return; }
    setEx((l) => [...l, { name, sets: (prevOf(name, sid)?.sets ?? [blank(), blank(), blank()]).map((y) => ({ ...y })) }]);
    setQ('');
    setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 120);
  };

  const results = q.trim() ? EXERCISES.filter((x) => x.name.includes(q.trim())).slice(0, 6) : [];
  const vol = ex.reduce((a, e) => a + e.sets.reduce((b, y) => b + y.kg * y.reps, 0), 0);
  const prFor = (e: ExLog) => {
    const prev = history.filter((x) => x.id !== sid).flatMap((x) => x.exercises.filter((y) => y.name === e.name)).flatMap((y) => y.sets);
    if (!prev.length) return false;
    const best = Math.max(...prev.map((y) => e1rm(y.kg, y.reps)));
    return e.sets.some((y) => y.kg > 0 && e1rm(y.kg, y.reps) > best + 0.4);
  };
  const prs = ex.filter(prFor).length;

  const save = () => {
    if (!cur) return;
    const clean = ex.map((e) => ({ ...e, sets: e.sets.filter((y) => y.reps > 0) })).filter((e) => e.sets.length);
    if (!clean.length) { toast('אין סטים לשמירה'); return; }
    const x: Session = { id: sid ?? uid(), date: cur.date, title: cur.title, workoutId: cur.workoutId, exercises: clean, ts: Date.now() };
    actions.saveSession(x);
    if (cur.workoutId) actions.updateWorkout(cur.workoutId, { status: 'done' });
    toast(`האימון נשמר · נפח ${Math.round(vol).toLocaleString('en-US')} ק״ג${prs ? ` · ${prs} שיאים חדשים` : ''}`);
    if (prs) setTimeout(() => celebrate('pr'), 350);
    close();
  };
  const del = () => {
    if (!sid) return;
    const copy = s.sessions.find((y) => y.id === sid);
    actions.deleteSession(sid);
    close();
    if (copy) toast('האימון נמחק מהיומן', () => actions.saveSession(copy));
  };

  const today = todayKey(s.settings.resetHour);
  return (
    <BigSheet open={!!t} onClose={close}>
      <div class="as-top">
        <div>
          <div class="as-ti" style={{ fontSize: 26 }}>{cur?.title ?? 'אימון'}</div>
          <div class="as-su num">{cur ? dayLabel(cur.date, today) : ''} · {ex.length} תרגילים · נפח {Math.round(vol).toLocaleString('en-US')} ק״ג</div>
          <button class="as-back" style={{ margin: '6px 0 0' }} onClick={() => { close(); setUi({ plan: { dayId: dayForTitle(s.plans, s.activePlan, cur?.title ?? '')?.id ?? null } }); }}>ערוך תוכנית</button>
        </div>
        <button class="as-x" aria-label="סגור" onClick={close}><X /></button>
      </div>

      <div class="as-body tr-body" ref={bodyRef} style={{ paddingBottom: 130 }}>
        {ex.map((e, i) => {
          const prev = prevOf(e.name, sid);
          const pr = e.target ? progressionFor({ id: '', name: e.name, sets: e.target.sets, reps: e.target.reps, unit: e.unit ?? 'reps' }, s.sessions.filter((x) => x.id !== sid)) : null;
          return (
            <div class="g tr-ex" key={e.name}>
              {e.group && <div class="tr-grp">{e.group}{e.target ? ` · יעד ${e.target.sets}×${e.unit === 'sec' ? `${e.target.reps} שנ׳` : e.target.reps}` : ''}</div>}
              <div class="tr-h">
                <b>{e.name}</b>
                {prFor(e) && <span class="tr-pr"><Trophy />שיא חדש</span>}
                <button class="as-rm" aria-label="הסר תרגיל" onClick={() => rmEx(i)}><Trash /></button>
              </div>
              {pr && (
                <button class="tr-prog" onClick={() => {
                  const day = dayForTitle(s.plans, s.activePlan, cur?.title ?? '');
                  const plan = s.plans.find((p) => p.days.includes(day!));
                  if (!plan || !day) return;
                  actions.savePlan({ ...plan, days: plan.days.map((d) => (d.id === day.id ? { ...d, blocks: d.blocks.map((b) => ({ ...b, exercises: b.exercises.map((x) => (x.name === e.name ? { ...x, ...pr.next } : x)) })) } : d)) });
                  toast('התוכנית עודכנה להתקדמות');
                }}>⬆ {pr.text} · עדכן תוכנית</button>
              )}
              {prev && <div class="tr-prev num">בפעם הקודמת: {prev.sets.map(fmtSet).join(' · ')}</div>}
              {e.sets.map((y, j) => (
                <div class={'tr-set' + (doneKeys.includes(i + '-' + j) ? ' done' : '')} key={j}>
                  <button class="tr-ck" aria-label="סט בוצע" aria-pressed={doneKeys.includes(i + '-' + j)} onClick={() => tick(i, j)}><Check /></button>
                  <span class="n num">{j + 1}</span>
                  <AmtInput value={y.kg} onChange={(n) => setSet(i, j, { kg: n })} suffix="ק״ג" />
                  <AmtInput value={y.reps} onChange={(n) => setSet(i, j, { reps: Math.round(n) })} suffix={e.unit === 'sec' ? 'שניות' : 'חזרות'} />
                  <button class="as-rm" aria-label="הסר סט" onClick={() => rmSet(i, j)}><X /></button>
                </div>
              ))}
              <button class="tr-add" onClick={() => addSet(i)}><Copy />סט נוסף</button>
            </div>
          );
        })}

        <div class="g tr-find">
          <input class="inp" value={q} placeholder="הוסף תרגיל…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          {results.map((r) => <button key={r.name} onClick={() => addEx(r.name)}><Plus />{r.name}<small>{r.group}</small></button>)}
          {q.trim() && !EXERCISES.some((x) => x.name === q.trim()) && <button onClick={() => addEx(q.trim())}><Plus />הוסף ״{q.trim()}״</button>}
        </div>
        {sid && <button class="btn danger block" style={{ marginTop: 12 }} onClick={del}><Trash />מחק מהיומן</button>}
      </div>

      {rest && (
        <div class={'g tr-rest' + (fin ? ' fin' : '')} role="timer">
          <div class="rt">
            <b class="num">{fin ? 'קדימה! 💥' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</b>
            <small>{fin ? 'הסט הבא מחכה' : rest.tip}</small>
            <div class="rbar"><i style={{ width: (fin ? 100 : (left / rest.total) * 100) + '%' }} /></div>
          </div>
          {!fin && <button class="rb" onClick={() => setRest({ ...rest, end: rest.end + 15000, total: rest.total + 15 })}>+15</button>}
          <button class="rb sk" onClick={() => setRest(null)}>{fin ? 'סגור' : 'דלג'}</button>
        </div>
      )}

      <div class="tr-foot">
        <button class="as-cta" onClick={save}>{cur?.workoutId ? 'שמור וסמן כבוצע' : 'שמור אימון'}</button>
      </div>
    </BigSheet>
  );
}
