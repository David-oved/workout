import { useEffect, useRef, useState } from 'preact/hooks';
import { X, Sparkles, RefreshCw } from 'lucide-preact';
import { store } from '../core/state';
import { dayLabel, todayKey } from '../core/dates';
import { ui, setUi } from '../ui/ui';
import { BigSheet } from '../ui/components';
import { aiState } from '../ai/gemini';
import { generateSummary, ruleSummary } from '../ai/summary';
import { Md } from './AiChat';

/** סיכום סוף יום: מספרים מיד, וסיכום ה-AI (אימון, אכילה, מה לשפר, מחר) נוצר ונשמר לכל יום */
export function SummarySheet() {
  const date = ui.use((u) => u.summary);
  const s = store.use((x) => x);
  const aiOn = aiState.use((x) => x.configured);
  const last = useRef(date);
  if (date) last.current = date;
  const d = date ?? last.current;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const saved = d ? s.summaries[d] : undefined;

  const run = async (force = false) => {
    if (!d || busy || (saved && !force)) return;
    setBusy(true);
    setErr('');
    try { await generateSummary(d); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { if (date && aiOn && !s.summaries[date]) void run(); }, [date]);

  const today = todayKey(s.settings.resetHour);
  return (
    <BigSheet open={!!date} onClose={() => setUi({ summary: null })}>
      <div class="as-top">
        <div>
          <div class="as-ti" style={{ fontSize: 28 }}>סיכום היום</div>
          <div class="as-su">{d ? dayLabel(d, today) : ''}</div>
        </div>
        <button class="as-x" aria-label="סגור" onClick={() => setUi({ summary: null })}><X /></button>
      </div>
      <div class="as-body" style={{ paddingBottom: 90 }}>
        {d && (
          <div class="g sm-stats">
            {ruleSummary(s, d).map((l, i) => <div key={i} class="num">{l}</div>)}
          </div>
        )}
        {!aiOn && <div class="g sm-note">חבר את ה-AI בהגדרות כדי לקבל סיכום מלא: מה לשפר ומה להמליץ למחר.</div>}
        {busy && (
          <div class="stage" aria-live="polite"><span class="sdots"><i /><i /><i /></span><span class="stg">ה-AI מסכם את היום…</span></div>
        )}
        {err && <div class="aerr">{err} <button onClick={() => void run(true)}>נסה שוב</button></div>}
        {saved && (
          <div class="g sm-ai">
            <div class="sm-h"><Sparkles /><span>סיכום מה-AI</span></div>
            <div class="md"><Md text={saved.text} /></div>
            <div class="mu num" style={{ fontSize: 11.5, marginTop: 10, direction: 'ltr', textAlign: 'left' }}>{saved.model} · {new Date(saved.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        )}
        {aiOn && (saved || err) && (
          <button class="btn block" style={{ marginTop: 12 }} disabled={busy} onClick={() => void run(true)}><RefreshCw />צור סיכום מחדש</button>
        )}
      </div>
    </BigSheet>
  );
}
