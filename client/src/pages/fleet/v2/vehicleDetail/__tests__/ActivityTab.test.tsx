import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityTab } from '../ActivityTab';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
    rows: [
      { id: 1, action: 'STATUS_CHANGE', details: '{"from":"in_service","to":"maintenance"}', created_at: '2026-06-20T10:00:00Z', user_id: 7 },
      { id: 2, action: 'ODOMETER_UPDATE', details: '47283', created_at: '2026-06-19T08:00:00Z', user_id: 7 },
    ],
  }), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<ActivityTab>', () => {
  it('renders audit_log rows with their action labels in Title Case', async () => {
    render(<ActivityTab vehicleId={42} />);
    await screen.findByText('Status Change', {}, { timeout: 3000 });
    expect(screen.getByText('Odometer Update')).toBeInTheDocument();
  });

  it('renders empty state when no rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [] }), { status: 200 })));
    render(<ActivityTab vehicleId={42} />);
    await screen.findByText(/no activity/i, {}, { timeout: 3000 });
  });
});
