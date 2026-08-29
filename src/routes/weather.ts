import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { describeWeatherCode, degreesToCompass, isHazardousCode } from '../utils/weatherCodes';
import { log } from '../utils/logger';
import {
  fetchActiveAlerts,
  fetchZonesBounded,
  zoneUrlFromKey,
  type NwsAlert,
  type NwsZoneGeometry,
} from '../utils/nwsAlerts';

const weather = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// RMPG base (downtown SLC) — used when the caller supplies no coordinates.
const SLC_LAT = 40.7608;
const SLC_LNG = -111.891;
const CACHE_TTL_SEC = 600; // 10 minutes

// Coordinates are rounded to ~1 km before they become part of the cache key.
// Without this, a map click at 40.643393 and one at 40.643394 are separate KV
// entries, so a busy map would fill the namespace with near-duplicate rows and
// never hit cache. 2 decimal places ~= 1.1 km, well inside a weather cell.
const CACHE_PRECISION = 2;

function cacheKey(lat: number, lng: number): string {
  return `weather:v2:${lat.toFixed(CACHE_PRECISION)},${lng.toFixed(CACHE_PRECISION)}`;
}

/**
 * Parse a caller-supplied coordinate. Returns null for absent/NaN/out-of-range
 * input so the handler can fall back to base rather than forwarding garbage to
 * Open-Meteo (which answers 400 and would surface as a bare 502 to the map).
 */
function parseCoord(raw: string | undefined, max: number): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'dew_point_2m',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'is_day',
].join(',');

interface OpenMeteoCurrent {
  time?: string;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  dew_point_2m?: number;
  precipitation?: number;
  weather_code?: number;
  cloud_cover?: number;
  pressure_msl?: number;
  visibility?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  is_day?: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
  current_units?: Record<string, string>;
  daily?: { sunrise?: string[]; sunset?: string[] };
  timezone?: string;
  elevation?: number;
}

/**
 * Visibility → miles.
 *
 * ⚠️ Open-Meteo's visibility UNIT depends on the request's `precipitation_unit`:
 * with `inch` it answers FEET, with the default metric it answers METRES. There
 * is no `visibility_unit` param to pin it. Verified live 2026-08-02 — the
 * response carried `current_units.visibility: "ft"`.
 *
 * Reading the declared unit off the response (rather than hardcoding the one
 * that matches today's query string) keeps this correct if the unit params are
 * ever changed. Getting it wrong is not cosmetic: dividing feet by 1609 turns a
 * 0.2 mi whiteout into 0.7 and silently defeats the low-visibility hazard tier.
 */
function visibilityToMiles(raw: number | null | undefined, unit: string | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const perMile = unit === 'm' ? 1609.344 : 5280; // default to ft — our query asks for imperial
  return raw / perMile;
}

export type HazardLevel = 'none' | 'advisory' | 'warning';

export interface WeatherHazard {
  level: HazardLevel;
  reasons: string[];
}

// Derived scene-safety thresholds. These are operational defaults aligned with
// NWS advisory criteria rather than invented numbers; every one is named so a
// policy change is a single edit.
const GUST_WARNING_MPH = 58;   // NWS severe-thunderstorm wind criterion
const GUST_ADVISORY_MPH = 40;  // NWS wind advisory
const VIS_WARNING_MI = 0.25;   // dense fog / whiteout
const VIS_ADVISORY_MI = 1;
const HEAT_ADVISORY_F = 100;
const COLD_ADVISORY_F = 0;

/**
 * Derive a CAD-facing scene-safety summary from the current observation.
 * `warning` means "tell the officer before they get out of the car";
 * `advisory` means "worth noting on the call".
 */
function deriveHazard(n: {
  weather_code: number | null;
  wind_gust_mph: number | null;
  visibility_mi: number | null;
  temp_f: number | null;
  feels_like_f: number | null;
}): WeatherHazard {
  const reasons: string[] = [];
  let level: HazardLevel = 'none';
  const raise = (next: HazardLevel) => {
    if (next === 'warning' || (next === 'advisory' && level === 'none')) level = next;
  };

  if (n.wind_gust_mph != null) {
    if (n.wind_gust_mph >= GUST_WARNING_MPH) {
      reasons.push(`Damaging wind gusts ${Math.round(n.wind_gust_mph)} mph`);
      raise('warning');
    } else if (n.wind_gust_mph >= GUST_ADVISORY_MPH) {
      reasons.push(`Wind gusts ${Math.round(n.wind_gust_mph)} mph`);
      raise('advisory');
    }
  }

  if (n.visibility_mi != null) {
    if (n.visibility_mi <= VIS_WARNING_MI) {
      reasons.push(`Visibility ${n.visibility_mi.toFixed(2)} mi`);
      raise('warning');
    } else if (n.visibility_mi <= VIS_ADVISORY_MI) {
      reasons.push(`Reduced visibility ${n.visibility_mi.toFixed(1)} mi`);
      raise('advisory');
    }
  }

  if (isHazardousCode(n.weather_code)) {
    reasons.push(describeWeatherCode(n.weather_code));
    // Thunderstorms and freezing precipitation are the "approach carefully"
    // tier; plain snow is an advisory.
    const code = n.weather_code as number;
    raise(code >= 95 || (code >= 56 && code <= 57) || (code >= 66 && code <= 67) ? 'warning' : 'advisory');
  }

  // Prefer apparent temperature — wind chill / heat index is what an officer
  // standing on the shoulder actually experiences.
  const felt = n.feels_like_f ?? n.temp_f;
  if (felt != null) {
    if (felt >= HEAT_ADVISORY_F) {
      reasons.push(`Extreme heat ${Math.round(felt)} F`);
      raise('advisory');
    } else if (felt <= COLD_ADVISORY_F) {
      reasons.push(`Extreme cold ${Math.round(felt)} F`);
      raise('advisory');
    }
  }

  return { level, reasons };
}

