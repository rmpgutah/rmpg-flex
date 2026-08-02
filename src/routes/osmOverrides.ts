// ============================================================
// RMPG Flex — OSM feature overrides (internal edit layer)
// ============================================================
// The OSM overlays come from immutable PMTiles archives in R2, so a feature
// cannot be edited in place — and any edit written into an archive would be
// destroyed by the next extract rebuild. This route stores RMPG's corrections
// separately, keyed by the OpenStreetMap element id (`n83099358`), which is
// stable across rebuilds. The client joins them over the tile data at render.
//
// An override never destroys the underlying OSM observation: `hidden`
// suppresses rendering, `field_overrides` is merged OVER the tags at display
// time, and the original values stay in the tiles. This is an authoritative
// records system — provenance has to survive the edit.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { log } from '../utils/logger';
import { queryInChunks } from '../utils/db';

const osmOverrides = new Hono<Env>();

/** OSM element ids are a type letter followed by digits: n/w/r + id. */
const OSM_ID_RE = /^[nwr]\d{1,19}$/;

/** Roles that may only read. Mirrors the app-wide read-only convention. */
const READ_ONLY_ROLES = new Set(['client_viewer']);

interface OverrideRow {
  osm_id: string;
  osm_group: string;
  osm_cat: string | null;
  note: string | null;
  field_overrides: string | null;
  hidden: number;
  verified: number;
  verified_at: string | null;
  verified_by: number | null;
  updated_at: string;
}

/** Shape sent to the client. field_overrides is parsed so the client never has
 *  to JSON.parse a column, and a corrupt value degrades to {} rather than
 *  throwing inside a render path. */
function toApi(r: OverrideRow) {
  let fields: Record<string, unknown> = {};
  if (r.field_overrides) {
    try {
      const parsed = JSON.parse(r.field_overrides);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fields = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed row must not break the map. Logged, not thrown.
      log.warn('osm override has unparseable field_overrides', { osmId: r.osm_id });
    }
  }
  return {
    osm_id: r.osm_id,
    group: r.osm_group,
    cat: r.osm_cat,
    note: r.note,
    fields,
    hidden: r.hidden === 1,
    verified: r.verified === 1,
    verified_at: r.verified_at,
    updated_at: r.updated_at,
  };
}

// ── GET /api/osm-overrides?groups=safety,surveillance ──
// The client fetches only the groups it has toggled on.
osmOverrides.get('/', async (c) => {
  const groupsParam = (c.req.query('groups') || '').trim();
  try {
    if (!groupsParam) {
      const res = await c.env.DB.prepare(
        `SELECT osm_id, osm_group, osm_cat, note, field_overrides, hidden,
                verified, verified_at, verified_by, updated_at
           FROM osm_feature_overrides`,
      ).all<OverrideRow>();
      return c.json({ overrides: (res.results || []).map(toApi) });
    }

    const groups = groupsParam.split(',').map((g) => g.trim()).filter(Boolean);
    if (groups.length === 0) return c.json({ overrides: [] });

    // D1 rejects >100 bound parameters AT BIND TIME. The group list is
    // caller-supplied, so the query shape grows with the input — exactly the
    // case that passes every test and then fails on real data. queryInChunks
    // owns the cap.
    const rows = await queryInChunks<OverrideRow>(
      c.env.DB,
      groups,
      (placeholders) =>
        `SELECT osm_id, osm_group, osm_cat, note, field_overrides, hidden,
                verified, verified_at, verified_by, updated_at
           FROM osm_feature_overrides
          WHERE osm_group IN (${placeholders})`,
    );
    return c.json({ overrides: rows.map(toApi) });
  } catch (err) {
    log.error('GET /api/osm-overrides failed', { groupsParam }, err);
    return c.json({ error: 'Failed to load overrides' }, 500);
  }
});

// ── GET /api/osm-overrides/:osmId ──
osmOverrides.get('/:osmId', async (c) => {
  const osmId = c.req.param('osmId');
  if (!OSM_ID_RE.test(osmId)) return c.json({ error: 'bad osm_id' }, 400);
  try {
    const row = await c.env.DB.prepare(
      `SELECT osm_id, osm_group, osm_cat, note, field_overrides, hidden,
              verified, verified_at, verified_by, updated_at
         FROM osm_feature_overrides WHERE osm_id = ?`,
    ).bind(osmId).first<OverrideRow>();
    if (!row) return c.json({ override: null });
    return c.json({ override: toApi(row) });
  } catch (err) {
    log.error('GET /api/osm-overrides/:osmId failed', { osmId }, err);
    return c.json({ error: 'Failed to load override' }, 500);
  }
});

