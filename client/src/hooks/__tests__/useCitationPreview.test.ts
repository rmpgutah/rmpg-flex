import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCitationPreview } from '../useCitationPreview';

vi.mock('../../utils/pdf/v2', () => ({
  multiCopyPdfV2BlobUrl: vi.fn(async () => 'blob:fake'),
}));

// jsdom doesn't implement URL.createObjectURL/revokeObjectURL.
beforeEach(() => {
  if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = vi.fn();
});

describe('useCitationPreview', () => {
  it('returns null blobUrl until refresh() called (modal mode)', async () => {
    const { result } = renderHook(() => useCitationPreview({}, 'modal'));
    expect(result.current.blobUrl).toBeNull();
    await act(async () => { await result.current.refresh(); });
    expect(result.current.blobUrl).toBe('blob:fake');
  });

  it('auto-refreshes in side mode after form changes (debounced)', async () => {
    const { multiCopyPdfV2BlobUrl } = await import('../../utils/pdf/v2');
    const { rerender } = renderHook(({ f }: { f: any }) => useCitationPreview(f, 'side'), {
      initialProps: { f: { citation_number: 'A' } },
    });
    await waitFor(() => expect(multiCopyPdfV2BlobUrl).toHaveBeenCalledTimes(1), { timeout: 1000 });
    rerender({ f: { citation_number: 'B' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
    await waitFor(() => expect(multiCopyPdfV2BlobUrl).toHaveBeenCalledTimes(2), { timeout: 1000 });
  });
});