function round(v: number | null | undefined, places = 0): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * Build the normalized payload. Kept separate from the handler so it is unit
 * testable, and so the raw Open-Meteo `current` block can be forwarded intact
 * alongside it — DashboardPage.tsx still reads `current.temperature_2m`, and
 * dropping that to "clean up" the shape would be a regression.
 */
export function normalizeWeather(data: OpenMeteoResponse, lat: number, lng: number) {
  const c = data.current ?? {};
  const temp_f = round(c.temperature_2m);
  const feels_like_f = round(c.apparent_temperature);
  const weather_code = c.weather_code ?? null;
  const wind_gust_mph = round(c.wind_gusts_10m);
  const visibility_mi = round(visibilityToMiles(c.visibility, data.current_units?.visibility), 1);

  return {
    temp_f,
    feels_like_f,
    condition: describeWeatherCode(weather_code),
    weather_code,
    humidity: round(c.relative_humidity_2m),
    dew_point_f: round(c.dew_point_2m),
    wind_mph: round(c.wind_speed_10m),
    wind_gust_mph,
    wind_dir: degreesToCompass(c.wind_direction_10m),
    wind_dir_deg: round(c.wind_direction_10m),
    precip_in: round(c.precipitation, 2),
    cloud_cover_pct: round(c.cloud_cover),
    // hPa -> inHg, the unit on every US weather report.
    pressure_in: round(c.pressure_msl == null ? null : c.pressure_msl * 0.0295299830714, 2),
    visibility_mi,
    is_day: c.is_day == null ? null : c.is_day === 1,
    observed_at: c.time ?? null,
    sunrise: data.daily?.sunrise?.[0] ?? null,
    sunset: data.daily?.sunset?.[0] ?? null,
    location: {
      lat,
      lng,
      timezone: data.timezone ?? null,
      elevation_ft: round(data.elevation == null ? null : data.elevation * 3.28084),
    },
    hazard: deriveHazard({ weather_code, wind_gust_mph, visibility_mi, temp_f, feels_like_f }),
    // Raw upstream block, forwarded verbatim for back-compat.
    current: data.current ?? null,
  };
}

