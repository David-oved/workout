import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { createStore } from '../core/store';
import { Sheet } from './components';

/**
 * תפריט פעולות ללחיצה ארוכה: חלון קטן מלמטה עם כמה פעולות. נפתח מכל מקום עם openMenu.
 * hold(fn) מחזיר מאזינים שמפעילים את fn אחרי החזקה של חצי שנייה (בלי להפריע לגלילה ולהקשה רגילה).
 */
export interface MenuItem { label: string; icon?: ComponentChildren; run: () => void; ai?: boolean }
interface MenuState { id: number; title: string; sub?: string; items: MenuItem[] }

export const actMenu = createStore<{ menu: MenuState | null }>({ menu: null });
let openedAt = 0;
let seq = 0;

export function openMenu(title: string, items: MenuItem[], sub?: string) {
  if (!items.length) return;
  openedAt = Date.now();
  actMenu.set(() => ({ menu: { id: ++seq, title, sub, items } }));
}
export const closeMenu = () => actMenu.set(() => ({ menu: null }));

const HOLD: WeakMap<EventTarget, { t?: ReturnType<typeof setTimeout>; h?: ReturnType<typeof setTimeout>; x: number; y: number; fired: number }> = new WeakMap();

function stop(el: HTMLElement, s: { t?: ReturnType<typeof setTimeout>; h?: ReturnType<typeof setTimeout> }) {
  clearTimeout(s.t); clearTimeout(s.h);
  s.t = s.h = undefined;
  el.classList.remove('holding');
}

/** מאזינים להחזקה ארוכה על אלמנט. אחרי שהתפריט נפתח, ההקשה שמגיעה בסיום ההחזקה נבלעת */
export function hold(fn: () => void, ms = 480) {
  return {
    'data-hold': '',
    onPointerDown(e: PointerEvent) {
      if (e.button > 0) return;
      const el = e.currentTarget as HTMLElement;
      const prev = HOLD.get(el);
      const s = { x: e.clientX, y: e.clientY, fired: prev?.fired ?? 0 } as NonNullable<ReturnType<typeof HOLD.get>>;
      if (prev) stop(el, prev);
      HOLD.set(el, s);
      s.h = setTimeout(() => el.classList.add('holding'), 160);
      s.t = setTimeout(() => {
        s.t = undefined;
        el.classList.remove('holding');
        s.fired = Date.now();
        fn();
      }, ms);
    },
    onPointerMove(e: PointerEvent) {
      const el = e.currentTarget as HTMLElement;
      const s = HOLD.get(el);
      if (s && (s.t || s.h) && (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10)) stop(el, s);
    },
    onPointerUp(e: PointerEvent) { const el = e.currentTarget as HTMLElement; const s = HOLD.get(el); if (s) stop(el, s); },
    onPointerCancel(e: PointerEvent) { const el = e.currentTarget as HTMLElement; const s = HOLD.get(el); if (s) stop(el, s); },
    onPointerLeave(e: PointerEvent) { const el = e.currentTarget as HTMLElement; const s = HOLD.get(el); if (s) stop(el, s); },
    onContextMenu(e: Event) { e.preventDefault(); },
    onClickCapture(e: Event) {
      const s = HOLD.get(e.currentTarget as HTMLElement);
      if (s && Date.now() - s.fired < 700) { e.stopPropagation(); e.preventDefault(); }
    },
  };
}

export function ActMenu() {
  const menu = actMenu.use((s) => s.menu);
  const last = useRef<MenuState | null>(null);
  if (menu) last.current = menu;
  const cur = last.current;
  return (
    <Sheet open={!!menu} onClose={closeMenu}>
      {cur && (
        <div class="am">
          <div class="am-h"><b>{cur.title}</b>{cur.sub && <small>{cur.sub}</small>}</div>
          {cur.items.map((it) => (
            <button class={'am-i' + (it.ai ? ' ai' : '')} key={it.label} onClick={() => {
              // ההקשה שמגיעה מיד אחרי סיום ההחזקה לא בוחרת פעולה בטעות
              if (Date.now() - openedAt < 420) return;
              closeMenu();
              setTimeout(it.run, 60);
            }}>
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
