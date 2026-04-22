import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────
vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('../../../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: () => () => {} }),
}));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, officer_id: 1, role: 'officer' } }),
}));

import { apiFetch } from '../../../../hooks/useApi';
import UnitStatusCard from '../UnitStatusCard';

describe('UnitStatusCard', () => {
  beforeEach(() => {
    (apiFetch as any).mockReset();
    cleanup();
  });

  it('module loads with a default export', async () => {
    const mod = await import('../UnitStatusCard');
    expect(mod.default).toBeDefined();
  });

  it('clicks 10-7 button → PUT status change, then refetch', async () => {
    (apiFetch as any).mockImplementation(async (url: string, opts?: any) => {
      if (!opts || opts.method === 'GET' || !opts.method) {
        // initial + post-mutation refetch — return an array (units list)
        return [{ id: 42, officer_id: 1, call_sign: 'U-42', unit_number: 'U-42', status: 'available' }];
      }
      // PUT status change
      return { success: true };
    });

    render(<UnitStatusCard />);

    await waitFor(() => expect(screen.getByText(/U-42/)).toBeInTheDocument());

    const oosBtn = screen.getByRole('button', { name: /10-7/i });
    fireEvent.click(oosBtn);

    await waitFor(() => {
      const putCall = (apiFetch as any).mock.calls.find(
        (c: any[]) => c[1] && c[1].method === 'PUT',
      );
      expect(putCall).toBeTruthy();
      expect(putCall[0]).toBe('/api/dispatch/units/42/status');
      expect(JSON.parse(putCall[1].body)).toEqual({ status: 'out_of_service' });
    });
  });
});
