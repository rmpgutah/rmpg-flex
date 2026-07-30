import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FleetFuelTab from '../FleetFuelTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn().mockResolvedValue({ conflicts: [] }) }));

describe('FleetFuelTab duplicate detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags entries sharing vehicle_id + fuel_date + total_cost as duplicates', () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 3, vehicle_id: '5', fuel_date: '2026-07-02', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} />);
    expect(screen.getAllByText('Dup')).toHaveLength(2);
    expect(screen.getByText('2 possible duplicates')).toBeInTheDocument();
  });

  it('does not flag entries with a missing total_cost, even if date/vehicle match', () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: null, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: null, gallons: 12, fuel_type: 'regular' },
    ];
    render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} />);
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
  });

  it('does not flag entries on different vehicles with the same date/cost', () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '6', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={vi.fn()} />);
    expect(screen.queryByText('Dup')).not.toBeInTheDocument();
  });

  it('"Delete Duplicates" keeps the oldest (lowest id) entry per group and deletes the rest', () => {
    const onDeleteFuel = vi.fn();
    const logs: any[] = [
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 3, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} onDeleteFuel={onDeleteFuel} />);
    fireEvent.click(screen.getByRole('button', { name: /delete duplicates/i }));
    expect(onDeleteFuel).toHaveBeenCalledTimes(2);
    const deletedIds = onDeleteFuel.mock.calls.map((c) => c[0].id).sort();
    expect(deletedIds).toEqual([2, 3]); // id:1 (oldest) kept
  });

  it('does not render the duplicate banner when onDeleteFuel is not provided', () => {
    const logs: any[] = [
      { id: 1, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
      { id: 2, vehicle_id: '5', fuel_date: '2026-07-01', total_cost: 40, gallons: 10, fuel_type: 'regular' },
    ];
    render(<FleetFuelTab fuelLogs={logs} summary={null} onAddFuel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /delete duplicates/i })).not.toBeInTheDocument();
  });
});
