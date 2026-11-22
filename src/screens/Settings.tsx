import { useRef } from 'preact/hooks';
import { X, Download, Upload, RefreshCw, Plus, Trash } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { store, update, defaultState } from '../core/state';
import { actions } from '../core/actions';
import { suggestTargets } from '../core/calc';
import { DAY_NAMES, uid } from '../core/dates';
import { ui, setUi, toast } from '../ui/ui';
import { FullScreen } from '../ui/components';
import { exportBackup, importBackup } from '../core/backup';
import { APP_VERSION, BUILD_ID, updater, checkForUpdate, applyUpdate } from '../update/updater';
import type { Macros, Profile, TargetKey } from '../core/types';

const TARGETS: [TargetKey, string][] = [
  ['dorm-rest', 'מעונות · מנוחה'], ['dorm-train', 'מעונות · אימון'], ['home-rest', 'בית · מנוחה'], ['home-train', 'בית · אימון'],
];
const Section = ({ title, children }: { title: string; children: ComponentChildren }) => (
  <>
    <div class="sec"><span>{title}</span></div>
    <div class="g card" style={{ padding: 16 }}>{children}</div>
  </>
);
const nv = (e: Event) => (e.target as HTMLInputElement).value;

export function SettingsScreen() {
  const open = ui.use((u) => u.settingsOpen);
  const s = store.use((x) => x);
  const u = updater.use((x) => x);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = s.settings;
  const p = set.profile;

  const setProfile = (patch: Partial<Profile>) => actions.saveSettings({ profile: { ...p, ...patch } });
  const setTarget = (key: TargetKey, m: keyof Macros, v: string) =>
    actions.saveSettings({ targets: { ...set.targets, [key]: { ...set.targets[key], [m]: Number(v) || 0 } } });

  const recalc = () => {
    const old = set.targets;
    actions.saveSettings({ targets: suggestTargets(p) });
    toast('היעדים חושבו מחדש', () => actions.saveSettings({ targets: old }));
  };

  const last = s.meta.lastBackup;
  const lastTxt = last ? new Date(last).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }) : 'עוד לא גובה';

  return (
    <FullScreen open={open}>
      <div class="hd">
        <div><div class="t">הגדרות</div><div class="s">הכל ניתן לשינוי</div></div>
        <button class="g ib" onClick={() => setUi({ settingsOpen: false })} aria-label="סגור"><X /></button>
      </div>
      <div class="fs-body" style={{ paddingBottom: 60 }}>
        <Section title="פרופיל">
          <div class="field">
            <div><label class="lbl">גיל</label><input class="inp num" inputMode="numeric" value={p.age} onChange={(e) => setProfile({ age: Number(nv(e)) || p.age })} /></div>
            <div><label class="lbl">גובה (ס״מ)</label><input class="inp num" inputMode="numeric" value={p.heightCm} onChange={(e) => setProfile({ heightCm: Number(nv(e)) || p.heightCm })} /></div>
            <div><label class="lbl">משקל נוכחי (ק״ג)</label><input class="inp num" inputMode="decimal" value={p.weightKg} onChange={(e) => setProfile({ weightKg: Number(nv(e)) || p.weightKg })} /></div>
            <div><label class="lbl">יעד משקל (ק״ג)</label><input class="inp num" inputMode="decimal" value={p.goalKg} onChange={(e) => setProfile({ goalKg: Number(nv(e)) || p.goalKg })} /></div>
            <div class="full">
              <label class="lbl">קצב עלייה</label>
              <div class="chips" style={{ marginBottom: 0 }}>
                {([['slow', 'איטי'], ['mid', 'בינוני'], ['fast', 'אגרסיבי']] as const).map(([id, l]) => <button class={'chip' + (p.pace === id ? ' on' : '')} onClick={() => setProfile({ pace: id })}>{l}</button>)}
              </div>
            </div>
            <button class="btn block full" onClick={recalc}><RefreshCw /> חשב יעדים מהפרופיל</button>
            <div class="mu full">הערכה בלבד. אחרי 2-3 שבועות כדאי לכייל לפי מגמת המשקל.</div>
          </div>
        </Section>

        <Section title="יעדים לפי סוג יום">
          {TARGETS.map(([key, label]) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <div style={{ marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {(['k', 'p', 'c', 'f'] as const).map((m) => (
                  <div><label class="lbl">{{ k: 'קלוריות', p: 'חלבון', c: 'פחמימה', f: 'שומן' }[m]}</label>
                    <input class="inp num" style={{ padding: '0 8px' }} inputMode="numeric" value={set.targets[key][m]} onChange={(e) => setTarget(key, m, nv(e))} /></div>
                ))}
              </div>
            </div>
          ))}
        </Section>

        <Section title="שבוע: מעונות או בית">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
            {set.places.map((pl, i) => (
              <button class={'chip' + (pl === 'dorm' ? ' on' : '')} style={{ minWidth: 0, padding: 0, height: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 18 }}
                onClick={() => actions.saveSettings({ places: set.places.map((x, j) => (j === i ? (x === 'dorm' ? 'home' : 'dorm') : x)) })}>
                <span style={{ fontSize: 12 }}>{DAY_NAMES[i].slice(0, 3)}׳</span>
                <span style={{ fontSize: 11 }}>{pl === 'dorm' ? 'מעונות' : 'בית'}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="ארוחות">
          {set.slots.map((sl, i) => (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }} key={sl.id}>
              <input class="inp" style={{ flex: 1 }} value={sl.name} onChange={(e) => actions.saveSettings({ slots: set.slots.map((x, j) => (j === i ? { ...x, name: nv(e) || x.name } : x)) })} />
              <input class="inp" style={{ width: 110 }} type="time" value={sl.time} onChange={(e) => actions.saveSettings({ slots: set.slots.map((x, j) => (j === i ? { ...x, time: nv(e) || x.time } : x)) })} />
              <button class="btn danger" style={{ padding: 0, width: 46 }} aria-label="מחק ארוחה" disabled={set.slots.length <= 1} onClick={() => actions.saveSettings({ slots: set.slots.filter((_, j) => j !== i) })}><Trash /></button>
            </div>
          ))}
          <button class="btn block" onClick={() => actions.saveSettings({ slots: [...set.slots, { id: uid(), name: 'ארוחה חדשה', time: '12:00' }] })}><Plus /> הוסף ארוחה</button>
        </Section>

        <Section title="שגרת אימונים">
          {set.routine.map((r, i) => {
            const patch = (x: Partial<typeof r>) => actions.saveRoutine(set.routine.map((y, j) => (j === i ? { ...y, ...x } : y)));
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }} key={r.id}>
                <select class="inp" value={r.dow} onChange={(e) => patch({ dow: Number(nv(e)) })}>{DAY_NAMES.map((d, k) => <option value={k}>{d}</option>)}</select>
                <input class="inp" type="time" value={r.time} onChange={(e) => patch({ time: nv(e) || r.time })} />
                <input class="inp" value={r.title} onChange={(e) => patch({ title: nv(e) || r.title })} />
                <button class="btn danger" onClick={() => actions.saveRoutine(set.routine.filter((_, j) => j !== i))}><Trash /> הסר</button>
              </div>
            );
          })}
          <button class="btn block" onClick={() => actions.saveRoutine([...set.routine, { id: uid(), dow: 1, time: '18:00', title: 'אימון' }])}><Plus /> הוסף אימון קבוע</button>
        </Section>

        <Section title="תחילת יום">
          <label class="lbl">מתי היום מתחלף</label>
          <select class="inp" value={set.resetHour} onChange={(e) => { actions.saveSettings({ resetHour: Number(nv(e)) }); toast('התחלת היום עודכנה'); }}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => <option value={h}>{h === 0 ? 'חצות (00:00)' : `0${h}:00 לפנות בוקר`}</option>)}
          </select>
        </Section>

        <Section title="גיבוי">
          <div class="mu" style={{ marginBottom: 12 }}>הנתונים נשמרים רק בטלפון. גיבוי אחרון: {lastTxt}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button class="btn primary" style={{ flex: 1 }} onClick={async () => { const r = await exportBackup(); if (r !== 'cancelled') toast('הגיבוי נוצר'); }}><Download /> ייצוא</button>
            <button class="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}><Upload /> ייבוא</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              if (!confirm('הייבוא יחליף את כל הנתונים הנוכחיים. להמשיך?')) return;
              toast((await importBackup(f)) ? 'הנתונים שוחזרו' : 'הקובץ לא תקין');
            }} />
          </div>
        </Section>

        <Section title="עדכונים">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span>הגרסה שלך</span><b class="num">{APP_VERSION}</b></div>
          <div class="mu num" style={{ marginBottom: 10, direction: 'ltr', textAlign: 'right' }}>{BUILD_ID}</div>
          <div style={{ marginBottom: 12, color: u.status === 'available' ? 'var(--accent)' : 'var(--mu)' }}>
            {{ idle: '', checking: 'בודק מול השרת…', latest: 'אתה על הגרסה העדכנית ביותר', available: `יש גרסה חדשה${u.remote ? ` (${u.remote.version})` : ''}`, applying: 'מעדכן…', error: 'לא הצלחתי לבדוק. בדוק חיבור לאינטרנט.' }[u.status]}
          </div>
          {u.status === 'available' && u.remote?.notes?.length ? <ul class="mu" style={{ margin: '0 0 12px', paddingRight: 18 }}>{u.remote.notes.map((n) => <li>{n}</li>)}</ul> : null}
          {u.status === 'available'
            ? <button class="btn primary block" onClick={() => void applyUpdate()}><RefreshCw /> עדכן עכשיו</button>
            : <button class="btn block" onClick={() => void checkForUpdate()}><RefreshCw class={u.status === 'checking' ? 'spin' : ''} /> בדוק עדכונים</button>}
        </Section>

        <Section title="אזור זהירות">
          <button class="btn danger block" onClick={() => {
            if (!confirm('למחוק את כל הנתונים? אי אפשר לשחזר בלי גיבוי.')) return;
            update(() => defaultState());
            setUi({ settingsOpen: false });
            toast('הכל נמחק');
          }}><Trash /> מחק את כל הנתונים</button>
        </Section>
      </div>
    </FullScreen>
  );
}
