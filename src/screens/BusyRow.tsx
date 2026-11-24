import { useEffect, useState } from 'preact/hooks';
import { RefreshCw, Square } from 'lucide-preact';
import { chat, retryLast, retryNow, stopChat } from '../ai/chat';

/** סטטוס של ה-AI בזמן שהוא עובד: מה קורה עכשיו, כמה זמן, איזה מודל, ואפשרות לעצור או לשלוח שוב */
export function BusyRow() {
  const st = chat.use((s) => s);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!st.busy) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st.busy]);

  if (!st.busy) {
    return st.stopped ? (
      <div class="stoppedrow">
        <span>העצירה בוצעה. ההודעה שלך נשארה.</span>
        <button onClick={() => void retryLast()}><RefreshCw />שלח שוב</button>
      </div>
    ) : null;
  }
  const r = st.run;
  const sec = r ? Math.max(0, Math.round((now - r.startedAt) / 1000)) : 0;
  const slow = sec >= 15;
  return (
    <div class="busyrow" aria-live="polite">
      <div class="stage">
        <span class="sdots"><i /><i /><i /></span>
        <span class="stg" key={st.stage?.n ?? 0}>{st.stage?.text ?? 'קיבל את ההודעה'}</span>
      </div>
      <div class="busy-info num">
        <span>{sec} שנ׳</span>
        {r && r.attempt > 0 && <span>ניסיון {r.attempt}{r.label ? ' · ' + r.label : ''}</span>}
        {r?.model && <span dir="ltr">{r.model}</span>}
        {slow && <span class="slowtag">לוקח יותר מהרגיל{r && r.timeoutS ? ` · אם לא תהיה תגובה תוך ${r.timeoutS} שנ׳ אשלח שוב לבד` : ''}</span>}
      </div>
      <div class="busy-act">
        <button class="stop" onClick={stopChat}><Square />עצור</button>
        {sec >= 8 && <button onClick={() => void retryNow()}><RefreshCw />שלח שוב עכשיו</button>}
      </div>
    </div>
  );
}
