// ============================================================
// RMPG Flex — WMO weather-code helpers (Worker side)
// ============================================================
// Open-Meteo reports conditions as WMO 4677 interpretation codes.
// The client already has its own copy of this table in
// client/src/utils/weather.ts; this is the Worker-side twin so
// /api/weather can emit a human-readable `condition` string
// without every caller re-deriving one (and disagreeing).
// ============================================================

const WMO_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Heavy Drizzle',
  56: 'Freezing Drizzle',
  57: 'Heavy Freezing Drizzle',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  66: 'Freezing Rain',
  67: 'Heavy Freezing Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Light Showers',
  81: 'Showers',
  82: 'Heavy Showers',
  85: 'Light Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ Hail',
  99: 'Severe Thunderstorm w/ Hail',
};

/** Human-readable condition for a WMO code. Unknown/absent codes → 'Unknown'. */
export function describeWeatherCode(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return 'Unknown';
  return WMO_CODES[code] ?? 'Unknown';
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/**
 * Degrees → 16-point compass abbreviation. Returns null (not 'undefined')
 * when the bearing is missing so callers can omit the token entirely rather
 * than rendering the string "undefined" — the original popup defect.
 */
export function degreesToCompass(deg: number | null | undefined): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx];
}

/** Freezing-precipitation and thunderstorm codes that matter for CAD scene safety. */
export function isHazardousCode(code: number | null | undefined): boolean {
  if (code == null || !Number.isFinite(code)) return false;
  // 56-57 freezing drizzle, 66-67 freezing rain, 71-77 snow,
  // 85-86 snow showers, 95-99 thunderstorm.
  return (
    (code >= 56 && code <= 57) ||
    (code >= 66 && code <= 67) ||
    (code >= 71 && code <= 77) ||
    (code >= 85 && code <= 86) ||
    code >= 95
  );
}
