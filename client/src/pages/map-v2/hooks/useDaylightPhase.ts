import { useEffect, useState } from 'react';

export type DaylightPhase = 'Day' | 'Golden Hour' | 'Civil Twilight' | 'Nautical Twilight' | 'Night';

export interface DaylightInfo {
  phase: DaylightPhase;
  sunElevation: number;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const SLC_LAT = 40.76;
const SLC_LNG = -111.89;

function toJulianDay(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let jy = y;
  let jm = m;
  if (m <= 2) { jy -= 1; jm += 12; }
  const A = Math.floor(jy / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (jy + 4716)) + Math.floor(30.6001 * (jm + 1)) + d + h / 24 + B - 1524.5;
}

function calcSunElevation(date: Date, lat: number, lng: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 0;
  const JD = toJulianDay(date);
  const n = JD - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG2RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG2RAD;
  const epsilon = 23.439 * DEG2RAD - 0.0000004 * n * DEG2RAD;
  const sinDec = Math.sin(epsilon) * Math.sin(lambda);
  const dec = Math.asin(sinDec);
  const RA = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const GMST = ((280.46061837 + 360.98564736629 * (JD - 2451545.0)) % 360) * DEG2RAD;
  const HA = GMST + lng * DEG2RAD - RA;
  const latRad = lat * DEG2RAD;
  const sinElev = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(HA);
  return Math.asin(Math.max(-1, Math.min(1, sinElev))) * RAD2DEG;
}

function phaseFor(elev: number): DaylightPhase {
  if (elev > 6) return 'Day';
  if (elev > 0) return 'Golden Hour';
  if (elev > -6) return 'Civil Twilight';
  if (elev > -12) return 'Nautical Twilight';
  return 'Night';
}

/**
 * Reactive daylight phase + sun elevation for SLC. Recomputes every
 * minute. Pure client-side; no API calls. Used by the map-v2 daylight
 * status badge so dispatchers know whether arriving officers can expect
 * useful natural light.
 */
export function useDaylightPhase(): DaylightInfo {
  const [info, setInfo] = useState<DaylightInfo>(() => {
    const elev = calcSunElevation(new Date(), SLC_LAT, SLC_LNG);
    return { phase: phaseFor(elev), sunElevation: elev };
  });
  useEffect(() => {
    const t = setInterval(() => {
      const elev = calcSunElevation(new Date(), SLC_LAT, SLC_LNG);
      setInfo({ phase: phaseFor(elev), sunElevation: elev });
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return info;
}
