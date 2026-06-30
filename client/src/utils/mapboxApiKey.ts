// Thin re-export wrapper around mapboxLoader's token resolver so every Mapbox
// surface (MapPage / FleetMapCard / ForensicTrackMap / NavMapView / …) shares
// one async path, one in-flight dedupe, and one cache. Historically this file
// owned its own cache + fetch logic, which let one surface's cache invalidation
// leave a stale token in the other path.

import {
  resolveMapboxAccessToken,
  clearMapboxConfigCache,
} from './mapboxLoader';

const MISSING_TOKEN_MESSAGE =
  'Mapbox access token not configured. Set VITE_MAPBOX_ACCESS_TOKEN in client/.env or Cloudflare Pages environment variables.';

/** Sync getter for build-time-only callers (e.g. early SSR-style reads). */
export function getCachedMapboxAccessToken(): string {
  return ((import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() || '';
}

export function getMapboxTokenErrorMessage(): string {
  return MISSING_TOKEN_MESSAGE;
}

/**
 * Async resolver — throws when the token cannot be obtained from either the
 * build-time env var or the server fallback. Callers that prefer "empty string
 * on miss" semantics should call `resolveMapboxAccessToken` from mapboxLoader
 * directly.
 */
export async function getMapboxAccessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) clearMapboxConfigCache();
  const token = await resolveMapboxAccessToken();
  if (!token) throw new Error(MISSING_TOKEN_MESSAGE);
  return token;
}

export const getMapboxToken = getMapboxAccessToken;

export function hasMapboxToken(): boolean {
  return !!getCachedMapboxAccessToken();
}

export async function getMapboxTokenStatus(forceRefresh?: boolean): Promise<{
  configured: boolean;
  source: string;
  token?: string;
  errorKind?: string;
  errorMessage?: string;
}> {
  if (forceRefresh) clearMapboxConfigCache();
  const cached = getCachedMapboxAccessToken();
  if (cached) return { configured: true, source: 'build_env', token: cached, errorKind: undefined, errorMessage: undefined };
  try {
    const resolved = await resolveMapboxAccessToken();
    if (resolved) return { configured: true, source: 'server', token: resolved, errorKind: undefined, errorMessage: undefined };
    return { configured: false, source: 'none', errorKind: 'unconfigured', errorMessage: 'Mapbox access token not configured' };
  } catch (err) {
    return {
      configured: false,
      source: 'error',
      errorKind: 'server',
      errorMessage: err instanceof Error ? err.message : 'Unknown error fetching token',
    };
  }
}

export function getCachedMapboxStyleUrl(): string {
  return 'mapbox://styles/mapbox/dark-v11';
}
