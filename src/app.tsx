import { useEffect, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { Dock, ToastView, UpdateBanner } from './ui/components';
import { CameraView } from './ui/CameraView';
import { ActMenu } from './ui/actmenu';
import { Onboarding } from './screens/Onboarding';
import { StatSheet } from './screens/StatSheet';
import { InboxSheet } from './screens/InboxCard';
import { TodayScreen } from './screens/Today';
import { AddScreen } from './screens/Add';
import { ProgressScreen } from './screens/Progress';
import { CalendarScreen } from './screens/Calendar';
import { EditEntrySheet, WorkoutSheet } from './screens/Sheets';
import { openAdd, setUi, ui } from './ui/ui';
import { store, update, ensureWorkouts } from './core/state';
import { todayKey } from './core/dates';

// מסכים כבדים (הגדרות, אימון, תוכנית, סיכום) נטענים בנפרד אחרי שהמסך הראשי כבר מוצג, כדי שהאפליקציה תיפתח מהר
const SettingsScreen = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsScreen })));
const TrainingSheet = lazy(() => import('./screens/Training').then((m) => ({ default: m.TrainingSheet })));
const SummarySheet = lazy(() => import('./screens/SummarySheet').then((m) => ({ default: m.SummarySheet })));
const PlanSheet = lazy(() => import('./screens/PlanSheet').then((m) => ({ default: m.PlanSheet })));

/** טוען את המסכים הכבדים ברגע שהדפדפן פנוי, או מיד כשצריך אחד מהם */
function Later({ need, children }: { need: boolean; children: preact.ComponentChildren }) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => setIdle(true), { timeout: 4000 }) : window.setTimeout(() => setIdle(true), 2000);
    return () => { if (!w.requestIdleCallback) clearTimeout(id); };
  }, []);
  return idle || need ? <Suspense fallback={null}>{children}</Suspense> : null;
}

export function App() {
  const needSettings = ui.use((u) => u.settingsOpen);
  const needTrain = ui.use((u) => !!u.training);
  const needSummary = ui.use((u) => !!u.summary);
  const needPlan = ui.use((u) => !!u.plan);
  // כשחוזרים לאפליקציה אחרי זמן: מרעננים את "היום" ומוודאים שיש אימונים מתוזמנים קדימה
  useEffect(() => {
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
      // חזרה אחרי כמה דקות: שוב מבט מהיר, כמו בכניסה לאפליקציה
      if (hiddenAt && Date.now() - hiddenAt > 3 * 60_000 && store.get().settings.show.glance !== false) {
        const c = ui.get();
        if (!c.addOpen && !c.settingsOpen) setUi({ glance: true, tab: 'today' });
      }
      hiddenAt = 0;
      const reset = store.get().settings.resetHour;
      const t = todayKey(reset);
      const cur = ui.get();
      if (!cur.addOpen && !cur.settingsOpen && cur.date !== t && cur.tab === 'today' && Math.abs(Date.parse(cur.date) - Date.parse(t)) < 2 * 86400_000) {
        setUi({ date: t });
      }
      update((s) => ensureWorkouts(s, t));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // "היום" זז לבד: ברגע שהיום מתחלף לפי שעת ההתחלה שקבעת (למשל 01:00), וגם מיד כששינית את שעת ההתחלה בהגדרות.
  // המסך עוקב רק אם הוא הציג את "היום" הקודם, כדי לא לקפוץ מיום שבחרת לראות בכוונה
  useEffect(() => {
    let last = todayKey(store.get().settings.resetHour);
    const sync = () => {
      const t = todayKey(store.get().settings.resetHour);
      if (t === last) return;
      const c = ui.get();
      setUi({ ...(c.date === last ? { date: t } : {}), ...(c.addDate === last && !c.addOpen ? { addDate: t } : {}) });
      last = t;
      update((s) => ensureWorkouts(s, t));
    };
    const off = store.subscribe(sync);
    const id = setInterval(sync, 20_000);
    return () => { off?.(); clearInterval(id); };
  }, []);

  return (
    <>
      <ProgressScreen />
      <TodayScreen />
      <CalendarScreen />
      <Dock onAdd={() => openAdd()} />
      <InboxSheet />
      <AddScreen />
      <Later need={needSettings}><SettingsScreen /></Later>
      <EditEntrySheet />
      <WorkoutSheet />
      <Later need={needTrain}><TrainingSheet /></Later>
      <Later need={needSummary}><SummarySheet /></Later>
      <StatSheet />
      <Later need={needPlan}><PlanSheet /></Later>
      <Onboarding />
      <CameraView />
      <ActMenu />
      <ToastView />
      <UpdateBanner />
    </>
  );
}
