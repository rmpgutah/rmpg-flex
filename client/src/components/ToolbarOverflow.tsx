import { useState, useRef, useLayoutEffect, useCallback, useEffect, Children, type ReactNode, type CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * How many toolbar items fit on one row before the overflow button is needed.
 *
 * Pure so the packing rule is testable without a DOM. Returns the number of
 * leading items to render inline; the remainder belong in the overflow menu.
 *
 * The subtlety is that reserving room for the "More" button can itself push an
 * item out, which is why the all-items-fit case is checked FIRST and separately:
 * if everything fits there is no More button, so its width must not be counted.
 */
export function computeVisibleCount(
  widths: number[],
  gap: number,
  containerWidth: number,
  moreWidth: number,
  minVisible = 1,
): number {
  if (widths.length === 0) return 0;
  if (containerWidth <= 0) return widths.length; // pre-measurement: render all

  const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
  if (total <= containerWidth) return widths.length;

  // Overflow is real, so the More button will be shown and must be paid for.
  const budget = containerWidth - moreWidth - gap;
  let used = 0;
  let count = 0;
  for (const w of widths) {
    const next = used + (count > 0 ? gap : 0) + w;
    if (next > budget) break;
    used = next;
    count++;
  }
  // Never collapse to nothing — a toolbar showing only "More" is worse than one
  // slightly over its budget.
  return Math.max(minVisible, Math.min(count, widths.length));
}

interface ToolbarOverflowProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Accessible label for the overflow trigger. */
  moreLabel?: string;
  /** Items always kept inline, counted from the start. */
  pinnedCount?: number;
}

/**
 * A single-row toolbar that moves whatever does not fit into an overflow menu.
 *
 * WHY THIS EXISTS
 * The dispatch call-detail toolbar held 18 controls in a `overflow-x-auto` row.
 * At a 1354px viewport only 5 were reachable; the other 13 — including Edit,
 * NCIC, Citation, Archive and Delete — sat behind a hairline horizontal
 * scrollbar with a mask-fade as the only hint they existed. A dispatcher could
 * not edit a call or run NCIC from the primary console without discovering that
 * the row scrolled sideways.
 *
 * Each child is rendered EXACTLY ONCE, either inline or in the menu — never
 * both. Rendering a hidden duplicate set for measurement would double-mount
 * stateful children (PrintRecordButton owns a preview modal), so widths are
 * measured once while inline and cached by slot index instead.
 *
 * Children are consumed as an opaque list: a caller can pass existing
 * conditional JSX unchanged, and a `<>…</>` group of related buttons (Save +
 * Cancel) counts as one item and moves together, which is the behaviour you
 * want anyway.
 */
export default function ToolbarOverflow({
  children,
  className = '',
  style,
  moreLabel = 'More actions',
  pinnedCount = 0,
}: ToolbarOverflowProps) {
  const items = Children.toArray(children).filter(Boolean);
  const containerRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const widthCache = useRef<Map<number, number>>(new Map());

  const [visibleCount, setVisibleCount] = useState(items.length);
  const [open, setOpen] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Cache each inline item's width by slot. Items currently in the menu keep
    // their previously-measured width, which is what makes a single render pass
    // sufficient.
    itemRefs.current.forEach((node, i) => {
      if (node && node.offsetWidth > 0) widthCache.current.set(i, node.offsetWidth);
    });

    const style = getComputedStyle(el);
    const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const avail = el.clientWidth - padX;

    // An unmeasured item (never yet rendered inline) is optimistically assumed
    // narrow; it gets a real width on the next pass once it lands inline.
    const widths = items.map((_, i) => widthCache.current.get(i) ?? 0);
    const moreWidth = moreRef.current?.offsetWidth || 0;

    const next = computeVisibleCount(widths, gap, avail, moreWidth, Math.max(1, pinnedCount));
    setVisibleCount((prev) => (prev === next ? prev : next));
  }, [items.length, pinnedCount]);

  useLayoutEffect(() => { measure(); });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const inline = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);

  return (
    <div ref={containerRef} className={className} style={style}>
      {inline.map((child, i) => (
        <span
          key={i}
          ref={(n) => { itemRefs.current[i] = n; }}
          className="flex items-center gap-1.5 shrink-0"
        >
          {child}
        </span>
      ))}

      {/* Rendered even when empty so its width is known before it is needed —
          otherwise the first overflow would mis-measure by the button's width. */}
      <div ref={moreRef} className="relative shrink-0" style={{ display: overflow.length ? undefined : 'none' }}>
        <button
          type="button"
          className="toolbar-btn"
          aria-label={moreLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`${moreLabel} (${overflow.length})`}
          onClick={() => setOpen((v) => !v)}
        >
          More <span style={{ opacity: 0.7 }}>({overflow.length})</span>
          <ChevronDown style={{ width: 10, height: 10 }} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 flex flex-col items-stretch gap-0.5 p-1 shadow-lg"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--spm-border)',
              minWidth: 180,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
            onClick={() => setOpen(false)}
          >
            {overflow.map((child, i) => (
              <span key={visibleCount + i} className="flex items-center gap-1.5 [&>button]:w-full [&>button]:justify-start">
                {child}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
