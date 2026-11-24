/**
 * אבחון גובה המסך (הרווח השחור בתחתית ב-iOS). לא משנה שום דבר בתצוגה: רק מודד ורושם מתי הגובה משתנה,
 * כדי לראות מה מפעיל את הרווח ומה מעלים אותו. הרישום נשמר במכשיר ומוצג בהגדרות ← עדכונים.
 */
export interface VpSnap { t: number; tag: string; iw: number; ih: number; sh: number; vv: number; vt: number; ch: number; app: number; lvh: number; svh: number; dvh: number; saT: number; saB: number; vis: string }
const LS = 'wo:vp-log';

/** deep: גם בדיקות lvh/svh/dvh ואזור בטוח (מחייבות חישוב פריסה, לכן לא במהלך אנימציית מקלדת) */
export function snapshot(tag: string, deep = true): VpSnap {
  const h = (v: string) => { const e = document.createElement('div'); e.style.cssText = `position:fixed;left:0;top:0;width:1px;height:${v};visibility:hidden;pointer-events:none`; document.body.appendChild(e); const r = e.offsetHeight; e.remove(); return r; };
  let saT = 0, saB = 0, lvh = 0, svh = 0, dvh = 0;
  if (deep) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    saT = parseFloat(cs.paddingTop) || 0; saB = parseFloat(cs.paddingBottom) || 0;
    probe.remove();
    lvh = h('100lvh'); svh = h('100svh'); dvh = h('100dvh');
  }
  return {
    t: Date.now(), tag, iw: innerWidth, ih: innerHeight, sh: screen.height,
    vv: Math.round(visualViewport?.height ?? 0), vt: Math.round(visualViewport?.offsetTop ?? 0),
    ch: document.documentElement.clientHeight, app: Math.round(document.getElementById('app')?.getBoundingClientRect().height ?? 0),
    lvh, svh, dvh, saT, saB, vis: document.visibilityState,
  };
}

export const readLog = (): VpSnap[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };
export const clearLog = () => { try { localStorage.removeItem(LS); } catch { /* ignore */ } };

export function fmtSnap(s: VpSnap) {
  const gap = s.sh - s.ih;
  const d = new Date(s.t);
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return `${hh} ${s.tag} | inner ${s.iw}x${s.ih} screen ${s.sh} gap ${gap} | vv ${s.vv}/${s.vt} client ${s.ch} app ${s.app} | lvh ${s.lvh} svh ${s.svh} dvh ${s.dvh} | safe ${s.saT}/${s.saB} | ${s.vis}`;
}

export function initViewportLog() {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = (tag: string, force: boolean) => {
    try {
      const deep = force || tag === 'boot' || tag === 'visible' || tag === 'visible+1s';
      const s = snapshot(tag, deep);
      const k = `${s.ih}|${s.vv}|${s.app}`;
      if (!force && k === last) return;
      last = k;
      const log = readLog();
      log.push(s);
      localStorage.setItem(LS, JSON.stringify(log.slice(-60)));
    } catch { /* ignore */ }
  };
  // רישום מרוכך: אחרי שהאירועים נרגעים (למשל אחרי אנימציית מקלדת), כדי לא להפריע לממשק
  const rec = (tag: string) => { clearTimeout(timer); timer = setTimeout(() => write(tag, false), 400); };
  write('boot', true);
  for (const e of ['resize', 'orientationchange', 'pageshow']) addEventListener(e, () => rec(e));
  visualViewport?.addEventListener('resize', () => rec('vv-resize'));
  document.addEventListener('visibilitychange', () => { setTimeout(() => write(document.hidden ? 'hidden' : 'visible', true), 120); setTimeout(() => write('visible+1s', false), 1200); });
  setInterval(() => write('poll', false), 5000); // שינוי שקט בלי אירוע
}
