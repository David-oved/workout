import { useEffect, useRef, useState } from 'preact/hooks';
import { store } from '../core/state';
import { dayInfo, fmt } from '../core/calc';
import { addDays, dayLabel, todayKey } from '../core/dates';
import { ui, setUi } from '../ui/ui';
import { Sheet } from '../ui/components';
import { CountNum } from '../ui/anim';

type K = 'k' | 'p' | 'c' | 'f';
const META: Record<K, { name: string; unit: string; color: string; kcal: number }> = {
  k: { name: 'קלוריות', unit: 'קל׳', color: 'var(--accent)', kcal: 1 },
  p: { name: 'חלבון', unit: 'ג׳', color: 'var(--cp)', kcal: 4 },
  c: { name: 'פחמימה', unit: 'ג׳', color: 'var(--cc)', kcal: 4 },
  f: { name: 'שומן', unit: 'ג׳', color: 'var(--cf)', kcal: 9 },
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** פירוט קטן למדד: כמה אכלת, מול היעד, לפי ארוחה, מה תרם הכי הרבה, וממוצע 7 ימים */
export function StatSheet() {
  const key = ui.use((u) => u.stat);
  const date = ui.use((u) => u.date);
  const s = store.use((x) => x);
  const last = useRef<K>('p');
  if (key) last.current = key;
  const k = key ?? last.current;
  const m = META[k];
  const info = dayInfo(s, date);
  const today = todayKey(s.settings.resetHour);
  const eaten = info.eaten[k], target = info.target[k];
  const rem = target - eaten;
  const pct = target > 0 ? Math.round((eaten / target) * 100) : 0;
  const kg = [...s.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.kg ?? s.settings.profile.weightKg;

  const slots = [...s.settings.slots.map((x) => ({ id: x.id, name: x.name })), { id: '__other', name: 'אחר' }];
  const known = new Set(s.settings.slots.map((x) => x.id));
  const bySlot = slots
    .map((sl) => ({ name: sl.name, v: info.entries.filter((e) => (sl.id === '__other' ? !known.has(e.slot) : e.slot === sl.id)).reduce((a, e) => a + e[k], 0) }))
    .filter((x) => x.v > 0 || x.name !== 'אחר');
  const maxSlot = Math.max(1, ...bySlot.map((x) => x.v));
  const top = [...info.entries].sort((a, b) => b[k] - a[k]).filter((e) => e[k] > 0).slice(0, 3);
  const emptySlots = s.settings.slots.filter((sl) => !info.entries.some((e) => e.slot === sl.id));

  // ממוצע 7 הימים הקודמים (רק ימים שרשמת בהם)
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, -(i + 1)));
  const sums = days.map((d) => s.entries.filter((e) => e.date === d).reduce((a, e) => a + e[k], 0)).filter((v) => v > 0);
  const avg = sums.length ? Math.round(sums.reduce((a, b) => a + b, 0) / sums.length) : 0;

  const kcalShare = k !== 'k' && info.eaten.k > 0 ? Math.round(((eaten * m.kcal) / info.eaten.k) * 100) : 0;
  const targetShare = k !== 'k' && info.target.k > 0 ? Math.round(((target * m.kcal) / info.target.k) * 100) : 0;

  const tip = (() => {
    if (rem < 0) return `עברת את היעד ב-${fmt(-rem)} ${m.unit}. זה לא נורא ביום אחד.`;
    if (rem === 0) return 'סגרת את היעד בדיוק.';
    if (k === 'p') return `עוד ${fmt(rem)} ג׳ חלבון זה בערך ${fmt((rem / 31) * 100)} ג׳ חזה עוף, או ${Math.max(1, Math.round(rem / 6))} ביצים.`;
    if (k === 'c') return `עוד ${fmt(rem)} ג׳ פחמימה זה בערך ${fmt((rem / 28) * 100)} ג׳ אורז מבושל, או ${Math.max(1, Math.round(rem / 15))} פרוסות לחם.`;
    if (k === 'f') return `עוד ${fmt(rem)} ג׳ שומן זה בערך ${Math.max(1, Math.round(rem / 14))} כפות שמן זית, או ${fmt((rem / 15) * 100)} ג׳ בוטנים.`;
    return emptySlots.length ? `נשארו ${emptySlots.length} ארוחות ריקות, בערך ${fmt(rem / emptySlots.length)} קל׳ לכל אחת.` : `נשארו ${fmt(rem)} קל׳ להיום.`;
  })();

  // הפס נמשך מאפס בכל פתיחה
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!key) return;
    setW(0);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setW(Math.min(100, pct))));
    return () => cancelAnimationFrame(id);
  }, [key, pct]);

  const close = () => setUi({ stat: null });
  return (
    <Sheet open={!!key} onClose={close}>
      <div class="stt">
        <div class="stt-h"><b style={{ color: m.color }}>{m.name}</b><span class="mu">{dayLabel(date, today)}</span></div>
        <div class="stt-big num"><CountNum v={Math.abs(rem)} /><small>{m.unit} {rem < 0 ? 'מעל היעד' : 'נשארו'}</small></div>
        <div class="stt-bar"><i style={{ width: w + '%', background: rem < 0 ? 'var(--warn)' : m.color }} /></div>
        <div class="stt-grid">
          <div><span class="mu">אכלתי</span><b class="num">{fmt(eaten)}</b></div>
          <div><span class="mu">יעד</span><b class="num">{fmt(target)}</b></div>
          <div><span class="mu">מהיעד</span><b class="num">{pct}%</b></div>
          <div><span class="mu">לכל ק״ג</span><b class="num">{r1(eaten / kg)}</b></div>
        </div>
        {k !== 'k' && info.eaten.k > 0 && (
          <div class="stt-row"><span>חלק מהקלוריות של היום</span><b class="num">{kcalShare}%<small class="mu"> (ביעד {targetShare}%)</small></b></div>
        )}
        {bySlot.some((x) => x.v > 0) && (
          <>
            <div class="stt-sec">לפי ארוחה</div>
            {bySlot.filter((x) => x.v > 0).map((x) => (
              <div class="stt-sl" key={x.name}>
                <span>{x.name}</span>
                <div class="stt-m"><i style={{ width: Math.max(4, (x.v / maxSlot) * 100) + '%', background: m.color }} /></div>
                <b class="num">{fmt(x.v)}</b>
              </div>
            ))}
          </>
        )}
        {top.length > 0 && (
          <>
            <div class="stt-sec">מה תרם הכי הרבה</div>
            {top.map((e) => <div class="stt-row" key={e.id}><span class="stt-n">{e.name}</span><b class="num">{fmt(e[k])} {m.unit}</b></div>)}
          </>
        )}
        {avg > 0 && (
          <div class="stt-row" style={{ marginTop: 10 }}><span>ממוצע בשבוע האחרון</span><b class="num">{fmt(avg)} {m.unit}<small class="mu"> ({eaten >= avg ? '+' : '−'}{fmt(Math.abs(eaten - avg))} היום)</small></b></div>
        )}
        <div class="stt-tip">{tip}</div>
      </div>
    </Sheet>
  );
}
