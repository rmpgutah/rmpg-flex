// ============================================================
// RMPG Flex — Map Dock building blocks
// Shared accordion section + toggle row used by MapLeftDock,
// MapRightDock, and MapBottomTray so all three render the same
// section/toggle markup instead of duplicating it.
// ============================================================

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface DockSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function DockSection({ title, defaultOpen = true, children }: DockSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-400 hover:text-rmpg-200 transition-colors"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

export interface DockToggleItem {
  id: string;
  label: string;
  active: boolean;
  onToggle: () => void;
  color?: string;
  description?: string;
  loading?: boolean;
}

export function DockToggleRow({ item }: { item: DockToggleItem }) {
  const dotColor = item.color ?? 'var(--brand-gold)';
  const glowColor = dotColor.startsWith('#') ? `${dotColor}80` : dotColor;
  return (
    <button
      type="button"
      onClick={item.onToggle}
      title={item.description}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors"
      style={{
        background: item.active ? 'var(--surface-raised)' : 'transparent',
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      <span
        className="w-1.5 h-1.5 shrink-0"
        style={{
          borderRadius: '50%',
          background: item.active ? dotColor : 'var(--text-secondary)',
          boxShadow: item.active ? `0 0 4px ${glowColor}` : 'none',
        }}
      />
      <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
      {item.loading && (
        <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: 'var(--brand-gold)' }} />
      )}
    </button>
  );
}
