import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetFuelTab from '../FleetFuelTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const LOGS: any[] = [{ id: 30, gallons: 10, fuel_type: 'regular', total_cost: 35 }];

describe('FleetFuelTab conflict badges', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('renders a per-row conflict badge on a fuel log entry', async () => {
    mockedApiFetch.mockResolvedValue({ conflicts: [{ id: 3, rmpg_id: 30, field: 'gallons', local_value: '10', remote_value: '10.2' }] });
    render(<FleetFuelTab fuelLogs={LOGS} summary={null} onAddFuel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /conflict on gallons/i })).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/fleetio/conflicts?table=fleet_fuel_log&ids=30');
  });

  it('renders nothing extra when there are no conflicts', async () => {
    mockedApiFetch.mockResolvedValue({ conflicts: [] });
    render(<FleetFuelTab fuelLogs={LOGS} summary={null} onAddFuel={vi.fn()} />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /conflict on/i })).not.toBeInTheDocument();
  });
});
