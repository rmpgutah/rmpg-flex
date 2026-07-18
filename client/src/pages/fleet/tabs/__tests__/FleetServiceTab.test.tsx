import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetServiceTab from '../FleetServiceTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('FleetServiceTab', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fans out per-vehicle maintenance and renders a fleet-wide list sorted by date desc', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.resolve([{ id: 1, vehicle_number: 'U-1' }, { id: 2, vehicle_number: 'U-2' }]);
      if (url === '/fleet/1/maintenance') return Promise.resolve({ data: [{ id: 10, type: 'oil_change', performed_at: '2026-06-01', cost: 40 }], total: 1 });
      if (url === '/fleet/2/maintenance') return Promise.resolve({ data: [{ id: 11, type: 'brake_service', performed_at: '2026-07-01', cost: 200 }], total: 1 });
      if (url.startsWith('/fleetio/conflicts')) return Promise.resolve({ conflicts: [] });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetServiceTab />);
    await waitFor(() => expect(screen.getByText('brake_service')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('brake_service'); // newer date first
    expect(rows[1]).toHaveTextContent('oil_change');
  });

  it('shows an empty state when the fleet has no service entries', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.resolve([]);
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetServiceTab />);
    await waitFor(() => expect(screen.getByText(/no service entries in the fleet yet/i)).toBeInTheDocument());
  });

  it('shows a distinct error message when the vehicle list fails to load', async () => {
    mockedApiFetch.mockImplementation((url: string) => {
      if (url === '/fleet?limit=500') return Promise.reject(new Error('Network error'));
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetServiceTab />);
    await waitFor(() => expect(screen.getByText(/failed to load service entries/i)).toBeInTheDocument());
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
    expect(screen.queryByText(/no service entries in the fleet yet/i)).not.toBeInTheDocument();
  });
});
