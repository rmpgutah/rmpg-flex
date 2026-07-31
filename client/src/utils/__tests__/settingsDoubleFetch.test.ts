// ============================================================
// /api/settings has TWO independent consumers reading two halves
// of one payload, both launched un-awaited from the same effect in
// Layout.tsx (~line 730):
//
//   loadSystemSettings()  → res.system        (utils/systemSettings.ts)
//   initSettingsSync()    → void pullSettings() → res.org / res.user
//
// Neither is awaited, so the second request starts before the first
// resolves: two identical concurrent GETs for one payload on every
// authenticated Layout mount. This pins that the apiFetch in-flight
// coalescing in useApi.ts collapses them.
//
// Deliberately NOT asserted: that either consumer stops calling.
// Both genuinely need their slice, and AdminSettingsTab depends on
// loadSystemSettings() issuing a real refetch after a save — so
// short-circuiting on a "already loaded" flag would break it.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSystemSettings } from '../systemSettings';
import { pullSettings } from '../settingsSync';

const PAYLOAD = {
  system: { enable_animations: 'true' },
  org: { theme: 'blue-silver' },
  user: { theme: 'blue-silver' },
};

describe('/api/settings double-fetch on Layout mount', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.setItem('rmpg_token', 'test-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.removeItem('rmpg_token');
    vi.restoreAllMocks();
  });

  it('serves both consumers from ONE request when fired concurrently', async () => {
    const urls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    global.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      await gate;
      return new Response(JSON.stringify(PAYLOAD), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    // Exactly the Layout.tsx ordering: both launched, neither awaited.
    const a = loadSystemSettings();
    const b = pullSettings();
    release();
    await Promise.all([a, b]);

    const settingsCalls = urls.filter((u) => u.endsWith('/api/settings'));
    expect(settingsCalls.length).toBe(1);

    // And the shared response must still be fully readable by the consumer
    // that did not start the request — proving each caller got its own clone.
    expect((await a).enable_animations).toBe('true');
  });
});
