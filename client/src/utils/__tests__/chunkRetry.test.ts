import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isChunkLoadError,
  normalizeChunkError,
  mayReloadForChunkFailure,
  reloadAndHold,
  extractChunkUrl,
  isPoisonedChunkResponse,
  repairPoisonedChunk,
  evictPoisonedChunkCaches,
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  CHUNK_RELOAD_HOLD_MS,
} from '../chunkRetry';

describe('isChunkLoadError', () => {
  it('matches the cross-engine dynamic-import failure vocabulary', () => {
    for (const m of [
      'Failed to fetch dynamically imported module: https://x/chunk-abc.js',
      'ChunkLoadError: Loading chunk 42 failed',
      'Failed to load module script',
      'Expected a JavaScript-or-Wasm module script but the server responded with MIME text/html',
      'Chunk load failed',
    ]) {
      expect(isChunkLoadError(new Error(m))).toBe(true);
    }
  });

  it('does not match unrelated errors (404 API call, type error, etc.)', () => {
    expect(isChunkLoadError(new Error('Request failed with status 404'))).toBe(false);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('some string')).toBe(false);
  });
});

describe('normalizeChunkError', () => {
  it('returns Error instances unchanged', () => {
    const e = new Error('boom');
    expect(normalizeChunkError(e)).toBe(e);
  });
  it('wraps non-Error values', () => {
    const out = normalizeChunkError('weird');
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe('Chunk load failed');
  });
});

describe('mayReloadForChunkFailure', () => {
  it('allows a reload when we have never reloaded', () => {
    expect(mayReloadForChunkFailure(1_000_000, null)).toBe(true);
  });
  it('blocks a reload inside the 30s window (the reload did not help → surface error)', () => {
    const now = 1_000_000;
    expect(mayReloadForChunkFailure(now, now - 5_000)).toBe(false);
    expect(mayReloadForChunkFailure(now, now - (CHUNK_RELOAD_WINDOW_MS - 1))).toBe(false);
  });
  it('allows a reload once the window has elapsed', () => {
    const now = 1_000_000;
    expect(mayReloadForChunkFailure(now, now - (CHUNK_RELOAD_WINDOW_MS + 1))).toBe(true);
  });
});

describe('reloadAndHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('triggers exactly one reload and stays pending until the hold elapses', async () => {
    const reload = vi.fn();
    const p = reloadAndHold<{ default: unknown }>(new Error('Chunk load failed'), {
      reload,
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
    });
    expect(reload).toHaveBeenCalledTimes(1);

    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    // Not settled before the bounded hold fires (mirrors "splash held during reload").
    await vi.advanceTimersByTimeAsync(CHUNK_RELOAD_HOLD_MS - 1);
    expect(settled).toBe(false);
  });

  it('REJECTS after the hold so a stuck reload surfaces a recovery pathway', async () => {
    const original = new Error('Failed to fetch dynamically imported module');
    const p = reloadAndHold(original, {
      reload: vi.fn(),
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      holdMs: 500,
    });
    const rejection = expect(p).rejects.toThrow('Failed to fetch dynamically imported module');
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });

  it('normalizes a non-Error rejection reason', async () => {
    const p = reloadAndHold('weird-non-error', {
      reload: vi.fn(),
      setTimer: (cb, ms) => setTimeout(cb, ms) as unknown as number,
      holdMs: 100,
    });
    const rejection = expect(p).rejects.toThrow('Chunk load failed');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });
});

