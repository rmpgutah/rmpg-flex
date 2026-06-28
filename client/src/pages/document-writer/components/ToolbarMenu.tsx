import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** A click-to-open toolbar dropdown panel. Closes on outside-click / Escape.
 *  Used to group the many document-design features without an overwhelming flat
 *  toolbar. */
export default function ToolbarMenu({
  label, icon: Icon, children, width = 240,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-[2px] transition-colors ${
          open ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-300 hover:text-rmpg-100 hover:bg-surface-raised'
        }`}
      >
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span>{label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div
          className="absolute left-0 z-50 mt-1 bg-surface-base border border-rmpg-700 rounded-[2px] shadow-2xl shadow-black/60 p-2 space-y-1.5"
          style={{ width, maxWidth: 'calc(100vw - 1rem)' }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/** A labelled row inside a ToolbarMenu panel. */
export function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-rmpg-400 whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

/** A full-width action button inside a ToolbarMenu panel. */
export function MenuButton({ onClick, children, active }: { onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1 text-[11px] rounded-[2px] transition-colors ${
        active ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-200 hover:bg-surface-raised'
      }`}
    >
      {children}
    </button>
  );
}
