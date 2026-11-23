import { createStore } from '../core/store';

/** מצלמה מובנית: נפתחת מיד (בלי חלון בחירה של המערכת), עם כפתור גלריה בתוכה */
export const cam = createStore({ open: false });
let cb: ((files: File[]) => void) | null = null;

export function openCamera(onFiles: (files: File[]) => void) {
  cb = onFiles;
  cam.set({ open: true });
}
export function closeCamera() {
  cam.set({ open: false });
  cb = null;
}
export function deliverFiles(files: File[]) {
  const f = cb;
  closeCamera();
  if (files.length) f?.(files);
}
