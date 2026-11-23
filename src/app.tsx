import { useEffect } from 'preact/hooks';
import { Dock, ToastView, UpdateBanner } from './ui/components';
import { CameraView } from './ui/CameraView';
import { TrainingSheet } from './screens/Training';
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
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
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

  return (
    <>
      <ProgressScreen />
      <TodayScreen />
      <CalendarScreen />
      <Dock onAdd={() => openAdd()} />
      <AddScreen />
      <SettingsScreen />
      <EditEntrySheet />
      <WorkoutSheet />
      <TrainingSheet />
      <CameraView />
      <ToastView />
      <UpdateBanner />
    </>
  );
}
