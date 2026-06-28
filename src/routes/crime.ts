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
  source: 'slc' | 'local' | 'ccm' | 'crash';
  category: string; // coarse bucket: Property / Person / Society (SLC/ccm) or priority (local) or 'Crash'
  label: string;    // specific crime / incident type
  date: string | null;
  lat: number;
  lng: number;
  area?: string | null;  // neighborhood (com_council) / division (SLC); agency for ccm; null for local
  ref?: string | null;   // case number (SLC/ccm) or call number (local) — the DB key
  division?: string | null; // SLC police division, when distinct from area
  agency?: string | null;   // reporting agency name (ccm multi-agency; crash); null for SLC/local
  kind?: 'crime' | 'crash' | 'cfs'; // top-level layer kind (default 'crime'); drives client styling
  severity?: number | null; // crash severity (SLC scale) — null for crime
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
          ref: p.case_nbr || null,
          division: p.division || null,
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
          ref: r.call_number || null,
        };
      })
      .filter((x: CrimeIncident | null): x is CrimeIncident => x !== null);
    return c.json({ source: 'local', count: incidents.length, incidents });
  } catch {
    return c.json({ source: 'local', incidents: [], error: 'query failed' });
  }
});

// ============================================================
// /crashes — SLC traffic-crash layer (situational awareness for TRAVEL)
//
// Same ArcGIS host as /slc, the "SLC_Crash_Data" hosted layer. occ_date is an
// epoch-ms Date field (the only reliable date — date_time is mostly null), so we
// window on it. The public crash dataset lags ~2-3 months, so we default to a
// WIDE window (chronic crash hot-spots — dangerous intersections — are the point
// for a driving overlay, not just last week). descript is null in practice, so
// we synthesize a label from severity + pedestrian/bike/motorcycle involvement.
// ============================================================
const SLC_CRASH_URL =
  'https://maps.slc.gov/server/rest/services/Hosted/SLC_Crash_Data/FeatureServer/0/query';
const CRASH_CACHE_TTL = 6 * 60 * 60; // 6h — upstream refreshes far slower than this

function crashLabel(p: any): string {
  const involved: string[] = [];
  if (String(p.ped_inv) === '1') involved.push('pedestrian');
  if (String(p.bicyclist) === '1') involved.push('cyclist');
  if (String(p.motorc_inv) === '1') involved.push('motorcycle');
  if (String(p.escooter) === '1') involved.push('e-scooter');
  const sev = Number(p.severity);
  const base = sev >= 3 ? 'Serious crash' : sev >= 1 ? 'Injury crash' : 'Crash';
  return involved.length ? `${base} · ${involved.join(', ')}` : base;
}

