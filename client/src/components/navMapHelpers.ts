// ============================================================
// RMPG Flex — Nav Map View helpers
// Self-contained helpers owned by NavMapView.tsx:
//   • navThemePresets / applyNavTheme — Day/Night/Auto recolor
//   • trailFilter — age-fade trimming + vertex decimation
//   • solarPosition — crude sunrise/sunset estimate for 'auto' theme
//   • speedAdaptiveZoom — speed-aware look-ahead zoom
//   • clamp helpers
// No imports from other lanes; pure TS so it stays unit-friendly.
// ============================================================

export type NavMapTheme = 'night' | 'day' | 'auto';
export type NavMapOrientation = 'heading-up' | 'north-up';

// Mapbox style URLs are passed in by the caller so this file stays
// decoupled from the loader module. The caller owns the dark/light URLs.
export interface NavThemeStyleUrls {
  dark: string;
  light: string;
}

// ── Solar position ─────────────────────────────────────────
// Lightweight day/night decision. Not an ephemeris — just "is the sun
// up right now at this lat/lng" via a NOAA-style sunrise/sunset approx.
// Good enough to flip the map theme. Falls back to a fixed 06:00–20:00
// local window if no position is available.
export function isDaylight(
  lat: number | null | undefined,
  lng: number | null | undefined,
  date: Date = new Date(),
): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const h = date.getHours();
    return h >= 6 && h < 20;
  }
  try {
    const rad = Math.PI / 180;
    // Day of year
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const diff = date.getTime() - start;
    const dayOfYear = Math.floor(diff / 86400000);

    // Fractional year (radians)
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (date.getUTCHours() - 12) / 24);
    // Solar declination (radians)
    const decl =
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma);

    const latRad = lat * rad;
    // Hour angle of sunrise/sunset (sun at -0.833° for refraction)
    const cosH =
      (Math.cos(90.833 * rad) - Math.sin(latRad) * Math.sin(decl)) /
      (Math.cos(latRad) * Math.cos(decl));
    if (cosH > 1) return false; // sun never rises (polar night)
    if (cosH < -1) return true; // sun never sets (polar day)

    const haDeg = Math.acos(cosH) / rad; // degrees
    // Solar noon in minutes UTC
    const eqTime =
      229.18 *
      (0.000075 +
        0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma));
    const sunriseUTCmin = 720 - 4 * (lng + haDeg) - eqTime;
    const sunsetUTCmin = 720 - 4 * (lng - haDeg) - eqTime;

    const nowUTCmin = date.getUTCHours() * 60 + date.getUTCMinutes();
    return nowUTCmin >= sunriseUTCmin && nowUTCmin <= sunsetUTCmin;
  } catch {
    const h = date.getHours();
    return h >= 6 && h < 20;
  }
}

// Resolve 'auto' to a concrete light/dark choice based on solar position.
export function resolveNavTheme(
  theme: NavMapTheme,
  lat: number | null | undefined,
  lng: number | null | undefined,
  date: Date = new Date(),
): 'night' | 'day' {
  if (theme === 'auto') {
    return isDaylight(lat, lng, date) ? 'day' : 'night';
  }
  return theme;
}

// Pick the style URL for a resolved theme.
export function navThemeStyleUrl(
  resolved: 'night' | 'day',
  urls: NavThemeStyleUrls,
): string {
  return resolved === 'day' ? urls.light : urls.dark;
}

// ── Overlay palette (route line + position halo/dot + pins) ──
// Mapbox layer `paint` properties don't accept CSS variables, so the
// theme-aware overlay colors live here as plain hex. Gold (#d4a017) reads
// well on the dark steel-blue night basemap; a deeper amber lifts contrast
// over the bright light-grey day basemap so the route line stays legible.
export interface NavOverlayPalette {
  /** Route line + predicted path color. */
  route: string;
  /** Position dot + halo color. */
  position: string;
  /** Halo opacity 0..1 (slightly lower over day so the basemap shines through). */
  haloOpacity: number;
}

