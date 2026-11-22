import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X, Plus, Minus, Sparkles, Camera, Paperclip, ArrowUp, ChevronDown, Star, Trash, Globe, Brain, ChevronRight, Pencil, Info } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { addDays, dayLabel, todayKey, uid } from '../core/dates';
import { autoMealName, partLabel, sumMacros } from '../core/meal';
import { ui, setUi, toast } from '../ui/ui';
import { BigSheet, Sheet } from '../ui/components';
import { aiState } from '../ai/gemini';
import { fileToAttachment } from '../ai/image';
import { chat, draftOf, markAdded, removeItem, resetChat, sendMessage, setDeep, setGrams, setPer, setWeb, undoAdd, type Attachment } from '../ai/chat';
import { AiSetup } from './AiChat';
import { Messages } from './AiParts';
import { buildCandidates, candMacros, gapSuggestions, macrosOf, makeEntries, parseEntry, searchCandidates, stepFor, topTiles, tray, trayAdd, trayAddFood, trayClear, trayPer, trayPerByFood, trayRemove, traySet, traySetName, traySetOne, type Cand, type TItem } from '../ui/tray';
import { dbState, getFood, loadDb, searchFoods, type FoodRec } from '../data/foodDb';
import { AmtInput, FoodRow } from './FoodPicker';
import { PotSheet } from './Pot';

const Kcal = ({ m }: { m: { k: number } }) => <span class="num">{m.k}</span>;

