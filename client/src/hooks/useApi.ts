import { useState, useCallback } from 'react';
import { uploadWithProgress, putFileDirect } from '../utils/uploadWithProgress';
import type { UploadProgress } from '../utils/uploadWithProgress';
import { refreshAccessToken } from '../utils/tokenRefresh';
import { chimeForApiSuccess, nackForApiFailure } from '../utils/actionChimes';
import { isAppHostname, WORKER_HTTP_ORIGIN } from '../utils/apiOrigin';

// ─── Request Timeout ─────────────────────────────────────────
// Default 60s — generous for flaky cellular but bounded so officers
// don't wait minutes for the browser's default ~120s timeout to fire.
// Callers can override per-request via apiFetch(url, { timeoutMs }).
export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

// Disabled (Infinity) as of the file-encryption-at-rest merge: the
// Worker-proxied multipart route (POST /api/uploads) now encrypts every
// attachment via putEncrypted() before writing to R2, but a presigned
// direct-to-R2 PUT bypasses the Worker entirely — the Worker never sees
// those bytes, so they'd land unencrypted. Until the direct-upload path
// is taught to participate in encryption-at-rest (or is scoped to a
// bucket outside that requirement), every attachment goes through the
// multipart route regardless of size, same as before this threshold
// existed. apiUploadFileDirect() and the /api/uploads/presign* routes
// are still live — the admin Map Data Files feature uses the same
// underlying presign mechanism against system-essentials, which was
// never in the encryption-at-rest scope.
const DIRECT_UPLOAD_THRESHOLD_BYTES = Infinity;

/**
 * Thrown by `fetchWithTimeout` (and `apiFetch` / `apiFetchBlob` /
 * `apiUploadFiles` indirectly) when a request exceeds its allotted
 * `timeoutMs`. Callers can `instanceof TimeoutError` to surface a
 * timeout-specific message instead of a generic network error.
 */
export class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly url: string;
  constructor(timeoutMs: number, url: string) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

/**
 * fetch() wrapped with an AbortController-backed timeout. On timeout,
 * the underlying request is aborted and a TimeoutError is thrown.
 * If the caller supplied their own `signal` (e.g. component unmount),
 * we honor it: when their signal aborts we propagate the abort, but
 * an external AbortError is rethrown unchanged (not as TimeoutError).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: externalSignal, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  // If the caller supplied a signal, abort our controller when theirs fires.
  let onExternalAbort: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      // Fast-path: caller already aborted before we started.
      throw new DOMException('Aborted', 'AbortError');
    }
    onExternalAbort = () => controller.abort();
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (err: any) {
    if (err && err.name === 'AbortError') {
      if (timedOut) throw new TimeoutError(timeoutMs, url);
      // External abort (component unmount, etc.) — propagate as-is.
      throw err;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}


// Access window.electron safely (only present in Electron desktop app)
const electron = typeof window !== 'undefined' ? (window as any).electron : null;

// ─── Image URL helper (adds auth token for <img src=> loads) ────
/**
 * Wraps an image URL so it authenticates against /api/uploads endpoints.
 * - data: URLs and blob: URLs are returned unchanged
 * - /api/uploads paths (relative or absolute, e.g. `${window.location.origin}/api/...`)
 *   get ?token=<jwt> appended (server accepts via authenticateTokenOrQuery)
 * - Already-signed URLs (containing ?sig=) are returned unchanged
 */
