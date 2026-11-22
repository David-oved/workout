/**
 * שכבת ה-AI העתידית (שלב 3). עדיין לא מחוברת לשום ספק.
 * הרעיון: ה-AI מקבל את רשימת הכלים הזו (Tool Calling), ומחזיר קריאות לפעולות ב-actions.ts,
 * כך שהוא יכול לעשות בדיוק את מה שהמשתמש עושה ב-UI. כל פעולה שהוא מציע עוברת אישור ("מציע ואני מאשר").
 */
import { actions } from '../core/actions';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** מחזירה פעולה שמחכה לאישור המשתמש */
  prepare: (args: any) => { summary: string; run: () => void };
}

export const TOOLS: ToolDef[] = [
  {
    name: 'add_meal_entry',
    description: 'מוסיף מנה ליומן התזונה',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        slot: { type: 'string', description: 'מזהה ארוחה (breakfast, lunch, dinner, snack)' },
        name: { type: 'string' },
        k: { type: 'number', description: 'קלוריות' },
        p: { type: 'number', description: 'חלבון בגרמים' },
        c: { type: 'number', description: 'פחמימה בגרמים' },
        f: { type: 'number', description: 'שומן בגרמים' },
      },
      required: ['date', 'slot', 'name', 'k'],
    },
    prepare: (a) => ({
      summary: `להוסיף: ${a.name} (${a.k} קל׳)`,
      run: () => void actions.addEntry({ date: a.date, slot: a.slot, name: a.name, k: a.k, p: a.p ?? 0, c: a.c ?? 0, f: a.f ?? 0, est: true }),
    }),
  },
  {
    name: 'delete_entry',
    description: 'מוחק מנה מהיומן לפי מזהה',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    prepare: (a) => ({ summary: 'למחוק מנה', run: () => actions.deleteEntry(a.id) }),
  },
  {
    name: 'skip_workout',
    description: 'מבטל אימון מתוכנן',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    prepare: (a) => ({ summary: 'לבטל אימון', run: () => actions.updateWorkout(a.id, { status: 'skipped' }) }),
  },
];
