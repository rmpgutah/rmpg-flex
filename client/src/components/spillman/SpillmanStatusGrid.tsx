import React from 'react';
import { sortGridRows } from './gridSort';

export interface StatusColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface SpillmanStatusGridProps<T extends Record<string, any>> {
  title: string;
  badge?: string;
  columns: StatusColumn[];
  rows: T[];
  rowKey: (row: T) => string;
  rowColor?: (row: T) => string;
  renderCell?: (row: T, col: StatusColumn) => React.ReactNode;
  selectedKey?: string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onSelect?: (row: T) => void;
  onActivate?: (row: T) => void;
  onContextMenu?: (row: T, e: React.MouseEvent) => void;
  onDragStartRow?: (row: T, e: React.DragEvent) => void;
  onDropRow?: (row: T, e: React.DragEvent) => void;
}

/** Black, monospace, color-coded status grid — the CAD board's core panel.
 *  All behavior is injected via props; sorting is local when sortKey is set. */
export default function SpillmanStatusGrid<T extends Record<string, any>>(
  props: SpillmanStatusGridProps<T>,
) {
  const {
    title, badge, columns, rows, rowKey, rowColor, renderCell,
    selectedKey, sortKey, sortDir = 'asc', onSort,
    onSelect, onActivate, onContextMenu, onDragStartRow, onDropRow,
  } = props;

  const ordered = sortKey ? sortGridRows(rows, sortKey, sortDir) : rows;

  return (
    <div className="spm-status-grid">
      <div className="spm-status-grid-head">
        <span className="spm-status-grid-title">{title}</span>
        {badge && <span className="spm-status-grid-badge">{badge}</span>}
      </div>
      <div className="overflow-x-auto"><table className="spm-status-grid-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, textAlign: c.align ?? 'left' }}
                aria-sort={
                  sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined
                }
                onClick={onSort ? () => onSort(c.key) : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            const k = rowKey(row);
            return (
              <tr
                key={k}
                aria-selected={selectedKey === k ? true : undefined}
                style={rowColor ? { color: rowColor(row) } : undefined}
                onClick={onSelect ? () => onSelect(row) : undefined}
                onDoubleClick={onActivate ? () => onActivate(row) : undefined}
                onContextMenu={onContextMenu ? (e) => onContextMenu(row, e) : undefined}
                draggable={onDragStartRow ? true : undefined}
                onDragStart={onDragStartRow ? (e) => onDragStartRow(row, e) : undefined}
                onDragOver={onDropRow ? (e) => e.preventDefault() : undefined}
                onDrop={onDropRow ? (e) => onDropRow(row, e) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {renderCell ? renderCell(row, c) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
