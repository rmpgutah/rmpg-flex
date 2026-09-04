// ============================================================
// Dispatch — Standalone Weather Widget Endpoint
// GET /api/dispatch/weather?lat=&lng=
// ============================================================
// Uses Open-Meteo free API. Caches result in KV for 5 min.
// Returns hazard_tier: 'none'|'low'|'medium'|'high'.
//   high: visibility <0.25mi OR precip >0.5in/hr OR wind >45mph
//   medium: visibility <0.5mi OR precip >0.25in/hr OR wind >30mph
//   low: visibility <1mi OR precip >0.1in/hr OR wind >20mph
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { log } from '../../utils/logger';

const dispatchWeather = new Hono<Env>();

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    weather_code?: number;
    precipitation?: number;
    visibility?: number;
  };
  current_units?: {
    visibility?: string;
  };
}

function hazardTier(
  vis_mi: number,
  precip_in: number,
  wind_mph: number,
): 'none' | 'low' | 'medium' | 'high' {
  if (vis_mi < 0.25 || precip_in > 0.5 || wind_mph > 45) return 'high';
  if (vis_mi < 0.5 || precip_in > 0.25 || wind_mph > 30) return 'medium';
  if (vis_mi < 1.0 || precip_in > 0.1 || wind_mph > 20) return 'low';
  return 'none';
}

// WMO weather code → condition label (abbreviated)
function wmoCondition(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 9) return 'Overcast';
  if (code <= 12) return 'Mist/Fog';
  if (code <= 19) return 'Drizzle';
  if (code <= 29) return 'Rain';
  if (code <= 39) return 'Snow';
  if (code <= 49) return 'Freezing Fog';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Rain Shower';
  if (code <= 86) return 'Snow Shower';
  if (code <= 94) return 'Hail';
  return 'Thunderstorm';
}

dispatchWeather.get('/weather', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (!lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ ok: false, error: 'lat and lng are required' }, 400);
  }

  // Round to 3 decimal places for cache key (≈111m precision)
  const latR = lat.toFixed(3);
  const lngR = lng.toFixed(3);
  const cacheKey = `dispatch:weather:${latR}:${lngR}`;

  // Try KV cache first (5 min TTL)
  try {
    const cached = await c.env.KV.get(cacheKey, 'json');
    if (cached) return c.json({ ok: true, cached: true, ...(cached as object) });
  } catch {
    // KV miss or error — proceed to fetch
  }

  const url = [
    `https://api.open-meteo.com/v1/forecast`,
    `?latitude=${latR}&longitude=${lngR}`,
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,precipitation,visibility`,
    `&wind_speed_unit=mph`,
    `&temperature_unit=fahrenheit`,
    `&precipitation_unit=inch`,
    `&timezone=America%2FDenver`,
  ].join('');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  let data: OpenMeteoResponse;
  try {
    const resp = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`Open-Meteo ${resp.status}`);
    data = await resp.json() as OpenMeteoResponse;
  } catch (err) {
    clearTimeout(timer);
    log.error('[dispatch-weather] fetch failed', { lat, lng }, err as Error);
    return c.json({ ok: false, error: 'weather fetch failed' }, 503);
  }

  const cur = data.current ?? {};
  const temp_f = cur.temperature_2m ?? null;
  const wind_mph = cur.wind_speed_10m ?? 0;
  const wind_dir = cur.wind_direction_10m ?? null;
  const code = cur.weather_code ?? 0;
  const precip_inch_hr = cur.precipitation ?? 0;

  // Open-Meteo returns visibility in METERS when using metric units or FEET
  // when precipitation_unit=inch. Per the reference-open-meteo-visibility-unit
  // memory: visibility is FEET when precipitation_unit=inch. Convert FEET → miles.
  const visRaw = cur.visibility ?? null;
  const visMiles = visRaw !== null ? visRaw / 5280 : 99;

  const payload = {
    temperature_f: temp_f,
    wind_mph,
    wind_dir,
    conditions: wmoCondition(code),
    visibility_miles: Math.round(visMiles * 100) / 100,
    precip_inch_hr,
    hazard_tier: hazardTier(visMiles, precip_inch_hr, wind_mph),
  };

  // Cache for 5 minutes
  try {
    await c.env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 });
  } catch {
    // Non-fatal — continue without cache
  }

  return c.json({ ok: true, cached: false, ...payload });
});

export default dispatchWeather;
