import { useState } from 'preact/hooks';
import { Settings as Cog, Scale, Check, Dumbbell, Sparkles, Trophy, TrendingUp } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { DAY_NAMES, DAY_SHORT, addDays, dow, todayKey, weekStart } from '../core/dates';
import { ui, setUi, toast, openAdd } from '../ui/ui';
import { aiState } from '../ai/gemini';
import { sendMessage } from '../ai/chat';
import { shiftTargets, weeklyReview } from '../core/review';
import { e1rm } from '../data/exercises';
import { hold, openMenu } from '../ui/actmenu';
import { askAi as askAiHold } from '../ai/ask';

export function ProgressScreen() {
  const tab = ui.use((u) => u.tab);
  const s = store.useWhen((x) => x, tab === 'progress');
  const today = todayKey(s.settings.resetHour);
  const ws = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const infos = days.map((d) => ({ d, ...dayInfo(s, d) }));
  const MAXK = 3800;
  const done = infos.filter((i) => i.d < today && i.entries.length > 0);
  const base = done.length ? done : infos.filter((i) => i.d === today && i.entries.length > 0);
  const avgK = base.length ? base.reduce((a, i) => a + i.eaten.k, 0) / base.length : 0;
  const avgP = base.length ? base.reduce((a, i) => a + i.eaten.p, 0) / base.length : 0;

  const weights = s.weights;
  const last = weights[weights.length - 1];
  const first = weights[0];
  const recent = weights.filter((w) => w.date >= addDays(today, -28));
  const perWeek = (() => {
    if (recent.length < 2) return null;
    const a = recent[0], b = recent[recent.length - 1];
    const weeks = Math.max(1, (new Date(b.date).getTime() - new Date(a.date).getTime()) / (7 * 86400_000));
    return (b.kg - a.kg) / weeks;
  })();
  const goal = s.settings.profile.goalKg;
  const startKg = first?.kg ?? last.kg;
  const prog = goal === startKg ? 1 : Math.max(0, Math.min(1, (last.kg - startKg) / (goal - startKg)));
  const daysSinceWeigh = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400_000);

  const pts = weights.slice(-8);
  const spark = (() => {
    if (pts.length < 2) return '';
    const min = Math.min(...pts.map((p) => p.kg)), max = Math.max(...pts.map((p) => p.kg));
    const rng = Math.max(0.5, max - min);
    return pts.map((p, i) => `${150 - (i / (pts.length - 1)) * 140},${38 - ((p.kg - min) / rng) * 30}`).join(' ');
  })();
  const sparkEnd = spark ? spark.split(' ').pop()!.split(',') : null;

  const [wv, setWv] = useState('');
  const [adding, setAdding] = useState(false);
  const saveW = () => {
    const v = Number(wv.replace(',', '.'));
    if (!v || v < 30 || v > 200) return;
    actions.logWeight(today, v);
    setWv(''); setAdding(false);
    toast(`נשמר: ${v} ק״ג`);
  };

  const review = weeklyReview(s, today);
  const aiOn = aiState.use((x) => x.configured);
  const applyShift = (d: number) => {
    const before = s.settings.targets;
    actions.saveSettings({ targets: shiftTargets(before, d) });
    toast(`יעד הקלוריות ${d > 0 ? "עלה" : "ירד"} ב-${Math.abs(d)}`, () => actions.saveSettings({ targets: before }));
  };
  const askAi = () => {
    openAdd(undefined, undefined, 'chat');
    if (aiOn) void sendMessage('תן לי סקירה שבועית: האם אני בקצב הנכון לעלייה במשקל, מה לשפר באכילה ובאימונים, ומה הצעד הכי חשוב לשבוע הקרוב?', []);
  };
  const records = (() => {
    const best = new Map<string, { kg: number; reps: number; date: string; e: number }>();
    for (const se of s.sessions) for (const ex of se.exercises) for (const st of ex.sets) {
      if (st.kg <= 0) continue;
      const e = e1rm(st.kg, st.reps);
      const cur = best.get(ex.name);
      if (!cur || e > cur.e) best.set(ex.name, { kg: st.kg, reps: st.reps, date: se.date, e });
    }
    return [...best.entries()].sort((a, b) => b[1].date.localeCompare(a[1].date)).slice(0, 6);
  })();

  const weekWorkouts = s.workouts.filter((w) => w.date >= ws && w.date <= addDays(ws, 6)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  return (
    <section class={'screen' + (tab === 'progress' ? ' on' : '')} aria-label="התקדמות">
      <div class="hd">
        <div><div class="t">התקדמות</div><div class="s">היעד: {goal} ק״ג · עכשיו {last.kg}</div></div>
        <button class="g ib" aria-label="הגדרות" onClick={() => setUi({ settingsOpen: true })}><Cog /></button>
      </div>

      <div class="g card rv">
        <div class="ch"><b><TrendingUp />סקירה שבועית</b><span class="mu">14 ימים אחרונים</span></div>
        {review.lines.map((l, i) => <div class={'rv-l ' + l.tone} key={i}><i />{l.text}</div>)}
        {review.action && (
          <button class="btn primary block" style={{ marginTop: 12 }} onClick={() => applyShift(review.action!.deltaK)}>{review.action.label}</button>
        )}
        <button class="btn block" style={{ marginTop: 8 }} onClick={askAi}><Sparkles />סכם לי עם ה-AI</button>
      </div>

      <div class="g card">
        <div class="ch"><b>קלוריות השבוע</b><span class="mu num">{base.length ? `ממוצע ${fmt(avgK)} · חלבון ${fmt(avgP)} ג׳` : 'עוד אין נתונים'}</span></div>
        <div class="wk">
          {infos.map((i, idx) => {
            const h = (Math.min(i.eaten.k, MAXK) / MAXK) * 100;
            const t = (i.target.k / MAXK) * 100;
            return (
              <div class="bc" key={i.d}>
                <div class="bt">
                  <div class="bf" style={{ height: h, opacity: i.d === today ? 0.55 : 1, display: i.eaten.k ? 'block' : 'none', background: i.eaten.k > i.target.k * 1.08 ? 'var(--warn)' : 'var(--accent)' }} />
                  <div class="tk" style={{ bottom: t }} />
                </div>
                <span class="mu" style={{ color: i.d === today ? 'var(--accent)' : undefined }}>{DAY_SHORT[idx]}</span>
              </div>
            );
          })}
        </div>
        <div class="mu" style={{ marginTop: 8 }}>הקו המקווקו הוא היעד של אותו יום</div>
      </div>

      <div class="g card">
        <div class="ch"><b>משקל</b><span class="mu num">{perWeek === null ? 'עוד אין מגמה' : `${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(1)} ק״ג בשבוע`}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div><div class="big num" style={{ fontSize: 30 }}>{last.kg}</div><div class="mu">ק״ג · {last.date === today ? 'היום' : `לפני ${daysSinceWeigh} ימים`}</div></div>
          {spark && (
            <svg width="100%" height="46" viewBox="0 0 160 46" style={{ flex: 1 }}>
              <polyline points={spark} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              {sparkEnd && <circle cx={sparkEnd[0]} cy={sparkEnd[1]} r="4.5" fill="var(--accent)" />}
            </svg>
          )}
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.08)', margin: '14px 0 6px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${prog * 100}%`, background: 'var(--accent)', borderRadius: 4, marginLeft: 'auto', transition: 'width .6s' }} />
        </div>
        <div class="mu num">נשארו {Math.max(0, goal - last.kg).toFixed(1)} ק״ג ליעד</div>
        {adding ? (
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <input class="inp num" style={{ flex: 1 }} inputMode="decimal" placeholder="משקל בק״ג" value={wv} onInput={(e) => setWv((e.target as HTMLInputElement).value)} autoFocus />
            <button class="btn primary" onClick={saveW}><Check /> שמור</button>
          </div>
        ) : (
          <button class={'btn block' + (daysSinceWeigh >= 7 ? ' primary' : '')} style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
            <Scale /> {daysSinceWeigh >= 7 ? 'הגיע הזמן להישקל' : 'הוסף שקילה'}
          </button>
        )}
      </div>

      {records.length > 0 && (
        <div class="g card">
          <div class="ch"><b><Trophy />שיאים בתרגילים</b><span class="mu">הסט הטוב ביותר</span></div>
          {records.map(([name, r]) => (
            <div class="rec-r" key={name} {...(aiOn ? hold(() => openMenu(name, [
              { ai: true, icon: <Sparkles />, label: 'איך אשפר את השיא?', run: () => askAiHold(`השיא שלי ב${name} הוא ${r.kg} ק״ג × ${r.reps}. איך כדאי להתקדם משם?`, { hint: `[CONTEXT] He long-pressed his personal record for "${name}": ${r.kg} kg x ${r.reps} reps (${r.date}). Use his training history in the data. Be brief.` }) },
              { ai: true, icon: <Sparkles />, label: 'איך מבצעים נכון?', run: () => askAiHold(`הסבר לי בקצרה איך מבצעים ${name} נכון, טעויות נפוצות, ואיך לא להיפצע.`) },
            ], `${r.kg} ק״ג × ${r.reps}`)) : {})}><span>{name}</span><span class="num">{r.kg} ק״ג × {r.reps}</span></div>
          ))}
        </div>
      )}

      <button class="g card pl-card" onClick={() => setUi({ plan: { dayId: null } })}>
        <Dumbbell />
        <span class="tx"><b>תוכנית האימונים</b><small>{s.plans.length ? (s.plans.find((x) => x.id === s.activePlan) ?? s.plans[0]).days.map((d) => d.name).join(' · ') : 'בנה או ייבא את התוכנית שלך'}</small></span>
      </button>

      <div class="g card" style={{ padding: '16px 0 4px' }}>
        <div class="ch" style={{ padding: '0 16px' }}><b>אימונים השבוע</b><span class="mu">{weekWorkouts.filter((w) => w.status === 'done').length} מתוך {weekWorkouts.filter((w) => w.status !== 'skipped').length}</span></div>
        {weekWorkouts.length === 0 && <div class="emp">אין אימונים השבוע. אפשר להוסיף מלוח השנה.</div>}
        {weekWorkouts.map((w) => (
          <button class="ev" key={w.id} onClick={() => setUi({ workoutSheet: { id: w.id, date: w.date } })}>
            {w.status === 'done' ? <Check class="ok" /> : <Dumbbell />}
            <div style={{ textDecoration: w.status === 'skipped' ? 'line-through' : undefined, opacity: w.status === 'skipped' ? 0.5 : 1 }}>
              {w.title}<small>{DAY_NAMES[dow(w.date)]} · {w.time}{w.status === 'done' ? ' · בוצע' : w.status === 'skipped' ? ' · בוטל' : ''}</small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