describe('extractChunkUrl', () => {
  const ORIGIN = 'https://rmpgutah.us';

  it('recovers the chunk URL from the real Chrome message (the 2026-08-01 fleet failure)', () => {
    const err = new Error(
      'Failed to fetch dynamically imported module: https://rmpgutah.us/assets/fleet-Bo7wm5uF.js',
    );
    expect(extractChunkUrl(err, ORIGIN)).toBe('https://rmpgutah.us/assets/fleet-Bo7wm5uF.js');
  });

  it('returns null for engines that omit the URL (Firefox/Safari phrasing)', () => {
    expect(extractChunkUrl(new Error('error loading dynamically imported module'), ORIGIN)).toBeNull();
    expect(extractChunkUrl(new Error('Importing a module script failed.'), ORIGIN)).toBeNull();
  });

  it('REFUSES an off-origin URL — this value feeds a fetch()', () => {
    const err = new Error('Failed to fetch dynamically imported module: https://evil.example/x.js');
    expect(extractChunkUrl(err, ORIGIN)).toBeNull();
  });

  it('refuses non-JS paths', () => {
    const err = new Error('Failed to fetch dynamically imported module: https://rmpgutah.us/a/b.css');
    expect(extractChunkUrl(err, ORIGIN)).toBeNull();
  });

  it('accepts .mjs and tolerates non-Error values', () => {
    expect(extractChunkUrl(new Error('boom https://rmpgutah.us/x.mjs'), ORIGIN))
      .toBe('https://rmpgutah.us/x.mjs');
    expect(extractChunkUrl('https://rmpgutah.us/y.js failed', ORIGIN)).toBe('https://rmpgutah.us/y.js');
    expect(extractChunkUrl(undefined, ORIGIN)).toBeNull();
  });
});

describe('isPoisonedChunkResponse', () => {
  it('flags HTML served for a JS URL (the Pages SPA fallback)', () => {
    expect(isPoisonedChunkResponse('text/html; charset=utf-8', 5000)).toBe(true);
  });
  it('flags an empty body (sw.js poison-guard 404 / offline 503)', () => {
    expect(isPoisonedChunkResponse('application/javascript', 0)).toBe(true);
  });
  it('accepts a real module', () => {
    expect(isPoisonedChunkResponse('application/javascript', 393642)).toBe(false);
  });
});

describe('repairPoisonedChunk', () => {
  const ORIGIN = 'https://rmpgutah.us';
  const POISONED = new Error(
    'Failed to fetch dynamically imported module: https://rmpgutah.us/assets/fleet-Bo7wm5uF.js',
  );
  const jsResponse = () => new Response('export default 1;', {
    status: 200,
    headers: { 'content-type': 'application/javascript' },
  });

  it("re-requests with cache:'reload' — the ONLY mode that also REPLACES the poisoned entry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsResponse());
    await expect(repairPoisonedChunk(POISONED, { fetchImpl, origin: ORIGIN })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://rmpgutah.us/assets/fleet-Bo7wm5uF.js',
      expect.objectContaining({ cache: 'reload' }),
    );
    // 'no-store' would fetch fresh but leave the poison cached, so the retried
    // import() would fail identically. Pin the mode, not just "some fetch".
    expect(fetchImpl.mock.calls[0][1].cache).not.toBe('no-store');
  });

  it('reports NOT-repaired when the origin itself still serves the SPA fallback', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    // Origin is genuinely poisoned → re-importing is pointless; the caller's
    // propagation-window sleeps are the correct handling.
    await expect(repairPoisonedChunk(POISONED, { fetchImpl, origin: ORIGIN })).resolves.toBe(false);
  });

  it('reports NOT-repaired on a propagation-window 500 (deploy still replicating)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(repairPoisonedChunk(POISONED, { fetchImpl, origin: ORIGIN })).resolves.toBe(false);
  });

  it('never throws, and never fetches at all, when the URL is unrecoverable', async () => {
    const fetchImpl = vi.fn();
    await expect(
      repairPoisonedChunk(new Error('Importing a module script failed.'), { fetchImpl, origin: ORIGIN }),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('swallows a rejected fetch (offline) rather than replacing the caller error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(repairPoisonedChunk(POISONED, { fetchImpl, origin: ORIGIN })).resolves.toBe(false);
  });
});

