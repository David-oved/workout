import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChartColumn, CalendarDays, House, Plus, Sparkles, RefreshCw } from 'lucide-preact';
import { ui, setUi, type Tab } from './ui';
import { updater, applyUpdate, dismissUpdate, APP_VERSION } from '../update/updater';

/** משאיר תוכן מוצג עוד רגע אחרי סגירה, כדי שהאנימציה תסתיים בלי "קפיצה" */
export function useLinger(open: boolean, ms = 600) {
  const [show, setShow] = useState(open);
  useEffect(() => {
    if (open) { setShow(true); return; }
    const t = setTimeout(() => setShow(false), ms);
    return () => clearTimeout(t);
  }, [open]);
  return open || show;
}

export function Ring({ size, stroke, pct, color, track = 'rgba(255,255,255,.08)', children, cls = '' }: {
  size: number; stroke: number; pct: number; color: string; track?: string; children?: ComponentChildren; cls?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  const mid = size / 2;
  return (
    <div class={cls} style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0, transform: 'scaleX(-1)' }}>
        <circle cx={mid} cy={mid} r={r} fill="none" stroke={track} stroke-width={stroke} />
        <circle class="fg" cx={mid} cy={mid} r={r} fill="none" stroke={color} stroke-width={stroke} stroke-linecap="round"
          stroke-dasharray={c} stroke-dashoffset={c * (1 - p)} transform={`rotate(-90 ${mid} ${mid})`} />
      </svg>
      {children}
    </div>
  );
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ComponentChildren }) {
  const show = useLinger(open);
  return (
    <>
      <div class={'bd' + (open ? ' on' : '')} onClick={onClose} />
      <div class={'g sheet' + (open ? ' on' : '')} role="dialog" aria-modal="true">
        <div class="grab" />
        {show && children}
      </div>
    </>
  );
}

export function FullScreen({ open, children }: { open: boolean; children: ComponentChildren }) {
  const show = useLinger(open);
  return <div class={'fs' + (open ? ' on' : '')}>{show && children}</div>;
}

const TABS: { id: Tab; label: string; Icon: typeof House }[] = [
  { id: 'progress', label: 'התקדמות', Icon: ChartColumn },
  { id: 'today', label: 'היום', Icon: House },
  { id: 'calendar', label: 'לוח שנה', Icon: CalendarDays },
];

export function Dock({ onAdd }: { onAdd: () => void }) {
  const tab = ui.use((s) => s.tab);
  const bub = useRef<HTMLDivElement>(null);
  const idx = TABS.findIndex((t) => t.id === tab);
  const go = (id: Tab) => {
    const el = bub.current;
    setUi({ tab: id });
    if (el) {
      el.style.setProperty('--sx', '1.12');
      el.style.setProperty('--sy', '.92');
      setTimeout(() => { el.style.setProperty('--sx', '1'); el.style.setProperty('--sy', '1'); }, 230);
    }
  };
  return (
    <div class="dock">
      <nav class="g bar" style={{ borderRadius: 34 }}>
        <div class="bub" ref={bub} style={{ '--i': idx } as any} />
        {TABS.map(({ id, label, Icon }) => (
          <button class={'tab' + (id === tab ? ' on' : '')} onClick={() => go(id)} aria-label={label}>
            <Icon strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>
      <button class="g addb" onClick={onAdd} aria-label="הוספה"><Plus strokeWidth={2.2} /></button>
    </div>
  );
}

export function ToastView() {
  const t = ui.use((s) => s.toast);
  const last = useRef(t);
  if (t) last.current = t;
  const cur = last.current;
  return (
    <div class={'g toast' + (t ? ' on' : '')} style={{ borderRadius: 25 }}>
      <span>{cur?.msg}</span>
      {cur?.undo && (
        <button onClick={() => { cur.undo?.(); setUi({ toast: null }); }}>ביטול</button>
      )}
    </div>
  );
}

export function UpdateBanner() {
  const u = updater.use((s) => s);
  const show = (u.status === 'available' || u.status === 'applying') && u.remote?.buildId !== u.dismissed;
  const notes = u.remote?.notes?.[0];
  return (
    <div class={'g upd' + (show ? ' on' : '')} role="status">
      <div class="ic">{u.status === 'applying' ? <RefreshCw class="spin" size={20} /> : <Sparkles size={20} />}</div>
      <div class="tx">
        <b>{u.status === 'applying' ? 'מעדכן…' : `עדכון זמין${u.remote ? ` · ${u.remote.version}` : ''}`}</b>
        <span>{notes ?? `אתה על גרסה ${APP_VERSION}`}</span>
      </div>
      {u.status !== 'applying' && (
        <>
          <button class="btn primary sm" onClick={() => void applyUpdate()}>עדכן</button>
          <button class="mu" style={{ padding: '6px 4px' }} onClick={dismissUpdate}>אחר כך</button>
        </>
      )}
    </div>
  );
}

export const Num = ({ v }: { v: number }) => <span class="num">{Math.round(v).toLocaleString('en-US')}</span>;
