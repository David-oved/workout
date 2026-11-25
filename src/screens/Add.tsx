import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ScanLine, Check, HelpCircle, X, Plus, Minus, Sparkles, Camera, Paperclip, ArrowUp, ChevronDown, Star, Globe, Brain, ChevronRight, Pencil, Info, MessageSquarePlus, Utensils, History, PencilLine, Square } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { dayInfo, fmt } from '../core/calc';
import { addDays, dayLabel, todayKey, uid } from '../core/dates';
import { autoMealName, dishPer100, label, partMacros } from '../core/meal';
import { ui, setUi, toast } from '../ui/ui';
import { BigSheet, Sheet } from '../ui/components';
import { aiState } from '../ai/gemini';
import { fileToAttachment } from '../ai/image';
import { chat, stopChat, draftOf, markAdded, pendingProducts, removeItem, resetChat, restoreChat, sendMessage, setDeep, setGrams, setPer, setWeb, undoAdd, type Attachment } from '../ai/chat';
import { AiSetup } from './AiChat';
import { Messages } from './AiParts';
import { buildCandidates, candMacros, defaultPortion, gapSuggestions, macrosOf, makeEntries, parseEntry, searchCandidates, stepFor, topTiles, tray, trayAdd, trayAddDish, trayAddFood, trayClear, trayPer, trayPerByFood, trayRemove, traySet, traySetName, traySetOne, type Cand, type TItem } from '../ui/tray';
import { dbState, getFood, loadDb, searchFoods, type FoodRec } from '../data/foodDb';
import { AmtInput, FoodPicker, FoodRow } from './FoodPicker';
import { PotSheet } from './Pot';
import { openCamera } from '../ui/camera';
import { ProductCard } from './ProductCard';
import { parseMeal, parseNewProduct, type Parsed } from '../core/parse';

const Kcal = ({ m }: { m: { k: number } }) => <span class="num">{m.k}</span>;
type Tab = 'meal' | 'food' | 'pot' | 'fav';
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'meal', label: 'ארוחות', hint: 'לחיצה מוסיפה את כל הרכיבים שלה' },
  { id: 'food', label: 'מצרכים', hint: 'לחיצה מוסיפה מצרך אחד, ואז קובעים גרמים' },
  { id: 'pot', label: 'סירים', hint: 'מה שבישלת, אוכלים ממנו בגרמים' },
  { id: 'fav', label: 'מועדפים', hint: 'מה ששמרת בכוכב' },
];

