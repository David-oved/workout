import { useEffect, useRef, useState } from 'preact/hooks';
import { Camera, ArrowUp, Trash, X, Sparkles, Plus, Minus, Check, Undo2 } from 'lucide-preact';
import { store } from '../core/state';
import { dayLabel, todayKey } from '../core/dates';
import { ui, setUi } from '../ui/ui';
import { FullScreen } from '../ui/components';
import { aiState, saveAiKey } from '../ai/gemini';
import { fileToJpeg } from '../ai/image';
import { itemMacros } from '../ai/pure';
import { addCardToDay, cardTotals, chat, removeItem, resetChat, retryLast, sendMessage, setGrams, undoAdd, type Msg } from '../ai/chat';

const SUGGEST = [
  'אכלתי חצי פיתה עם שניצל ושתי כפות חומוס',
  'שלוש ביצים מקושקשות ושתי פרוסות לחם עם גבינה',
  'כמה חלבון נשאר לי היום ומה כדאי לאכול עכשיו?',
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
      <div class="note" style={{ margin: '10px 0 0' }}>הטקסט והתמונות שאתה שולח נשלחים ל-Google כדי לקבל תשובה. ההערכות מקורבות, ותמונה של תווית תזונה מדויקת יותר מצילום של צלחת.</div>
    </div>
  );
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
  const [imgs, setImgs] = useState<{ url: string; data: string; mime: string }[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [showDet, setShowDet] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slotName = settings.slots.find((x) => x.id === slot)?.name ?? 'ארוחה';

  useEffect(() => {
    if (open) setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 60);
  }, [st.messages.length, st.busy, st.error, open]);

  const grow = () => {
    const t = taRef.current;
    if (t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
  };
  const send = () => {
    if (st.busy || imgBusy || (!text.trim() && !imgs.length)) return;
    const t = text, im = imgs;
    setText(''); setImgs([]);
    setTimeout(grow, 0);
    void sendMessage(t, im);
  };
  const onFiles = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])].slice(0, 3 - imgs.length);
    input.value = '';
    if (!files.length) return;
    setImgBusy(true);
    try {
      const out = await Promise.all(files.map((f) => fileToJpeg(f)));
      setImgs((p) => [...p, ...out].slice(0, 3));
    } catch { /* ignore */ }
    setImgBusy(false);
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

      <div class="fs-body chat" ref={bodyRef} style={{ paddingBottom: configured ? 170 : 40 }}>
        {!configured && <AiSetup />}
        {configured && st.messages.length === 0 && (
          <div class="aiempty">
            <div class="aiorb"><Sparkles /></div>
            <div style={{ fontSize: 18, fontWeight: 600, margin: '10px 0 4px' }}>מה אכלת?</div>
            <div class="mu" style={{ lineHeight: 1.6 }}>תאר במילים, צלם את הצלחת או את התווית. נבין ביחד כמה זה, ותוכל לתקן אותי בכל שלב.</div>
            <div class="sugg">{SUGGEST.map((s) => <button class="chip" style={{ flex: 'none', whiteSpace: 'normal', height: 'auto', padding: '9px 14px', textAlign: 'right', borderRadius: 16 }} onClick={() => { setText(s); setTimeout(() => { grow(); taRef.current?.focus(); }, 0); }}>{s}</button>)}</div>
          </div>
        )}
        {st.messages.map((m) => (
          <div class={'msg ' + (m.role === 'user' ? 'u' : 'a')} key={m.id}>
            <div class="mcol">
              {m.streaming && !m.text && <div class="mb typing"><i /><i /><i /></div>}
              {(m.text || m.images?.length) && (
                <div class="mb">
                  {m.images?.length ? <div class="mimgs">{m.images.map((u) => <img src={u} />)}</div> : null}
                  {m.text}
                </div>
              )}
              {m.meta && <div class="mu num" style={{ fontSize: 11, margin: '0 6px', direction: 'ltr' }}>{m.meta.model} · {(m.meta.ms / 1000).toFixed(1)}s</div>}
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
        {st.error && (
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
          {(imgs.length > 0 || imgBusy) && (
            <div class="cmpi">
              {imgs.map((i, idx) => (
                <span class="thumb" key={idx}><img src={i.url} /><button aria-label="הסר תמונה" onClick={() => setImgs((p) => p.filter((_, j) => j !== idx))}><X /></button></span>
              ))}
              {imgBusy && <span class="thumb ld" />}
            </div>
          )}
          <div class="cmpr">
            <button class="cmpb" aria-label="צרף תמונה" disabled={imgs.length >= 3} onClick={() => fileRef.current?.click()}><Camera /></button>
            <textarea ref={taRef} rows={1} value={text} placeholder={st.messages.length ? 'תקן אותי או הוסף פרטים…' : 'מה אכלת?'}
              onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); grow(); }} />
            <button class="cmps" aria-label="שלח" disabled={st.busy || imgBusy || (!text.trim() && !imgs.length)} onClick={send}><ArrowUp /></button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />
    </FullScreen>
  );
}
