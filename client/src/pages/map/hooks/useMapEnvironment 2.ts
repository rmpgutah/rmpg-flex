import { useState, useRef, useCallback, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

type LightingCondition = 'daylight' | 'twilight' | 'darkness';

interface SunriseSunset {
  sunrise: string;
  sunset: string;
  minutesToNextTransition: number;
  nextTransition: 'sunrise' | 'sunset';
}

interface WeatherHazards {
  freezing: boolean;
  highWind: boolean;
  rain: boolean;
  snow: boolean;
  description: string;
}

interface WindCondition {
  speed: number;
  direction: number;
  cardinal: string;
}

interface UseMapEnvironmentReturn {
  lighting: LightingCondition;
  sunriseSunset: SunriseSunset | null;
  lowVisibility: boolean;
  weatherHazards: WeatherHazards;
  icyRoad: boolean;
  windCondition: WindCondition | null;
  visibilityRange: number;
  schoolZoneActive: boolean;
  loading: boolean;
  refresh: () => void;
}

const SLC_LAT = 40.7608;
const SLC_LNG = -111.891;
const REFRESH_INTERVAL = 5 * 60 * 1000;

const OPEN_METEO_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${SLC_LAT}&longitude=${SLC_LNG}` +
  `&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m` +
  `&temperature_unit=fahrenheit&wind_speed_unit=mph`;

const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function solarElevation(date: Date, lat: number, lng: number): number {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const declination = -23.45 * Math.cos(DEG2RAD * ((360 / 365) * (dayOfYear + 10)));
  const hourUTC = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarHour = hourUTC + lng / 15;
  const hourAngle = (solarHour - 12) * 15;
  const sinElev = Math.sin(lat * DEG2RAD) * Math.sin(declination * DEG2RAD) + Math.cos(lat * DEG2RAD) * Math.cos(declination * DEG2RAD) * Math.cos(hourAngle * DEG2RAD);
  return Math.asin(sinElev) * RAD2DEG;
}

function getLightingCondition(elevation: number): LightingCondition {
  if (elevation > 0) return 'daylight';
  if (elevation > -6) return 'twilight';
  return 'darkness';
}

function findNextTransition(now: Date, lat: number, lng: number): { minutes: number; type: 'sunrise' | 'sunset' } {
  const STEP_MS = 2 * 60 * 1000;
  const MAX_MS = 24 * 60 * 60 * 1000;
  const startMs = now.getTime();
  let prevElev = solarElevation(now, lat, lng);
  for (let ms = startMs + STEP_MS; ms <= startMs + MAX_MS; ms += STEP_MS) {
    const d = new Date(ms);
    const elev = solarElevation(d, lat, lng);
    if (prevElev <= 0 && elev > 0) return { minutes: Math.round((ms - startMs) / 60000), type: 'sunrise' };
    if (prevElev >= 0 && elev < 0) return { minutes: Math.round((ms - startMs) / 60000), type: 'sunset' };
    prevElev = elev;
  }
  return { minutes: 720, type: 'sunrise' };
}

function windCardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function isSchoolZoneTime(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const h = now.getHours();
  const m = now.getMinutes();
  const totalMin = h * 60 + m;
  return (totalMin >= 450 && totalMin <= 510) || (totalMin >= 870 && totalMin <= 930);
}

const DEFAULT_WEATHER: WeatherHazards = { freezing: false, highWind: false, rain: false, snow: false, description: '' };

export function useMapEnvironment(
  _map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapEnvironmentReturn {
  const [lighting, setLighting] = useState<LightingCondition>('daylight');
  const [sunriseSunset, setSunriseSunset] = useState<SunriseSunset | null>(null);
  const [lowVisibility, setLowVisibility] = useState(false);
  const [weatherHazards, setWeatherHazards] = useState<WeatherHazards>(DEFAULT_WEATHER);
  const [icyRoad, setIcyRoad] = useState(false);
  const [windCondition, setWindCondition] = useState<WindCondition | null>(null);
  const [visibilityRange, setVisibilityRange] = useState(10000);
  const [schoolZoneActive, setSchoolZoneActive] = useState(false);
  const [loading, setLoading] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const calculate = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);

    const now = new Date();
    const elev = solarElevation(now, SLC_LAT, SLC_LNG);
    const lightCond = getLightingCondition(elev);
    setLighting(lightCond);
    setLowVisibility(lightCond !== 'daylight');

    const transition = findNextTransition(now, SLC_LAT, SLC_LNG);
    setSunriseSunset({ sunrise: '', sunset: '', minutesToNextTransition: transition.minutes, nextTransition: transition.type });
    setSchoolZoneActive(isSchoolZoneTime());

    try {
      const lightData = await apiFetch<{ condition: LightingCondition; sunrise: string; sunset: string }>('/map/safety/lighting-conditions');
      if (lightData?.condition) {
        setLighting(lightData.condition);
        setLowVisibility(lightData.condition !== 'daylight');
        if (lightData.sunrise || lightData.sunset) {
          setSunriseSunset((prev) => prev ? { ...prev, sunrise: lightData.sunrise || '', sunset: lightData.sunset || '' } : prev);
        }
      }
    } catch (err) {
      console.warn('[useMapEnvironment] Light data fetch failed, using client-side fallback:', err);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(OPEN_METEO_URL, { signal: controller.signal });
      if (res.ok) {
        const json = await res.json();
        const c = json.current;
        const temp = Math.round(c.temperature_2m);
        const windSpeed = Math.round(c.wind_speed_10m);
        const windDir = c.wind_direction_10m;
        const code = c.weather_code;

        const freezing = temp < 32;
        const highWind = windSpeed > 30;
        const rain = RAIN_CODES.has(code);
        const snow = SNOW_CODES.has(code);

        const parts: string[] = [];
        if (freezing) parts.push('Freezing');
        if (highWind) parts.push(`High Wind (${windSpeed}mph)`);
        if (rain) parts.push('Rain');
        if (snow) parts.push('Snow');

        setWeatherHazards({ freezing, highWind, rain, snow, description: parts.length > 0 ? parts.join(', ') : 'Clear' });
        setIcyRoad(freezing);
        setWindCondition({ speed: windSpeed, direction: windDir, cardinal: windCardinal(windDir) });

        let vis = 10000;
        if (lightCond === 'darkness') vis = 3000;
        if (lightCond === 'twilight') vis = 5000;
        if (rain) vis = Math.min(vis, 4000);
        if (snow) vis = Math.min(vis, 1500);
        if (highWind && snow) vis = Math.min(vis, 500);
        if (vis < 5000) setLowVisibility(true);
        setVisibilityRange(vis);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLighting('daylight');
      setSunriseSunset(null);
      setLowVisibility(false);
      setWeatherHazards(DEFAULT_WEATHER);
      setIcyRoad(false);
      setWindCondition(null);
      setVisibilityRange(10000);
      setSchoolZoneActive(false);
      return;
    }

    calculate();
    intervalRef.current = setInterval(calculate, REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      abortRef.current?.abort();
    };
  }, [enabled, calculate]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      abortRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(() => { calculate(); }, [calculate]);

  return { lighting, sunriseSunset, lowVisibility, weatherHazards, icyRoad, windCondition, visibilityRange, schoolZoneActive, loading, refresh };
}
