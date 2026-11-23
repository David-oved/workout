import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowUp, Check, ChevronDown, ChevronRight, MessageSquarePlus, Sparkles } from 'lucide-preact';
import { DAY_NAMES, DAY_SHORT } from '../core/dates';
import { exLabel, type WeekItem } from '../core/plan';
import { applyDraft, planChat, resetPlanChat, sendPlanMessage } from '../ai/planchat';
import { aiState } from '../ai/gemini';
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

const STARTERS = ['הדבק כאן את התוכנית שלך ואני אבדוק אותה', 'אני מתאמן 3 פעמים בשבוע, אסביר לך מה בכל יום', 'תשלים לי את התרגילים לפי קבוצות שרירים'];

/** הטיוטה החיה: החלוקה השבועית, כל הימים והתרגילים שבתוכם (עם סוג כל תרגיל), ואישור */
function Draft() {
  const { draft, week } = planChat.use((x) => x);
  const [openDay, setOpenDay] = useState<string | null>(null);
  if (!draft || !draft.days.length) return null;
  const total = draft.days.reduce((a, d) => a + d.blocks.reduce((b, x) => b + x.exercises.length, 0), 0);
  return (
    <div class="pc-prop">
      {week.length > 0 && <WeekCard week={week} plan={draft} title="ככה זה ייראה" />}
      <div class="g pl-prev">
        <div class="pl-pt">{draft.name} · {draft.days.length} ימים · {total} תרגילים</div>
        {draft.days.map((d) => {
          const n = d.blocks.reduce((a, b) => a + b.exercises.length, 0);
          const open = openDay === d.id;
          return (
            <div class="pc-dd" key={d.id}>
              <button class="pc-more" onClick={() => setOpenDay(open ? null : d.id)}>
                <span><b>{d.name}</b> <span class="mu num">{n} תרגילים</span></span>
                <ChevronDown class={open ? 'flip' : ''} />
              </button>
              {open && d.blocks.map((b) => (
                <div class="pc-bl" key={b.id}>
                  <div class="mu pc-bt">{b.title}</div>
                  {b.exercises.map((e) => (
                    <div class="pc-ex" key={e.id}><span>{e.name}</span><span class="num">{exLabel(e)}{e.unit === 'sec' ? ' ⏱' : ''}</span></div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
        <button class="btn primary block" style={{ marginTop: 12 }} onClick={applyDraft}><Check />אשר והחל</button>
        <div class="mu" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>זה יחליף את התוכנית ואת ימי האימון הקבועים שלך, ואפשר לבטל אחרי. אפשר להמשיך לשוחח ולשנות לפני.</div>
      </div>
    </div>
  );
}

export function PlanChat({ onBack }: { onBack: () => void }) {
  const st = planChat.use((x) => x);
  const aiOn = aiState.use((x) => x.configured);
  const [q, setQ] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { setTimeout(() => { const b = body.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 80); }, [st.messages.length, st.busy, st.draftAt]);
  const send = (t?: string) => { const v = (t ?? q).trim(); if (!v) return; setQ(''); const ta = document.querySelector('.pc-in textarea') as HTMLTextAreaElement | null; if (ta) ta.style.height = 'auto'; void sendPlanMessage(v); };

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
            <div class="mu" style={{ lineHeight: 1.6 }}>אפשר להדביק תוכנית שלמה (גם של מאות תרגילים) והיא תיקלט עם כל התרגילים, או לספר לי בחופשיות איך אתה מתאמן. אני יודע מה נמדד בחזרות ומה בזמן (פלאנק, תלייה), ואפשר לבקש שאשלים תרגילים, אחליף או אשנה. בסוף תראה חלוקה שבועית ותחליט.</div>
            {!aiOn && <div class="mu" style={{ marginTop: 8, fontSize: 13 }}>בלי חיבור ל-AI אפשר להדביק תוכנית והיא תיקלט מקומית.</div>}
            <div class="sugg">
              {STARTERS.map((t) => <button class="chip" style={{ flex: 'none', whiteSpace: 'normal', height: 'auto', padding: '9px 14px', textAlign: 'right', borderRadius: 16 }} onClick={() => { if (t.startsWith('הדבק')) { const i = document.querySelector('.pc-in textarea') as HTMLTextAreaElement | null; i?.focus(); } else send(t); }}>{t}</button>)}
            </div>
          </div>
        )}
        {st.messages.map((m) => (
          <div key={m.id}>
            <div class={'msg ' + (m.role === 'user' ? 'u' : 'a')}>
              <div class="mcol">
                <div class={'mb' + (m.role === 'ai' ? ' md' : '')} style={{ whiteSpace: 'pre-wrap', maxHeight: m.role === 'user' ? 140 : undefined, overflow: m.role === 'user' ? 'hidden' : undefined }}>{m.text}</div>
                {m.log && <div class="pc-log">{m.log.slice(0, 8).map((l, i) => <span key={i}>{l}</span>)}{m.log.length > 8 && <span>ועוד {m.log.length - 8} שינויים</span>}</div>}
              </div>
            </div>
            {st.draftAt === m.id && <Draft />}
          </div>
        ))}
        {st.busy && <div class="stage" aria-live="polite"><span class="sdots"><i /><i /><i /></span><span class="stg">חושב על התוכנית…</span></div>}
        {st.error && <div class="aerr">{st.error} <button onClick={() => { const u = [...st.messages].reverse().find((m) => m.role === 'user'); if (u) { planChat.set((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== u.id) })); void sendPlanMessage(u.text); } }}>נסה שוב</button></div>}
      </div>
      <div class="pc-in">
        <div class="g as-in" style={{ margin: 0 }}>
          <Sparkles />
          <textarea rows={1} value={q} placeholder="ספר לי, או הדבק את התוכנית…" onInput={(e) => { const el = e.target as HTMLTextAreaElement; setQ(el.value); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 130) + 'px'; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !q.includes('\n')) { e.preventDefault(); send(); } }} />
          {q.trim() && <button class="ic go" aria-label="שלח" onClick={() => send()}><ArrowUp /></button>}
        </div>
      </div>
    </>
  );
}
