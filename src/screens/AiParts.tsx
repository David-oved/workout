import { useEffect, useRef, useState } from 'preact/hooks';
import { Check, Undo2, Globe, Brain, FileText, X, Copy, Send, Pencil, Quote, RefreshCw, Share2 } from 'lucide-preact';
import { chat, confirmMemory, dismissMemory, pendingProducts, regenerate, retryLast, undoAdd, type Msg } from '../ai/chat';
import { toast } from '../ui/ui';
import { hold, openMenu, type MenuItem } from '../ui/actmenu';
import { ProductCard } from './ProductCard';
import { Md } from './AiChat';
import { BusyRow } from './BusyRow';

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

const plain = (t: string) => t.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); toast('הועתק'); }
  catch {
    // גיבוי כשאין הרשאת לוח: בחירה זמנית בשדה נסתר
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.cssText = 'position:fixed;opacity:0;left:-999px'; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); toast('הועתק');
    } catch { toast('ההעתקה לא הצליחה'); }
  }
}

/** תפריט הלחיצה הארוכה על הודעה: העתקה, שליחה חוזרת, עריכה, שיתוף ושאלה על התשובה */
function msgMenu(m: Msg, last: boolean, o: { onSuggest: (t: string) => void; onFill?: (t: string) => void }) {
  const text = plain(m.text);
  const items: MenuItem[] = [];
  if (text) items.push({ label: 'העתק', icon: <Copy />, run: () => void copyText(text) });
  if (m.role === 'user' && text && !chat.get().busy) {
    items.push({ label: 'שלח שוב', icon: <Send />, run: () => o.onSuggest(m.text) });
    if (o.onFill) items.push({ label: 'ערוך ושלח', icon: <Pencil />, run: () => o.onFill!(m.text) });
  }
  if (m.role === 'ai' && text) {
    if (o.onFill) items.push({ label: 'שאל על התשובה הזו', icon: <Quote />, run: () => o.onFill!(`בנוגע ל״${text.length > 70 ? text.slice(0, 70).trim() + '…' : text}״: `) });
    if (last && !m.card && !chat.get().busy) items.push({ label: 'תשובה חדשה לאותה שאלה', icon: <RefreshCw />, run: () => regenerate(m.id) });
  }
  if (text && typeof navigator.share === 'function') items.push({ label: 'שתף', icon: <Share2 />, run: () => void navigator.share({ text }).catch(() => undefined) });
  openMenu(m.role === 'user' ? 'ההודעה שלך' : 'תשובת ה-AI', items, text.length > 60 ? text.slice(0, 60).trim() + '…' : text);
}

export function Messages({ onSuggest, onFill }: { onSuggest: (t: string) => void; onFill?: (t: string) => void }) {
  const st = chat.use((s) => s);
  const lastAi = [...st.messages].reverse().find((m) => m.role === 'ai');
  const lastId = st.messages[st.messages.length - 1]?.id;
  return (
    <>
      {st.messages.map((m) => (
        <div class={'msg ' + (m.role === 'user' ? 'u' : 'a')} key={m.id}>
          <div class="mcol">
            {(m.text || m.images?.length || m.fileNames?.length) && (
              <div class={'mb' + (m.role === 'ai' ? ' md' : '')} {...(m.text && !m.streaming ? hold(() => msgMenu(m, m.id === lastId, { onSuggest, onFill })) : {})}>
                {m.images?.length ? <div class="mimgs">{m.images.map((u) => <img src={u} />)}</div> : null}
                {m.fileNames?.length ? <div class="fchips">{m.fileNames.map((n) => <span class="fchip"><FileText />{n}</span>)}</div> : null}
                {m.role === 'ai' ? <Md text={m.text} /> : m.text}
              </div>
            )}
            {m.sources?.length ? (
              <div class="srcs">{m.sources.map((s) => <a class="src" href={s.uri} target="_blank" rel="noopener"><Globe />{s.title}</a>)}</div>
            ) : null}
            {m.webFailed && <div class="mu" style={{ fontSize: 12, margin: '0 6px' }}>החיפוש באינטרנט לא זמין כרגע, אז זו תשובה בלי מקורות.</div>}
            {m.memoryAsk?.length ? <div class="remb ask">{m.memoryAsk.map((r) => <span key={r}><Brain />לזכור: {r}<button onClick={() => confirmMemory(m.id, r)}>שמור</button><button class="nx" aria-label="לא" onClick={() => dismissMemory(m.id, r)}><X /></button></span>)}</div> : null}
            {m.remembered?.length ? <div class="remb">{m.remembered.map((r) => <span><Brain />נשמר בזיכרון: {r}</span>)}</div> : null}
            {m.meta && (
              <details class="mtr">
                <summary class="mu num">{m.meta.model} · {(m.meta.ms / 1000).toFixed(1)}s{m.meta.calls && m.meta.calls > 1 ? ` · ${m.meta.calls} קריאות` : ''}{m.meta.thinking ? ` · think:${m.meta.thinking}` : ''}{m.meta.web ? ' · web' : ''}</summary>
                {m.meta.trace?.length ? <pre>{m.meta.trace.join('\n')}</pre> : null}
              </details>
            )}
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
            {m.card === 'cleared' && <div class="mu" style={{ fontSize: 12, margin: '4px 6px' }}>הכרטיס הוסר</div>}
            {m.card === 'old' && <div class="mu" style={{ fontSize: 12, margin: '4px 6px' }}>הארוחה עודכנה בהודעה הבאה</div>}
          </div>
        </div>
      ))}
      <BusyRow />
      {!st.busy && lastAi?.suggestions?.length ? (
        <div class="sugg row">{lastAi.suggestions.map((s) => <button class="chip" onClick={() => onSuggest(s)}>{s}</button>)}</div>
      ) : null}
      <ErrorBox />
    </>
  );
}
