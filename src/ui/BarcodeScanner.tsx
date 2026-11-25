import { useEffect, useRef, useState } from 'preact/hooks';
import { X, Check, RefreshCw, Camera as CamIcon, Search } from 'lucide-preact';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { scan, closeScanner } from './scan';
import { useLinger } from './components';
import { openCamera } from './camera';
import { beep } from './fx';
import { actions } from '../core/actions';
import { store } from '../core/state';
import { uid } from '../core/dates';
import { getFood } from '../data/foodDb';
import { lookupBarcode, validCode, type ScanProduct } from '../data/barcode';
import { lastAmount, trayAddFood } from './tray';

/** כמה להוסיף כברירת מחדל: מה שאכלת בפעם הקודמת, אחרת מנה אחת, אחרת 100 גרם (אריזה שלמה היא לא ברירת מחדל טובה) */
const startAmount = (id: string, portions?: Portion[]) => lastAmount('c:' + id) ?? portions?.find((p) => p.l === 'מנה')?.g ?? 100;
import { openAdd, toast } from './ui';
import { aiState } from '../ai/gemini';
import { fileToAttachment } from '../ai/image';
import { sendMessage } from '../ai/chat';
import type { Portion } from '../core/types';

/**
 * סורק ברקוד: המצלמה קוראת, מחפשים קודם במוצרים ששמרת ואז ב-Open Food Facts, ומראים כרטיס לאישור ותיקון.
 * מוצר שאושר נשמר עם הברקוד שלו, כך שבפעם הבאה הוא נכנס לארוחה בסריקה אחת, גם בלי רשת.
 * בדפדפנים בלי קורא ברקוד מובנה (iOS) משתמשים ב-ZXing ב-WebAssembly, שנטען מקומית ורק בפעם הראשונה שסורקים.
 */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
let detectorP: Promise<Detector> | null = null;

function getDetector(): Promise<Detector> {
  detectorP ??= (async () => {
    const W = window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } };
    if (W.BarcodeDetector) {
      try {
        const sup = (await W.BarcodeDetector.getSupportedFormats?.()) ?? [];
        if (FORMATS.some((f) => sup.includes(f))) return new W.BarcodeDetector({ formats: FORMATS });
      } catch { /* ממשיכים לגיבוי */ }
    }
    const m = await import('barcode-detector/ponyfill');
    m.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
    return new m.BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
  })();
  detectorP.catch(() => { detectorP = null; });
  return detectorP;
}

interface Form { code: string; name: string; brand: string; k: string; p: string; c: string; f: string; sg: string; pack: string }
const n1 = (v: number) => String(Math.round(v * 10) / 10);
const num = (v: string) => Number(v.replace(',', '.')) || 0;
const emptyForm = (code: string): Form => ({ code, name: '', brand: '', k: '', p: '', c: '', f: '', sg: '', pack: '' });
const fromProduct = (p: ScanProduct): Form => ({ code: p.code, name: p.name, brand: p.brand ?? '', k: p.complete ? String(p.per.k) : '', p: p.complete ? n1(p.per.p) : '', c: p.complete ? n1(p.per.c) : '', f: p.complete ? n1(p.per.f) : '', sg: p.servingG ? String(p.servingG) : '', pack: p.packG ? String(p.packG) : '' });

