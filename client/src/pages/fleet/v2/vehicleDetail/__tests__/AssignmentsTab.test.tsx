import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssignmentsTab } from '../AssignmentsTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, officer_name: 'Jones, A.', assigned_date: '2026-01-15', ended_date: null, notes: 'Take-home' },
    { id: 2, officer_name: 'Smith, B.', assigned_date: '2025-08-01', ended_date: '2026-01-14', notes: null },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<AssignmentsTab>', () => {
  it('renders assignment history with ACTIVE badge for the current one', async () => {
    render(<AssignmentsTab vehicleId={42} />);
    await screen.findByText(/jones, a\./i, {}, { timeout: 3000 });
    expect(screen.getByText(/smith, b\./i)).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/take-home/i)).toBeInTheDocument();
  });

  it('renders empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<AssignmentsTab vehicleId={42} />);
    await screen.findByText(/no assignment/i, {}, { timeout: 3000 });
  });
});
