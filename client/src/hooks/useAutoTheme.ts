// ============================================================
// useAutoTheme — sunrise/sunset-driven day/night resolution
//
// For prefs.theme === 'auto', Drive Mode should flip to the night map style
// after sunset and back at dawn. This computes local sunrise/sunset purely
// from lat/lng + date (NOAA solar-position approximation — NO network) and
// returns 'day' | 'night'. Recomputes hourly and on a large location change.
//
// Self-contained: the entire solar calc lives here.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';

export type DayNight = 'day' | 'night';

export interface UseAutoThemeArgs {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Force a date (testing). Defaults to "now" and re-ticks hourly. */
  now?: Date;
  /** Default resolution when coords are unavailable. */
  fallback?: DayNight;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const diff = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start;
  return Math.floor(diff / 86_400_000);
}

/**
 * Returns sunrise/sunset as UTC fractional hours for the given date+location,
 * using the standard sunrise-equation approximation (official zenith 90.833°).
 * Returns null for the components that don't occur (polar day/night).
 */
function sunTimesUtcHours(
  date: Date,
  lat: number,
  lng: number,
): { sunriseH: number | null; sunsetH: number | null } {
  const N = dayOfYear(date);
  const zenith = 90.833;

  const calc = (rising: boolean): number | null => {
    const lngHour = lng / 15;
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;

    const M = 0.9856 * t - 3.289;
    let L =
      M +
      1.916 * Math.sin(M * RAD) +
      0.02 * Math.sin(2 * M * RAD) +
      282.634;
    L = ((L % 360) + 360) % 360;

    let RA = DEG * Math.atan(0.91764 * Math.tan(L * RAD));
    RA = ((RA % 360) + 360) % 360;
    const Lquadrant = Math.floor(L / 90) * 90;
    const RAquadrant = Math.floor(RA / 90) * 90;
    RA = RA + (Lquadrant - RAquadrant);
    RA = RA / 15;

    const sinDec = 0.39782 * Math.sin(L * RAD);
    const cosDec = Math.cos(Math.asin(sinDec));

    const cosH =
      (Math.cos(zenith * RAD) - sinDec * Math.sin(lat * RAD)) /
      (cosDec * Math.cos(lat * RAD));
    if (cosH > 1) return null; // sun never rises
    if (cosH < -1) return null; // sun never sets

    let H = rising ? 360 - DEG * Math.acos(cosH) : DEG * Math.acos(cosH);
    H = H / 15;

    const T = H + RA - 0.06571 * t - 6.622;
    let UT = T - lngHour;
    UT = ((UT % 24) + 24) % 24;
    return UT;
  };

  return { sunriseH: calc(true), sunsetH: calc(false) };
}

function resolve(date: Date, lat: number, lng: number, fallback: DayNight): DayNight {
  const { sunriseH, sunsetH } = sunTimesUtcHours(date, lat, lng);
  if (sunriseH == null && sunsetH == null) return fallback;
  const nowUtcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Polar edge cases: if only one event exists, infer from it.
  if (sunriseH == null) return nowUtcH < (sunsetH as number) ? 'day' : 'night';
  if (sunsetH == null) return nowUtcH >= sunriseH ? 'day' : 'night';

  if (sunriseH <= sunsetH) {
    // Normal day window within a single UTC day.
    return nowUtcH >= sunriseH && nowUtcH < sunsetH ? 'day' : 'night';
  }
  // Day window wraps across the UTC midnight boundary.
  return nowUtcH >= sunriseH || nowUtcH < sunsetH ? 'day' : 'night';
}

export function useAutoTheme(args: UseAutoThemeArgs): DayNight {
  const { lat, lng, now, fallback = 'night' } = args;
  const [tick, setTick] = useState(0);
  const lastCoordRef = useRef<{ lat: number; lng: number } | null>(null);

  // Hourly recompute (skipped when a fixed `now` is supplied, e.g. tests).
  useEffect(() => {
    if (now || typeof window === 'undefined') return;
    const id = setInterval(() => setTick((n) => n + 1), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [now]);

  // Recompute on a large (> ~25km) location change.
  useEffect(() => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    const prev = lastCoordRef.current;
    if (!prev || Math.abs(prev.lat - lat) > 0.25 || Math.abs(prev.lng - lng) > 0.25) {
      lastCoordRef.current = { lat, lng };
      setTick((n) => n + 1);
    }
  }, [lat, lng]);

  return useMemo(() => {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fallback;
    }
    const date = now ?? new Date();
    return resolve(date, lat, lng, fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, now, fallback, tick]);
}

export default useAutoTheme;
