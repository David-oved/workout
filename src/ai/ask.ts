import { openAdd, toast } from '../ui/ui';
import { aiState } from './gemini';
import { chat, sendMessage } from './chat';

/** האם ה-AI מחובר (פעולות "שאל" מוצגות רק אז) */
export const aiReady = () => aiState.get().configured;

/**
 * פותח את השיחה ושולח שאלה מוכנה. hint הוא הקשר נסתר ל-AI (לא מוצג בשיחה), למשל המספרים של מה שנלחץ.
 * מופעל רק מתפריט לחיצה ארוכה, אחרי שבחרת בו.
 */
export function askAi(text: string, o?: { hint?: string; date?: string; slot?: string }) {
  openAdd(o?.slot, o?.date, 'chat');
  if (!aiReady()) return;
  if (chat.get().busy) { toast('ה-AI באמצע תשובה, אפשר לשלוח אחריה'); return; }
  void sendMessage(text, [], { hint: o?.hint });
}
