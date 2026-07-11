import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePanicAlerts } from '../usePanicAlerts';

const mockSubscribe = vi.fn(() => () => {});
vi.mock('../../context/WebSocketContext', () => ({
  useWebSocket: () => ({ subscribe: mockSubscribe, isConnected: true }),
}));

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('usePanicAlerts', () => {
  beforeEach(() => { mockApiFetch.mockReset(); mockSubscribe.mockClear(); });

  it('fetches active panic alerts on mount', async () => {
    mockApiFetch.mockResolvedValue([{ id: 1, status: 'active', user_name: 'J. Smith', created_at: '2026-07-04T10:00:00Z' }]);
    const { result } = renderHook(() => usePanicAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(mockApiFetch).toHaveBeenCalledWith('/dispatch/panic');
  });

  it('subscribes to panic_alert WS events for refetch', () => {
    mockApiFetch.mockResolvedValue([]);
    renderHook(() => usePanicAlerts());
    expect(mockSubscribe).toHaveBeenCalledWith('panic_alert', expect.any(Function));
  });
});
