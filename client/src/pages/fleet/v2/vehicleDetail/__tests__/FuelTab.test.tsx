import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FuelTab } from '../FuelTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, fuel_date: '2026-06-20', gallons: 12.4, cost_per_gallon: 3.49, total_cost: 43.28, odometer: 47283, mpg: 18.2, station: 'Maverik #5', fuel_type: 'regular' },
    { id: 2, fuel_date: '2026-06-15', gallons: 11.8, cost_per_gallon: 3.55, total_cost: 41.89, odometer: 46989, mpg: 19.0, station: 'Sinclair', fuel_type: 'regular' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<FuelTab vehicleId={42} />);
    await screen.findByText(/no fuel entries/i, {}, { timeout: 3000 });
  });
});
