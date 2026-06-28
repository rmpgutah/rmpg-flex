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
  it('renders cells against the real /api/fleet/analytics shape (status_breakdown + fleet_summary + cost_per_mile_ranking)', async () => {
    stubFetch({
      '/api/fleet/analytics': {
        status_breakdown: [
          { status: 'in_service', count: 15 },
          { status: 'maintenance', count: 2 },
          { status: 'out_of_service', count: 1 },
        ],
        fleet_summary: { total_fuel_cost: 4321.5 },
        cost_per_mile_ranking: [
          { vehicle_id: 1, cost_per_mile: 0.42 },
          { vehicle_id: 2, cost_per_mile: 0.50 },
          { vehicle_id: 3, cost_per_mile: 0.34 },
        ],
      },
      '/api/fleet/overdue-inspections': { alerts: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    render(<KpiRibbon />);
    await waitFor(() => expect(screen.getByText(/in service/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/15/)).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(/^2$/)).toBeInTheDocument();          // maintenance
    expect(screen.getByText(/^3$/)).toBeInTheDocument();          // overdue PMs (alerts.length)
    expect(screen.getByText(/\$4,321/)).toBeInTheDocument();      // fuel period total
    // Avg cost-per-mile = (0.42 + 0.50 + 0.34) / 3 = 0.42 → "$0.42"
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument();
  });

  it('renders gracefully when an endpoint 404s (shows em-dashes)', async () => {
    stubFetch({});
    render(<KpiRibbon />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5));
  });
});
