import { get, set } from 'idb-keyval';
import { createStore } from '../core/store';
import { uid } from '../core/dates';

/**
 * ספריית מסמכים אישית (בדיקות דם, סיכומים רפואיים, תוכנית אימון, מאמרים).
 * נשמרת רק במכשיר (IndexedDB), לא נכנסת לגיבוי, ונשלחת ל-AI רק מסמכים שסימנת כ"כלולים".
 */
const KEY = 'workout:docs';
export interface Doc {
  id: string;
  name: string;
  mime: string;
  size: number;
  added: number;
  enabled: boolean;
  data?: string; // base64 (pdf, תמונות)
  text?: string; // טקסט רגיל
}
export type DocMeta = Omit<Doc, 'data' | 'text'>;

export const docsState = createStore<{ docs: DocMeta[]; loaded: boolean }>({ docs: [], loaded: false });
const strip = ({ data: _d, text: _t, ...m }: Doc): DocMeta => m;

let cache: Doc[] | null = null;
async function readAll(): Promise<Doc[]> {
  if (cache) return cache;
  try { cache = ((await get(KEY)) as Doc[] | undefined) ?? []; } catch { cache = []; }
  return cache;
}
async function writeAll(list: Doc[]) {
  cache = list;
  try { await set(KEY, list); } catch { /* ignore */ }
  docsState.set({ docs: list.map(strip), loaded: true });
}

export async function loadDocs() {
  const l = await readAll();
  docsState.set({ docs: l.map(strip), loaded: true });
}

const MAX_ONE = 8 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_INLINE = 12 * 1024 * 1024; // מה שנשלח בפועל בבקשה אחת

const OK_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif)|text\/(plain|markdown|csv))$/;

const fileToBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('קריאת הקובץ נכשלה'));
    r.readAsDataURL(f);
  });

export const guessMime = (f: File) => {
  if (f.type) return f.type;
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.md')) return 'text/markdown';
  if (n.endsWith('.txt')) return 'text/plain';
  return '';
};

export async function addDoc(file: File): Promise<{ ok: boolean; msg?: string }> {
  const mime = guessMime(file);
  if (!OK_TYPES.test(mime)) return { ok: false, msg: 'סוגי קבצים נתמכים: PDF, תמונה (JPG/PNG/WEBP/HEIC) וטקסט' };
  if (file.size > MAX_ONE) return { ok: false, msg: 'הקובץ גדול מדי (עד 8MB)' };
  const list = await readAll();
  if (list.reduce((a, d) => a + d.size, 0) + file.size > MAX_TOTAL) return { ok: false, msg: 'הספרייה מלאה (עד 20MB בסך הכל)' };
  const doc: Doc = { id: uid(), name: file.name, mime, size: file.size, added: Date.now(), enabled: true };
  if (mime.startsWith('text/')) doc.text = (await file.text()).slice(0, 200_000);
  else doc.data = await fileToBase64(file);
  await writeAll([...list, doc]);
  return { ok: true };
}

export async function removeDoc(id: string) {
  await writeAll((await readAll()).filter((d) => d.id !== id));
}
export async function toggleDoc(id: string, enabled: boolean) {
  await writeAll((await readAll()).map((d) => (d.id === id ? { ...d, enabled } : d)));
}

/** המסמכים שסומנו כ"כלולים", בפורמט שאפשר לשלוח ל-Gemini (עד תקרה כוללת) */
export async function enabledDocs() {
  const list = (await readAll()).filter((d) => d.enabled);
  const parts: { mime: string; data: string }[] = [];
  const texts: string[] = [];
  const names: string[] = [];
  let used = 0;
  for (const d of list) {
    if (d.text) { texts.push(`--- ${d.name} ---\n${d.text}`); names.push(d.name); continue; }
    if (!d.data) continue;
    const sz = Math.ceil((d.data.length * 3) / 4);
    if (used + sz > MAX_INLINE) continue;
    used += sz;
    parts.push({ mime: d.mime, data: d.data });
    names.push(d.name);
  }
  return { parts, texts, names };
}
