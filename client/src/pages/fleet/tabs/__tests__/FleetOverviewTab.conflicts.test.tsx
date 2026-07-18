// client/src/pages/fleet/tabs/__tests__/FleetOverviewTab.conflicts.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetOverviewTab from '../FleetOverviewTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const DETAIL: any = { id: '5', vehicle_number: 'U-5', status: 'in_service', current_mileage: 1000 };
const MAINTENANCE: any[] = [{ id: 20, type: 'oil_change', performed_at: '2026-06-01', cost: 40 }];

describe('FleetOverviewTab conflict badges', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('renders a vehicle-level conflict badge when fleet_vehicles has one', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.includes('table=fleet_vehicles')) {
        return Promise.resolve({ conflicts: [{ id: 1, rmpg_id: 5, field: 'plate_number', local_value: 'ABC123', remote_value: 'XYZ789' }] });
      }
      if (url.includes('table=fleet_maintenance')) return Promise.resolve({ conflicts: [] });
      return Promise.resolve(null);
    });
    render(<FleetOverviewTab detail={DETAIL} maintenance={MAINTENANCE} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /conflict on plate_number/i })).toBeInTheDocument());
  });

  it('renders a per-row conflict badge on a maintenance entry', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url.includes('table=fleet_vehicles')) return Promise.resolve({ conflicts: [] });
      if (url.includes('table=fleet_maintenance')) {
        return Promise.resolve({ conflicts: [{ id: 2, rmpg_id: 20, field: 'cost', local_value: '40', remote_value: '45' }] });
      }
      return Promise.resolve(null);
    });
    render(<FleetOverviewTab detail={DETAIL} maintenance={MAINTENANCE} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /conflict on cost/i })).toBeInTheDocument());
  });
});
