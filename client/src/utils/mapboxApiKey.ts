// ============================================================
// RMPG Flex — Mapbox Access Token Management
// ============================================================
// Runtime key fetching for Mapbox GL JS. The Mapbox access token
// is stored encrypted in system_config and served at runtime via
// /api/integrations/mapbox/client-key — same pattern as the
// Google Maps key (see googleMapsApiKey.ts).
// ============================================================

import { apiFetch } from '../hooks/useApi';

let cachedMapboxToken: string | null = null;
let cachedMapboxStyleUrl: string | null = null;
let inflightMapboxToken: Promise<string | null> | null = null;
let lastMapboxTokenError: string | null = null;

export type MapboxTokenErrorKind = 'none' | 'unconfigured' | 'auth' | 'network' | 'server';

export interface MapboxTokenStatus {
  token: string | null;
  styleUrl: string | null;
  source: 'cache' | 'api';
  configured: boolean;
  errorKind: MapboxTokenErrorKind;
  errorMessage: string | null;
}

/**
 * Get the cached Mapbox access token (empty string if not yet fetched).
 */
export function getCachedMapboxToken(): string {
  return cachedMapboxToken || '';
}

/**
 * Check whether a Mapbox token has been fetched and is non-empty.
 */
export function hasMapboxToken(): boolean {
  return !!cachedMapboxToken;
}

/**
 * Get the cached custom Mapbox style URL (null if not configured).
 */
export function getCachedMapboxStyleUrl(): string | null {
  return cachedMapboxStyleUrl;
}

/**
 * Fetch the Mapbox access token from the server.
 * Returns the token string, or null if not configured.
 */
export async function getMapboxToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedMapboxToken) return cachedMapboxToken;
  if (!forceRefresh && inflightMapboxToken) return inflightMapboxToken;

  inflightMapboxToken = apiFetch<{ configured?: boolean; accessToken?: string; styleUrl?: string }>(
    '/integrations/mapbox/client-key'
  )
    .then((response) => {
      const token = typeof response?.accessToken === 'string' ? response.accessToken.trim() : '';
      cachedMapboxToken = token || null;
      const rawStyleUrl = typeof response?.styleUrl === 'string' ? response.styleUrl.trim() : '';
      cachedMapboxStyleUrl = rawStyleUrl || null;
      lastMapboxTokenError = null;
      return cachedMapboxToken;
    })
    .catch((err: any) => {
      // Mapbox is optional — don't throw if endpoint not available
      cachedMapboxToken = null;
      cachedMapboxStyleUrl = null;
      lastMapboxTokenError = err?.message || 'Failed to fetch Mapbox token';
      return null;
    })
    .finally(() => {
      inflightMapboxToken = null;
    });

  return inflightMapboxToken;
}

function classifyMapboxTokenError(message: string | null): MapboxTokenErrorKind {
  if (!message) return 'none';
  const m = message.toLowerCase();
  if (m.includes('session expired') || m.includes('unauthorized') || m.includes('forbidden') || m.includes('401') || m.includes('403')) {
    return 'auth';
  }
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('timed out') || m.includes('offline')) {
    return 'network';
  }
  return 'server';
}

export async function getMapboxTokenStatus(forceRefresh = false): Promise<MapboxTokenStatus> {
  if (!forceRefresh && cachedMapboxToken) {
    return {
      token: cachedMapboxToken,
      styleUrl: cachedMapboxStyleUrl,
      source: 'cache',
      configured: true,
      errorKind: 'none',
      errorMessage: null,
    };
  }

  const token = await getMapboxToken(forceRefresh);
  if (token) {
    return {
      token,
      styleUrl: cachedMapboxStyleUrl,
      source: 'api',
      configured: true,
      errorKind: 'none',
      errorMessage: null,
    };
  }

  if (!lastMapboxTokenError) {
    return {
      token: null,
      styleUrl: cachedMapboxStyleUrl,
      source: 'api',
      configured: false,
      errorKind: 'unconfigured',
      errorMessage: null,
    };
  }

  return {
    token: null,
    styleUrl: cachedMapboxStyleUrl,
    source: 'api',
    configured: false,
    errorKind: classifyMapboxTokenError(lastMapboxTokenError),
    errorMessage: lastMapboxTokenError,
  };
}
