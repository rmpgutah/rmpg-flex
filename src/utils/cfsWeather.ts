// ============================================================
// CFS scene-weather snapshot
// ============================================================
// Open-Meteo current (live) or hourly (historical) observation
// stamped onto a call at dispatch / when created_at is edited.
// Pure fetch + mapping — persistence lives in cfsWeatherStamp.ts.
// ============================================================

import { describeWeatherCode, degreesToCompass, isHazardousCode } from './weatherCodes';

export const LIVE_WINDOW_MS = 90 * 60 * 1000;
export const WINDY_MPH = 20;

/** Dispatcher-facing scene category used on CFS forms and the PDF. */
export const CFS_WEATHER_CATEGORIES = [
  'Sunny',
  'Overcast',
  'Rain',
  'Thunderstorm',
  'Windy',
  'Snow',
  'Fog',
  'Partly Cloudy',
  'Clear',
] as const;

export type CfsWeatherCategory = (typeof CFS_WEATHER_CATEGORIES)[number];

export interface CfsWeatherSnapshot {
  temp_f: number | null;
  feels_like_f: number | null;
  condition: string;
  scene_category: CfsWeatherCategory | string;
  weather_code: number | null;
  wind_mph: number | null;
  wind_gust_mph: number | null;
  wind_dir: string | null;
  wind_dir_deg: number | null;
  humidity: number | null;
  visibility_mi: number | null;
  precip_in: number | null;
  cloud_cover_pct: number | null;
  is_day: boolean | null;
  lighting: string;
  observed_at: string | null;
  source: 'live' | 'historical';
  lat: number;
  lng: number;
  captured_at: string;
}

const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'is_day',
].join(',');

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'is_day',
].join(',');

function round(v: number | null | undefined, places = 0): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/** Naive D1 / ISO timestamps are UTC. Returns null for unparseable input. */
export function parseWeatherAtMs(raw: string | number | Date | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasZone ? trimmed.replace(' ', 'T') : `${trimmed.replace(' ', 'T')}Z`;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : null;
}

export function isLiveWeatherWindow(atMs: number | null, nowMs = Date.now()): boolean {
  if (atMs == null) return true;
  if (atMs > nowMs) return true;
  return nowMs - atMs <= LIVE_WINDOW_MS;
}

/**
 * Map WMO code + wind to the CFS form category.
 * Thunderstorm / precip / snow / fog win over wind; otherwise ≥20 mph → Windy.
 */
export function sceneCategoryFromObservation(
  weatherCode: number | null | undefined,
  windMph: number | null | undefined,
): CfsWeatherCategory {
  const code = weatherCode ?? -1;
  if (code >= 95) return 'Thunderstorm';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'Snow';
  if (code === 45 || code === 48) return 'Fog';
  if (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82)
  ) return 'Rain';
  if ((windMph ?? 0) >= WINDY_MPH) return 'Windy';
  if (code === 3) return 'Overcast';
  if (code === 2) return 'Partly Cloudy';
  if (code === 0 || code === 1) return 'Sunny';
  if (code >= 0 && code <= 9) return 'Overcast';
  return 'Clear';
}

export function lightingFromObservation(
  isDay: boolean | null | undefined,
  atMs: number | null,
): string {
  if (isDay === true) return 'Daylight';
  if (isDay === false) return 'Dark - Street Lit';
  if (atMs != null) {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        hour: '2-digit',
        hour12: false,
      }).format(new Date(atMs)),
    );
    if (hour >= 6 && hour < 18) return 'Daylight';
    if (hour === 5 || hour === 18) return 'Dusk/Dawn';
    return 'Dark - Street Lit';
  }
  return '';
}

function visibilityToMiles(raw: number | null | undefined, unit: string | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const perMile = unit === 'm' ? 1609.344 : 5280;
  return raw / perMile;
}

function ymdUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function pickNearestHourIndex(times: string[], atMs: number): number {
  if (!times.length) return -1;
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(times[i]) ? times[i] : `${times[i]}Z`);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - atMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return best;
}

function numAt(arr: Array<number | null | undefined> | undefined, i: number): number | null {
  const v = arr?.[i];
  return v == null || !Number.isFinite(v) ? null : v;
}

function snapshotFromParts(args: {
  temp: number | null;
  feels: number | null;
  humidity: number | null;
  precip: number | null;
  code: number | null;
  cloud: number | null;
  visRaw: number | null;
  visUnit: string | undefined;
  wind: number | null;
  gust: number | null;
  dirDeg: number | null;
  isDay: boolean | null;
  observedAt: string | null;
  source: 'live' | 'historical';
  lat: number;
  lng: number;
  atMs: number | null;
}): CfsWeatherSnapshot {
  const wind_mph = round(args.wind);
  const weather_code = args.code;
  return {
    temp_f: round(args.temp),
    feels_like_f: round(args.feels),
    condition: describeWeatherCode(weather_code),
    scene_category: sceneCategoryFromObservation(weather_code, wind_mph),
    weather_code,
    wind_mph,
    wind_gust_mph: round(args.gust),
    wind_dir: degreesToCompass(args.dirDeg),
    wind_dir_deg: round(args.dirDeg),
    humidity: round(args.humidity),
    visibility_mi: round(visibilityToMiles(args.visRaw, args.visUnit), 1),
    precip_in: round(args.precip, 2),
    cloud_cover_pct: round(args.cloud),
    is_day: args.isDay,
    lighting: lightingFromObservation(args.isDay, args.atMs),
    observed_at: args.observedAt,
    source: args.source,
    lat: args.lat,
    lng: args.lng,
    captured_at: new Date().toISOString(),
  };
}

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  precipitation?: number;
  weather_code?: number;
  cloud_cover?: number;
  visibility?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  is_day?: number;
}

