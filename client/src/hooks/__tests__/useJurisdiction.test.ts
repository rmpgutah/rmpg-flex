import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useJurisdiction } from '../useJurisdiction';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('useJurisdiction', () => {
  beforeEach(() => { mockApiFetch.mockReset(); });

  it('fetches jurisdiction info for an address with no record context', async () => {
    mockApiFetch.mockResolvedValue({
      resolved_county: 'utah', override: null, effective_county: 'utah',
      label: 'Utah County', manual_url: 'https://utahcounty.gov/...',
    });
    const { result } = renderHook(() => useJurisdiction('100 E Center St, American Fork, UT'));
    await act(async () => { await result.current.fetchInfo(); });
    await waitFor(() => expect(result.current.info?.label).toBe('Utah County'));
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/assessor/jurisdiction?address=100+E+Center+St%2C+American+Fork%2C+UT',
    );
  });

  it('includes record_type/record_id in the query when provided', async () => {
    mockApiFetch.mockResolvedValue({
      resolved_county: 'utah', override: 'tooele', effective_county: 'tooele',
      label: 'Tooele County', manual_url: 'https://tooeleco.gov/...',
    });
    const { result } = renderHook(() =>
      useJurisdiction('100 Main St', { recordType: 'business', recordId: 42 }));
    await act(async () => { await result.current.fetchInfo(); });
    await waitFor(() => expect(result.current.info?.override).toBe('tooele'));
    const calledUrl = mockApiFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('record_type=business');
    expect(calledUrl).toContain('record_id=42');
  });

  it('posts an override and refetches', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ok: true, county: 'summit' }) // POST
      .mockResolvedValueOnce({
        resolved_county: 'utah', override: 'summit', effective_county: 'summit',
        label: 'Summit County', manual_url: 'https://property.summitcounty.org/...',
      }); // subsequent GET
    const { result } = renderHook(() =>
      useJurisdiction('100 Main St', { recordType: 'property', recordId: 7 }));
    await act(async () => { await result.current.setOverride('summit'); });
    expect(mockApiFetch).toHaveBeenNthCalledWith(1, '/assessor/jurisdiction', {
      method: 'POST',
      body: JSON.stringify({ record_type: 'property', record_id: 7, county: 'summit' }),
    });
    await waitFor(() => expect(result.current.info?.effective_county).toBe('summit'));
  });

  it('surfaces a fetch error without throwing', async () => {
    mockApiFetch.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useJurisdiction('100 Main St'));
    await act(async () => { await result.current.fetchInfo(); });
    await waitFor(() => expect(result.current.error).toBe('network down'));
  });
});
