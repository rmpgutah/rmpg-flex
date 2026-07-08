// Token resolution lives in mapboxApiKey.ts / mapboxToken.ts (the single
// source of truth, shared cache + in-flight dedupe). This file used to have
// its own independent getMapboxToken() hitting the legacy /api/admin/config
// endpoint, but nothing called it — every surface already imports from
// mapboxApiKey.ts — so it was a second, unused, drifted token path. Removed
// as part of the 2026-07 Mapbox consolidation pass.

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
