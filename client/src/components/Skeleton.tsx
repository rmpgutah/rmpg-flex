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
    <div className="card-dark p-3" style={{ borderLeft: '4px solid #2a3e58' }}>
      <Skeleton variant="text" width="60%" className="mb-2" />
      <Skeleton height="28px" width="80px" className="mb-2" />
      <Skeleton variant="text" width="50%" />
    </div>
  );
}
