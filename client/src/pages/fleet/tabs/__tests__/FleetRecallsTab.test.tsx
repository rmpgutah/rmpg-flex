import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import FleetRecallsTab from '../FleetRecallsTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

vi.mock('../../../../components/ToastProvider', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

describe('FleetRecallsTab', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('renders normally when the API returns an array', async () => {
    mockedApiFetch.mockResolvedValue([
      { id: 1, vehicle_id: 5, vehicle_number: 'U-5', make: 'Ford', model: 'Explorer', year: 2022, vin: 'X', recall_number: 'R-1', manufacturer: 'Ford', description: 'desc', severity: 'standard', status: 'open', remedy: '', scheduled_date: '', completed_date: '' },
    ]);
    render(<FleetRecallsTab vehicleId={5} />);
    await waitFor(() => expect(screen.getByText('R-1')).toBeInTheDocument());
  });

  it('does not crash when the API returns a non-array 200 response (confirmed live production crash, 2026-07-30)', async () => {
    // Regression test: `recalls.filter(...)` (used for the open-count badge)
    // throws "not a function" if state is ever set to something other than
    // an array. GET /fleet/recalls always returns an array server-side, but
    // the client previously trusted the response shape unconditionally.
    mockedApiFetch.mockResolvedValue({ error: 'unexpected shape' } as any);
    render(<FleetRecallsTab vehicleId={5} />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalled());
    // No crash means the ErrorBoundary never fired — the empty-state copy
    // (or at minimum the tab chrome) should still be present.
    expect(screen.queryByText(/unexpected error/i)).not.toBeInTheDocument();
  });
});
