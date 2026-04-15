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

export async function getGoogleMapsApiKey(_forceRefresh = false): Promise<string> {
  // Google Maps disabled — using Leaflet + CartoDB tiles instead.
  // Re-enable by removing this throw and configuring GOOGLE_MAPS_API_KEY.
  throw new Error('Google Maps disabled — using free map tiles');
}
