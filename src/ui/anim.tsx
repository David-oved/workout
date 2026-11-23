import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt } from '../core/calc';
import { fxOn } from './fx';

/** מספר שסופר אל הערך החדש (במקום לקפוץ אליו) */
export function CountNum({ v, ms = 700, raw = false }: { v: number; ms?: number; raw?: boolean }) {
  const [shown, setShown] = useState(v);
  const from = useRef(v);
  const raf = useRef(0);
  useEffect(() => {
    if (!fxOn()) { from.current = v; setShown(v); return; }
    const a = from.current, b = v;
    if (a === b) return;
    const t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const cur = a + (b - a) * (1 - Math.pow(1 - k, 3));
      from.current = cur;
      setShown(cur);
      if (k < 1) raf.current = requestAnimationFrame(step); else from.current = b;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [v]);
  const n = Math.round(shown);
  return <>{raw ? n : fmt(n)}</>;
}
