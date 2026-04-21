import { useState, useCallback } from 'react';
import { isOfflineDbReady } from '../services/offlineDb';
import { handle as browserOfflineHandle, isOfflineCapableEndpoint } from '../services/offlineRouter';
import { hasActiveSession } from '../services/offlinePin';
import { isLikelyOnline } from '../services/connectivityMonitor';
import { uploadWithProgress } from '../utils/uploadWithProgress';
import type { UploadProgress } from '../utils/uploadWithProgress';

// ─── Offline Error Classes ───────────────────────────────────
// Thrown when an offline write is attempted without PIN authorization.
// UI components catch this to trigger the PIN entry modal.
export class OfflineUnauthorizedError extends Error {
  constructor(message = 'Offline write requires PIN authorization') {
    super(message);
    this.name = 'OfflineUnauthorizedError';
  }
}

// ─── Offline-capable endpoint detection ──────────────────────
const OFFLINE_GET_PREFIXES = [
  '/api/dispatch/calls', '/api/dispatch/units', '/api/incidents',
  '/api/records/persons', '/api/records/vehicles', '/api/auth/me',
  '/api/personnel/time',
];
const OFFLINE_WRITE_PREFIXES = [
  '/api/dispatch/calls', '/api/dispatch/units/', '/api/dispatch/gps',
  '/api/incidents', '/api/personnel/time',
];

function isOfflineCapable(method: string, path: string): boolean {
  const prefixes = method === 'GET' ? OFFLINE_GET_PREFIXES : OFFLINE_WRITE_PREFIXES;
  return prefixes.some(p => path.startsWith(p));
}

// Access window.electron safely (only present in Electron desktop app)
const electron = typeof window !== 'undefined' ? (window as any).electron : null;

// ─── Image URL helper (adds auth token for <img src=> loads) ────
/**
 * Wraps an image URL so it authenticates against /api/uploads endpoints.
 * - data: URLs and full http(s):// URLs are returned unchanged
 * - /api/uploads paths get ?token=<jwt> appended (server accepts via authenticateTokenOrQuery)
 * - Already-signed URLs (containing ?sig=) are returned unchanged
 */
export function authedImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.includes('?sig=') || url.includes('&sig=')) return url;
  // Only append token for API paths that require auth
  if (url.includes('/api/uploads') || url.startsWith('/api/')) {
    const token = localStorage.getItem('rmpg_token');
    if (!token) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }
  return url;
}

// ─── Mutation deduplication (prevent rapid double-click) ────
const inflightMutations = new Map<string, { promise: Promise<Response>; ts: number }>();
const DEDUP_WINDOW_MS = 500; // 500ms dedup window

