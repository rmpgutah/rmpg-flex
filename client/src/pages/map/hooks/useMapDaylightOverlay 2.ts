import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

type DaylightPhase = 'Day' | 'Golden Hour' | 'Civil Twilight' | 'Nautical Twilight' | 'Night';

interface UseMapDaylightOverlayReturn {
  phase: string;
  sunElevation: number;
  minutesToSunset: number | null;
  minutesToSunrise: number | null;
}

const DEFAULT_LAT = 40.76;
const DEFAULT_LNG = -111.89;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

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
  return Math.asin(sinElev) * RAD2DEG;
}

function getPhase(elevation: number): DaylightPhase {
  if (elevation > 6) return 'Day';
  if (elevation >= 0) return 'Golden Hour';
  if (elevation >= -6) return 'Civil Twilight';
  if (elevation >= -12) return 'Nautical Twilight';
  return 'Night';
}

function findNextEvent(date: Date, lat: number, lng: number, targetElevation: number, direction: 'rising' | 'setting'): number | null {
  const startMs = date.getTime();
  const maxMs = startMs + 24 * 60 * 60 * 1000;
  const stepMs = 2 * 60 * 1000;
  let prevElev = calcSunElevation(date, lat, lng);
  for (let ms = startMs + stepMs; ms <= maxMs; ms += stepMs) {
    const checkDate = new Date(ms);
    const elev = calcSunElevation(checkDate, lat, lng);
    if (direction === 'rising' && prevElev <= targetElevation && elev > targetElevation) return Math.round((ms - startMs) / 60000);
    if (direction === 'setting' && prevElev >= targetElevation && elev < targetElevation) return Math.round((ms - startMs) / 60000);
    prevElev = elev;
  }
  return null;
}

export function useMapDaylightOverlay(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapDaylightOverlayReturn {
  const [state, setState] = useState<UseMapDaylightOverlayReturn>({
    phase: 'Day', sunElevation: 0, minutesToSunset: null, minutesToSunrise: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastDateKeyRef = useRef<string>('');
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!enabled) {
      setState({ phase: 'Day', sunElevation: 0, minutesToSunset: null, minutesToSunrise: null });
      return;
    }

    const calculate = () => {
      let lat = DEFAULT_LAT;
      let lng = DEFAULT_LNG;
      if (map) {
        const center = map.getCenter();
        if (center) { lat = center.lat; lng = center.lng; }
      }

      const now = new Date();
      const elevation = calcSunElevation(now, lat, lng);
      const phase = getPhase(elevation);

      const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${Math.floor(now.getHours() / 2)}`;
      let minutesToSunset: number | null;
      let minutesToSunrise: number | null;

      if (dateKey !== lastDateKeyRef.current) {
        minutesToSunset = findNextEvent(now, lat, lng, 0, 'setting');
        minutesToSunrise = findNextEvent(now, lat, lng, 0, 'rising');
        lastDateKeyRef.current = dateKey;
      } else {
        minutesToSunset = stateRef.current.minutesToSunset != null ? stateRef.current.minutesToSunset : findNextEvent(now, lat, lng, 0, 'setting');
        minutesToSunrise = stateRef.current.minutesToSunrise != null ? stateRef.current.minutesToSunrise : findNextEvent(now, lat, lng, 0, 'rising');
      }

      setState({ phase, sunElevation: Math.round(elevation * 10) / 10, minutesToSunset, minutesToSunrise });
    };

    calculate();
    intervalRef.current = setInterval(calculate, 60_000);

    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [map, enabled]);

  useEffect(() => {
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, []);

  return state;
}
