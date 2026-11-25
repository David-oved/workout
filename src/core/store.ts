import { useSyncExternalStore } from 'preact/compat';
import { useRef } from 'preact/hooks';

/** סטור קטן ללא תלויות: מצב אימוטבילי, מנויים, וה-hook לקריאה עם selector. */
export function createStore<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((s: T) => T)) {
      state = typeof next === 'function' ? (next as (s: T) => T)(state) : next;
      subs.forEach((f) => f());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /**
     * כמו use, אבל כשהמסך לא פעיל (סגור או מוסתר) הוא "קופא" על הערך האחרון ולא מתרנדר מחדש בכל שינוי במצב.
     * כשהוא נהיה פעיל שוב הוא מתעדכן מיד. חוסך עבודה במסכים שאף אחד לא רואה.
     */
    useWhen<R>(sel: (s: T) => R, active: boolean): R {
      const last = useRef<{ v: R } | null>(null);
      return useSyncExternalStore(
        (cb) => {
          subs.add(cb);
          return () => subs.delete(cb);
        },
        () => {
          if (active || !last.current) last.current = { v: sel(state) };
          return last.current.v;
        },
      );
    },
    use<R>(sel: (s: T) => R): R {
      return useSyncExternalStore(
        (cb) => {
          subs.add(cb);
          return () => subs.delete(cb);
        },
        () => sel(state),
      );
    },
  };
}