export function authedImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.includes('?sig=') || url.includes('&sig=')) return url;
  // Resolve against window.location.origin so absolute URLs (e.g. a caller building
  // `${window.location.origin}/api/...`) are recognized the same as relative `/api/...`
  // paths — a future caller building an absolute URL shouldn't silently lose the token.
  // new URL() never throws when given a base, so this is safe for any string input.
  const pathname = new URL(url, window.location.origin).pathname;
  // Only append token for API paths that require auth
  if (pathname.includes('/api/uploads') || pathname.startsWith('/api/')) {
    const token = localStorage.getItem('rmpg_token');
    if (!token) return url;
    // Strip any existing token= param to prevent duplicates
    const cleanUrl = url.replace(/([?&])token=[^&]*&?/g, '$1').replace(/[?&]$/, '');
    const sep = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${sep}token=${encodeURIComponent(token)}`;
  }
  return url;
}

// ─── Mutation deduplication (prevent rapid double-click) ────
const inflightMutations = new Map<string, { promise: Promise<Response>; ts: number }>();
const DEDUP_WINDOW_MS = 500;

// ─── GET in-flight coalescing (cut cold-load duplicate reads) ────
// A cold load fires ~75 requests and several endpoints have more than one
// independent consumer in the same tick (/settings ×4, /user/preferences ×4,
// /dispatch/units ×2 — field DevTools 2026-07-31). Against the 600 req/300 s
// per-user budget in src/middleware/rateLimit.ts that duplication is what
// turns a few hard reloads into a 429 storm.
//
// Keyed by URL + header fingerprint (see getCoalesceKey), and the entry lives
// ONLY while the request is genuinely in flight — deleted the moment it
// settles. There is deliberately no TTL
// cache: no consumer may ever read a staler value than it would have without
// this optimization, which is non-negotiable for live CAD reads (unit
// positions, GPS). Contract pinned by
// client/src/hooks/__tests__/useApiGetCoalescing.test.ts.
const inflightGets = new Map<string, Promise<Response>>();

/**
 * Coalescing key for a request, or `null` when it must NOT share an in-flight
 * response with a concurrent twin. Two callers that resolve to the same key
 * must be indistinguishable from two callers each issuing their own request.
 *
 * Ineligible, and why:
 *  - Anything but GET. A POST/PATCH to the same URL is a distinct action with
 *    its own body; sharing one response would silently drop a write.
 *  - `init.signal` present. Callers that abort on unmount pass a signal; if
 *    such a caller *started* the shared request, its abort would reject the
 *    promise every follower awaits, failing a still-mounted component.
 *  - A body on a GET. Malformed, and the body is not part of the key.
 *
 * Headers are folded INTO the key rather than gating eligibility. apiFetch
 * adds Content-Type / X-Requested-With / Authorization uniformly, but callers
 * may pass extras via `options.headers`, and apiFetchBlob sends a different
 * set entirely. Fingerprinting them means a caller with distinct headers gets
 * its own request instead of one computed for somebody else's — and it also
 * means a token refreshed mid-flight can never share across two tokens.
 */
function getCoalesceKey(method: string, url: string, init: RequestInit): string | null {
  if (method !== 'GET') return null;
  if (init.signal) return null;
  if (init.body != null) return null;
  return `${url}\n${headerFingerprint(init.headers)}`;
}

/** Stable, order-independent fingerprint of a header set. */
function headerFingerprint(headers: HeadersInit | undefined): string {
  if (!headers) return '';
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Array.isArray(headers)
      ? headers.map(([k, v]) => [k, v] as [string, string])
      : Object.entries(headers);
  return entries
    .map(([k, v]) => `${k.toLowerCase()}:${v}`)
    .sort()
    .join(' ');
}

// ─── Retry config for 500/502/503/504 (server restart recovery) ────
const RETRY_STATUS_CODES = [500, 502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  retries = MAX_RETRIES,
): Promise<Response> {
  const bodySize = init.body instanceof Blob ? init.body.size
    : init.body instanceof FormData ? Infinity
    : typeof init.body === 'string' ? init.body.length
    : 0;
  if (bodySize > 1_000_000) retries = 0;

  // Mutation deduplication — return existing in-flight promise for same URL+method.
  // Each caller gets a fresh .clone() of the underlying Response so they can each
  // read the body independently. Without the clone, the first caller's .json()
  // consumes the body and every subsequent caller throws
  // "Failed to execute 'json' on 'Response': body stream already read".
  // (Surfaced in field DevTools 2026-05-02 from useGpsTracking immediate-send +
  // batch-send racing on the same /api/dispatch/gps/* endpoint.)
  const method = init.method || 'GET';
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    const dedupKey = `${method}:${url}`;
    const existing = inflightMutations.get(dedupKey);
    if (existing && Date.now() - existing.ts < DEDUP_WINDOW_MS) {
      return existing.promise.then((res) => res.clone());
    }
  }

  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
  const dedupKey = isMutation ? `${method}:${url}` : '';

  const doFetch = async (): Promise<Response> => {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const maxAttempts = offline ? 0 : retries;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        // Per-attempt timeout (not cumulative across retries) — if a single
        // attempt hangs for `timeoutMs`, abort it and try again.
        const res = await fetchWithTimeout(url, init);
        if (RETRY_STATUS_CODES.includes(res.status) && attempt < maxAttempts) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[API] ${init.method || 'GET'} ${url} → ${res.status}, retrying in ${delay / 1000}s (${attempt + 1}/${maxAttempts})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return res;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        const stillOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (attempt < maxAttempts && !stillOffline) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[API] ${init.method || 'GET'} ${url} → network error, retrying in ${delay / 1000}s (${attempt + 1}/${maxAttempts})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }
    throw lastError || new Error('Server temporarily unavailable. Please try again.');
  };

  // GET coalescing. Note that EVERY caller — including the one that started
  // the request — receives a .clone(), and the stored Response itself is never
  // read. Handing the original to the first caller and clones to the rest
  // would break as soon as the first caller's .json() consumed the body before
  // a later follower got around to cloning it (clone() is only legal on an
  // unconsumed body).
  const coalesceKey = getCoalesceKey(method.toUpperCase(), url, init);
  if (coalesceKey) {
    const existing = inflightGets.get(coalesceKey);
    if (existing) return existing.then((res) => res.clone());

    const shared = doFetch();
    inflightGets.set(coalesceKey, shared);
    shared.finally(() => inflightGets.delete(coalesceKey)).catch(() => {});
    return shared.then((res) => res.clone());
  }

  const promise = doFetch();
  if (isMutation) {
    inflightMutations.set(dedupKey, { promise, ts: Date.now() });
    promise.finally(() => inflightMutations.delete(dedupKey)).catch(() => {});
  }
  return promise;
}

interface UseApiOptions {
  baseUrl?: string;
}

interface ApiState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
}

export function useApi<T = unknown>(options?: UseApiOptions) {
  const { baseUrl = '/api' } = options || {};
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });

  const getToken = () => localStorage.getItem('rmpg_token');

  const request = useCallback(
    async (
      method: string,
      endpoint: string,
      body?: unknown,
      customHeaders?: Record<string, string>
    ): Promise<T> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...customHeaders,
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;
        const fetchInit: RequestInit = {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        };
        let res = await fetchWithRetry(url, fetchInit);

        // On 401, attempt a transparent token refresh and retry once
        if (res.status === 401) {
          const newToken = await tryRefreshToken();
          if (newToken) {
            headers['Authorization'] = `Bearer ${newToken}`;
            res = await fetchWithRetry(url, { ...fetchInit, headers });
          }
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const message = errData.error || errData.message || `Request failed with status ${res.status}`;
          nackForApiFailure(method, url, res.status);
          throw new Error(message);
        }

        const data = await res.json();
        chimeForApiSuccess(method, url);
        setState({ data, error: null, isLoading: false });
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed';
        setState((prev) => ({ ...prev, error: message, isLoading: false }));
        throw err;
      }
    },
    [baseUrl]
  );

  const get = useCallback(
    (endpoint: string, headers?: Record<string, string>) => request('GET', endpoint, undefined, headers),
    [request]
  );

  const post = useCallback(
    (endpoint: string, body?: unknown, headers?: Record<string, string>) =>
      request('POST', endpoint, body, headers),
    [request]
  );

  const put = useCallback(
    (endpoint: string, body?: unknown, headers?: Record<string, string>) =>
      request('PUT', endpoint, body, headers),
    [request]
  );

  const del = useCallback(
    (endpoint: string, headers?: Record<string, string>) => request('DELETE', endpoint, undefined, headers),
    [request]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    get,
    post,
    put,
    del,
    clearError,
  };
}

// ─── Token refresh ──────────────────────────────────────────
// Delegates to the shared, cross-tab-coordinated refresher. apiFetch's
// transparent 401-retry and AuthContext's scheduled refresh now share ONE
// in-flight /refresh across every tab (Web Locks API) — essential because the
// live worker rotates the refresh token on each call, so two uncoordinated
// refreshers would race one of them into a 401 logout. On a genuine auth
// failure the shared module clears tokens and emits a cross-tab `logout`
// event, which AuthContext turns into a route to /login (no hard redirect
// here — React Router owns navigation). See utils/tokenRefresh.ts.
function tryRefreshToken(): Promise<string | null> {
  return refreshAccessToken();
}

// Standalone fetch helper for one-off requests.
// Automatically retries once with a refreshed token on 401.
// When running in Electron and offline, routes through local SQLite via IPC.
//
// All /api/* requests use RELATIVE URLs (same-origin to rmpgutah.us).
// Cloudflare Pages proxies /api/* → https://api.rmpgutah.us/api/* via
// client/public/_redirects, so the browser never makes a cross-origin
// request and connect-src 'self' is enough — no Transform Rule update
// required for the SPA to reach the Worker.
//
// Previously this file injected an absolute CF_WORKER_BASE prefix for a
// curated allowlist of "ported" routes. That worked only when the zone
// Transform Rule kept api.rmpgutah.us in connect-src; a single dashboard
// edit silently broke every dispatch call. The Pages proxy makes the
// path immune to that failure mode.
function maybeRedirectToCfWorker(url: string): string {
  return url;
}

// Kept for downloadUrl() (absolute Worker origin) and the unused
// `directWorker` flag. Authenticated SPA traffic must NOT use this host:
// the managed-challenge skip is /api/health only. Prefer same-origin /api/*.
const CF_WORKER_DIRECT_BASE = WORKER_HTTP_ORIGIN;

/**
 * Where POST /api/uploads should go.
 *
 * On the live SPA (rmpgutah.us / www) this MUST be same-origin. The zone
 * Worker `rmpg-api-proxy` already intercepts `rmpgutah.us/api/*` (and www)
 * and service-binds to rmpg-flex-api, so a relative path never hits Pages.
 *
 * The previous production value was an absolute `https://api.rmpgutah.us/...`
 * URL. That was added to dodge a Pages 200-rewrite that produced
 * ERR_HTTP2_PROTOCOL_ERROR — before the proxy existed. Cross-origin POSTs to
 * the API hostname now fail at the Cloudflare edge: the managed-challenge
 * skip is scoped to `/api/health` only, so the browser either gets challenge
 * HTML (no CORS) or a CORP `same-origin` block. Dispatch Files then shows
 * the generic "Upload failed" banner.
 *
 * Off the app origin (Electron file://, unknown hosts) we still target the
 * Worker hostname directly.
 */
export function resolveUploadsUrl(opts: { isDev: boolean; hostname?: string }): string {
  if (opts.isDev) return '/api/uploads';
  const host = (opts.hostname || '').toLowerCase();
  if (isAppHostname(host)) return '/api/uploads';
  return `${CF_WORKER_DIRECT_BASE}/api/uploads`;
}

/** URL for POST /api/uploads — relative on the app origin, Worker host otherwise. */
export function uploadsUrl(): string {
  return resolveUploadsUrl({
    isDev: import.meta.env.DEV,
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
  });
}

/**
 * Absolute URL for a published download (installer / OS image).
 *
 * MUST be absolute to the Worker origin. A relative "/downloads/<file>" link
 * resolves against the Pages SPA, and client/public/_redirects tries to proxy
 * that to the Worker with a status-200 rule — which Cloudflare Pages does not
 * support (it honours redirect statuses only; 200-rewrites to another origin
 * are a Netlify feature). The rule is silently ignored, the request falls
 * through to the SPA catch-all, and the browser saves index.html under the
 * artifact's filename: an 11,630-byte "installer" that fails with no error.
 * Reported from the field as "files download at 11.5 kb".
 *
 * In dev, Vite's proxy does forward /downloads to the local Worker, so a
 * relative path is correct there.
 */
export function downloadUrl(filename: string): string {
  const encoded = encodeURIComponent(filename);
  return import.meta.env.DEV ? `/downloads/${encoded}` : `${CF_WORKER_DIRECT_BASE}/downloads/${encoded}`;
}

// ─── Fallback URL switching (Toughbook cold standby) ──────────────────────
export const FALLBACK_URL_KEY = 'rmpg_fallback_api_url';
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
let _consecutiveApiFailures = 0;

export function resolveFallbackUrl(relativeUrl: string): string | null {
  if (_consecutiveApiFailures < CONSECUTIVE_FAILURE_THRESHOLD) return null;
  const fallback = localStorage.getItem(FALLBACK_URL_KEY);
  return fallback ? `${fallback}${relativeUrl}` : null;
}

/** @internal — for unit tests only. Sets the failure counter without triggering real requests. */
export function _setConsecutiveFailuresForTest(n: number): void {
  _consecutiveApiFailures = n;
}

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit & { timeoutMs?: number; directWorker?: boolean; _skipQueue?: boolean }
): Promise<T> {
  const relativeUrl = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  const url = options?.directWorker ? `${CF_WORKER_DIRECT_BASE}${relativeUrl}` : maybeRedirectToCfWorker(relativeUrl);
  const method = options?.method || 'GET';

  // Network = activity. Signal the idle backstop (Layout.tsx Feature 24) on
  // every API call so a monitoring-only screen — live polling, live-sync —
  // never trips the shift-length idle logout while data is still flowing.
  if (typeof window !== 'undefined') {
    try { window.dispatchEvent(new Event('rmpg:activity')); } catch { /* SSR / no-DOM */ }
  }

  // ─── Normal online fetch path ──────────────────────────
  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchInit: RequestInit = { ...options, headers };

  let res: Response;
  const fallbackUrl = resolveFallbackUrl(relativeUrl);
  try {
    res = await fetchWithRetry(fallbackUrl ?? url, fetchInit);
    _consecutiveApiFailures = 0;
  } catch (fetchErr) {
    _consecutiveApiFailures += 1;
    const m = method.toUpperCase();
    if (MUTATING_METHODS.has(m) && !options?._skipQueue) {
      console.warn('[API] Network error on mutation — enqueueing for offline replay:', m, relativeUrl);
      const { enqueueOperation } = await import('./useOfflineQueue');
      await enqueueOperation({
        method: m,
        path: relativeUrl,
        body: options?.body ? (() => { try { return JSON.parse(options.body as string); } catch { return undefined; } })() : undefined,
        headers: { ...(options?.headers as Record<string, string>) },
      });
    }
    throw fetchErr;
  }

  // On 401, attempt a transparent token refresh and retry once
  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryRes = await fetchWithRetry(fallbackUrl ?? url, { ...fetchInit, headers });
      if (!retryRes.ok) {
        const errData = await retryRes.json().catch(() => ({}));
        nackForApiFailure(method, fallbackUrl ?? url, retryRes.status);
        throw new Error(errData.error || errData.message || `Request failed with status ${retryRes.status}`);
      }
      chimeForApiSuccess(method, url);
      return retryRes.json();
    }
    // No new token — redirect already happened or network error
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    // Append server-side `details`/`detail` diagnostic when present — otherwise
    // every 500 looks identical to the user even when the server told us
    // exactly what failed (e.g. SQL "no such column: foo"). See dispatch
    // PUT /calls/:id, which returns `details: <real error>` but historically
    // got rendered as just "Failed to update call".
    const base = errData.error || errData.message || `Request failed with status ${res.status}`;
    const diag = errData.details || errData.detail;
    // Attach status / payload / code so structured error handling (e.g.
    // 409 DUPLICATE_CANDIDATES from /quick-add) can branch on err.code
    // instead of regex-matching err.message. Additive — existing
    // err.message readers are unaffected.
    const error = new Error(diag ? `${base}: ${diag}` : base) as Error & {
      status?: number; payload?: any; code?: string;
    };
    error.status = res.status;
    error.payload = errData;
    error.code = errData.code;
    nackForApiFailure(method, url, res.status);
    throw error;
  }

  chimeForApiSuccess(method, url);
  return res.json();
}

