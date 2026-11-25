import { createStore } from '../core/store';

/** סורק ברקוד: מסך מצלמה מלא שנפתח מהחיפוש בהוספת ארוחה */
export const scan = createStore({ open: false });
export const openScanner = () => scan.set({ open: true });
export const closeScanner = () => scan.set({ open: false });
