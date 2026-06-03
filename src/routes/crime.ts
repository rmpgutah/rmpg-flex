import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

// ============================================================
// Crime data layers (for the NAVIGATE tactical map)
//
// Two sources, both normalized to the same CrimeIncident shape so the client
// can merge them into one Mapbox source:
//
//   /slc   — Salt Lake City PD public crime data. ArcGIS hosted feature
//            service "PublicCrime_At_Intersections" (crimes snapped to the
//            nearest intersection, past 5 years, refreshed ~weekly). The
//            service has NO CORS header, so the browser can't hit it directly —
//            we proxy here and cache in KV. Geometry is projected State Plane;
//            we ask ArcGIS to reproject to WGS84 with outSR=4326.
//
//   /local — our OWN dispatched events (calls_for_service) over the same
//            window, so the officer sees RMPG activity alongside city crime.
// ============================================================

const crime = new Hono<Env>();

const SLC_CRIME_URL =
  'https://maps.slc.gov/server/rest/services/Hosted/PublicCrime_At_Intersections/FeatureServer/0/query';
// 6h — the upstream refreshes ~weekly, so 6h is plenty fresh and keeps us well
// under any rate limits while a fleet of MDTs hammers the endpoint.
const SLC_CACHE_TTL = 6 * 60 * 60;

interface CrimeIncident {
  id: string;
  source: 'slc' | 'local';
  category: string; // coarse bucket: Property / Person / Society (SLC) or priority (local)
  label: string;    // specific crime / incident type
  date: string | null;
  lat: number;
  lng: number;
  area?: string | null;
}

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

// GET /api/crime/slc?days=60&limit=1500 — cached SLCPD public crime incidents.
crime.get('/slc', async (c) => {
  const days = clampInt(c.req.query('days'), 60, 1, 365);
  const limit = clampInt(c.req.query('limit'), 1500, 50, 2000);
  const cacheKey = `crime:slc:d${days}:l${limit}`;

  const cached = await c.env.KV.get(cacheKey).catch(() => null);
  if (cached) {
    return new Response(cached, { headers: { 'content-type': 'application/json', 'x-cache': 'HIT' } });
  }

  // occur_dt is an ArcGIS Date field — filter with a SQL-92 timestamp literal.
  const cutoff = new Date(Date.now() - days * 86400000);
  const ts = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')} 00:00:00`;
  const params = new URLSearchParams({
    where: `occur_dt >= timestamp '${ts}'`,
    outFields: 'case_nbr,occur_dt,date_t,crime_type,crime,division,com_council',
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'occur_dt DESC',
    resultRecordCount: String(limit),
    f: 'geojson',
  });

  try {
    const r = await fetch(`${SLC_CRIME_URL}?${params.toString()}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return c.json({ source: 'slc', incidents: [], error: `upstream ${r.status}` });
    const gj = (await r.json()) as any;
    const incidents: CrimeIncident[] = (gj?.features || [])
      .map((f: any): CrimeIncident | null => {
        const co = f?.geometry?.coordinates;
        if (!Array.isArray(co) || !Number.isFinite(co[0]) || !Number.isFinite(co[1])) return null;
        const p = f.properties || {};
        return {
          id: `slc:${p.case_nbr ?? `${co[0]},${co[1]}`}`,
          source: 'slc',
          category: p.crime_type || 'Crime',
          label: p.crime || p.crime_type || 'Incident',
          date: p.date_t || null,
          lat: co[1],
          lng: co[0],
          area: p.com_council || p.division || null,
        };
      })
      .filter((x: CrimeIncident | null): x is CrimeIncident => x !== null);

    const payload = JSON.stringify({ source: 'slc', count: incidents.length, incidents, cachedAt: new Date().toISOString() });
    await c.env.KV.put(cacheKey, payload, { expirationTtl: SLC_CACHE_TTL }).catch(() => {});
    return new Response(payload, { headers: { 'content-type': 'application/json', 'x-cache': 'MISS' } });
  } catch {
    // Never break the map — an upstream hiccup just yields an empty SLC layer.
    return c.json({ source: 'slc', incidents: [], error: 'fetch failed' });
  }
});

// GET /api/crime/local?days=60&limit=1000 — our own recent dispatched events.
crime.get('/local', async (c) => {
  const days = clampInt(c.req.query('days'), 60, 1, 365);
  const limit = clampInt(c.req.query('limit'), 1000, 50, 2000);
  try {
    const db = getDb(c.env);
    const rows = await query<any>(
      db,
      `SELECT call_number, incident_type, priority, latitude, longitude, created_at
         FROM calls_for_service
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND created_at >= datetime('now', ?)
        ORDER BY created_at DESC
        LIMIT ?`,
      `-${days} days`,
      limit,
    );
    const incidents: CrimeIncident[] = (rows || [])
      .map((r: any): CrimeIncident | null => {
        const lat = Number(r.latitude);
        const lng = Number(r.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: `local:${r.call_number}`,
          source: 'local',
          category: r.priority || 'CFS',
          label: String(r.incident_type || 'call').replace(/_/g, ' '),
          date: r.created_at || null,
          lat,
          lng,
        };
      })
      .filter((x: CrimeIncident | null): x is CrimeIncident => x !== null);
    return c.json({ source: 'local', count: incidents.length, incidents });
  } catch {
    return c.json({ source: 'local', incidents: [], error: 'query failed' });
  }
});

export default crime;
