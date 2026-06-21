import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VehiclesListRoute } from '../routes/VehiclesListRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  // Fresh fetch mock that returns the same 2-vehicle fixture on every call.
  // apiFetch wraps fetch in retry logic; the mock must keep returning OK so
  // retries (if any) all succeed.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12', make: 'Ford', model: 'Explorer', year: 2022, plate_number: 'ABC123', plate_state: 'UT', status: 'in_service', current_mileage: 47283 },
    { id: 2, vehicle_name: 'Unit 8',  vehicle_number: 'U-8',  make: 'Chevy', model: 'Tahoe',    year: 2020, plate_number: 'XYZ789', plate_state: 'UT', status: 'maintenance', current_mileage: 91234 },
  ]), { status: 200 }))));
});

afterEach(() => { vi.unstubAllGlobals(); });

function renderList() {
  return render(<MemoryRouter><VehiclesListRoute /></MemoryRouter>);
}

describe('<VehiclesListRoute>', () => {
  it('fetches /api/fleet and renders seeded rows', async () => {
    renderList();
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    expect(screen.getByText('Unit 8')).toBeInTheDocument();
  });

  it('search input filters by name (client-side prefilter)', async () => {
    renderList();
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    fireEvent.change(screen.getByPlaceholderText(/search vehicles/i), { target: { value: 'tahoe' } });
    expect(screen.queryByText('Unit 12')).toBeNull();
    expect(screen.getByText('Unit 8')).toBeInTheDocument();
  });

  it('toggles between card and table view', async () => {
    renderList();
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    expect(screen.getByRole('button', { name: /table view/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /table view/i }));
    expect(screen.getByRole('button', { name: /card view/i })).toBeInTheDocument();
  });

  it('vehicle link goes to /fleet/v2/vehicles/:id', async () => {
    renderList();
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    const link = screen.getByRole('link', { name: /unit 12/i }) as HTMLAnchorElement;
    expect(link.pathname).toBe('/fleet/v2/vehicles/1');
  });
});
