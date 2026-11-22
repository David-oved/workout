import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { X, ChevronLeft, ChevronRight, User, Target, CalendarDays, CalendarPlus, Copy, Sparkles, Utensils, Sunrise, Download, Upload, RefreshCw, Plus, Minus, Trash, Info, Dumbbell } from 'lucide-preact';
import { store, update, defaultState } from '../core/state';
import { actions } from '../core/actions';
import { fmt, suggestTargets } from '../core/calc';
import { DAY_NAMES, todayKey, uid } from '../core/dates';
import { setUi, ui, toast } from '../ui/ui';
import { aiState, getAiKey, maskKey, clearAiKey, testModel, refreshModels } from '../ai/gemini';
import { allowedLevels, modelHint, resolveThinking, THINK_LABELS, type Think } from '../ai/pure';
import { addDoc, docsState, loadDocs, removeDoc, toggleDoc } from '../ai/docs';
import { AiSetup } from './AiChat';
import { bridge, scriptSource, pingBridge, connectBridge, disconnectBridge, refreshEvents, syncWorkouts } from '../core/bridge';
import { feedState, feedUrl, webcalUrl, hasToken, verifyToken, saveToken, enableFeed, disconnectFeed, syncFeed } from '../core/calfeed';
import { FullScreen, Sheet } from '../ui/components';
import { exportBackup, importBackup } from '../core/backup';
import { APP_VERSION, BUILD_ID, updater, checkForUpdate, applyUpdate } from '../update/updater';
import type { Macros, Profile, TargetKey } from '../core/types';

