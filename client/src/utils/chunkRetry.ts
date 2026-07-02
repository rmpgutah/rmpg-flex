// ============================================================
// chunkRetry — shared resilience for stale dynamic-import failures
//
// After a Cloudflare Pages deploy rotates chunk hashes, a long-lived tab
// requests an old hash the CDN no longer serves, so `import()` rejects with a
// "Failed to fetch dynamically imported module" / "Chunk load failed" error.
// The recovery is to reload ONCE to pick up the fresh index.
//
// The subtlety this module fixes: the reload-wait must be BOUNDED. Both call
// sites (App.tsx `lazyRetry` and `importWithRetry`) previously returned a
// promise that NEVER settles after calling `window.location.reload()`, on the
// assumption the reload always tears the page down. When it doesn't —
// offline / dead cellular, a service worker serving a stale shell (a documented
// recurring incident here), a captive portal or Cloudflare "Just a moment"
// challenge, or a mobile webview that ignores reload() — that pending promise
// strands the user: `lazyRetry` on a button-less full-screen Suspense splash
// ("the entire system is frozen, no pathway"), `importWithRetry` on a
// forever-pending feature call. Bounding the hold means a reload that fails to
// navigate surfaces a real error instead — the ErrorBoundary recovery card (which
// has a working Reload button) for routes, or the caller's catch for features.
//
// The pure helpers here are unit-tested in __tests__/chunkRetry.test.ts.
// ============================================================

/** Shared across lazyRetry, importWithRetry, AND ErrorBoundary.componentDidCatch
 *  — a single key so the "reloaded within the last 30s" guard is consistent and
 *  a failed reload can't loop. Do NOT change this string in isolation. */
export const CHUNK_RELOAD_KEY = 'rmpg_chunk_reload';

/** Only reload once per this window; a second failure inside it means the reload
 *  didn't help, so we surface the error instead of reloading again. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

/** How long to keep holding (showing the Suspense splash / pending promise)
 *  while a reload navigates away, before giving up and rejecting so a recovery
 *  pathway appears. Long enough for a slow reload, short enough to never feel
 *  permanent. In the happy path the page is torn down well before this fires. */
export const CHUNK_RELOAD_HOLD_MS = 10_000;

// The full vocabulary of dynamic-import failures across engines: Chrome's
// "Failed to fetch dynamically imported module", webpack's "ChunkLoadError" /
// "Loading chunk", the MIME rejection ("expected a JavaScript-or-Wasm module
// script" / "Failed to load module script" / "'text/html' is not a valid
// JavaScript MIME type" — the exact phrasing Chrome uses when the SW's own
// poison-guard, or a Pages SPA fallback, serves stale-chunk HTML with a 200;
// missing this marker meant ErrorBoundary's auto-reload safety net (which
// gates on isChunkLoadError) skipped a real stale-chunk failure and showed
// the manual-recovery card instead, 2026-07-02), and our own sentinel.
const CHUNK_ERROR_MARKERS = [
  'failed to fetch dynamically imported module',
  'chunkloaderror',
  'loading chunk',
  'failed to load module script',
  'expected a javascript-or-wasm module',
  'chunk load failed',
  'is not a valid javascript mime type',
];

/** True when an error looks like a stale/failed dynamic-import (chunk) load. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return CHUNK_ERROR_MARKERS.some((m) => msg.includes(m));
}

/** Coerce an unknown thrown value into an Error with a stable chunk message. */
export function normalizeChunkError(err: unknown): Error {
  return err instanceof Error ? err : new Error('Chunk load failed');
}

/**
 * Decide whether we're allowed to reload again: yes if we've never reloaded, or
 * the last reload was longer than `windowMs` ago. A reload INSIDE the window
 * means the previous one didn't fix it, so the caller should surface the error
 * (recovery card / catch) rather than reload-loop.
 */
export function mayReloadForChunkFailure(
  now: number,
  lastReloadAt: number | null,
  windowMs: number = CHUNK_RELOAD_WINDOW_MS,
): boolean {
  return lastReloadAt === null || now - lastReloadAt > windowMs;
}

export interface ReloadHoldDeps {
  /** Trigger the page reload (real: () => window.location.reload()). */
  reload: () => void;
  /** Schedule the give-up timer (real: (cb, ms) => window.setTimeout(cb, ms)). */
  setTimer: (cb: () => void, ms: number) => unknown;
  /** Override the hold duration (tests / tuning). */
  holdMs?: number;
}

/**
 * Trigger a one-time reload and return a promise that stays pending while the
 * reload navigates away — but REJECTS after `holdMs` if it hasn't, so the caller
 * surfaces a recovery pathway instead of hanging forever. In the happy path the
 * document is torn down before the timer fires, so the rejection never runs.
 */
export function reloadAndHold<T>(err: unknown, deps: ReloadHoldDeps): Promise<T> {
  deps.reload();
  const holdMs = deps.holdMs ?? CHUNK_RELOAD_HOLD_MS;
  return new Promise<T>((_resolve, reject) => {
    deps.setTimer(() => reject(normalizeChunkError(err)), holdMs);
  });
}

/**
 * Convenience wrapper over the read-decide-record-reload dance shared by both
 * call sites, using real browser globals. Returns a bounded pending promise when
 * a reload is triggered, or `null` when we're inside the reload window and the
 * caller should rethrow the original error.
 */
export function tryReloadForChunkFailure<T>(err: unknown): Promise<T> | null {
  let lastAt: number | null = null;
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    lastAt = raw ? parseInt(raw, 10) : null;
    if (lastAt !== null && Number.isNaN(lastAt)) lastAt = null;
  } catch { /* sessionStorage unavailable (private mode) — treat as never reloaded */ }

  if (!mayReloadForChunkFailure(Date.now(), lastAt)) return null;

  try { sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
  return reloadAndHold<T>(err, {
    reload: () => window.location.reload(),
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
  });
}
