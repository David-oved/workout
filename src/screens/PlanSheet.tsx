import { useRef, useState } from 'preact/hooks';
import { X, Plus, ChevronRight, ChevronUp, ChevronDown, Trash, Sparkles, Copy, Download, Dumbbell, Check } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { DAY_NAMES, uid } from '../core/dates';
import { ui, setUi, toast } from '../ui/ui';
import { BigSheet, Sheet } from '../ui/components';
import { aiState, chatTurn } from '../ai/gemini';
import { exLabel, parsePlanText, planToText } from '../core/plan';
import { AmtInput } from './FoodPicker';
import type { Plan, PlanBlock, PlanDay, PlanEx } from '../core/types';

const nv = (e: Event) => (e.target as HTMLInputElement).value;
const newEx = (): PlanEx => ({ id: uid(), name: 'תרגיל חדש', sets: 3, reps: 10, unit: 'reps' });

const PLAN_SYS = `You edit a personal workout plan. You get the CURRENT PLAN as JSON and an instruction in Hebrew. Apply ONLY what was asked and keep everything else identical (names, order, sets, reps). Exercise and day names stay in Hebrew.
Return ONE JSON object only: {"summary":"one short Hebrew sentence saying what you changed","plan":{"name":string,"days":[{"name":string,"blocks":[{"title":string,"exercises":[{"name":string,"sets":number,"reps":number,"unit":"reps"|"sec","kg":number optional,"note":string optional}]}]}]}}
unit "sec" means reps is seconds (for example a plank of one minute is reps 60). If the instruction is unclear, change nothing and explain in summary.`;

const IMPORT_SYS = `You convert a workout plan written in free Hebrew text into JSON. Keep the days, groups and exercises exactly as written, in Hebrew. Return ONE JSON object only: {"summary":"one short Hebrew sentence","plan":{"name":string,"days":[{"name":string,"blocks":[{"title":string,"exercises":[{"name":string,"sets":number,"reps":number,"unit":"reps"|"sec","kg":number optional,"note":string optional}]}]}]}}
Words like "שלושה" are numbers (3). "של דקה" is unit sec with reps 60. "לכל יד" goes to note.`;

function toPlan(j: any, keepName: string): Plan | null {
  const days: PlanDay[] = [];
  for (const d of Array.isArray(j?.plan?.days) ? j.plan.days : []) {
    const blocks: PlanBlock[] = [];
    for (const b of Array.isArray(d?.blocks) ? d.blocks : []) {
      const exercises: PlanEx[] = [];
      for (const e of Array.isArray(b?.exercises) ? b.exercises : []) {
        const name = String(e?.name ?? '').trim();
        if (!name) continue;
        exercises.push({ id: uid(), name, sets: Math.min(20, Math.max(1, Math.round(Number(e.sets) || 3))), reps: Math.min(600, Math.max(1, Math.round(Number(e.reps) || 10))), unit: e.unit === 'sec' ? 'sec' : 'reps', kg: Number(e.kg) > 0 ? Number(e.kg) : undefined, note: e.note ? String(e.note).slice(0, 40) : undefined });
      }
      if (exercises.length) blocks.push({ id: uid(), title: String(b?.title ?? 'תרגילים').slice(0, 60), exercises });
    }
    if (blocks.length) days.push({ id: uid(), name: String(d?.name ?? 'יום אימון').slice(0, 40), blocks });
  }
  return days.length ? { id: uid(), name: String(j?.plan?.name ?? keepName).slice(0, 40), days, ts: Date.now() } : null;
}
function parseJson(raw: string): any {
  const t = raw.replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('התשובה לא הייתה JSON');
  return JSON.parse(t.slice(a, b + 1));
}