export function AddScreen() {
  const open = ui.use((u) => u.addOpen);
  const slot = ui.use((u) => u.addSlot);
  const date = ui.use((u) => u.addDate);
  const addView = ui.use((u) => u.addView);
  const s = store.useWhen((x) => x, open);
  const ch = chat.use((x) => x);
  const configured = aiState.use((x) => x.configured);
  const trayS = tray.use((x) => x);
  const manual = trayS.items;
  const dbReady = dbState.use((x) => x.ready);

  const [q, setQ] = useState('');
  const [view, setView] = useState<'tiles' | 'chat'>('tiles');
  const [tab, setTab] = useState<Tab>('meal');
  const [more, setMore] = useState(false);
  const [editTiles, setEditTiles] = useState(false);
  const [trayOpen, setTrayOpen] = useState(true);
  const [slotOpen, setSlotOpen] = useState(false);
  const [sheet, setSheet] = useState<null | 'manual' | 'pot' | 'potnew' | 'food' | 'addtile'>(null);
  const [editItem, setEditItem] = useState<TItem | null>(null);
  const [fv, setFv] = useState({ k: '', p: '', c: '', f: '' });
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [man, setMan] = useState({ name: '', k: '', p: '', c: '', f: '', fav: false, per100: false });
  const [err, setErr] = useState('');
  const [alt, setAlt] = useState<Record<number, number>>({});
  const [altOpen, setAltOpen] = useState<Record<number, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [propMsg, setPropMsg] = useState<string | null>(null);
  const inRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    trayClear();
    void loadDb();
    setPropMsg(null); setQ(''); setAlt({}); setFiles([]); setOpenRow(null); setSlotOpen(false); setMore(false); setSheet(null); setErr(''); setEditTiles(false); setTrayOpen(true);
    const toChat = addView === 'chat' || !!draftOf(chat.get().messages);
    setView(toChat ? 'chat' : 'tiles');
    setTrayOpen(!toChat);
    // טקסט שהגיע מ-Siri: ה-AI מנתח אותו מיד, ובלי AI הוא נכנס לחיפוש החכם
    const trItems = ui.get().addTray;
    if (trItems?.length) { tray.set((s) => ({ ...s, items: trItems })); setUi({ addTray: null }); }
    const pre = ui.get().addText;
    if (pre) {
      setUi({ addText: null });
      setTimeout(() => { if (configured) submit(pre); else { goTiles(); setQ(pre); } }, 350);
    }
  }, [open]);

  const today = todayKey(s.settings.resetHour);
  const slotName = s.settings.slots.find((x) => x.id === slot)?.name ?? 'ארוחה';
  const cands = useMemo(() => buildCandidates(slot), [s.entries, s.favorites, s.dishes, s.hiddenTiles, s.foodEdits, slot, open, dbReady]);

  // המגש: פריטים ידניים + הארוחה שה-AI בנה
  const draft = draftOf(ch.messages);
  // ה-AI מציע לאיזו ארוחה הכרטיס שייך. מיישמים פעם אחת לכל כרטיס, ולא דורסים בחירה ידנית שלך
  const aiSlot = useRef<{ id?: string; slot?: string }>({});
  useEffect(() => {
    if (!draft?.slot || aiSlot.current.id === draft.id) return;
    const valid = store.get().settings.slots.some((x) => x.id === draft.slot);
    const cur = ui.get().addSlot;
    // מיישמים כשזו הצעה ראשונה, או כשה-AI שינה את הארוחה (המוצרים השתנו או ביקשת). אותה הצעה שוב לא דורסת בחירה ידנית
    if (valid && (aiSlot.current.slot === undefined || draft.slot !== aiSlot.current.slot) && cur !== draft.slot) setUi({ addSlot: draft.slot });
    aiSlot.current = { id: draft.id, slot: valid ? draft.slot : aiSlot.current.slot ?? cur };
  }, [draft?.id]);
  const aiItems: TItem[] = (draft?.items ?? []).map((it) => ({
    id: it.id, name: it.name, unit: 'g', amount: it.grams, step: 10, base: 100,
    per: { k: it.kcal100, p: it.p100, c: it.c100, f: it.f100 }, est: it.source === 'estimate', src: 'ai', msgId: draft!.id, conf: it.confidence,
    unitG: it.unitGrams, portions: it.unitGrams ? [{ l: 'יחידה', g: it.unitGrams }] : undefined,
  }));
  const all = [...manual, ...aiItems];
  const tot = all.reduce((a, it) => { const m = macrosOf(it); return { k: a.k + m.k, p: a.p + m.p, c: a.c + m.c, f: a.f + m.f }; }, { k: 0, p: 0, c: 0, f: 0 });

  const info = dayInfo(s, date);
  const remK = info.target.k - info.eaten.k - tot.k;
  const remP = Math.max(0, info.target.p - info.eaten.p - tot.p);
  const gap = gapSuggestions(cands, date, tot);
  const tabCands = cands.filter((c) => (tab === 'fav' ? c.fav : c.kind === tab));
  const tiles = topTiles(tabCands, more ? 18 : 9);
  const results = view === 'tiles' ? searchCandidates(cands, q) : [];
  const dbRes: FoodRec[] = useMemo(() => {
    if (view !== 'tiles' || !q.trim() || !dbReady) return [];
    const seen = new Set(results.map((c) => c.name));
    return searchFoods(q, s, 10).filter((f) => !seen.has(f.name)).slice(0, 8);
  }, [q, dbReady, view, s.foodEdits, s.customFoods, s.entries]);

  const parsed: Parsed[] = useMemo(() => (view === 'tiles' && q.trim() && dbReady ? parseMeal(q, s) : []), [q, dbReady, view, s.dishes, s.foodEdits, s.customFoods, s.entries]);
  const np = useMemo(() => (view === 'tiles' ? parseNewProduct(q) : null), [q, view]);
  useEffect(() => { setAlt({}); setAltOpen({}); }, [q]);
  const showPreview = !np && parsed.some((x) => x.food || x.dish) && (parsed.length >= 2 || parsed[0].qty);
  const addParsed = () => {
    parsed.forEach((p, i) => {
      if (p.dish) { trayAddDish(p.dish, p.amount); return; }
      const L = [p.food, ...p.alts].filter(Boolean) as FoodRec[];
      const f = L[alt[i] ?? 0];
      if (f) trayAddFood(f, p.amount);
    });
    setQ('');
  };
  const saveNp = () => {
    if (!np) return;
    const cid = uid();
    actions.saveCustomFood({ id: cid, name: np.name, unit: np.unit, per: np.per });
    trayAdd({ key: 'c:' + cid, kind: 'food', name: np.name, unit: np.unit, base: np.unit === 'g' ? 100 : 1, per: np.per, amount: np.unit === 'g' ? np.grams : 1, w: 0, foodId: 'c:' + cid });
    setQ('');
    toast(`${np.name} נשמר במאגר שלך`);
  };
  const addCand = (c: Cand) => trayAdd(c);
  const close = () => setUi({ addOpen: false });
  const goChat = () => { setView('chat'); setTrayOpen(false); };
  const goTiles = () => { setView('tiles'); setTrayOpen(true); };
  const scrollTop = () => { const b = bodyRef.current; if (b) b.scrollTo({ top: 0, behavior: 'smooth' }); };

  const submit = (override?: string) => {
    const t = (override ?? q).trim();
    if (!t && !files.length) return;
    goChat();
    // אחרי שליחה המקלדת נסגרת, כדי לראות את התשובה
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (taRef.current) taRef.current.style.height = 'auto';
    if (!configured) return;
    const fs = files;
    setQ(''); setFiles([]);
    void sendMessage(t, fs);
    setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); }, 80);
  };
  const sendProduct = async (picked: File[]) => {
    if (!picked.length) return;
    setFileBusy(true);
    try {
      const out = await Promise.all(picked.slice(0, 2).map((f) => fileToAttachment(f)));
      goChat();
      void sendMessage('', out, { product: true });
    } catch (er) { toast((er as Error).message); }
    setFileBusy(false);
  };
  const addChatFiles = async (picked: File[]) => {
    const take = picked.slice(0, 3 - files.length);
    if (!take.length) return;
    setFileBusy(true);
    try {
      const out = await Promise.all(take.map((f) => fileToAttachment(f)));
      setFiles((p) => [...p, ...out].slice(0, 3));
      goChat();
    } catch (er) { toast((er as Error).message); }
    setFileBusy(false);
  };
  const onFiles = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    void addChatFiles(picked);
  };

  /** שיחה חדשה / מחיקת השיחה: מיידי, ואפשר לבטל */
  const newChat = () => {
    const snap = chat.get().messages;
    if (!snap.length) { goChat(); setTimeout(() => taRef.current?.focus(), 160); return; }
    resetChat();
    setQ(''); setFiles([]);
    goChat();
    toast('השיחה נמחקה', () => restoreChat(snap));
    setTimeout(() => taRef.current?.focus(), 160);
  };

  useEffect(() => {
    if (view === 'chat') setTimeout(() => { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight }); }, 80);
  }, [ch.messages.length, view]);
  useEffect(() => {
    if (ch.busy && view === 'chat') { const b = bodyRef.current; if (b) b.scrollTo({ top: b.scrollHeight }); }
  }, [ch.messages[ch.messages.length - 1]?.text, ch.stage?.n]);

  const setAmt = (it: TItem, v: number) => (it.src === 'ai' ? setGrams(it.msgId!, it.id, v) : traySet(it.id, v));
  const rm = (it: TItem) => (it.src === 'ai' ? removeItem(it.msgId!, it.id) : trayRemove(it.id));
  const clearAll = () => { trayClear(); aiItems.forEach((it) => removeItem(it.msgId!, it.id)); };
  const addMore = () => { goTiles(); setQ(''); scrollTop(); setTimeout(() => inRef.current?.focus(), 150); };

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
    // ה-AI הציע מוצרים חדשים? מציגים אותם לאישור אחרי שהארוחה כבר נוספה
    if (draft && pendingProducts(draft).length) {
      setPropMsg(draft.id);
      toast(`נוסף ל${slotName}`, () => { undoDish.forEach((f) => f()); undoAdd(draft.id); });
      return;
    }
    close();
    toast(`נוסף ל${slotName}`, () => { undoDish.forEach((f) => f()); if (draft) undoAdd(draft.id); else actions.removeEntries(ids); });
  };

  const ydayEntries = s.entries.filter((e) => e.date === addDays(date, -1) && e.slot === slot);
  const copyYesterday = () => {
    for (const e of ydayEntries) {
      if (e.parts?.length) { trayAdd({ key: e.name, kind: 'meal', name: e.name, unit: 'p', base: 1, per: { k: e.k, p: e.p, c: e.c, f: e.f }, amount: 1, est: e.est, w: 0, parts: e.parts }); continue; }
      const p = parseEntry(e);
      trayAdd({ key: p.name, kind: 'food', name: p.name, unit: p.unit, base: p.base, per: p.per, amount: p.amount, est: e.est, w: 0 });
    }
    toast(`${ydayEntries.length} מנות מאתמול נוספו לארוחה שלך`);
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
    trayAdd({ key: name, kind: 'food', name, unit, base: man.per100 ? 100 : 1, per, amount: man.per100 ? 100 : 1, w: 0, foodId });
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

  /** שומר מצרך מהמאגר כאריח קבוע (מועדף) עם מנה טיפוסית */
  const pinFood = (f: FoodRec) => {
    const g = f.unit === 'g' ? defaultPortion(f.portions) : 1;
    const m = partMacros({ amount: g, base: f.base, per: f.per });
    const name = f.unit === 'g' ? `${f.name} · ${g} ג׳` : f.name;
    if (s.favorites.some((x) => x.foodId === f.id || x.name === name)) { toast('האריח כבר קיים'); return; }
    actions.toggleFavorite({ name, k: m.k, p: m.p, c: m.c, f: m.f, est: f.est, foodId: f.id });
    setSheet(null);
    setTab('food');
    toast(`${f.name} נוסף לאריחים`);
  };
  const removeTile = (c: Cand) => {
    const fav = s.favorites.find((x) => (x.parts?.length ? 'meal:' + x.name : x.foodId ?? parseEntry(x).name) === c.key);
    if (tab === 'fav' && fav) { actions.toggleFavorite(fav); toast('הוסר מהמועדפים', () => actions.toggleFavorite(fav)); return; }
    actions.hideTile(c.key);
    toast('האריח הוסתר', () => actions.unhideTile(c.key));
  };
  const inTrayX = (c: Cand) => {
    if (c.parts) return 0;
    const it = manual.find((i) => (c.foodId ? i.foodId === c.foodId : i.name === c.name));
    return it ? Math.round((it.amount / c.amount) * 10) / 10 : 0;
  };
  const lastUser = [...ch.messages].reverse().find((m) => m.role === 'user')?.text ?? '';

  const propM = propMsg ? ch.messages.find((m) => m.id === propMsg) : undefined;
  const propPending = pendingProducts(propM);
  useEffect(() => { if (propMsg && !propPending.length) { setPropMsg(null); close(); } }, [propMsg, propPending.length]);
  const showTray = all.length > 0;
  const tabInfo = TABS.find((t) => t.id === tab)!;

  const filesStrip = (files.length > 0 || fileBusy) ? (
    <div class="cmpi" style={{ paddingBottom: 10 }}>
      {files.map((f, idx) => (
        <span class={'thumb' + (f.url ? '' : ' pdf')} key={idx}>
          {f.url ? <img src={f.url} /> : <span class="pdfn">{f.name}</span>}
          <button aria-label="הסר קובץ" onClick={() => setFiles((p) => p.filter((_, j) => j !== idx))}><X /></button>
        </span>
      ))}
      {fileBusy && <span class="thumb ld" />}
    </div>
  ) : null;

  /** תצוגת החיפוש: כמו שהייתה (עם האפשרות לשאול את ה-AI מהחיפוש) */
  const searchBar = (
    <div class="g as-in">
      <Sparkles />
      <input ref={inRef} value={q} placeholder="ספר ל-AI מה אכלת, או חפש מזון…" autocomplete="off" enterkeyhint="send"
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      <button class="ic" aria-label="צרף תמונה או PDF" disabled={files.length >= 3} onClick={() => openCamera((f) => void addChatFiles(f))}><Camera /></button>
      {(q.trim() || files.length > 0) && <button class="ic go" aria-label="שלח ל-AI" onClick={() => submit()}><ArrowUp /></button>}
    </div>
  );

  /** שורת ההקלדה של השיחה: למטה, כמו בצ'אט רגיל */
  const composer = (
    <div class="comp">
      {filesStrip}
      <div class="comp-opts">
        <button class={'tg' + (ch.web ? ' on' : '')} onClick={() => setWeb(!ch.web)}><Globe />אינטרנט</button>
        <button class={'tg' + (ch.deep ? ' on' : '')} onClick={() => setDeep(!ch.deep)}><Brain />עמוק</button>
      </div>
      <div class="g comp-in">
        <button class="ic" aria-label="צרף תמונה או PDF" disabled={files.length >= 3} onClick={() => fileRef.current?.click()}><Paperclip /></button>
        <textarea ref={taRef} rows={1} value={q} placeholder={ch.messages.length ? 'תקן אותי או שאל משהו…' : 'ספר לי מה אכלת…'} enterkeyhint="send"
          onInput={(e) => { const el = e.target as HTMLTextAreaElement; setQ(el.value); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
          onFocus={() => setTrayOpen(false)}
          onBlur={() => setTimeout(() => window.scrollTo(0, 0), 60)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        {ch.busy
          ? <button class="ic go on stopb" aria-label="עצור" onClick={stopChat}><Square /></button>
          : <button class={'ic go' + (q.trim() || files.length > 0 ? ' on' : '')} aria-label="שלח" disabled={!q.trim() && files.length === 0} onClick={() => submit()}><ArrowUp /></button>}
      </div>
    </div>
  );

  return (
    <BigSheet open={open} onClose={close}>
      {view === 'chat' ? (
        <div class="as-top ctop">
          <button class="ct-back" aria-label="חזרה לחיפוש" onClick={goTiles}><ChevronRight /></button>
          <div class="ct-t">
            <b>שיחה עם AI</b>
            <small class="num">{date !== today ? `${dayLabel(date, today)} · ` : ''}נשארו {fmt(Math.max(0, remK))} קל׳ · {remP} ח׳</small>
          </div>
          <button class="ct-back" aria-label="שיחה חדשה" onClick={newChat}><MessageSquarePlus /></button>
          <button class={'as-pill' + (slotOpen ? ' open' : '')} onClick={() => setSlotOpen((v) => !v)}>{slotName}<ChevronDown /></button>
          <button class="as-x" aria-label="סגור" onClick={close}><X /></button>
        </div>
      ) : (
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
      )}
      {slotOpen && (
        <div class="chips as-slots">
          {s.settings.slots.map((sl) => <button class={'chip' + (sl.id === slot ? ' on' : '')} onClick={() => { setUi({ addSlot: sl.id }); setSlotOpen(false); }}>{sl.name}</button>)}
        </div>
      )}
      {view !== 'chat' && searchBar}
      {view !== 'chat' && filesStrip}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={onFiles} />

      <div class={'as-body' + (view === 'chat' ? ' chat' : '')} ref={bodyRef} style={{ paddingBottom: view === 'chat' ? 8 : showTray ? (trayOpen ? 430 : 190) : 100 }}>
        {view === 'chat' ? (
          <>
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
            <Messages onSuggest={(t) => submit(t)} onFill={(t) => {
              setQ(t);
              setTimeout(() => { const el = taRef.current; if (el) { el.focus(); el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; el.setSelectionRange(t.length, t.length); } }, 80);
            }} />
          </>
        ) : q.trim() ? (
          <div class="as-res">
            {np && (
              <div class="g as-np">
                <div class="lb"><Plus />מוצר חדש · הערכים {np.unit === 'g' ? `ל-${Math.round(np.grams)} גרם` : 'למנה אחת'}</div>
                <b>{np.name}</b>
                <div class="num vals"><span>{Math.round(np.unit === 'g' ? np.per.k * np.grams / 100 : np.per.k)} קל׳</span><span class="m1">{Math.round((np.unit === 'g' ? np.per.p * np.grams / 100 : np.per.p) * 10) / 10} ח׳</span><span class="m2">{Math.round((np.unit === 'g' ? np.per.c * np.grams / 100 : np.per.c) * 10) / 10} פ׳</span><span class="m3">{Math.round((np.unit === 'g' ? np.per.f * np.grams / 100 : np.per.f) * 10) / 10} ש׳</span></div>
                <button class="as-cta sm" onClick={saveNp}>שמור במאגר שלי והוסף לארוחה</button>
              </div>
            )}
            {showPreview && (
              <div class="g as-pv">
                <div class="lb">הבנתי, אפשר לתקן לפני ההוספה</div>
                {parsed.map((p, i) => {
                  const L = p.dish ? [] : [p.food, ...p.alts].filter(Boolean) as FoodRec[];
                  const cur = L[alt[i] ?? 0];
                  const g = p.amount;
                  const per = p.dish ? dishPer100(p.dish) : cur?.per;
                  const k = per ? Math.round(p.dish || cur?.unit === 'g' ? (per.k * g) / 100 : per.k * g) : 0;
                  if (!p.dish && !cur) {
                    return (
                      <div class="pv-r miss" key={i}>
                        <HelpCircle />
                        <div class="n"><b>״{p.name}״ לא במאגר</b>
                          <span class="pv-acts">
                            <button onClick={() => { setMan({ ...man, name: p.name }); setSheet('manual'); }}>הוסף כמוצר חדש</button>
                            {configured && <button onClick={() => submit(p.raw)}>שאל AI</button>}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div class="pv-r" key={i}>
                      <Check />
                      <div class="n">
                        <b>{p.dish ? p.dish.name : cur!.name}</b>
                        <small class="num">{p.note ? `${p.note} = ` : ''}{p.unit === 'g' || p.dish ? `${g} ג׳` : `×${g}`}</small>
                        {L.length > 1 && (altOpen[i]
                          ? <span class="pv-alt">{L.map((f, j) => j !== (alt[i] ?? 0) && <button key={f.id} onClick={() => { setAlt({ ...alt, [i]: j }); setAltOpen({ ...altOpen, [i]: false }); }}>{f.name}</button>)}</span>
                          : <button class="pv-sw" onClick={() => setAltOpen({ ...altOpen, [i]: true })}>לא זה? החלף</button>)}
                      </div>
                      <span class="k num">{k}</span>
                    </div>
                  );
                })}
                {parsed.some((p) => p.food || p.dish) && <button class="as-cta sm" onClick={addParsed}>הוסף {parsed.filter((p) => p.food || p.dish).length} לארוחה</button>}
              </div>
            )}
            {!np && <button class="as-row ai" onClick={() => submit()}>
              <Sparkles />
              <div><b>שאל את ה-AI: ״{q.trim()}״</b><small>הוא יבין כמויות וירכיב לך ארוחה</small></div>
              <ChevronRight size={18} style={{ transform: 'scaleX(-1)' }} />
            </button>}
            {!showPreview && !np && (<>
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
            </>)}
            {!dbReady && q.trim() && <div class="mu" style={{ padding: 8, fontSize: 13 }}>טוען את מאגר המזון…</div>}
          </div>
        ) : (
          <>
            {ch.messages.length > 0 && (
              <div class="g as-live">
                <Sparkles />
                <button class="lv" onClick={() => goChat()}>
                  <b>שיחה פעילה עם ה-AI</b>
                  <small>{lastUser.slice(0, 40) || `${ch.messages.length} הודעות`}</small>
                </button>
                <button class="lb" onClick={() => goChat()}>המשך</button>
                <button class="lb" onClick={newChat}>חדשה</button>
              </div>
            )}
            {gap.list.length > 0 && (
              <div class="as-gapc">
                <span>חסרים לך עוד {Math.round(remP)} ג׳ חלבון</span>
                <div class="as-gap">
                  {gap.list.map((c) => <button class="as-gc" key={c.key} onClick={() => addCand(c)}><Plus />{label(c.name)} · +{candMacros(c).p} ח׳</button>)}
                </div>
              </div>
            )}

            <div class="as-tabs" role="tablist">
              {TABS.map((t) => <button role="tab" class={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setMore(false); }}>{t.label}</button>)}
            </div>
            <div class="as-lbl">
              <span>{tabInfo.hint}</span>
              {tab !== 'pot' && <button class={'as-ed' + (editTiles ? ' on' : '')} onClick={() => setEditTiles((v) => !v)}><PencilLine />{editTiles ? 'סיימתי' : 'ערוך אריחים'}</button>}
            </div>

            {tab === 'pot' ? (
              <div class="as-res">
                {s.dishes.length === 0 && <div class="as-emp">עוד לא שמרת סיר. בישלת משהו? הכנס מצרכים ומשקל וקבל ערכים מדויקים.</div>}
                {s.dishes.map((d) => {
                  const p = dishPer100(d);
                  return (
                    <button class="as-row" key={d.id} onClick={() => { trayAddDish(d); const it = tray.get().items.find((i) => i.foodId === 'd:' + d.id); if (it) setOpenRow(it.id); }}>
                      <div><b>{d.name}</b><small class="num">{Math.round(p.k)} קל׳ ל-100 ג׳{d.remainG != null ? ` · נשארו ${Math.round(d.remainG)} ג׳` : ''}</small></div>
                      <span class="pot-eat"><Utensils />אכלתי</span>
                    </button>
                  );
                })}
                <div class="as-act2">
                  <button onClick={() => setSheet('potnew')}><Plus />סיר חדש</button>
                  {s.dishes.length > 0 && <button onClick={() => setSheet('pot')}><Pencil />עריכה ומחיקה</button>}
                </div>
              </div>
            ) : (
              <>
                {tiles.length === 0 && <div class="as-emp">{tab === 'fav' ? 'אין מועדפים. לחץ על ⭐ בארוחה או במצרך כדי לשמור אותם כאן.' : 'אין אריחים להצגה.'}</div>}
                <div class="as-hd"><span /><span>קל׳</span><span>ח׳</span><span /></div>
                <div class="g as-dl">
                  {tiles.map((c) => {
                    const n = inTrayX(c);
                    const m = candMacros(c);
                    return (
                      <button class={'as-lr' + (n ? ' on' : '') + (editTiles ? ' ed' : '')} key={c.key} onClick={() => (editTiles ? removeTile(c) : addCand(c))}>
                        <span class="nm"><b>{c.name}</b><small class="num">{c.note ?? (c.unit === 'g' ? `${c.amount} ג׳` : 'מנה')}</small></span>
                        <span class="k num">{m.k}</span>
                        <span class="pp num">{m.p}</span>
                        {editTiles ? <span class="xx" aria-hidden="true"><X /></span> : <span class="plus" aria-hidden="true">{n ? <i class="num">×{n}</i> : <Plus />}</span>}
                      </button>
                    );
                  })}
                  {editTiles && tab === 'food' && (
                    <button class="as-lr add" onClick={() => setSheet('addtile')}><Plus />הוסף מצרך לרשימה</button>
                  )}
                </div>
                {editTiles && <div class="mu" style={{ fontSize: 12, margin: '8px 4px 0', lineHeight: 1.5 }}>לחיצה על אריח מסתירה אותו.{tab === 'meal' ? ' כדי להוסיף ארוחה: בנה אותה ולחץ על ⭐.' : ''}{s.hiddenTiles.length > 0 && <> <button class="lnk" onClick={() => s.hiddenTiles.forEach((k) => actions.unhideTile(k))}>החזר {s.hiddenTiles.length} אריחים מוסתרים</button></>}</div>}
                {tabCands.length > 9 && !editTiles && <button class="as-mr" onClick={() => setMore((v) => !v)}>{more ? 'הצג פחות' : 'הצג עוד'}</button>}
              </>
            )}

            <div class="as-more">
              <button disabled={!ydayEntries.length} onClick={copyYesterday}><History />כמו אתמול</button>
              <button onClick={() => setSheet('manual')}><PencilLine />הזנה ידנית</button>
              <button onClick={() => openCamera((f) => void sendProduct(f))}><ScanLine />צלם מוצר</button>
            </div>
          </>
        )}
      </div>

      {showTray && (
        <div class={'g as-tray' + (view === 'chat' ? ' dock' : '')}>
          <button class="as-th" onClick={() => setTrayOpen((v) => !v)}>
            <b>הארוחה שלך</b>
            <span class="num">{all.length} {all.length === 1 ? 'רכיב' : 'רכיבים'} · {fmt(tot.k)} קל׳ · {tot.p} ח׳</span>
            <ChevronDown class={trayOpen ? '' : 'flip'} />
          </button>
          {trayOpen && (
            <>
              {all.length >= 2 && trayS.one && (
                <input class="as-mn" value={trayS.name} placeholder={`שם: ${autoMealName(all)}`} aria-label="שם הארוחה" onInput={(e) => traySetName((e.target as HTMLInputElement).value)} />
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
                        <button class="nm" onClick={() => setOpenRow(openRow === it.id ? null : it.id)}>{it.name}{it.unitG && isG ? <small class="ug num">{Math.round(it.amount)} ג׳</small> : null}{it.src === 'ai' && it.est ? <i class="etag" style={{ marginRight: 6 }}>הערכה</i> : null}</button>
                        <span class="as-st">
                          <button aria-label="הפחת" onClick={() => setAmt(it, it.amount - st)}><Minus /></button>
                          <span class="num">{isG && it.unitG ? `×${Math.round((it.amount / it.unitG) * 10) / 10}` : isG ? `${Math.round(it.amount)} ג׳` : `×${it.amount}`}</span>
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
                            <button onClick={() => { actions.toggleFavorite({ name: isG ? `${it.name} · ${Math.round(it.amount)} ג׳` : it.name, k: m.k, p: m.p, c: m.c, f: m.f, est: it.est, foodId: it.foodId && !it.foodId.startsWith('d:') ? it.foodId : undefined }); toast('נשמר במועדפים'); }}><Star />למועדפים</button>
                          </div>
                          {rec?.full && <div class="as-src"><Info />{rec.full}{rec.src === 'il' ? ' · מאגר משרד הבריאות' : ''}{rec.edited ? ' · ערכים מתוקנים על ידך' : ''}</div>}
                          {isDish && <div class="as-src"><Info />סיר שלך: הערכים לפי המצרכים והמשקל אחרי הבישול</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div class="as-ta">
                <button onClick={addMore}><Plus />הוסף רכיב</button>
                {all.length >= 2 && trayS.one && (
                  <button aria-label="שמור את הארוחה למועדפים" onClick={() => {
                    const nm = trayS.name.trim() || autoMealName(all);
                    const ps = makeEntries(all, store.get(), true, nm)[0];
                    actions.toggleFavorite({ name: nm, k: ps.k, p: ps.p, c: ps.c, f: ps.f, est: ps.est, parts: ps.parts });
                    toast('הארוחה נשמרה במועדפים');
                  }}><Star />שמור ארוחה</button>
                )}
                {all.length >= 2 && <button onClick={() => traySetOne(!trayS.one)}>{trayS.one ? 'פצל לפריטים' : 'אחד לארוחה'}</button>}
                <button onClick={clearAll}>נקה</button>
              </div>
            </>
          )}
          <div class="as-tot">
            <b class="num">{fmt(tot.k)} קל׳</b>
            <span class="num"><span class="m1">{tot.p} ח׳</span> · <span class="m2">{tot.c} פ׳</span> · <span class="m3">{tot.f} ש׳</span></span>
          </div>
          <button class="as-cta" onClick={commit}>
            {view !== 'chat' && all.length >= 2 && trayS.one ? `הוסף ל${slotName} כארוחה אחת` : `הוסף ל${slotName}`}
          </button>
        </div>
      )}

      {view === 'chat' && composer}

      <Sheet open={!!propMsg && propPending.length > 0} onClose={() => { setPropMsg(null); close(); }}>
        <h3>שמירת מוצר חדש</h3>
        <div class="mu" style={{ fontSize: 13, margin: '2px 0 8px', lineHeight: 1.5 }}>הארוחה נוספה. ה-AI הציע לשמור את זה כמוצר, כדי שבפעם הבאה תוסיף אותו בלחיצה. כלום לא נשמר בלי אישור.</div>
        {propPending.map((x) => <ProductCard key={x.id} msgId={propMsg!} p={x} />)}
      </Sheet>

      <Sheet open={sheet === 'addtile'} onClose={() => setSheet(null)}>
        <h3>הוסף אריח</h3>
        <div class="mu" style={{ fontSize: 13, margin: '2px 0 10px' }}>חפש מצרך, והוא יופיע בלשונית "מצרכים" עם מנה טיפוסית.</div>
        <FoodPicker autoFocus onPick={pinFood} placeholder="חפש מצרך…" />
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
          <button class="btn primary block full" onClick={submitManual}>הוסף לארוחה</button>
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

      <PotSheet open={sheet === 'pot' || sheet === 'potnew'} forceNew={sheet === 'potnew'} onClose={() => setSheet(null)} />
    </BigSheet>
  );
}