interface OpenMeteoHourly {
  time?: string[];
  temperature_2m?: Array<number | null>;
  apparent_temperature?: Array<number | null>;
  relative_humidity_2m?: Array<number | null>;
  precipitation?: Array<number | null>;
  weather_code?: Array<number | null>;
  cloud_cover?: Array<number | null>;
  visibility?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
  is_day?: Array<number | null>;
}

const UNIT_QS =
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=UTC';

export async function fetchCfsWeather(opts: {
  lat: number;
  lng: number;
  at?: string | number | Date | null;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CfsWeatherSnapshot | null> {
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const atMs = parseWeatherAtMs(opts.at);
  const nowMs = opts.nowMs ?? Date.now();
  const live = isLiveWeatherWindow(atMs, nowMs);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3500;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    if (live) {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&current=${CURRENT_FIELDS}${UNIT_QS}`;
      const resp = await fetchImpl(url, { signal: ac.signal });
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        current?: OpenMeteoCurrent;
        current_units?: { visibility?: string };
      };
      const c = data.current ?? {};
      return snapshotFromParts({
        temp: c.temperature_2m ?? null,
        feels: c.apparent_temperature ?? null,
        humidity: c.relative_humidity_2m ?? null,
        precip: c.precipitation ?? null,
        code: c.weather_code ?? null,
        cloud: c.cloud_cover ?? null,
        visRaw: c.visibility ?? null,
        visUnit: data.current_units?.visibility,
        wind: c.wind_speed_10m ?? null,
        gust: c.wind_gusts_10m ?? null,
        dirDeg: c.wind_direction_10m ?? null,
        isDay: c.is_day == null ? null : c.is_day === 1,
        observedAt: c.time ?? null,
        source: 'live',
        lat,
        lng,
        atMs: atMs ?? nowMs,
      });
    }

    const day = ymdUtc(atMs!);
    const ageDays = (nowMs - atMs!) / 86_400_000;
    const base =
      ageDays > 15
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';
    const url =
      `${base}?latitude=${lat}&longitude=${lng}` +
      `&hourly=${HOURLY_FIELDS}&start_date=${day}&end_date=${day}${UNIT_QS}`;
    const resp = await fetchImpl(url, { signal: ac.signal });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      hourly?: OpenMeteoHourly;
      hourly_units?: { visibility?: string };
    };
    const h = data.hourly ?? {};
    const times = h.time ?? [];
    const idx = pickNearestHourIndex(times, atMs!);
    if (idx < 0) return null;
    const isDayRaw = numAt(h.is_day as Array<number | null> | undefined, idx);
    return snapshotFromParts({
      temp: numAt(h.temperature_2m, idx),
      feels: numAt(h.apparent_temperature, idx),
      humidity: numAt(h.relative_humidity_2m, idx),
      precip: numAt(h.precipitation, idx),
      code: numAt(h.weather_code, idx),
      cloud: numAt(h.cloud_cover, idx),
      visRaw: numAt(h.visibility, idx),
      visUnit: data.hourly_units?.visibility,
      wind: numAt(h.wind_speed_10m, idx),
      gust: numAt(h.wind_gusts_10m, idx),
      dirDeg: numAt(h.wind_direction_10m, idx),
      isDay: isDayRaw == null ? null : isDayRaw === 1,
      observedAt: times[idx] ?? null,
      source: 'historical',
      lat,
      lng,
      atMs,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isHazardousSnapshot(snap: CfsWeatherSnapshot | null | undefined): boolean {
  if (!snap) return false;
  if (isHazardousCode(snap.weather_code)) return true;
  if ((snap.wind_gust_mph ?? 0) >= 40) return true;
  if ((snap.visibility_mi ?? 99) <= 1) return true;
  return false;
}

export function parseWeatherSnapshot(raw: unknown): CfsWeatherSnapshot | null {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const o = raw as CfsWeatherSnapshot;
    if (o.scene_category || o.temp_f != null || o.condition) return o;
    return null;
  }
  if (typeof raw !== 'string') return null;
  try {
    return parseWeatherSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function formatWeatherWind(snap: CfsWeatherSnapshot | null | undefined): string {
  if (!snap || snap.wind_mph == null) return '';
  const dir = snap.wind_dir ? ` ${snap.wind_dir}` : '';
  const gust = snap.wind_gust_mph != null && snap.wind_gust_mph > snap.wind_mph
    ? ` G${Math.round(snap.wind_gust_mph)}`
    : '';
  return `${Math.round(snap.wind_mph)} mph${dir}${gust}`;
}
