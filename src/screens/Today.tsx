import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sparkles, Bell, Mic, X, Droplets, ListChecks, Minus, Settings as Cog, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ChevronsUpDown, Maximize2, Plus, Dumbbell, Check, Copy, Download, Siren, RefreshCw, Pencil } from 'lucide-preact';
import { CountNum } from '../ui/anim';
import { burst, rain, confetti, floatText } from '../ui/fx';
import { streakOf } from '../core/streak';
import { logInbox, editInbox } from '../siri/prepare';
import { buildCandidates, candMacros, gapSuggestions, makeEntries, tray, trayAdd, trayClear, type Cand } from '../ui/tray';
import { EventList } from '../ui/EventList';
import { bridge, refreshEvents, syncWorkouts } from '../core/bridge';
import { conflictsFor, eventsOn, hhmm, suggestSlot } from '../core/conflicts';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { DAY_NAMES, addDays, dayLabel, dayMonth, dow, todayKey } from '../core/dates';
import { ui, setUi, openAdd, toast, guessSlot } from '../ui/ui';
import { Ring } from '../ui/components';
import { hold, openMenu, type MenuItem } from '../ui/actmenu';
import { aiReady, askAi } from '../ai/ask';
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
    else if (c.kind === 'summary') setUi({ summary: today });
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

/** ארוחה שנאמרה ל-Siri: כרטיס מוכן שהוכן ברקע. לחיצה אחת מוסיפה ליום, או "ערוך" לתיקון כמויות */
function SiriCard({ date }: { date: string }) {
  const items = store.use((x) => x.inbox);
  if (!items.length) return null;
  const it = items[0];
  const card = it.card;
  const slotName = store.get().settings.slots.find((x) => x.id === guessSlot())?.name ?? 'ארוחה';
  return (
    <div class="g siric col">
      <div class="sr-h">
        <Mic />
        <b>מ-Siri{items.length > 1 ? ` · עוד ${items.length - 1}` : ''}</b>
        <span class="sr-q">״{it.text}״</span>
        <button class="x" aria-label="הסר" onClick={() => actions.dismissInbox(it.id)}><X /></button>
      </div>
      {(!it.status || it.status === 'busy') && <div class="sr-busy"><RefreshCw class="spin" />מכין את הכרטיס…</div>}
      {it.status === 'ready' && card && (
        <>
          <div class="sr-l">
            {card.lines.slice(0, 5).map((l, i) => <div key={i}><span>{l.name}<small>{l.label}</small></span><b class="num">{l.k}</b></div>)}
            {card.lines.length > 5 && <div class="mu"><span>ועוד {card.lines.length - 5}</span></div>}
          </div>
          <div class="sr-t num"><b>{card.k}</b> קל׳ · <b>{card.p}</b> ג׳ חלבון<i>{card.src === 'ai' ? 'AI' : 'מהמאגר'}</i></div>
          <div class="sr-a">
            <button class="btn primary sm" onClick={() => logInbox(it, date)}><Check />הוסף ל{slotName}</button>
            <button class="btn sm" onClick={() => editInbox(it, date)}>ערוך</button>
          </div>
        </>
      )}
      {it.status === 'fail' && (
        <>
          <div class="mu" style={{ fontSize: 13 }}>לא הצלחתי להבין לבד, אפשר לפתוח בהוספה.</div>
          <div class="sr-a"><button class="btn primary sm" onClick={() => editInbox(it, date)}>פתח בהוספה</button></div>
        </>
      )}
    </div>
  );
}

