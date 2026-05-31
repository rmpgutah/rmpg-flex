import React from 'react';
import { ChevronUp, ChevronDown, Inbox } from 'lucide-react';
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
  /** Spillman Flex dense grid mode — compact rows, gold headers, alternating stripes */
  spillman?: boolean;
  /** Condensed mode — even tighter padding for data-dense displays */
  condensed?: boolean;
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
      <span className="inline-flex flex-col ml-1 opacity-20 transition-opacity group-hover:opacity-40">
        <ChevronUp size={10} />
        <ChevronDown size={10} className="-mt-1" />
      </span>
    );
  }
  return dir === 'asc' ? (
    <ChevronUp size={12} className="ml-1 text-brand-400 transition-transform" />
  ) : (
    <ChevronDown size={12} className="ml-1 text-brand-400 transition-transform" />
  );
}

// ── Main Component ────────────────────────────────────────────
function DataTable<T>({
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
  spillman = false,
  condensed = false,
}: DataTableProps<T>) {
  const getKey = (row: T, index: number): string | number => {
    if (rowKey) return rowKey(row);
    if (row != null && typeof row === 'object' && 'id' in row) return (row as Record<string, unknown>).id as string | number;
    return index;
  };

  const alignClass = (align?: string) =>
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

  const tableClass = spillman ? 'spillman-grid' : 'w-full text-xs sm:text-xs';

  const cellPadding = condensed ? 'px-2 py-1.5' : spillman ? 'px-2.5 py-2' : 'px-3 py-3 sm:py-2.5';
  const headerPadding = condensed ? 'px-2 py-1.5' : spillman ? 'px-2.5 py-1.5' : 'px-3 py-2.5 sm:py-2';
  const headerText = spillman ? 'text-[9px]' : 'text-[11px] sm:text-[10px]';
  const bodyText = spillman ? 'text-[11px]' : condensed ? 'text-[11px]' : 'text-sm sm:text-xs';

  return (
    <div
      className={`overflow-auto ${spillman ? '' : 'border border-rmpg-700/50'} bg-surface-base scrollbar-dark ${className}`}
      role="region"
      aria-label={ariaLabel ? `${ariaLabel} region` : undefined}
      style={{ borderRadius: '2px' }}
    >
      <table className={tableClass} aria-label={ariaLabel}>
        <thead className={spillman ? '' : 'sticky top-0 z-10'}>
          <tr
            className={spillman ? '' : 'border-b border-rmpg-600'}
            style={spillman ? undefined : { background: 'linear-gradient(180deg, #181818 0%, #141414 100%)' }}
          >
            {showRowNumbers && (
              <th className={`${headerPadding} text-[10px] font-bold uppercase tracking-wider text-rmpg-400 text-center w-8`} scope="col">#</th>
            )}
            {columns.map((col) => {
              const isSortable = col.sortable && onSort;
              const isActive = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  className={`group ${headerPadding} ${headerText} font-bold uppercase tracking-wider ${spillman ? 'text-[#d4a017]' : 'text-rmpg-400'} whitespace-nowrap ${alignClass(col.align)} ${
                    isSortable ? `cursor-pointer select-none transition-colors ${spillman ? 'hover:bg-white/[0.03]' : 'hover:text-rmpg-200 hover:bg-white/[0.02]'}` : ''
                  }`}
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
            <SkeletonRows columns={columns as Column<unknown>[]} />
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
                  className={`${spillman ? '' : 'group/row border-b border-rmpg-700/30 transition-colors duration-100'} ${
                    isSelected
                      ? spillman ? 'selected' : 'bg-brand-900/30 ring-1 ring-inset ring-brand-600/40'
                      : idx % 2 === 0
                        ? spillman ? '' : 'bg-transparent'
                        : spillman ? '' : 'bg-rmpg-800/20'
                  } ${
                    onRowClick
                      ? 'cursor-pointer'
                      : ''
                  }`}
                  aria-selected={isSelected || undefined}
                >
                  {showRowNumbers && (
                    <td className={`${cellPadding} text-rmpg-500 text-center tabular-nums font-mono text-[10px]`}>{idx + 1}</td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`${cellPadding} text-rmpg-200 ${bodyText} ${alignClass(col.align)}`}
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

export default React.memo(DataTable) as typeof DataTable;