/** Fetch binary data (audio, images) with auth + token refresh. Returns a Blob. */
export async function apiFetchBlob(endpoint: string): Promise<Blob> {
  const url = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetchWithRetry(url, { headers });

  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetchWithRetry(url, { headers });
    }
    // Only "Session expired" when it's STILL 401 (refresh failed). A successful
    // refresh that then hits a 403/500 should surface the real status below, not
    // a misleading auth message.
    if (res.status === 401) throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * POST a multipart FormData payload with auth + transparent token refresh.
 * Unlike apiFetch, this does NOT set Content-Type — the browser sets the
 * `multipart/form-data; boundary=…` header itself (forcing application/json
 * would break server-side multipart parsing). Use for image/file uploads to
 * an arbitrary endpoint (e.g. /alpr/capture).
 */
export async function apiPostForm<T>(
  endpoint: string,
  formData: FormData,
  options?: { timeoutMs?: number }
): Promise<T> {
  const url = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const timeoutMs = options?.timeoutMs;

  let res = await fetchWithRetry(url, { method: 'POST', headers, body: formData, timeoutMs });
  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetchWithRetry(url, { method: 'POST', headers, body: formData, timeoutMs });
    }
    if (res.status === 401) throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err = new Error(errData.error || errData.message || `Upload failed with status ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  chimeForApiSuccess('POST', url);
  return res.json();
}

// ─── Upload (multipart) with auto-retry for transient failures ────
export interface UploadOptions {
  /** Extra attempts after the first, on a *transient* failure (network/5xx). Default 0. */
  retries?: number;
  /** Base backoff in ms between attempts (doubled each retry). Default 1500. */
  retryDelayMs?: number;
  /** Per-attempt timeout. Defaults to DEFAULT_FETCH_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Fired before each retry sleep — e.g. to surface "Retrying… (1/3)". */
  onRetry?: (attempt: number, max: number) => void;
}

/** Evidence metadata captured at upload time (geo, timestamp, reference). */
export interface EvidenceMeta {
  latitude?: number;
  longitude?: number;
  taken_at?: string;       // ISO-8601
  reference_notes?: string;
}

/**
 * Decide whether a failed upload attempt is worth retrying.
 *
 * Field reality drives this: officers upload from cellular dead zones, so a
 * dropped-at-the-edge transport failure (the `net::ERR_FAILED` / "Failed to
 * fetch" that silently lost an ID photo on 2026-06-13) and 5xx server blips
 * SHOULD retry. A 4xx is deterministic — a too-large file or rejected MIME
 * type fails identically on every attempt, so retrying only delays the real
 * error the user needs to see.
 *
 * This is the upload retry POLICY seam — change the stance here (e.g. bail on
 * 413 immediately, or back off harder on 429) without touching the loop below.
 */
function isRetryableUploadError(err: Error): boolean {
  const status = (err as { status?: number }).status;
  if (typeof status === 'number') return status >= 500; // 5xx transient, 4xx deterministic
  return true; // no status ⇒ network/transport throw (TypeError, TimeoutError) ⇒ retry
}

async function presignAttachmentUpload(
  file: File,
  entityType?: string,
  entityId?: string | number,
): Promise<{ file_id: string; upload_url: string; key: string } | { ok: false; code: string }> {
  return apiFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      entity_type: entityType,
      entity_id: entityId,
    }),
  });
}

async function completeAttachmentUpload(fileId: string): Promise<any> {
  return apiFetch(`/uploads/presign/${fileId}/complete`, { method: 'POST', body: '{}' });
}

/** Upload one large file straight to R2 via a presigned PUT (see design spec). */
export async function apiUploadFileDirect(
  file: File,
  entityType?: string,
  entityId?: string | number,
  onProgress?: (progress: UploadProgress) => void,
): Promise<any> {
  const presign = await presignAttachmentUpload(file, entityType, entityId);
  // R2 direct-upload credentials aren't configured yet (server's established
  // "unset secret → 200 { ok: false, code: 'not_configured' }" convention —
  // never a 4xx/5xx, so apiFetch's !res.ok branch never fires). Fall back to
  // the existing Worker-proxied multipart path instead of PUTing to an
  // undefined upload_url, per the design spec's rollout requirement.
  if ((presign as { ok?: false }).ok === false) {
    const [result] = await apiUploadFilesMultipart([file], entityType, entityId);
    return result;
  }
  const { file_id: fileId, upload_url: uploadUrl } = presign as { file_id: string; upload_url: string; key: string };
  await putFileDirect(uploadUrl, file, onProgress);
  return completeAttachmentUpload(fileId);
}

async function apiUploadFilesMultipart(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  opts?: UploadOptions,
  evidenceMeta?: EvidenceMeta,
): Promise<any[]> {
  const token = localStorage.getItem('rmpg_token');
  const maxRetries = Math.max(0, opts?.retries ?? 0);
  const baseDelay = opts?.retryDelayMs ?? 1500;

  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Rebuild the body each attempt so every retry is a clean, independent
    // multipart request (a consumed/aborted body never leaks into the next try).
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    if (entityType) formData.append('entity_type', entityType);
    if (entityId) formData.append('entity_id', String(entityId));
    if (evidenceMeta?.latitude != null) formData.append('latitude', String(evidenceMeta.latitude));
    if (evidenceMeta?.longitude != null) formData.append('longitude', String(evidenceMeta.longitude));
    if (evidenceMeta?.taken_at) formData.append('taken_at', evidenceMeta.taken_at);
    if (evidenceMeta?.reference_notes) formData.append('reference_notes', evidenceMeta.reference_notes);

    try {
      const res = await fetchWithTimeout(uploadsUrl(), {
        method: 'POST',
        headers,
        body: formData,
        timeoutMs: opts?.timeoutMs,
      });
      if (res.ok) {
        chimeForApiSuccess('POST', uploadsUrl());
        return res.json();
      }
      const errData = await res.json().catch(() => ({}));
      const base = errData.error || errData.message || `Upload failed with status ${res.status}`;
      const diag = errData.details || errData.detail;
      const err = new Error(diag ? `${base}: ${diag}` : base) as Error & { status?: number };
      err.status = res.status;
      throw err;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (!isRetryableUploadError(lastErr) || attempt >= maxRetries) break;
      opts?.onRetry?.(attempt + 1, maxRetries);
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw lastErr ?? new Error('Upload failed');
}

export async function apiUploadFiles(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  opts?: UploadOptions,
  evidenceMeta?: EvidenceMeta,
): Promise<any[]> {
  const smallIndices: number[] = [];
  const smallFiles: File[] = [];
  const largeIndices: number[] = [];

  files.forEach((f, i) => {
    if (f.size <= DIRECT_UPLOAD_THRESHOLD_BYTES) {
      smallIndices.push(i);
      smallFiles.push(f);
    } else {
      largeIndices.push(i);
    }
  });

  const results: any[] = new Array(files.length);

  if (smallFiles.length > 0) {
    const smallResults = await apiUploadFilesMultipart(smallFiles, entityType, entityId, opts, evidenceMeta);
    smallIndices.forEach((origIdx, i) => { results[origIdx] = smallResults[i]; });
  }

  for (const origIdx of largeIndices) {
    results[origIdx] = await apiUploadFileDirect(files[origIdx], entityType, entityId);
  }

  return results;
}

// Upload files with per-file progress tracking via XHR
export async function apiUploadFilesWithProgress(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  onProgress?: (progress: UploadProgress, fileIndex: number, totalFiles: number) => void,
  evidenceMeta?: EvidenceMeta,
): Promise<any[]> {
  // If no progress callback, fall back to the simpler fetch-based upload
  if (!onProgress) {
    return apiUploadFiles(files, entityType, entityId, undefined, evidenceMeta);
  }

  const token = localStorage.getItem('rmpg_token') || '';
  const results: any[] = [];

  // Upload files one at a time so progress tracks per-file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.size > DIRECT_UPLOAD_THRESHOLD_BYTES) {
      const result = await apiUploadFileDirect(file, entityType, entityId, (progress) => onProgress(progress, i, files.length));
      results.push(result);
      continue;
    }

    const formData = new FormData();
    formData.append('files', file);
    if (entityType) formData.append('entity_type', entityType);
    if (entityId) formData.append('entity_id', String(entityId));
    if (evidenceMeta?.latitude != null) formData.append('latitude', String(evidenceMeta.latitude));
    if (evidenceMeta?.longitude != null) formData.append('longitude', String(evidenceMeta.longitude));
    if (evidenceMeta?.taken_at) formData.append('taken_at', evidenceMeta.taken_at);
    if (evidenceMeta?.reference_notes) formData.append('reference_notes', evidenceMeta.reference_notes);

    const result = await uploadWithProgress(
      uploadsUrl(),
      formData,
      token,
      (progress) => onProgress(progress, i, files.length),
    );

    // Server returns an array of uploaded file records
    if (Array.isArray(result)) {
      results.push(...result);
    } else {
      results.push(result);
    }
  }

  return results;
}

// Fetch attachments for an entity
export async function apiFetchAttachments(
  entityType: string,
  entityId: string | number,
): Promise<any[]> {
  return apiFetch<any[]>(`/uploads/entity/${entityType}/${entityId}`);
}

// Delete an attachment
export async function apiDeleteAttachment(fileId: string): Promise<void> {
  await apiFetch(`/uploads/${fileId}`, { method: 'DELETE' });
}

// ─── Company Documents ───────────────────────────────────
export async function apiFetchCompanyDocuments(category?: string): Promise<any[]> {
  const qs = category && category !== 'all' ? `?category=${category}` : '';
  return apiFetch<any[]>(`/company-documents${qs}`);
}

export async function apiCreateCompanyDocument(data: Record<string, any>): Promise<any> {
  return apiFetch('/company-documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function apiUpdateCompanyDocument(id: number, data: Record<string, any>): Promise<any> {
  return apiFetch(`/company-documents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function apiDeleteCompanyDocument(id: number): Promise<void> {
  await apiFetch(`/company-documents/${id}`, { method: 'DELETE' });
}

export type { UploadProgress };

// ─── Dual-write for FZ-55 secondary server ───────────────────────────────────
import { useContext } from 'react';
import { ApiBaseContext } from './useApiBase';

/**
 * Pure dual-write function — exported for testing.
 * Fires the same mutation at both local and cloud in parallel.
 * Returns the local result if available; cloud result as fallback.
 * Throws when both fail.
 */
export async function dualWrite<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number },
  localBase: string | null,
  cloudBase: string,
): Promise<T> {
  const normalizedPath = path.startsWith('/api') ? path : `/api${path}`;

  if (!localBase) {
    const res = await fetchWithTimeout(`${cloudBase}${normalizedPath}`, options);
    if (!res.ok) throw new Error(`Cloud request failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  const [localResult, cloudResult] = await Promise.allSettled([
    fetchWithTimeout(`${localBase}${normalizedPath}`, options).then(r =>
      r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`Local ${r.status}`))
    ),
    fetchWithTimeout(`${cloudBase}${normalizedPath}`, options).then(r =>
      r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`Cloud ${r.status}`))
    ),
  ]);

  if (localResult.status === 'fulfilled') {
    // Local succeeded — if cloud failed, queue the write for later replay
    if (cloudResult.status === 'rejected') {
      try {
        const reqHeaders = options.headers as Record<string, string> | undefined;
        const enqueueBody: Record<string, string> = {
          method: options.method ?? 'POST',
          path: normalizedPath,
        };
        if (options.body != null) {
          enqueueBody.body = typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body);
        }
        if (reqHeaders) enqueueBody.headers = JSON.stringify(reqHeaders);
        await fetch(`${localBase}/api/sync/enqueue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(reqHeaders?.Authorization ? { Authorization: reqHeaders.Authorization } : {}),
          },
          body: JSON.stringify(enqueueBody),
        });
      } catch { /* non-fatal — local write already succeeded */ }
    }
    return localResult.value;
  }
  if (cloudResult.status === 'fulfilled') return cloudResult.value;
  throw new Error('No connectivity — both local and cloud endpoints unreachable');
}

/**
 * Hook-based dual-write wrapper for use in React components.
 * Reads cloud/local bases from ApiBaseContext automatically.
 */
export function useApiMutate() {
  const { cloudBase, localBase } = useContext(ApiBaseContext);
  return async function apiMutate<T>(
    path: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    return dualWrite<T>(path, options, localBase, cloudBase);
  };
}

export default useApi;
