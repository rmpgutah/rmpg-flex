import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecallsTab } from '../RecallsTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, recall_number: 'NHTSA-22V-001', recall_title: 'Brake hose', description: 'Brake hose may rupture', issue_date: '2026-03-01', status: 'open' },
    { id: 2, recall_number: 'NHTSA-21V-099', recall_title: 'Airbag', description: '', issue_date: '2025-09-01', resolved_date: '2025-10-15' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<RecallsTab>', () => {
  it('renders recalls with OPEN / RESOLVED badges', async () => {
    render(<RecallsTab vehicleId={42} />);
    await screen.findByText('NHTSA-22V-001', {}, { timeout: 3000 });
    expect(screen.getByText('NHTSA-21V-099')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByText('RESOLVED')).toBeInTheDocument();
  });

  it('renders empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    render(<RecallsTab vehicleId={42} />);
    await screen.findByText(/no recalls/i, {}, { timeout: 3000 });
  });
});
