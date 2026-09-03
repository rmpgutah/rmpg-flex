import React from 'react';

export type QuickFilter = 'all' | 'P1' | 'P2' | 'pending' | 'dispatched' | 'onscene' | 'mybeat';

interface CallFilterBarProps {
  active: QuickFilter;
  onChange: (filter: QuickFilter) => void;
  /** Beat id of the signed-in dispatcher — used for "My Beat" chip */
  myBeat?: string | null;
}

const CHIPS: { id: QuickFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'P1', label: 'P1' },
  { id: 'P2', label: 'P2' },
  { id: 'pending', label: 'Pending' },
  { id: 'dispatched', label: 'Dispatched' },
  { id: 'onscene', label: 'On Scene' },
  { id: 'mybeat', label: 'My Beat' },
];

export default function CallFilterBar({ active, onChange, myBeat }: CallFilterBarProps) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 border-b border-[var(--spm-border)] flex-shrink-0 flex-wrap"
      style={{ background: 'var(--surface-sunken)' }}
    >
      {CHIPS.map((chip) => {
        if (chip.id === 'mybeat' && !myBeat) return null;
        const isActive = active === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors rounded-sm ${
              isActive
                ? 'bg-rmpg-600 text-rmpg-100'
                : 'text-fg-muted hover:text-rmpg-200 hover:bg-surface-raised'
            }`}
            aria-pressed={isActive}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
