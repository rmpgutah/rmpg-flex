// ============================================================
// RMPG Flex — OSM surveillance camera overlay (map + popup)
// ============================================================
// Police-functional, not decorative. ALPR and public CCTV are different
// tools: a plate reader looks down a lane; a public camera watches a
// scene. Color is identity, not chrome. A missing cone is "bearing
// unknown" — never a fabricated 360° coverage claim.
//
// Literal hex is required: these values are Mapbox paint/layout
// expressions. var() does not resolve there.
// ============================================================

/** ALPR / plate-reader — cyan, CAD "intel" identity. */
export const ALPR_COLOR = '#38bdf8';
/** Public / other CCTV — violet, CAD surveillance identity. */
export const CCTV_COLOR = '#a78bfa';
/** Fallback when parent_cat is missing on a legacy tile. */
export const CONE_FALLBACK = '#7c8b9e';

export const ALPR_CONE_FILL = '#38bdf8';
export const CCTV_CONE_FILL = '#a78bfa';

const CARDINALS: Record<string, number> = {
  n: 0, north: 0,
  nne: 22.5,
  ne: 45, northeast: 45,
  ene: 67.5,
  e: 90, east: 90,
  ese: 112.5,
  se: 135, southeast: 135,
  sse: 157.5,
  s: 180, south: 180,
  ssw: 202.5,
  sw: 225, southwest: 225,
  wsw: 247.5,
  w: 270, west: 270,
  wnw: 292.5,
  nw: 315, northwest: 315,
  nnw: 337.5,
};

export function normalizeDeg(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

export function parseBearingToken(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(CARDINALS, s)) return CARDINALS[s];
  return normalizeDeg(Number(s));
}

export interface CameraLook {
  bearing: number;
  fov: number | null;
  from: number;
  to: number;
}

export function parseCameraDirections(raw: unknown): CameraLook[] {
  if (raw === undefined || raw === null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const out: CameraLook[] = [];
  for (const part of s.split(';')) {
    const token = part.trim();
    if (!token) continue;
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      const b = parseBearingToken(token);
      if (b !== null) out.push({ bearing: b, fov: null, from: b, to: b });
      continue;
    }
    const range = token.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (range) {
      const a = parseBearingToken(range[1]);
      const b = parseBearingToken(range[2]);
      if (a !== null && b !== null) {
        const fov = (b - a + 360) % 360;
        if (fov === 0) continue;
        const bearing = normalizeDeg(a + fov / 2);
        if (bearing === null) continue;
        out.push({ bearing, fov: fov > 160 ? null : fov, from: a, to: b });
        continue;
      }
    }
    const b = parseBearingToken(token);
    if (b !== null) out.push({ bearing: b, fov: null, from: b, to: b });
  }
  return out;
}

export function isOmnidirectionalHousing(props: Record<string, unknown>): boolean {
  const type = String(props['camera:type'] ?? '').trim().toLowerCase();
  if (type === 'dome' || type === 'hemispheric' || type === 'fisheye' || type === '360') return true;
  const dir = String(props['camera:direction'] ?? '').trim().toLowerCase();
  return dir === '360' || dir === 'all' || dir === 'surround' || dir === 'omni';
}

export function isSurveillanceCameraCat(cat: string): boolean {
  return cat === 'camera' || cat === 'alpr';
}

export function isCameraConeCat(cat: string): boolean {
  return cat === 'camera_cone';
}

/** Compass point + integer degrees. Cardinals ("NE") resolve; junk is omitted. */
export function formatCameraBearing(raw: unknown): string | null {
  const looks = parseCameraDirections(raw);
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const one = (d: number) => {
    const norm = normalizeDeg(d);
    if (norm === null) return null;
    return `${pts[Math.round(norm / 22.5) % 16]} (${Math.round(norm)}°)`;
  };
  if (looks.length) {
    return looks.map((l) => one(l.bearing)).filter(Boolean).join(' + ') || null;
  }
  const fallback = parseBearingToken(raw);
  return fallback === null ? null : one(fallback);
}

