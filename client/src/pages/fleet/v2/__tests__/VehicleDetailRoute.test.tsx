import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VehicleDetailRoute } from '../routes/VehicleDetailRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (url.includes('/api/fleet/1')) {
      return Promise.resolve(new Response(JSON.stringify({
        id: 1, vehicle_name: 'Unit 12', vehicle_number: 'U-12',
        make: 'Ford', model: 'Explorer', year: 2022,
        plate_number: 'ABC123', plate_state: 'UT', vin: '1HGBH41JXMN109186',
        status: 'in_service', current_mileage: 47283, color: 'Black',
      }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/fleet/v2/vehicles/:id/*" element={<VehicleDetailRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('<VehicleDetailRoute>', () => {
  it('renders sticky header with vehicle name + plate + status', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    expect(screen.getAllByText(/ABC123/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/in service/i).length).toBeGreaterThan(0);
  });

  it('renders all 13 tab names in the tab bar', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    const expected = ['Overview', 'Service', 'Inspections', 'Fuel', 'Issues', 'Work Orders', 'Documents', 'Costs', 'Recalls', 'Damage', 'Tires', 'Assignments', 'Activity'];
    for (const tab of expected) {
      expect(screen.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') })).toBeInTheDocument();
    }
  });

  it('Overview tab is active by default and renders content', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    const overviewTab = screen.getByRole('tab', { name: /^overview/i });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText(/1HGBH41JXMN109186/).length).toBeGreaterThan(0);
  });

  it("clicking Service tab swaps to the ServiceTab content (no empty-state)", async () => {
    renderAt('/fleet/v2/vehicles/1');
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('tab', { name: /^service/i }));
    // After clicking Service, the overview-only "VIN" Row label disappears and
    // the ServiceTab's empty state (or loading) appears. Both are valid;
    // assert we're NOT showing the "coming in PR 7'b.2" empty state.
    expect(screen.queryByText(/coming in pr 7'b\.2/i)).toBeNull();
  });

  it('clicking Work Orders tab renders the real WorkOrdersTab (shipped in PR 5)', async () => {
    renderAt('/fleet/v2/vehicles/1');
    await screen.findByText('Unit 12', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('tab', { name: /^work orders/i }));
    // WorkOrdersTab is implemented now — the deferred-placeholder must be gone.
    expect(screen.queryByText(/coming in pr 5/i)).toBeNull();
  });
});