// GET /api/crime/crashes?days=365&limit=2000 — cached SLC traffic crashes.
crime.get('/crashes', async (c) => {
  const days = clampInt(c.req.query('days'), 365, 7, 1825);
  const limit = clampInt(c.req.query('limit'), 2000, 50, 4000);
  const cacheKey = `crime:crash:d${days}:l${limit}`;

  const cached = await c.env.KV.get(cacheKey).catch(() => null);
  if (cached) {
    return new Response(cached, { headers: { 'content-type': 'application/json', 'x-cache': 'HIT' } });
  }

  const cutoff = new Date(Date.now() - days * 86400000);
  const ts = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')} 00:00:00`;
  const params = new URLSearchParams({
    where: `occ_date >= timestamp '${ts}'`,
    outFields: 'case_,occ_date,severity,descript,address,ped_inv,bicyclist,motorc_inv,escooter',
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'occ_date DESC',
    resultRecordCount: String(limit),
    f: 'geojson',
  });

  try {
    const r = await fetch(`${SLC_CRASH_URL}?${params.toString()}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return c.json({ source: 'crash', incidents: [], error: `upstream ${r.status}` });
    const gj = (await r.json()) as any;
    const incidents: CrimeIncident[] = (gj?.features || [])
      .map((f: any): CrimeIncident | null => {
        const co = f?.geometry?.coordinates;
        if (!Array.isArray(co) || !Number.isFinite(co[0]) || !Number.isFinite(co[1])) return null;
        const p = f.properties || {};
        const sev = Number(p.severity);
        return {
          id: `crash:${p.case_ ?? `${co[0]},${co[1]}`}`,
          source: 'crash',
          kind: 'crash',
          category: 'Crash',
          label: crashLabel(p),
          date: p.occ_date ? new Date(Number(p.occ_date)).toISOString() : null,
          lat: co[1],
          lng: co[0],
          area: p.address || null,
          ref: p.case_ || null,
          severity: Number.isFinite(sev) ? sev : null,
        };
      })
      .filter((x: CrimeIncident | null): x is CrimeIncident => x !== null);

    const payload = JSON.stringify({ source: 'crash', count: incidents.length, incidents, cachedAt: new Date().toISOString() });
    await c.env.KV.put(cacheKey, payload, { expirationTtl: CRASH_CACHE_TTL }).catch(() => {});
    return new Response(payload, { headers: { 'content-type': 'application/json', 'x-cache': 'MISS' } });
  } catch {
    return c.json({ source: 'crash', incidents: [], error: 'fetch failed' });
  }
});

// ============================================================
// /regional — multi-agency county crime via LexisNexis Community Crime Map.
//
// SLC PD publishes its own ArcGIS feed (see /slc). The OTHER Salt Lake County
// agencies (West Valley City, Sandy, Murray, Unified Police, Univ of Utah DPS,
// …) don't expose an official API — they only aggregate through LexisNexis
// Community Crime Map (communitycrimemap.com). This adapter pulls that feed
// server-side so /slc (city) + /regional (the rest of the county) together give
// real county-wide coverage.
//
// ⚠️ BEST-EFFORT / FRAGILE: this is an undocumented endpoint reverse-engineered
// from the public map app. It can change without notice. Everything here is
// wrapped so a failure just yields an empty layer — it must never break the map.
// Auth is a short-lived JWT (~3h) from /auth/newToken, cached in KV. The map
// query caps at 500 records, so we tile the county bbox and merge+dedupe to push
// far more points than a single call could return.
// ============================================================
const CCM_API = 'https://communitycrimemap.com/api/v1';
const CCM_TOKEN_KEY = 'crime:ccm:jwt';
const CCM_TOKEN_TTL = 2 * 60 * 60; // 2h — well under the JWT's ~3h expiry
const CCM_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  referer: 'https://communitycrimemap.com/map',
  origin: 'https://communitycrimemap.com',
};
// Salt Lake County valley envelope (WGS84). Covers SLC, WVC, Sandy, West Jordan,
// Murray, Taylorsville, Draper, Holladay, Midvale, Magna, unincorporated UPD.
const SLCO_BBOX = { west: -112.30, east: -111.55, south: 40.40, north: 40.95 };
const CCM_GRID_COLS = 4;
const CCM_GRID_ROWS = 3; // 12 tiles — each well under the 500-record cap
// The load-data body carries a per-UCR-class selection array; all-true = "every
// crime type". 180 covers the catalog with headroom.
const CCM_ALL_LAYERS = Array.from({ length: 180 }, () => ({ selected: true }));

// UCR class string → the same coarse bucket the client colors by (Person /
// Property / Society). Person checked first so "armed robbery" lands on Person.
function classifyCcm(s: string): string {
  const t = (s || '').toLowerCase();
  if (/assault|sex|rape|robber|homicide|murder|manslaughter|kidnap|family|domestic|harass|intimidat|missing|abuse|threat|weapon|firearm/.test(t)) return 'Person';
  if (/theft|larcen|burglar|shoplift|vehicle|stolen|arson|vandal|damage|trespass|fraud|forg|embezzl|counterfeit|property|robbery/.test(t)) return 'Property';
  if (/drug|narcotic|dui|alcohol|liquor|disorder|traffic|prostitut|gambl|warrant|non-criminal|all other|vice|trespassing/.test(t)) return 'Society';
  return 'Crime';
}

function mmddyyyy(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

async function ccmToken(env: Env['Bindings']): Promise<string | null> {
  const cached = await env.KV.get(CCM_TOKEN_KEY).catch(() => null);
  if (cached) return cached;
  try {
    const r = await fetch(`${CCM_API}/auth/newToken`, { headers: CCM_HEADERS });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    const jwt = j?.data?.jwt;
    if (typeof jwt !== 'string' || jwt.length < 20) return null;
    await env.KV.put(CCM_TOKEN_KEY, jwt, { expirationTtl: CCM_TOKEN_TTL }).catch(() => {});
    return jwt;
  } catch {
    return null;
  }
}

interface CcmTile { west: number; east: number; south: number; north: number; lat: number; lng: number }
function ccmTiles(): CcmTile[] {
  const out: CcmTile[] = [];
  const dx = (SLCO_BBOX.east - SLCO_BBOX.west) / CCM_GRID_COLS;
  const dy = (SLCO_BBOX.north - SLCO_BBOX.south) / CCM_GRID_ROWS;
  for (let i = 0; i < CCM_GRID_COLS; i++) {
    for (let j = 0; j < CCM_GRID_ROWS; j++) {
      const west = SLCO_BBOX.west + i * dx;
      const east = west + dx;
      const south = SLCO_BBOX.south + j * dy;
      const north = south + dy;
      out.push({ west, east, south, north, lat: (south + north) / 2, lng: (west + east) / 2 });
    }
  }
  return out;
}

async function ccmTilePins(token: string, tile: CcmTile, start: string, end: string): Promise<any[]> {
  const body = {
    buffer: { enabled: false, restrictArea: false, value: [] },
    date: { start, end },
    agencies: [],
    layers: { selection: CCM_ALL_LAYERS },
    location: { bounds: { east: tile.east, north: tile.north, south: tile.south, west: tile.west }, lat: tile.lat, lng: tile.lng, zoom: 13 },
    analyticLayers: { density: { selected: false, transparency: 60 } },
  };
  try {
    const r = await fetch(`${CCM_API}/search/load-data`, {
      method: 'POST',
      headers: { ...CCM_HEADERS, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as any;
    const pins = j?.data?.data?.pins;
    return pins && typeof pins === 'object' ? Object.values(pins) : [];
  } catch {
    return []; // one slow/failed tile shouldn't sink the whole layer
  }
}

// GET /api/crime/regional?days=30 — merged, deduped multi-agency county crime.
crime.get('/regional', async (c) => {
  const days = clampInt(c.req.query('days'), 30, 1, 120);
  const cacheKey = `crime:ccm:d${days}`;

  const cached = await c.env.KV.get(cacheKey).catch(() => null);
  if (cached) {
    return new Response(cached, { headers: { 'content-type': 'application/json', 'x-cache': 'HIT' } });
  }

  const token = await ccmToken(c.env);
  if (!token) return c.json({ source: 'ccm', incidents: [], error: 'no token' });

  const start = mmddyyyy(new Date(Date.now() - days * 86400000));
  const end = mmddyyyy(new Date());
  const tiles = ccmTiles();

  // Tiles overlap at edges, so dedupe by reference id. Run in small concurrent
  // batches to stay polite and within the Worker subrequest budget.
  const byId = new Map<string, CrimeIncident>();
  const agencies = new Set<string>();
  try {
    const BATCH = 4;
    for (let b = 0; b < tiles.length; b += BATCH) {
      const slice = tiles.slice(b, b + BATCH);
      const results = await Promise.all(slice.map((t) => ccmTilePins(token, t, start, end)));
      for (const pins of results) {
        for (const pin of pins) {
          const agency = String(pin?.Agency || '');
          if (/offender registry/i.test(agency)) continue; // people, not incidents
          let mo = pin?.EventRecord?.MOs?.MO;
          if (Array.isArray(mo)) mo = mo[0];
          if (!mo || !(mo.Crime || mo.label || mo.Class)) continue; // skip non-incident rows
          const lat = Number(pin.Latitude);
          const lng = Number(pin.Longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const ref = String(pin.ReferenceID || pin.EntityID || `${lng},${lat}`);
          const id = `ccm:${ref}`;
          if (byId.has(id)) continue;
          const label = String(mo.label || mo.Crime || mo.Class || 'Incident');
          byId.set(id, {
            id,
            source: 'ccm',
            kind: 'crime',
            category: classifyCcm(`${mo.Class || ''} ${mo.Crime || ''} ${label}`),
            label,
            date: pin.DateTime || mo.DateTime || null,
            lat,
            lng,
            area: agency || null,
            ref,
            agency: agency || null,
          });
          if (agency) agencies.add(agency);
        }
      }
    }
  } catch {
    /* partial results are fine — return whatever we gathered */
  }

  const incidents = [...byId.values()];
  const payload = JSON.stringify({
    source: 'ccm',
    count: incidents.length,
    agencies: [...agencies].sort(),
    incidents,
    cachedAt: new Date().toISOString(),
  });
  // Cache even an empty result briefly so a transient upstream block doesn't make
  // every MDT re-hammer the feed; a real result is good for 2h.
  await c.env.KV.put(cacheKey, payload, { expirationTtl: incidents.length ? 2 * 60 * 60 : 10 * 60 }).catch(() => {});
  return new Response(payload, { headers: { 'content-type': 'application/json', 'x-cache': 'MISS' } });
});

export default crime;