// ─── Retry config for 502/503 (server restart recovery) ────
// When nginx returns 502/503 during a deploy restart, the request never
// reached Express. Safe to retry ALL methods (including POST/PUT/DELETE)
// because the server never processed the original request.
const RETRY_STATUS_CODES = [502, 503];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  // Skip retries for large bodies (file uploads) — re-sending large payloads is wasteful
  const bodySize = init.body instanceof Blob ? init.body.size
    : init.body instanceof FormData ? Infinity  // FormData is always large-ish
    : typeof init.body === 'string' ? init.body.length
    : 0;
  if (bodySize > 1_000_000) retries = 0; // 1MB threshold

  // Mutation deduplication — return existing in-flight promise for same URL+method
  const method = init.method || 'GET';
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    const dedupKey = `${method}:${url}`;
    const existing = inflightMutations.get(dedupKey);
    if (existing && Date.now() - existing.ts < DEDUP_WINDOW_MS) {
      return existing.promise;
    }
  }

  // Track in-flight mutations for deduplication
  const isMutation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase());
  const dedupKey = isMutation ? `${method}:${url}` : '';

  const doFetch = async (): Promise<Response> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, init);
        if (RETRY_STATUS_CODES.includes(res.status) && attempt < retries) {
          // Server is restarting — wait with exponential backoff and retry
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt); // 2s → 4s → 8s
          console.warn(`[API] ${init.method || 'GET'} ${url} → ${res.status}, retrying in ${delay / 1000}s (${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return res;
      } catch (err) {
        // Don't retry intentional aborts (component unmount, navigation, etc.)
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        // Network error (connection refused / failed to fetch) — retry with backoff
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          console.warn(`[API] ${init.method || 'GET'} ${url} → network error, retrying in ${delay / 1000}s (${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }
    throw lastError || new Error('Server temporarily unavailable. Please try again.');
  };

  const promise = doFetch();
  if (isMutation) {
    inflightMutations.set(dedupKey, { promise, ts: Date.now() });
    promise.finally(() => inflightMutations.delete(dedupKey));
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
          throw new Error(message);
        }

        const data = await res.json();
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

// ─── Token-refresh lock (shared across concurrent apiFetch calls) ────
let _refreshPromise: Promise<string | null> | null = null;
const REFRESH_TIMEOUT_MS = 15_000; // 15s — prevent infinite lock if refresh hangs

async function tryRefreshToken(): Promise<string | null> {
  // If a refresh is already in-flight, wait for it
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('rmpg_refresh_token');
      if (!refreshToken) return null;

      // AbortController timeout prevents infinite lock on hung requests
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (res.ok) {
        const data = await res.json();
        try { localStorage.setItem('rmpg_token', data.token); } catch { /* quota exceeded */ }
        try { localStorage.setItem('rmpg_refresh_token', data.refreshToken); } catch { /* quota exceeded */ }
        return data.token as string;
      }

      // Refresh failed — clear tokens and redirect to login
      // (but NOT if we're offline — stay on current page).
      // Uses the connectivity monitor's authoritative state (falls back to
      // navigator.onLine pre-bootstrap) so we don't wrongly redirect during
      // a false-offline window, and don't wrongly suppress the redirect
      // when navigator.onLine lies `false` while the server is reachable.
      if (!isLikelyOnline()) return null;
      if (electron?.getOfflineState) {
        try {
          const state = await electron.getOfflineState();
          if (!state.isOnline) return null;
        } catch { /* fall through */ }
      }
      localStorage.removeItem('rmpg_token');
      localStorage.removeItem('rmpg_refresh_token');
      localStorage.removeItem('rmpg_session_id');
      window.location.href = '/login';
      return null;
    } catch (err) {
      console.warn('[useApi] Token refresh network error:', err);
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

// Standalone fetch helper for one-off requests.
// Automatically retries once with a refreshed token on 401.
// When running in Electron and offline, routes through local SQLite via IPC.
export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  const method = options?.method || 'GET';

  // ─── Offline interception (Electron desktop only) ──────
  if (electron?.localApi && electron?.getOfflineState) {
    try {
      const offlineState = await electron.getOfflineState();

      if (!offlineState.isOnline && isOfflineCapable(method, url)) {
        // Write operations require PIN authorization (admin always authorized)
        if (method !== 'GET' && !offlineState.isLocalAuthorized) {
          throw new OfflineUnauthorizedError();
        }

        // Route through local SQLite via IPC
        const body = options?.body ? JSON.parse(options.body as string) : undefined;
        const result = await electron.localApi(method, url, body);

        if (result.status >= 400) {
          throw new Error(result.error || `Offline request failed: ${result.status}`);
        }

        return result.data as T;
      }
    } catch (err) {
      // Re-throw OfflineUnauthorizedError (for PIN modal trigger)
      if (err instanceof OfflineUnauthorizedError) throw err;
      // For other errors during offline check, fall through to normal fetch
    }
  }

  // ─── Browser offline interception ──────────────────────
  // Use the connectivity monitor's authoritative state instead of
  // `navigator.onLine` directly. Past bug: if navigator lied `false` while
  // the server was actually reachable, every write was routed to the
  // IndexedDB offline router (surfacing as OfflineUnauthorizedError →
  // unexpected PIN modal) until navigator happened to flip itself true.
  if (!isLikelyOnline() && isOfflineDbReady() && isOfflineCapableEndpoint(method, url)) {
    try {
      const session = await hasActiveSession();
      // Write operations require PIN authorization (admin always authorized)
      if (method !== 'GET' && !session.active) {
        throw new OfflineUnauthorizedError();
      }

      const body = options?.body ? JSON.parse(options.body as string) : undefined;
      const result = await browserOfflineHandle(method, url, body);

      if (result.status >= 400) {
        throw new Error(result.error || `Offline request failed: ${result.status}`);
      }

      return result.data as T;
    } catch (err) {
      if (err instanceof OfflineUnauthorizedError) throw err;
      // If truly offline and offline router failed, surface the error
      // rather than silently falling through to a guaranteed network failure
      if (!isLikelyOnline()) {
        console.warn('[OFFLINE] Browser offline router failed:', err);
        throw new Error('Offline data unavailable for this request');
      }
      // Fall through to normal fetch for non-offline errors
    }
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
  const res = await fetchWithRetry(url, fetchInit);

  // On 401, attempt a transparent token refresh and retry once
  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryRes = await fetchWithRetry(url, { ...fetchInit, headers });
      if (!retryRes.ok) {
        const errData = await retryRes.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Request failed with status ${retryRes.status}`);
      }
      return retryRes.json();
    }
    // No new token — redirect already happened or network error
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || `Request failed with status ${res.status}`);
  }

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
    if (!res.ok) throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

// Upload files via FormData (multipart)
export async function apiUploadFiles(
  files: File[],
  entityType?: string,
  entityId?: string | number,
): Promise<any[]> {
  const token = localStorage.getItem('rmpg_token');
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }
  if (entityType) formData.append('entity_type', entityType);
  if (entityId) formData.append('entity_id', String(entityId));

  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetchWithRetry('/api/uploads', {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.message || `Upload failed with status ${res.status}`);
  }

  return res.json();
}

// Upload files with per-file progress tracking via XHR
export async function apiUploadFilesWithProgress(
  files: File[],
  entityType?: string,
  entityId?: string | number,
  onProgress?: (progress: UploadProgress, fileIndex: number, totalFiles: number) => void,
): Promise<any[]> {
  // If no progress callback, fall back to the simpler fetch-based upload
  if (!onProgress) {
    return apiUploadFiles(files, entityType, entityId);
  }

  const token = localStorage.getItem('rmpg_token') || '';
  const results: any[] = [];

  // Upload files one at a time so progress tracks per-file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const formData = new FormData();
    formData.append('files', file);
    if (entityType) formData.append('entity_type', entityType);
    if (entityId) formData.append('entity_id', String(entityId));

    const result = await uploadWithProgress(
      '/api/uploads',
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

export default useApi;
