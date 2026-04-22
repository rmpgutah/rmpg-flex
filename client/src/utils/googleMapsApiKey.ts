import { apiFetch } from '../hooks/useApi';

let cachedGoogleMapsApiKey: string | null = ((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || null;
let inflightGoogleMapsApiKey: Promise<string> | null = null;

const MISSING_KEY_MESSAGE =
  'Google Maps API key not configured on the server. Add GOOGLE_MAPS_API_KEY to server/.env.';

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
