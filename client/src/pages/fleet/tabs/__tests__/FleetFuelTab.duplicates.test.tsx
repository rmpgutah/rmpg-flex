import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FleetFuelTab from '../FleetFuelTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue({ conflicts: [] }) }));

describe('FleetFuelTab duplicate detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags entries sharing vehicle_id + fuel_date + total_cost as duplicates', async () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 3, vehicle_id: '5', fuel_date: '2026-07-02', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    await act(async () => { render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} onBulkDeleteFuel={vi.fn()} />); });
    expect(screen.getAllByText('Dup')).toHaveLength(2);
    expect(screen.getByText('2 possible duplicates')).toBeInTheDocument();
  });

  it('does not flag entries with a missing total_cost, even if date/vehicle match', async () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: null, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: null, gallons: 12, fuel_type: 'regular' },
    ];
    await act(async () => { render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} />); });
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
  });

  it('does not flag entries on different vehicles with the same date/cost', async () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '6', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    await act(async () => { render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} />); });
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
  });

  it('"Delete Duplicates" calls onBulkDeleteFuel ONCE with every non-kept entry (not onDeleteFuel per-item, which only opens a confirm dialog and would batch-collapse to the last call)', async () => {
    const onBulkDeleteFuel = vi.fn();
    const logs: any[] = [
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 3, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    await act(async () => { render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} onBulkDeleteFuel={onBulkDeleteFuel} />); });
    fireEvent.click(screen.getByRole('button', { name: /delete duplicates/i }));
    expect(onBulkDeleteFuel).toHaveBeenCalledTimes(1);
    const deletedIds = onBulkDeleteFuel.mock.calls[0][0].map((l: any) => l.id).sort();
    expect(deletedIds).toEqual([2, 3]); // id:1 (oldest) kept
  });

  // ── Fleet.io "ghost" twins ──
  // Structure mirrors a real live-D1 pair (ids 113/116): /pull inserted a
  // second row for a fill the operator had already entered, carrying only
  // date + gallons. The exact-match pass cannot see these — total_cost is
  // null and the timestamps differ by 31s. Field VALUES are synthetic: no
  // operator name or real station goes into the repo.
  const ghostPair = () => [
    { id: 113, vehicle_id: '1', fuel_date: '2026-07-21 20:42:00', total_cost: null, gallons: 19.105, odometer: null, driver_name: null, station: null },
    { id: 116, vehicle_id: '1', fuel_date: '2026-07-21 20:42:31', total_cost: 85, gallons: 19.105, odometer: 93969, driver_name: 'Test Driver', station: 'Test Station', fuel_type: 'regular' },
  ] as any[];

  it('flags a Fleet.io ghost twin: same gallons, seconds apart, null total_cost', async () => {
    await act(async () => { render(<FleetFuelTab fuelLogs={ghostPair()} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} onBulkDeleteFuel={vi.fn()} />); });
    // Counts every member of the group (both rows), matching the exact-match
    // banner's existing semantics.
    expect(screen.getByText('2 possible duplicates')).toBeInTheDocument();
  });

  it('deletes the sparse ghost and KEEPS the populated row, even when the ghost has the lower id', async () => {
    const onBulkDeleteFuel = vi.fn();
    await act(async () => { render(<FleetFuelTab fuelLogs={ghostPair()} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} onBulkDeleteFuel={onBulkDeleteFuel} />); });
    fireEvent.click(screen.getByRole('button', { name: /delete duplicates/i }));
    const deletedIds = onBulkDeleteFuel.mock.calls[0][0].map((l: any) => l.id);
    // 113 is the LOWER id — the old "keep oldest" rule would have kept the
    // ghost and destroyed the operator's record.
    expect(deletedIds).toEqual([113]);
  });

  it('does not flag same-gallons fills that are genuinely far apart in time', async () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '1', fuel_date: '2026-07-01 08:00:00', total_cost: null, gallons: 19.105 },
      { id: 2, vehicle_id: '1', fuel_date: '2026-07-14 08:00:00', total_cost: null, gallons: 19.105 },
    ];
    await act(async () => { render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} onBulkDeleteFuel={vi.fn()} />); });
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
  });

  it('does not render the duplicate banner when onBulkDeleteFuel is not provided', async () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    await act(async () => { render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} />); });
    expect(screen.queryByRole('button', { name: /delete duplicates/i })).not.toBeInTheDocument();
  });
});
