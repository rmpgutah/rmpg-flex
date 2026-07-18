import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useParcelDetail } from '../useParcelDetail';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('useParcelDetail', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('fetches and stores the full parcel object', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      parcel: { parcel_number: 'UT-1', source: 'utah_county_assessor', source_url: 'x', year_built: 1998, raw_data_json: { 'Tax District': 'AF01' } },
      code: 'ok',
    });
    const { result } = renderHook(() => useParcelDetail());
    await act(async () => { await result.current.fetchDetail('UT-1'); });
    await waitFor(() => expect(result.current.parcel?.parcel_number).toBe('UT-1'));
    expect(mockApiFetch).toHaveBeenCalledWith('/assessor/parcel/UT-1');
  });

  it('sets an error and null parcel when not found', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, parcel: null, code: 'no_match' });
    const { result } = renderHook(() => useParcelDetail());
    await act(async () => { await result.current.fetchDetail('MISSING'); });
    await waitFor(() => expect(result.current.error).toMatch(/No detail available/));
    expect(result.current.parcel).toBeNull();
  });
});
