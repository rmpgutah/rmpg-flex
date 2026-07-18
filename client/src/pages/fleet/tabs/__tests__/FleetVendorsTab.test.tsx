import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FleetVendorsTab from '../FleetVendorsTab';

vi.mock('../../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

describe('FleetVendorsTab', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state, then renders vendor rows sorted by price', async () => {
    mockedApiFetch.mockResolvedValue([
      { id: 1, name: 'Speedy Fuel', brand: 'Shell', location: 'SLC', current_price_per_gallon: 3.5 },
      { id: 2, name: 'Cheap Gas', brand: 'Costco', location: 'West Jordan', current_price_per_gallon: 2.9 },
    ]);
    render(<FleetVendorsTab />);
    expect(screen.getByText(/loading vendors/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Cheap Gas')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1); // drop header row
    expect(rows[0]).toHaveTextContent('Cheap Gas');
    expect(rows[1]).toHaveTextContent('Speedy Fuel');
    expect(mockedApiFetch).toHaveBeenCalledWith('/fleet/fuel/vendors');
  });

  it('filters by search text across name/brand/location', async () => {
    mockedApiFetch.mockResolvedValue([
      { id: 1, name: 'Speedy Fuel', brand: 'Shell', location: 'SLC', current_price_per_gallon: 3.5 },
      { id: 2, name: 'Cheap Gas', brand: 'Costco', location: 'West Jordan', current_price_per_gallon: 2.9 },
    ]);
    render(<FleetVendorsTab />);
    await waitFor(() => expect(screen.getByText('Speedy Fuel')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: 'costco' } });
    expect(screen.queryByText('Speedy Fuel')).not.toBeInTheDocument();
    expect(screen.getByText('Cheap Gas')).toBeInTheDocument();
  });

  it('shows an empty state when there are no vendors', async () => {
    mockedApiFetch.mockResolvedValue([]);
    render(<FleetVendorsTab />);
    await waitFor(() => expect(screen.getByText(/no fuel vendors on file/i)).toBeInTheDocument());
  });

  it('shows an error message when the fetch fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('Network error'));
    render(<FleetVendorsTab />);
    await waitFor(() => expect(screen.getByText(/failed to load vendors/i)).toBeInTheDocument());
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });
});
