import { useEffect, useRef, useState } from 'preact/hooks';
import { Camera, ArrowUp, Trash, X, Sparkles, Plus, Minus, Check, Undo2, Globe, Brain, FileText, Paperclip } from 'lucide-preact';
import { store } from '../core/state';
import { dayLabel, todayKey } from '../core/dates';
import { ui, setUi, toast } from '../ui/ui';
import { FullScreen } from '../ui/components';
import { aiState, saveAiKey } from '../ai/gemini';
import { fileToAttachment } from '../ai/image';
import { itemMacros } from '../ai/pure';
import { addCardToDay, cardTotals, chat, removeItem, resetChat, retryLast, sendMessage, setDeep, setGrams, setWeb, undoAdd, type Attachment, type Msg } from '../ai/chat';

const SUGGEST = [
  'אכלתי חצי פיתה עם שניצל ושתי כפות חומוס',
  'כמה חלבון נשאר לי היום ומה כדאי לאכול עכשיו?',
  'למה אני לא עולה מספיק במשקל? תנתח לי את השבועיים האחרונים',
  'מה המחקר אומר על קריאטין לגיל שלי?',
];

/** חיבור מפתח Gemini (משמש גם בצ'אט וגם בהגדרות) */
export function AiSetup({ onDone }: { onDone?: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div class="g card">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>חיבור Gemini (פעם אחת, חינם)</div>
      <ol class="mu" style={{ margin: 0, paddingRight: 20, lineHeight: 1.8 }}>
        <li>פותחים את aistudio.google.com/apikey עם חשבון Google שלך.</li>
        <li>לוחצים Create API key ומעתיקים אותו.</li>
        <li>מדביקים כאן.</li>
      </ol>
      <a class="btn block" style={{ marginTop: 12, textDecoration: 'none', color: 'inherit' }} href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">פתח את Google AI Studio</a>
      <label class="lbl" style={{ marginTop: 14 }}>המפתח (נשמר רק בטלפון הזה, לא נכנס לגיבוי)</label>
      <input class="inp" style={{ direction: 'ltr', textAlign: 'left' }} value={key} placeholder="AIza…" autocomplete="off" autocapitalize="none" spellcheck={false} onInput={(e) => { setKey((e.target as HTMLInputElement).value); setErr(''); }} />
      <div class="err" style={{ gridColumn: 'auto', marginTop: 6 }}>{err}</div>
      <button class="btn primary block" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await saveAiKey(key);
        setBusy(false);
        if (!r.ok) { setErr(r.msg ?? 'שגיאה'); return; }
        setKey('');
        onDone?.();
      }}>{busy ? 'בודק…' : 'חבר'}</button>
      <div class="note" style={{ margin: '10px 0 0' }}>הטקסט, התמונות והמסמכים שאתה שולח נשלחים ל-Google כדי לקבל תשובה. ההערכות מקורבות, ותמונה של תווית תזונה מדויקת יותר מצילום של צלחת.</div>
    </div>
  );
}