/** הצעה בלחיצה אחת לסגירת הפער בחלבון: מהדברים שאתה כבר אוכל */
function Ideas({ date, today }: { date: string; today: string }) {
  const s = store.use((x) => x);
  const hour = new Date().getHours();
  const slot = useMemo(() => {
    const nowMin = hour * 60 + new Date().getMinutes();
    const hm = (t: string) => { const [a, b] = t.split(':').map(Number); return a * 60 + (b || 0); };
    return [...s.settings.slots].sort((a, b) => Math.abs(hm(a.time) - nowMin) - Math.abs(hm(b.time) - nowMin))[0];
  }, [s.settings.slots, hour]);
  const sig = s.entries.length + ':' + s.dishes.length + ':' + date;
  const gap = useMemo(() => {
    if (!slot) return null;
    const g = gapSuggestions(buildCandidates(slot.id), date, { k: 0, p: 0, c: 0, f: 0 }, 3, true);
    return g.list.length ? g : null;
  }, [sig, slot?.id]);
  if (!gap || !slot || hour < 11 || !s.settings.remind.nudges) return null;
  const add = (c: Cand) => {
    const keep = tray.get();
    trayClear(); trayAdd(c);
    const drafts = makeEntries(tray.get().items, store.get(), true, c.name);
    tray.set(keep);
    const ids = drafts.map((d) => actions.addEntry({ date, slot: slot.id, name: d.name, k: d.k, p: d.p, c: d.c, f: d.f, est: d.est, parts: d.parts, dishId: d.dishId }).id);
    toast(`נוסף ל${slot.name}`, () => actions.removeEntries(ids));
  };
  return (
    <div class="g gapc">
      <div class="gh"><Sparkles /><span>חסרים עוד <b class="num">{Math.round(gap.remP)}</b> ג׳ חלבון. הצעה בלחיצה:</span></div>
      <div class="gl">
        {gap.list.map((c) => {
          const m = candMacros(c);
          return <button key={c.key} onClick={() => add(c)}><b>{c.name}</b><small class="num">{m.p} ח׳ · {m.k} קל׳</small></button>;
        })}
      </div>
    </div>
  );
}

