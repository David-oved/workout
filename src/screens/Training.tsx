import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X, Plus, Trash, Trophy, Copy } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { uid, dayLabel, todayKey } from '../core/dates';
import { ui, setUi, toast } from '../ui/ui';
import { BigSheet } from '../ui/components';
import { EXERCISES, e1rm, templateFor } from '../data/exercises';
import { AmtInput } from './FoodPicker';
import type { ExLog, Session, SetLog } from '../core/types';

const blank = (): SetLog => ({ kg: 0, reps: 0 });
const fmtSet = (x: SetLog) => (x.kg ? `${x.kg}×${x.reps}` : `${x.reps} חז׳`);

/** יומן אימון: תרגילים וסטים. הערכים מהאימון הקודם מוצעים מראש, כדי שרק תתקן מה שהשתנה */
export function TrainingSheet() {
  const t = ui.use((u) => u.training);
  const s = store.use((x) => x);
  const lastT = useRef(t);
  if (t) lastT.current = t;
  const cur = t ?? lastT.current;
  const [ex, setEx] = useState<ExLog[]>([]);
  const [q, setQ] = useState('');
  const [sid, setSid] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const history = useMemo(() => [...s.sessions].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts), [s.sessions]);
  const prevOf = (name: string, exclude?: string | null) => history.find((x) => x.id !== exclude && x.exercises.some((e) => e.name === name))?.exercises.find((e) => e.name === name);

  useEffect(() => {
    if (!t) return;
    setQ('');
    const mine = t.workoutId ? s.sessions.find((x) => x.workoutId === t.workoutId) : undefined;
    if (mine) { setSid(mine.id); setEx(JSON.parse(JSON.stringify(mine.exercises))); return; }
    setSid(null);
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
    const clean = ex.map((e) => ({ ...e, sets: e.sets.filter((y) => y.reps > 0 || y.kg > 0) })).filter((e) => e.sets.length);
    if (!clean.length) { toast('אין סטים לשמירה'); return; }
    const x: Session = { id: sid ?? uid(), date: cur.date, title: cur.title, workoutId: cur.workoutId, exercises: clean, ts: Date.now() };
    actions.saveSession(x);
    if (cur.workoutId) actions.updateWorkout(cur.workoutId, { status: 'done' });
    toast(`האימון נשמר · נפח ${Math.round(vol).toLocaleString('en-US')} ק״ג${prs ? ` · ${prs} שיאים חדשים` : ''}`);
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
        </div>
        <button class="as-x" aria-label="סגור" onClick={close}><X /></button>
      </div>

      <div class="as-body tr-body" ref={bodyRef} style={{ paddingBottom: 130 }}>
        {ex.map((e, i) => {
          const prev = prevOf(e.name, sid);
          return (
            <div class="g tr-ex" key={e.name}>
              <div class="tr-h">
                <b>{e.name}</b>
                {prFor(e) && <span class="tr-pr"><Trophy />שיא חדש</span>}
                <button class="as-rm" aria-label="הסר תרגיל" onClick={() => rmEx(i)}><Trash /></button>
              </div>
              {prev && <div class="tr-prev num">בפעם הקודמת: {prev.sets.map(fmtSet).join(' · ')}</div>}
              {e.sets.map((y, j) => (
                <div class="tr-set" key={j}>
                  <span class="n num">{j + 1}</span>
                  <AmtInput value={y.kg} onChange={(n) => setSet(i, j, { kg: n })} suffix="ק״ג" />
                  <AmtInput value={y.reps} onChange={(n) => setSet(i, j, { reps: Math.round(n) })} suffix="חזרות" />
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

      <div class="tr-foot">
        <button class="as-cta" onClick={save}>{cur?.workoutId ? 'שמור וסמן כבוצע' : 'שמור אימון'}</button>
      </div>
    </BigSheet>
  );
}
