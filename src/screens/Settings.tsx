import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { X, ChevronLeft, ChevronRight, User, Target, CalendarDays, CalendarPlus, Copy, Utensils, Sunrise, Download, Upload, RefreshCw, Plus, Minus, Trash, Info, Dumbbell } from 'lucide-preact';
import { store, update, defaultState } from '../core/state';
import { actions } from '../core/actions';
import { fmt, suggestTargets } from '../core/calc';
import { DAY_NAMES, uid } from '../core/dates';
import { setUi, ui, toast } from '../ui/ui';
import { feedState, feedUrl, webcalUrl, hasToken, verifyToken, saveToken, enableFeed, disconnectFeed, syncFeed } from '../core/calfeed';
import { FullScreen, Sheet } from '../ui/components';
import { exportBackup, importBackup } from '../core/backup';
import { APP_VERSION, BUILD_ID, updater, checkForUpdate, applyUpdate } from '../update/updater';
import type { Macros, Profile, TargetKey } from '../core/types';

type Page = 'home' | 'profile' | 'targets' | 'week' | 'meals' | 'start' | 'backup' | 'updates' | 'calendar';
const TITLES: Record<Page, string> = {
  home: 'הגדרות', profile: 'פרופיל', targets: 'יעדי תזונה', week: 'שבוע ואימונים', meals: 'ארוחות', start: 'תחילת יום', backup: 'גיבוי', updates: 'עדכונים', calendar: 'יומן וסנכרון',
};
const TARGETS: [TargetKey, string][] = [
  ['dorm-rest', 'מעונות · מנוחה'], ['dorm-train', 'מעונות · אימון'], ['home-rest', 'בית · מנוחה'], ['home-train', 'בית · אימון'],
];
const nv = (e: Event) => (e.target as HTMLInputElement).value;

function Row({ icon, title, value, onClick, badge, danger }: { icon: ComponentChildren; title: string; value?: string; onClick: () => void; badge?: boolean; danger?: boolean }) {
  return (
    <button class="lrow" onClick={onClick}>
      <span class={'li' + (danger ? ' dg' : '')}>{icon}</span>
      <span class="lt" style={danger ? { color: 'var(--danger)' } : undefined}>{title}{value && <small>{value}</small>}</span>
      {badge && <i class="bdg" />}
      <ChevronLeft class="lc" />
    </button>
  );
}

function Step({ label, value, step, unit, onChange }: { label: string; value: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div class="stp">
      <span>{label}{unit && <small class="mu"> {unit}</small>}</span>
      <div class="sc">
        <button aria-label="הפחת" onClick={() => onChange(Math.max(0, value - step))}><Minus size={18} /></button>
        <input class="num" inputMode="numeric" value={value} onChange={(e) => onChange(Number(nv(e)) || 0)} />
        <button aria-label="הוסף" onClick={() => onChange(value + step)}><Plus size={18} /></button>
      </div>
    </div>
  );
}

function diag() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const t = cs.paddingTop, b = cs.paddingBottom;
  probe.remove();
  const sa = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return `חלון ${innerWidth}×${innerHeight} · מסך ${screen.width}×${screen.height} · safe ${t}/${b} · ${sa ? 'מסך הבית' : 'דפדפן'}`;
}

