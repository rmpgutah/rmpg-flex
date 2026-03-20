import { useState, useCallback } from 'react';
import { isOfflineDbReady } from '../services/offlineDb';
import { handle as browserOfflineHandle, isOfflineCapableEndpoint } from '../services/offlineRouter';
import { hasActiveSession } from '../services/offlinePin';

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

  const getToken = () => { try { return localStorage.getItem('rmpg_token'); } catch { return null; } };

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
      let refreshToken: string | null = null;
      try { refreshToken = localStorage.getItem('rmpg_refresh_token'); } catch { /* ignore */ }
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
      // (but NOT if we're offline — stay on current page)
      if (!navigator.onLine) return null; // Don't redirect when offline (browser or Electron)
      if (electron?.getOfflineState) {
        try {
          const state = await electron.getOfflineState();
          if (!state.isOnline) return null;
        } catch { /* fall through */ }
      }
      try { localStorage.removeItem('rmpg_token'); } catch { /* ignore */ }
      try { localStorage.removeItem('rmpg_refresh_token'); } catch { /* ignore */ }
      try { localStorage.removeItem('rmpg_session_id'); } catch { /* ignore */ }
      window.location.href = '/login';
      return null;
    } catch {
      // Network error during refresh — can't recover online, but offline mode may work
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
  if (!navigator.onLine && isOfflineDbReady() && isOfflineCapableEndpoint(method, url)) {
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
      if (!navigator.onLine) {
        console.warn('[OFFLINE] Browser offline router failed:', err);
        throw new Error('Offline data unavailable for this request');
      }
      // Fall through to normal fetch for non-offline errors
    }
  }

  // ─── Normal online fetch path ──────────────────────────
  let token: string | null = null;
  try { token = localStorage.getItem('rmpg_token'); } catch { /* ignore */ }
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