weather.get('/', async (c) => {
  const lat = parseCoord(c.req.query('lat'), 90) ?? SLC_LAT;
  // Accept both `lng` (Mapbox convention, used by useMapInfoPanel) and `lon`
  // (Open-Meteo convention) so neither caller has to guess.
  const lng = parseCoord(c.req.query('lng'), 180) ?? parseCoord(c.req.query('lon'), 180) ?? SLC_LNG;

  const kv = c.env.KV;
  const key = cacheKey(lat, lng);
  if (kv) {
    try {
      const cached = await kv.get(key, 'json');
      if (cached) return c.json({ ...(cached as object), cached: true });
    } catch (err) {
      // A cache read failure must not fail the request — fall through to live.
      log.warn('weather cache read failed', { key, err: String(err) });
    }
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=${CURRENT_FIELDS}&daily=sunrise,sunset&forecast_days=1` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

  let data: OpenMeteoResponse;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      log.warn('open-meteo responded non-2xx', { status: resp.status, lat, lng });
      return c.json({ current: null, error: 'weather_upstream_unavailable' }, 502);
    }
    data = (await resp.json()) as OpenMeteoResponse;
  } catch (err) {
    log.error('open-meteo fetch failed', { lat, lng }, err as Error);
    return c.json({ current: null, error: 'weather_upstream_unavailable' }, 502);
  }

  const payload = normalizeWeather(data, lat, lng);

  if (kv) {
    // Best-effort cache — don't fail the request if KV write errors.
    // Mirrors the established pattern at src/routes/geocode.ts:175-177.
    c.executionCtx.waitUntil(
      kv.put(key, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SEC }).catch(() => {}),
    );
  }

  return c.json({ ...payload, cached: false });
});

// CFS scene snapshot used by NewCallModal + dispatch timeline edits.
// `at` (optional ISO / D1 UTC timestamp) selects live vs historical hourly.
weather.get('/cfs', async (c) => {
  const lat = parseCoord(c.req.query('lat'), 90);
  const lng = parseCoord(c.req.query('lng'), 180) ?? parseCoord(c.req.query('lon'), 180);
  if (lat == null || lng == null) {
    return c.json({ ok: false, error: 'lat and lng are required' }, 400);
  }
  const { fetchCfsWeather } = await import('../utils/cfsWeather');
  const snap = await fetchCfsWeather({ lat, lng, at: c.req.query('at') ?? null });
  if (!snap) return c.json({ ok: false, error: 'weather_unavailable' }, 503);
  return c.json({ ok: true, ...snap });
});

// ── Severe-weather alerts (NWS) ─────────────────────────────
//
// Two caches with deliberately different lifetimes:
//   • the ALERT LIST changes by the minute      → 120 s
//   • ZONE POLYGONS change on NWS restructures  → 30 days
// Conflating them would either serve stale warnings or re-fetch ~36 polygons
// every couple of minutes for data that is effectively immutable.

const ALERTS_CACHE_TTL_SEC = 120;
const ZONE_CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
/** Ceiling on cold-cache zone fetches per request; the rest fill in next poll. */
const ZONE_FETCH_LIMIT = 60;
const DEFAULT_AREA = 'UT';

/** Only the NWS state/marine area codes — two uppercase letters. */
function parseArea(raw: string | undefined): string {
  if (!raw) return DEFAULT_AREA;
  const up = raw.toUpperCase();
  return /^[A-Z]{2}$/.test(up) ? up : DEFAULT_AREA;
}

function zoneCacheKey(zoneKey: string): string {
  return `nws:zone:v1:${zoneKey}`;
}

/**
 * Resolve polygons for every zone the given alerts reference, preferring KV.
 * Returns a key → geometry map; missing entries simply mean "no polygon yet",
 * which the client renders as a list-only alert rather than an error.
 */
async function resolveZones(
  kv: KVNamespace | undefined,
  alerts: NwsAlert[],
  // Structurally typed rather than `ExecutionContext` — the Workers and Hono
  // definitions of that interface diverge, and waitUntil is all we need.
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
): Promise<Record<string, NwsZoneGeometry>> {
  // Dedupe first — three Red Flag Warnings routinely share most of their
  // zones, and fetching the same polygon once per alert would triple the
  // cold-cache cost for identical data.
  const wanted = [...new Set(alerts.flatMap((a) => a.zone_ids))];
  const resolved: Record<string, NwsZoneGeometry> = {};
  const missing: string[] = [];

  if (kv) {
    const hits = await Promise.all(
      wanted.map(async (key) => {
        try {
          return [key, await kv.get(zoneCacheKey(key), 'json')] as const;
        } catch {
          return [key, null] as const;
        }
      }),
    );
    for (const [key, val] of hits) {
      if (val) resolved[key] = val as NwsZoneGeometry;
      else missing.push(key);
    }
  } else {
    missing.push(...wanted);
  }

  if (missing.length === 0) return resolved;

  const fetched = await fetchZonesBounded(missing.map(zoneUrlFromKey), { limit: ZONE_FETCH_LIMIT });
  for (const zone of fetched) {
    resolved[zone.key] = zone;
    if (kv) {
      ctx?.waitUntil(
        kv.put(zoneCacheKey(zone.key), JSON.stringify(zone), { expirationTtl: ZONE_CACHE_TTL_SEC })
          .catch(() => {}),
      );
    }
  }

  if (fetched.length < missing.length) {
    log.info('nws zones partially resolved', {
      wanted: wanted.length, missing: missing.length, fetched: fetched.length,
    });
  }
  return resolved;
}

/** Severity rank for client-side sorting — highest first. */
const SEVERITY_RANK: Record<string, number> = {
  Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0,
};

weather.get('/alerts', async (c) => {
  const area = parseArea(c.req.query('area'));
  const kv = c.env.KV;
  const listKey = `nws:alerts:v1:${area}`;

  let alerts: NwsAlert[] | null = null;
  if (kv) {
    try {
      alerts = (await kv.get(listKey, 'json')) as NwsAlert[] | null;
    } catch (err) {
      log.warn('nws alerts cache read failed', { area, err: String(err) });
    }
  }

  const fromCache = alerts != null;
  if (!alerts) {
    try {
      alerts = await fetchActiveAlerts(area);
    } catch (err) {
      log.error('nws alerts fetch failed', { area }, err as Error);
      // Degrade to an explicit empty result rather than a 500 — a weather
      // overlay outage must never break the map for a dispatcher.
      return c.json({ ok: false, code: 'nws_unavailable', alerts: [], zones: {}, area }, 200);
    }
    if (kv) {
      c.executionCtx.waitUntil(
        kv.put(listKey, JSON.stringify(alerts), { expirationTtl: ALERTS_CACHE_TTL_SEC }).catch(() => {}),
      );
    }
  }

  const zones = await resolveZones(kv, alerts, c.executionCtx);

  const sorted = [...alerts].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  );

  return c.json({
    ok: true,
    area,
    alerts: sorted,
    zones,
    counts: {
      total: sorted.length,
      with_geometry: sorted.filter(
        (a) => a.geometry != null || a.zone_ids.some((z) => zones[z]),
      ).length,
    },
    cached: fromCache,
  });
});

export default weather;