// ── PUT /api/osm-overrides/:osmId ──
// Upsert. Idempotent on osm_id, which carries a UNIQUE index — without the
// upsert target, repeated edits would stack duplicate rows and the client
// would pick one at random.
osmOverrides.put('/:osmId', async (c) => {
  const user = c.get('user') as { id?: number; role?: string } | undefined;
  if (READ_ONLY_ROLES.has(String(user?.role ?? ''))) {
    return c.json({ error: 'read-only role may not edit map features' }, 403);
  }

  const osmId = c.req.param('osmId');
  if (!OSM_ID_RE.test(osmId)) return c.json({ error: 'bad osm_id' }, 400);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const group = String(body.group ?? '').trim();
  if (!group) return c.json({ error: 'group is required' }, 400);
  const cat = body.cat === undefined || body.cat === null ? null : String(body.cat).trim() || null;

  const note = body.note === undefined || body.note === null ? null : String(body.note);
  if (note !== null && note.length > 4000) {
    return c.json({ error: 'note exceeds 4000 characters' }, 400);
  }

  // field_overrides must be a flat JSON object. Rejecting arrays/nested values
  // here keeps the display-time merge a simple key/value overlay and stops a
  // caller from storing something the renderer cannot show.
  let fieldOverrides: string | null = null;
  if (body.fields !== undefined && body.fields !== null) {
    const f = body.fields;
    if (typeof f !== 'object' || Array.isArray(f)) {
      return c.json({ error: 'fields must be a JSON object' }, 400);
    }
    const entries = Object.entries(f as Record<string, unknown>);
    if (entries.length > 60) return c.json({ error: 'too many field overrides' }, 400);
    for (const [k, v] of entries) {
      if (v !== null && typeof v === 'object') {
        return c.json({ error: `field "${k}" must be a scalar` }, 400);
      }
    }
    fieldOverrides = JSON.stringify(Object.fromEntries(entries.map(([k, v]) => [k, v === null ? null : String(v)])));
  }

  const hidden = body.hidden === true ? 1 : 0;
  const verified = body.verified === true ? 1 : 0;
  const userId = typeof user?.id === 'number' ? user.id : null;

  try {
    await c.env.DB.prepare(
      `INSERT INTO osm_feature_overrides
         (osm_id, osm_group, osm_cat, note, field_overrides, hidden,
          verified, verified_at, verified_by, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') END, CASE WHEN ? = 1 THEN ? END, ?, ?)
       ON CONFLICT(osm_id) DO UPDATE SET
         osm_group       = excluded.osm_group,
         osm_cat         = excluded.osm_cat,
         note            = excluded.note,
         field_overrides = excluded.field_overrides,
         hidden          = excluded.hidden,
         verified        = excluded.verified,
         -- Preserve the ORIGINAL verification stamp when the row is still
         -- verified; only re-stamp on a transition from unverified.
         verified_at     = CASE WHEN excluded.verified = 1
                                THEN COALESCE(osm_feature_overrides.verified_at, datetime('now'))
                                ELSE NULL END,
         verified_by     = CASE WHEN excluded.verified = 1
                                THEN COALESCE(osm_feature_overrides.verified_by, excluded.verified_by)
                                ELSE NULL END,
         updated_by      = excluded.updated_by,
         updated_at      = datetime('now')`,
    ).bind(
      osmId, group, cat, note, fieldOverrides, hidden,
      verified, verified, verified, userId, userId, userId,
    ).run();

    const row = await c.env.DB.prepare(
      `SELECT osm_id, osm_group, osm_cat, note, field_overrides, hidden,
              verified, verified_at, verified_by, updated_at
         FROM osm_feature_overrides WHERE osm_id = ?`,
    ).bind(osmId).first<OverrideRow>();
    return c.json({ override: row ? toApi(row) : null });
  } catch (err) {
    log.error('PUT /api/osm-overrides/:osmId failed', { osmId, group }, err);
    return c.json({ error: 'Failed to save override' }, 500);
  }
});

// ── DELETE /api/osm-overrides/:osmId ──
// Removes RMPG's override, restoring the feature to plain OSM data. The OSM
// feature itself is untouched — it lives in the archive, not here.
osmOverrides.delete('/:osmId', async (c) => {
  const user = c.get('user') as { role?: string } | undefined;
  if (READ_ONLY_ROLES.has(String(user?.role ?? ''))) {
    return c.json({ error: 'read-only role may not edit map features' }, 403);
  }
  const osmId = c.req.param('osmId');
  if (!OSM_ID_RE.test(osmId)) return c.json({ error: 'bad osm_id' }, 400);
  try {
    const res = await c.env.DB.prepare(
      'DELETE FROM osm_feature_overrides WHERE osm_id = ?',
    ).bind(osmId).run();
    return c.json({ success: true, deleted: res.meta?.changes ?? 0 });
  } catch (err) {
    log.error('DELETE /api/osm-overrides/:osmId failed', { osmId }, err);
    return c.json({ error: 'Failed to delete override' }, 500);
  }
});

export default osmOverrides;
