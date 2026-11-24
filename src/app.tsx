import { useEffect } from 'preact/hooks';
import { Dock, ToastView, UpdateBanner } from './ui/components';
import { CameraView } from './ui/CameraView';
import { ActMenu } from './ui/actmenu';
import { TrainingSheet } from './screens/Training';
import { SummarySheet } from './screens/SummarySheet';
import { PlanSheet } from './screens/PlanSheet';
import { Onboarding } from './screens/Onboarding';
import { StatSheet } from './screens/StatSheet';
import { InboxSheet } from './screens/InboxCard';
import { TodayScreen } from './screens/Today';
import { AddScreen } from './screens/Add';
import { ProgressScreen } from './screens/Progress';
import { CalendarScreen } from './screens/Calendar';
import { SettingsScreen } from './screens/Settings';
import { EditEntrySheet, WorkoutSheet } from './screens/Sheets';
import { openAdd, setUi, ui } from './ui/ui';
import { store, update, ensureWorkouts } from './core/state';
import { todayKey } from './core/dates';

export function App() {
  // כשחוזרים לאפליקציה אחרי זמן: מרעננים את "היום" ומוודאים שיש אימונים מתוזמנים קדימה
  useEffect(() => {
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
      // חזרה אחרי כמה דקות: שוב מבט מהיר, כמו בכניסה לאפליקציה
      if (hiddenAt && Date.now() - hiddenAt > 3 * 60_000) {
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
      <SettingsScreen />
      <EditEntrySheet />
      <WorkoutSheet />
      <TrainingSheet />
      <SummarySheet />
      <StatSheet />
      <PlanSheet />
      <Onboarding />
      <CameraView />
      <ActMenu />
      <ToastView />
      <UpdateBanner />
    </>
  );
}