export function formatConeRadius(raw: unknown): string | null {
  const m = Number(String(raw ?? '').trim());
  if (!Number.isFinite(m) || m <= 0) return null;
  const ft = Math.round(m * 3.28084);
  return `${ft} ft (${Math.round(m)} m)`;
}

/**
 * icon-rotate for a camera symbol. 0° in the artwork is NORTH.
 * rotation-alignment MUST be 'map' or a rotated map lies about facing.
 * Dome housings stay unrotated — they have no look-direction.
 *
 * Prefers the numeric camera:bearing stamped at tile build so cardinals
 * ("NE") still rotate on archives that carried only the OSM tag.
 */
export function cameraIconRotateExpression(): unknown {
  return [
    'case',
    ['==', ['downcase', ['to-string', ['coalesce', ['get', 'camera:type'], '']]], 'dome'],
    0,
    ['==', ['downcase', ['to-string', ['coalesce', ['get', 'camera:type'], '']]], 'fisheye'],
    0,
    ['==', ['downcase', ['to-string', ['coalesce', ['get', 'camera:type'], '']]], 'hemispheric'],
    0,
    [
      'coalesce',
      ['to-number', ['get', 'camera:bearing']],
      ['to-number', ['get', 'camera:direction']],
      0,
    ],
  ];
}

export function cameraSymbolLayout(cat: string, minzoom: number, iconImage: unknown): Record<string, unknown> {
  const alpr = cat === 'alpr';
  return {
    'icon-image': iconImage,
    // ALPR is the canvass-priority mark: slightly larger, still a 16–32 px
    // tool icon, never a billboard.
    'icon-size': alpr
      ? ['interpolate', ['linear'], ['zoom'], minzoom, 0.30, 18, 0.56]
      : ['interpolate', ['linear'], ['zoom'], minzoom, 0.26, 18, 0.50],
    'icon-allow-overlap': false,
    'icon-ignore-placement': false,
    'icon-rotate': cameraIconRotateExpression(),
    'icon-rotation-alignment': 'map',
    'icon-pitch-alignment': 'map',
  };
}

/** Status ring under the glyph — identity, not glow. Opacity stays low. */
export function cameraHaloPaint(cat: string, minzoom: number): Record<string, unknown> {
  return {
    'circle-color': cat === 'alpr' ? ALPR_COLOR : CCTV_COLOR,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], minzoom, 5, 18, 9],
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.16, 18, 0.28],
    'circle-stroke-width': 0,
    'circle-pitch-alignment': 'map',
  };
}

export function cameraConeFillPaint(): Record<string, unknown> {
  return {
    'fill-color': [
      'match',
      ['to-string', ['coalesce', ['get', 'parent_cat'], '']],
      'alpr', ALPR_CONE_FILL,
      'camera', CCTV_CONE_FILL,
      CONE_FALLBACK,
    ],
    // Cap well under 0.35 so the basemap (roads, names) stays readable.
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.10, 16, 0.18, 18, 0.26],
    'fill-antialias': true,
  };
}

export function cameraConeOutlinePaint(parent: 'alpr' | 'camera' | 'any'): Record<string, unknown> {
  const color = parent === 'alpr' ? ALPR_COLOR : parent === 'camera' ? CCTV_COLOR : CONE_FALLBACK;
  return {
    'line-color': color,
    'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.7, 18, 1.4],
    'line-opacity': 0.8,
    ...(parent === 'camera' ? { 'line-dasharray': [2, 1.2] } : {}),
  };
}

export function cameraConeFilter(parent?: 'alpr' | 'camera'): unknown[] {
  if (!parent) return ['==', ['get', 'cat'], 'camera_cone'];
  return [
    'all',
    ['==', ['get', 'cat'], 'camera_cone'],
    ['==', ['get', 'parent_cat'], parent],
  ];
}

/** Insert cones beneath camera glyphs when those layers already exist. */
export function cameraConeBeforeLayerId(hasLayer: (id: string) => boolean): string | undefined {
  for (const id of [
    'vt-osm_surveillance_alpr-halo',
    'vt-osm_surveillance_camera-halo',
    'vt-osm_surveillance_alpr-symbol',
    'vt-osm_surveillance_camera-symbol',
  ]) {
    if (hasLayer(id)) return id;
  }
  return undefined;
}