export function navOverlayPalette(theme: 'night' | 'day'): NavOverlayPalette {
  return theme === 'day'
    ? { route: '#a07d12', position: '#a07d12', haloOpacity: 0.22 }
    : { route: '#d4a017', position: '#d4a017', haloOpacity: 0.18 };
}

// Re-color the known overlay layers on a live map. IDs must match the
// constants NavMapView creates (POSITION_HALO_LAYER_ID / POSITION_LAYER_ID /
// ROUTE_LAYER_ID / PREDICTED_LAYER_ID). Each call is guarded the same way
// applyNavTheme guards its layer ops — a missing layer is a no-op.
export function applyNavOverlayPalette(
  map: {
    getLayer?: (id: string) => unknown;
    setPaintProperty?: (id: string, prop: string, value: unknown) => void;
  } | null | undefined,
  palette: NavOverlayPalette,
  layerIds: { route?: string; predicted?: string; positionHalo?: string; position?: string },
): void {
  if (!map || typeof map.setPaintProperty !== 'function') return;
  const safeSet = (id: string | undefined, prop: string, value: unknown) => {
    if (!id) return;
    try {
      if (typeof map.getLayer === 'function' && !map.getLayer(id)) return;
      map.setPaintProperty!(id, prop, value);
    } catch { /* missing layer / wrong type — ignore */ }
  };
  safeSet(layerIds.route, 'line-color', palette.route);
  safeSet(layerIds.predicted, 'line-color', palette.route);
  safeSet(layerIds.positionHalo, 'circle-color', palette.position);
  safeSet(layerIds.positionHalo, 'circle-stroke-color', palette.position);
  safeSet(layerIds.positionHalo, 'circle-opacity', palette.haloOpacity);
  safeSet(layerIds.position, 'circle-color', palette.position);
}

// ── Theme recolor presets ──────────────────────────────────
// applyNavTheme walks the style layers. For 'night' it darkens the
// basemap toward pure-black (HUD-safe under gold overlays). For 'day'
// it skips recolor entirely and trusts the lighter style as-is.
export const navThemePresets = {
  night: {
    // Layer-type → paint props to push toward black.
    background: '#0a0a0a',
    fill: '#101010',
    // Mapbox paint properties don't resolve CSS variables — these had been
    // silently swallowed by safeSet's try/catch, leaving water + road at
    // their stock basemap colors. Use the night-theme literals for
    // --surface-overlay (#060b10) and --surface-raised (#15212e) so the
    // basemap actually re-skins to RMPG steel-blue.
    water: '#060b10',
    road: '#15212e',
    text: '#888888',
    textHalo: '#000000',
  },
  day: {
    background: null, // skip — use style defaults
  },
} as const;

// Recolor a live Mapbox map to the requested theme. Defensive: any layer
// op is wrapped so a single missing layer never throws the whole pass.
// `map` is typed loosely to avoid importing mapbox types across the lane.
export function applyNavTheme(
  map: {
    getStyle?: () => any;
    setPaintProperty?: (id: string, prop: string, value: any) => void;
    isStyleLoaded?: () => boolean;
  } | null | undefined,
  theme: 'night' | 'day',
): void {
  if (!map || typeof map.getStyle !== 'function' || typeof map.setPaintProperty !== 'function') {
    return;
  }
  // 'day' = no recolor; lighter style stands on its own.
  if (theme === 'day') return;

  let style: any;
  try {
    style = map.getStyle();
  } catch {
    return;
  }
  const layers: any[] = style?.layers ?? [];
  const p = navThemePresets.night;

  const safeSet = (id: string, prop: string, value: any) => {
    try {
      map.setPaintProperty!(id, prop, value);
    } catch {
      /* layer absent / wrong type — ignore */
    }
  };

  for (const layer of layers) {
    if (!layer || typeof layer.id !== 'string') continue;
    const id: string = layer.id;
    const type: string = layer.type;
    const lower = id.toLowerCase();

    switch (type) {
      case 'background':
        safeSet(id, 'background-color', p.background);
        break;
      case 'fill':
        if (lower.includes('water')) {
          safeSet(id, 'fill-color', p.water);
        } else {
          safeSet(id, 'fill-color', p.fill);
        }
        break;
      case 'line':
        // Don't touch our own overlay layers (handled by caller); recolor
        // basemap roads/boundaries only.
        if (lower.startsWith('nav-')) break;
        safeSet(id, 'line-color', p.road);
        break;
      case 'symbol':
        if (lower.startsWith('nav-')) break;
        safeSet(id, 'text-color', p.text);
        safeSet(id, 'text-halo-color', p.textHalo);
        break;
      default:
        break;
    }
  }
}

