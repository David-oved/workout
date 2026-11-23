/**
 * תיקון הרווח השחור בתחתית ב-PWA של iOS: לפעמים ה-layout viewport קצר בכ-25 פיקסלים
 * (למשל אחרי מקלדת או חזרה מהרקע). כשזה קורה מותחים את #app לגובה המסך ומרעננים את החישוב.
 */
export function initViewportFix() {
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) return;
  const app = document.getElementById('app');
  if (!app) return;
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
  const fix = () => {
    if (typing()) return;
    const gap = screen.height - innerHeight;
    if (innerHeight > innerWidth && gap > 4 && gap <= 80) {
      app.style.display = 'none';
      void app.offsetHeight; // מחייב חישוב מחדש
      app.style.display = '';
      app.style.height = screen.height + 'px';
    } else if (app.style.height) {
      app.style.height = '';
    }
  };
  for (const e of ['resize', 'orientationchange', 'pageshow']) addEventListener(e, fix);
  visualViewport?.addEventListener('resize', fix);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fix(); });
  document.addEventListener('focusout', () => setTimeout(fix, 150));
  for (const t of [0, 300, 1000, 2500]) setTimeout(fix, t);
}
