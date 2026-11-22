import { store, replaceAll } from './state';
import { actions } from './actions';
import { todayKey } from './dates';
import { APP_VERSION } from '../update/updater';

export async function exportBackup(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const s = store.get();
  const json = JSON.stringify({ app: 'workOut', version: APP_VERSION, exportedAt: new Date().toISOString(), data: s }, null, 2);
  const name = `workOut-backup-${todayKey(s.settings.resetHour)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'גיבוי workOut' });
      actions.markBackup();
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  actions.markBackup();
  return 'downloaded';
}

export async function importBackup(file: File): Promise<boolean> {
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed?.data ?? parsed;
    if (!data?.settings || !Array.isArray(data?.entries)) return false;
    replaceAll(data);
    return true;
  } catch {
    return false;
  }
}