// ── Trail filter ───────────────────────────────────────────
// A breadcrumb point with an optional timestamp. ts may be ISO string,
// epoch ms, or absent (treated as "no age info" → kept).
export interface TrailPoint {
  lat: number;
  lng: number;
  ts?: string | number | null;
}

function toEpochMs(ts: string | number | null | undefined): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

export const trailFilter = {
  // Drop points older than `maxMinutes` from `now`. Points with no
  // timestamp are always kept (we can't age what we can't date).
  // maxMinutes <= 0 / non-finite => no trimming (keep all).
  trimByAge(
    points: TrailPoint[],
    maxMinutes: number | null | undefined,
    now: number = Date.now(),
  ): TrailPoint[] {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (maxMinutes == null || !Number.isFinite(maxMinutes) || maxMinutes <= 0) {
      return points.slice();
    }
    const cutoff = now - maxMinutes * 60_000;
    return points.filter((pt) => {
      const ms = toEpochMs(pt.ts);
      if (ms == null) return true;
      return ms >= cutoff;
    });
  },

  // Reduce to at most `maxVertices` by evenly striding, always keeping
  // the first and last points so the trail stays anchored.
  decimate(points: TrailPoint[], maxVertices: number = 500): TrailPoint[] {
    if (!Array.isArray(points)) return [];
    const n = points.length;
    if (maxVertices <= 0 || n <= maxVertices) return points.slice();
    const stride = (n - 1) / (maxVertices - 1);
    const out: TrailPoint[] = [];
    for (let i = 0; i < maxVertices; i++) {
      out.push(points[Math.round(i * stride)]);
    }
    // Guarantee last point present (rounding can drop it).
    if (out[out.length - 1] !== points[n - 1]) {
      out[out.length - 1] = points[n - 1];
    }
    return out;
  },
};

// ── Speed-aware adaptive zoom ───────────────────────────────
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Map a speed (m/s) to a follow-me zoom level. Slow (grid driving) → tight
// zoom for detail; highway → zoomed out for look-ahead. Linearly
// interpolated between baseZoom (at/below slowMs) and minZoom (at/above
// fastMs), then clamped.
export interface AdaptiveZoomOpts {
  baseZoom?: number; // zoom when slow / stopped
  minZoom?: number; // most-zoomed-out at highway speed
  slowMps?: number; // speed (m/s) at/below which baseZoom applies (~11mph)
  fastMps?: number; // speed (m/s) at/above which minZoom applies (~67mph)
}

export function speedAdaptiveZoom(
  speedMps: number | null | undefined,
  opts: AdaptiveZoomOpts = {},
): number {
  const baseZoom = opts.baseZoom ?? 16.5;
  const minZoom = opts.minZoom ?? 13.5;
  const slowMps = opts.slowMps ?? 5; // ~11 mph
  const fastMps = opts.fastMps ?? 30; // ~67 mph
  const s = typeof speedMps === 'number' && Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
  if (fastMps <= slowMps) return clamp(baseZoom, minZoom, baseZoom);
  const t = clamp((s - slowMps) / (fastMps - slowMps), 0, 1);
  const z = baseZoom + (minZoom - baseZoom) * t;
  return clamp(z, Math.min(minZoom, baseZoom), Math.max(minZoom, baseZoom));
}
