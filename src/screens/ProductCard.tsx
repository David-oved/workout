import { useState } from 'preact/hooks';
import { Check, ExternalLink, Sparkles, Tag } from 'lucide-preact';
import { actions } from '../core/actions';
import { store } from '../core/state';
import { uid } from '../core/dates';
import { toast } from '../ui/ui';
import { getFood } from '../data/foodDb';
import { trayAddFood } from '../ui/tray';
import { resolveProduct, setProductField, type ProdProp } from '../ai/chat';

const SRC: Record<ProdProp['source'], string> = { label: 'נקרא מהתווית', web: 'מהאינטרנט', estimate: 'הערכה', user: 'ערכים שתיקנת' };
const n1 = (v: number) => String(Math.round(v * 10) / 10);

/**
 * הצעה ליצירת מוצר חדש מה-AI. כלום לא נשמר בלי אישור שלך. אפשר לתקן כל שדה כאן, או בשיחה ("זה 12 חלבון") והכרטיס יתעדכן.
 */
export function ProductCard({ msgId, p, onAddToMeal, onDone }: { msgId: string; p: ProdProp; onAddToMeal?: boolean; onDone?: () => void }) {
  const [f, setF] = useState({ name: p.name, brand: p.brand ?? '', k: n1(p.kcal100), p: n1(p.p100), c: n1(p.c100), f: n1(p.f100), ul: p.unitLabel ?? 'יחידה', ug: p.unitGrams ? n1(p.unitGrams) : '' });
  // כשה-AI מעדכן את ההצעה בשיחה, הטופס מתעדכן איתה
  const [seen, setSeen] = useState(JSON.stringify([p.name, p.kcal100, p.p100, p.c100, p.f100, p.unitGrams]));
  const sig = JSON.stringify([p.name, p.kcal100, p.p100, p.c100, p.f100, p.unitGrams]);
  if (sig !== seen) {
    setSeen(sig);
    setF({ name: p.name, brand: p.brand ?? '', k: n1(p.kcal100), p: n1(p.p100), c: n1(p.c100), f: n1(p.f100), ul: p.unitLabel ?? 'יחידה', ug: p.unitGrams ? n1(p.unitGrams) : '' });
  }
  const num = (v: string) => Number(v.replace(',', '.')) || 0;
  const ug = num(f.ug);
  const unitMac = ug > 0 ? { k: Math.round((num(f.k) * ug) / 100), p: Math.round((num(f.p) * ug) / 10) / 10 } : null;
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const save = (toMeal: boolean) => {
    if (!f.name.trim() || !num(f.k)) { toast('חסרים שם או קלוריות'); return; }
    const full = f.brand.trim() ? `${f.name.trim()} (${f.brand.trim()})` : f.name.trim();
    const per = { k: num(f.k), p: num(f.p), c: num(f.c), f: num(f.f) };
    const have = store.get().customFoods.find((x) => x.name === full);
    const id = have?.id ?? uid();
    actions.saveCustomFood({ id, name: full, unit: 'g', per, portions: ug > 0 ? [{ l: f.ul.trim() || 'יחידה', g: ug }] : undefined });
    setProductField(msgId, p.id, { name: f.name.trim(), brand: f.brand.trim() || undefined, kcal100: per.k, p100: per.p, c100: per.c, f100: per.f, unitLabel: ug > 0 ? f.ul : undefined, unitGrams: ug > 0 ? ug : undefined });
    resolveProduct(msgId, p.id, 'saved');
    if (toMeal) {
      const rec = getFood('c:' + id, store.get());
      if (rec) trayAddFood(rec, ug > 0 ? ug : 100);
    }
    toast(`${full} נשמר במאגר שלך`);
    onDone?.();
  };
  const dismiss = () => { resolveProduct(msgId, p.id, 'dismissed'); onDone?.(); };

  return (
    <div class="g pc">
      <div class="pc-h"><Tag /><span>הצעה למוצר חדש</span><i class={'pc-src ' + p.source}>{SRC[p.source]}</i></div>
      <div class="pc-name">
        <input class="inp" value={f.name} aria-label="שם המוצר" onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
        <input class="inp br" value={f.brand} placeholder="מותג" aria-label="מותג" onInput={(e) => set({ brand: (e.target as HTMLInputElement).value })} />
      </div>
      <div class="pc-sub">הערכים ל-100 גרם</div>
      <div class="pc-grid">
        <label><span>קלוריות</span><input class="inp num" inputMode="decimal" value={f.k} onInput={(e) => set({ k: (e.target as HTMLInputElement).value })} /></label>
        <label><span>חלבון</span><input class="inp num" inputMode="decimal" value={f.p} onInput={(e) => set({ p: (e.target as HTMLInputElement).value })} /></label>
        <label><span>פחמימה</span><input class="inp num" inputMode="decimal" value={f.c} onInput={(e) => set({ c: (e.target as HTMLInputElement).value })} /></label>
        <label><span>שומן</span><input class="inp num" inputMode="decimal" value={f.f} onInput={(e) => set({ f: (e.target as HTMLInputElement).value })} /></label>
      </div>
      <div class="pc-unit">
        <span>יחידה אחת</span>
        <input class="inp" value={f.ul} aria-label="שם יחידה" onInput={(e) => set({ ul: (e.target as HTMLInputElement).value })} />
        <input class="inp num" inputMode="decimal" value={f.ug} placeholder="גרם" aria-label="גרם ליחידה" onInput={(e) => set({ ug: (e.target as HTMLInputElement).value })} />
        <span class="mu">ג׳</span>
      </div>
      {unitMac && <div class="pc-sub num">{f.ul || 'יחידה'} ({n1(ug)} ג׳): {unitMac.k} קל׳ · {unitMac.p} ח׳</div>}
      {p.note && <div class="pc-note"><Sparkles />{p.note}</div>}
      {p.url && <a class="pc-link" href={p.url} target="_blank" rel="noopener"><ExternalLink />{p.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a>}
      <div class="pc-acts">
        <button class="btn primary" onClick={() => save(false)}><Check />שמור כמוצר</button>
        {onAddToMeal && <button class="btn" onClick={() => save(true)}>שמור והוסף לארוחה</button>}
        <button class="btn" onClick={dismiss}>לא עכשיו</button>
      </div>
    </div>
  );
}
