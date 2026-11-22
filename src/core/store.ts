import { useSyncExternalStore } from 'preact/compat';

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
