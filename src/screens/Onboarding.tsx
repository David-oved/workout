import { useState } from 'preact/hooks';
import { Dumbbell } from 'lucide-preact';
import { store, update } from '../core/state';
import { actions } from '../core/actions';
import { suggestTargets } from '../core/calc';
import { setUi } from '../ui/ui';
import { BigSheet } from '../ui/components';
import { AmtInput } from './FoodPicker';
import type { Profile } from '../core/types';

/** היכרות ראשונה: פרופיל ויעד, כדי שהיעדים והמלצות ה-AI יתאימו לך. הכל נשמר רק במכשיר */
export function Onboarding() {
  const s = store.use((x) => x);
  const open = s.meta.onboarded === false;
  const [p, setP] = useState<Profile>({ ...s.settings.profile });
  const set = (patch: Partial<Profile>) => setP((x) => ({ ...x, ...patch }));
  const finish = (toPlan: boolean) => {
    actions.saveSettings({ profile: p, targets: suggestTargets(p) });
    update((x) => ({ ...x, weights: x.weights.length ? [{ ...x.weights[0], kg: p.weightKg }] : [{ date: new Date().toISOString().slice(0, 10), kg: p.weightKg }], meta: { ...x.meta, onboarded: true } }));
    if (toPlan) setUi({ plan: { dayId: null } });
  };
  return (
    <BigSheet open={open} onClose={() => undefined}>
      <div class="as-top">
        <div>
          <div class="as-ti" style={{ fontSize: 28 }}>ברוך הבא</div>
          <div class="as-su">כמה פרטים כדי להתאים הכל אליך. אפשר לשנות בהגדרות</div>
        </div>
        <div class="ob-ic"><Dumbbell /></div>
      </div>
      <div class="as-body" style={{ paddingBottom: 40 }}>
        <div class="g ob-card">
          <label class="lbl">מין (לחישוב יעדים)</label>
          <div class="chips" style={{ margin: '4px 0 14px' }}>
            <button class={'chip' + (p.sex !== 'f' ? ' on' : '')} onClick={() => set({ sex: 'm' })}>גבר</button>
            <button class={'chip' + (p.sex === 'f' ? ' on' : '')} onClick={() => set({ sex: 'f' })}>אישה</button>
          </div>
          <div class="ob-row"><span>גיל</span><AmtInput value={p.age} onChange={(n) => set({ age: Math.round(n) })} suffix="שנים" /></div>
          <div class="ob-row"><span>גובה</span><AmtInput value={p.heightCm} onChange={(n) => set({ heightCm: Math.round(n) })} suffix="ס״מ" /></div>
          <div class="ob-row"><span>משקל עכשיו</span><AmtInput value={p.weightKg} onChange={(n) => set({ weightKg: n })} suffix="ק״ג" /></div>
          <div class="ob-row"><span>משקל יעד</span><AmtInput value={p.goalKg} onChange={(n) => set({ goalKg: n })} suffix="ק״ג" /></div>
          <label class="lbl" style={{ marginTop: 12 }}>קצב רצוי</label>
          <div class="chips" style={{ margin: '4px 0 0' }}>
            {([['slow', 'איטי'], ['mid', 'בינוני'], ['fast', 'מהיר']] as const).map(([k, n]) => <button class={'chip' + (p.pace === k ? ' on' : '')} onClick={() => set({ pace: k })}>{n}</button>)}
          </div>
        </div>
        <div class="mu" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '12px 6px' }}>היעדים הם הערכה בלבד ואינם תחליף לתזונאי או לרופא. כל הנתונים שלך נשמרים רק במכשיר הזה.</div>
        <button class="as-cta" style={{ position: 'static' }} onClick={() => finish(false)}>התחל</button>
        <button class="btn block" style={{ marginTop: 10 }} onClick={() => finish(true)}>יש לי תוכנית אימונים: ייבא</button>
      </div>
    </BigSheet>
  );
}
