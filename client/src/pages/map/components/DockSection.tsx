// ============================================================
// RMPG Flex — Map Dock building blocks
// Shared accordion section + toggle row used by MapLeftDock,
// MapRightDock, and MapBottomTray so all three render the same
// section/toggle markup instead of duplicating it.
// ============================================================

import { useState, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Star } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { withAlpha } from '../../../utils/withAlpha';
import { useMapDensity } from '../hooks/useMapDensity';

export interface DockSectionProps {
  title: string;
  defaultOpen?: boolean;
  /** When false, renders as a static always-expanded header with no
   *  collapse control — for sections whose state must always stay
   *  visible (e.g. safety-critical toggles). Defaults to true. */
  collapsible?: boolean;
  onEnableAll?: () => void;
  onDisableAll?: () => void;
  children: ReactNode;
}

export default function DockSection({
  title, defaultOpen = true, collapsible = true, onEnableAll, onDisableAll, children,
}: DockSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const groupOps = onEnableAll || onDisableAll;

  const ops = groupOps ? (
    <span className="flex items-center gap-1 shrink-0">
      {onEnableAll && (
        <button
          type="button"
          className="px-1 text-[8px] font-semibold uppercase tracking-wide text-rmpg-400 hover:text-rmpg-100"
          onClick={onEnableAll}
        >
          All
        </button>
      )}
      {onDisableAll && (
        <button
          type="button"
          className="px-1 text-[8px] font-semibold uppercase tracking-wide text-rmpg-400 hover:text-rmpg-100"
          onClick={onDisableAll}
        >
          None
        </button>
      )}
    </span>
  ) : null;

  if (!collapsible) {
    return (
      <div className="border-b border-border-subtle">
        <div className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-400">
          <span>{title}</span>
          {ops}
        </div>
        <div className="pb-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="border-b border-border-subtle">
      {/* Title toggle and All/None are sibling controls — nested <button>
          inside the accordion header is invalid HTML and makes All/None
          unreliable in some browsers. */}
      <div className="w-full flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-400">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={isOpen}
          className="flex-1 min-w-0 flex items-center justify-between hover:text-rmpg-200 transition-colors text-left"
        >
          <span>{title}</span>
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {ops}
      </div>
      {isOpen && <div className="pb-1">{children}</div>}
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
  /** Set when the layer's most recent data fetch failed — renders a red
   *  alert icon in place of the loading spinner and replaces the tooltip. */
  error?: string | null;
  /** Renders a colored left-border accent so this toggle's state stays
   *  glanceable even among other rows — for safety-critical items. */
  pinned?: boolean;
  /** Leading icon from the layer registry. Optional so a row still renders
   *  if a caller supplies an ad-hoc item outside the registry. */
  icon?: LucideIcon;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}

export function DockToggleRow({ item }: { item: DockToggleItem }) {
  const { tokens } = useMapDensity();
  const dotColor = item.color ?? 'var(--brand-gold)';
  // Previously guarded with `.startsWith('#')` and fell back to the opaque
  // color, which was valid CSS but silently dropped the glow's transparency for
  // every token-valued dot. withAlpha keeps the alpha in both cases.
  const glowColor = withAlpha(dotColor, '80');
  const Icon = item.icon;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={item.active}
      onClick={item.onToggle}
      title={item.error || item.description}
      className="w-full flex items-center gap-2 px-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-silver-400)]"
      style={{
        minHeight: tokens.rowMinHeight,
        paddingTop: tokens.rowPaddingY,
        paddingBottom: tokens.rowPaddingY,
        fontSize: tokens.labelSize,
        background: item.active ? 'var(--surface-raised)' : 'transparent',
        color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderLeft: item.pinned ? `3px solid ${dotColor}` : undefined,
      }}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="shrink-0"
          style={{
            width: tokens.iconPx,
            height: tokens.iconPx,
            color: item.active ? dotColor : 'var(--text-secondary)',
            filter: item.active ? `drop-shadow(0 0 3px ${glowColor})` : undefined,
          }}
        />
      ) : (
        <span
          className="w-1.5 h-1.5 shrink-0"
          style={{
            borderRadius: '50%',
            background: item.active ? dotColor : 'var(--text-secondary)',
            boxShadow: item.active ? `0 0 4px ${glowColor}` : 'none',
          }}
        />
      )}
      <span className="flex-1 min-w-0 truncate text-left">{item.label}</span>
      {item.onToggleFavorite && (
        <span
          role="button"
          tabIndex={0}
          aria-label={item.favorite ? `Unfavorite ${item.label}` : `Favorite ${item.label}`}
          aria-pressed={item.favorite}
          className="shrink-0 p-0.5"
          style={{ color: item.favorite ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          onClick={(e) => { e.stopPropagation(); item.onToggleFavorite?.(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              e.preventDefault();
              item.onToggleFavorite?.();
            }
          }}
        >
          <Star className="w-3 h-3" fill={item.favorite ? 'currentColor' : 'none'} />
        </span>
      )}
      {item.error ? (
        <AlertCircle className="w-3 h-3 shrink-0" style={{ color: 'var(--sev-critical)' }} />
      ) : (
        item.loading && <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--brand-gold)' }} />
      )}
    </button>
  );
}
