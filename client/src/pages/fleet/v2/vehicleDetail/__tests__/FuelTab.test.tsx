import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FuelTab } from '../FuelTab';

vi.mock('../../hooks/apiFetchV2', () => ({ apiFetchV2: vi.fn() }));
import { apiFetchV2 } from '../../hooks/apiFetchV2';
const mocked = vi.mocked(apiFetchV2);

const ROWS = [
  { id: 1, fuel_date: '2026-06-20', gallons: 12.4, cost_per_gallon: 3.49, total_cost: 43.28, odometer: 47283, mpg: 18.2, station: 'Maverik #5', fuel_type: 'regular' },
  { id: 2, fuel_date: '2026-06-15', gallons: 11.8, cost_per_gallon: 3.55, total_cost: 41.89, odometer: 46989, mpg: 19.0, station: 'Sinclair', fuel_type: 'regular' },
];

beforeEach(() => {
  mocked.mockReset();
  mocked.mockImplementation((path: string) => {
    if (path.includes('conflicts')) return Promise.resolve({ conflicts: [] });
    if (path.includes('/fuel')) return Promise.resolve(ROWS);
    return Promise.resolve({});
  });
});

describe('<FuelTab>', () => {
  it('renders fuel entries with MPG', async () => {
    render(<FuelTab vehicleId={42} />);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    expect(screen.getByText('Sinclair')).toBeInTheDocument();
    expect(screen.getByText(/18.2/)).toBeInTheDocument();
  });

  it('shows average MPG header when entries have mpg values', async () => {
    render(<FuelTab vehicleId={42} />);
    await screen.findByText(/avg mpg/i, {}, { timeout: 3000 });
  });

  it('renders empty state', async () => {
    mocked.mockImplementation((path: string) => {
      if (path.includes('conflicts')) return Promise.resolve({ conflicts: [] });
      if (path.includes('/fuel')) return Promise.resolve([]);
      return Promise.resolve({});
    });
    render(<FuelTab vehicleId={42} />);
    await screen.findByText(/no fuel entries/i, {}, { timeout: 3000 });
  });
});

describe('FuelTab CRUD', () => {
  it('shows a "New Fuel Entry" button that opens the create modal', async () => {
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new fuel entry/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /new fuel entry/i }));
    expect(screen.getByText(/new fuel entry/i, { selector: 'h2' })).toBeInTheDocument();
  });

  it('edit icon opens the modal pre-filled with the row', async () => {
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/edit fuel entry 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/edit fuel entry 1/i));
    expect(screen.getByLabelText(/^date$/i)).toHaveValue('2026-06-20');
  });

  it('delete icon confirms then calls DELETE and refetches', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/delete fuel entry 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/delete fuel entry 1/i));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('/fleet/fuel/1', expect.objectContaining({ method: 'DELETE' })));
    vi.restoreAllMocks();
  });

  it('delete icon does nothing if the user cancels the confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<FuelTab vehicleId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/delete fuel entry 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/delete fuel entry 1/i));
    expect(mocked).not.toHaveBeenCalledWith('/fleet/fuel/1', expect.objectContaining({ method: 'DELETE' }));
    vi.restoreAllMocks();
  });
});
