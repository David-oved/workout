import { useEffect, useMemo, useState } from 'preact/hooks';
import { X, Search, Plus, Star, Undo2, Minus, Sparkles } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { fmt, recentFoods, scale } from '../core/calc';
import { dayLabel, todayKey } from '../core/dates';
import { ui, setUi } from '../ui/ui';
import { FullScreen, Sheet } from '../ui/components';
import { BUILTIN_FOODS, SIZES } from '../data/foods';
import type { Food } from '../core/types';

type Tab = 'recent' | 'fav' | 'foods' | 'manual';
const TABS: [Tab, string][] = [['recent', 'האחרונים'], ['fav', 'מועדפים'], ['foods', 'הערכה מהירה'], ['manual', 'ידני']];

const macroLine = (x: { k: number; p: number; c: number; f: number }) => (
  <span class="num">{x.k} קל׳<u class="m1">{x.p} ח׳</u><u class="m2">{x.c} פ׳</u><u class="m3">{x.f} ש׳</u></span>
);

export function AddScreen() {
  const open = ui.use((u) => u.addOpen);
  const slot = ui.use((u) => u.addSlot);
  const date = ui.use((u) => u.addDate);
  const s = store.use((x) => x);
  const [tab, setTab] = useState<Tab>('recent');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Food | null>(null);
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('m');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState<{ ids: string[]; k: number; counts: Record<string, number> }>({ ids: [], k: 0, counts: {} });
  const [man, setMan] = useState({ name: '', k: '', p: '', c: '', f: '', fav: false });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setTab('recent'); setQ(''); setDetail(null); setAdded({ ids: [], k: 0, counts: {} }); setErr(''); setMan({ name: '', k: '', p: '', c: '', f: '', fav: false }); }
  }, [open]);

  const recents: Food[] = useMemo(
    () => recentFoods(s.entries).map((e) => ({ id: 'r-' + e.name, name: e.name, k: e.k, p: e.p, c: e.c, f: e.f, est: e.est })),
    [s.entries],
  );
  const favNames = new Set(s.favorites.map((x) => x.name));
  const list = useMemo(() => {
    const term = q.trim();
    if (term) {
      const pool = [...s.favorites, ...recents, ...BUILTIN_FOODS];
      const seen = new Set<string>();
      return pool.filter((f) => f.name.includes(term) && !seen.has(f.name) && seen.add(f.name));
    }
    return tab === 'recent' ? recents : tab === 'fav' ? s.favorites : tab === 'foods' ? BUILTIN_FOODS : [];
  }, [q, tab, s.favorites, recents]);

  const slotName = s.settings.slots.find((x) => x.id === slot)?.name ?? 'ארוחה';
  const today = todayKey(s.settings.resetHour);

  const addFood = (f: Food, qy = 1, sz: string = 'm') => {
    const x = (SIZES.find((z) => z.id === sz)?.x ?? 1) * qy;
    const m = scale(f, x);
    const label = (sz !== 'm' ? ` (${SIZES.find((z) => z.id === sz)?.label})` : '') + (qy !== 1 ? ` ×${qy}` : '');
    const e = actions.addEntry({ date, slot, name: f.name + label, ...m, est: f.est });
    setAdded((a) => ({ ids: [...a.ids, e.id], k: a.k + m.k, counts: { ...a.counts, [f.name]: (a.counts[f.name] ?? 0) + 1 } }));
  };
  const undo = () => {
    const id = added.ids[added.ids.length - 1];
    if (!id) return;
    const e = store.get().entries.find((x) => x.id === id);
    actions.deleteEntry(id);
    setAdded((a) => ({ ...a, ids: a.ids.slice(0, -1), k: a.k - (e?.k ?? 0) }));
  };
  const submitManual = () => {
    const k = Number(man.k);
    if (!k) { setErr('הזן קלוריות כדי להוסיף'); return; }
    const food: Food = { id: 'm-' + Date.now(), name: man.name.trim() || 'הזנה ידנית', k, p: +man.p || 0, c: +man.c || 0, f: +man.f || 0 };
    addFood(food);
    if (man.fav && man.name.trim() && !favNames.has(food.name)) actions.toggleFavorite(food);
    setMan({ name: '', k: '', p: '', c: '', f: '', fav: false });
    setErr('');
  };

  const eatenNow = s.entries.filter((e) => e.date === date).reduce((a, e) => a + e.k, 0);
  const tk = (() => {
    const place = s.settings.places[new Date(date + 'T00:00').getDay()];
    return s.settings.targets[`${place}-${s.workouts.some((w) => w.date === date && w.status !== 'skipped') ? 'train' : 'rest'}`].k;
  })();
  const remain = Math.max(0, tk - eatenNow);
  const n = added.ids.length;

  const detailMacros = detail ? scale(detail, (SIZES.find((z) => z.id === size)?.x ?? 1) * qty) : null;

  return (
    <FullScreen open={open}>
      <div class="hd">
        <div>
          <div class="t">הוספה</div>
          <div class="s">ל{slotName} · {dayLabel(date, today)}</div>
        </div>
        <button class="g ib" onClick={() => setUi({ addOpen: false })} aria-label="סגור"><X /></button>
      </div>

      <button class="g aibtn" onClick={() => setUi({ aiOpen: true })}><Sparkles /><span>שוחח עם ה-AI<small>תיאור, תמונה או תווית תזונה</small></span></button>
      <div class="chips">
        {s.settings.slots.map((sl) => (
          <button class={'chip' + (sl.id === slot ? ' on' : '')} onClick={() => setUi({ addSlot: sl.id })}>{sl.name}</button>
        ))}
      </div>

      <div class="g sr flat"><Search /><input value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder="חפש מזון או הקלד חופשי" autocomplete="off" enterkeyhint="search" /></div>

      {!q && (
        <div class="g seg flat">
          {TABS.map(([id, label]) => <button class={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </div>
      )}

      <div class="fs-body">
        {!q && tab === 'manual' ? (
          <div class="g rows" style={{ padding: 16 }}>
            <div class="field">
              <div class="full"><label class="lbl">שם (אופציונלי)</label><input class="inp" value={man.name} onInput={(e) => setMan({ ...man, name: (e.target as HTMLInputElement).value })} placeholder="למשל חטיף" /></div>
              <div><label class="lbl">קלוריות</label><input class="inp num" inputMode="numeric" value={man.k} onInput={(e) => setMan({ ...man, k: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">חלבון (ג׳)</label><input class="inp num" inputMode="numeric" value={man.p} onInput={(e) => setMan({ ...man, p: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">פחמימה (ג׳)</label><input class="inp num" inputMode="numeric" value={man.c} onInput={(e) => setMan({ ...man, c: (e.target as HTMLInputElement).value })} /></div>
              <div><label class="lbl">שומן (ג׳)</label><input class="inp num" inputMode="numeric" value={man.f} onInput={(e) => setMan({ ...man, f: (e.target as HTMLInputElement).value })} /></div>
              <div class="err">{err}</div>
              <button class="full" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--mu)', fontSize: 14 }} onClick={() => setMan({ ...man, fav: !man.fav })}>
                <span class={'tgl' + (man.fav ? ' on' : '')} style={{ width: 44, height: 26 }} />
                שמור למועדפים
              </button>
              <button class="btn primary block full" onClick={submitManual}>הוסף</button>
            </div>
          </div>
        ) : list.length === 0 ? (
          <div class="g rows emp">
            {q ? <>אין תוצאות ל״{q}״<br /><button class="btn primary sm" style={{ marginTop: 12 }} onClick={() => { setMan({ ...man, name: q }); setQ(''); setTab('manual'); }}>הוסף ידנית</button></>
              : tab === 'fav' ? 'עוד אין מועדפים. לחץ על הכוכב ליד מנה כדי לשמור אותה.' : 'עוד לא הוספת מנות. הן יופיעו כאן אחרי הפעם הראשונה.'}
          </div>
        ) : (
          <div class="g rows">
            {tab === 'foods' && !q && <div class="mu" style={{ padding: '10px 16px 0' }}>ערכים משוערים למנה בינונית. לחץ על מנה לשינוי גודל וכמות.</div>}
            {list.map((f) => {
              const c = added.counts[f.name] ?? 0;
              return (
                <div class="it" key={f.id}>
                  <button style={{ flex: 1, textAlign: 'right', minWidth: 0 }} onClick={() => { setDetail(f); setSize('m'); setQty(1); }}>
                    <b>{f.name}{f.est && <span class="est">~</span>}</b>
                    <span>{macroLine(f)}{f.unit && <u class="mu"> · {f.unit}</u>}</span>
                  </button>
                  <button class={'star' + (favNames.has(f.name) ? ' on' : '')} aria-label="מועדף" onClick={() => actions.toggleFavorite(f)}>
                    <Star fill={favNames.has(f.name) ? 'currentColor' : 'none'} />
                  </button>
                  <button class={'pl' + (c ? ' dn' : '')} aria-label={`הוסף ${f.name}`} onClick={() => addFood(f)}>{c ? `×${c}` : <Plus />}</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div class="g sbar">
        <div class="tx">
          <b>{n ? `נוספו ${n} ${n === 1 ? 'מנה' : 'מנות'} · +${fmt(added.k)} קל׳` : 'עדיין לא נוספה מנה'}</b>
          <span>נשארו {fmt(remain)} קל׳ להיום</span>
        </div>
        <button class={'un' + (n ? '' : ' off')} onClick={undo} aria-label="בטל אחרונה"><Undo2 /></button>
        <button class="fin" onClick={() => setUi({ addOpen: false })}>סיום</button>
      </div>

      <Sheet open={!!detail} onClose={() => setDetail(null)}>
        {detail && detailMacros && (
          <div>
            <h3>{detail.name}</h3>
            <div class="mu" style={{ marginBottom: 14 }}>{detail.unit ? `מנה: ${detail.unit}` : 'מנה אחת'}{detail.est ? ' · הערכה' : ''}</div>
            {detail.est && (
              <div class="chips">
                {SIZES.map((z) => <button class={'chip' + (z.id === size ? ' on' : '')} onClick={() => setSize(z.id)}>{z.label}</button>)}
              </div>
            )}
            <div class="g stepper flat" style={{ marginBottom: 14 }}>
              <button onClick={() => setQty((v) => Math.min(20, v + 0.5))} aria-label="הוסף"><Plus size={20} /></button>
              <b class="num">×{qty}</b>
              <button onClick={() => setQty((v) => Math.max(0.5, v - 0.5))} aria-label="הפחת"><Minus size={20} /></button>
            </div>
            <div class="num" style={{ textAlign: 'center', marginBottom: 16, fontSize: 15 }}>
              <b style={{ fontSize: 26, display: 'block' }}>{detailMacros.k} קל׳</b>
              <span class="m1">{detailMacros.p} ח׳</span> · <span class="m2">{detailMacros.c} פ׳</span> · <span class="m3">{detailMacros.f} ש׳</span>
            </div>
            <button class="btn primary block" onClick={() => { addFood(detail, qty, size); setDetail(null); }}>הוסף ל{slotName}</button>
          </div>
        )}
      </Sheet>
    </FullScreen>
  );
}
