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

// ------------------------------------------------------------------
// HTTP-cache poison repair
//
// Everything above this line treats a chunk failure as "our index.html is
// stale, so reload to get a fresh one". That is the deploy-hash-rotation
// failure, and for it the model is right. It is NOT the only failure.
//
// The other one (confirmed live 2026-07-31, and again 2026-08-01 on
// `fleet-Bo7wm5uF.js`): during a Pages deploy's propagation window the CDN
// answers a not-yet-published chunk URL with its SPA-fallback **index.html**,
// HTTP 200, `content-type: text/html`. Chunk assets ship
// `cache-control: public, max-age=14400`, so the browser stores that HTML
// under the chunk's URL for FOUR HOURS. From then on the origin is healthy,
// index.html is current, the hash is current — and this one browser keeps
// reading HTML where it expects JavaScript.
//
// Why the retry ladder cannot touch it: every rung is a bare `import()`, and
// a bare `import()` reads the HTTP cache. Re-running it returns the identical
// poisoned bytes; sleeping does not shorten a 4-hour TTL. The reload then
// re-fetches the same current index naming the same poisoned chunk. All five
// recovery steps are no-ops by construction, which is exactly why users hit
// the ErrorBoundary card despite this whole module existing.
//
// `fetch(url, {cache: 'reload'})` is the ONLY lever JS has over the HTTP
// cache. The mode is load-bearing: 'reload' bypasses the cache AND writes the
// fresh response back into it, so the retried `import()` reads clean bytes.
// 'no-store' would fetch fresh but leave the poison cached, and the retry
// after it would fail identically. Do not "simplify" the mode.
// (index.html's entry-script recovery learned this first — see
// __tests__/entryRecovery.test.ts. The lazy-chunk path never got it.)
// ------------------------------------------------------------------

/** Extensions we're willing to re-request. A chunk URL is always a JS module. */
const REPAIRABLE_CHUNK_EXT = /\.m?js$/i;

/**
 * Pull the chunk URL out of a dynamic-import error message.
 *
 * Chrome embeds it: "Failed to fetch dynamically imported module: <url>".
 * Firefox and Safari use different phrasing and often omit the URL — hence
 * best-effort, returning null rather than guessing. A null means "skip the
 * repair rung", never "fail"; the existing ladder still runs.
 *
 * Restricted to SAME-ORIGIN `.js`/`.mjs` on purpose. An error message is
 * attacker-influencable in principle (a third-party script's failure can land
 * in our handler), and this value feeds a `fetch()`, so we never re-request an
 * off-origin URL. `origin` is a parameter so this stays pure and testable.
 */
