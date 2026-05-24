let _tokenPromise: Promise<string> | null = null;

export async function getMapboxToken(): Promise<string> {
  if (_tokenPromise) return _tokenPromise;

  _tokenPromise = (async () => {
    try {
      const authToken = localStorage.getItem('token');
      if (!authToken) return import.meta.env.VITE_MAPBOX_API_KEY || '';

      const base = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${base}/api/admin/config`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return import.meta.env.VITE_MAPBOX_API_KEY || '';

      const config: Record<string, any[]> = await res.json();
      for (const items of Object.values(config)) {
        const item = items.find((c: any) => c.config_key === 'mapbox_api_key');
        if (item?.config_value) return item.config_value;
      }
      return import.meta.env.VITE_MAPBOX_API_KEY || '';
    } catch {
      _tokenPromise = null;
      return import.meta.env.VITE_MAPBOX_API_KEY || '';
    }
  })();

  return _tokenPromise;
}

export function clearMapboxTokenCache(): void {
  _tokenPromise = null;
}

// ── Mapbox Style URLs ──────────────────────────────────────

export const DARK_STYLE = 'mapbox://styles/mapbox/dark-v11';
export const STREETS_STYLE = 'mapbox://styles/mapbox/streets-v12';
export const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';
export const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-v9';
export const SATELLITE_STREETS_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
export const OUTDOORS_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
export const NAVIGATION_NIGHT_STYLE = 'mapbox://styles/mapbox/navigation-night-v1';

const STYLE_MAP: Record<string, string> = {
  dark: DARK_STYLE,
  streets: STREETS_STYLE,
  light: LIGHT_STYLE,
  satellite: SATELLITE_STYLE,
  hybrid: SATELLITE_STREETS_STYLE,
  terrain: OUTDOORS_STYLE,
  night_nav: NAVIGATION_NIGHT_STYLE,
};

export function resolveMapStyleUrl(styleId: string): string {
  return STYLE_MAP[styleId] || DARK_STYLE;
}
