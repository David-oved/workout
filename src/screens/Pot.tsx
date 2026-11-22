import { useEffect, useState } from 'preact/hooks';
import { X, Trash, Pencil, Utensils } from 'lucide-preact';
import { store } from '../core/state';
import { actions } from '../core/actions';
import { uid } from '../core/dates';
import { autoMealName, dishPer100, dishTotals, estimateCooked } from '../core/meal';
import { getFood, type FoodRec } from '../data/foodDb';
import { Sheet } from '../ui/components';
import { toast } from '../ui/ui';
import { defaultPortion, trayAddDish } from '../ui/tray';
import { AmtInput, FoodPicker } from './FoodPicker';
import type { Dish, Part } from '../core/types';

/**
 * סיר: מצרכים גולמיים בגרמים + משקל הסיר אחרי הבישול (+ שומן שנשפך) = ערכים לכל 100 גרם מוכן.
 * אחר כך אוכלים "300 גרם מהסיר" ומקבלים את הערכים המדויקים, והמצרכים נשמרים בתוך הארוחה.
 */
const LOSS = [0, 0.1, 0.2, 0.3];

export function PotSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = store.use((x) => x);
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [cooked, setCooked] = useState('');
  const [loss, setLoss] = useState(0);
  const [remain, setRemain] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { if (open) { setMode(s.dishes.length ? 'list' : 'edit'); if (!s.dishes.length) fresh(); } }, [open]);

  const fresh = () => { setId(uid()); setName(''); setParts([]); setCooked(''); setLoss(0); setRemain(''); setMsg(''); };
  const startNew = () => { fresh(); setMode('edit'); };
  const edit = (d: Dish) => {
    setId(d.id); setName(d.name); setParts(d.parts); setCooked(d.measured ? String(d.cookedG) : ''); setLoss(d.fatLoss); setRemain(d.remainG != null ? String(Math.round(d.remainG)) : ''); setMsg(''); setMode('edit');
  };

  const addFood = (f: FoodRec) => {
    const amount = f.unit === 'g' ? defaultPortion(f.portions) : 1;
    setParts((p) => [...p, { id: uid(), name: f.name, unit: f.unit, amount, base: f.base, per: f.per, est: f.est, foodId: f.id }]);
  };
  const setAmt = (pid: string, n: number) => setParts((p) => p.map((x) => (x.id === pid ? { ...x, amount: n } : x)));
  const rm = (pid: string) => setParts((p) => p.filter((x) => x.id !== pid));

  const yieldOf = (p: Part) => (p.foodId ? getFood(p.foodId, s)?.y : undefined);
  const est = estimateCooked(parts, yieldOf);
  const rawG = Math.round(parts.reduce((a, p) => a + (p.unit === 'g' ? p.amount : 0), 0));
  const cookedG = Number(cooked) || est;
  const draft = { parts, fatLoss: loss, cookedG };
  const tot = dishTotals(draft);
  const per = dishPer100(draft);

  const save = () => {
    if (!parts.length) { setMsg('הוסף לפחות מצרך אחד'); return; }
    if (cookedG < 20) { setMsg('הזן משקל אחרי בישול'); return; }
    const prev = s.dishes.find((x) => x.id === id);
    const d: Dish = {
      id, name: name.trim() || autoMealName(parts), parts, cookedG: Math.round(cookedG), measured: !!Number(cooked), fatLoss: loss,
      remainG: remain.trim() !== '' ? Number(remain) || 0 : prev ? prev.remainG : Math.round(cookedG),
      createdAt: prev?.createdAt ?? Date.now(), last: prev?.last,
    };
    actions.saveDish(d);
    toast('הסיר נשמר');
    setMode('list');
  };

  const eat = (d: Dish) => { trayAddDish(d); onClose(); toast(`${d.name} במגש, קבע כמה גרם`); };
  const del = (d: Dish) => {
    if (!confirm(`למחוק את "${d.name}"? ארוחות שכבר נרשמו לא ישתנו.`)) return;
    actions.deleteDish(d.id);
    if (s.dishes.length <= 1) startNew();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      {mode === 'list' ? (
        <>
          <h3>הסירים שלי</h3>
          <div class="mu" style={{ marginBottom: 10, fontSize: 13, lineHeight: 1.5 }}>בישלת סיר? שמור אותו פעם אחת, ואחר כך תאכל ממנו בגרמים בלי לחשב כלום.</div>
          <div class="as-res">
            {s.dishes.map((d) => {
              const p = dishPer100(d);
              return (
                <div class="as-row pot" key={d.id}>
                  <div>
                    <b>{d.name}</b>
                    <small class="num">{Math.round(p.k)} קל׳ · {Math.round(p.p * 10) / 10} ח׳ ל-100 ג׳ · סיר {d.cookedG} ג׳{d.remainG != null ? ` · נשארו ${Math.round(d.remainG)}` : ''}</small>
                  </div>
                  <button class="as-rm" aria-label="ערוך" onClick={() => edit(d)}><Pencil /></button>
                  <button class="as-rm" aria-label="מחק" onClick={() => del(d)}><Trash /></button>
                  <button class="pot-eat" onClick={() => eat(d)}><Utensils />אכלתי</button>
                </div>
              );
            })}
          </div>
          <button class="btn primary block" style={{ marginTop: 14 }} onClick={startNew}>סיר חדש</button>
        </>
      ) : (
        <>
          <h3>{s.dishes.some((x) => x.id === id) ? 'עריכת סיר' : 'סיר חדש'}</h3>
          <input class="inp" style={{ marginTop: 8 }} value={name} placeholder={parts.length ? autoMealName(parts) : 'שם הסיר (אופציונלי)'} onInput={(e) => setName((e.target as HTMLInputElement).value)} />

          <div class="as-lbl" style={{ marginTop: 14 }}><span>מה הכנסת לסיר (משקל גולמי)</span><span class="num">{rawG} ג׳</span></div>
          {parts.map((p) => (
            <div class="pot-ing" key={p.id}>
              <span class="nm">{p.name}</span>
              <AmtInput value={p.amount} onChange={(n) => setAmt(p.id, n)} suffix={p.unit === 'g' ? 'ג׳' : 'מנות'} />
              <button class="as-rm" aria-label="הסר" onClick={() => rm(p.id)}><X /></button>
            </div>
          ))}
          <FoodPicker onPick={addFood} placeholder={parts.length ? 'עוד מצרך…' : 'חפש מצרך: אורז, עוף, שמן…'} />

          {parts.length > 0 && (
            <>
              <div class="as-lbl" style={{ marginTop: 16 }}><span>משקל הסיר אחרי הבישול</span></div>
              <div class="pot-row">
                <AmtInput wide value={Number(cooked) || 0} onChange={(n) => setCooked(String(Math.round(n)))} suffix="ג׳" />
                <button class={'chip' + (!cooked ? ' on' : '')} onClick={() => setCooked('')}>אומדן {est} ג׳</button>
              </div>
              <div class="mu" style={{ fontSize: 12, margin: '6px 4px 0', lineHeight: 1.5 }}>
                {cooked ? 'משקל מדוד, הכי מדויק.' : 'האומדן לפי התנפחות/התכווצות רגילה של כל מצרך. כדי לדייק: שקול את הסיר המוכן (פחות משקל הסיר ריק) והקלד.'}
              </div>

              <div class="as-lbl" style={{ marginTop: 14 }}><span>שומן שנשפך בבישול</span></div>
              <div class="chips" style={{ margin: 0 }}>
                {LOSS.map((l) => <button class={'chip' + (loss === l ? ' on' : '')} onClick={() => setLoss(l)}>{l === 0 ? 'כלום' : `${l * 100}%`}</button>)}
              </div>

              <div class="g pot-res">
                <div class="pr-h">ל-100 גרם מוכן</div>
                <div class="pr-b num"><b>{Math.round(per.k)}</b> קל׳ · <span class="m1">{Math.round(per.p * 10) / 10} ח׳</span> · <span class="m2">{Math.round(per.c * 10) / 10} פ׳</span> · <span class="m3">{Math.round(per.f * 10) / 10} ש׳</span></div>
                <div class="pr-s num">כל הסיר: {Math.round(tot.k)} קל׳ · {Math.round(tot.p)} ח׳ · {Math.round(tot.c)} פ׳ · {Math.round(tot.f)} ש׳</div>
              </div>

              {s.dishes.some((x) => x.id === id) && (
                <div class="pot-row" style={{ marginTop: 10 }}>
                  <span class="mu" style={{ fontSize: 14 }}>נשאר בסיר</span>
                  <AmtInput wide value={Number(remain) || 0} onChange={(n) => setRemain(String(Math.round(n)))} suffix="ג׳" />
                </div>
              )}
            </>
          )}
          <div class="err">{msg}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button class="btn primary" style={{ flex: 1 }} onClick={save}>שמור סיר</button>
            {s.dishes.length > 0 && <button class="btn" onClick={() => setMode('list')}>חזרה</button>}
          </div>
        </>
      )}
    </Sheet>
  );
}
