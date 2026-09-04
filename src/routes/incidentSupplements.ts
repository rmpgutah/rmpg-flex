// ============================================================
// RMPG Flex — Incident Supplements (Hono / lean API, NB-4)
// DV + Pursuit supplement UPSERT. 1:1 with incidents.
//   GET/POST/PUT/DELETE /api/incidents/:id/supplements/dv
//   GET/POST/PUT/DELETE /api/incidents/:id/supplements/pursuit
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'];
const DELETE_ROLES = ['admin', 'manager', 'supervisor'];

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

function coerce(col: string, raw: unknown): unknown {
  if (raw == null) return null;
  if (BOOLEAN_COLS.has(col)) return raw ? 1 : 0;
  if (JSON_COLS.has(col)) return typeof raw === 'string' ? raw : JSON.stringify(raw);
  return raw;
}

// Supervisory sign-off columns on the pursuit supplement. WRITE_ROLES includes
// `officer`, and the upsert wrote any body key in PURSUIT_COLS — so an officer
// could forge supervisory approval / review completion on their OWN use-of-
// pursuit report by POSTing e.g. {"review_completed":true,
// "supervisory_approval_user_id":<self>}. These columns are writable only by a
// supervisor+; for anyone else they are silently dropped from the write.
const SUPERVISORY_COLS = new Set([
  'supervisory_approval_user_id', 'supervisory_approval_at',
  'review_completed', 'review_findings', 'review_completed_by', 'review_completed_at',
  'terminated_by_supervisor_id',
]);
const SUPERVISOR_ROLES = new Set(['admin', 'manager', 'supervisor']);

function buildHandlers(table: 'dv_supplements' | 'pursuit_supplements', cols: string[]) {
  return {
    get: async (c: any) => {
      try {
        const db = getDb(c.env);
        const incidentId = parseInt(c.req.param('id') || '', 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
        const row = await queryFirst(db, `SELECT * FROM ${table} WHERE incident_id = ?`, incidentId);
        if (!row) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
        return c.json(row);
      } catch (err) {
        log.error(`supplements \${table} get`, {}, err instanceof Error ? err : new Error(String(err)));
        return c.json({ error: 'Failed to fetch supplement', code: 'SUPPLEMENT_FETCH_ERR' }, 500);
      }
    },
    upsert: async (c: any) => {
      try {
        const db = getDb(c.env);
        const userId = c.get('userId') as number;
        const incidentId = parseInt(c.req.param('id') || '', 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
        const incident = await queryFirst(db, 'SELECT id FROM incidents WHERE id = ?', incidentId);
        if (!incident) return c.json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }, 404);

        const body = await c.req.json().catch(() => ({} as any));
        const actor = c.get('user') as { role?: string } | undefined;
        const canApprove = !!actor?.role && SUPERVISOR_ROLES.has(actor.role);
        const existing: any = await queryFirst(db, `SELECT * FROM ${table} WHERE incident_id = ?`, incidentId);
        const data: Record<string, unknown> = {};
        for (const col of cols) {
          if (!(col in body)) continue;
          // Drop supervisory sign-off columns for non-supervisors so an officer
          // can't approve/close-out their own pursuit report.
          if (SUPERVISORY_COLS.has(col) && !canApprove) continue;
          data[col] = coerce(col, body[col]);
        }

        if (existing) {
          if (Object.keys(data).length === 0) return c.json(existing);
          const setClause = Object.keys(data).map((cn) => `${cn} = ?`).join(', ');
          await execute(db, `UPDATE ${table} SET ${setClause}, updated_at = datetime('now') WHERE incident_id = ?`,
            ...Object.values(data), incidentId);
          return c.json(await queryFirst(db, `SELECT * FROM ${table} WHERE incident_id = ?`, incidentId));
        }
        const insertCols = ['incident_id', ...Object.keys(data), 'created_by'];
        const placeholders = insertCols.map(() => '?').join(', ');
        const result = await execute(db, `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders})`,
          incidentId, ...Object.values(data), userId);
        return c.json(await queryFirst(db, `SELECT * FROM ${table} WHERE id = ?`, result.meta.last_row_id), 201);
      } catch (err) {
        log.error(`supplements \${table} upsert`, {}, err instanceof Error ? err : new Error(String(err)));
        return c.json({ error: 'Failed to save supplement', code: 'SUPPLEMENT_SAVE_ERR' }, 500);
      }
    },
    remove: async (c: any) => {
      try {
        const db = getDb(c.env);
        const incidentId = parseInt(c.req.param('id') || '', 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) return c.json({ error: 'Invalid incident id', code: 'INVALID_ID' }, 400);
        const existing = await queryFirst(db, `SELECT * FROM ${table} WHERE incident_id = ?`, incidentId);
        if (!existing) return c.json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }, 404);
        await execute(db, `DELETE FROM ${table} WHERE incident_id = ?`, incidentId);
        return c.json({ success: true });
      } catch (err) {
        log.error(`supplements \${table} delete`, {}, err instanceof Error ? err : new Error(String(err)));
        return c.json({ error: 'Failed to delete supplement', code: 'SUPPLEMENT_DEL_ERR' }, 500);
      }
    },
  };
}

const incidentSupplements = new Hono<Env>();
const dv = buildHandlers('dv_supplements', DV_COLS);
const pursuit = buildHandlers('pursuit_supplements', PURSUIT_COLS);

incidentSupplements.get('/:id/supplements/dv',    requireRole(...READ_ROLES),   dv.get);
incidentSupplements.post('/:id/supplements/dv',   requireRole(...WRITE_ROLES),  dv.upsert);
incidentSupplements.put('/:id/supplements/dv',    requireRole(...WRITE_ROLES),  dv.upsert);
incidentSupplements.delete('/:id/supplements/dv', requireRole(...DELETE_ROLES), dv.remove);

incidentSupplements.get('/:id/supplements/pursuit',    requireRole(...READ_ROLES),   pursuit.get);
incidentSupplements.post('/:id/supplements/pursuit',   requireRole(...WRITE_ROLES),  pursuit.upsert);
incidentSupplements.put('/:id/supplements/pursuit',    requireRole(...WRITE_ROLES),  pursuit.upsert);
incidentSupplements.delete('/:id/supplements/pursuit', requireRole(...DELETE_ROLES), pursuit.remove);

export default incidentSupplements;
