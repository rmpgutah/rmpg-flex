import { apiFetch } from '../hooks/useApi';

let cachedMapboxToken: string | null = ((import.meta as any).env?.VITE_MAPBOX_ACCESS_TOKEN as string | undefined)?.trim() || null;
let inflightMapboxToken: Promise<string> | null = null;

const MISSING_TOKEN_MESSAGE =
  'Mapbox access token not configured on the server. Add MAPBOX_ACCESS_TOKEN to server/.env.';

export function getCachedMapboxAccessToken(): string {
  return cachedMapboxToken || '';
}

export function getMapboxTokenErrorMessage(): string {
  return MISSING_TOKEN_MESSAGE;
}

export async function getMapboxAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedMapboxToken) return cachedMapboxToken;
  if (!forceRefresh && inflightMapboxToken) return inflightMapboxToken;

  inflightMapboxToken = apiFetch<{ configured?: boolean; accessToken?: string }>('/integrations/mapbox/client-token')
    .then((response) => {
      const token = typeof response?.accessToken === 'string' ? response.accessToken.trim() : '';
      if (!token) {
        throw new Error(MISSING_TOKEN_MESSAGE);
      }
      cachedMapboxToken = token;
      return token;
    })
    .finally(() => {
      inflightMapboxToken = null;
    });

  return inflightMapboxToken;
}
