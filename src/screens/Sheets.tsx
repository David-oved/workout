import { useEffect, useRef, useState } from 'preact/hooks';
import { Trash, Copy, Star } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { ui, setUi, toast } from '../ui/ui';
import { Sheet } from '../ui/components';
import { DAY_NAMES, dow } from '../core/dates';
import type { Entry, WorkoutStatus } from '../core/types';

const num = (v: string) => (v === '' ? 0 : Number(v) || 0);

export function EditEntrySheet() {
  const id = ui.use((u) => u.editEntry);
  const s = store.use((x) => x);
  const lastId = useRef<string | null>(null);
  if (id) lastId.current = id;
  const entry = s.entries.find((e) => e.id === (id ?? lastId.current));
  const [f, setF] = useState({ name: '', k: '', p: '', c: '', f: '', slot: '' });
  useEffect(() => {
    if (id && entry) setF({ name: entry.name, k: String(entry.k), p: String(entry.p), c: String(entry.c), f: String(entry.f), slot: entry.slot });
  }, [id]);
  const close = () => setUi({ editEntry: null });
  const fav = entry ? s.favorites.some((x) => x.name === entry.name) : false;

  const save = () => {
    if (!entry) return;
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
    actions.addEntry({ date: entry.date, slot: entry.slot, name: entry.name, k: entry.k, p: entry.p, c: entry.c, f: entry.f, est: entry.est });
    close();
    toast('המנה שוכפלה');
  };

  return (
    <Sheet open={!!id} onClose={close}>
      {entry && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>עריכת מנה</h3>
            <button class={'star' + (fav ? ' on' : '')} aria-label="מועדף" onClick={() => actions.toggleFavorite({ name: entry.name, k: entry.k, p: entry.p, c: entry.c, f: entry.f, est: entry.est })}>
              <Star fill={fav ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div class="chips" style={{ marginTop: 8 }}>
            {s.settings.slots.map((sl) => <button class={'chip' + (sl.id === f.slot ? ' on' : '')} onClick={() => setF({ ...f, slot: sl.id })}>{sl.name}</button>)}
          </div>
          <div class="field">
            <div class="full"><label class="lbl">שם</label><input class="inp" value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} /></div>
            <div><label class="lbl">קלוריות</label><input class="inp num" inputMode="numeric" value={f.k} onInput={(e) => setF({ ...f, k: (e.target as HTMLInputElement).value })} /></div>
            <div><label class="lbl">חלבון (ג׳)</label><input class="inp num" inputMode="numeric" value={f.p} onInput={(e) => setF({ ...f, p: (e.target as HTMLInputElement).value })} /></div>
            <div><label class="lbl">פחמימה (ג׳)</label><input class="inp num" inputMode="numeric" value={f.c} onInput={(e) => setF({ ...f, c: (e.target as HTMLInputElement).value })} /></div>
            <div><label class="lbl">שומן (ג׳)</label><input class="inp num" inputMode="numeric" value={f.f} onInput={(e) => setF({ ...f, f: (e.target as HTMLInputElement).value })} /></div>
          </div>
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
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button class="btn primary" style={{ flex: 1 }} onClick={save}>שמור</button>
        {w && <button class="btn danger" onClick={del}><Trash /> {w.routineId ? 'בטל' : 'מחק'}</button>}
      </div>
    </Sheet>
  );
}
