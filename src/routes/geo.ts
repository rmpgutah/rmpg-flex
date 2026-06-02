import { Hono } from 'hono';
import type { Env } from '../types';

// ============================================================
// RMPG Flex — Geo address service (statewide UGRC address points)
// ============================================================
// Backed by the dedicated GEO_DB (rmpg-geo) D1: ~1.48M Utah address
// points with an FTS5 index for text search and a (lat,lng) index for
// nearest-point lookup. Powers the map address search box and the
// "snap to nearest address" used by What's-Here / location picks.
//
// Public, read-only. Guards on GEO_DB so contexts without the binding
// degrade to empty results instead of throwing.
// ============================================================

const geo = new Hono<Env>();

// Build a safe FTS5 prefix query: split on non-alphanumerics, append '*' to
// each token, AND them together. Tokens are alphanumeric so they can't break
// the MATCH grammar.
function ftsQuery(q: string): string | null {
  const tokens = (q.toLowerCase().match(/[a-z0-9]+/g) || []).slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(' AND ');
}

// GET /api/geo/address-search?q=...&limit=8
geo.get('/address-search', async (c) => {
  const db = c.env.GEO_DB;
  if (!db) return c.json({ results: [] });
  const q = (c.req.query('q') || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(c.req.query('limit') || '8', 10) || 8));
  const match = ftsQuery(q);
  if (!match) return c.json({ results: [] });
  try {
    const rows = await db
      .prepare(
        `SELECT a.full_add, a.city, a.zip, a.county, a.lat, a.lng
         FROM addresses a JOIN addresses_fts f ON f.rowid = a.id
         WHERE addresses_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .bind(match, limit)
      .all();
    return c.json({ results: rows.results || [] });
  } catch (err) {
    console.error('address-search error:', err);
    return c.json({ results: [], error: 'search failed' }, 200);
  }
});

// GET /api/geo/address-nearest?lat=..&lng=..&limit=1
// Tight bbox first (fast via the (lat,lng) index), widening if empty.
geo.get('/address-nearest', async (c) => {
  const db = c.env.GEO_DB;
  if (!db) return c.json({ results: [] });
  const lat = parseFloat(c.req.query('lat') || '');
  const lng = parseFloat(c.req.query('lng') || '');
  const limit = Math.min(10, Math.max(1, parseInt(c.req.query('limit') || '1', 10) || 1));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ results: [] });

  const sql = `SELECT full_add, city, zip, county, lat, lng,
      ((lat-?1)*(lat-?1)+(lng-?2)*(lng-?2)) AS d2
    FROM addresses
    WHERE lat BETWEEN ?3 AND ?4 AND lng BETWEEN ?5 AND ?6
    ORDER BY d2 LIMIT ?7`;

  try {
    for (const half of [0.004, 0.02, 0.08]) {
      const rows = await db
        .prepare(sql)
        .bind(lat, lng, lat - half, lat + half, lng - half, lng + half, limit)
        .all();
      const results = (rows.results || []) as any[];
      if (results.length) {
        // approx meters from squared-degree distance at this latitude
        const mPerDegLat = 111320;
        const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
        for (const r of results) {
          const dLat = (r.lat - lat) * mPerDegLat;
          const dLng = (r.lng - lng) * mPerDegLng;
          r.distance_m = Math.round(Math.sqrt(dLat * dLat + dLng * dLng));
          delete r.d2;
        }
        return c.json({ results });
      }
    }
    return c.json({ results: [] });
  } catch (err) {
    console.error('address-nearest error:', err);
    return c.json({ results: [], error: 'nearest failed' }, 200);
  }
});

export default geo;
