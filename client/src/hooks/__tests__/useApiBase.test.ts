import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the pure probe logic without React rendering.
// The actual hook is tested via integration; here we verify the probe helper.

const CLOUD_BASE = 'https://api.rmpgutah.us';
const LOCAL_BASE = 'http://fz55:8787';

describe('buildApiBase probe logic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns local when probe responds ok under 500ms', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const { probeLocal } = await import('../useApiBase');
    const result = await probeLocal(LOCAL_BASE);
    expect(result).toBe(true);
  });

  it('returns false when probe throws', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { probeLocal } = await import('../useApiBase');
    const result = await probeLocal(LOCAL_BASE);
    expect(result).toBe(false);
  });

  it('returns false when probe returns not ok', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);

    const { probeLocal } = await import('../useApiBase');
    const result = await probeLocal(LOCAL_BASE);
    expect(result).toBe(false);
  });
});
