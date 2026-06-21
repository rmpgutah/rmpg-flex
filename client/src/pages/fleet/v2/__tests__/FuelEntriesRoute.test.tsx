import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FuelEntriesRoute } from '../routes/FuelEntriesRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (/\/api\/fleet(\?|$)/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 1, vehicle_name: 'Unit 12' },
        { id: 2, vehicle_name: 'Unit 8' },
      ]), { status: 200 }));
    }
    if (url.includes('/api/fleet/1/fuel')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 101, fuel_date: '2026-06-20', gallons: 12.4, cost_per_gallon: 3.49, total_cost: 43.28, station: 'Maverik #5', mpg: 18.2 },
      ]), { status: 200 }));
    }
    if (url.includes('/api/fleet/2/fuel')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 201, fuel_date: '2026-06-19', gallons: 14.1, cost_per_gallon: 3.55, total_cost: 50.05, station: 'Sinclair', mpg: 16.5 },
      ]), { status: 200 }));
    }
    return Promise.resolve(new Response('[]', { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<FuelEntriesRoute>', () => {
  it('fans out fetches across all vehicles and renders combined rows', async () => {
    render(<MemoryRouter><FuelEntriesRoute /></MemoryRouter>);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    expect(screen.getByText('Sinclair')).toBeInTheDocument();
    expect(screen.getByText('Unit 12')).toBeInTheDocument();
    expect(screen.getByText('Unit 8')).toBeInTheDocument();
  });

  it('renders empty state when fleet has no fuel entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 }))));
    render(<MemoryRouter><FuelEntriesRoute /></MemoryRouter>);
    await screen.findByText(/no fuel entries in the fleet/i, {}, { timeout: 3000 });
  });
});
