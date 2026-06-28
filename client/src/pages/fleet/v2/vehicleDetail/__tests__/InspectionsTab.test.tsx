import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InspectionsTab } from '../InspectionsTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, inspection_type: 'Pre-Trip', inspection_date: '2026-06-21', passed: 1, inspector_name: 'Officer Jones', notes: null },
    { id: 2, inspection_type: 'Annual', inspection_date: '2026-04-15', passed: 0, inspector_name: 'Officer Smith', notes: 'Brake light out' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<InspectionsTab>', () => {
  it('renders inspections with pass/fail badge', async () => {
    render(<InspectionsTab vehicleId={42} />);
    await screen.findByText('Pre-Trip', {}, { timeout: 3000 });
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument();
    expect(screen.getByText(/brake light out/i)).toBeInTheDocument();
  });

  it('renders empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<InspectionsTab vehicleId={42} />);
    await screen.findByText(/no inspections/i, {}, { timeout: 3000 });
  });
});
