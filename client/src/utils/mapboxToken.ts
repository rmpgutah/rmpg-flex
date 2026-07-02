// ============================================================
// RMPG Flex — Mapbox access token resolution (SDK-free)
// ============================================================
// Deliberately has ZERO dependency on the `mapbox-gl` package. Address
// autocomplete, geocoding, and other REST-only Mapbox API callers only
// need a token string — they must not have to pay for loading the
// ~1.7MB mapbox-gl GL renderer just to resolve one. This logic used to
// live in mapboxLoader.ts (which imports `mapbox-gl` at module scope),
// so any caller of the token resolver — including AddressAutocomplete,
// used by NewCallModal/IncidentFormModal on the Dashboard — silently
// pulled in the entire SDK on every page load (2026-07-02 perf fix).
//
// mapboxLoader.ts re-exports these for existing map-surface callers
// that already pay the SDK cost; new REST-only callers should import
// directly from here instead.
// ============================================================

let _serverConfigPromise: Promise<{ accessToken?: string }> | null = null;
let _fetchFailCount = 0;
const MAX_FETCH_RETRIES = 3;

export async function fetchMapboxConfig(): Promise<{ accessToken?: string }> {
  if (_serverConfigPromise) return _serverConfigPromise;
  if (_fetchFailCount >= MAX_FETCH_RETRIES) return {};

  _serverConfigPromise = (async () => {
    try {
      const token = localStorage.getItem('rmpg_token');
      if (!token) {
        _serverConfigPromise = null;
        return {};
      }
      const base = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${base}/api/integrations/mapbox/client-token`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        _fetchFailCount++;
        _serverConfigPromise = null;
        return {};
      }
      _fetchFailCount = 0;
      return await res.json();
    } catch {
      _fetchFailCount++;
      _serverConfigPromise = null;
      return {};
    }
  })();

  return _serverConfigPromise;
}

export async function resolveMapboxAccessToken(): Promise<string> {
  const buildTimeToken = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string || '').trim();
  if (buildTimeToken) return buildTimeToken;
  const cfg = await fetchMapboxConfig();
  return cfg.accessToken || '';
}

export function clearMapboxConfigCache(): void {
  _serverConfigPromise = null;
  _fetchFailCount = 0;
}
