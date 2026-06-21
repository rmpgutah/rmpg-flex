import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardRoute } from '../routes/DashboardRoute';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

function renderDash() {
  return render(<MemoryRouter><DashboardRoute /></MemoryRouter>);
}

describe('<DashboardRoute>', () => {
  it('renders the section header "Dashboard"', () => {
    renderDash();
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders the KPI ribbon', () => {
    renderDash();
    expect(screen.getByText(/in service/i)).toBeInTheDocument();
  });

  it('renders 3 cards: Upcoming Service, Recent Fuel, Recent Inspections', () => {
    renderDash();
    expect(screen.getByText(/upcoming service/i)).toBeInTheDocument();
    expect(screen.getByText(/recent fuel/i)).toBeInTheDocument();
    expect(screen.getByText(/recent inspections/i)).toBeInTheDocument();
  });

  it('each card has a "View all" link to its full section', () => {
    renderDash();
    const links = screen.getAllByRole('link', { name: /view all/i });
    expect(links.length).toBe(3);
    expect(links.map((l) => (l as HTMLAnchorElement).pathname).sort()).toEqual([
      '/fleet/v2/fuel',
      '/fleet/v2/inspections',
      '/fleet/v2/service',
    ]);
  });
});
