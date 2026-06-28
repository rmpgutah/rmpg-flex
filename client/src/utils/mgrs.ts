// Offline lat/lng → MGRS (Military Grid Reference System) conversion for the
// record-PDF tactical block. Standard WGS-84 UTM forward projection (Krueger
// series, sub-millimeter at CONUS latitudes) + NGA 100k-square lettering
// (AA scheme). Validated against the canonical Washington Monument vector
// (38.8895, -77.0353 → 18S UJ 23371 06519) in utils/__tests__/mgrs.test.ts.

const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX';

function utmZone(lat: number, lng: number): number {
  // Norway/Svalbard exceptions are irrelevant for CONUS but kept for correctness.
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) return 31;
    if (lng >= 9 && lng < 21) return 33;
    if (lng >= 21 && lng < 33) return 35;
    if (lng >= 33 && lng < 42) return 37;
  }
  return Math.floor((lng + 180) / 6) + 1;
}

/** WGS-84 UTM forward (returns easting/northing in meters + zone). */
function toUtm(lat: number, lng: number): { zone: number; easting: number; northing: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const zone = utmZone(lat, lng);
  const lng0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const lam = lng * Math.PI / 180 - lng0;

  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * lam;

  const M = a * (
    (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi)
  );

  const easting = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let northing = k0 * (M + N * Math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
    + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) northing += 10000000;
  return { zone, easting, northing };
}

/**
 * Format an MGRS reference at 1m precision: "18S UJ 23371 06519".
 * Returns '' outside the MGRS latitude domain (|lat| > 84 / < -80).
 */
export function toMgrs(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat > 84 || lat < -80) return '';
  const band = LAT_BANDS.charAt(Math.floor((lat + 80) / 8));
  const { zone, easting, northing } = toUtm(lat, lng);

  // 100k-meter square letters (AA scheme): column letters cycle A-Z minus
  // I/O in 3 zone-dependent sets of 8; row letters cycle 20 letters with a
  // zone-parity offset.
  const COLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const set = (zone - 1) % 3;
  const colIdx = set * 8 + Math.floor(easting / 100000) - 1;
  const col = COLS.charAt(colIdx % 24);
  const ROWS = 'ABCDEFGHJKLMNPQRSTUV';
  const rowOffset = zone % 2 === 0 ? 5 : 0;
  const row = ROWS.charAt((Math.floor(northing / 100000) + rowOffset) % 20);

  const e5 = String(Math.floor(easting % 100000)).padStart(5, '0');
  const n5 = String(Math.floor(northing % 100000)).padStart(5, '0');
  return `${zone}${band} ${col}${row} ${e5} ${n5}`;
}
