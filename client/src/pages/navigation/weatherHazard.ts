// ============================================================
// RMPG Flex — Nav weather hazard decision logic
// ============================================================
// Pure function deriving a single "worst" driving hazard label from the
// existing Open-Meteo integration's response shape (client/src/utils/weather.ts
// WeatherData). That util does NOT expose a visibility-in-miles field — Open-Meteo's
// `current` block only gives us the WMO weather_code, wind_speed_10m, and
// precipitation — so "low visibility" is approximated from the WMO fog codes
// (45/48) rather than invented from a field that doesn't exist. Field names/
// types below are a deliberate subset of WeatherData, not a new shape.
// ============================================================

/** Subset of WeatherData (client/src/utils/weather.ts) relevant to hazard
 *  detection. Kept as its own narrow type so this module doesn't need to
 *  import the full WeatherData type just to pick two fields off it. */
export interface WeatherHazardInput {
  /** WMO Weather Interpretation Code (WeatherData.conditionCode). */
  conditionCode: number | null;
  /** mph (WeatherData.windSpeed). */
  windSpeed: number | null;
}

// WMO codes for freezing precipitation (icy roads).
const ICY_CODES = new Set([56, 57, 66, 67]);
// WMO codes for snow / snow showers.
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
// WMO codes for fog / freezing fog — the closest proxy Open-Meteo's `current`
// block offers to a low-visibility condition (no visibility-in-miles field exists).
const FOG_CODES = new Set([45, 48]);

const HIGH_WIND_MPH = 35;

/** Returns a short driving-hazard label for the HUD badge, or null when
 *  conditions don't warrant a warning. Checks worst-first: ice > snow >
 *  high wind > fog/low visibility. */
export function weatherHazardLabel(w: WeatherHazardInput): string | null {
  if (w.conditionCode != null && ICY_CODES.has(w.conditionCode)) return 'Icy conditions';
  if (w.conditionCode != null && SNOW_CODES.has(w.conditionCode)) return 'Snow';
  if (w.windSpeed != null && w.windSpeed >= HIGH_WIND_MPH) return 'High wind';
  if (w.conditionCode != null && FOG_CODES.has(w.conditionCode)) return 'Low visibility';
  return null;
}
