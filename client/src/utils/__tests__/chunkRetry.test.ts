import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isChunkLoadError,
  normalizeChunkError,
  mayReloadForChunkFailure,
  reloadAndHold,
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
