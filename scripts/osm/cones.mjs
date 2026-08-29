// Camera view-cone geometry, generated at BUILD time.
//
// Why build-time: Mapbox GL cannot construct geometry in a paint/layout
// expression, and a client-side turf pass over a streaming vector source has no
// stable feature set to operate on. The cone is a real polygon feature in the
// archive, tagged cat=camera_cone.
//
// Utilitarian contract (CAD, not decoration):
//   * A missing cone means "bearing unknown" — never "omnidirectional".
//   * Dome / 360 housings never emit a wedge. Fabricating a circle would
//     claim coverage we do not have.
//   * ALPR wedges are narrower and slightly longer than public CCTV: plate
//     readers look down a lane, not across a lobby.
//   * Cardinals (N, NE, …) are first-class. OSM stores those more often than
//     integers; dropping them used to hide most of the mapped bearings.

const M_PER_DEG_LAT = 111_320;

export const DEFAULT_RADIUS_M = 30;
export const ALPR_RADIUS_M = 50;
export const DEFAULT_FOV_DEG = 60;
export const ALPR_FOV_DEG = 40;
export const CCTV_FOV_DEG = 70;
export const MIN_RADIUS_M = 8;
export const MAX_RADIUS_M = 120;
export const MIN_FOV_DEG = 12;
export const MAX_FOV_DEG = 160;

const CARDINALS = {
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

export function normalizeDeg(n) {
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

/** One token: integer degrees or a cardinal / intercardinal word. */
export function parseBearingToken(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(CARDINALS, s)) return CARDINALS[s];
  const n = Number(s);
  return normalizeDeg(n);
}

/**
 * OSM camera:direction values:
 *   225          one bearing
 *   NE           cardinal
 *   45;225       two housings / two look-directions
 *   0-90         coverage sweep (clockwise from first to second)
 *   N-E          same, in cardinals
 * Junk ("north-ish") yields [].
 */
export function parseCameraDirections(raw) {
  if (raw === undefined || raw === null) return [];
  const s = String(raw).trim();
  if (!s) return [];

  const out = [];
  for (const part of s.split(';')) {
    const token = part.trim();
    if (!token) continue;

    // A lone signed number must not be split on the leading minus.
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
        if (fov === 0) continue; // 360° sweep = omnidirectional claim — drop it
        const bearing = normalizeDeg(a + fov / 2);
        if (fov > MAX_FOV_DEG) {
          // A huge tagged sweep is not a usable wedge. Fall back to the
          // midpoint with the default FOV rather than painting a pie slice
          // over a city block.
          out.push({ bearing, fov: null, from: a, to: b });
        } else {
          out.push({ bearing, fov, from: a, to: b });
        }
        continue;
      }
    }

    const b = parseBearingToken(token);
    if (b !== null) out.push({ bearing: b, fov: null, from: b, to: b });
  }
  return out;
}

function tag(props, key) {
  const v = props?.[key];
  if (v === undefined || v === null) return '';
  return String(v).trim().toLowerCase();
}

/** True when drawing a wedge would claim 360° coverage we do not have. */
export function isOmnidirectionalHousing(props) {
  const type = tag(props, 'camera:type');
  if (type === 'dome' || type === 'hemispheric' || type === 'fisheye' || type === '360') {
    return true;
  }
  const dir = tag(props, 'camera:direction');
  if (dir === '360' || dir === 'all' || dir === 'surround' || dir === 'omni') return true;
  return false;
}