describe('evictPoisonedChunkCaches (BROAD policy)', () => {
  const makeCaches = (keys: string[], overrides: Partial<CacheStorage> = {}) => ({
    keys: vi.fn().mockResolvedValue(keys),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as CacheStorage);

  const makeSw = (regs: Array<{ unregister: () => Promise<boolean> }>) => ({
    getRegistrations: vi.fn().mockResolvedValue(regs),
  } as unknown as ServiceWorkerContainer);

  it('deletes EVERY cache key and unregisters EVERY worker', async () => {
    const cacheStorage = makeCaches(['rmpg-flex-abc123', 'rmpg-flex-def456']);
    const unregister = vi.fn().mockResolvedValue(true);
    const serviceWorker = makeSw([{ unregister }, { unregister }]);

    await evictPoisonedChunkCaches({ cacheStorage, serviceWorker });

    expect(cacheStorage.delete).toHaveBeenCalledTimes(2);
    expect(cacheStorage.delete).toHaveBeenCalledWith('rmpg-flex-abc123');
    expect(cacheStorage.delete).toHaveBeenCalledWith('rmpg-flex-def456');
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it('still unregisters the SW when the cache half THROWS (independent guards)', async () => {
    const cacheStorage = makeCaches([], { keys: vi.fn().mockRejectedValue(new Error('no cache')) });
    const unregister = vi.fn().mockResolvedValue(true);
    await expect(
      evictPoisonedChunkCaches({ cacheStorage, serviceWorker: makeSw([{ unregister }]) }),
    ).resolves.toBeUndefined();
    // The whole point of splitting the try/catch: a dead Cache Storage must not
    // leave the poisoned worker registered.
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('still deletes caches when the SW half THROWS', async () => {
    const cacheStorage = makeCaches(['rmpg-flex-abc123']);
    const serviceWorker = {
      getRegistrations: vi.fn().mockRejectedValue(new Error('no sw')),
    } as unknown as ServiceWorkerContainer;
    await expect(evictPoisonedChunkCaches({ cacheStorage, serviceWorker })).resolves.toBeUndefined();
    expect(cacheStorage.delete).toHaveBeenCalledWith('rmpg-flex-abc123');
  });

  it('AWAITS the surviving deletes when one cache is undeletable', async () => {
    // NB: asserting `delete` was called 3× proves nothing — `.map()` fires all
    // three synchronously regardless. The real guarantee of the per-key
    // `.catch` is that Promise.all keeps WAITING for the survivors instead of
    // rejecting on the first failure; without it we resolve early and the
    // caller reloads while deletes are still in flight. So observe the timing.
    let settleB: (v: boolean) => void = () => {};
    const bDone = new Promise<boolean>((r) => { settleB = r; });
    const del = vi.fn((key: string) => (
      key === 'a' ? Promise.reject(new Error('locked')) : bDone
    ));
    const cacheStorage = makeCaches(['a', 'b'], { delete: del as unknown as CacheStorage['delete'] });

    let resolved = false;
    const p = evictPoisonedChunkCaches({ cacheStorage }).then(() => { resolved = true; });

    // Cross a full macrotask boundary so EVERY pending microtask drains — a
    // handful of `await Promise.resolve()` is not enough to let the reject →
    // outer-catch → return chain complete, which is why a shallower drain let
    // this mutation through. A rejecting Promise.all resolves the function here.
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);

    settleB(true);
    await p;
    expect(resolved).toBe(true);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('is a safe no-op when neither API exists (non-secure context)', async () => {
    await expect(evictPoisonedChunkCaches({})).resolves.toBeUndefined();
  });
});

describe('index.html entry-graph guard', () => {
  // index.html can't import chunkRetry.ts (it runs before any module has
  // loaded), so it carries its own inline copies of the reload key/window.
  // Pin those literals to the exported constants so a future rename here
  // can't silently drift the two recovery paths apart (see the comment
  // above CHUNK_RELOAD_KEY: "Do NOT change this string in isolation").
  it('uses the same reload key and window as chunkRetry.ts', () => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    expect(html).toContain(`'${CHUNK_RELOAD_KEY}'`);
    expect(html).toContain(String(CHUNK_RELOAD_WINDOW_MS));
  });
});
