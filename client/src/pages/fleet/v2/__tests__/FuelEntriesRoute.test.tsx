import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FuelEntriesRoute } from '../routes/FuelEntriesRoute';

function mockFetchImpl(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
  const method = init?.method ?? 'GET';
  if (/\/api\/fleet(\?|$)/.test(url)) {
    return Promise.resolve(new Response(JSON.stringify([
      { id: 1, vehicle_name: 'Unit 12' },
      { id: 2, vehicle_name: 'Unit 8' },
    ]), { status: 200 }));
  }
  if (url.includes('/api/fleet/1/fuel') && method === 'GET') {
    return Promise.resolve(new Response(JSON.stringify([
      { id: 101, fuel_date: '2026-06-20', gallons: 12.4, cost_per_gallon: 3.49, total_cost: 43.28, station: 'Maverik #5', mpg: 18.2 },
    ]), { status: 200 }));
  }
  if (url.includes('/api/fleet/2/fuel') && method === 'GET') {
    return Promise.resolve(new Response(JSON.stringify([
      { id: 201, fuel_date: '2026-06-19', gallons: 14.1, cost_per_gallon: 3.55, total_cost: 50.05, station: 'Sinclair', mpg: 16.5 },
    ]), { status: 200 }));
  }
  if (url.includes('/api/fleet/fuel/101') && method === 'PUT') {
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }
  if (url.includes('/api/fleet/fuel/101') && method === 'DELETE') {
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  }
  return Promise.resolve(new Response('[]', { status: 200 }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(mockFetchImpl));
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

  it('opens a vehicle-picker create modal from "New Fuel Entry"', async () => {
    render(<MemoryRouter><FuelEntriesRoute /></MemoryRouter>);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /new fuel entry/i }));
    expect(await screen.findByLabelText(/^vehicle$/i)).toBeInTheDocument();
  });

  it('edit icon opens the modal pre-filled and PUTs on save', async () => {
    render(<MemoryRouter><FuelEntriesRoute /></MemoryRouter>);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /edit fuel entry 101/i }));
    const stationInput = await screen.findByLabelText(/^station$/i);
    expect(stationInput).toHaveValue('Maverik #5');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/fleet/fuel/101'),
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('delete icon confirms then calls DELETE', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><FuelEntriesRoute /></MemoryRouter>);
    await screen.findByText('Maverik #5', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /delete fuel entry 101/i }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/fleet/fuel/101'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    confirmSpy.mockRestore();
  });
});