export function BarcodeScanner() {
  const open = scan.use((s) => s.open);
  const show = useLinger(open, 350);
  const vid = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<'scan' | 'load' | 'card'>('scan');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState<Form>(emptyForm(''));
  const [typed, setTyped] = useState('');
  const set = (patch: Partial<Form>) => setForm((x) => ({ ...x, ...patch }));

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (vid.current) vid.current.srcObject = null;
    setReady(false);
  };

  const handle = async (code: string) => {
    setPhase('load');
    setForm(emptyForm(code));
    const r = await lookupBarcode(code);
    if (!scan.get().open) return;
    if (r.kind === 'local') {
      // מוצר ששמרת בעבר: ישר לארוחה
      const rec = getFood('c:' + r.food.id, store.get());
      if (rec) trayAddFood(rec, startAmount(r.food.id, r.food.portions));
      toast(`${r.food.name} נוסף לארוחה`);
      closeScanner();
      return;
    }
    if (r.kind === 'off') {
      setForm(fromProduct(r.product));
      setNote(r.product.complete ? 'מ-Open Food Facts (נתוני קהילה). כדאי לבדוק מול האריזה.' : 'המוצר נמצא, אבל בלי ערכים תזונתיים. משלימים מהאריזה.');
    } else {
      setNote(r.reason === 'notfound' ? 'המוצר לא נמצא ב-Open Food Facts. אפשר להזין מהאריזה או לצלם את התווית.' : r.reason === 'offline' ? 'אין חיבור לאינטרנט. אפשר להזין ידנית.' : 'החיפוש נכשל כרגע. אפשר להזין ידנית או לסרוק שוב.');
    }
    setPhase('card');
  };

  useEffect(() => {
    if (!open) { stop(); return; }
    let dead = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let busy = false;
    setErr(''); setPhase('scan'); setNote(''); setTyped('');
    void getDetector().catch(() => undefined); // טעינה מוקדמת של הקורא
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = vid.current;
        if (v) { v.srcObject = s; await v.play().catch(() => undefined); }
        setReady(true);
        const det = await getDetector();
        timer = setInterval(async () => {
          const el = vid.current;
          if (busy || dead || phaseRef.current !== 'scan' || !el || !el.videoWidth) return;
          busy = true;
          try {
            const res = await det.detect(el);
            const code = res.map((x) => x.rawValue).find(validCode);
            if (code && !dead && phaseRef.current === 'scan') { beep(1); void handle(code); }
          } catch { /* פריים בעייתי: ממשיכים */ } finally { busy = false; }
        }, 160);
      } catch (e) {
        const name = (e as Error).name;
        setErr(name === 'NotAllowedError' ? 'אין הרשאה למצלמה. אפשר לאשר בהגדרות האייפון, או להקליד את הברקוד.' : 'לא הצלחתי לפתוח את המצלמה או את הקורא. אפשר להקליד את הברקוד.');
      }
    })();
    const onHide = () => { if (document.visibilityState !== 'visible') closeScanner(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { dead = true; clearInterval(timer); document.removeEventListener('visibilitychange', onHide); stop(); };
  }, [open]);

  const save = () => {
    const name = form.name.trim();
    const k = num(form.k);
    if (!name || !k) { toast('חסרים שם או קלוריות'); return; }
    const full = form.brand.trim() ? `${name} (${form.brand.trim()})` : name;
    const per = { k, p: num(form.p), c: num(form.c), f: num(form.f) };
    const sg = num(form.sg);
    const pk = num(form.pack);
    const portions: Portion[] = [];
    if (sg > 0) portions.push({ l: 'מנה', g: sg });
    if (pk > 0 && pk !== sg) portions.push({ l: 'אריזה', g: pk });
    const have = store.get().customFoods.find((x) => x.barcode === form.code);
    const id = have?.id ?? uid();
    actions.saveCustomFood({ id, name: full, unit: 'g', per, portions: portions.length ? portions : undefined, barcode: form.code });
    const rec = getFood('c:' + id, store.get());
    if (rec) trayAddFood(rec, sg > 0 ? sg : 100);
    toast(`${full} נשמר ונוסף לארוחה`);
    closeScanner();
  };

  /** תווית שצולמה: ה-AI קורא אותה ומציע מוצר חדש לאישור, והברקוד מצורף לבקשה */
  const labelPhoto = () => {
    const code = form.code;
    const hint = form.name.trim() ? ` ${form.name.trim()}` : '';
    closeScanner();
    openAdd(undefined, undefined, 'chat');
    openCamera(async (files) => {
      try {
        const out = await Promise.all(files.slice(0, 2).map((f) => fileToAttachment(f)));
        void sendMessage(`ברקוד ${code}${hint}`, out, { product: true });
      } catch (e) { toast((e as Error).message); }
    });
  };

  const again = () => { setPhase('scan'); setNote(''); };

  if (!show) return null;
  return (
    <div class={'cam scan' + (open ? ' on' : '')} role="dialog" aria-label="סורק ברקוד">
      <video ref={vid} class={ready ? 'rd' : ''} playsInline muted autoplay />
      <button class="cam-x" aria-label="סגור" onClick={closeScanner}><X /></button>
      {phase === 'scan' && (
        <>
          <div class="scan-frame" aria-hidden="true"><i /><i /><i /><i /></div>
          <div class="scan-hint">{err || (ready ? 'כוון את הברקוד למסגרת' : 'פותח מצלמה…')}</div>
          <form class="scan-type" onSubmit={(e) => { e.preventDefault(); const c = typed.replace(/\D/g, ''); if (!validCode(c)) { toast('ברקוד תקין הוא 8, 12 או 13 ספרות'); return; } void handle(c); }}>
            <input class="inp num" inputMode="numeric" value={typed} placeholder="או הקלד ברקוד" aria-label="הקלד ברקוד" onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
            <button class="btn sm" type="submit" aria-label="חפש"><Search /></button>
          </form>
        </>
      )}
      {phase === 'load' && <div class="scan-hint"><RefreshCw class="spin" /> מחפש את המוצר…</div>}
      {phase === 'card' && (
        <div class="scan-sheet g">
          <div class="pc-h"><span>ברקוד <b class="num" dir="ltr">{form.code}</b></span></div>
          <div class="pc-name">
            <input class="inp" value={form.name} placeholder="שם המוצר" aria-label="שם המוצר" onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
            <input class="inp br" value={form.brand} placeholder="מותג" aria-label="מותג" onInput={(e) => set({ brand: (e.target as HTMLInputElement).value })} />
          </div>
          <div class="pc-sub">הערכים ל-100 גרם</div>
          <div class="pc-grid">
            <label><span>קלוריות</span><input class="inp num" inputMode="decimal" value={form.k} onInput={(e) => set({ k: (e.target as HTMLInputElement).value })} /></label>
            <label><span>חלבון</span><input class="inp num" inputMode="decimal" value={form.p} onInput={(e) => set({ p: (e.target as HTMLInputElement).value })} /></label>
            <label><span>פחמימה</span><input class="inp num" inputMode="decimal" value={form.c} onInput={(e) => set({ c: (e.target as HTMLInputElement).value })} /></label>
            <label><span>שומן</span><input class="inp num" inputMode="decimal" value={form.f} onInput={(e) => set({ f: (e.target as HTMLInputElement).value })} /></label>
          </div>
          <div class="scan-sv">
            <label><span>מנה (ג׳)</span><input class="inp num" inputMode="decimal" value={form.sg} placeholder="אופציונלי" onInput={(e) => set({ sg: (e.target as HTMLInputElement).value })} /></label>
            <label><span>אריזה (ג׳)</span><input class="inp num" inputMode="decimal" value={form.pack} placeholder="אופציונלי" onInput={(e) => set({ pack: (e.target as HTMLInputElement).value })} /></label>
          </div>
          {note && <div class="pc-note">{note}</div>}
          <div class="pc-acts">
            <button class="btn primary" onClick={save}><Check />שמור והוסף לארוחה</button>
            {aiState.get().configured && <button class="btn" onClick={labelPhoto}><CamIcon />צלם תווית</button>}
            <button class="btn" onClick={again}>סרוק שוב</button>
          </div>
        </div>
      )}
    </div>
  );
}
