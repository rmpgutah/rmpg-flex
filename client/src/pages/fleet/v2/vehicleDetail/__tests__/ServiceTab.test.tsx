import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceTab } from '../ServiceTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, service_type: 'Oil Change', service_date: '2026-06-15', cost: 89.99, vendor: 'Jiffy Lube', mileage_at_service: 47000, notes: null },
    { id: 2, service_type: 'Brake Pads', service_date: '2026-05-10', cost: 425.50, vendor: 'Big O Tires', mileage_at_service: 45500, notes: null },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<ServiceTab>', () => {
  it('renders service entries with cost and vendor', async () => {
    render(<ServiceTab vehicleId={42} />);
    await screen.findByText('Oil Change', {}, { timeout: 3000 });
    expect(screen.getByText('Jiffy Lube')).toBeInTheDocument();
    expect(screen.getByText('$89.99')).toBeInTheDocument();
  });

  it('renders empty state when no rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<ServiceTab vehicleId={42} />);
    await screen.findByText(/no service entries/i, {}, { timeout: 3000 });
  });
});
