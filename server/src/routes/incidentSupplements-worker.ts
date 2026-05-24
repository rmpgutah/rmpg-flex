// ============================================================
// RMPG Flex — Incident Supplements (Hono / D1 port, NB-4)
// DV + Pursuit supplements. 1:1 with incidents. UPSERT semantics
// via POST or PUT to the same path.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'] as const;
const DELETE_ROLES = ['admin', 'manager', 'supervisor'] as const;

const DV_COLS = [
  'relationship', 'prior_incidents_count', 'prior_incidents_notes',
  'children_present', 'children_witnessed', 'weapons_in_home', 'weapons_in_home_notes',
  'strangulation_alleged', 'substance_abuse_alleged', 'threats_to_kill', 'threats_of_suicide',
  'lethality_score', 'lethality_questions', 'lethality_high_danger',
  'mandatory_arrest_triggered', 'victim_safety_plan_text',
  'victim_shelter_referred', 'victim_shelter_name',
  'protective_order_issued', 'protective_order_number',
  'primary_aggressor_person_id',
];
const PURSUIT_COLS = [
  'pursuit_type', 'reason', 'statute_basis',
  'started_at', 'ended_at', 'duration_seconds', 'distance_miles', 'max_speed_mph',
  'weather_conditions', 'road_conditions', 'traffic_density', 'time_of_day',
  'jurisdictions', 'agencies_assisting',
  'spike_strips_deployed', 'spike_strips_effective',
  'pit_maneuver_attempted', 'pit_maneuver_successful',
  'outcome', 'terminated_reason', 'terminated_by_supervisor_id',
  'collision_occurred', 'collision_details',
  'suspect_injuries', 'officer_injuries', 'bystander_injuries',
  'property_damage_estimate',
  'supervisory_approval_user_id', 'supervisory_approval_at',
  'review_completed', 'review_findings', 'review_completed_by', 'review_completed_at',
];

const BOOLEAN_COLS = new Set([
  'children_present', 'children_witnessed', 'weapons_in_home',
  'strangulation_alleged', 'substance_abuse_alleged', 'threats_to_kill', 'threats_of_suicide',
  'lethality_high_danger', 'mandatory_arrest_triggered',
  'victim_shelter_referred', 'protective_order_issued',
  'spike_strips_deployed', 'spike_strips_effective',
  'pit_maneuver_attempted', 'pit_maneuver_successful',
  'collision_occurred', 'review_completed',
]);
const JSON_COLS = new Set(['lethality_questions', 'jurisdictions', 'agencies_assisting']);

function coerceValue(col: string, raw: unknown): unknown {
  if (raw == null) return null;
  if (BOOLEAN_COLS.has(col)) return raw ? 1 : 0;
  if (JSON_COLS.has(col)) {
    if (typeof raw === 'string') return raw;
    try { return JSON.stringify(raw); } catch { return null; }
  }
  return raw;
}

function buildSupplementHandlers(table: 'dv_supplements' | 'pursuit_supplements', cols: string[]) {
  return {
    get: async (c: any) => {
      try {
        const db = new D1Db(c.env.DB);
        const incidentId = parseInt(c.req.param('id') || '', 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) {
          return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
        }
        const row = await db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId);
        if (!row) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
        return c.json(row);
      } catch (err) {
        console.error(`[supplements] ${table} get error`, err);
        return c.json({ error: 'Failed to fetch supplement', code: 'SUPPLEMENT_FETCH_ERR' }, 500);
      }
    },

    upsert: async (c: any) => {
      try {
        const db = new D1Db(c.env.DB);
        const user = c.get('user') as JwtPayload;
        const incidentId = parseInt(c.req.param('id') || '', 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) {
          return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
        }
        const incident = await db.prepare('SELECT id FROM incidents WHERE id = ?').get(incidentId);
        if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

        const body = await c.req.json().catch(() => ({} as any));
        const existing = await db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId) as any;
        const data: Record<string, unknown> = {};
        for (const col of cols) {
          if (col in body) data[col] = coerceValue(col, body[col]);
        }

        if (existing) {
          if (Object.keys(data).length === 0) return c.json(existing);
          const setClause = Object.keys(data).map((cn) => `${cn} = ?`).join(', ');
          const values = Object.values(data);
          await db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = ? WHERE incident_id = ?`)
            .run(...values, localNow(), incidentId);
          const after = await db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId);
          return c.json(after);
        }

        const insertCols = ['incident_id', ...Object.keys(data), 'created_by'];
        const placeholders = insertCols.map(() => '?').join(', ');
        const values = [incidentId, ...Object.values(data), user.userId];
        const result = await db.prepare(`INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders})`)
          .run(...values);
        const created = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.meta.last_row_id);
        return c.json(created, 201);
      } catch (err) {
        console.error(`[supplements] ${table} upsert error`, err);
        return c.json({ error: 'Failed to save supplement', code: 'SUPPLEMENT_SAVE_ERR' }, 500);
      }
    },

    remove: async (c: any) => {
      try {
        const db = new D1Db(c.env.DB);
        const incidentId = parseInt(c.req.param('id') || '', 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) {
          return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
        }
        const existing = await db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId);
        if (!existing) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
        await db.prepare(`DELETE FROM ${table} WHERE incident_id = ?`).run(incidentId);
        return c.json({ success: true });
      } catch (err) {
        console.error(`[supplements] ${table} delete error`, err);
        return c.json({ error: 'Failed to delete supplement', code: 'SUPPLEMENT_DEL_ERR' }, 500);
      }
    },
  };
}

export function mountIncidentSupplementsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  const dv = buildSupplementHandlers('dv_supplements', DV_COLS);
  const pursuit = buildSupplementHandlers('pursuit_supplements', PURSUIT_COLS);

  api.get('/:id/supplements/dv',       requireRole(...READ_ROLES),   dv.get);
  api.post('/:id/supplements/dv',      requireRole(...WRITE_ROLES),  dv.upsert);
  api.put('/:id/supplements/dv',       requireRole(...WRITE_ROLES),  dv.upsert);
  api.delete('/:id/supplements/dv',    requireRole(...DELETE_ROLES), dv.remove);

  api.get('/:id/supplements/pursuit',     requireRole(...READ_ROLES),   pursuit.get);
  api.post('/:id/supplements/pursuit',    requireRole(...WRITE_ROLES),  pursuit.upsert);
  api.put('/:id/supplements/pursuit',     requireRole(...WRITE_ROLES),  pursuit.upsert);
  api.delete('/:id/supplements/pursuit',  requireRole(...DELETE_ROLES), pursuit.remove);

  app.route('/api/incidents', api);
}
