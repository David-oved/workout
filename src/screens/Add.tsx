import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X, Plus, Minus, Sparkles, Camera, Paperclip, ArrowUp, ChevronDown, Star, Trash, Globe, Brain, ChevronRight } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { addDays, dayLabel, todayKey } from '../core/dates';
import { ui, setUi, toast } from '../ui/ui';
import { BigSheet, Sheet } from '../ui/components';
import { aiState } from '../ai/gemini';
import { fileToAttachment } from '../ai/image';
import { chat, draftOf, markAdded, removeItem, resetChat, sendMessage, setDeep, setGrams, setWeb, undoAdd, type Attachment } from '../ai/chat';
import { AiSetup } from './AiChat';
import { Messages } from './AiParts';
import { buildCandidates, candMacros, gapSuggestions, macrosOf, parseEntry, searchCandidates, topTiles, tray, trayAdd, trayClear, trayRemove, traySet, type Cand, type TItem } from '../ui/tray';

const Kcal = ({ m }: { m: { k: number } }) => <span class="num">{m.k}</span>;

export function AddScreen() {
  const open = ui.use((u) => u.addOpen);
  const slot = ui.use((u) => u.addSlot);
  const date = ui.use((u) => u.addDate);
  const addView = ui.use((u) => u.addView);
  const s = store.use((x) => x);
  const ch = chat.use((x) => x);
  const configured = aiState.use((x) => x.configured);
  const manual = tray.use((x) => x.items);

  const [q, setQ] = useState('');
  const [view, setView] = useState<'tiles' | 'chat'>('tiles');
  const [more, setMore] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const [sheet, setSheet] = useState<null | 'manual' | 'favs'>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [man, setMan] = useState({ name: '', k: '', p: '', c: '', f: '', fav: false });
  const [err, setErr] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    trayClear();
    setQ(''); setFiles([]); setOpenRow(null); setSlotOpen(false); setMore(false); setSheet(null); setErr('');
    setView(addView === 'chat' || draftOf(chat.get().messages) ? 'chat' : 'tiles');
  }, [open]);

  const today = todayKey(s.settings.resetHour);
  const slotName = s.settings.slots.find((x) => x.id === slot)?.name ?? 'ארוחה';
  const cands = useMemo(() => buildCandidates(slot), [s.entries, s.favorites, slot, open]);

  // המגש: פריטים ידניים + הארוחה שה-AI בנה
  const draft = draftOf(ch.messages);
  const aiItems: TItem[] = (draft?.items ?? []).map((it) => ({
    id: it.id, name: it.name, unit: 'g', amount: it.grams, step: 10, base: 100,
    per: { k: it.kcal100, p: it.p100, c: it.c100, f: it.f100 }, est: it.source !== 'label', src: 'ai', msgId: draft!.id, conf: it.confidence,
  }));
  const all = [...manual, ...aiItems];
  const tot = all.reduce((a, it) => { const m = macrosOf(it); return { k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { k: 0, p: 0, c: 0, f: 0 });

  const info = dayInfo(s, date);
  const remK = info.target.k - info.eaten.k - tot.k;
  const remP = Math.max(0, info.target.p - info.eaten.p - tot.p);
  const gap = gapSuggestions(cands, date, tot);
  const tiles = topTiles(cands, more ? 12 : 6);
  const results = view === 'tiles' ? searchCandidates(cands, q) : [];

  const addCand = (c: Cand) => trayAdd(c);
  const close = () => setUi({ addOpen: false });

  const submit = (override?: string) => {
    const t = (override ?? q).trim();
    if (!t && !files.length) return;
    setView('chat');
    if (!configured) return;
    const fs = files;
    setQ(''); setFiles([]);
    void sendMessage(t, fs);
    setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 80);
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
      setView('chat');
    } catch (er) { toast((er as Error).message); }
    setFileBusy(false);
  };

  useEffect(() => {
    if (view === 'chat') setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight }); }, 80);
  }, [ch.messages.length, view]);
  useEffect(() => {
    if (ch.busy && view === 'chat') { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight }); }
  }, [ch.messages[ch.messages.length - 1]?.text, ch.stage?.n]);

  const setAmt = (it: TItem, v: number) => (it.src === 'ai' ? setGrams(it.msgId!, it.id, v) : traySet(it.id, v));
  const rm = (it: TItem) => (it.src === 'ai' ? removeItem(it.msgId!, it.id) : trayRemove(it.id));

  const commit = () => {
    if (!all.length) return;
    const ids: string[] = [];
    for (const it of all) {
      const m = macrosOf(it);
      const nm = it.unit === 'g' ? `${it.name} · ${Math.round(it.amount)} ג׳` : it.amount !== 1 ? `${it.name} ×${it.amount}` : it.name;
      ids.push(actions.addEntry({ date, slot, name: nm, ...m, est: it.est }).id);
    }
    if (draft) markAdded(draft.id, ids, slotName);
    trayClear();
    close();
    toast(`נוסף ל${slotName}`, () => (draft ? undoAdd(draft.id) : actions.removeEntries(ids)));
  };

  const ydayEntries = s.entries.filter((e) => e.date === addDays(date, -1) && e.slot === slot);
  const copyYesterday = () => {
    for (const e of ydayEntries) {
      const p = parseEntry(e);
      trayAdd({ key: p.name, name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: e.est, w: 0 });
    }
    toast(`${ydayEntries.length} מנות מאתמול במגש`);
  };

  const submitManual = () => {
    const k = Number(man.k);
    if (!k) { setErr('הזן קלוריות'); return; }
    const name = man.name.trim() || 'הזנה ידנית';
    const per = { k, p: Number(man.p) || 0, c: Number(man.c) || 0, f: Number(man.f) || 0 };
    trayAdd({ key: name, name, unit: 'p', base: 1, per, amount: 1, w: 0 });
    if (man.fav && man.name.trim()) actions.toggleFavorite({ name, k, p: per.p, c: per.c, f: per.f });
    setMan({ name: '', k: '', p: '', c: '', f: '', fav: false });
    setErr('');
    setSheet(null);
  };

  const inTrayX = (c: Cand) => {
    const it = manual.find((i) => i.name === c.name);
    return it ? Math.round((it.amount / c.amount) * 10) / 10 : 0;
  };

  const showTray = all.length > 0;

  return (
    <BigSheet open={open} onClose={close}>
      <div class="as-top">
        <div>
          <div class="as-ti">מה אכלת?</div>
          <div class="as-su num">{dayLabel(date, today)} · נשארו {fmt(Math.max(0, remK))} קל׳ · {remP} גרם חלבון</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button class={'as-pill' + (slotOpen ? ' open' : '')} onClick={() => setSlotOpen((v) => !v)}>{slotName}<ChevronDown /></button>
          <button class="as-x" aria-label="סגור" onClick={close}><X /></button>
        </div>
      </div>
      {slotOpen && (
        <div class="chips as-slots">
          {s.settings.slots.map((sl) => <button class={'chip' + (sl.id === slot ? ' on' : '')} onClick={() => { setUi({ addSlot: sl.id }); setSlotOpen(false); }}>{sl.name}</button>)}
        </div>
      )}

      <div class="g as-in">
        <Sparkles />
        <input ref={inRef} value={q} placeholder={view === 'chat' ? (ch.messages.length ? 'תקן אותי או שאל משהו…' : 'ספר לי מה אכלת…') : 'תאר, צלם או חפש…'} autocomplete="off" enterkeyhint="send"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        <button class="ic" aria-label="צרף תמונה או PDF" disabled={files.length >= 3} onClick={() => fileRef.current?.click()}>{view === 'chat' ? <Paperclip /> : <Camera />}</button>
        {(q.trim() || files.length > 0) && <button class="ic go" aria-label="שלח ל-AI" onClick={() => submit()}><ArrowUp /></button>}
      </div>
      {(files.length > 0 || fileBusy) && (
        <div class="cmpi" style={{ paddingBottom: 10 }}>
          {files.map((f, idx) => (
            <span class={'thumb' + (f.url ? '' : ' pdf')} key={idx}>
              {f.url ? <img src={f.url} /> : <span class="pdfn">{f.name}</span>}
              <button aria-label="הסר קובץ" onClick={() => setFiles((p) => p.filter((_, j) => j !== idx))}><X /></button>
            </span>
          ))}
          {fileBusy && <span class="thumb ld" />}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={onFiles} />

      <div class="as-body" ref={bodyRef} style={{ paddingBottom: showTray ? 330 : 100 }}>
        {view === 'chat' ? (
          <>
            <div class="as-opts" style={{ justifyContent: 'space-between' }}>
              <button class="as-back" onClick={() => setView('tiles')}><ChevronRight size={16} />חזרה לאריחים</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button class={'tg' + (ch.web ? ' on' : '')} onClick={() => setWeb(!ch.web)}><Globe />אינטרנט</button>
                <button class={'tg' + (ch.deep ? ' on' : '')} onClick={() => setDeep(!ch.deep)}><Brain />עמוק</button>
                {ch.messages.length > 0 && <button class="tg" aria-label="שיחה חדשה" onClick={() => { if (confirm('להתחיל שיחה חדשה?')) resetChat(); }}><Trash /></button>}
              </div>
            </div>
            {!configured && <AiSetup />}
            {configured && ch.messages.length === 0 && (
              <div class="aiempty" style={{ paddingTop: 8 }}>
                <div class="aiorb"><Sparkles /></div>
                <div style={{ fontSize: 18, fontWeight: 600, margin: '10px 0 4px' }}>ספר לי מה אכלת</div>
                <div class="mu" style={{ lineHeight: 1.6 }}>בחופשיות, כמו לחבר. אפשר גם לצלם צלחת או תווית, ולשאול כל דבר על תזונה ומאסה.</div>
                <div class="sugg">
                  {['חצי פיתה עם שניצל ושתי כפות חומוס', 'כמה חלבון נשאר לי ומה כדאי לאכול עכשיו?', 'למה אני לא עולה מספיק במשקל?'].map((t) => (
                    <button class="chip" style={{ flex: 'none', whiteSpace: 'normal', height: 'auto', padding: '9px 14px', textAlign: 'right', borderRadius: 16 }} onClick={() => submit(t)}>{t}</button>
                  ))}
                </div>
              </div>
            )}
            <Messages onSuggest={(t) => submit(t)} />
          </>
        ) : q.trim() ? (
          <div class="as-res">
            <button class="as-row ai" onClick={() => submit()}>
              <Sparkles />
              <div><b>שאל את ה-AI: ״{q.trim()}״</b><small>הוא יבין כמויות וירכיב לך ארוחה</small></div>
              <ChevronRight size={18} style={{ transform: 'scaleX(-1)' }} />
            </button>
            {results.map((c) => {
              const m = candMacros(c);
              return (
                <button class="as-row" key={c.key} onClick={() => { addCand(c); setQ(''); }}>
                  <div><b>{c.name}</b><small class="num">{c.unit === 'g' ? `${c.amount} ג׳` : 'מנה'} · {m.k} קל׳ · {m.p} ח׳</small></div>
                  <Plus />
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {gap.list.length > 0 && (
              <>
                <div class="as-lbl"><span>חסר לך היום, לחיצה אחת סוגרת</span></div>
                <div class="as-gap">
                  {gap.list.map((c) => <button class="as-gc" key={c.key} onClick={() => addCand(c)}><Plus />{c.name} · +{candMacros(c).p} ח׳</button>)}
                </div>
              </>
            )}
            <div class="as-lbl"><span>הרגילים שלך</span><span>לפי {slotName}</span></div>
            <div class="as-grid">
              {tiles.map((c) => {
                const n = inTrayX(c);
                const m = candMacros(c);
                return (
                  <button class={'as-tile' + (n ? ' on' : '')} key={c.key} onClick={() => addCand(c)}>
                    <span class="bd num">×{n}</span>
                    <b>{c.name}</b>
                    <small class="num">{c.unit === 'g' ? `${c.amount} ג׳ · ` : ''}{m.k} קל׳</small>
                  </button>
                );
              })}
            </div>
            <div class="as-more">
              <button onClick={() => setMore((v) => !v)}>{more ? 'פחות' : 'עוד'}</button>
              <button onClick={() => setSheet('favs')}>מועדפים</button>
              <button disabled={!ydayEntries.length} onClick={copyYesterday}>אתמול</button>
              <button onClick={() => setSheet('manual')}>ידני</button>
            </div>
          </>
        )}
      </div>

      {showTray && (
        <div class="g as-tray">
          <div class="as-tr">
            {all.map((it) => {
              const m = macrosOf(it);
              const isG = it.unit === 'g';
              return (
                <div class="as-it" key={it.id}>
                  <div class="as-ih">
                    <button class="nm" onClick={() => setOpenRow(openRow === it.id ? null : it.id)}>{it.name}{it.src === 'ai' && it.est ? <i class="etag" style={{ marginRight: 6 }}>הערכה</i> : null}</button>
                    <span class="as-st">
                      <button aria-label="הפחת" onClick={() => setAmt(it, it.amount - it.step)}><Minus /></button>
                      <span class="num">{isG ? `${Math.round(it.amount)} ג׳` : `×${it.amount}`}</span>
                      <button aria-label="הוסף" onClick={() => setAmt(it, it.amount + it.step)}><Plus /></button>
                    </span>
                    <span class="as-ik num"><Kcal m={m} /></span>
                    <button class="as-rm" aria-label="הסר" onClick={() => rm(it)}><X /></button>
                  </div>
                  {openRow === it.id && (
                    <div class="as-sl">
                      <input type="range" style={{ accentColor: '#5CE1A8' }} min={isG ? 5 : 0.5} max={isG ? Math.max(600, Math.round(it.amount * 1.5)) : Math.max(6, it.amount * 2)} step={isG ? 5 : 0.5} value={it.amount}
                        onInput={(e) => setAmt(it, Number((e.target as HTMLInputElement).value))} />
                      <button class="as-rm" aria-label="מועדף" onClick={() => { actions.toggleFavorite({ name: isG ? `${it.name} · ${Math.round(it.amount)} ג׳` : it.name, k: m.k, p: m.p, c: m.c, f: m.f, est: it.est }); toast('נשמר במועדפים'); }}><Star /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div class="as-tot">
            <b class="num">{fmt(tot.k)} קל׳</b>
            <span class="num"><span class="m1">{tot.p} ח׳</span> · <span class="m2">{tot.c} פ׳</span> · <span class="m3">{tot.f} ש׳</span></span>
          </div>
          <button class="as-cta" onClick={commit}>הוסף ל{slotName}</button>
        </div>
      )}

      <Sheet open={sheet === 'favs'} onClose={() => setSheet(null)}>
        <h3>מועדפים</h3>
        {s.favorites.length === 0 ? <div class="mu" style={{ padding: '14px 0' }}>עוד אין מועדפים. בעריכת פריט במגש לוחצים על הכוכב כדי לשמור.</div> : (
          <div class="as-res" style={{ marginTop: 10 }}>
            {s.favorites.map((f) => {
              const p = parseEntry({ name: f.name, k: f.k, p: f.p, c: f.c, f: f.f });
              return (
                <div class="as-row" key={f.id}>
                  <button style={{ flex: 1, textAlign: 'right' }} onClick={() => { trayAdd({ key: p.name, name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: f.est, w: 0 }); setSheet(null); }}>
                    <b>{f.name}</b><small class="num" style={{ display: 'block' }}>{f.k} קל׳ · {f.p} ח׳</small>
                  </button>
                  <button class="star on" aria-label="הסר" onClick={() => actions.toggleFavorite(f)}><Star fill="currentColor" /></button>
                </div>
              );
            })}
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'manual'} onClose={() => setSheet(null)}>
        <h3>הזנה ידנית</h3>
        <div class="field" style={{ marginTop: 12 }}>
          <div class="full"><label class="lbl">שם (אופציונלי)</label><input class="inp" value={man.name} placeholder="למשל חטיף" onInput={(e) => setMan({ ...man, name: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">קלוריות</label><input class="inp num" inputMode="numeric" value={man.k} onInput={(e) => setMan({ ...man, k: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">חלבון (ג׳)</label><input class="inp num" inputMode="numeric" value={man.p} onInput={(e) => setMan({ ...man, p: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">פחמימה (ג׳)</label><input class="inp num" inputMode="numeric" value={man.c} onInput={(e) => setMan({ ...man, c: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">שומן (ג׳)</label><input class="inp num" inputMode="numeric" value={man.f} onInput={(e) => setMan({ ...man, f: (e.target as HTMLInputElement).value })} /></div>
          <div class="err">{err}</div>
          <button class="full" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--mu)', fontSize: 14 }} onClick={() => setMan({ ...man, fav: !man.fav })}>
            <span class={'tgl' + (man.fav ? ' on' : '')} style={{ width: 44, height: 26 }} />שמור למועדפים
          </button>
          <button class="btn primary block full" onClick={submitManual}>הוסף למגש</button>
        </div>
      </Sheet>
    </BigSheet>
  );
}