/** תוכנית האימונים: ימים, בלוקים ותרגילים עם עריכה חכמה (ידנית, מטקסט, או בעזרת AI) */
export function PlanSheet() {
  const st = ui.use((u) => u.plan);
  const s = store.use((x) => x);
  const aiOn = aiState.use((x) => x.configured);
  const last = useRef(st);
  if (st) last.current = st;
  const [dayId, setDayId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'import' | 'ai' | 'week'>(null);
  const [txt, setTxt] = useState('');
  const [prev, setPrev] = useState<Plan | null>(null);
  const [instr, setInstr] = useState('');
  const [aiSum, setAiSum] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wd, setWd] = useState({ dow: 0, time: '18:00' });
  const [openedFor, setOpenedFor] = useState<unknown>(null);
  if (st && openedFor !== st) { setOpenedFor(st); setDayId(st.dayId); }

  const plan = s.plans.find((p) => p.id === s.activePlan) ?? s.plans[0];
  const day = plan?.days.find((d) => d.id === dayId);
  const close = () => { setUi({ plan: null }); setSheet(null); setOpenedFor(null); };

  const upd = (fn: (p: Plan) => Plan) => { if (plan) actions.savePlan(fn(plan)); };
  const updDay = (fn: (d: PlanDay) => PlanDay) => upd((p) => ({ ...p, days: p.days.map((d) => (d.id === dayId ? fn(d) : d)) }));
  const updBlock = (bid: string, fn: (b: PlanBlock) => PlanBlock) => updDay((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === bid ? fn(b) : b)) }));
  const updEx = (bid: string, eid: string, patch: Partial<PlanEx>) => updBlock(bid, (b) => ({ ...b, exercises: b.exercises.map((e) => (e.id === eid ? { ...e, ...patch } : e)) }));
  const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; };

  const analyze = () => {
    const p = parsePlanText(txt, uid);
    setErr('');
    if (!p.days.length) { setPrev(null); setErr('לא זיהיתי תרגילים. כתוב שורה לכל תרגיל, למשל "מתח: שלושה סטים 10 חזרות"'); return; }
    setPrev(p);
  };
  const analyzeAi = async () => {
    if (!txt.trim()) return;
    setBusy(true); setErr('');
    try {
      const r = await chatTurn([{ role: 'user', text: txt }], { system: IMPORT_SYS, raw: true, web: false, deep: false, onStage: () => undefined });
      const p = toPlan(parseJson(r.reply), 'התוכנית שלי');
      if (!p) throw new Error('ה-AI לא החזיר תוכנית שימושית');
      setPrev(p);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const saveImport = () => {
    if (!prev) return;
    actions.savePlan({ ...prev, name: prev.name || 'התוכנית שלי' });
    actions.setActivePlan(prev.id);
    setSheet(null); setTxt(''); setPrev(null); setDayId(null);
    toast('התוכנית נשמרה');
  };
  const runAi = async () => {
    if (!plan || !instr.trim()) return;
    setBusy(true); setErr(''); setPrev(null); setAiSum('');
    try {
      const cur = JSON.stringify({ name: plan.name, days: plan.days.map((d) => ({ name: d.name, blocks: d.blocks.map((b) => ({ title: b.title, exercises: b.exercises.map(({ id: _i, ...e }) => e) })) })) });
      const r = await chatTurn([{ role: 'user', text: `CURRENT PLAN:\n${cur}\n\nINSTRUCTION:\n${instr}` }], { system: PLAN_SYS, raw: true, web: false, deep: false, onStage: () => undefined });
      const j = parseJson(r.reply);
      const p = toPlan(j, plan.name);
      if (!p) throw new Error('ה-AI לא החזיר תוכנית שימושית');
      setPrev(p); setAiSum(String(j.summary ?? ''));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const applyAi = () => {
    if (!prev || !plan) return;
    const old = plan;
    actions.savePlan({ ...prev, id: plan.id });
    setSheet(null); setPrev(null); setInstr(''); setAiSum(''); setDayId(null);
    toast('התוכנית עודכנה', () => actions.savePlan(old));
  };
  const copyText = async () => {
    if (!plan) return;
    try { await navigator.clipboard.writeText(planToText(plan)); toast('התוכנית הועתקה כטקסט'); } catch { toast('לא הצלחתי להעתיק'); }
  };
  const addDay = () => {
    const d: PlanDay = { id: uid(), name: `יום ${plan ? plan.days.length + 1 : 1}`, blocks: [{ id: uid(), title: 'תרגילים', exercises: [newEx()] }] };
    if (plan) { upd((p) => ({ ...p, days: [...p.days, d] })); setDayId(d.id); }
    else { const p: Plan = { id: uid(), name: 'התוכנית שלי', days: [d], ts: Date.now() }; actions.savePlan(p); actions.setActivePlan(p.id); setDayId(d.id); }
  };
  const addToWeek = () => {
    if (!day) return;
    actions.saveRoutine([...s.settings.routine, { id: uid(), dow: wd.dow, time: wd.time, title: day.name }]);
    setSheet(null);
    toast(`${day.name} נוסף ל${DAY_NAMES[wd.dow]}`);
  };
  const weekRoutines = day ? s.settings.routine.filter((r) => r.title === day.name) : [];

  return (
    <BigSheet open={!!st} onClose={close}>
      <div class="as-top">
        <div>
          {day && <button class="as-back" style={{ margin: '0 0 6px' }} onClick={() => setDayId(null)}><ChevronRight size={16} />כל הימים</button>}
          <div class="as-ti" style={{ fontSize: 26 }}>{day ? day.name : 'תוכנית אימונים'}</div>
          <div class="as-su">{day ? `${day.blocks.reduce((a, b) => a + b.exercises.length, 0)} תרגילים` : plan ? `${plan.name} · ${plan.days.length} ימים` : 'עוד אין תוכנית'}</div>
        </div>
        <button class="as-x" aria-label="סגור" onClick={close}><X /></button>
      </div>

      <div class="as-body" style={{ paddingBottom: 40 }}>
        {!day && (
          <>
            {!plan && (
              <div class="g pl-empty">
                <Dumbbell />
                <b>בנה את התוכנית שלך</b>
                <span>אפשר להדביק תוכנית שכתבת בטקסט חופשי, לבנות ידנית, או לבקש מה-AI לערוך. הכל נשמר רק במכשיר שלך.</span>
              </div>
            )}
            {plan?.days.map((d) => (
              <button class="g pl-day" key={d.id} onClick={() => setDayId(d.id)}>
                <b>{d.name}</b>
                <small>{d.blocks.map((b) => b.title.split(' · ').pop()).join(' · ')}</small>
                <span class="mu num">{d.blocks.reduce((a, b) => a + b.exercises.length, 0)} תרגילים</span>
              </button>
            ))}
            <button class="btn block" style={{ marginTop: 10 }} onClick={addDay}><Plus />הוסף יום</button>
            <div class="pl-acts">
              <button onClick={() => { setSheet('import'); setPrev(null); setErr(''); }}><Download />ייבוא מטקסט</button>
              {plan && aiOn && <button onClick={() => { setSheet('ai'); setPrev(null); setErr(''); setAiSum(''); }}><Sparkles />ערוך עם AI</button>}
              {plan && <button onClick={copyText}><Copy />העתק כטקסט</button>}
            </div>
            {plan && s.plans.length > 1 && (
              <div class="chips" style={{ marginTop: 12 }}>
                {s.plans.map((p) => <button class={'chip' + (p.id === plan.id ? ' on' : '')} onClick={() => actions.setActivePlan(p.id)}>{p.name}</button>)}
              </div>
            )}
            {plan && (
              <div style={{ marginTop: 14 }}>
                <label class="lbl">שם התוכנית</label>
                <input class="inp" value={plan.name} onChange={(e) => upd((p) => ({ ...p, name: nv(e) || p.name }))} />
                <button class="btn danger block" style={{ marginTop: 12 }} onClick={() => { if (confirm(`למחוק את "${plan.name}"?`)) { const old = plan; actions.deletePlan(plan.id); toast('התוכנית נמחקה', () => actions.savePlan(old)); } }}><Trash />מחק תוכנית</button>
              </div>
            )}
          </>
        )}

        {day && (
          <>
            <input class="inp" value={day.name} aria-label="שם היום" onChange={(e) => updDay((d) => ({ ...d, name: nv(e) || d.name }))} />
            {day.blocks.map((b, bi) => (
              <div class="g pl-blk" key={b.id}>
                <div class="pl-bh">
                  <input class="inp" value={b.title} aria-label="שם הקבוצה" onChange={(e) => updBlock(b.id, (x) => ({ ...x, title: nv(e) || x.title }))} />
                  <button class="as-rm" aria-label="הזז למעלה" onClick={() => updDay((d) => ({ ...d, blocks: move(d.blocks, bi, -1) }))}><ChevronUp /></button>
                  <button class="as-rm" aria-label="הזז למטה" onClick={() => updDay((d) => ({ ...d, blocks: move(d.blocks, bi, 1) }))}><ChevronDown /></button>
                  <button class="as-rm" aria-label="מחק קבוצה" onClick={() => updDay((d) => ({ ...d, blocks: d.blocks.filter((x) => x.id !== b.id) }))}><Trash /></button>
                </div>
                {b.exercises.map((e, ei) => (
                  <div class="pl-ex" key={e.id}>
                    <div class="pl-eh">
                      <input class="inp" value={e.name} aria-label="שם התרגיל" onChange={(ev) => updEx(b.id, e.id, { name: nv(ev) || e.name })} />
                      <button class="as-rm" aria-label="למעלה" onClick={() => updBlock(b.id, (x) => ({ ...x, exercises: move(x.exercises, ei, -1) }))}><ChevronUp /></button>
                      <button class="as-rm" aria-label="למטה" onClick={() => updBlock(b.id, (x) => ({ ...x, exercises: move(x.exercises, ei, 1) }))}><ChevronDown /></button>
                      <button class="as-rm" aria-label="מחק תרגיל" onClick={() => updBlock(b.id, (x) => ({ ...x, exercises: x.exercises.filter((y) => y.id !== e.id) }))}><X /></button>
                    </div>
                    <div class="pl-nums">
                      <AmtInput value={e.sets} onChange={(n) => updEx(b.id, e.id, { sets: Math.round(n) })} suffix="סטים" />
                      <AmtInput value={e.reps} onChange={(n) => updEx(b.id, e.id, { reps: Math.round(n) })} suffix={e.unit === 'sec' ? 'שניות' : 'חזרות'} />
                      <button class="pl-unit" onClick={() => updEx(b.id, e.id, { unit: e.unit === 'sec' ? 'reps' : 'sec' })}>{e.unit === 'sec' ? 'בזמן' : 'חזרות'}</button>
                      <AmtInput value={e.kg ?? 0} onChange={(n) => updEx(b.id, e.id, { kg: n })} suffix="ק״ג" />
                    </div>
                    <input class="inp pl-note" value={e.note ?? ''} placeholder="הערה (למשל: לכל יד)" onChange={(ev) => updEx(b.id, e.id, { note: nv(ev) || undefined })} />
                    <div class="mu pl-sum num">{exLabel(e)}</div>
                  </div>
                ))}
                <button class="tr-add" onClick={() => updBlock(b.id, (x) => ({ ...x, exercises: [...x.exercises, newEx()] }))}><Plus />תרגיל</button>
              </div>
            ))}
            <button class="btn block" style={{ marginTop: 8 }} onClick={() => updDay((d) => ({ ...d, blocks: [...d.blocks, { id: uid(), title: 'קבוצה חדשה', exercises: [newEx()] }] }))}><Plus />הוסף קבוצה</button>

            <div class="g pl-wk">
              <b>ביום בשבוע</b>
              {weekRoutines.length === 0 && <span class="mu" style={{ fontSize: 13 }}>היום הזה עוד לא מתוזמן. כשמתזמנים, הוא מופיע בלוח האימונים והיומן וכפתור "רשום" יפתח את התרגילים שלו.</span>}
              {weekRoutines.map((r) => (
                <div class="pl-wr" key={r.id}>
                  <span>{DAY_NAMES[r.dow]} · {r.time}</span>
                  <button class="as-rm" aria-label="הסר" onClick={() => actions.saveRoutine(s.settings.routine.filter((x) => x.id !== r.id))}><X /></button>
                </div>
              ))}
              <button class="btn sm" onClick={() => setSheet('week')}><Plus />תזמן ליום בשבוע</button>
            </div>
            <button class="btn danger block" style={{ marginTop: 14 }} onClick={() => { const old = plan!; upd((p) => ({ ...p, days: p.days.filter((d) => d.id !== dayId) })); setDayId(null); toast('היום נמחק', () => actions.savePlan(old)); }}><Trash />מחק יום</button>
          </>
        )}
      </div>

      <Sheet open={sheet === 'import'} onClose={() => setSheet(null)}>
        <h3>ייבוא תוכנית מטקסט</h3>
        <div class="mu" style={{ fontSize: 13, margin: '2px 0 8px', lineHeight: 1.5 }}>הדבק את התוכנית. שורה "יום …" פותחת יום, כותרת פותחת קבוצה, ושורה עם "סטים" היא תרגיל.</div>
        <textarea class="inp pl-ta" value={txt} placeholder={'יום א:\nגב:\n   מתח: שלושה סטים 10 חזרות\n   פלאנק: שלושה סטים של דקה'} onInput={(e) => { setTxt(nv(e)); setPrev(null); }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button class="btn primary" style={{ flex: 1 }} disabled={!txt.trim() || busy} onClick={analyze}>נתח</button>
          {aiOn && <button class="btn" disabled={!txt.trim() || busy} onClick={() => void analyzeAi()}><Sparkles />{busy ? 'מנתח…' : 'נתח עם AI'}</button>}
        </div>
        {err && <div class="err">{err}</div>}
        {prev && (
          <div class="g pl-prev">
            <div class="pl-pt">זיהיתי {prev.days.length} ימים ו-{prev.days.reduce((a, d) => a + d.blocks.reduce((b, x) => b + x.exercises.length, 0), 0)} תרגילים</div>
            {prev.days.map((d) => (
              <div key={d.id}><b>{d.name}</b>{d.blocks.map((b) => <div class="mu pl-pl" key={b.id}>{b.title}: {b.exercises.map((e) => `${e.name} ${exLabel(e)}`).join(' · ')}</div>)}</div>
            ))}
            <button class="btn primary block" style={{ marginTop: 10 }} onClick={saveImport}><Check />שמור כתוכנית</button>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'ai'} onClose={() => setSheet(null)}>
        <h3>ערוך את התוכנית עם AI</h3>
        <div class="mu" style={{ fontSize: 13, margin: '2px 0 8px', lineHeight: 1.5 }}>תאר בחופשיות מה לשנות. אתה תראה את התוצאה לפני שהיא נשמרת.</div>
        <textarea class="inp pl-ta" value={instr} placeholder="למשל: תחליף את מתח אוסטרלי בחתירה, ותוסיף סט לארצר. ביום חדר תעלה את הפלאנק ל-90 שניות" onInput={(e) => setInstr(nv(e))} />
        <button class="btn primary block" style={{ marginTop: 10 }} disabled={!instr.trim() || busy} onClick={() => void runAi()}><Sparkles />{busy ? 'עורך…' : 'הצע שינוי'}</button>
        {err && <div class="err">{err}</div>}
        {prev && (
          <div class="g pl-prev">
            {aiSum && <div class="pl-pt">{aiSum}</div>}
            {prev.days.map((d) => (
              <div key={d.id}><b>{d.name}</b>{d.blocks.map((b) => <div class="mu pl-pl" key={b.id}>{b.title}: {b.exercises.map((e) => `${e.name} ${exLabel(e)}`).join(' · ')}</div>)}</div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button class="btn primary" style={{ flex: 1 }} onClick={applyAi}><Check />החל שינוי</button>
              <button class="btn" onClick={() => setPrev(null)}>בטל</button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'week'} onClose={() => setSheet(null)}>
        <h3>תזמון {day?.name}</h3>
        <div class="chips" style={{ marginTop: 10 }}>
          {DAY_NAMES.map((n, d) => <button class={'chip' + (wd.dow === d ? ' on' : '')} onClick={() => setWd({ ...wd, dow: d })}>{n}</button>)}
        </div>
        <input class="inp num" type="time" style={{ marginTop: 12 }} value={wd.time} onChange={(e) => setWd({ ...wd, time: nv(e) || wd.time })} />
        <button class="btn primary block" style={{ marginTop: 14 }} onClick={addToWeek}>הוסף לשבוע</button>
      </Sheet>
    </BigSheet>
  );
}