function parseMetres(raw, { alreadyMetres = true } = {}) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const ft = s.match(/^([\d.]+)\s*(ft|feet|')$/);
  if (ft) return Number(ft[1]) * 0.3048;
  const m = s.match(/^([\d.]+)\s*m(eters?)?$/);
  if (m) return Number(m[1]);
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return alreadyMetres ? n : n;
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function coneFovDeg(props) {
  const deg = Number(String(props?.['camera:fov'] ?? props?.['camera:angle'] ?? '').trim());
  if (Number.isFinite(deg) && deg > 0) return clamp(deg, MIN_FOV_DEG, MAX_FOV_DEG);
  if (props?.cat === 'alpr' || tag(props, 'surveillance:type') === 'alpr') return ALPR_FOV_DEG;
  return CCTV_FOV_DEG;
}

export function coneRadiusM(props) {
  const fromTag = parseMetres(props?.['camera:range'] ?? props?.['camera:distance']);
  if (fromTag !== null) return clamp(fromTag, MIN_RADIUS_M, MAX_RADIUS_M);
  if (props?.cat === 'alpr' || tag(props, 'surveillance:type') === 'alpr') return ALPR_RADIUS_M;
  return DEFAULT_RADIUS_M;
}

/**
 * Stamp a numeric camera:bearing on the POINT so Mapbox icon-rotate does not
 * have to parse "NE". Leaves camera:direction intact (the operator-facing tag).
 */
export function stampCameraGeometry(feature) {
  const props = feature?.properties;
  if (!props) return feature;
  const dirs = parseCameraDirections(props['camera:direction']);
  if (!dirs.length) return feature;
  props['camera:bearing'] = String(Math.round(dirs[0].bearing));
  return feature;
}

/**
 * Wedge polygon centered on `bearingDeg`.
 *
 * OSM camera:direction is degrees CLOCKWISE FROM NORTH. Math angles are
 * counter-clockwise from EAST. mathDeg = 90 - bearingDeg. Reversing this
 * mirrors every cone across the N-S axis — plausible-looking and wrong.
 */
export function conePolygon(lng, lat, bearingDeg, radiusM = DEFAULT_RADIUS_M, arcDeg = DEFAULT_FOV_DEG, segments = 12) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (mPerDegLng || 1);

  const centerMath = 90 - bearingDeg;
  const start = centerMath - arcDeg / 2;
  const step = arcDeg / segments;

  const ring = [[lng, lat]];
  for (let i = 0; i <= segments; i++) {
    const rad = ((start + i * step) * Math.PI) / 180;
    ring.push([lng + Math.cos(rad) * dLng, lat + Math.sin(rad) * dLat]);
  }
  ring.push([lng, lat]);

  return { type: 'Polygon', coordinates: [ring] };
}

const CONE_PROPS_FROM_PARENT = [
  'osm_id', 'osm_timestamp', 'osm_version',
  'camera:direction', 'camera:bearing', 'camera:type', 'camera:mount',
  'camera:fov', 'camera:angle', 'camera:range',
  'surveillance:type', 'surveillance:zone', 'surveillance',
  'operator', 'name', 'manufacturer', 'brand', 'model',
];

function coneProperties(parent, extra) {
  const src = parent?.properties ?? {};
  const props = {
    cat: extra.catValue,
    parent_cat: src.cat ?? null,
  };
  for (const key of CONE_PROPS_FROM_PARENT) {
    if (src[key] !== undefined && src[key] !== null && String(src[key]).trim() !== '') {
      props[key] = src[key];
    }
  }
  props.cone_fov_deg = String(Math.round(extra.fov));
  props.cone_radius_m = String(Math.round(extra.radiusM));
  props['camera:bearing'] = String(Math.round(extra.bearing));
  return props;
}

/**
 * One or more cone features for a projected camera point. Empty when the
 * bearing is missing/unparseable, the housing is omnidirectional, or the
 * geometry is not a point.
 */
export function coneFeatures(feature, catValue = 'camera_cone') {
  if (!feature || feature.geometry?.type !== 'Point') return [];
  const props = feature.properties ?? {};
  if (isOmnidirectionalHousing(props)) return [];

  const dirs = parseCameraDirections(props['camera:direction']);
  if (!dirs.length) return [];

  const [lng, lat] = feature.geometry.coordinates;
  const radiusM = coneRadiusM(props);
  const defaultFov = coneFovDeg(props);

  return dirs.map((d) => {
    const fov = clamp(d.fov ?? defaultFov, MIN_FOV_DEG, MAX_FOV_DEG);
    return {
      type: 'Feature',
      geometry: conePolygon(lng, lat, d.bearing, radiusM, fov),
      properties: coneProperties(feature, { catValue, fov, radiusM, bearing: d.bearing }),
    };
  });
}

/**
 * Cone feature for a projected camera point, or null when none apply.
 * Kept as the single-cone helper the existing tests import.
 */
export function coneFeature(feature, catValue = 'camera_cone') {
  return coneFeatures(feature, catValue)[0] ?? null;
}