function SettingsBody() {
  const [page, setPage] = useState<Page>(() => (ui.get().settingsPage as Page) || 'home');
  useEffect(() => { if (ui.get().settingsPage) setUi({ settingsPage: null }); }, []);
  const fs_ = feedState.use((x) => x);
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [tokErr, setTokErr] = useState('');
  const s = store.use((x) => x);
  const u = updater.use((x) => x);
  const set = s.settings;
  const p = set.profile;
  const [tsel, setTsel] = useState<TargetKey>('dorm-train');
  const [rt, setRt] = useState<{ id?: string; dow: number; title: string; time: string } | null>(null);
  const [ml, setMl] = useState<{ id: string; name: string; time: string; isNew?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setProfile = (patch: Partial<Profile>) => actions.saveSettings({ profile: { ...p, ...patch } });
  const setTarget = (key: TargetKey, m: keyof Macros, v: number) =>
    actions.saveSettings({ targets: { ...set.targets, [key]: { ...set.targets[key], [m]: v } } });
  const recalc = () => {
    const old = set.targets;
    actions.saveSettings({ targets: suggestTargets(p) });
    toast('היעדים חושבו מהפרופיל', () => actions.saveSettings({ targets: old }));
  };

  const last = s.meta.lastBackup;
  const lastTxt = last ? new Date(last).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }) : 'עוד לא גובה';
  const updAvail = u.status === 'available';
  const hdr = TITLES[page];

  const T = set.targets[tsel];
  const macroKcal = T.p * 4 + T.c * 4 + T.f * 9;

  const saveRt = () => {
    if (!rt) return;
    const title = rt.title.trim() || 'אימון';
    if (rt.id) actions.saveRoutine(set.routine.map((r) => (r.id === rt.id ? { ...r, title, time: rt.time, dow: rt.dow } : r)));
    else actions.saveRoutine([...set.routine, { id: uid(), dow: rt.dow, time: rt.time, title }]);
    setRt(null);
  };
  const saveMl = () => {
    if (!ml) return;
    const name = ml.name.trim() || 'ארוחה';
    if (ml.isNew) actions.saveSettings({ slots: [...set.slots, { id: ml.id, name, time: ml.time }] });
    else actions.saveSettings({ slots: set.slots.map((x) => (x.id === ml.id ? { ...x, name, time: ml.time } : x)) });
    setMl(null);
  };

  return (
    <>
      <div class="hd" style={{ marginBottom: 10 }}>
        <div>
          {page !== 'home' && <button class="back" onClick={() => setPage('home')}><ChevronRight />הגדרות</button>}
          <div class="t">{hdr}</div>
          {page === 'home' && <div class="s">הכל ניתן לשינוי</div>}
        </div>
        <button class="g ib" onClick={() => setUi({ settingsOpen: false })} aria-label="סגור"><X /></button>
      </div>

      <div class="fs-body" style={{ paddingBottom: 60 }}>
        {page === 'home' && (
          <>
            <div class="g rows">
              <Row icon={<User />} title="פרופיל" value={`גיל ${p.age} · ${p.heightCm} ס״מ · ${p.weightKg}→${p.goalKg} ק״ג`} onClick={() => setPage('profile')} />
              <Row icon={<Target />} title="יעדי תזונה" value={`${fmt(set.targets['dorm-train'].k)} קל׳ באימון · ${fmt(set.targets['dorm-rest'].k)} במנוחה`} onClick={() => setPage('targets')} />
              <Row icon={<CalendarDays />} title="שבוע ואימונים" value={`${set.routine.length} אימונים בשבוע · ${set.places.filter((x) => x === 'dorm').length} ימי מעונות`} onClick={() => setPage('week')} />
              <Row icon={<Utensils />} title="ארוחות" value={set.slots.map((x) => x.name).join(' · ')} onClick={() => setPage('meals')} />
              <Row icon={<Sunrise />} title="תחילת יום" value={set.resetHour === 0 ? 'חצות' : `0${set.resetHour}:00 לפנות בוקר`} onClick={() => setPage('start')} />
            </div>
            <div class="g rows" style={{ marginTop: 14 }}>
              <Row icon={<CalendarPlus />} title="יומן וסנכרון" value={set.cal.enabled ? `פיד פעיל · התראה ${set.cal.alertMin || 'ללא'}${set.cal.alertMin ? ' דק׳ לפני' : ''}` : 'לא מחובר'} onClick={() => setPage('calendar')} />
              <Row icon={<Download />} title="גיבוי" value={`גיבוי אחרון: ${lastTxt}`} onClick={() => setPage('backup')} />
              <Row icon={<RefreshCw />} title="עדכונים" value={updAvail ? 'יש גרסה חדשה' : `גרסה ${APP_VERSION}`} badge={updAvail} onClick={() => setPage('updates')} />
            </div>
            <div class="g rows" style={{ marginTop: 14 }}>
              <Row danger icon={<Trash />} title="מחק את כל הנתונים" onClick={() => {
                if (!confirm('למחוק את כל הנתונים? אי אפשר לשחזר בלי גיבוי.')) return;
                update(() => defaultState());
                setUi({ settingsOpen: false });
                toast('הכל נמחק');
              }} />
            </div>
          </>
        )}

        {page === 'profile' && (
          <>
            <div class="g card">
              <div class="field">
                <div><label class="lbl">גיל</label><input class="inp num" inputMode="numeric" value={p.age} onChange={(e) => setProfile({ age: Number(nv(e)) || p.age })} /></div>
                <div><label class="lbl">גובה (ס״מ)</label><input class="inp num" inputMode="numeric" value={p.heightCm} onChange={(e) => setProfile({ heightCm: Number(nv(e)) || p.heightCm })} /></div>
                <div><label class="lbl">משקל נוכחי (ק״ג)</label><input class="inp num" inputMode="decimal" value={p.weightKg} onChange={(e) => setProfile({ weightKg: Number(nv(e).replace(',', '.')) || p.weightKg })} /></div>
                <div><label class="lbl">יעד משקל (ק״ג)</label><input class="inp num" inputMode="decimal" value={p.goalKg} onChange={(e) => setProfile({ goalKg: Number(nv(e).replace(',', '.')) || p.goalKg })} /></div>
              </div>
            </div>
            <div class="sec"><span>קצב עלייה</span></div>
            <div class="g rows">
              {([['slow', 'איטי ונקי', 'כ-0.25 ק״ג בשבוע'], ['mid', 'בינוני', 'כ-0.5 ק״ג בשבוע'], ['fast', 'אגרסיבי', 'כ-0.75 ק״ג ומעלה, יותר שומן']] as const).map(([id, l, d]) => (
                <button class={'opt' + (p.pace === id ? ' on' : '')} onClick={() => setProfile({ pace: id })}>
                  <span>{l}<small class="mu" style={{ display: 'block', fontSize: 13 }}>{d}</small></span><span class="rd" />
                </button>
              ))}
            </div>
            <button class="btn block" style={{ marginTop: 14 }} onClick={recalc}><RefreshCw /> חשב יעדים מהפרופיל</button>
            <div class="note">הערכה בלבד. אחרי 2-3 שבועות כדאי לכייל לפי מגמת המשקל.</div>
          </>
        )}

        {page === 'targets' && (
          <>
            <div class="grid2">
              {TARGETS.map(([key, label]) => <button class={'chip' + (tsel === key ? ' on' : '')} onClick={() => setTsel(key)}>{label}</button>)}
            </div>
            <div class="g rows">
              <Step label="קלוריות" value={T.k} step={50} onChange={(v) => setTarget(tsel, 'k', v)} />
              <Step label="חלבון" unit="גרם" value={T.p} step={5} onChange={(v) => setTarget(tsel, 'p', v)} />
              <Step label="פחמימה" unit="גרם" value={T.c} step={10} onChange={(v) => setTarget(tsel, 'c', v)} />
              <Step label="שומן" unit="גרם" value={T.f} step={5} onChange={(v) => setTarget(tsel, 'f', v)} />
            </div>
            <div class="note num">המקרו מסתכמים ב-{fmt(macroKcal)} קל׳ {Math.abs(macroKcal - T.k) > 80 ? `(הפרש ${fmt(macroKcal - T.k)} מהיעד)` : '(תואם ליעד)'}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button class="btn" style={{ flex: 1 }} onClick={() => {
                const old = set.targets;
                actions.saveSettings({ targets: { 'dorm-rest': { ...T }, 'dorm-train': { ...T }, 'home-rest': { ...T }, 'home-train': { ...T } } });
                toast('היעד הועתק לכל הסוגים', () => actions.saveSettings({ targets: old }));
              }}>העתק לכולם</button>
              <button class="btn" style={{ flex: 1 }} onClick={recalc}><RefreshCw /> חשב מחדש</button>
            </div>
          </>
        )}

        {page === 'week' && (
          <>
            <div class="g rows">
              {DAY_NAMES.map((d, i) => {
                const list = set.routine.filter((r) => r.dow === i).sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div class="dayc" key={i}>
                    <div class="dh">
                      <span>{d}</span>
                      <span class="pl2">
                        {(['dorm', 'home'] as const).map((pl) => (
                          <button class={set.places[i] === pl ? 'on' : ''} onClick={() => actions.saveSettings({ places: set.places.map((x, j) => (j === i ? pl : x)) })}>{pl === 'dorm' ? 'מעונות' : 'בית'}</button>
                        ))}
                      </span>
                    </div>
                    {list.map((r) => (
                      <button class="wchip" key={r.id} onClick={() => setRt({ id: r.id, dow: r.dow, title: r.title, time: r.time })}>
                        <Dumbbell /><span style={{ flex: 1 }}>{r.title}</span><span class="tm num">{r.time}</span>
                      </button>
                    ))}
                    <button class="addw" onClick={() => setRt({ dow: i, title: '', time: '18:00' })}><Plus />הוסף אימון</button>
                  </div>
                );
              })}
            </div>
            <div class="note">אימונים קבועים נוצרים אוטומטית בלוח השנה. ביטול אימון בודד נעשה מהלוח או ממסך היום.</div>
          </>
        )}

        {page === 'meals' && (
          <>
            <div class="g rows">
              {set.slots.map((sl) => (
                <button class="lrow" key={sl.id} onClick={() => setMl({ id: sl.id, name: sl.name, time: sl.time })}>
                  <span class="lt">{sl.name}<small class="num">{sl.time}</small></span><ChevronLeft class="lc" />
                </button>
              ))}
            </div>
            <button class="btn block" style={{ marginTop: 14 }} onClick={() => setMl({ id: uid(), name: '', time: '12:00', isNew: true })}><Plus /> הוסף ארוחה</button>
          </>
        )}

        {page === 'start' && (
          <>
            <div class="g rows">
              {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                <button class={'opt' + (set.resetHour === h ? ' on' : '')} onClick={() => { actions.saveSettings({ resetHour: h }); toast('התחלת היום עודכנה'); }}>
                  <span>{h === 0 ? 'חצות (00:00)' : `0${h}:00 לפנות בוקר`}</span><span class="rd" />
                </button>
              ))}
            </div>
            <div class="note">ארוחות שנרשמו אחרי חצות ועד השעה הזו ייספרו ליום הקודם.</div>
          </>
        )}

        {page === 'backup' && (
          <>
            <div class="g card">
              <div style={{ marginBottom: 4 }}>גיבוי אחרון</div>
              <b style={{ fontSize: 22 }}>{lastTxt}</b>
              <div class="mu" style={{ marginTop: 8 }}>הנתונים נשמרים רק בטלפון. גיבוי לקובץ מגן עליך אם האפליקציה תימחק.</div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button class="btn primary" style={{ flex: 1 }} onClick={async () => { const r = await exportBackup(); if (r !== 'cancelled') toast('הגיבוי נוצר'); }}><Download /> ייצוא</button>
              <button class="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}><Upload /> ייבוא</button>
              <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (!f) return;
                if (!confirm('הייבוא יחליף את כל הנתונים הנוכחיים. להמשיך?')) return;
                toast((await importBackup(f)) ? 'הנתונים שוחזרו' : 'הקובץ לא תקין');
              }} />
            </div>
          </>
        )}

        {page === 'calendar' && (() => {
          const id = set.cal.feedId;
          const active = set.cal.enabled && hasToken();
          const ago = fs_.at ? Math.max(0, Math.round((Date.now() - fs_.at) / 60000)) : null;
          const statusTxt = fs_.status === 'syncing' ? 'מעדכן…' : fs_.status === 'error' ? `שגיאה: ${fs_.msg}` : ago === null ? 'עוד לא עודכן' : ago === 0 ? 'עודכן הרגע' : `עודכן לפני ${ago} דק׳`;
          if (!active) {
            return (
              <>
                <div class="g card">
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>חיבור פעם אחת</div>
                  <ol class="mu" style={{ margin: 0, paddingRight: 20, lineHeight: 1.8 }}>
                    <li>נכנסים ל-GitHub ויוצרים טוקן (Fine-grained token).</li>
                    <li>Repository access: Only select repositories ← workout-calendar.</li>
                    <li>Permissions ← Repository permissions ← Contents ← Read and write.</li>
                    <li>מעתיקים את הטוקן ומדביקים כאן.</li>
                  </ol>
                  <a class="btn block" style={{ marginTop: 12, textDecoration: 'none', color: 'inherit' }} href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">פתח את GitHub</a>
                </div>
                <div class="g card">
                  <label class="lbl">הטוקן (נשמר רק בטלפון הזה, לא נכנס לגיבוי)</label>
                  <input class="inp" style={{ direction: 'ltr', textAlign: 'left' }} value={tok} placeholder="github_pat_…" autocomplete="off" autocapitalize="none" spellcheck={false} onInput={(e) => { setTok(nv(e)); setTokErr(''); }} />
                  <div class="err" style={{ gridColumn: 'auto', marginTop: 6 }}>{tokErr}</div>
                  <button class="btn primary block" disabled={busy} onClick={async () => {
                    const v = tok.trim();
                    if (!v) { setTokErr('הדבק את הטוקן'); return; }
                    setBusy(true);
                    const r = await verifyToken(v);
                    if (!r.ok) { setTokErr(r.msg ?? 'שגיאה'); setBusy(false); return; }
                    saveToken(v);
                    await enableFeed();
                    setTok('');
                    setBusy(false);
                    toast('הפיד פעיל');
                  }}>{busy ? 'מחבר…' : 'חבר והפעל'}</button>
                </div>
                <div class="note">הקובץ נשמר בריפו ציבורי בכתובת ארוכה ואקראית ויש בו רק שמות ושעות של אימונים.</div>
              </>
            );
          }
          return (
            <>
              <div class="g card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>הפיד פעיל</b>
                  <span class="mu" style={{ color: fs_.status === 'error' ? 'var(--warn)' : undefined }}>{statusTxt}</span>
                </div>
                <div class="mu" style={{ marginTop: 6 }}>כל שינוי באימונים נשלח ליומן אוטומטית.</div>
              </div>

              <div class="sec"><span>יומן אפל</span></div>
              <div class="g card">
                <button class="btn primary block" onClick={() => { location.href = webcalUrl(id); }}><CalendarPlus /> הוסף ליומן של אפל</button>
                <div class="mu" style={{ marginTop: 10, lineHeight: 1.6 }}>אחרי אישור "הרשמה", היומן מתעדכן לבד (אפל בודק כל כרבע שעה עד שעה). אם הכפתור לא פותח כלום: הגדרות האייפון ← יומן ← חשבונות ← הוספת חשבון ← אחר ← הוספת יומן מנוי, והדבק את הקישור מהכפתור למטה.</div>
                <button class="btn block" style={{ marginTop: 10 }} onClick={async () => { try { await navigator.clipboard.writeText(feedUrl(id)); toast('הקישור הועתק'); } catch { toast('לא הצלחתי להעתיק'); } }}><Copy /> העתק קישור</button>
              </div>

              <div class="sec"><span>Google Calendar</span></div>
              <div class="g card"><div class="mu" style={{ lineHeight: 1.6 }}>במחשב: Google Calendar ← Other calendars ← From URL, והדבק את אותו קישור. העדכון אצל Google איטי (עד יום).</div></div>

              <div class="sec"><span>התראה לפני אימון</span></div>
              <div class="chips">
                {([[0, 'ללא'], [15, '15 דק׳'], [30, '30 דק׳'], [60, 'שעה']] as const).map(([m, l]) => (
                  <button class={'chip' + (set.cal.alertMin === m ? ' on' : '')} onClick={() => actions.saveSettings({ cal: { ...set.cal, alertMin: m } })}>{l}</button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button class="btn" style={{ flex: 1 }} onClick={() => void syncFeed(true)}><RefreshCw class={fs_.status === 'syncing' ? 'spin' : ''} /> סנכרן עכשיו</button>
                <button class="btn danger" onClick={() => { if (confirm('לנתק את היומן? הפיד יפסיק להתעדכן והטוקן יימחק מהטלפון.')) { disconnectFeed(); toast('היומן נותק'); } }}>נתק</button>
              </div>
            </>
          );
        })()}

        {page === 'updates' && (
          <>
            <div class="g card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>הגרסה שלך</span><b class="num">{APP_VERSION}</b></div>
              <div class="mu num" style={{ direction: 'ltr', textAlign: 'right', marginTop: 4 }}>{BUILD_ID}</div>
              <div style={{ margin: '14px 0 4px', color: updAvail ? 'var(--accent)' : 'var(--mu)' }}>
                {{ idle: 'עוד לא נבדק', checking: 'בודק מול השרת…', latest: 'אתה על הגרסה העדכנית ביותר', available: `יש גרסה חדשה${u.remote ? ` (${u.remote.version})` : ''}`, applying: 'מעדכן…', error: 'לא הצלחתי לבדוק. בדוק חיבור לאינטרנט.' }[u.status]}
              </div>
              {updAvail && u.remote?.notes?.length ? <ul class="mu" style={{ margin: '8px 0 0', paddingRight: 18 }}>{u.remote.notes.map((n) => <li>{n}</li>)}</ul> : null}
            </div>
            <div style={{ marginTop: 12 }}>
              {updAvail
                ? <button class="btn primary block" onClick={() => void applyUpdate()}><RefreshCw /> עדכן עכשיו</button>
                : <button class="btn block" onClick={() => void checkForUpdate()}><RefreshCw class={u.status === 'checking' ? 'spin' : ''} /> בדוק עדכונים</button>}
            </div>
            <div class="sec"><span><Info size={14} style={{ verticalAlign: -2 }} /> אבחון מסך</span></div>
            <div class="g card mu num" style={{ fontSize: 12, lineHeight: 1.6 }}>{diag()}</div>
          </>
        )}
      </div>

      <Sheet open={!!rt} onClose={() => setRt(null)}>
        {rt && (
          <div>
            <h3>{rt.id ? 'עריכת אימון קבוע' : 'אימון קבוע חדש'} · {DAY_NAMES[rt.dow]}</h3>
            <div class="field" style={{ marginTop: 12 }}>
              <div class="full"><label class="lbl">שם האימון</label><input class="inp" value={rt.title} placeholder="למשל חזה וכתפיים" onInput={(e) => setRt({ ...rt, title: nv(e) })} /></div>
              <div class="full"><label class="lbl">שעה</label><input class="inp" type="time" value={rt.time} onInput={(e) => setRt({ ...rt, time: nv(e) || rt.time })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button class="btn primary" style={{ flex: 1 }} onClick={saveRt}>שמור</button>
              {rt.id && <button class="btn danger" onClick={() => { actions.saveRoutine(set.routine.filter((r) => r.id !== rt.id)); setRt(null); }}><Trash /> הסר</button>}
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!ml} onClose={() => setMl(null)}>
        {ml && (
          <div>
            <h3>{ml.isNew ? 'ארוחה חדשה' : 'עריכת ארוחה'}</h3>
            <div class="field" style={{ marginTop: 12 }}>
              <div class="full"><label class="lbl">שם</label><input class="inp" value={ml.name} placeholder="למשל ארוחת ביניים" onInput={(e) => setMl({ ...ml, name: nv(e) })} /></div>
              <div class="full"><label class="lbl">שעה רגילה</label><input class="inp" type="time" value={ml.time} onInput={(e) => setMl({ ...ml, time: nv(e) || ml.time })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button class="btn primary" style={{ flex: 1 }} onClick={saveMl}>שמור</button>
              {!ml.isNew && set.slots.length > 1 && <button class="btn danger" onClick={() => { actions.saveSettings({ slots: set.slots.filter((x) => x.id !== ml.id) }); setMl(null); }}><Trash /> מחק</button>}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

export function SettingsScreen() {
  const open = ui.use((u) => u.settingsOpen);
  return <FullScreen open={open}><SettingsBody /></FullScreen>;
}
