import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, Undo2, Globe, Brain, FileText } from 'lucide-preact';
import { chat, pendingProducts, retryLast, undoAdd } from '../ai/chat';
import { ProductCard } from './ProductCard';
import { Md } from './AiChat';

/** רכיבי שיחה משותפים (הודעות, שורת סטטוס חיה, הצעות ושגיאות/מכסה) */

export function ErrorBox() {
  const st = chat.use((s) => s);
  const [showDet, setShowDet] = useState(false);
  const [now, setNow] = useState(Date.now());
  const auto = useRef(0);
  useEffect(() => {
    if (!st.quota) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st.quota?.until]);
  useEffect(() => {
    const q = st.quota;
    if (q && q.kind === 'minute' && now >= q.until && auto.current !== q.until && !st.busy) {
      auto.current = q.until;
      void retryLast();
    }
  }, [now, st.quota?.until]);

  if (!st.error) return null;
  const q = st.quota;
  const det = st.detail && (
    <>
      <button class="adetb" onClick={() => setShowDet((v) => !v)}>{showDet ? 'הסתר פרטים טכניים' : 'פרטים טכניים'}</button>
      {showDet && (
        <>
          <pre class="adet">{st.detail}</pre>
          <button class="adetb" onClick={async () => { try { await navigator.clipboard.writeText(st.detail ?? ''); } catch { /* ignore */ } }}>העתק</button>
        </>
      )}
    </>
  );
  if (q) {
    return (
      <div class="aerr quota">
        <b>{st.error}</b>
        <div style={{ marginTop: 6, lineHeight: 1.6 }}>
          {q.kind === 'day'
            ? `המכסה החינמית היומית נגמרה בכל המודלים הזמינים. היא מתאפסת בערך ב-${new Date(q.until).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}.`
            : now < q.until
              ? `אפשר לנסות שוב בעוד ${Math.max(1, Math.ceil((q.until - now) / 1000))} שניות. אנסה לבד כשהזמן יעבור.`
              : 'הזמן עבר, מנסה שוב…'}
          {q.limit ? <div class="mu" style={{ marginTop: 4 }}>המגבלה במסלול החינמי: {q.limit} {q.kind === 'day' ? 'ליום' : 'לדקה'} למודל</div> : null}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button disabled={q.kind === 'minute' && now < q.until} onClick={() => void retryLast()}>נסה שוב</button>
          <a class="src" href="https://ai.dev/rate-limit" target="_blank" rel="noopener">בדוק שימוש ומכסות</a>
        </div>
        <div class="mu" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>אפשר גם לעבור למודל אחר בהגדרות ← AI תזונה, או להפעיל חיוב ב-AI Studio כדי להסיר את המגבלות החינמיות.</div>
        {det}
      </div>
    );
  }
  return (
    <div class="aerr">
      <div>{st.error} <button onClick={() => void retryLast()}>נסה שוב</button></div>
      {det}
    </div>
  );
}

export function Messages({ onSuggest }: { onSuggest: (t: string) => void }) {
  const st = chat.use((s) => s);
  const lastAi = [...st.messages].reverse().find((m) => m.role === 'ai');
  return (
    <>
      {st.messages.map((m) => (
        <div class={'msg ' + (m.role === 'user' ? 'u' : 'a')} key={m.id}>
          <div class="mcol">
            {(m.text || m.images?.length || m.fileNames?.length) && (
              <div class={'mb' + (m.role === 'ai' ? ' md' : '')}>
                {m.images?.length ? <div class="mimgs">{m.images.map((u) => <img src={u} />)}</div> : null}
                {m.fileNames?.length ? <div class="fchips">{m.fileNames.map((n) => <span class="fchip"><FileText />{n}</span>)}</div> : null}
                {m.role === 'ai' ? <Md text={m.text} /> : m.text}
              </div>
            )}
            {m.sources?.length ? (
              <div class="srcs">{m.sources.map((s) => <a class="src" href={s.uri} target="_blank" rel="noopener"><Globe />{s.title}</a>)}</div>
            ) : null}
            {m.webFailed && <div class="mu" style={{ fontSize: 12, margin: '0 6px' }}>החיפוש באינטרנט לא זמין כרגע, אז זו תשובה בלי מקורות.</div>}
            {m.remembered?.length ? <div class="remb">{m.remembered.map((r) => <span><Brain />נשמר בזיכרון: {r}</span>)}</div> : null}
            {m.meta && <div class="mu num" style={{ fontSize: 11, margin: '0 6px', direction: 'ltr' }}>{m.meta.model} · {(m.meta.ms / 1000).toFixed(1)}s{m.meta.thinking ? ` · think:${m.meta.thinking}` : ''}{m.meta.web ? ' · web' : ''}</div>}
            {pendingProducts(m).length > 0 && (m.card === 'draft'
              ? <div class="mu" style={{ fontSize: 12, margin: '2px 6px' }}>יש הצעה למוצר חדש: {pendingProducts(m).map((x) => x.name).join(', ')}. היא תופיע אחרי שתאשר את הארוחה</div>
              : pendingProducts(m).map((x) => <ProductCard key={x.id} msgId={m.id} p={x} onAddToMeal={m.card !== 'added'} />))}
            {m.card === 'draft' && <div class="mu" style={{ fontSize: 12, margin: '2px 6px' }}>הארוחה מוצגת במגש למטה, אפשר לדייק בגרמים</div>}
            {m.card === 'added' && (
              <div class="g mcard added">
                <div class="addedrow"><span class="okc"><Check /></span><span>נוסף ל{m.addedLabel}</span><button class="undob" onClick={() => undoAdd(m.id)}><Undo2 /> בטל</button></div>
                <div class="mu num" style={{ marginTop: 6 }}>{m.items?.map((i) => `${i.name} ${i.grams} ג׳`).join(' · ')}</div>
              </div>
            )}
            {m.card === 'old' && <div class="mu" style={{ fontSize: 12, margin: '4px 6px' }}>הארוחה עודכנה בהודעה הבאה</div>}
          </div>
        </div>
      ))}
      {st.busy && (
        <div class="stage" aria-live="polite">
          <span class="sdots"><i /><i /><i /></span>
          <span class="stg" key={st.stage?.n ?? 0}>{st.stage?.text ?? 'קיבל את ההודעה'}</span>
        </div>
      )}
      {!st.busy && lastAi?.suggestions?.length ? (
        <div class="sugg row">{lastAi.suggestions.map((s) => <button class="chip" onClick={() => onSuggest(s)}>{s}</button>)}</div>
      ) : null}
      <ErrorBox />
    </>
  );
}
