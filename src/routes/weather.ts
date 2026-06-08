import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';

const weather = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const SLC_LAT = 40.7608;
const SLC_LNG = -111.891;
const CACHE_KEY = 'weather:current';
const CACHE_TTL_SEC = 600; // 10 minutes

weather.get('/', async (c) => {
  const kv = c.env.KV;
  if (kv) {
    const cached = await kv.get(CACHE_KEY, 'json');
    if (cached) return c.json(cached);
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${SLC_LAT}&longitude=${SLC_LNG}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FDenver`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ current: null }, 502);
  const data = await resp.json();

  if (kv) {
    c.executionCtx.waitUntil(kv.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL_SEC }));
  }

  return c.json(data);
});

export default weather;
