import { useEffect, useState } from 'preact/hooks';
import { Mic, X, Check, RefreshCw, Clock, Inbox, Camera } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { todayKey } from '../core/dates';
import { ui, setUi } from '../ui/ui';
import { BigSheet } from '../ui/components';
import { chatInbox, dateOfItem, editInbox, logAllInbox, logInbox, retryInbox, slotOf } from '../siri/prepare';
import type { InboxItem } from '../core/types';

/**
 * ארוחות שנשלחו מהקיצור (טקסט או תמונה) ומחכות לאישור. הכרטיס מוכן, ורק מאשרים או עורכים.
 * הארוחה נרשמת לפי השעה שבה נשלחה, לא לפי השעה שבה מאשרים.
 */
function useNow(active: boolean) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setN(Date.now());
    const t = setInterval(() => setN(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return n;
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const inLine = (list: InboxItem[]) => list.filter((i) => i.status !== 'ready' && i.status !== 'fail').sort((a, b) => a.ts - b.ts);

function Status({ it, items }: { it: InboxItem; items: InboxItem[] }) {
  const wait = it.status === 'queued' && !!it.retryAt;
  const now = useNow(wait);
  const pos = inLine(items).findIndex((x) => x.id === it.id) + 1;
  if (it.status === 'queued') {
    const sec = it.retryAt ? Math.max(0, Math.ceil((it.retryAt - now) / 1000)) : 0;
    return (
      <div class="sr-busy">
        <Clock />
        <span>
          {it.retryAt
            ? `${it.srv ? 'השרת' : 'האפליקציה'} ינסה שוב ${sec > 0 ? `בעוד ${sec} שנ׳` : 'עכשיו'}${it.tries ? ` · ניסיון ${it.tries + 1}` : ''}`
            : it.srv ? `בתור לניתוח בשרת${pos > 1 ? ` · מקום ${pos}` : ''}` : `בתור${pos > 1 ? ` · מקום ${pos}` : ''}`}
          {it.failWhy && it.retryAt ? <small class="mu" style={{ display: 'block' }}>{it.failWhy.slice(0, 70)}</small> : null}
        </span>
      </div>
    );
  }
  return <div class="sr-busy"><RefreshCw class="spin" />מכין את הכרטיס…</div>;
}

export function InboxItemCard({ it, items, full }: { it: InboxItem; items: InboxItem[]; full?: boolean }) {
  const card = it.card;
  const slots = store.use((s) => s.settings.slots);
  const reset = store.use((s) => s.settings.resetHour);
  const slot = slotOf(it);
  const slotName = slots.find((x) => x.id === slot)?.name ?? 'ארוחה';
  const yday = dateOfItem(it) !== todayKey(reset);
  return (
    <div class="g siric col">
      <div class="sr-h">
        {it.thumb ? <img class="sr-th" src={it.thumb} alt="" /> : <Mic />}
        <b>{it.hasImg ? 'תמונה' : 'הודעה'} · {hhmm(it.ts)}{yday ? ' · אתמול' : ''}</b>
        {it.text && <span class="sr-q">״{it.text}״</span>}
        <button class="x" aria-label="הסר" onClick={() => actions.dismissInbox(it.id)}><X /></button>
      </div>
      {(it.status === 'queued' || it.status === 'busy' || !it.status) && <Status it={it} items={items} />}
      {it.status === 'ready' && card && (
        <>
          <div class="sr-l">
            {(full ? card.lines : card.lines.slice(0, 4)).map((l, i) => <div key={i}><span>{l.name}<small>{l.label}</small></span><b class="num">{l.k}</b></div>)}
            {!full && card.lines.length > 4 && <div class="mu"><span>ועוד {card.lines.length - 4}</span></div>}
          </div>
          <div class="sr-t num"><b>{card.k}</b> קל׳ · <b>{card.p}</b> ג׳ חלבון<i>{card.src === 'ai' ? 'AI' : 'מהמאגר'}</i></div>
          <div class="sr-slots" role="group" aria-label="לאיזו ארוחה">
            {slots.map((s) => <button key={s.id} class={'chip' + (s.id === slot ? ' on' : '')} onClick={() => actions.patchInbox(it.id, { slot: s.id })}>{s.name}</button>)}
          </div>
          <div class="sr-a">
            <button class="btn primary sm" onClick={() => logInbox(it)}><Check />הוסף ל{slotName}</button>
            <button class="btn sm" onClick={() => { setUi({ inboxOpen: false }); editInbox(it); }}>ערוך</button>
          </div>
        </>
      )}
      {it.status === 'fail' && (
        <>
          <div class="mu" style={{ fontSize: 13, lineHeight: 1.5 }}>{it.failWhy ?? 'לא הצלחתי להבין לבד, אפשר לפתוח בהוספה.'}</div>
          <div class="sr-a">
            <button class="btn primary sm" onClick={() => retryInbox(it)}><RefreshCw />נסה שוב</button>
            {it.hasImg
              ? <button class="btn sm" onClick={() => { setUi({ inboxOpen: false }); void chatInbox(it); }}>דבר על זה בצ׳אט</button>
              : <button class="btn sm" onClick={() => { setUi({ inboxOpen: false }); editInbox(it); }}>פתח בהוספה</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** במסך היום: ארוחה אחת = הכרטיס המלא. כמה ארוחות = שורה מסכמת עם "הוסף הכל" ופתיחת הרשימה */
export function InboxStrip() {
  const items = store.use((s) => s.inbox);
  if (!items.length) return null;
  const list = [...items].sort((a, b) => a.ts - b.ts);
  if (list.length === 1) return <InboxItemCard it={list[0]} items={list} />;
  const ready = list.filter((i) => i.status === 'ready').length;
  const fail = list.filter((i) => i.status === 'fail').length;
  const wait = list.length - ready - fail;
  const bits = [ready ? `${ready} מוכנות` : '', wait ? `${wait} בדרך` : '', fail ? `${fail} דורשות טיפול` : ''].filter(Boolean).join(' · ');
  return (
    <div class="g siric col isum">
      <div class="sr-h">
        <Inbox />
        <b>{list.length} ארוחות מחכות</b>
        <span class="sr-q">{bits}</span>
      </div>
      <div class="is-th">
        {list.slice(0, 8).map((i) => (i.thumb ? <img key={i.id} src={i.thumb} alt="" /> : <span key={i.id} class="is-tx"><Mic /></span>))}
      </div>
      <div class="sr-a">
        <button class="btn primary sm" disabled={!ready} onClick={() => logAllInbox()}><Check />הוסף {ready > 1 ? `את ${ready} המוכנות` : 'את המוכנה'}</button>
        <button class="btn sm" onClick={() => setUi({ inboxOpen: true })}>סקירה</button>
      </div>
    </div>
  );
}

/** הרשימה המלאה: כל הארוחות לפי סדר ההגעה, עם בחירת ארוחה לכל אחת והוספה של הכל */
export function InboxSheet() {
  const open = ui.use((u) => u.inboxOpen);
  const items = store.use((s) => s.inbox);
  const list = [...items].sort((a, b) => a.ts - b.ts);
  const ready = list.filter((i) => i.status === 'ready').length;
  useEffect(() => { if (open && !list.length) setUi({ inboxOpen: false }); }, [open, list.length]);
  const close = () => setUi({ inboxOpen: false });
  return (
    <BigSheet open={open} onClose={close}>
      <div class="as-top ctop">
        <div class="ct-t" style={{ textAlign: 'right' }}>
          <b>ארוחות שמחכות</b>
          <small class="num">{list.length} · {ready} מוכנות</small>
        </div>
        <button class="as-x" aria-label="סגור" onClick={close}><X /></button>
      </div>
      <div class="as-body inbox-list">
        {list.map((it) => <InboxItemCard key={it.id} it={it} items={list} full />)}
        {!list.length && <div class="mu" style={{ padding: 20, textAlign: 'center' }}>אין ארוחות שמחכות</div>}
      </div>
      {ready > 0 && (
        <div class="inbox-foot">
          <button class="btn primary block" onClick={() => logAllInbox()}><Camera style={{ display: 'none' }} /><Check />הוסף את כל המוכנות ({ready})</button>
        </div>
      )}
    </BigSheet>
  );
}
