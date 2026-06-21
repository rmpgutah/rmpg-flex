import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ServiceRoute } from '../routes/ServiceRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (/\/api\/fleet(\?|$)/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify([{ id: 1, vehicle_name: 'Unit 12' }]), { status: 200 }));
    }
    if (url.includes('/api/fleet/1/maintenance')) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: 11, service_type: 'Oil Change', service_date: '2026-06-15', vendor: 'Jiffy Lube', cost: 89.99, mileage_at_service: 47000 },
      ]), { status: 200 }));
    }
    return Promise.resolve(new Response('[]', { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<ServiceRoute>', () => {
  it('fans out across vehicles and renders combined service entries', async () => {
    render(<MemoryRouter><ServiceRoute /></MemoryRouter>);
    await screen.findByText('Oil Change', {}, { timeout: 3000 });
    expect(screen.getByText('Unit 12')).toBeInTheDocument();
    expect(screen.getByText('Jiffy Lube')).toBeInTheDocument();
  });
});
