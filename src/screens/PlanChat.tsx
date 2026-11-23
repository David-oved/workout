import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowUp, Check, ChevronDown, ChevronRight, MessageSquarePlus, Sparkles } from 'lucide-preact';
import { DAY_NAMES, DAY_SHORT } from '../core/dates';
import { exLabel, type WeekItem } from '../core/plan';
import { applyProposal, planChat, resetPlanChat, sendPlanMessage, type PMsg } from '../ai/planchat';
import type { Plan } from '../core/types';

/** כרטיסיית החלוקה השבועית: איזה יום בתוכנית באיזה יום בשבוע, ומה נעשה בו */
export function WeekCard({ week, plan, title = 'החלוקה השבועית' }: { week: WeekItem[]; plan: Plan | undefined; title?: string }) {
  const by = new Map(week.map((w) => [w.dow, w.day] as const));
  const groups = (name: string) => {
    const d = plan?.days.find((x) => x.name === name);
    return d ? [...new Set(d.blocks.map((b) => b.title.split(' · ').pop()!))].slice(0, 3) : [];
  };
  return (
    <div class="g wkc">
      <div class="wkc-h"><b>{title}</b><span class="mu num">{week.length} ימי אימון, {7 - week.length} מנוחה</span></div>
      <div class="wkc-g">
        {DAY_SHORT.map((l, i) => {
          const day = by.get(i);
          return (
            <div class={'wkc-c' + (day ? ' on' : '')} key={i}>
              <span class="l" aria-label={DAY_NAMES[i]}>{l}</span>
              {day ? (
                <>
                  <b>{day.replace(/^יום\s+/, '')}</b>
                  {groups(day).map((g) => <small key={g}>{g}</small>)}
                </>
              ) : <small class="r">מנוחה</small>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STARTERS = ['אני מתאמן 3 פעמים בשבוע, אסביר לך מה בכל יום', 'יש לי כבר תוכנית ורוצה לשפר אותה', 'תבנה לי תוכנית מאפס'];

function Proposal({ m }: { m: PMsg }) {
  const [open, setOpen] = useState(false);
  if (!m.plan) return null;
  return (
    <div class="pc-prop">
      {m.week && m.week.length > 0 && <WeekCard week={m.week} plan={m.plan} title="ככה זה ייראה" />}
      <div class="g pl-prev">
        <button class="pc-more" onClick={() => setOpen((v) => !v)}>
          <span>{m.plan.name} · {m.plan.days.length} ימים · {m.plan.days.reduce((a, d) => a + d.blocks.reduce((b, x) => b + x.exercises.length, 0), 0)} תרגילים</span>
          <ChevronDown class={open ? 'flip' : ''} />
        </button>
        {open && m.plan.days.map((d) => (
          <div key={d.id}><b>{d.name}</b>{d.blocks.map((b) => <div class="mu pl-pl" key={b.id}>{b.title}: {b.exercises.map((e) => `${e.name} ${exLabel(e)}`).join(' · ')}</div>)}</div>
        ))}
        {m.applied ? (
          <div class="pc-ok"><Check />הוחל</div>
        ) : (
          <>
            <button class="btn primary block" style={{ marginTop: 10 }} onClick={() => applyProposal(m)}><Check />אשר והחל</button>
            <div class="mu" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>זה יחליף את התוכנית ואת ימי האימון הקבועים שלך. אפשר לבטל אחרי. או שאפשר להמשיך לשוחח ולשנות.</div>
          </>
        )}
      </div>
    </div>
  );
}

export function PlanChat({ onBack }: { onBack: () => void }) {
  const st = planChat.use((x) => x);
  const [q, setQ] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { setTimeout(() => { const b = body.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 80); }, [st.messages.length, st.busy]);
  const send = (t?: string) => { const v = (t ?? q).trim(); if (!v) return; setQ(''); void sendPlanMessage(v); };
  const last = [...st.messages].reverse().find((m) => m.role === 'ai');

  return (
    <>
      <div class="as-chatbar" style={{ marginTop: 4 }}>
        <button class="as-back" onClick={onBack}><ChevronRight size={16} />חזרה</button>
        {st.messages.length > 0 && <button class="as-new" onClick={resetPlanChat}><MessageSquarePlus />שיחה חדשה</button>}
      </div>
      <div class="as-body pc-body" ref={body} style={{ paddingBottom: 90 }}>
        {st.messages.length === 0 && (
          <div class="aiempty" style={{ paddingTop: 6 }}>
            <div class="aiorb"><Sparkles /></div>
            <div style={{ fontSize: 18, fontWeight: 600, margin: '10px 0 4px' }}>בוא נבנה את התוכנית יחד</div>
            <div class="mu" style={{ lineHeight: 1.6 }}>ספר לי איך אתה מתאמן: כמה ימים בשבוע, איפה, ומה בכל יום. אני אשאל מה שחסר, ובסוף תראה כרטיסייה של החלוקה השבועית ותחליט.</div>
            <div class="sugg">
              {STARTERS.map((t) => <button class="chip" style={{ flex: 'none', whiteSpace: 'normal', height: 'auto', padding: '9px 14px', textAlign: 'right', borderRadius: 16 }} onClick={() => send(t)}>{t}</button>)}
            </div>
          </div>
        )}
        {st.messages.map((m) => (
          <div class={'msg ' + (m.role === 'user' ? 'u' : 'a')} key={m.id}>
            <div class="mcol">
              <div class={'mb' + (m.role === 'ai' ? ' md' : '')}>{m.text}</div>
              {m.role === 'ai' && <Proposal m={m} />}
            </div>
          </div>
        ))}
        {st.busy && <div class="stage" aria-live="polite"><span class="sdots"><i /><i /><i /></span><span class="stg">חושב על התוכנית…</span></div>}
        {st.error && <div class="aerr">{st.error} <button onClick={() => { const u = [...st.messages].reverse().find((m) => m.role === 'user'); if (u) void sendPlanMessage(u.text); }}>נסה שוב</button></div>}
        {!st.busy && last && !last.plan && st.messages.length > 0 && <div class="mu" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>כשיהיה לי מספיק מידע אציע תוכנית וחלוקה שבועית</div>}
      </div>
      <div class="pc-in">
        <div class="g as-in" style={{ margin: 0 }}>
          <Sparkles />
          <input value={q} placeholder="ספר לי על האימונים שלך…" enterkeyhint="send" autocomplete="off" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
          {q.trim() && <button class="ic go" aria-label="שלח" onClick={() => send()}><ArrowUp /></button>}
        </div>
      </div>
    </>
  );
}
