import { useEffect, useRef, useState } from 'preact/hooks';
import { Trash, Copy, Star, X, Plus } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { ui, setUi, toast } from '../ui/ui';
import { Sheet } from '../ui/components';
import { bridge } from '../core/bridge';
import { conflictsFor, hhmm, suggestSlot } from '../core/conflicts';
import { DAY_NAMES, dow } from '../core/dates';
import { fmt } from '../core/calc';
import { autoMealName, dishSub, label, partMacros, sumParts } from '../core/meal';
import { uid } from '../core/dates';
import { defaultPortion } from '../ui/tray';
import type { FoodRec } from '../data/foodDb';
import { AmtInput, FoodPicker } from './FoodPicker';
import type { Entry, Part, WorkoutStatus } from '../core/types';

const num = (v: string) => (v === '' ? 0 : Number(v) || 0);

export function EditEntrySheet() {
  const id = ui.use((u) => u.editEntry);
  const s = store.use((x) => x);
  const lastId = useRef<string | null>(null);
  if (id) lastId.current = id;
  const entry = s.entries.find((e) => e.id === (id ?? lastId.current));
  const [f, setF] = useState({ name: '', k: '', p: '', c: '', f: '', slot: '' });
  const [ps, setPs] = useState<Part[]>([]);
  const [adding, setAdding] = useState(false);
  const hasParts = !!entry?.parts?.length;
  useEffect(() => {
    if (id && entry) {
      setF({ name: entry.name, k: String(entry.k), p: String(entry.p), c: String(entry.c), f: String(entry.f), slot: entry.slot });
      setPs(entry.parts ?? []);
      setAdding(false);
    }
  }, [id]);
  const close = () => setUi({ editEntry: null });
  const fav = entry ? s.favorites.some((x) => x.name === entry.name) : false;
  const tot = sumParts(ps);

  const setAmt = (pid: string, n: number) =>
    setPs((l) => l.map((p) => {
      if (p.id !== pid) return p;
      const d = p.foodId?.startsWith('d:') ? store.get().dishes.find((x) => x.id === p.foodId!.slice(2)) : undefined;
      return { ...p, amount: n, sub: d ? dishSub(d, n) : p.sub };
    }));
  const addFood = (r: FoodRec) => {
    setPs((l) => [...l, { id: uid(), name: r.name, unit: r.unit, amount: r.unit === 'g' ? defaultPortion(r.portions) : 1, base: r.base, per: r.per, est: r.est, foodId: r.id }]);
    setAdding(false);
  };

  const save = () => {
    if (!entry) return;
    if (hasParts) {
      if (!ps.length) { toast('אין רכיבים. אפשר למחוק את הארוחה'); return; }
      const m = sumParts(ps);
      const was = entry.name;
      // שם שנשאר אוטומטי מתעדכן ברכיבים החדשים; שם שהמשתמש בחר נשאר
      const auto = entry.parts && autoMealName(entry.parts) === was;
      const name = f.name.trim() && f.name.trim() !== was ? f.name.trim() : auto && ps.length > 1 ? autoMealName(ps) : was;
      actions.updateEntry(entry.id, { name, ...m, parts: ps, slot: f.slot, est: ps.some((p) => p.est) });
      close();
      return;
    }
    if (!num(f.k)) return;
    actions.updateEntry(entry.id, { name: f.name.trim() || entry.name, k: num(f.k), p: num(f.p), c: num(f.c), f: num(f.f), slot: f.slot, est: false });
    close();
  };
  const del = () => {
    if (!entry) return;
    const copy: Entry = { ...entry };
    actions.deleteEntry(entry.id);
    close();
    toast('המנה נמחקה', () => actions.restoreEntry(copy));
  };
  const dup = () => {
    if (!entry) return;
    actions.addEntry({ date: entry.date, slot: entry.slot, name: entry.name, k: entry.k, p: entry.p, c: entry.c, f: entry.f, est: entry.est, parts: entry.parts, dishId: entry.dishId });
    close();
    toast('המנה שוכפלה');
  };

  return (
    <Sheet open={!!id} onClose={close}>
      {entry && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>{hasParts && entry.parts!.length > 1 ? 'ארוחה' : 'עריכת מנה'}</h3>
            <button class={'star' + (fav ? ' on' : '')} aria-label="מועדף" onClick={() => actions.toggleFavorite({ name: entry.name, k: entry.k, p: entry.p, c: entry.c, f: entry.f, est: entry.est, parts: entry.parts })}>
              <Star fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div class="chips" style={{ marginTop: 8 }}>
            {s.settings.slots.map((sl) => <button class={'chip' + (sl.id === f.slot ? ' on' : '')} onClick={() => setF({ ...f, slot: sl.id })}>{sl.name}</button>)}
          </div>
          {hasParts ? (
            <>
              <div class="field" style={{ marginBottom: 0 }}>
                <div class="full"><label class="lbl">שם</label><input class="inp" value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} /></div>
              </div>
              <div class="as-lbl" style={{ marginTop: 14 }}>
                <span>מה בפנים</span>
                <span class="num">{fmt(tot.k)} קל׳ · {tot.p} ח׳ · {tot.c} פ׳ · {tot.f} ש׳</span>
              </div>
              <div class="parts-l">
                {ps.map((p) => {
                  const m = partMacros(p);
                  return (
                    <div key={p.id}>
                      <div class="part-r">
                        <div class="pn"><b>{p.name}</b><small class="num">{m.p} ח׳ · {m.c} פ׳ · {m.f} ש׳</small></div>
                        <AmtInput value={p.amount} onChange={(n) => setAmt(p.id, n)} suffix={p.unit === 'g' ? 'ג׳' : 'מנות'} />
                        <span class="pk num">{m.k}</span>
                        <button class="as-rm" aria-label="הסר" onClick={() => setPs((l) => l.filter((x) => x.id !== p.id))}><X /></button>
                      </div>
                      {p.sub && p.sub.length > 0 && (
                        <div class="sub-l">מהמצרכים: {p.sub.map((x) => `${label(x.name)} ${Math.round(x.amount)} ג׳`).join(' · ')}</div>
                      )}
                    </div>
                  );
                })}
              </div>
              {adding ? <div style={{ marginTop: 10 }}><FoodPicker autoFocus onPick={addFood} placeholder="הוסף רכיב…" /></div> : (
                <button class="btn block" style={{ marginTop: 10 }} onClick={() => setAdding(true)}><Plus />הוסף רכיב</button>
              )}
            </>
          ) : (
            <div class="field">
              <div class="full"><label class="lbl">שם</label><input class="inp" value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">קלוריות</label><input class="inp num" inputMode="numeric" value={f.k} onInput={(e) => setF({ ...f, k: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">חלבון (ג׳)</label><input class="inp num" inputMode="numeric" value={f.p} onInput={(e) => setF({ ...f, p: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">פחמימה (ג׳)</label><input class="inp num" inputMode="numeric" value={f.c} onInput={(e) => setF({ ...f, c: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">שומן (ג׳)</label><input class="inp num" inputMode="numeric" value={f.f} onInput={(e) => setF({ ...f, f: (e.target as HTMLInputElement).value })} /></div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button class="btn primary" style={{ flex: 1 }} onClick={save}>שמור</button>
            <button class="btn" onClick={dup} aria-label="שכפל"><Copy /></button>
            <button class="btn danger" onClick={del} aria-label="מחק"><Trash /></button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function WorkoutSheet() {
  const ws = ui.use((u) => u.workoutSheet);
  const s = store.use((x) => x);
  const last = useRef(ws);
  if (ws) last.current = ws;
  const cur = last.current;
  const w = cur?.id ? s.workouts.find((x) => x.id === cur.id) : undefined;
  const ext = bridge.use((x) => x.events);
  const connected = bridge.use((x) => x.connected);
  const [f, setF] = useState({ title: '', date: '', time: '18:00', status: 'planned' as WorkoutStatus });
  useEffect(() => {
    if (!ws) return;
    const ex = ws.id ? store.get().workouts.find((x) => x.id === ws.id) : undefined;
    setF(ex ? { title: ex.title, date: ex.date, time: ex.time, status: ex.status } : { title: '', date: ws.date, time: '18:00', status: 'planned' });
  }, [ws?.id, ws?.date, !!ws]);
  const close = () => setUi({ workoutSheet: null });

  const save = () => {
    const title = f.title.trim() || 'אימון';
    if (w) actions.updateWorkout(w.id, { title, date: f.date, time: f.time, status: f.status });
    else actions.addWorkout({ title, date: f.date, time: f.time });
    close();
    toast(w ? 'האימון עודכן' : 'האימון נוסף');
  };
  const del = () => {
    if (!w) return;
    const prev = { ...w };
    actions.deleteWorkout(w.id);
    close();
    toast(w.routineId ? 'האימון בוטל' : 'האימון נמחק', () => (w.routineId ? actions.updateWorkout(w.id, { status: prev.status }) : actions.addWorkout({ ...prev })));
  };

  return (
    <Sheet open={!!ws} onClose={close}>
      <h3>{w ? 'עריכת אימון' : 'אימון חדש'}</h3>
      {w && (
        <div class="chips" style={{ marginTop: 10 }}>
          {([['planned', 'מתוכנן'], ['done', 'בוצע'], ['skipped', 'בוטל']] as const).map(([id, label]) => (
            <button class={'chip' + (f.status === id ? ' on' : '')} onClick={() => setF({ ...f, status: id })}>{label}</button>
          ))}
        </div>
      )}
      <div class="field" style={{ marginTop: 10 }}>
        <div class="full"><label class="lbl">שם האימון</label><input class="inp" value={f.title} placeholder="למשל חזה וכתפיים" onInput={(e) => setF({ ...f, title: (e.target as HTMLInputElement).value })} /></div>
        <div><label class="lbl">תאריך {f.date && `· ${DAY_NAMES[dow(f.date)]}`}</label><input class="inp" type="date" value={f.date} onInput={(e) => setF({ ...f, date: (e.target as HTMLInputElement).value })} /></div>
        <div><label class="lbl">שעה</label><input class="inp" type="time" value={f.time} onInput={(e) => setF({ ...f, time: (e.target as HTMLInputElement).value })} /></div>
      </div>
      {connected && f.date && (() => {
        const cf = conflictsFor({ date: f.date, time: f.time }, ext);
        const slot = suggestSlot(f.date, ext, s.workouts, f.time, w?.id);
        return (
          <div class="mu" style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: cf.length ? 'var(--warn)' : undefined }}>{cf.length ? `מתנגש עם ״${cf[0].title}״ (${hhmm(cf[0].start)} עד ${hhmm(cf[0].end)})` : 'פנוי ביומן'}</span>
            {slot && slot !== f.time && <button class="btn sm" onClick={() => setF({ ...f, time: slot })}>הצע: {slot}</button>}
          </div>
        );
      })()}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button class="btn primary" style={{ flex: 1 }} onClick={save}>שמור</button>
        {w && <button class="btn danger" onClick={del}><Trash /> {w.routineId ? 'בטל' : 'מחק'}</button>}
      </div>
    </Sheet>
  );
}
