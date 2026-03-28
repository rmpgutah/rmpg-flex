// ============================================================
// RMPG Flex — Mobile Bottom Sheet
// Draggable sheet that slides up from the bottom of the screen.
// Used primarily for the Map page overlays (layer controls,
// unit/call lists). Three snap points: collapsed, half, full.
// ============================================================

import React, { useRef, useState, useCallback, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────
type SnapPoint = 'collapsed' | 'half' | 'full';

interface MobileBottomSheetProps {
  /** Whether the bottom sheet is mounted */
  open: boolean;
  /** Called to dismiss the sheet entirely */
  onClose?: () => void;
  /** Initial snap point (default: 'collapsed') */
  initialSnap?: SnapPoint;
  /** Height when collapsed — just the handle + header visible */
  collapsedHeight?: number;
  /** Optional header content shown at top (always visible) */
  header?: React.ReactNode;
  /** Sheet content */
  children: React.ReactNode;
  /** Custom z-index */
  zIndex?: number;
}

// ─── Snap point heights (as percentage of viewport) ──────────
const SNAP_HEIGHTS: Record<SnapPoint, number> = {
  collapsed: 0, // Will use collapsedHeight instead
  half: 50,
  full: 90,
};

const DRAG_THRESHOLD = 40; // px before snap change

// ─── Component ───────────────────────────────────────────────
export default function MobileBottomSheet({
  open,
  onClose,
  initialSnap = 'collapsed',
  collapsedHeight = 72,
  header,
  children,
  zIndex = 40,
}: MobileBottomSheetProps) {
  const [snap, setSnap] = useState<SnapPoint>(initialSnap);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStartY = useRef(0);
  const touchStartHeight = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Reset snap when opened
  useEffect(() => {
    if (open) setSnap(initialSnap);
  }, [open, initialSnap]);

  // ── Calculate height based on snap point ───────────────────
  const getHeight = useCallback(
    (s: SnapPoint) => {
      if (s === 'collapsed') return collapsedHeight;
      return (window.innerHeight * SNAP_HEIGHTS[s]) / 100;
    },
    [collapsedHeight],
  );

  const currentHeight = getHeight(snap) - dragOffset;

  // ── Drag handlers ──────────────────────────────────────────
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
      touchStartHeight.current = getHeight(snap);
      setIsDragging(true);
    },
    [snap, getHeight],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - touchStartY.current;
      setDragOffset(dy);
    },
    [isDragging],
  );

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const finalHeight = touchStartHeight.current - dragOffset;
    const vh = window.innerHeight;

    // Determine nearest snap point
    if (dragOffset > DRAG_THRESHOLD) {
      // Dragged down — go to lower snap
      if (snap === 'full') setSnap('half');
      else if (snap === 'half') setSnap('collapsed');
      else if (onClose) onClose();
    } else if (dragOffset < -DRAG_THRESHOLD) {
      // Dragged up — go to higher snap
      if (snap === 'collapsed') setSnap('half');
      else if (snap === 'half') setSnap('full');
    }

    setDragOffset(0);
  }, [isDragging, dragOffset, snap, onClose]);

  // ── Tap handle to toggle ───────────────────────────────────
  const handleHandleTap = useCallback(() => {
    if (snap === 'collapsed') setSnap('half');
    else if (snap === 'half') setSnap('full');
    else setSnap('collapsed');
  }, [snap]);

  if (!open) return null;

  return (
    <div
      ref={sheetRef}
      className="fixed left-0 right-0 bottom-0 flex flex-col"
      style={{
        zIndex,
        height: Math.max(currentHeight, 0),
        maxHeight: '92vh',
        transition: isDragging ? 'none' : 'height 0.3s cubic-bezier(0.32,0.72,0,1)',
        background: 'linear-gradient(180deg, #1a2636 0%, #0d1520 100%)',
        borderTop: '1px solid #2a3e58',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        willChange: 'height',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* ── Drag Handle ──────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          height: 44,
          touchAction: 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleHandleTap}
      >
        <div
          style={{
            width: 36,
            height: 4,
            background: '#3a5070',
            borderRadius: 2,
          }}
        />
      </div>

      {/* ── Header (always visible) ──────────────────────── */}
      {header && (
        <div
          className="flex-shrink-0 px-4 pb-2"
          style={{ borderBottom: '1px solid #1e3048' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {header}
        </div>
      )}

      {/* ── Scrollable Content ────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          WebkitOverflowScrolling: 'touch',
          // Only allow scroll when not at collapsed snap
          overflowY: snap === 'collapsed' ? 'hidden' : 'auto',
        }}
      >
        {children}
      </div>

      {/* ── Blue accent at top border ──────────────────── */}
      <div
        className="absolute top-0 left-1/4 right-1/4 h-[2px]"
        style={{
          background: 'linear-gradient(90deg, transparent, #1a5a9e, transparent)',
        }}
      />
    </div>
  );
}
