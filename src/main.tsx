import { render } from 'preact';
import './styles/global.css';
import { loadState } from './core/state';
import { initUpdater } from './update/updater';
import { startFeedSync } from './core/calfeed';
import { startBridge } from './core/bridge';
import { startPush } from './push/push';

const started = performance.now();

async function boot() {
  await loadState();
  // ה-import הדינמי מבטיח שהסטייט נטען לפני שה-UI נבנה
  const { App } = await import('./app');
  render(<App />, document.getElementById('app')!);
  initUpdater();
  startFeedSync();
  startBridge();
  startPush();

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
