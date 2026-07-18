import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import OpenWorkOrdersPanel from '../OpenWorkOrdersPanel';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('OpenWorkOrdersPanel', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('fetches open work orders scoped to the vehicle and lists them', async () => {
    mockedApiFetch.mockResolvedValue({ count: 1, data: [{ id: 1, status: 'open', number: 'WO-1', summary: 'Brake check', opened_at: '2026-07-01' }] });
    render(<OpenWorkOrdersPanel vehicleId="5" onViewAll={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/WO-1/)).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/work-orders?vehicle_id=5&open_only=1&limit=100');
  });

  it('shows an empty message when there are no open work orders', async () => {
    mockedApiFetch.mockResolvedValue({ count: 0, data: [] });
    render(<OpenWorkOrdersPanel vehicleId="5" onViewAll={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no open work orders/i)).toBeInTheDocument());
  });

  it('calls onViewAll when "View all" is clicked', async () => {
    mockedApiFetch.mockResolvedValue({ count: 0, data: [] });
    const onViewAll = vi.fn();
    render(<OpenWorkOrdersPanel vehicleId="5" onViewAll={onViewAll} />);
    await waitFor(() => expect(screen.getByText(/no open work orders/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    expect(onViewAll).toHaveBeenCalled();
  });
});
