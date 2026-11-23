import { render } from 'preact';
import './styles/global.css';
import { loadState, store } from './core/state';
import { setUi } from './ui/ui';
import { todayKey } from './core/dates';
import { initUpdater } from './update/updater';
import { startFeedSync } from './core/calfeed';
import { startBridge } from './core/bridge';
import { startPush } from './push/push';
import { initFx } from './ui/fx';
import { initViewportFix } from './viewportFix';

const started = performance.now();

async function boot() {
  initViewportFix();
  await loadState();
  initFx();
  // ה-import הדינמי מבטיח שהסטייט נטען לפני שה-UI נבנה
  const { App } = await import('./app');
  render(<App />, document.getElementById('app')!);
  initUpdater();
  startFeedSync();
  startBridge();
  startPush();
  // לחיצה על התראת "סיכום היום": נפתח הסיכום (אם האפליקציה כבר פתוחה ההודעה מגיעה מה-Service Worker)
  const openSummary = () => setUi({ tab: 'today', summary: todayKey(store.get().settings.resetHour) });
  if (new URLSearchParams(location.search).has('summary')) { openSummary(); history.replaceState(null, '', location.pathname); }
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.summary) openSummary(); });

  // אנימציית הפתיחה: מינימום ~1.7 שניות כדי שתושלם, ואז דועכת
  const splash = document.getElementById('splash');
  if (splash) {
    const wait = Math.max(0, 1700 - (performance.now() - started));
    setTimeout(() => {
      splash.classList.add('out');
      setTimeout(() => splash.remove(), 700);
    }, wait);
  }
}

void boot();
