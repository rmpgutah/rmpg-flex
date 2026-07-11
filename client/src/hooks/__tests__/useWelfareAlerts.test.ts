import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWelfareAlerts } from '../useWelfareAlerts';

const mockSubscribe = vi.fn(() => () => {});
vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: mockSubscribe, isConnected: true }),
}));

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('useWelfareAlerts', () => {
  beforeEach(() => { mockApiFetch.mockReset(); mockSubscribe.mockClear(); });

  it('filters welfare status rows to only emergency/overdue', async () => {
    mockApiFetch.mockResolvedValue([
      { user_id: 1, status: 'normal', officer_name: 'A' },
      { user_id: 2, status: 'emergency', officer_name: 'B' },
      { user_id: 3, status: 'overdue', officer_name: 'C' },
    ]);
    const { result } = renderHook(() => useWelfareAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(2));
    expect(result.current.alerts.map(a => a.officer_name)).toEqual(['B', 'C']);
  });

  it('subscribes to panic_alert for refetch (shared broadcast helper with /welfare/help)', () => {
    mockApiFetch.mockResolvedValue([]);
    renderHook(() => useWelfareAlerts());
    expect(mockSubscribe).toHaveBeenCalledWith('panic_alert', expect.any(Function));
  });
});
