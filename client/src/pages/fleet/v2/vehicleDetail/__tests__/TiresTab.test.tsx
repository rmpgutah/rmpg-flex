import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TiresTab } from '../TiresTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, position: 'LF', brand: 'Michelin', size: '235/55R17', install_date: '2025-12-01', install_mileage: 42000, tread_depth: 9, replaced_date: null },
    { id: 2, position: 'RF', brand: 'Michelin', size: '235/55R17', install_date: '2025-12-01', install_mileage: 42000, tread_depth: 8, replaced_date: null },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<TiresTab>', () => {
  it('renders tire records with brand + tread depth', async () => {
    render(<TiresTab vehicleId={42} />);
    await screen.findByText('LF', {}, { timeout: 3000 });
    expect(screen.getByText('RF')).toBeInTheDocument();
    expect(screen.getAllByText('Michelin').length).toBe(2);
    expect(screen.getByText('9/32"')).toBeInTheDocument();
  });

  it('renders empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<TiresTab vehicleId={42} />);
    await screen.findByText(/no tire records/i, {}, { timeout: 3000 });
  });
});
