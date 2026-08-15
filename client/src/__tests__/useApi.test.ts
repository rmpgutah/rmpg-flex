import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub audio and token side effects that don't exist in jsdom.
vi.mock('../utils/actionChimes', () => ({ chimeForApiSuccess: () => {}, nackForApiFailure: () => {} }));
vi.mock('../utils/tokenRefresh', () => ({ refreshAccessToken: async () => null }));

describe('resolveFallbackUrl', () => {
  let resolveFallbackUrl: (relativeUrl: string) => string | null;
  let _setConsecutiveFailuresForTest: (n: number) => void;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../hooks/useApi');
    resolveFallbackUrl = mod.resolveFallbackUrl;
    _setConsecutiveFailuresForTest = mod._setConsecutiveFailuresForTest;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when localStorage has no fallback entry', () => {
    // Threshold met but no key stored — must return null
    _setConsecutiveFailuresForTest(3);
    expect(resolveFallbackUrl('/api/test')).toBeNull();
  });

  it('returns the stored fallback URL when key is set and threshold is met', () => {
    localStorage.setItem('rmpg_fallback_api_url', 'http://192.168.1.100:8787');
    _setConsecutiveFailuresForTest(3);
    expect(resolveFallbackUrl('/api/dispatch/units')).toBe('http://192.168.1.100:8787/api/dispatch/units');
  });

  it('returns null when failures are below the threshold even if key is set', () => {
    localStorage.setItem('rmpg_fallback_api_url', 'http://192.168.1.100:8787');
    _setConsecutiveFailuresForTest(2);
    expect(resolveFallbackUrl('/api/test')).toBeNull();
  });
});
