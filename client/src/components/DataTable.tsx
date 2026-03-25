import React from 'react';
import { ChevronUp, ChevronDown, Loader2, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import EmptyState from './EmptyState';

// ── Types ─────────────────────────────────────────────────────
export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  onRowClick?: (row: T) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  rowKey?: (row: T) => string | number;
  className?: string;
  selectedKey?: string | number | null;
  /** Show row numbers as the first column */
  showRowNumbers?: boolean;
  /** Accessible label for the table */
  ariaLabel?: string;
}

// ── Skeleton loader rows ──────────────────────────────────────
function SkeletonRows({ columns, count = 6 }: { columns: Column<unknown>[]; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-rmpg-700/30">
          {/* 3: Skeleton rows with deterministic widths and staggered animation delay */}
          {columns.map((col, ci) => (
            <td key={col.key} className="px-3 py-2.5">
              <div
                className="h-3 rounded-sm bg-rmpg-700/40 animate-pulse"
                style={{ width: col.width || `${55 + (ci * 11) % 35}%`, animationDelay: `${ci * 75}ms` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Sort indicator ────────────────────────────────────────────
function SortIndicator({ active, dir }: { active: boolean; dir?: 'asc' | 'desc' }) {
  if (!active) {
    return (
      <span className="inline-flex flex-col ml-1 opacity-25 transition-opacity group-hover:opacity-50">
        <ChevronUp size={10} />
        <ChevronDown size={10} className="-mt-1" />
      </span>
    );
  }
  return dir === 'asc' ? (
    <ChevronUp size={12} className="ml-1 text-brand-400 drop-shadow-[0_0_3px_rgba(59,138,212,0.4)]" />
  ) : (
    <ChevronDown size={12} className="ml-1 text-brand-400 drop-shadow-[0_0_3px_rgba(59,138,212,0.4)]" />
  );
}

// ── Main Component ────────────────────────────────────────────
export default function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No records found',
  emptyDescription,
  emptyIcon,
  onRowClick,
  sortKey,
  sortDir,
  onSort,
  rowKey,
  className = '',
  selectedKey,
  showRowNumbers = false,
  ariaLabel,
}: DataTableProps<T>) {
  const getKey = (row: T, index: number): string | number => {
    if (rowKey) return rowKey(row);
    if (row != null && typeof row === 'object' && 'id' in row) return (row as Record<string, unknown>).id as string | number;
    return index;
  };

  const alignClass = (align?: string) =>
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

  return (
    {/* 1: Dark scrollbar styling on table container */}
    <div className={`overflow-auto border border-rmpg-700/50 bg-surface-base panel-beveled scrollbar-dark ${className}`} role="region" aria-label={ariaLabel ? `${ariaLabel} region` : undefined}>
      <table className="w-full text-xs" aria-label={ariaLabel}>
        {/* 2: Sticky header with z-index so it stays on top during scroll */}
        <thead className="sticky top-0 z-10">
          <tr
            className="border-b border-rmpg-600"
            style={{ background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)' }}
          >
            {showRowNumbers && (
              <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 text-center w-8" scope="col">#</th>
            )}
            {columns.map((col) => {
              const isSortable = col.sortable && onSort;
              const isActive = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 whitespace-nowrap group ${alignClass(col.align)} ${
                    isSortable ? 'cursor-pointer select-none hover:text-rmpg-200 hover:bg-white/[0.03] transition-colors' : ''
                  } ${isActive ? 'text-rmpg-200' : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={isSortable ? () => onSort!(col.key) : undefined}
                  aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  scope="col"
                >
                  <span className="inline-flex items-center">
                    {col.label}
                    {isSortable && (
                      <SortIndicator active={isActive} dir={isActive ? sortDir : undefined} />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows columns={columns} />
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (showRowNumbers ? 1 : 0)}>
                <EmptyState
                  icon={emptyIcon || Inbox}
                  title={emptyMessage}
                  description={emptyDescription}
                />
              </td>
            </tr>
          ) : (
            data.map((row, idx) => {
              const key = getKey(row, idx);
              const isSelected = selectedKey !== undefined && selectedKey === key;
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  {/* 4: Striped rows with stronger contrast; 5: Selected row ring for clarity */}
                  className={`border-b border-rmpg-700/30 transition-colors duration-100 ${
                    isSelected
                      ? 'bg-brand-900/30 border-l-2 border-l-brand-500 ring-1 ring-inset ring-brand-600/40'
                      : idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-rmpg-800/30'
                  } ${
                    onRowClick
                      ? 'cursor-pointer hover:bg-brand-900/20 active:bg-brand-900/30'
                      : 'hover:bg-white/[0.02]'
                  }`}
                  aria-selected={isSelected || undefined}
                >
                  {/* 6: Row number column with monospaced font and muted color */}
                  {showRowNumbers && (
                    <td className="px-2 py-2 text-rmpg-500 text-center tabular-nums font-mono text-[10px]">{idx + 1}</td>
                  )}
                  {/* 7: Cell vertical padding increased for readability; 8: Whitespace nowrap on narrow cells */}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 text-rmpg-200 ${alignClass(col.align)}`}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
