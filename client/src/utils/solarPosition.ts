// ============================================================
// RMPG Flex — Solar Position Helper (auto theme / dimming)
// NOAA solar-geometry approximation for sunrise/sunset + a daylight
// test, used to auto-switch the NAVIGATE map between day and night
// themes. Pure, no network. Algorithm: NOAA General Solar Position
// Calculations (zenith 90.833° for the official sunrise/sunset).
// ============================================================

export interface SunTimes {
  /** Local Date of sunrise (null if sun never rises that day). */
  sunrise: Date | null;
  /** Local Date of sunset (null if sun never sets that day). */
  sunset: Date | null;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Day-of-year (1..366) for a date, in its local components. */
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

/**
 * Core NOAA hour-angle solve for a given zenith.
 * Returns UTC fractional hours of the event, or null if no event
 * (polar day/night). `rising` selects sunrise vs sunset branch.
 */
function solarEventUtcHours(
  lat: number,
  lng: number,
  date: Date,
  rising: boolean,
  zenith = 90.833,
): number | null {
  const N = dayOfYear(date);
  const lngHour = lng / 15;
  const t = rising ? N + (6 - lngHour) / 24 : N + (18 - lngHour) / 24;

  // Sun's mean anomaly
  const M = 0.9856 * t - 3.289;
  // Sun's true longitude
  let L = M + 1.916 * Math.sin(M * RAD) + 0.020 * Math.sin(2 * M * RAD) + 282.634;
  L = ((L % 360) + 360) % 360;

  // Right ascension, quadrant-aligned with L
  let RA = DEG * Math.atan(0.91764 * Math.tan(L * RAD));
  RA = ((RA % 360) + 360) % 360;
  const Lquad = Math.floor(L / 90) * 90;
  const RAquad = Math.floor(RA / 90) * 90;
  RA = (RA + (Lquad - RAquad)) / 15; // → hours

  // Declination
  const sinDec = 0.39782 * Math.sin(L * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));

  // Local hour angle
  const cosH =
    (Math.cos(zenith * RAD) - sinDec * Math.sin(lat * RAD)) /
    (cosDec * Math.cos(lat * RAD));
  if (cosH > 1) return null; // sun never rises
  if (cosH < -1) return null; // sun never sets

  let H = rising ? 360 - DEG * Math.acos(cosH) : DEG * Math.acos(cosH);
  H = H / 15; // → hours

  const T = H + RA - 0.06571 * t - 6.622; // local mean time
  let UT = T - lngHour; // → UTC
  UT = ((UT % 24) + 24) % 24;
  return UT;
}

/** Build a Date from a base date's Y/M/D and a UTC fractional-hour. */
function utcHoursToDate(date: Date, utcHours: number): Date {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const h = Math.floor(utcHours);
  const minF = (utcHours - h) * 60;
  const min = Math.floor(minF);
  const sec = Math.round((minF - min) * 60);
  return new Date(Date.UTC(y, m, d, h, min, sec));
}

/** Sunrise & sunset for a coordinate/date (official zenith 90.833°). */
export function sunriseSunset(lat: number, lng: number, date: Date): SunTimes {
  const base = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const rUt = solarEventUtcHours(lat, lng, base, true);
  const sUt = solarEventUtcHours(lat, lng, base, false);
  const sunrise = rUt == null ? null : utcHoursToDate(base, rUt);
  let sunset = sUt == null ? null : utcHoursToDate(base, sUt);
  // The per-event UTC hours are each normalized to [0,24) on the SAME calendar
  // day, so for western-hemisphere longitudes sunset's UTC clock time can land
  // numerically BEFORE sunrise's (it is actually the next UTC day). Roll sunset
  // forward 24h so the daylight interval [sunrise, sunset) is always ordered.
  if (sunrise && sunset && sunset.getTime() <= sunrise.getTime()) {
    sunset = new Date(sunset.getTime() + 86_400_000);
  }
  return { sunrise, sunset };
}

/**
 * Is the given instant during daylight at the coordinate?
 * Polar day → true, polar night → false.
 */
export function isDaylight(lat: number, lng: number, date: Date): boolean {
  const base = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const { sunrise, sunset } = sunriseSunset(lat, lng, base);
  if (!sunrise && !sunset) {
    // No event: decide polar day vs night via solar declination sign.
    const N = dayOfYear(base);
    const decl = 23.44 * Math.sin(RAD * (360 / 365) * (N - 81));
    return lat >= 0 ? decl > 0 : decl < 0;
  }
  const t = base.getTime();
  if (sunrise && sunset) {
    return t >= sunrise.getTime() && t < sunset.getTime();
  }
  // Only one event present — treat presence of sunrise-only as before-set day.
  if (sunrise) return t >= sunrise.getTime();
  if (sunset) return t < sunset.getTime();
  return true;
}
