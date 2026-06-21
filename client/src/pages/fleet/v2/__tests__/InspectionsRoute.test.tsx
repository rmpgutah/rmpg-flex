import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InspectionsRoute } from '../routes/InspectionsRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (url.endsWith('/api/fleet')) {
      return Promise.resolve(new Response(JSON.stringify([{ id: 1, vehicle_name: 'Unit 12' }]), { status: 200 }));
    }
    if (url.includes('/api/fleet/1/inspections')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 1, inspection_type: 'Pre-Trip', inspection_date: '2026-06-21', passed: 1, inspector_name: 'Officer Jones' },
        { id: 2, inspection_type: 'Annual', inspection_date: '2026-04-15', passed: 0, inspector_name: 'Officer Smith' },
      ]), { status: 200 }));
    }
    return Promise.resolve(new Response('[]', { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<InspectionsRoute>', () => {
  it('renders both PASS and FAIL inspections across the fleet', async () => {
    render(<MemoryRouter><InspectionsRoute /></MemoryRouter>);
    await screen.findByText('Pre-Trip', {}, { timeout: 3000 });
    expect(screen.getByText('Annual')).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument();
  });
});
