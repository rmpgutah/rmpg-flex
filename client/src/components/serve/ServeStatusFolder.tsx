import React, { useState, useEffect, useCallback, useId } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';

// ── Public types ────────────────────────────────────────────────────────────

export type FolderStatus = 'in_progress' | 'pending' | 'served' | 'failed' | 'archived' | 'skipped' | string;

export interface ServeStatusFolderProps {
  /** Status key — drives default color coding and localStorage persistence */
  status: FolderStatus;
  /** Human-readable folder label */
  label: string;
  /** Number of jobs in this folder */
  count: number;
  /** Child job cards */
  children: React.ReactNode;
  /** Whether the folder starts expanded (ignored if a localStorage value exists) */
  defaultOpen?: boolean;
  /** Optional leading icon component (Lucide icon). Defaults to Folder. */
  icon?: React.ElementType;
  /** Tailwind text/bg color class for the status dot, e.g. 'text-amber-500'. Overrides built-in. */
  color?: string;
  /** Tailwind border-l color class for the left accent, e.g. 'border-l-amber-500'. Overrides built-in. */
  accentColor?: string;
  /** True when the folder contains zero items — renders a placeholder row */
  isEmpty?: boolean;
  /**
   * When provided a bulk-action button renders on the right of the header
   * (only visible when open and count > 0).
   * Receives the action key ('clear-all' | 'archive-all' | …).
   */
  onBulkAction?: (action: string) => void;
  /**
   * Controlled collapse — when supplied, overrides local + persisted state.
   * Pass undefined to let the folder manage its own state.
   */
  forceOpen?: boolean;
}

// ── Status-derived defaults ─────────────────────────────────────────────────

interface StatusDefaults {
  dotClass: string;       // Tailwind classes for the status dot
  borderClass: string;    // border-l-* class
  bgTintClass: string;    // subtle background tint for the whole folder
  emptyText: string;
  bulkLabel: string;      // label shown on the bulk-action button
  bulkAction: string;     // action key passed to onBulkAction
}

const STATUS_DEFAULTS: Record<string, StatusDefaults> = {
  in_progress: {
    dotClass:    'bg-amber-500 animate-pulse',
    borderClass: 'border-l-amber-500',
    bgTintClass: 'bg-amber-900/10',
    emptyText:   'No jobs in progress',
    bulkLabel:   'Mark all served',
    bulkAction:  'mark-all-served',
  },
  pending: {
    dotClass:    'bg-rmpg-500',
    borderClass: 'border-l-rmpg-500',
    bgTintClass: '',
    emptyText:   'No pending jobs',
    bulkLabel:   'Clear queue',
    bulkAction:  'clear-all',
  },
  served: {
    dotClass:    'bg-green-500',
    borderClass: 'border-l-green-500',
    bgTintClass: 'bg-green-900/10',
    emptyText:   'No served jobs today',
    bulkLabel:   'Archive all',
    bulkAction:  'archive-all',
  },
  failed: {
    dotClass:    'bg-red-500',
    borderClass: 'border-l-red-500',
    bgTintClass: 'bg-red-900/10',
    emptyText:   'No non-service jobs',
    bulkLabel:   'Archive all',
    bulkAction:  'archive-all',
  },
  archived: {
    dotClass:    'bg-rmpg-600',
    borderClass: 'border-l-rmpg-600',
    bgTintClass: 'bg-rmpg-800/20',
    emptyText:   'No archived jobs',
    bulkLabel:   'Purge all',
    bulkAction:  'purge-all',
  },
  skipped: {
    dotClass:    'bg-rmpg-600',
    borderClass: 'border-l-rmpg-600',
    bgTintClass: 'bg-rmpg-800/20',
    emptyText:   'No skipped jobs',
    bulkLabel:   'Archive all',
    bulkAction:  'archive-all',
  },
};

const FALLBACK_DEFAULTS: StatusDefaults = {
  dotClass:    'bg-rmpg-500',
  borderClass: 'border-l-rmpg-500',
  bgTintClass: '',
  emptyText:   'No jobs',
  bulkLabel:   'Action',
  bulkAction:  'bulk-action',
};

// ── localStorage helpers ────────────────────────────────────────────────────

function getLsKey(status: string): string {
  return `rmpg_serve_folder_${status}`;
}

function readLsOpen(status: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(getLsKey(status));
    if (val !== null) return val === '1';
  } catch {
    // localStorage unavailable (e.g. SSR, private browsing limits)
  }
  return fallback;
}

