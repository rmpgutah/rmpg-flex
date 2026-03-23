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
function SkeletonRows({ columns, count = 6 }: { columns: Column<any>[]; count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-rmpg-700/30">
          {columns.map((col) => (
            <td key={col.key} className="px-3 py-2.5">
              <div
                className="h-3 rounded-sm bg-rmpg-700/40 animate-pulse"
                style={{ width: col.width || `${50 + Math.random() * 40}%` }}
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
      <span className="inline-flex flex-col ml-1 opacity-30">
        <ChevronUp size={10} />
        <ChevronDown size={10} className="-mt-1" />
      </span>
    );
  }
  return dir === 'asc' ? (
    <ChevronUp size={12} className="ml-1 text-brand-400" />
  ) : (
    <ChevronDown size={12} className="ml-1 text-brand-400" />
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
    if ((row as any).id !== undefined) return (row as any).id;
    return index;
  };

  const alignClass = (align?: string) =>
    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

  return (
    <div className={`overflow-auto border border-rmpg-700/50 bg-surface-base ${className}`}>
      <table className="w-full text-xs" aria-label={ariaLabel}>
        <thead>
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
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 whitespace-nowrap ${alignClass(col.align)} ${
                    isSortable ? 'cursor-pointer select-none hover:text-rmpg-200 transition-colors' : ''
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
                  className={`border-b border-rmpg-700/30 transition-colors ${
                    isSelected
                      ? 'bg-brand-900/30'
                      : idx % 2 === 0
                        ? 'bg-transparent'
                        : 'bg-rmpg-800/20'
                  } ${
                    onRowClick
                      ? 'cursor-pointer hover:bg-brand-900/20'
                      : ''
                  }`}
                  aria-selected={isSelected || undefined}
                >
                  {showRowNumbers && (
                    <td className="px-2 py-2 text-rmpg-500 text-center tabular-nums">{idx + 1}</td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-rmpg-200 ${alignClass(col.align)}`}
                      style={col.width ? { width: col.width } : undefined}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as any)[col.key] ?? '')}
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
