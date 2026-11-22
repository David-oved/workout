/**
 * באייפון, באפליקציה שנפתחת מהמסך הבית, ה-viewport לפעמים קצר מהמסך (פס שחור בתחתית).
 * כאן קובעים לאפליקציה גובה מפורש: בדרך כלל innerHeight, ובמצב ה"פס" – גובה המסך האמיתי.
 * אפשר לכבות את התיקון מההגדרות אם הוא מזיק (נשמר ב-localStorage).
 */
const KEY = 'wo:fit';

export const isStandalone = () =>
  (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;

export const fitEnabled = () => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
};

export function setFit(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  applyFit();
}

export function applyFit() {
  const h = window.innerHeight;
  const gap = screen.height - h;
  const use = fitEnabled() && isStandalone() && gap > 0 && gap < 140 ? screen.height : h;
  document.documentElement.style.setProperty('--app-h', `${use}px`);
}

export function initViewport() {
  applyFit();
  window.addEventListener('resize', applyFit);
  window.addEventListener('orientationchange', () => setTimeout(applyFit, 300));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && applyFit());
}