function writeLsOpen(status: string, open: boolean): void {
  try {
    localStorage.setItem(getLsKey(status), open ? '1' : '0');
  } catch {
    // ignore
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ServeStatusFolder({
  status,
  label,
  count,
  children,
  defaultOpen = true,
  icon: IconProp,
  color,
  accentColor,
  isEmpty = false,
  onBulkAction,
  forceOpen,
}: ServeStatusFolderProps) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (forceOpen !== undefined) return forceOpen;
    return readLsOpen(status, defaultOpen);
  });

  // Sync when forceOpen changes externally
  useEffect(() => {
    if (forceOpen !== undefined) setIsOpen(forceOpen);
  }, [forceOpen]);

  const toggle = useCallback(() => {
    if (forceOpen !== undefined) return; // controlled — do nothing
    setIsOpen(prev => {
      const next = !prev;
      writeLsOpen(status, next);
      return next;
    });
  }, [status, forceOpen]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }, [toggle]);

  const handleBulkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onBulkAction) {
      const defaults = STATUS_DEFAULTS[status] ?? FALLBACK_DEFAULTS;
      onBulkAction(defaults.bulkAction);
    }
  }, [onBulkAction, status]);

  const uid = useId();
  const contentId = `serve-folder-content-${uid}`;

  const defaults = STATUS_DEFAULTS[status] ?? FALLBACK_DEFAULTS;

  // Resolve final classes: prefer explicit props, fall back to status defaults
  const dotClass    = color       ? color.replace(/^text-/, 'bg-') : defaults.dotClass;
  const borderClass = accentColor ?? defaults.borderClass;
  const bgTintClass = defaults.bgTintClass;

  const LeadIcon = IconProp ?? Folder;
  const emptyText = `No ${label.toLowerCase()} jobs`;
  const bulkLabel = defaults.bulkLabel;

  const showBulkButton = isOpen && count > 0 && typeof onBulkAction === 'function';

  return (
    <div className={`border-l-2 ${borderClass} rounded-r-[2px] ${bgTintClass}`}>
      {/* ── Folder header ─────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className={[
          'flex items-center gap-2 px-2.5 py-1.5',
          'cursor-pointer select-none',
          'hover:bg-surface-raised/40 transition-colors duration-100',
          'focus:outline-none focus:ring-1 focus:ring-rmpg-500/40',
        ].join(' ')}
      >
        {/* Chevron */}
        {isOpen
          ? <ChevronDown  size={11} className="text-rmpg-400 flex-shrink-0" aria-hidden />
          : <ChevronRight size={11} className="text-rmpg-400 flex-shrink-0" aria-hidden />}

        {/* Optional leading icon */}
        <LeadIcon size={11} className="text-rmpg-500 flex-shrink-0" aria-hidden />

        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} aria-hidden />

        {/* Label */}
        <span className="text-[11px] font-semibold text-rmpg-200 flex-1 leading-none">
          {label}
        </span>

        {/* Count badge */}
        <span
          className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-[2px] bg-surface-sunken text-rmpg-400"
          aria-label={`${count} jobs`}
        >
          {count}
        </span>

        {/* Bulk-action button */}
        {showBulkButton && (
          <button
            type="button"
            onClick={handleBulkClick}
            className={[
              'ml-1 text-[9px] font-semibold uppercase tracking-wide',
              'px-1.5 py-0.5 rounded-[2px]',
              'bg-surface-sunken text-rmpg-500 hover:text-rmpg-200 hover:bg-surface-raised',
              'transition-colors duration-100 focus:outline-none focus:ring-1 focus:ring-rmpg-500/40',
            ].join(' ')}
            aria-label={`${bulkLabel} for ${label}`}
          >
            {bulkLabel}
          </button>
        )}
      </div>

      {/* ── Collapsible content ────────────────────────────────────────────── */}
      {/*
        We use max-height transition for smooth open/close.
        A very large max-height ceiling on open lets content grow dynamically.
        `overflow-hidden` clips during animation; we rely on the outer border-l
        for the visual accent at all times.
      */}
      <div
        id={contentId}
        role="region"
        aria-label={`${label} jobs`}
        className={[
          'transition-all duration-200 ease-in-out overflow-hidden',
          isOpen ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0',
        ].join(' ')}
        aria-hidden={!isOpen}
      >
        {isEmpty || count === 0 ? (
          /* Empty placeholder */
          <div className="px-4 py-3 text-[11px] text-rmpg-500 italic select-none">
            {emptyText}
          </div>
        ) : (
          /* Job cards */
          <div className="p-2 pt-1 space-y-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Re-export legacy config shape for backward compat ───────────────────────

export { STATUS_DEFAULTS };
