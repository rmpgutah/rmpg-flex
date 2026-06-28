import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DamageTab } from '../DamageTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, damage_type: 'Bumper scrape', severity: 'minor', report_date: '2026-06-01', description: 'Parking lot incident', estimated_cost: 350, status: 'reported' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<DamageTab>', () => {
  it('renders damage reports with severity + estimated cost', async () => {
    render(<DamageTab vehicleId={42} />);
    await screen.findByText(/bumper scrape/i, {}, { timeout: 3000 });
    expect(screen.getByText(/minor/i)).toBeInTheDocument();
    expect(screen.getByText(/Est. \$350/)).toBeInTheDocument();
  });

  it('renders empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<DamageTab vehicleId={42} />);
    await screen.findByText(/no damage/i, {}, { timeout: 3000 });
  });
});
