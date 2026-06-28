import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsRoute } from '../routes/ReportsRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (url.includes('/health-scores')) return Promise.resolve(new Response(JSON.stringify({ health_scores: [{ score: 85 }, { score: 92 }, { score: 55 }] }), { status: 200 }));
    if (url.includes('/maintenance-schedule')) return Promise.resolve(new Response(JSON.stringify({ schedule: [{ overdue: true }, { due_soon: true }, { due_soon: true }] }), { status: 200 }));
    if (url.includes('/service-alerts')) return Promise.resolve(new Response(JSON.stringify({ all_alerts: [{ severity: 'critical' }, { severity: 'low' }] }), { status: 200 }));
    if (url.includes('/overdue-inspections')) return Promise.resolve(new Response(JSON.stringify({ alerts: [{ id: 1 }] }), { status: 200 }));
    if (url.includes('/cost-trends')) return Promise.resolve(new Response(JSON.stringify({ cost_trends: [{ month: '2026-05', total: 4000 }, { month: '2026-06', total: 4500 }] }), { status: 200 }));
    if (url.includes('/monthly-spend')) return Promise.resolve(new Response(JSON.stringify({ monthly_spend: [{ month: '2026-05', total: 4000 }, { month: '2026-06', total: 4500 }] }), { status: 200 }));
    if (url.includes('/driver-performance')) return Promise.resolve(new Response(JSON.stringify({ drivers: [{ id: 1 }, { id: 2 }, { id: 3 }] }), { status: 200 }));
    if (url.includes('/vehicle-lifecycle')) return Promise.resolve(new Response(JSON.stringify({ lifecycle: [{ id: 1 }, { id: 2 }] }), { status: 200 }));
    return Promise.resolve(new Response('{}', { status: 200 }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<ReportsRoute>', () => {
  it('renders all 8 KPI cards', () => {
    render(<MemoryRouter><ReportsRoute /></MemoryRouter>);
    expect(screen.getByText('Health Scores')).toBeInTheDocument();
    expect(screen.getByText('Maintenance Schedule')).toBeInTheDocument();
    expect(screen.getByText('Service Alerts')).toBeInTheDocument();
    expect(screen.getByText('Overdue Inspections')).toBeInTheDocument();
    expect(screen.getByText('Cost Trends')).toBeInTheDocument();
    expect(screen.getByText('Monthly Spend')).toBeInTheDocument();
    expect(screen.getByText('Driver Performance')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Lifecycle')).toBeInTheDocument();
  });

  it('populates cards from their respective endpoints', async () => {
    render(<MemoryRouter><ReportsRoute /></MemoryRouter>);
    // Health score average = (85+92+55)/3 = 77.33 → "77"
    await screen.findByText('77', {}, { timeout: 3000 });
    // Maintenance overdue count = 1
    expect(screen.getByText(/1 overdue · 2 due soon/)).toBeInTheDocument();
    // Service alerts = 2 total, 1 critical
    expect(screen.getByText(/1 critical\/high/)).toBeInTheDocument();
  });
});
