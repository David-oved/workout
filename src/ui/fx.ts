import { store } from '../core/state';
import { dayInfo } from '../core/calc';
import { todayKey } from '../core/dates';

/** אפקטים: קונפטי, אימוג'ים מתפרצים, טקסטים צפים וצלילים. הכל כבוי כשהמשתמש כיבה אנימציות או ביקש פחות תנועה */

const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export const fxOn = () => store.get().settings.show.fx && !reduced();
export const syncFxClass = () => document.body.classList.toggle('fx', fxOn());

let last = { x: innerWidth / 2, y: innerHeight * 0.7 };
let layer: HTMLDivElement | null = null;
const host = () => {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'fxl';
  (document.getElementById('app') ?? document.body).appendChild(layer);
  return layer;
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(l: T[]): T => l[Math.floor(Math.random() * l.length)];

function particle(txt: string, x: number, y: number, frames: Keyframe[], ms: number, cls = 'fxp', style = '') {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = txt;
  el.style.cssText = `left:${x}px;top:${y}px;${style}`;
  host().appendChild(el);
  const a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  a.onfinish = () => el.remove();
}

/** אימוג'ים שמתפזרים ממקום מסוים */
export function burst(glyphs: string[], x = last.x, y = last.y, n = 10) {
  if (!fxOn()) return;
  for (let i = 0; i < n; i++) {
    const ang = rnd(-Math.PI * 0.95, -Math.PI * 0.05); // כלפי מעלה
    const dist = rnd(60, 150);
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
    particle(pick(glyphs), x, y, [
      { transform: 'translate(-50%,-50%) scale(.2) rotate(0)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.7}px),calc(-50% + ${dy * 0.7}px)) scale(1.1) rotate(${rnd(-40, 40)}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 70}px)) scale(.8) rotate(${rnd(-120, 120)}deg)`, opacity: 0 },
    ], rnd(900, 1400));
  }
}

const COLORS = ['#5CE1A8', '#8AB4FF', '#F5C97A', '#FF8FA3', '#C79BFF', '#FFFFFF'];
export function confetti(n = 56, x = last.x, y = last.y) {
  if (!fxOn()) return;
  for (let i = 0; i < n; i++) {
    const ang = rnd(-Math.PI * 0.9, -Math.PI * 0.1);
    const v = rnd(120, 300);
    const dx = Math.cos(ang) * v, dy = Math.sin(ang) * v;
    const w = rnd(6, 10);
    particle('', x, y, [
      { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(${rnd(90, 360)}deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(calc(-50% + ${dx * 1.3}px),calc(-50% + ${dy + 420}px)) rotate(${rnd(360, 900)}deg)`, opacity: 0 },
    ], rnd(1400, 2300), 'fxc', `width:${w}px;height:${w * rnd(0.5, 1.2)}px;background:${pick(COLORS)};border-radius:${Math.random() < 0.3 ? '50%' : '2px'}`);
  }
}

/** גשם של אימוג'ים מלמעלה (הפתעה) */
export function rain(glyphs: string[], n = 28) {
  if (!fxOn()) return;
  for (let i = 0; i < n; i++) {
    const x = rnd(10, innerWidth - 10);
    setTimeout(() => particle(pick(glyphs), x, -30, [
      { transform: 'translate(-50%,0) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${rnd(-40, 40)}px),${innerHeight + 60}px) rotate(${rnd(-360, 360)}deg)`, opacity: 1 },
    ], rnd(1500, 2600), 'fxp big'), i * 55);
  }
}

/** טקסט קטן שצף מעלה ונעלם */
export function floatText(txt: string, x = last.x, y = last.y) {
  if (!fxOn()) return;
  const cx = Math.max(90, Math.min(innerWidth - 90, x));
  particle(txt, cx, y - 20, [
    { transform: 'translate(-50%,0) scale(.6)', opacity: 0 },
    { transform: 'translate(-50%,-28px) scale(1.08)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%,-70px) scale(1)', opacity: 1, offset: 0.75 },
    { transform: 'translate(-50%,-96px) scale(.95)', opacity: 0 },
  ], 1700, 'fxt');
}

const LINES = {
  workout: ['חיה! 🦍', 'עוד אימון בבנק 💰', 'השרירים שולחים תודה', 'מכונה! 🤖', 'ככה בונים 81 קילו', 'הברזל הפסיד שוב'],
  pr: ['שיא חדש! 🏆', 'שברת שיא. אפילו הברזל הופתע', 'חזק מאתמול 📈'],
  protein: ['יעד החלבון נסגר! 🍗', 'החלבון בבית. השרירים מאושרים', 'סגרת חלבון 💪'],
  meal: [],
} as const;
const FOOD = ['🍗', '🥚', '🍚', '🥑', '🥩', '🍌', '🥛', '🍞'];
const FOOD_BY: [RegExp, string][] = [[/ביצ/, '🥚'], [/עוף|חזה|שניצל/, '🍗'], [/אורז/, '🍚'], [/חלב|יוגורט|קוטג|גבינ/, '🥛'], [/בננ/, '🍌'], [/לחם|פית|טוסט|לחמני/, '🍞'], [/טונה|דג|סלמון/, '🐟'], [/שייק|חלבון/, '🥤'], [/פסטה|ספגטי/, '🍝'], [/בשר|סטייק|שווארמה|קבב|המבורגר/, '🥩'], [/תפוח אדמה|צ׳יפס|בטטה/, '🍠'], [/אבוקדו/, '🥑'], [/שוקולד|עוגי/, '🍫'], [/פיצה/, '🍕']];
const glyphFor = (name: string) => FOOD_BY.find(([r]) => r.test(name))?.[1];

export function celebrate(kind: 'workout' | 'pr' | 'protein' | 'meal', name = '') {
  if (!fxOn()) return;
  if (kind === 'workout') { confetti(64); burst(['💪', '🔥', '⚡'], undefined, undefined, 8); floatText(pick([...LINES.workout])); }
  else if (kind === 'pr') { burst(['🏆', '⭐', '🥇'], undefined, undefined, 10); floatText(pick([...LINES.pr])); }
  else if (kind === 'protein') { confetti(40); burst(['🍗', '🥩', '🥚', '💪'], undefined, undefined, 10); floatText(pick([...LINES.protein])); }
  else { const g = glyphFor(name); burst(g ? [g, g, g, '✨'] : FOOD, undefined, undefined, 7); }
}

/** צלילים: חייבים להתחיל מלחיצה כדי ש-iOS יאפשר אותם אחר כך */
let ac: AudioContext | null = null;
export function unlockAudio() {
  try {
    const A = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ac = ac ?? new A();
    if (ac.state === 'suspended') void ac.resume();
  } catch { /* ignore */ }
}
export function beep(times = 2) {
  try {
    unlockAudio();
    if (!ac) return;
    for (let i = 0; i < times; i++) {
      const t = ac.currentTime + i * 0.22;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = i === times - 1 ? 1040 : 784;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.2);
    }
  } catch { /* ignore */ }
  try { navigator.vibrate?.([120, 80, 120]); } catch { /* ignore */ }
}

/** מאזין לשינויים במצב ומחגג: אימון שהושלם, יעד חלבון, ארוחה שנוספה. הכל מתחיל ממקום האצבע האחרון */
export function initFx() {
  syncFxClass();
  store.subscribe(syncFxClass);
  // נעילת זום: בלי צביטה, בלי הגדלה בלחיצה ארוכה ובלי תפריט הקשר
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });

  let base: { entries: number; done: number; pOk: boolean } | null = null;
  const snap = () => {
    const s = store.get();
    const today = todayKey(s.settings.resetHour);
    const i = dayInfo(s, today);
    return { entries: s.entries.length, done: s.workouts.filter((w) => w.status === 'done').length, pOk: i.target.p > 0 && i.eaten.p >= i.target.p, today, name: s.entries[s.entries.length - 1]?.name ?? '' };
  };
  setTimeout(() => { const n = snap(); base = { entries: n.entries, done: n.done, pOk: n.pOk }; }, 1800);
  store.subscribe(() => {
    if (!base) return;
    const n = snap();
    const dE = n.entries - base.entries, dD = n.done - base.done;
    if (dD === 1) celebrate('workout');
    if (dE >= 1 && dE <= 4) {
      const lastE = store.get().entries.reduce((a, b) => (b.ts > a.ts ? b : a), store.get().entries[0]);
      if (n.pOk && !base.pOk && localStorage.getItem('wo:fx:p:' + n.today) !== '1') { try { localStorage.setItem('wo:fx:p:' + n.today, '1'); } catch { /* ignore */ } celebrate('protein'); }
      else celebrate('meal', lastE?.name ?? '');
    }
    base = { entries: n.entries, done: n.done, pOk: n.pOk };
  });
}