/** מרנדר Markdown קל (הדגשה ורשימות) בלי innerHTML */
export function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : p));
}
export function Md({ text }: { text: string }) {
  const blocks: any[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul class="mdl" key={'l' + blocks.length}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    list = [];
  };
  for (const ln of text.split('\n')) {
    const m = ln.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (ln.trim()) blocks.push(<p class="mdp" key={'p' + blocks.length}>{inline(ln.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function MealCard({ m, slotName, onAdd }: { m: Msg; slotName: string; onAdd: () => void }) {
  const items = m.items ?? [];
  const tot = cardTotals(items);
  return (
    <div class="g mcard">
      <div class="mch"><b>כרטיס ארוחה</b><span class="mu">אפשר לערוך את הכמויות</span></div>
      {items.map((it) => {
        const mm = itemMacros(it);
        return (
          <div class="mit" key={it.id}>
            <div class="mih">
              <span class={'cdot ' + it.confidence} title={{ high: 'ביטחון גבוה', medium: 'ביטחון בינוני', low: 'ביטחון נמוך' }[it.confidence]} />
              <b>{it.name}</b>
              {it.source === 'label' && <i class="etag lab">מתווית</i>}
              {it.source === 'estimate' && <i class="etag">הערכה</i>}
              <button class="aix" aria-label="הסר" onClick={() => removeItem(m.id, it.id)}><X /></button>
            </div>
            <div class="mig">
              <button class="gst" aria-label="פחות" onClick={() => setGrams(m.id, it.id, it.grams - 10)}><Minus /></button>
              <input type="range" min="5" max={Math.max(800, Math.round(it.grams * 1.3))} step="5" value={it.grams} onInput={(e) => setGrams(m.id, it.id, Number((e.target as HTMLInputElement).value))} />
              <button class="gst" aria-label="יותר" onClick={() => setGrams(m.id, it.id, it.grams + 10)}><Plus /></button>
              <span class="gval num">{it.grams} ג׳</span>
            </div>
            <div class="emac num"><i class="mk">{mm.k} קל׳</i><i class="mp">{mm.p} ח׳</i><i class="mc2">{mm.c} פ׳</i><i class="mf">{mm.f} ש׳</i></div>
            {it.note && <div class="mnote">{it.note}</div>}
          </div>
        );
      })}
      {items.length === 0 && <div class="mu" style={{ padding: '8px 0' }}>הכרטיס ריק. אפשר לבקש מה-AI להוסיף מנה.</div>}
      <div class="mtot num">
        <div><b>{tot.k}</b><small>קל׳</small></div>
        <div class="c1"><b>{tot.p}</b><small>חלבון</small></div>
        <div class="c2"><b>{tot.c}</b><small>פחמימה</small></div>
        <div class="c3"><b>{tot.f}</b><small>שומן</small></div>
      </div>
      <button class="btn primary block" disabled={!items.length} onClick={onAdd}>הוסף ל{slotName}</button>
    </div>
  );
}

export function AiChat() {
  const open = ui.use((u) => u.aiOpen);
  const slot = ui.use((u) => u.addSlot);
  const date = ui.use((u) => u.addDate);
  const configured = aiState.use((s) => s.configured);
  const st = chat.use((s) => s);
  const settings = store.use((s) => s.settings);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [showDet, setShowDet] = useState(false);
  const [now, setNow] = useState(Date.now());
  const autoRetried = useRef<number>(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotName = settings.slots.find((x) => x.id === slot)?.name ?? 'ארוחה';
  const lastAi = [...st.messages].reverse().find((m) => m.role === 'ai');

  // ברירת המחדל של חיפוש באינטרנט מההגדרות משפיעה על הכפתור בצ'אט
  useEffect(() => { setWeb(settings.ai.web); }, [settings.ai.web]);

  useEffect(() => {
    if (open) setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 60);
  }, [st.messages.length, st.busy, st.error, open]);
  useEffect(() => {
    // בזמן שהתשובה נכתבת, ממשיכים לגלול למטה
    if (st.busy) { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight }); }
  }, [st.messages[st.messages.length - 1]?.text]);

  // שעון עצר אחרי הגבלת קצב, וניסיון אוטומטי אחד כשהזמן עובר
  useEffect(() => {
    if (!st.quota) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [st.quota?.until]);
  useEffect(() => {
    const q = st.quota;
    if (q && q.kind === 'minute' && now >= q.until && autoRetried.current !== q.until && !st.busy) {
      autoRetried.current = q.until;
      void retryLast();
    }
  }, [now, st.quota?.until]);

  const grow = () => {
    const t = taRef.current;
    if (t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
  };
  const send = (override?: string) => {
    const msg = override ?? text;
    if (st.busy || fileBusy || (!msg.trim() && !files.length)) return;
    const fs = files;
    setText(''); setFiles([]);
    setTimeout(grow, 0);
    void sendMessage(msg, fs);
  };
  const onFiles = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])].slice(0, 3 - files.length);
    input.value = '';
    if (!picked.length) return;
    setFileBusy(true);
    try {
      const out = await Promise.all(picked.map((f) => fileToAttachment(f)));
      setFiles((p) => [...p, ...out].slice(0, 3));
    } catch (err) { toast((err as Error).message); }
    setFileBusy(false);
  };

  return (
    <FullScreen open={open}>
      <div class="hd" style={{ marginBottom: 8 }}>
        <div>
          <div class="t" style={{ fontSize: 30 }}>AI תזונה</div>
          <div class="s">ל{slotName} · {dayLabel(date, todayKey(settings.resetHour))}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {st.messages.length > 0 && <button class="g ib" aria-label="שיחה חדשה" onClick={() => { if (confirm('להתחיל שיחה חדשה? הכרטיסים שלא נוספו ליום יימחקו.')) resetChat(); }}><Trash /></button>}
          <button class="g ib" aria-label="סגור" onClick={() => setUi({ aiOpen: false })}><X /></button>
        </div>
      </div>
      <div class="chips">
        {settings.slots.map((sl) => <button class={'chip' + (sl.id === slot ? ' on' : '')} onClick={() => setUi({ addSlot: sl.id })}>{sl.name}</button>)}
      </div>

      <div class="fs-body chat" ref={bodyRef} style={{ paddingBottom: configured ? 210 : 40 }}>
        {!configured && <AiSetup />}
        {configured && st.messages.length === 0 && (
          <div class="aiempty">
            <div class="aiorb"><Sparkles /></div>
            <div style={{ fontSize: 18, fontWeight: 600, margin: '10px 0 4px' }}>המאמן האישי שלך</div>
            <div class="mu" style={{ lineHeight: 1.6 }}>מה אכלת, מה לאכול, ניתוח התקדמות, שאלות על מאסה ותוספים, ומסמכים רפואיים. אפשר לצלם, לצרף PDF ולחפש באינטרנט.</div>
            <div class="sugg">{SUGGEST.map((s) => <button class="chip" style={{ flex: 'none', whiteSpace: 'normal', height: 'auto', padding: '9px 14px', textAlign: 'right', borderRadius: 16 }} onClick={() => { setText(s); setTimeout(() => { grow(); taRef.current?.focus(); }, 0); }}>{s}</button>)}</div>
          </div>
        )}
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
              {m.meta && (
                <details class="mtr">
                  <summary class="mu num">{m.meta.model} · {(m.meta.ms / 1000).toFixed(1)}s{m.meta.calls && m.meta.calls > 1 ? ` · ${m.meta.calls} קריאות` : ''}{m.meta.thinking ? ` · think:${m.meta.thinking}` : ''}{m.meta.web ? ' · web' : ''}</summary>
                  {m.meta.trace?.length ? <pre>{m.meta.trace.join('\n')}</pre> : null}
                </details>
              )}
              {m.card === 'draft' && <MealCard m={m} slotName={slotName} onAdd={() => addCardToDay(m.id, date, slot, slotName)} />}
              {m.card === 'added' && (
                <div class="g mcard added">
                  <div class="addedrow"><span class="okc"><Check /></span><span>נוסף ל{m.addedLabel}</span><button class="undob" onClick={() => undoAdd(m.id)}><Undo2 /> בטל</button></div>
                  <div class="mu num" style={{ marginTop: 6 }}>{m.items?.map((i) => `${i.name} ${i.grams} ג׳`).join(' · ')}</div>
                </div>
              )}
              {m.card === 'old' && <div class="mu" style={{ fontSize: 12, margin: '4px 6px' }}>הכרטיס הוחלף בגרסה מעודכנת</div>}
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
          <div class="sugg row">{lastAi.suggestions.map((s) => <button class="chip" onClick={() => send(s)}>{s}</button>)}</div>
        ) : null}
        {st.error && st.quota && (
          <div class="aerr quota">
            <b>{st.error}</b>
            <div style={{ marginTop: 6, lineHeight: 1.6 }}>
              {st.quota.kind === 'day'
                ? `המכסה החינמית היומית נגמרה בכל המודלים הזמינים. היא מתאפסת בערך ב-${new Date(st.quota.until).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}.`
                : now < st.quota.until
                  ? `אפשר לנסות שוב בעוד ${Math.max(1, Math.ceil((st.quota.until - now) / 1000))} שניות. אנסה לבד כשהזמן יעבור.`
                  : 'הזמן עבר, מנסה שוב…'}
              {st.quota.limit ? <div class="mu" style={{ marginTop: 4 }}>המגבלה במסלול החינמי: {st.quota.limit} {st.quota.kind === 'day' ? 'ליום' : 'לדקה'} למודל</div> : null}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <button disabled={st.quota.kind === 'minute' && now < st.quota.until} onClick={() => void retryLast()}>נסה שוב</button>
              <a class="src" href="https://ai.dev/rate-limit" target="_blank" rel="noopener">בדוק שימוש ומכסות</a>
            </div>
            <div class="mu" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>אפשר גם לעבור למודל אחר בהגדרות ← AI תזונה, או להפעיל חיוב ב-AI Studio כדי להסיר את המגבלות החינמיות.</div>
            {st.detail && (
              <>
                <button class="adetb" onClick={() => setShowDet((v) => !v)}>{showDet ? 'הסתר פרטים טכניים' : 'פרטים טכניים'}</button>
                {showDet && <pre class="adet">{st.detail}</pre>}
              </>
            )}
          </div>
        )}
        {st.error && !st.quota && (
          <div class="aerr">
            <div>{st.error} <button onClick={() => void retryLast()}>נסה שוב</button></div>
            {st.detail && (
              <>
                <button class="adetb" onClick={() => setShowDet((v) => !v)}>{showDet ? 'הסתר פרטים טכניים' : 'פרטים טכניים'}</button>
                {showDet && (
                  <>
                    <pre class="adet">{st.detail}</pre>
                    <button class="adetb" onClick={async () => { try { await navigator.clipboard.writeText(st.detail ?? ''); } catch { /* ignore */ } }}>העתק</button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {configured && (
        <div class="g cmp">
          <div class="tgls">
            <button class={'tg' + (st.web ? ' on' : '')} onClick={() => setWeb(!st.web)}><Globe />אינטרנט</button>
            <button class={'tg' + (st.deep ? ' on' : '')} onClick={() => setDeep(!st.deep)}><Brain />חשיבה עמוקה</button>
          </div>
          {(files.length > 0 || fileBusy) && (
            <div class="cmpi">
              {files.map((f, idx) => (
                <span class={'thumb' + (f.url ? '' : ' pdf')} key={idx}>
                  {f.url ? <img src={f.url} /> : <span class="pdfn"><FileText />{f.name}</span>}
                  <button aria-label="הסר קובץ" onClick={() => setFiles((p) => p.filter((_, j) => j !== idx))}><X /></button>
                </span>
              ))}
              {fileBusy && <span class="thumb ld" />}
            </div>
          )}
          <div class="cmpr">
            <button class="cmpb" aria-label="צרף תמונה או PDF" disabled={files.length >= 3} onClick={() => fileRef.current?.click()}>{st.messages.length ? <Paperclip /> : <Camera />}</button>
            <textarea ref={taRef} rows={1} value={text}
              placeholder={st.deep ? 'שאלה שדורשת חשיבה…' : st.web ? 'שאל כל דבר (חיפוש באינטרנט פעיל)' : st.messages.length ? 'תקן אותי או שאל משהו…' : 'מה אכלת? או שאל כל דבר'}
              onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); grow(); }} />
            <button class="cmps" aria-label="שלח" disabled={st.busy || fileBusy || (!text.trim() && !files.length)} onClick={() => send()}><ArrowUp /></button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={onFiles} />
    </FullScreen>
  );
}
