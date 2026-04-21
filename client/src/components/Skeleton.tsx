// ============================================================
// RMPG Flex — Loading Skeleton Components
// Pulse-animated placeholders for content loading states
// ============================================================

import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'rect' | 'circle';
  width?: string;
  height?: string;
  count?: number;
}

export function Skeleton({
  className = '',
  variant = 'rect',
  width,
  height,
  count = 1,
}: SkeletonProps) {
  const base = 'animate-pulse';
  const variantClass =
    variant === 'circle'
      ? 'rounded-full'
      : variant === 'text'
        ? 'h-3'
        : '';

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`${base} ${variantClass} ${className}`}
          style={{ width, height, background: 'var(--surface-sunken, rgba(48, 48, 48, 0.5))' }}
        />
      ))}
    </>
  );
}

export function TableRowSkeleton({ cols = 7 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton variant="text" width={i === 0 ? '80px' : '60%'} />
        </td>
      ))}
    </tr>
  );
}

export function CardSkeleton() {
  return (
    <div className="card-dark p-3 space-y-2">
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="text" width="70%" />
      <Skeleton variant="text" width="55%" />
    </div>
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="card-dark p-3" style={{ borderLeft: '4px solid #2a2a2a' }}>
      <Skeleton variant="text" width="60%" className="mb-2" />
      <Skeleton height="28px" width="80px" className="mb-2" />
      <Skeleton variant="text" width="50%" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 17: Enhanced Loading Skeletons
// ═══════════════════════════════════════════════════════════════

/** Detail panel skeleton with header + rows */
export function DetailPanelSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="panel-beveled bg-surface-base p-4 space-y-3">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton variant="circle" width="32px" height="32px" />
        <div className="flex-1 space-y-1.5">
          <Skeleton variant="text" width="45%" />
          <Skeleton variant="text" width="30%" />
        </div>
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="text" width="25%" />
          <Skeleton variant="text" width={`${40 + Math.random() * 30}%`} />
        </div>
      ))}
    </div>
  );
}

/** Full table skeleton with header + rows */
export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel-beveled bg-surface-base overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2b2b2b]">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} variant="text" width={i === 0 ? '100px' : `${60 + Math.random() * 40}px`} className="flex-shrink-0" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2b2b2b]/50">
          {Array.from({ length: cols }).map((_, colIdx) => (
            <Skeleton key={colIdx} variant="text" width={colIdx === 0 ? '80px' : `${50 + Math.random() * 50}px`} className="flex-shrink-0" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chart placeholder skeleton */
export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="panel-beveled bg-surface-base">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <Skeleton variant="text" width="120px" />
      </div>
      <div className="p-4 flex items-end gap-1" style={{ height }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={`${20 + Math.random() * 70}%`} className="flex-1" />
        ))}
      </div>
    </div>
  );
}

/** Dashboard widget skeleton */
export function WidgetSkeleton() {
  return (
    <div className="panel-beveled bg-surface-base p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton variant="circle" width="20px" height="20px" />
        <Skeleton variant="text" width="60%" />
      </div>
      <Skeleton height="32px" width="50%" />
      <Skeleton variant="text" width="40%" />
    </div>
  );
}
