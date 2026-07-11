import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePremiseAlertsList } from '../usePremiseAlertsList';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('usePremiseAlertsList', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('fetches all active premise alerts with no query params (global list, not location-scoped)', async () => {
    mockApiFetch.mockResolvedValue([{ id: 1, address: '123 Main St', alert_type: 'hazmat', alert_level: 'critical', title: 'Chemical spill' }]);
    const { result } = renderHook(() => usePremiseAlertsList());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(mockApiFetch).toHaveBeenCalledWith('/dispatch/geography/premise-alerts');
  });
});
