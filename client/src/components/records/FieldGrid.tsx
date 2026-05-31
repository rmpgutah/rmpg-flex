// ============================================================
// RMPG Flex — Field Grid
// Responsive grid wrapper for RecordField rows. Collapses to a
// single column on narrow panels, fans out to N columns when wide.
// ============================================================

import React from 'react';

interface FieldGridProps {
  children: React.ReactNode;
  /** Max columns on wide panels (1–4). Always 1 column on mobile. */
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}

const COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

function FieldGrid({ children, cols = 2, className = '' }: FieldGridProps) {
  return (
    <div className={`grid ${COLS_CLASS[cols]} gap-x-4 gap-y-0.5 ${className}`}>
      {children}
    </div>
  );
}

export default React.memo(FieldGrid);
