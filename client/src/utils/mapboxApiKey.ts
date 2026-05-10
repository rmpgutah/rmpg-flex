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
      cachedMapboxStyleUrl = typeof response?.styleUrl === 'string' && response.styleUrl.trim()
        ? response.styleUrl.trim()
        : null;
      return cachedMapboxToken;
    })
    .catch(() => {
      // Mapbox is optional — don't throw if endpoint not available
      cachedMapboxToken = null;
      cachedMapboxStyleUrl = null;
      return null;
    })
    .finally(() => {
      inflightMapboxToken = null;
    });

  return inflightMapboxToken;
}