type Page = 'home' | 'profile' | 'targets' | 'week' | 'meals' | 'start' | 'backup' | 'updates' | 'calendar' | 'gcal' | 'ai' | 'aimodels' | 'aiknow';
const TITLES: Record<Page, string> = {
  home: 'הגדרות', profile: 'פרופיל', targets: 'יעדי תזונה', week: 'שבוע ואימונים', meals: 'ארוחות', start: 'תחילת יום', backup: 'גיבוי', updates: 'עדכונים', calendar: 'פיד לקריאה בלבד', gcal: 'Google Calendar', ai: 'AI תזונה', aimodels: 'מודלים וחשיבה', aiknow: 'ידע וזיכרון',
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
  const br = bridge.use((x) => x);
  const aiS = aiState.use((x) => x);
  const docsS = docsState.use((x) => x);
  useEffect(() => { void loadDocs(); }, []);
  const docRef = useRef<HTMLInputElement>(null);
  const [memTxt, setMemTxt] = useState('');
  const setAi = (patch: Partial<typeof set.ai>) => actions.saveSettings({ ai: { ...set.ai, ...patch } });
  const [gurl, setGurl] = useState('');
  const [gerr, setGerr] = useState('');
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
          {page !== 'home' && <button class="back" onClick={() => setPage(page === 'aimodels' || page === 'aiknow' ? 'ai' : 'home')}><ChevronRight />{page === 'aimodels' || page === 'aiknow' ? 'AI תזונה' : 'הגדרות'}</button>}
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
              <Row icon={<Sparkles />} title="AI תזונה (Gemini)" value={aiS.configured ? 'מחובר' : 'הערכת קלוריות מטקסט ותמונה'} badge={!aiS.configured} onClick={() => setPage('ai')} />
              <Row icon={<CalendarDays />} title="Google Calendar" value={br.connected ? `מחובר · ${br.events.length} אירועים` : 'קריאת אירועים וכתיבת אימונים'} badge={!br.connected} onClick={() => setPage('gcal')} />
              <Row icon={<CalendarPlus />} title="פיד לקריאה בלבד" value={set.cal.enabled ? `פיד פעיל · התראה ${set.cal.alertMin || 'ללא'}${set.cal.alertMin ? ' דק׳ לפני' : ''}` : 'לא מחובר'} onClick={() => setPage('calendar')} />
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

        {page === 'ai' && (aiS.configured ? (
          <>
            <div class="g card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>Gemini מחובר</b><span class="mu num">{maskKey(getAiKey())}</span></div>
              <div class="mu" style={{ marginTop: 8 }}>מודל ברירת מחדל: <b class="num" style={{ color: '#fff', direction: 'ltr', display: 'inline-block' }}>{aiS.model || '—'}</b></div>
              {aiS.test && (
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: aiS.test.ok ? 'var(--accent)' : 'var(--warn)' }}>
                  {aiS.test.ok ? `נבדק ועובד: ${aiS.test.model} (${aiS.test.ms} מ״ש)` : `הבדיקה נכשלה (${aiS.test.model}): ${aiS.test.msg}`}
                  {aiS.test.ok && aiS.test.msg ? ` · ${aiS.test.msg}` : ''}
                </div>
              )}
            </div>
            <div class="g rows">
              <Row icon={<Sparkles />} title="מודלים וחשיבה" value={`חשיבה: ${THINK_LABELS[set.ai.think as Think]} · טקסט: ${set.ai.textModel || 'אוטומטי'} · תמונות/חיפוש: ${set.ai.visionModel || 'אוטומטי'}`} onClick={() => setPage('aimodels')} />
              <Row icon={<User />} title="ידע וזיכרון" value={`${set.ai.memory.length} דברים בזיכרון · ${docsS.docs.filter((d) => d.enabled).length} מסמכים כלולים · אינטרנט: ${set.ai.web ? 'פעיל כברירת מחדל' : 'לפי בקשה'}`} onClick={() => setPage('aiknow')} />
            </div>
            <button class="btn primary block" style={{ marginTop: 14 }} disabled={aiS.testing} onClick={() => void testModel()}><RefreshCw class={aiS.testing ? 'spin' : ''} /> {aiS.testing ? 'בודק…' : 'בדוק חיבור למודל'}</button>
            <button class="btn block" style={{ marginTop: 10 }} onClick={() => { setUi({ settingsOpen: false, aiOpen: true }); }}><Sparkles /> פתח שיחה עם ה-AI</button>
            <button class="btn danger block" style={{ marginTop: 10 }} onClick={() => { if (confirm('לנתק את Gemini? המפתח יימחק מהטלפון.')) { clearAiKey(); toast('נותק'); } }}>נתק</button>
          </>
        ) : <AiSetup onDone={() => toast('Gemini מחובר')} />)}

        {page === 'aimodels' && (() => {
          const pick = (role: 'textModel' | 'visionModel', v: string) => setAi({ [role]: v } as Partial<typeof set.ai>);
          const cur = (role: 'textModel' | 'visionModel') => set.ai[role];
          const eff = (role: 'textModel' | 'visionModel') => cur(role) || (role === 'textModel' ? 'gemini-3.5-flash-lite' : 'gemini-3.6-flash');
          const levels: Think[] = ['auto', 'minimal', 'low', 'medium', 'high', 'xhigh'];
          const ModelList = ({ role }: { role: 'textModel' | 'visionModel' }) => (
            <div class="g rows">
              <button class={'opt' + (!cur(role) ? ' on' : '')} onClick={() => pick(role, '')}>
                <span>אוטומטי<small class="mu" style={{ display: 'block', fontSize: 13 }}>{role === 'textModel' ? 'המהיר ביותר שזמין (מומלץ)' : 'מודל חזק יותר שזמין (מומלץ)'}</small></span><span class="rd" />
              </button>
              {aiS.models.map((id) => (
                <button class={'opt' + (cur(role) === id ? ' on' : '')} key={id} onClick={() => pick(role, id)}>
                  <span><span class="num" style={{ direction: 'ltr', display: 'inline-block' }}>{id}</span>{modelHint(id) && <small class="mu" style={{ display: 'block', fontSize: 13 }}>{modelHint(id)}</small>}</span><span class="rd" />
                </button>
              ))}
              {aiS.models.length === 0 && <div class="emp">אין רשימת מודלים. לחץ "רענן רשימה" למטה.</div>}
            </div>
          );
          return (
            <>
              <div class="sec"><span>רמת חשיבה</span></div>
              <div class="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                {levels.map((l) => <button class={'chip' + (set.ai.think === l ? ' on' : '')} onClick={() => setAi({ think: l })}>{THINK_LABELS[l]}</button>)}
              </div>
              <div class="g card" style={{ fontSize: 13 }}>
                <div class="mu" style={{ lineHeight: 1.7 }}>
                  חשיבה גבוהה נותנת תשובות עמוקות יותר אבל איטיות בהרבה. "אוטומטי" הוא הכי מהיר שהמודל מאפשר. בצ'אט יש גם כפתור "חשיבה עמוקה" שמפעיל רמה גבוהה להודעה אחת.
                </div>
                <div class="mu num" style={{ marginTop: 8, direction: 'ltr', textAlign: 'right' }}>
                  {[eff('textModel'), eff('visionModel')].map((m) => `${m}: ${resolveThinking(m, set.ai.think as Think) ?? 'ללא הגדרה'} (${allowedLevels(m).join('/') || 'לא ידוע'})`).join('  |  ')}
                </div>
              </div>

              <div class="sec"><span>מודל לטקסט (מהיר)</span></div>
              <ModelList role="textModel" />
              <div class="sec"><span>מודל לתמונות, מסמכים, חיפוש וחשיבה עמוקה</span></div>
              <ModelList role="visionModel" />

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button class="btn" style={{ flex: 1 }} onClick={() => void refreshModels()}><RefreshCw /> רענן רשימה</button>
                <button class="btn" style={{ flex: 1 }} disabled={aiS.testing} onClick={() => void testModel(eff('textModel'))}><RefreshCw class={aiS.testing ? 'spin' : ''} /> בדוק את מודל הטקסט</button>
              </div>
              {aiS.test && <div class="note" style={{ color: aiS.test.ok ? 'var(--accent)' : 'var(--warn)' }}>{aiS.test.ok ? `${aiS.test.model} עובד (${aiS.test.ms} מ״ש)` : `${aiS.test.model}: ${aiS.test.msg}`}</div>}
              <div class="note">אם מודל שבחרת לא עונה, האפליקציה עוברת לבד לחלופה ומציגה בכל תשובה איזה מודל ענה.</div>
            </>
          );
        })()}

        {page === 'aiknow' && (
          <>
            <div class="g rows">
              <button class="row2" onClick={() => setAi({ web: !set.ai.web })}>
                <span>חיפוש באינטרנט כברירת מחדל<small>מחקרים, מקורות רפואיים ומידע עדכני. איטי יותר ובלי פלט מובנה. אפשר גם להפעיל בצ'אט להודעה אחת.</small></span>
                <span class={'tgl' + (set.ai.web ? ' on' : '')} />
              </button>
              <button class="row2" onClick={() => setAi({ shareData: !set.ai.shareData })}>
                <span>שיתוף נתוני האפליקציה עם ה-AI<small>פרופיל, יעדים, 14 ימים אחרונים, משקל ואימונים. כך הוא יכול לנתח התקדמות.</small></span>
                <span class={'tgl' + (set.ai.shareData ? ' on' : '')} />
              </button>
            </div>

            <div class="sec"><span>מה ה-AI זכר עליי ({set.ai.memory.length})</span></div>
            <div class="g card" style={{ padding: 0 }}>
              {set.ai.memory.length === 0 && <div class="emp">עוד לא נשמר כלום. ה-AI שומר רק דברים קבועים שסיפרת לו, ואפשר גם להוסיף ידנית.</div>}
              {set.ai.memory.map((m, i) => (
                <div class="stp" key={i} style={{ minHeight: 52, alignItems: 'center' }}>
                  <span style={{ flex: 1, fontSize: 15, lineHeight: 1.4 }}>{m}</span>
                  <button class="aix" aria-label="מחק" onClick={() => setAi({ memory: set.ai.memory.filter((_, j) => j !== i) })}><X /></button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, padding: 12 }}>
                <input class="inp" style={{ flex: 1 }} value={memTxt} placeholder="הוסף דבר לזיכרון…" onInput={(e) => setMemTxt(nv(e))} />
                <button class="btn primary" style={{ padding: '0 18px' }} onClick={() => { const t = memTxt.trim(); if (!t) return; setAi({ memory: [...set.ai.memory, t.slice(0, 140)].slice(-60) }); setMemTxt(''); }}>הוסף</button>
              </div>
            </div>

            <div class="sec"><span>ספריית מסמכים ({docsS.docs.length})</span></div>
            <div class="g card" style={{ padding: 0 }}>
              {docsS.docs.length === 0 && <div class="emp">אפשר להוסיף כאן בדיקות דם, סיכומים רפואיים, תוכנית אימון או מאמרים (PDF, תמונה או טקסט). מסמך שסימנת כ"כלול" נשלח ל-AI בכל שיחה.</div>}
              {docsS.docs.map((d) => (
                <div class="stp" key={d.id} style={{ minHeight: 60 }}>
                  <button style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, textAlign: 'right' }} onClick={() => void toggleDoc(d.id, !d.enabled)}>
                    <span class={'tgl' + (d.enabled ? ' on' : '')} style={{ flex: 'none' }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                      <small class="mu num">{(d.size / 1024 / 1024).toFixed(1)} MB · {d.enabled ? 'כלול' : 'לא כלול'}</small>
                    </span>
                  </button>
                  <button class="aix" aria-label="מחק מסמך" onClick={() => { if (confirm('למחוק את המסמך מהספרייה?')) void removeDoc(d.id); }}><X /></button>
                </div>
              ))}
              <div style={{ padding: 12 }}>
                <button class="btn block" onClick={() => docRef.current?.click()}><Upload /> הוסף מסמך</button>
                <input ref={docRef} type="file" accept="application/pdf,image/*,text/plain,text/markdown,.md,.txt" style={{ display: 'none' }} onChange={async (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  (e.target as HTMLInputElement).value = '';
                  if (!f) return;
                  if (!confirm('שים לב: מסמך שכלול נשלח ל-Google בכל שיחה עם ה-AI. לפי התיעוד של Google, במסלול החינמי ייתכן שתוכן שנשלח משמש לשיפור המוצרים שלהם. מסמכים רפואיים הם מידע רגיש. להוסיף?')) return;
                  const r = await addDoc(f);
                  toast(r.ok ? 'המסמך נוסף' : (r.msg ?? 'ההוספה נכשלה'));
                }} />
              </div>
            </div>
            <div class="note">המסמכים נשמרים רק בטלפון הזה ולא נכנסים לגיבוי. ה-AI אינו רופא: הוא יכול להסביר ממצאים כלליים, אבל כל ערך חריג צריך לעבור לרופא.</div>
          </>
        )}

        {page === 'gcal' && (() => {
          const ago = (t?: number) => { if (!t) return 'עוד לא'; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m === 0 ? 'הרגע' : `לפני ${m} דק׳`; };
          if (!br.connected) {
            return (
              <>
                <div class="g card">
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>חיבור פעם אחת (כ-5 דקות)</div>
                  <ol class="mu" style={{ margin: 0, paddingRight: 20, lineHeight: 1.8 }}>
                    <li>לוחצים "העתק קוד" כאן למטה.</li>
                    <li>פותחים script.google.com ← New project, מוחקים את הקוד שיש ומדביקים.</li>
                    <li>Deploy ← New deployment ← סוג Web app ← Execute as: Me ← Who has access: Anyone ← Deploy.</li>
                    <li>מאשרים הרשאות (אם מופיעה אזהרה: Advanced ← Go to project).</li>
                    <li>מעתיקים את ה-Web app URL (נגמר ב-/exec) ומדביקים בשדה.</li>
                  </ol>
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button class="btn primary" style={{ flex: 1 }} onClick={async () => { try { await navigator.clipboard.writeText(scriptSource()); toast('הקוד הועתק'); } catch { toast('לא הצלחתי להעתיק'); } }}><Copy /> העתק קוד</button>
                    <a class="btn" style={{ flex: 1, textDecoration: 'none', color: 'inherit' }} href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">פתח את Script</a>
                  </div>
                </div>
                <div class="g card">
                  <label class="lbl">כתובת ה-Web app</label>
                  <input class="inp" style={{ direction: 'ltr', textAlign: 'left' }} value={gurl} placeholder="https://script.google.com/macros/s/…/exec (אפשר גם עם #מפתח)" autocomplete="off" autocapitalize="none" spellcheck={false} onInput={(e) => { setGurl(nv(e)); setGerr(''); }} />
                  <div class="err" style={{ gridColumn: 'auto', marginTop: 6 }}>{gerr}</div>
                  <button class="btn primary block" disabled={busy} onClick={async () => {
                    const [v, k] = gurl.trim().split('#');
                    if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(v)) { setGerr('הדבק את הכתובת המלאה שנגמרת ב-/exec'); return; }
                    setBusy(true);
                    const r = await pingBridge(v, k || undefined);
                    setBusy(false);
                    if (!r.ok) { setGerr(r.msg ?? 'שגיאה'); return; }
                    connectBridge(v, r.calendars ?? [], k || undefined);
                    setGurl('');
                    toast(`מחובר. נמצאו ${r.calendars?.length ?? 0} יומנים`);
                  }}>{busy ? 'מתחבר…' : 'חבר'}</button>
                </div>
                <div class="note">הקוד רץ בחשבון Google שלך בלבד. הכתובת והמפתח נשמרים רק בטלפון הזה, ומי שמחזיק בהם יכול לקרוא את היומן, אז אל תשתף אותם.</div>
              </>
            );
          }
          const cur = br.syncStatus === 'error' ? br.syncMsg : br.evStatus === 'error' ? br.evMsg : '';
          return (
            <>
              <div class="g card">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>מחובר ליומן Google</b><span class="mu num">{br.events.length} אירועים בטווח</span></div>
                <div class="mu" style={{ marginTop: 8, lineHeight: 1.7 }}>
                  קריאת אירועים: {br.evStatus === 'loading' ? 'מרענן…' : ago(br.evAt)}<br />
                  כתיבת אימונים: {br.syncStatus === 'syncing' ? 'מעדכן…' : ago(br.syncAt)}
                </div>
                {cur && <div style={{ color: 'var(--warn)', marginTop: 8, fontSize: 14 }}>שגיאה: {cur}</div>}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button class="btn" style={{ flex: 1 }} onClick={() => void refreshEvents(true)}><RefreshCw class={br.evStatus === 'loading' ? 'spin' : ''} /> רענן אירועים</button>
                <button class="btn" style={{ flex: 1 }} onClick={() => void syncWorkouts(true)}><RefreshCw class={br.syncStatus === 'syncing' ? 'spin' : ''} /> סנכרן אימונים</button>
              </div>
              <div class="sec"><span>מה נמצא ביומן שלך</span></div>
              <div class="g card">
                {br.calendars.length === 0 && <div class="mu">עוד לא נטענו יומנים. לחץ "רענן אירועים".</div>}
                {br.calendars.map((name) => {
                  const n = br.events.filter((e) => e.cal === name).length;
                  return <div class="stp" key={name} style={{ padding: 0, minHeight: 40 }}><span>{name}</span><span class="mu num">{name === 'workOut' ? 'יומן האימונים שלי' : `${n} אירועים`}</span></div>;
                })}
                {br.range && <div class="mu num" style={{ marginTop: 8, fontSize: 12 }}>טווח: {br.range.from} עד {br.range.to}</div>}
                {br.evStatus === 'ok' && br.events.length === 0 && (
                  <div style={{ color: 'var(--warn)', marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>לא נמצאו אירועים ביומני Google האלה. אם האירועים שלך נמצאים ביומן של אפל (iCloud) או בחשבון Google אחר, הם לא יופיעו כאן. אפשר להחליף ל-Google את "יומן ברירת מחדל" באייפון, או לחבר את החשבון הנכון.</div>
                )}
              </div>
              {br.events.length > 0 && (
                <>
                  <div class="sec"><span>האירועים הקרובים</span></div>
                  <div class="g rows">
                    {br.events.filter((e) => e.start.slice(0, 10) >= todayKey(set.resetHour)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6).map((e) => (
                      <div class="row2" key={e.id}><span>{e.title}<small>{e.cal}</small></span><span class="mu num" style={{ direction: 'ltr' }}>{e.allDay ? e.start.slice(5, 10) : e.start.slice(5, 10) + ' ' + e.start.slice(11, 16)}</span></div>
                    ))}
                  </div>
                </>
              )}
              <div class="sec"><span>התראה לפני אימון</span></div>
              <div class="chips">
                {([[0, 'ללא'], [15, '15 דק׳'], [30, '30 דק׳'], [60, 'שעה']] as const).map(([m, l]) => (
                  <button class={'chip' + (set.cal.alertMin === m ? ' on' : '')} onClick={() => actions.saveSettings({ cal: { ...set.cal, alertMin: m } })}>{l}</button>
                ))}
              </div>
              <div class="sec"><span>יומן אפל</span></div>
              <div class="g card"><div class="mu" style={{ lineHeight: 1.7 }}>האימונים נכתבים ליומן בשם workOut בחשבון Google. כדי לראות אותם (ולקבל התראות) ביומן של אפל: הגדרות האייפון ← יומן ← חשבונות ← הוספת חשבון Google. אם היומן workOut לא מופיע, ודא שהוא מסומן ב-google.com/calendar/syncselect.</div></div>
              <div class="sec"><span>אירועים מ-iCloud</span></div>
              <div class="g card"><div class="mu" style={{ lineHeight: 1.7 }}>האפליקציה קוראת רק אירועים שנמצאים ב-Google. לאירועים חדשים: באייפון ← הגדרות ← יומן ← יומן ברירת מחדל ← יומן של Google. לאירועים קיימים של iCloud: שתף את היומן כ-Public Calendar והוסף את הקישור ב-Google Calendar ← Other calendars ← From URL (מתעדכן לאט, עד יום).</div></div>
              <button class="btn danger block" style={{ marginTop: 14 }} onClick={() => { if (confirm('לנתק את החיבור ליומן? הכתובת והמפתח יימחקו מהטלפון. אירועי workOut שכבר נכתבו יישארו ביומן.')) { disconnectBridge(); toast('נותק'); } }}>נתק</button>
            </>
          );
        })()}

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
                    if (feedState.get().status === 'error') {
                      const msg = feedState.get().msg ?? 'הפרסום נכשל';
                      disconnectFeed();
                      setTokErr(msg);
                      setBusy(false);
                      return;
                    }
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
