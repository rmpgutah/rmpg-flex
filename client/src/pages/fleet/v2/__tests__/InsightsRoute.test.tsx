import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InsightsRoute, readSavedPeriod } from '../routes/InsightsRoute';

function stubApi(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    for (const path of Object.keys(handlers)) {
      if (url.includes(path)) {
        return Promise.resolve(new Response(JSON.stringify(handlers[path]), { status: 200 }));
      }
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('<InsightsRoute>', () => {
  it('renders the section header + period chips', () => {
    stubApi({});
    render(<MemoryRouter><InsightsRoute /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /insights/i })).toBeInTheDocument();
    // Period chips by their labels
    expect(screen.getByRole('button', { name: /^30d$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^90d$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ytd$/i })).toBeInTheDocument();
  });

  it('renders the KPI ribbon with values from /fleet-viz/kpi', async () => {
    stubApi({
      '/fleet-viz/kpi': {
        period: 'Last 90 days',
        in_service: 12, in_shop: 3, overdue_pms: 2,
        avg_mpg: 18.6, cost_per_mile: 0.42, total_cost: 9500, miles_driven: 22500,
      },
      '/fleet-viz/readiness': { count: 0, data: [] },
      '/fleet-viz/calls-per-gallon': { period: 'Last 90 days', count: 0, data: [] },
      '/fleet-viz/mpg-by-officer': { period: 'x', samples: [], by_officer: [] },
      '/fleet-viz/cost-per-mile': { period: 'x', count: 0, data: [] },
      '/fleet-viz/fuel-anomalies': { period: 'x', count: 0, data: [] },
    });
    render(<MemoryRouter><InsightsRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument()); // in-service
    expect(screen.getByText('3')).toBeInTheDocument();     // in-shop
    expect(screen.getByText('2')).toBeInTheDocument();     // overdue
    expect(screen.getByText('18.6')).toBeInTheDocument();  // avg mpg
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument(); // cost/mi
  });

  it('renders the readiness board with vehicle rows', async () => {
    stubApi({
      '/fleet-viz/kpi': { period: 'x', in_service: 0, in_shop: 0, overdue_pms: 0, avg_mpg: 0, cost_per_mile: null, total_cost: 0, miles_driven: 0 },
      '/fleet-viz/mpg-by-officer': { period: 'x', samples: [], by_officer: [] },
      '/fleet-viz/cost-per-mile': { period: 'x', count: 0, data: [] },
      '/fleet-viz/fuel-anomalies': { period: 'x', count: 0, data: [] },
      '/fleet-viz/readiness': {
        count: 2,
        data: [
          { id: 1, vehicle_name: 'Patrol 12', vehicle_number: 'P12', status: 'in_service', current_mileage: 50000, miles_to_pm: 1200, open_work_orders: 0, last_inspection_failed: 0, last_fuel_level: '7/8' },
          { id: 2, vehicle_name: 'Patrol 14', vehicle_number: 'P14', status: 'in_shop', current_mileage: 80000, miles_to_pm: -300, open_work_orders: 2, last_inspection_failed: 1, last_fuel_level: '1/4' },
        ],
      },
      '/fleet-viz/calls-per-gallon': { period: 'x', count: 0, data: [] },
    });
    render(<MemoryRouter><InsightsRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('P12')).toBeInTheDocument());
    expect(screen.getByText('P14')).toBeInTheDocument();
    // The failed inspection badge should appear
    expect(screen.getByText('FAIL')).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
  });

  it('renders the new V2/V5/V8 cards (PR 9b)', async () => {
    stubApi({
      '/fleet-viz/kpi': { period: 'x', in_service: 0, in_shop: 0, overdue_pms: 0, avg_mpg: 0, cost_per_mile: null, total_cost: 0, miles_driven: 0 },
      '/fleet-viz/readiness': { count: 0, data: [] },
      '/fleet-viz/calls-per-gallon': { period: 'x', count: 0, data: [] },
      '/fleet-viz/mpg-by-officer': { period: 'x', samples: [], by_officer: [] },
      '/fleet-viz/cost-per-mile': { period: 'x', count: 0, data: [] },
      '/fleet-viz/fuel-anomalies': { period: 'x', count: 0, data: [] },
      '/fleet-viz/pm-upcoming': {
        count: 2,
        data: [
          { id: 1, vehicle_number: 'P12', vehicle_name: null, current_mileage: 50000, next_service_mileage: 49000, next_service_date: '2026-06-20', miles_to_pm: -1000 },
          { id: 2, vehicle_number: 'P13', vehicle_name: null, current_mileage: 30000, next_service_mileage: 32000, next_service_date: '2026-07-15', miles_to_pm: 2000 },
        ],
      },
      '/fleet-viz/work-order-flow': {
        period: 'x',
        nodes: [
          { name: 'open', count: 5 },
          { name: 'in_progress', count: 3 },
          { name: 'waiting_parts', count: 1 },
          { name: 'completed', count: 12 },
          { name: 'cancelled', count: 0 },
        ],
      },
      '/fleet-viz/pm-timeline': {
        horizon_days: 90,
        count: 2,
        data: [
          { vehicle_id: 1, vehicle_number: 'P12', vehicle_name: null, next_service_date: '2026-06-20', next_service_mileage: 49000, current_mileage: 50000, bucket: 'overdue' },
          { vehicle_id: 2, vehicle_number: 'P13', vehicle_name: null, next_service_date: '2026-07-15', next_service_mileage: 32000, current_mileage: 30000, bucket: 'upcoming' },
        ],
      },
    });
    render(<MemoryRouter><InsightsRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/pm upcoming/i)).toBeInTheDocument());
    expect(screen.getByText(/work order flow/i)).toBeInTheDocument();
    expect(screen.getByText(/pm timeline/i)).toBeInTheDocument();
    // 1 overdue PM appears in BOTH the upcoming-card hint AND the
    // pm-timeline hint, so use getAllByText.
    expect(screen.getAllByText(/1 overdue/i).length).toBeGreaterThanOrEqual(1);
    // 21 total work orders flow → hint shows "21 total"
    await waitFor(() => expect(screen.getByText(/21 total/i)).toBeInTheDocument());
  });

  it('persists the selected period to localStorage (saved view, PR 9b)', () => {
    // readSavedPeriod is the pure helper exposed for tests.
    window.localStorage.removeItem('rmpg_fleet_insights_period');
    expect(readSavedPeriod()).toBe('90d');
    window.localStorage.setItem('rmpg_fleet_insights_period', 'ytd');
    expect(readSavedPeriod()).toBe('ytd');
    window.localStorage.setItem('rmpg_fleet_insights_period', 'bogus');
    expect(readSavedPeriod()).toBe('90d');  // rejects unknown values
    window.localStorage.removeItem('rmpg_fleet_insights_period');
  });

  it('renders the new V3/V4/V6 cards (PR 8b)', async () => {
    stubApi({
      '/fleet-viz/kpi': { period: 'x', in_service: 0, in_shop: 0, overdue_pms: 0, avg_mpg: 0, cost_per_mile: null, total_cost: 0, miles_driven: 0 },
      '/fleet-viz/readiness': { count: 0, data: [] },
      '/fleet-viz/calls-per-gallon': { period: 'x', count: 0, data: [] },
      '/fleet-viz/mpg-by-officer': { period: 'x', samples: [], by_officer: [] },
      '/fleet-viz/cost-per-mile': { period: 'x', count: 0, data: [] },
      '/fleet-viz/fuel-anomalies': { period: 'x', count: 0, data: [] },
    });
    render(<MemoryRouter><InsightsRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/mpg by officer/i)).toBeInTheDocument());
    expect(screen.getByText(/cost per mile/i)).toBeInTheDocument();
    expect(screen.getByText(/fuel anomalies/i)).toBeInTheDocument();
  });

  it('renders the calls-per-gallon moat with officer rows ranked by ratio', async () => {
    stubApi({
      '/fleet-viz/kpi': { period: 'x', in_service: 0, in_shop: 0, overdue_pms: 0, avg_mpg: 0, cost_per_mile: null, total_cost: 0, miles_driven: 0 },
      '/fleet-viz/mpg-by-officer': { period: 'x', samples: [], by_officer: [] },
      '/fleet-viz/cost-per-mile': { period: 'x', count: 0, data: [] },
      '/fleet-viz/fuel-anomalies': { period: 'x', count: 0, data: [] },
      '/fleet-viz/readiness': { count: 0, data: [] },
      '/fleet-viz/calls-per-gallon': {
        period: 'Last 90 days',
        count: 2,
        data: [
          { officer_id: 1, officer_name: 'Officer Alpha', total_gallons: 120, calls_handled: 240, calls_per_gallon: 2.00 },
          { officer_id: 2, officer_name: 'Officer Bravo', total_gallons: 100, calls_handled: 100, calls_per_gallon: 1.00 },
        ],
      },
    });
    render(<MemoryRouter><InsightsRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Officer Alpha')).toBeInTheDocument());
    expect(screen.getByText('Officer Bravo')).toBeInTheDocument();
    // The moat headline copy should be present
    expect(screen.getByText(/RMPG exclusive — Fleet\.io can't build this/i)).toBeInTheDocument();
  });
});