// Upload files via FormData (multipart) — no progress tracking
export async function apiUploadFiles(
  files: File[],
  entityType?: string,
  entityId?: string | number,
): Promise<any[]> {
  let token: string | null = null;
  try { token = localStorage.getItem('rmpg_token'); } catch { /* ignore */ }
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

// ─── Progress-tracked upload (XHR-based for onprogress events) ────
export interface UploadProgressInfo {
  /** Bytes sent so far */
  loaded: number;
  /** Total bytes to send */
  total: number;
  /** 0-100 percentage */
  percent: number;
}

// Files above this threshold use chunked upload with parallel workers
const CHUNK_THRESHOLD = 50 * 1024 * 1024; // 50MB
const CHUNK_SIZE = 10 * 1024 * 1024;      // 10MB chunks
const PARALLEL_WORKERS = 6;               // Upload 6 chunks at a time

function getAuthToken(): string | null {
  try { return localStorage.getItem('rmpg_token'); } catch { return null; }
}

function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/** Upload a single chunk via XHR with progress tracking */
function uploadChunk(
  uploadId: string,
  chunkIndex: number,
  blob: Blob,
  onProgress?: (chunkBytes: number) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  let lastLoaded = 0;

  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('POST', `/api/uploads/chunked/${uploadId}/${chunkIndex}`);
    xhr.timeout = 300000; // 5 min per chunk

    const headers = getAuthHeaders();
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        const delta = ev.loaded - lastLoaded;
        lastLoaded = ev.loaded;
        onProgress(delta);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Report any remaining bytes not yet reported by onprogress
        if (onProgress) {
          const remaining = blob.size - lastLoaded;
          if (remaining > 0) onProgress(remaining);
        }
        resolve();
      } else {
        let msg = `Chunk ${chunkIndex} failed (HTTP ${xhr.status})`;
        try { const r = JSON.parse(xhr.responseText); if (r.error) msg = r.error; } catch { /* */ }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => reject(new Error(`Network error on chunk ${chunkIndex}`));
    xhr.ontimeout = () => reject(new Error(`Chunk ${chunkIndex} timed out`));

    const formData = new FormData();
    formData.append('chunk', blob, `chunk-${chunkIndex}`);
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}

/**
 * Upload a single file with real-time progress tracking.
 * Automatically uses chunked parallel upload for files > 50MB.
 */
export function apiUploadFileWithProgress(
  file: File,
  entityType?: string,
  entityId?: string | number,
  onProgress?: (info: UploadProgressInfo) => void,
): { promise: Promise<any>; abort: () => void } {
  // ── Small files: single XHR ──
  if (file.size <= CHUNK_THRESHOLD) {
    return uploadSmallFile(file, entityType, entityId, onProgress);
  }

  // ── Large files: chunked parallel upload ──
  let aborted = false;
  const activeXhrs: Array<{ abort: () => void }> = [];

  const promise = (async () => {
    const token = getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // 1. Initialize chunked upload session
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const initRes = await fetch('/api/uploads/chunked/init', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        totalChunks,
        entityType,
        entityId: entityId ? String(entityId) : undefined,
      }),
    });

    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to initialize upload');
    }

    const { uploadId } = await initRes.json();
    let totalLoaded = 0;

    // 2. Upload chunks in parallel (PARALLEL_WORKERS at a time)
    const chunkQueue: number[] = [];
    for (let i = 0; i < totalChunks; i++) chunkQueue.push(i);

    const uploadNextChunk = async (): Promise<void> => {
      while (chunkQueue.length > 0 && !aborted) {
        const idx = chunkQueue.shift()!;
        const start = idx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);

        const { promise: chunkPromise, abort: chunkAbort } = uploadChunk(
          uploadId, idx, blob,
          (deltaBytes) => {
            totalLoaded += deltaBytes;
            if (onProgress) {
              onProgress({
                loaded: Math.min(totalLoaded, file.size),
                total: file.size,
                percent: Math.round((Math.min(totalLoaded, file.size) / file.size) * 100),
              });
            }
          },
        );

        activeXhrs.push({ abort: chunkAbort });

        try {
          await chunkPromise;
        } catch (err) {
          if (aborted) return;
          // Retry once on failure
          chunkQueue.unshift(idx);
          totalLoaded -= (end - start); // Roll back progress
          const { promise: retry, abort: retryAbort } = uploadChunk(
            uploadId, idx, blob,
            (deltaBytes) => {
              totalLoaded += deltaBytes;
              if (onProgress) {
                onProgress({
                  loaded: Math.min(totalLoaded, file.size),
                  total: file.size,
                  percent: Math.round((Math.min(totalLoaded, file.size) / file.size) * 100),
                });
              }
            },
          );
          activeXhrs.push({ abort: retryAbort });
          await retry; // If retry fails, let it throw
          chunkQueue.shift(); // Remove the re-queued chunk
        }
      }
    };

    // Launch parallel workers
    const workers: Promise<void>[] = [];
    for (let w = 0; w < PARALLEL_WORKERS; w++) {
      workers.push(uploadNextChunk());
    }
    await Promise.all(workers);

    if (aborted) throw new Error('Upload cancelled');

    // 3. Finalize — reassemble on server
    const finalRes = await fetch(`/api/uploads/chunked/${uploadId}/finalize`, {
      method: 'POST',
      headers,
    });

    if (!finalRes.ok) {
      const err = await finalRes.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to finalize upload');
    }

    return finalRes.json();
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      activeXhrs.forEach((x) => { try { x.abort(); } catch { /* */ } });
    },
  };
}

/** Small file upload (single XHR, < 50MB) */
function uploadSmallFile(
  file: File,
  entityType?: string,
  entityId?: string | number,
  onProgress?: (info: UploadProgressInfo) => void,
): { promise: Promise<any>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const token = getAuthToken();

  const formData = new FormData();
  formData.append('files', file);
  if (entityType) formData.append('entity_type', entityType);
  if (entityId) formData.append('entity_id', String(entityId));

  const promise = new Promise<any>((resolve, reject) => {
    xhr.open('POST', '/api/uploads');
    xhr.timeout = 1800000;

    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress({
          loaded: ev.loaded,
          total: ev.total,
          percent: Math.round((ev.loaded / ev.total) * 100),
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve([]); }
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try { const r = JSON.parse(xhr.responseText); if (r.error) msg = r.error; } catch { /* */ }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}

/**
 * Download a file with progress tracking.
 * Returns progress info as the file downloads, then triggers browser download.
 */
export function apiDownloadFileWithProgress(
  url: string,
  fileName: string,
  onProgress?: (info: UploadProgressInfo) => void,
): { promise: Promise<void>; abort: () => void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.timeout = 1800000; // 30 min for large downloads

    xhr.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress({
          loaded: ev.loaded,
          total: ev.total,
          percent: Math.round((ev.loaded / ev.total) * 100),
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response as Blob;
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        resolve();
      } else {
        reject(new Error(`Download failed (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during download'));
    xhr.ontimeout = () => reject(new Error('Download timed out'));
    xhr.send();
  });

  return { promise, abort: () => xhr.abort() };
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

export default useApi;
