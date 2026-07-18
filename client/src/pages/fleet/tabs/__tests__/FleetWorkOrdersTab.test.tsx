import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FleetWorkOrdersTab from '../FleetWorkOrdersTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const WO_LIST = { count: 1, data: [{ id: 1, vehicle_id: 5, status: 'open', number: 'WO-1', opened_at: '2026-07-01', closed_at: null, summary: 'Brake check', vendor_id: null, est_cost: 100, actual_cost: null, category_code: null, notes: null }] };
const STATS = { stats: { total: 1, open: 1, in_progress: 0, waiting_parts: 0, completed: 0, cancelled: 0, by_priority: {}, by_category: {}, total_estimated_cost: 100, total_actual_cost: 0, overdue_count: 0, scheduled_count: 0 } };
const VEHICLES = { data: [{ id: 5, vehicle_number: 'U-5', vehicle_name: null }] };

function mockFetch() {
  mockedApiFetch.mockImplementation((url?: string) => {
    // Guard against spurious no-arg invocations from unrelated test/runner
    // internals (observed ~100ms after a test's own assertions resolve) —
    // this is not something the component itself ever does.
    if (!url) return Promise.resolve(undefined);
    if (url.startsWith('/work-orders/stats')) return Promise.resolve(STATS);
    if (url.startsWith('/work-orders')) return Promise.resolve(WO_LIST);
    if (url.startsWith('/fleet?limit=500')) return Promise.resolve(VEHICLES);
    if (url.startsWith('/fleetio/conflicts')) return Promise.resolve({ conflicts: [] });
    return Promise.reject(new Error('unexpected url ' + url));
  });
}

describe('FleetWorkOrdersTab', () => {
  beforeEach(() => mockedApiFetch.mockReset());

  it('lists work orders with vehicle labels resolved', async () => {
    mockFetch();
    render(<FleetWorkOrdersTab />);
    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());
    expect(screen.getByText('U-5')).toBeInTheDocument();
    expect(screen.getByText('Brake check')).toBeInTheDocument();
  });

  it('opens the create modal and refetches the list on success', async () => {
    mockFetch();
    render(<FleetWorkOrdersTab />);
    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new work order/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    mockedApiFetch.mockResolvedValueOnce({ data: { id: 2 } });
    fireEvent.change(screen.getByLabelText(/vehicle \*/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('pre-filters to initialVehicleId when provided', async () => {
    mockedApiFetch.mockImplementation((url?: string) => {
      if (!url) return Promise.resolve(undefined);
      if (url.startsWith('/work-orders/stats')) return Promise.resolve(STATS);
      if (url.startsWith('/work-orders')) return Promise.resolve({
        count: 2,
        data: [
          ...WO_LIST.data,
          { id: 2, vehicle_id: 9, status: 'open', number: 'WO-2', opened_at: '2026-07-02', closed_at: null, summary: 'Other vehicle', vendor_id: null, est_cost: null, actual_cost: null, category_code: null, notes: null },
        ],
      });
      if (url.startsWith('/fleet?limit=500')) return Promise.resolve(VEHICLES);
      if (url.startsWith('/fleetio/conflicts')) return Promise.resolve({ conflicts: [] });
      return Promise.reject(new Error('unexpected url ' + url));
    });
    render(<FleetWorkOrdersTab initialVehicleId={5} />);
    await waitFor(() => expect(screen.getByText('WO-1')).toBeInTheDocument());
    expect(screen.queryByText('WO-2')).not.toBeInTheDocument();
  });
});
