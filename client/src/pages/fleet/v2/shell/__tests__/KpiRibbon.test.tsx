import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { KpiRibbon } from '../KpiRibbon';

function stubFetch(map: Record<string, unknown>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    for (const [k, v] of Object.entries(map)) {
      if (url.includes(k)) return Promise.resolve(new Response(JSON.stringify(v), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('<KpiRibbon>', () => {
  it('renders 5 KPI cells with values from the 2 endpoints', async () => {
    stubFetch({
      '/api/fleet/analytics': { in_service: 15, in_maintenance: 2, monthly_fuel_spend_usd: 4321.5, monthly_cost_per_mile_usd: 0.42 },
      '/api/fleet/overdue-inspections': { alerts: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    render(<KpiRibbon />);
    await waitFor(() => expect(screen.getByText(/in service/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/15/)).toBeInTheDocument());
    expect(screen.getByText(/^2$/)).toBeInTheDocument();
    expect(screen.getByText(/^3$/)).toBeInTheDocument();
    expect(screen.getByText(/\$4,321/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument();
  });

  it('renders gracefully when an endpoint 404s (shows em-dashes)', async () => {
    stubFetch({});
    render(<KpiRibbon />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5));
  });
});
