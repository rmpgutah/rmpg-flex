import { apiFetch } from '../hooks/useApi';

// NEVER use a build-time baked key — that string becomes a literal in the
// bundle and is only updated by a new build. Admin changes to the Maps API
// key in system_config then silently no-op until someone rebuilds, and a
// stale/revoked key baked into an older build shadows the live DB value
// (this happened 2026-04-22 — prod bundles shipped AIzaSyCfKR...CtM for
// months after it was rotated at Google). Always source the key from the
// server at runtime so the DB is the single source of truth.
let cachedGoogleMapsApiKey: string | null = null;
let inflightGoogleMapsApiKey: Promise<string> | null = null;

const MISSING_KEY_MESSAGE =
  'Google Maps API key not configured on the server. Set it in Admin → Integrations → Google Maps.';

export function getCachedGoogleMapsApiKey(): string {
  return cachedGoogleMapsApiKey || '';
}

export function getGoogleMapsApiKeyErrorMessage(): string {
  return MISSING_KEY_MESSAGE;
}

export async function getGoogleMapsApiKey(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedGoogleMapsApiKey) return cachedGoogleMapsApiKey;
  if (!forceRefresh && inflightGoogleMapsApiKey) return inflightGoogleMapsApiKey;

  inflightGoogleMapsApiKey = apiFetch<{ configured?: boolean; apiKey?: string }>('/integrations/google-maps/client-key')
    .then((response) => {
      const apiKey = typeof response?.apiKey === 'string' ? response.apiKey.trim() : '';
      if (!apiKey) {
        throw new Error(MISSING_KEY_MESSAGE);
      }
      cachedGoogleMapsApiKey = apiKey;
      return apiKey;
    })
    .finally(() => {
      inflightGoogleMapsApiKey = null;
    });

  return inflightGoogleMapsApiKey;
}
