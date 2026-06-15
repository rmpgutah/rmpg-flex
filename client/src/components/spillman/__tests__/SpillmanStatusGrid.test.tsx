import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanStatusGrid, { type StatusColumn, type SpillmanStatusGridProps } from '../SpillmanStatusGrid';

afterEach(cleanup);

interface Row { id: string; nature: string; p: number }
const columns: StatusColumn[] = [
  { key: 'p', label: 'P', align: 'center' },
  { key: 'nature', label: 'Nature' },
];
const rows: Row[] = [
  { id: 'b', nature: 'Fire', p: 1 },
  { id: 'a', nature: 'Theft', p: 3 },
];

function renderGrid(extra: Partial<SpillmanStatusGridProps<Row>> = {}) {
  return render(
    <SpillmanStatusGrid<Row>
      title="Undispatched calls"
      badge="cad_1"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      {...extra}
    />,
  );
}

describe('SpillmanStatusGrid', () => {
  it('renders title, badge, a header per column and a row per item', () => {
    renderGrid();
    expect(screen.getByText('Undispatched calls')).toBeInTheDocument();
    expect(screen.getByText('cad_1')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getByText('Fire')).toBeInTheDocument();
    expect(screen.getByText('Theft')).toBeInTheDocument();
  });

  it('fires onSelect on row click and onActivate on double-click', () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    renderGrid({ onSelect, onActivate });
    fireEvent.click(screen.getByText('Fire'));
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
    fireEvent.doubleClick(screen.getByText('Theft'));
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
  });

  it('fires onSort when a header is clicked', () => {
    const onSort = vi.fn();
    renderGrid({ onSort });
    fireEvent.click(screen.getByText('Nature'));
    expect(onSort).toHaveBeenCalledWith('nature');
  });

  it('applies rowColor as inline text color', () => {
    renderGrid({ rowColor: () => 'var(--spm-pri-1)' });
    const cell = screen.getByText('Fire');
    expect(cell.closest('tr')).toHaveStyle({ color: 'var(--spm-pri-1)' });
  });

  it('sorts rows when sortKey is provided', () => {
    renderGrid({ sortKey: 'nature', sortDir: 'asc' });
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toContain('Fire');
    const order = screen.getAllByRole('row').slice(1).map((tr) => tr.textContent);
    expect(order[0]).toContain('Fire');
    expect(order[1]).toContain('Theft');
  });
});