export function AddScreen() {
  const open = ui.use((u) => u.addOpen);
  const slot = ui.use((u) => u.addSlot);
  const date = ui.use((u) => u.addDate);
  const addView = ui.use((u) => u.addView);
  const s = store.use((x) => x);
  const ch = chat.use((x) => x);
  const configured = aiState.use((x) => x.configured);
  const trayS = tray.use((x) => x);
  const manual = trayS.items;
  const dbReady = dbState.use((x) => x.ready);

  const [q, setQ] = useState('');
  const [view, setView] = useState<'tiles' | 'chat'>('tiles');
  const [more, setMore] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const [sheet, setSheet] = useState<null | 'manual' | 'favs' | 'pot' | 'food'>(null);
  const [editItem, setEditItem] = useState<TItem | null>(null);
  const [fv, setFv] = useState({ k: '', p: '', c: '', f: '' });
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [man, setMan] = useState({ name: '', k: '', p: '', c: '', f: '', fav: false, per100: false });
  const [err, setErr] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    trayClear();
    void loadDb();
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
  const dbRes: FoodRec[] = useMemo(() => {
    if (view !== 'tiles' || !q.trim() || !dbReady) return [];
    const seen = new Set(results.map((c) => c.name));
    return searchFoods(q, s, 10).filter((f) => !seen.has(f.name)).slice(0, 8);
  }, [q, dbReady, view, s.foodEdits, s.customFoods, s.entries]);

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
    const drafts = makeEntries(all, store.get(), trayS.one, trayS.name);
    for (const d of drafts) ids.push(actions.addEntry({ date, slot, name: d.name, k: d.k, p: d.p, c: d.c, f: d.f, est: d.est, parts: d.parts, dishId: d.dishId }).id);
    // אכילה מסיר מורידה מה שנשאר בו (והביטול מחזיר)
    const used = new Map<string, number>();
    for (const it of all) if (it.foodId?.startsWith('d:')) used.set(it.foodId.slice(2), (used.get(it.foodId.slice(2)) ?? 0) + it.amount);
    const undoDish: Array<() => void> = [];
    for (const [did, g] of used) {
      const d = store.get().dishes.find((x) => x.id === did);
      if (!d) continue;
      const before = { remainG: d.remainG, last: d.last };
      actions.patchDish(did, { remainG: Math.max(0, (d.remainG ?? d.cookedG) - g), last: Date.now() });
      undoDish.push(() => actions.patchDish(did, before));
    }
    if (draft) markAdded(draft.id, ids, slotName);
    trayClear();
    close();
    toast(`נוסף ל${slotName}`, () => { undoDish.forEach((f) => f()); if (draft) undoAdd(draft.id); else actions.removeEntries(ids); });
  };

  const ydayEntries = s.entries.filter((e) => e.date === addDays(date, -1) && e.slot === slot);
  const copyYesterday = () => {
    for (const e of ydayEntries) {
      if (e.parts?.length) { trayAdd({ key: e.name, name: e.name, unit: 'p', base: 1, per: { k: e.k, p: e.p, c: e.c, f: e.f }, amount: 1, est: e.est, w: 0, parts: e.parts }); continue; }
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
    const unit = man.per100 ? 'g' : 'p';
    let foodId: string | undefined;
    if (man.fav && man.name.trim()) {
      const cid = uid();
      actions.saveCustomFood({ id: cid, name, unit, per });
      foodId = 'c:' + cid;
    }
    trayAdd({ key: name, name, unit, base: man.per100 ? 100 : 1, per, amount: man.per100 ? 100 : 1, w: 0, foodId });
    setMan({ name: '', k: '', p: '', c: '', f: '', fav: false, per100: false });
    setErr('');
    setSheet(null);
  };

  const openFood = (it: TItem) => {
    setEditItem(it);
    setFv({ k: String(Math.round(it.per.k * 10) / 10), p: String(Math.round(it.per.p * 10) / 10), c: String(Math.round(it.per.c * 10) / 10), f: String(Math.round(it.per.f * 10) / 10) });
    setSheet('food');
  };
  const saveFood = () => {
    const it = editItem;
    if (!it) return;
    const per = { k: Number(fv.k) || 0, p: Number(fv.p) || 0, c: Number(fv.c) || 0, f: Number(fv.f) || 0 };
    if (it.src === 'ai') setPer(it.msgId!, it.id, per);
    else if (it.foodId?.startsWith('c:')) {
      const cf = store.get().customFoods.find((x) => 'c:' + x.id === it.foodId);
      if (cf) actions.saveCustomFood({ ...cf, per });
      trayPerByFood(it.foodId, per);
    } else if (it.foodId && !it.foodId.startsWith('d:')) {
      actions.setFoodEdit(it.foodId, per);
      trayPerByFood(it.foodId, per);
    } else trayPer(it.id, per);
    setSheet(null);
    toast(it.foodId && !it.foodId.startsWith('d:') ? 'הערכים עודכנו לכל הפעמים' : 'הערכים עודכנו');
  };
  const resetFood = () => {
    const it = editItem;
    if (!it?.foodId) return;
    actions.setFoodEdit(it.foodId, null);
    const rec = getFood(it.foodId, store.get());
    if (rec) trayPerByFood(it.foodId, rec.per);
    setSheet(null);
    toast('חזר לערך המקורי');
  };
  const pickFood = (f: FoodRec) => {
    trayAddFood(f);
    setQ('');
    const last = tray.get().items.find((i) => i.foodId === f.id);
    if (last) setOpenRow(last.id);
  };
  const favCand = (f: (typeof s.favorites)[number]): Cand => {
    if (f.parts?.length) return { key: 'meal:' + f.name, name: f.name, unit: 'p', base: 1, per: { k: f.k, p: f.p, c: f.c, f: f.f }, amount: 1, est: f.est, w: 0, parts: f.parts };
    const p = parseEntry({ name: f.name, k: f.k, p: f.p, c: f.c, f: f.f });
    return { key: p.name, name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: f.est, w: 0 };
  };
  const inTrayX = (c: Cand) => {
    if (c.parts) return 0;
    const it = manual.find((i) => (c.foodId ? i.foodId === c.foodId : i.name === c.name));
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

      <div class="as-body" ref={bodyRef} style={{ paddingBottom: showTray ? 460 : 100 }}>
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
                  <div><b>{c.name}</b><small class="num">{c.note ? `${c.note} · ` : ''}{c.unit === 'g' ? `${c.amount} ג׳` : 'מנה'} · {m.k} קל׳ · {m.p} ח׳</small></div>
                  <Plus />
                </button>
              );
            })}
            {dbRes.length > 0 && <div class="as-lbl" style={{ marginTop: 6 }}><span>מהמאגר (משרד הבריאות)</span></div>}
            {dbRes.map((f) => <FoodRow key={f.id} f={f} onPick={() => pickFood(f)} />)}
            {!dbReady && q.trim() && <div class="mu" style={{ padding: 8, fontSize: 13 }}>טוען את מאגר המזון…</div>}
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
                    <small class="num">{c.note ?? (c.unit === 'g' ? `${c.amount} ג׳ · ${m.k} קל׳` : `${m.k} קל׳`)}{c.note ? ` · ${m.k} קל׳` : ''}</small>
                  </button>
                );
              })}
            </div>
            <div class="as-more">
              <button onClick={() => setMore((v) => !v)}>{more ? 'פחות' : 'עוד'}</button>
              <button onClick={() => setSheet('favs')}>מועדפים</button>
              <button disabled={!ydayEntries.length} onClick={copyYesterday}>אתמול</button>
              <button onClick={() => setSheet('pot')}>סיר</button>
              <button onClick={() => setSheet('manual')}>ידני</button>
            </div>
          </>
        )}
      </div>

      {showTray && (
        <div class="g as-tray">
          {all.length >= 2 && (
            <div class="as-mh">
              {trayS.one ? (
                <input class="as-mn" value={trayS.name} placeholder={autoMealName(all)} aria-label="שם הארוחה" onInput={(e) => traySetName((e.target as HTMLInputElement).value)} />
              ) : <span class="as-mn mu">כל פריט יירשם בנפרד</span>}
              <span class="as-seg">
                <button class={trayS.one ? 'on' : ''} onClick={() => traySetOne(true)}>ארוחה אחת</button>
                <button class={!trayS.one ? 'on' : ''} onClick={() => traySetOne(false)}>נפרדים</button>
              </span>
              {trayS.one && (
                <button class="as-rm" aria-label="שמור ארוחה למועדפים" onClick={() => {
                  const nm = trayS.name.trim() || autoMealName(all);
                  const ps = makeEntries(all, store.get(), true, nm)[0];
                  actions.toggleFavorite({ name: nm, k: ps.k, p: ps.p, c: ps.c, f: ps.f, est: ps.est, parts: ps.parts });
                  toast('הארוחה נשמרה במועדפים');
                }}><Star /></button>
              )}
            </div>
          )}
          <div class="as-tr">
            {all.map((it) => {
              const m = macrosOf(it);
              const isG = it.unit === 'g';
              const rec = it.foodId && !it.foodId.startsWith('d:') ? getFood(it.foodId, s) : undefined;
              const isDish = !!it.foodId?.startsWith('d:');
              const st = stepFor(it);
              return (
                <div class="as-it" key={it.id}>
                  <div class="as-ih">
                    <button class="nm" onClick={() => setOpenRow(openRow === it.id ? null : it.id)}>{it.name}{it.src === 'ai' && it.est ? <i class="etag" style={{ marginRight: 6 }}>הערכה</i> : null}</button>
                    <span class="as-st">
                      <button aria-label="הפחת" onClick={() => setAmt(it, it.amount - st)}><Minus /></button>
                      <span class="num">{isG ? `${Math.round(it.amount)} ג׳` : `×${it.amount}`}</span>
                      <button aria-label="הוסף" onClick={() => setAmt(it, it.amount + st)}><Plus /></button>
                    </span>
                    <span class="as-ik num"><Kcal m={m} /></span>
                    <button class="as-rm" aria-label="הסר" onClick={() => rm(it)}><X /></button>
                  </div>
                  {openRow === it.id && (
                    <div class="as-det">
                      <div class="as-amt">
                        <AmtInput wide value={it.amount} onChange={(n) => setAmt(it, n)} suffix={isG ? 'גרם' : 'מנות'} />
                        <span class="as-mac num"><i class="m1">{m.p} ח׳</i><i class="m2">{m.c} פ׳</i><i class="m3">{m.f} ש׳</i></span>
                      </div>
                      {isG && (it.portions?.length ?? 0) > 0 && (
                        <div class="as-pc">
                          {it.portions!.map((pt) => <button class="chip" onClick={() => setAmt(it, it.amount + pt.g)}>+ {pt.l} · {pt.g} ג׳</button>)}
                        </div>
                      )}
                      <input type="range" style={{ accentColor: '#5CE1A8', width: '100%' }} min={isG ? 5 : 0.5} max={isG ? Math.max(600, Math.round(it.amount * 1.5)) : Math.max(6, it.amount * 2)} step={isG ? 5 : 0.5} value={it.amount}
                        onInput={(e) => setAmt(it, Number((e.target as HTMLInputElement).value))} />
                      <div class="as-acts">
                        {!isDish && <button onClick={() => openFood(it)}><Pencil />ערוך ערכים</button>}
                        <button onClick={() => { actions.toggleFavorite({ name: isG ? `${it.name} · ${Math.round(it.amount)} ג׳` : it.name, k: m.k, p: m.p, c: m.c, f: m.f, est: it.est }); toast('נשמר במועדפים'); }}><Star />למועדפים</button>
                      </div>
                      {rec?.full && <div class="as-src"><Info />{rec.full}{rec.src === 'il' ? ' · מאגר משרד הבריאות' : ''}{rec.edited ? ' · ערכים מתוקנים על ידך' : ''}</div>}
                      {isDish && <div class="as-src"><Info />סיר שלך: הערכים לפי המצרכים והמשקל אחרי הבישול</div>}
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
        {s.favorites.length === 0 ? <div class="mu" style={{ padding: '14px 0' }}>עוד אין מועדפים. בעריכת פריט או ארוחה במגש לוחצים על הכוכב כדי לשמור.</div> : (
          <div class="as-res" style={{ marginTop: 10 }}>
            {s.favorites.map((f) => (
              <div class="as-row" key={f.id}>
                <button style={{ flex: 1, textAlign: 'right' }} onClick={() => { trayAdd(favCand(f)); setSheet(null); }}>
                  <b>{f.name}</b><small class="num" style={{ display: 'block' }}>{f.parts?.length ? `${f.parts.length} רכיבים · ` : ''}{f.k} קל׳ · {f.p} ח׳</small>
                </button>
                <button class="star on" aria-label="הסר" onClick={() => actions.toggleFavorite(f)}><Star fill="currentColor" /></button>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'manual'} onClose={() => setSheet(null)}>
        <h3>הזנה ידנית</h3>
        <div class="field" style={{ marginTop: 12 }}>
          <div class="full"><label class="lbl">שם (אופציונלי)</label><input class="inp" value={man.name} placeholder="למשל חטיף" onInput={(e) => setMan({ ...man, name: (e.target as HTMLInputElement).value })} /></div>
          <div class="full chips" style={{ margin: 0 }}>
            <button class={'chip' + (!man.per100 ? ' on' : '')} onClick={() => setMan({ ...man, per100: false })}>הערכים למנה אחת</button>
            <button class={'chip' + (man.per100 ? ' on' : '')} onClick={() => setMan({ ...man, per100: true })}>הערכים ל-100 גרם</button>
          </div>
          <div><label class="lbl">קלוריות</label><input class="inp num" inputMode="decimal" value={man.k} onInput={(e) => setMan({ ...man, k: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">חלבון (ג׳)</label><input class="inp num" inputMode="decimal" value={man.p} onInput={(e) => setMan({ ...man, p: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">פחמימה (ג׳)</label><input class="inp num" inputMode="decimal" value={man.c} onInput={(e) => setMan({ ...man, c: (e.target as HTMLInputElement).value })} /></div>
          <div><label class="lbl">שומן (ג׳)</label><input class="inp num" inputMode="decimal" value={man.f} onInput={(e) => setMan({ ...man, f: (e.target as HTMLInputElement).value })} /></div>
          <div class="err">{err}</div>
          <button class="full" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--mu)', fontSize: 14 }} onClick={() => setMan({ ...man, fav: !man.fav })}>
            <span class={'tgl' + (man.fav ? ' on' : '')} style={{ width: 44, height: 26 }} />שמור במאגר שלי (יופיע בחיפוש)
          </button>
          <button class="btn primary block full" onClick={submitManual}>הוסף למגש</button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'food'} onClose={() => setSheet(null)}>
        <h3>ערכי תזונה</h3>
        {editItem && (
          <>
            <div class="mu" style={{ fontSize: 13, lineHeight: 1.5, margin: '2px 0 4px' }}>
              {editItem.name} · הערכים {editItem.unit === 'g' ? 'ל-100 גרם' : 'למנה אחת'}.{' '}
              {editItem.foodId && !editItem.foodId.startsWith('d:') ? 'התיקון נשמר ויחול על כל הפעמים הבאות.' : 'התיקון חל על הפריט הזה.'}
            </div>
            {editItem.foodId && !editItem.foodId.startsWith('d:') && getFood(editItem.foodId, s)?.full && (
              <div class="as-src" style={{ margin: '0 0 6px' }}><Info />{getFood(editItem.foodId, s)!.full}</div>
            )}
            <div class="field" style={{ marginTop: 8 }}>
              <div><label class="lbl">קלוריות</label><input class="inp num" inputMode="decimal" value={fv.k} onInput={(e) => setFv({ ...fv, k: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">חלבון (ג׳)</label><input class="inp num" inputMode="decimal" value={fv.p} onInput={(e) => setFv({ ...fv, p: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">פחמימה (ג׳)</label><input class="inp num" inputMode="decimal" value={fv.c} onInput={(e) => setFv({ ...fv, c: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">שומן (ג׳)</label><input class="inp num" inputMode="decimal" value={fv.f} onInput={(e) => setFv({ ...fv, f: (e.target as HTMLInputElement).value })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button class="btn primary" style={{ flex: 1 }} onClick={saveFood}>שמור</button>
              {editItem.foodId && s.foodEdits[editItem.foodId] && <button class="btn" onClick={resetFood}>חזרה למקור</button>}
            </div>
          </>
        )}
      </Sheet>

      <PotSheet open={sheet === 'pot'} onClose={() => setSheet(null)} />
    </BigSheet>
  );
}
