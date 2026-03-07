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
        ...customHeaders,
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      try {
        const url = endpoint.startsWith('/') ? `${baseUrl}${endpoint}` : `${baseUrl}/${endpoint}`;
        let res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });

        // On 401, attempt a transparent token refresh and retry once
        if (res.status === 401) {
          const newToken = await tryRefreshToken();
          if (newToken) {
            headers['Authorization'] = `Bearer ${newToken}`;
            res = await fetch(url, {
              method,
              headers,
              body: body ? JSON.stringify(body) : undefined,
            });
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

async function tryRefreshToken(): Promise<string | null> {
  // If a refresh is already in-flight, wait for it
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('rmpg_refresh_token');
      if (!refreshToken) return null;

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('rmpg_token', data.token);
        localStorage.setItem('rmpg_refresh_token', data.refreshToken);
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
      localStorage.removeItem('rmpg_token');
      localStorage.removeItem('rmpg_refresh_token');
      localStorage.removeItem('rmpg_session_id');
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
  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  // On 401, attempt a transparent token refresh and retry once
  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryRes = await fetch(url, { ...options, headers });
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

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/uploads', {
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
