import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRecordPhotos } from '../useRecordPhotos';

const mockApiFetch = vi.fn();
const mockApiPostForm = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  apiPostForm: (...args: unknown[]) => mockApiPostForm(...args),
}));

describe('useRecordPhotos', () => {
  beforeEach(() => { mockApiFetch.mockReset(); mockApiPostForm.mockReset(); });

  it('loads photos for a business record on mount', async () => {
    mockApiFetch.mockResolvedValue([{ id: 1, url: '/api/business-photos/file/x.jpg', caption: null, category: 'storefront', kind: 'photo', uploaded_by: null, uploaded_at: '2026-01-01' }]);
    const { result } = renderHook(() => useRecordPhotos('business', 5));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    expect(mockApiFetch).toHaveBeenCalledWith('/business-photos/5');
  });

  it('uses the property endpoint + property_id field for property records', async () => {
    mockApiFetch.mockResolvedValue([]);
    mockApiPostForm.mockResolvedValue({ id: 2 });
    const { result } = renderHook(() => useRecordPhotos('property', 7));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/property-photos/7'));

    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await act(async () => { await result.current.upload(file, 'layout'); });
    expect(mockApiPostForm).toHaveBeenCalledWith('/property-photos', expect.any(FormData));
    const form = mockApiPostForm.mock.calls[0][1] as FormData;
    expect(form.get('property_id')).toBe('7');
    expect(form.get('kind')).toBe('layout');
  });

  it('removes a photo and refreshes', async () => {
    mockApiFetch.mockResolvedValue([]);
    const { result } = renderHook(() => useRecordPhotos('business', 5));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/business-photos/5'));
    const callsBefore = mockApiFetch.mock.calls.length;
    await act(async () => { await result.current.remove(3); });
    expect(mockApiFetch).toHaveBeenCalledWith('/business-photos/3', { method: 'DELETE' });
    // DELETE call plus at least one refresh (GET /business-photos/5) after it.
    expect(mockApiFetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