export function extractChunkUrl(err: unknown, origin: string): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/https?:\/\/[^\s"'()]+/);
  if (!match) return null;
  let parsed: URL;
  try {
    parsed = new URL(match[0]);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  if (!REPAIRABLE_CHUNK_EXT.test(parsed.pathname)) return null;
  return parsed.href;
}

/**
 * True when a response served for a chunk URL is the poisoned SPA fallback
 * rather than a module — i.e. an HTML content-type where JS was expected.
 * A zero-byte body counts too: sw.js's poison guard answers a JS-request-that-
 * returned-HTML with an empty 404, and its offline path with an empty 503,
 * so "no bytes" is the other observed shape of this same failure.
 */
export function isPoisonedChunkResponse(contentType: string | null, bodyLength: number | null): boolean {
  if (contentType && /text\/html/i.test(contentType)) return true;
  return bodyLength === 0;
}

export interface ChunkRepairDeps {
  /** Real: (url, init) => window.fetch(url, init). */
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  /** Real: window.location.origin. */
  origin: string;
}

/**
 * Attempt to evict a poisoned HTTP-cache entry for the failed chunk.
 *
 * Resolves `true` when a cache-bypassing re-request succeeded, meaning the
 * cache entry has been overwritten with the fresh response and a retried
 * `import()` is worth attempting. Resolves `false` when the URL couldn't be
 * recovered from the error, or the re-request itself failed — that's the
 * deploy-propagation case (the origin genuinely doesn't have the chunk yet),
 * where the caller's existing sleep-and-retry rungs are the correct handling.
 *
 * Never throws: this is an opportunistic extra rung layered under the existing
 * ladder, and a failure here must not replace the caller's real error.
 */
async function repairPoisonedChunkUrl(url: string, deps: ChunkRepairDeps): Promise<boolean> {
  try {
    // 'reload' (not 'no-store') so the fresh body REPLACES the poisoned cache
    // entry — see the block comment above.
    const res = await deps.fetchImpl(url, { cache: 'reload', credentials: 'same-origin' });
    if (!res.ok) return false;
    // Read the body so the response is fully consumed and committed to cache.
    const body = await res.text();
    // If the ORIGIN itself is still serving the poison, re-importing is
    // pointless — fall through to the propagation-window rungs instead.
    if (isPoisonedChunkResponse(res.headers.get('content-type'), body.length)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function repairPoisonedChunk(
  err: unknown,
  deps: ChunkRepairDeps,
): Promise<boolean> {
  const url = extractChunkUrl(err, deps.origin);
  if (!url) return false;
  return repairPoisonedChunkUrl(url, deps);
}

/** `repairPoisonedChunk` bound to real browser globals. */
export function repairPoisonedChunkInBrowser(err: unknown): Promise<boolean> {
  return repairPoisonedChunk(err, {
    fetchImpl: (url, init) => window.fetch(url, init),
    origin: window.location.origin,
  });
}

// ------------------------------------------------------------------
// Transitive-chunk gap (found 2026-08-08 verifying the PR #3310 fix live).
//
// `extractChunkUrl` can only ever recover the ONE url Chrome names in the
// top-level dynamic-import rejection — e.g. "DashboardPage-<hash>.js". When
// DashboardPage's failure is actually a STATICALLY-imported sub-chunk it pulls
// in (mapboxLoader, map, a print helper, a panel component — confirmed live:
// each was individually healthy at the origin but poisoned in one browser's
// HTTP cache), Chrome's error message still only names the top-level module.
// `repairPoisonedChunk` then "repairs" the one chunk that was never broken,
// and the reload lands right back on the real, still-poisoned sub-chunk.
//
// Resource Timing sees every sub-resource request the top-level rejection
// message can't name. sw.js's poison guard answers a poisoned hashed asset
// with a zero-byte 404 ("Stale chunk (HTML fallback)"), which shows up here
// as a `/assets/*.js` resource entry with no bytes transferred. Scanning the
// last CHUNK_FAILURE_LOOKBACK_MS of entries finds those failures directly,
// independent of what the browser's rejection message happened to name.
// ------------------------------------------------------------------

/** Minimal shape of a PerformanceResourceTiming entry we depend on — kept
 *  narrow and structural so tests can pass plain objects instead of real
 *  performance entries. */
export interface ResourceEntryLike {
  name: string;
  startTime: number;
  transferSize?: number;
  decodedBodySize?: number;
  /** Chrome 109+ only; undefined on engines that don't expose it. */
  responseStatus?: number;
}

const CHUNK_ASSET_PATTERN = /\/assets\/[^/]+\.m?js(?:[?#]|$)/i;

/** Only scan resource entries that finished within this long before "now" —
 *  bounds the scan to the failure that just happened, not every chunk the tab
 *  has ever loaded since it opened. */
export const CHUNK_FAILURE_LOOKBACK_MS = 15_000;

/**
 * Find same-origin `/assets/*.js` resource-timing entries from the last
 * `lookbackMs` that look like a failed load — zero bytes transferred/decoded,
 * with an HTTP error or network-error status when the engine reports one
 * (Chrome 109+ `responseStatus`; falls back to the zero-byte heuristic alone
 * on engines that don't expose it, since a genuinely cached hit for an
 * immutable hashed asset also reports 0 transferSize but non-zero
 * decodedBodySize).
 */
export function findFailedChunkResourceUrls(
  entries: ResourceEntryLike[],
  origin: string,
  now: number,
  lookbackMs: number = CHUNK_FAILURE_LOOKBACK_MS,
): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    if (now - e.startTime > lookbackMs) continue;
    let url: URL;
    try {
      url = new URL(e.name);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!CHUNK_ASSET_PATTERN.test(url.pathname)) continue;
    const zeroBytes = (e.transferSize ?? 0) === 0 && (e.decodedBodySize ?? 0) === 0;
    if (!zeroBytes) continue;
    const failed = typeof e.responseStatus === 'number'
      ? e.responseStatus === 0 || e.responseStatus >= 400
      : true;
    if (failed) out.add(url.href);
  }
  return Array.from(out);
}

/** `findFailedChunkResourceUrls` bound to real browser globals. */
export function findFailedChunkResourceUrlsInBrowser(now: number, lookbackMs?: number): string[] {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return [];
  const entries = performance.getEntriesByType('resource') as unknown as ResourceEntryLike[];
  return findFailedChunkResourceUrls(entries, window.location.origin, now, lookbackMs);
}

/**
 * Repair every candidate chunk URL — the one (if any) extracted from the
 * top-level error message, plus every recently-failed sub-resource found via
 * Resource Timing. Runs all repairs concurrently; resolves `true` if ANY of
 * them actually replaced a poisoned entry, so the caller knows a retry is
 * worth attempting.
 */
export async function repairAllPoisonedChunks(
  err: unknown,
  deps: ChunkRepairDeps,
  extraUrls: string[] = [],
): Promise<boolean> {
  const targets = new Set(extraUrls);
  const primary = extractChunkUrl(err, deps.origin);
  if (primary) targets.add(primary);
  if (targets.size === 0) return false;
  const results = await Promise.all(Array.from(targets).map((url) => repairPoisonedChunkUrl(url, deps)));
  return results.some(Boolean);
}

/** `repairAllPoisonedChunks` bound to real browser globals, sourcing
 *  transitive-chunk candidates from Resource Timing. */
export function repairAllPoisonedChunksInBrowser(err: unknown): Promise<boolean> {
  const origin = window.location.origin;
  const extraUrls = findFailedChunkResourceUrlsInBrowser(Date.now());
  return repairAllPoisonedChunks(err, { fetchImpl: (url, init) => window.fetch(url, init), origin }, extraUrls);
}

// ------------------------------------------------------------------
// Last-resort escalation: BROAD purge (operator decision, 2026-08-01).
//
// `repairPoisonedChunk` fixes the HTTP-cache half. There is a THIRD cache in
// play: the service worker's own Cache Storage. sw.js's poison guard can store
// an empty 404/503 body for a chunk URL, and unlike the HTTP cache, JS *can*
// evict that.
//
// Policy is BROAD — delete every cache key AND unregister the worker, matching
// what index.html's entry recovery already does. The narrow alternative (evict
// only `/assets/` entries, preserving the offline shell) was considered and
// rejected: it fixes strictly fewer failure modes, and a half-purged SW whose
// shell and chunk set disagree is its own wedge. The accepted cost is that an
// officer loses offline capability until their next online load — which is why
// this runs ONLY on the explicit user-initiated Reload button, never on an
// automatic retry path. An automatic purge could silently strip offline support
// from a unit in a dead-cellular zone with no one having asked for it.
//
// Never throws and never rejects: it runs on a recovery path where a hang or a
// thrown error is strictly worse than a partial purge. The two halves are
// guarded INDEPENDENTLY so a failure in one cannot skip the other, and the
// caller bounds total time (see RECOVERY_FETCH_CEILING_MS in ErrorBoundary).
// ------------------------------------------------------------------

export interface CacheEvictionDeps {
  /** Real: window.caches — undefined in a non-secure context. */
  cacheStorage?: CacheStorage;
  /** Real: navigator.serviceWorker — undefined where SW is unsupported. */
  serviceWorker?: ServiceWorkerContainer;
}

export async function evictPoisonedChunkCaches(deps: CacheEvictionDeps): Promise<void> {
  const { cacheStorage, serviceWorker } = deps;
  try {
    if (cacheStorage) {
      const keys = await cacheStorage.keys();
      // Per-key catch: one undeletable cache must not abort the rest.
      await Promise.all(keys.map((k) => cacheStorage.delete(k).catch(() => false)));
    }
  } catch { /* Cache Storage unavailable or keys() rejected — try the SW anyway */ }
  try {
    if (serviceWorker) {
      const regs = await serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch { /* SW unavailable or getRegistrations() rejected — nothing left to try */ }
}

/** `evictPoisonedChunkCaches` bound to real browser globals. */
export function evictPoisonedChunkCachesInBrowser(): Promise<void> {
  return evictPoisonedChunkCaches({
    cacheStorage: typeof caches !== 'undefined' ? caches : undefined,
    serviceWorker: typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  });
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
