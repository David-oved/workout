import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Plus, Search } from 'lucide-preact';
import { store } from '../core/state';
import { dbState, loadDb, searchFoods, type FoodRec } from '../data/foodDb';

/** חיפוש במאגר המזון (משרד הבריאות + מצרכי יסוד + המזונות שלי). נטען בעצלתיים */
export function FoodPicker({ onPick, placeholder = 'חפש מצרך…', autoFocus = false }: { onPick: (f: FoodRec) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const ready = dbState.use((x) => x.ready);
  const error = dbState.use((x) => x.error);
  const s = store.use((x) => x);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { void loadDb(); if (autoFocus) setTimeout(() => ref.current?.focus(), 350); }, []);
  const res = useMemo(() => (ready ? searchFoods(q, s, 12) : []), [q, ready, s.foodEdits, s.customFoods]);
  return (
    <div>
      <div class="fp-in">
        <Search />
        <input ref={ref} value={q} placeholder={placeholder} autocomplete="off" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      {q.trim() !== '' && (
        <div class="as-res" style={{ marginTop: 8 }}>
          {!ready && !error && <div class="mu" style={{ padding: 8 }}>טוען את מאגר המזון…</div>}
          {error && <div class="err" style={{ padding: 8 }}>{error}</div>}
          {ready && res.length === 0 && <div class="mu" style={{ padding: 8 }}>לא נמצא. אפשר להוסיף מזון משלך בהזנה ידנית.</div>}
          {res.map((f) => <FoodRow key={f.id} f={f} onPick={() => { onPick(f); setQ(''); }} />)}
        </div>
      )}
    </div>
  );
}

export const foodSub = (f: FoodRec) => {
  const per = f.unit === 'g' ? 'ל-100 ג׳' : 'למנה';
  const bits = [`${Math.round(f.per.k)} קל׳ ${per}`, `${Math.round(f.per.p * 10) / 10} ח׳`];
  if (f.kind === 'raw') bits.push('לפני בישול');
  if (f.kind === 'cooked') bits.push('אחרי בישול');
  return bits.join(' · ');
};

export function FoodRow({ f, onPick }: { f: FoodRec; onPick: () => void }) {
  return (
    <button class="as-row" onClick={onPick}>
      <div>
        <b>{f.name}{f.edited && <i class="etag" style={{ marginRight: 6 }}>עודכן ידנית</i>}</b>
        <small class="num">{foodSub(f)}</small>
        {f.full && f.full !== f.name && f.full.length > f.name.length + 6 && <small class="fp-full">{f.full}</small>}
      </div>
      <Plus />
    </button>
  );
}

/** שדה כמות מדויקת: אפשר למחוק ולהקליד חופשי, ומעדכן רק ערך תקין */
export function AmtInput({ value, onChange, suffix, wide = false }: { value: number; onChange: (n: number) => void; suffix?: string; wide?: boolean }) {
  const [txt, setTxt] = useState(String(Math.round(value * 10) / 10));
  const focus = useRef(false);
  useEffect(() => { if (!focus.current) setTxt(String(Math.round(value * 10) / 10)); }, [value]);
  return (
    <span class={'amt' + (wide ? ' wide' : '')}>
      <input class="num" inputMode="decimal" value={txt}
        onFocus={(e) => { focus.current = true; (e.target as HTMLInputElement).select(); }}
        onBlur={() => { focus.current = false; setTxt(String(Math.round(value * 10) / 10)); }}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setTxt(v);
          const n = Number(v.replace(',', '.'));
          if (v.trim() !== '' && isFinite(n) && n > 0) onChange(n);
        }} />
      {suffix && <small>{suffix}</small>}
    </span>
  );
}