export function TodayScreen() {
  const s = store.use((x) => x);
  const taps = useRef({ t: 0, n: 0, r: 0 });
  const ringRef = useRef<HTMLDivElement>(null);
  const scr = useRef<HTMLElement>(null);
  const glance = ui.use((u) => u.glance);
  const gl = useRef<HTMLDivElement>(null);
  const gd = useRef({ on: false, y0: 0, t0: 0, dy: 0 });
  const pd = useRef({ on: false, y0: 0, dy: 0 });
  const [rvk, setRvk] = useState(0);
  // מצב רגיל: מציירים מחדש את כניסת הכרטיסים כשהוילון עולה
  useEffect(() => { if (!glance) setRvk((k) => k + 1); }, [glance]);
  const gIn = useRef<HTMLDivElement>(null);
  const paint = (p: number, dy: number) => {
    const g = gl.current, i = gIn.current, s2 = scr.current;
    if (g) g.style.transform = `translateY(${-dy}px)`;
    if (i) { i.style.transform = `translateY(${-p * 36}px) scale(${1 - p * 0.05})`; i.style.opacity = String(Math.max(0, 1 - p * 1.3)); }
    if (s2) { s2.style.transform = `scale(${0.95 + 0.05 * p})`; s2.style.opacity = String(0.35 + 0.65 * p); }
  };
  const clearPaint = () => { for (const el of [gl.current, gIn.current, scr.current]) if (el) { el.style.removeProperty('transform'); el.style.removeProperty('opacity'); } };
  const dragging = (on: boolean) => { for (const el of [gl.current, scr.current]) el?.classList.toggle('drag', on); };
  // אחרי שה-class התחלף, מנקים את הציור הידני: המעבר ממשיך בצורה חלקה מהמקום שבו האצבע עזבה
  useLayoutEffect(() => { clearPaint(); }, [glance]);
  const openNormal = () => setUi({ glance: false });
  const gStart = (e: TouchEvent) => { gd.current = { on: true, y0: e.touches[0].clientY, t0: Date.now(), dy: 0 }; dragging(true); };
  const gMove = (e: TouchEvent) => {
    const d = gd.current;
    if (!d.on) return;
    d.dy = Math.max(0, d.y0 - e.touches[0].clientY);
    paint(Math.min(1, d.dy / (innerHeight * 0.6)), d.dy);
  };
  const gEnd = () => {
    const d = gd.current;
    if (!d.on) return;
    d.on = false;
    dragging(false);
    const v = d.dy / Math.max(1, Date.now() - d.t0);
    if (d.dy > 110 || (d.dy > 40 && v > 0.5)) openNormal(); else clearPaint();
  };
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
  const streak = streakOf(s, today);

  const go = (n: number) => setUi({ date: addDays(date, n) });
  // הפתעות: 7 לחיצות על הכותרת = גשם אימוג'ים, 5 לחיצות על הטבעת = קונפטי
  const tapTitle = () => {
    setUi({ date: today });
    const t = taps.current, now = Date.now();
    t.n = now - t.t < 900 ? t.n + 1 : 1; t.t = now;
    if (t.n >= 7) { t.n = 0; rain(['🏋️', '💪', '🍗', '🥚', '🔥', '🦍', '🥩']); }
  };
  const tapRing = () => {
    const el = ringRef.current;
    if (el) { el.classList.remove('boing'); void el.offsetWidth; el.classList.add('boing'); }
    setUi({ stat: 'k' });
  };
  const sub = `${DAY_NAMES[dow(date)]} ${dayMonth(date)} · ${info.place === 'dorm' ? 'מעונות' : 'בית'}`;

  /** לחיצה ארוכה על מדד: פירוט, ואם ה-AI מחובר גם שאלות מוכנות עליו (רק להיום) */
  const metricMenu = (k: 'k' | 'p' | 'c' | 'f') => {
    const names = { k: 'קלוריות', p: 'חלבון', c: 'פחמימה', f: 'שומן' } as const;
    const en = { k: 'calories', p: 'protein', c: 'carbs', f: 'fat' } as const;
    const name = names[k];
    const rem = Math.round(target[k] - eaten[k]);
    const unit = k === 'k' ? 'קלוריות' : `גרם ${name}`;
    const items: MenuItem[] = [{ label: 'פירוט', icon: <ListChecks />, run: () => setUi({ stat: k }) }];
    if (aiReady() && date === today) {
      const hint = `[CONTEXT] He long-pressed the ${en[k]} metric on the home screen. Eaten so far today: ${Math.round(eaten[k])}, daily target: ${Math.round(target[k])}, remaining: ${rem}. Be brief and practical, suggest concrete foods he can find in Israel.`;
      items.push({
        ai: true, icon: <Sparkles />,
        label: rem > 0 ? 'מה כדאי לאכול עכשיו?' : 'עברתי את היעד, מה לעשות?',
        run: () => askAi(rem > 0 ? `נשארו לי ${rem} ${unit} להיום. מה כדאי לאכול עכשיו כדי להשלים?` : `עברתי את יעד ה${name} ב-${-rem}. מה כדאי לעשות לשאר היום?`, { hint, date }),
      });
      items.push({ ai: true, icon: <Sparkles />, label: 'איך השבוע שלי?', run: () => askAi(`איך הייתה הצריכה שלי של ${name} בשבוע האחרון לעומת היעד, ומה כדאי לשפר?`, { hint, date }) });
    }
    openMenu(name, items, `אכלת ${fmt(Math.round(eaten[k]))} מתוך ${fmt(Math.round(target[k]))}`);
  };

  /** לחיצה ארוכה על מנה ביומן: עריכה, הוספה שוב, ושאלה על המנה */
  const entryMenu = (e: (typeof info.entries)[number]) => {
    const items: MenuItem[] = [
      { label: 'ערוך', icon: <Pencil />, run: () => setUi({ editEntry: e.id }) },
      {
        label: 'הוסף שוב', icon: <Plus />,
        run: () => {
          const n = actions.addEntry({ date: e.date, slot: e.slot, name: e.name, k: e.k, p: e.p, c: e.c, f: e.f, est: e.est, parts: e.parts });
          toast(`${e.name} נוסף שוב`, () => actions.removeEntries([n.id]));
        },
      },
    ];
    if (aiReady()) {
      items.push({
        ai: true, icon: <Sparkles />, label: 'מה דעתך על המנה?',
        run: () => askAi(`מה דעתך על "${e.name}"? איך אפשר לשפר אותה בשביל מאסה?`, { date: e.date, hint: `[CONTEXT] He long-pressed this logged entry: "${e.name}", ${e.k} kcal, ${e.p} g protein, ${e.c} g carbs, ${e.f} g fat${e.est ? ' (estimated values)' : ''}. Do not change or add anything to his day; just answer.` }),
      });
    }
    openMenu(e.name, items, `${e.k} קל׳ · ${e.p} ח׳`);
  };

  // צמצום ארוחות: נשמר במכשיר. חץ ליד כל ארוחה, וכפתור "צמצם הכל" בכותרת
  const [col, setColS] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('wo:col') ?? '[]'); } catch { return []; } });
  const saveCol = (n: string[]) => { setColS(n); try { localStorage.setItem('wo:col', JSON.stringify(n)); } catch { /* ignore */ } };
  const allIds = [...slots.map((x) => x.id), ...(orphan.length ? ['__other'] : [])];
  const allCol = allIds.length > 0 && allIds.every((id) => col.includes(id));
  const setAllCol = (c: boolean) => saveCol(c ? allIds : []);
  const toggleCol = (id: string) => saveCol(col.includes(id) ? col.filter((x) => x !== id) : [...col, id]);

  const group = (id: string, name: string, time?: string) => {
    const list = id === '__other' ? orphan : info.entries.filter((e) => e.slot === id);
    const kc = list.reduce((a, e) => a + e.k, 0);
    const isCol = col.includes(id);
    return (
      <div class={'slot' + (isCol ? ' col' : '')} key={id}>
        <div class="slot-h">
          <button class="sl-t" onClick={() => toggleCol(id)} aria-expanded={!isCol} aria-label={`${isCol ? 'הרחב' : 'צמצם'} ${name}`}>
            <ChevronDown class="sl-ch" />
            <span class="sl-n">{name}</span>
            {time && <small class="mu num">{time}</small>}
          </button>
          <span class="k">
            {kc > 0 ? <span class="kpill num">{fmt(kc)} קל׳{isCol && list.length > 1 ? ` · ${list.length}` : ''}</span> : <span class="sl-no">עדיין לא</span>}
            {id !== '__other' && <button class="addmini" aria-label={`הוסף ל${name}`} onClick={() => openAdd(id, date)}><Plus /></button>}
          </span>
        </div>
        {list.length > 0 && (
          <div class="slot-w">
            <div class="slot-b">
              <div class="slot-bi">
                {list.map((e) => (
                  <button class="ent2" key={e.id} onClick={() => setUi({ editEntry: e.id })} {...hold(() => entryMenu(e))}>
                    <span class="etx">
                      <b>{e.name}{e.est && <i class="etag">הערכה</i>}</b>
                      {e.parts && e.parts.length > 1 && <span class="esub">{e.parts.map((p) => label(p.name)).join(' · ')}</span>}
                      <span class="emac num"><i class="mp">{e.p} ח׳</i><i class="mc2">{e.c} פ׳</i><i class="mf">{e.f} ש׳</i></span>
                    </span>
                    <span class="ekc num"><b>{fmt(e.k)}</b></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };


  const hdEl = (g: boolean) => (
    <div class="hd">
      <div>
        <button class="t" style={{ display: 'block', textAlign: 'right' }} onClick={tapTitle}>{dayLabel(date, today)}</button>
        <div class="s">{sub}</div>
        {streak >= 2 && <button class="streak" onClick={() => toast(`${streak} ימים ברצף שאתה מתעד. אל תשבור!`)}><span class="fl">🔥</span><b class="num">{streak}</b> ימים ברצף</button>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button class="g ib" aria-label="היום הקודם" onClick={() => go(-1)}><ChevronRight /></button>
        <button class="g ib" aria-label="היום הבא" onClick={() => go(1)}><ChevronLeft /></button>
        {!g && <button class="g ib" aria-label="מבט מהיר" onClick={() => setUi({ glance: true })}><Maximize2 /></button>}
        <button class="g ib" aria-label="הגדרות" onClick={() => setUi({ settingsOpen: true })}><Cog /></button>
      </div>
    </div>
  );
  // כשיש כרטיס Siri במבט המהיר, המדדים מצטמצמים כדי שהכל ייכנס במסך
  const roomy = !s.inbox.length;
  const heroEl = (big: boolean) => (
    <div class={'g hero' + (big && roomy ? ' v' : '') + (left < 0 ? ' over' : '')}>
      <div class="hrw" ref={big ? undefined : ringRef} onClick={tapRing} {...hold(() => metricMenu('k'))}>
        <Ring size={big && roomy ? 200 : 150} stroke={big && roomy ? 15 : 12} pct={eaten.k / target.k} color={left < 0 ? 'var(--warn)' : 'var(--accent)'}>
          <div class="rc">
            <div class="big num"><CountNum v={Math.abs(left)} /></div>
            <div class="mu">{left < 0 ? 'קלוריות מעל היעד' : 'קלוריות נשארו'}</div>
          </div>
        </Ring>
      </div>
      <div class="st">
        <div><span class="mu">אכלתי</span><b class="num"><CountNum v={eaten.k} /></b></div>
        <div><span class="mu">יעד {info.training ? '· יום אימון' : '· יום מנוחה'}</span><b class="num">{fmt(target.k)}</b></div>
      </div>
    </div>
  );
  const macrosEl = (big: boolean) => (
    <div class="mini">
      {MACROS.map((m) => {
        const rem = target[m.k] - eaten[m.k];
        return (
          <button class="g mc" key={m.k} onClick={() => setUi({ stat: m.k })} aria-label={`פירוט ${m.name}`} {...hold(() => metricMenu(m.k))}>
            <Ring size={big ? 78 : 70} stroke={big ? 7 : 6.5} pct={eaten[m.k] / target[m.k]} color={m.color} cls="mr">
              <span class="num"><CountNum v={Math.abs(rem)} raw /></span>
            </Ring>
            <div style={{ fontSize: 14 }}>{m.name}</div>
            <div class="ate num"><b style={{ color: m.color }}><CountNum v={eaten[m.k]} raw /></b> ג׳ אכלתי</div>
            <div class="mu">{rem < 0 ? `מעל היעד (${target[m.k]})` : `מתוך ${target[m.k]} ג׳`}</div>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
    <section class={'screen rv' + (rvk % 2) + (glance ? ' gon' : '') + (tab === 'today' ? ' on' : '')} aria-label="היום" ref={scr}
      onTouchStart={(e: TouchEvent) => { const el = scr.current; pd.current = { on: !!el && el.scrollTop <= 0, y0: e.touches[0].clientY, dy: 0 }; }}
      onTouchMove={(e: TouchEvent) => { if (pd.current.on) pd.current.dy = e.touches[0].clientY - pd.current.y0; }}
      onTouchEnd={() => { if (pd.current.on && pd.current.dy > 120) setUi({ glance: true }); pd.current.on = false; }}>
      {hdEl(false)}
      {heroEl(false)}
      {macrosEl(false)}

      <SiriCard date={date} />
      {date === today && <Nudges today={today} />}
      {date === today && <Ideas date={date} today={today} />}

      {s.settings.show.water && (
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
      )}

      <div class="sec">
        <span>ארוחות</span>
        <button class="syncb" onClick={() => setAllCol(!allCol)}><ChevronsUpDown />{allCol ? 'הרחב הכל' : 'צמצם הכל'}</button>
      </div>
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

      {info.workouts.length > 0 && <div class="sec"><span>אימון</span></div>}
      {info.workouts.map((w) => <WorkoutCard w={w} key={w.id} />)}

      <button class="g sumrow" onClick={() => setUi({ summary: date })}>
        <Sparkles />
        <span class="tx"><b>סיכום {date === today ? 'היום' : 'היום הזה'}</b><small>{s.summaries[date] ? s.summaries[date].text.replace(/[*#]/g, '').replace(/[\r\n\t ]+/g, ' ').trim().slice(0, 60) + '…' : 'אכילה, אימון, מה לשפר ומה לעשות מחר'}</small></span>
        <ChevronLeft />
      </button>
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

      {needBackup && (
        <button class="g card" style={{ width: '100%', marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'right' }} onClick={() => setUi({ settingsOpen: true })}>
          <Download size={20} color="var(--accent)" />
          <span style={{ flex: 1 }}>עבר יותר משבוע מהגיבוי האחרון<span class="mu" style={{ display: 'block' }}>הנתונים נשמרים רק בטלפון. כדאי לגבות.</span></span>
        </button>
      )}
    </section>
    <div class={'glance' + (glance ? '' : ' off') + (tab === 'today' ? '' : ' hid') + (s.inbox.length ? ' hc' : '')} ref={gl} onTouchStart={gStart as never} onTouchMove={gMove as never} onTouchEnd={gEnd} onTouchCancel={gEnd} aria-label="מבט מהיר">
      <div class="gl-in" ref={gIn}>
        {hdEl(true)}
        <div class="gl-mid">
          {heroEl(true)}
          {macrosEl(true)}
          <SiriCard date={date} />
          <button class="btn primary block gl-add" onClick={() => openAdd(undefined, date)}><Plus />הוסף ארוחה</button>
        </div>
        <button class="gl-pull" onClick={openNormal} aria-label="הצג את כל היום"><i class="mb-h" /><ChevronUp /><small>החלק למעלה לכל היום</small></button>
      </div>
    </div>
    </>
  );
}
