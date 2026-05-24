/**
 * Incident supplements — DV lethality + pursuit reports.
 *
 * One supplement of each type per incident (UNIQUE on incident_id).
 *
 * GET    /api/incidents/:id/supplements/dv
 * POST   /api/incidents/:id/supplements/dv      — upsert (creates or replaces)
 * PUT    /api/incidents/:id/supplements/dv      — partial update
 * DELETE /api/incidents/:id/supplements/dv      — admin only
 * (same shape for /pursuit)
 *
 * Write access: dispatcher + officer + supervisor + manager + admin
 * (decided 2026-05-24 — dispatchers transcribe initial DV lethality
 *  over the phone and capture pursuit info from radio in real time).
 */
import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { paramStr } from '../utils/reqHelpers';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken);

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const READ_ROLES  = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// Allowed columns per supplement type — anything not on this list is dropped.
const DV_COLS = [
  'relationship', 'living_situation', 'victim_age', 'suspect_age',
  'children_present', 'children_count',
  'weapon_threatened', 'weapon_type', 'strangulation',
  'threats_to_kill', 'controls_daily_activities', 'jealousy',
  'prior_dv_history', 'prior_dv_calls',
  'protective_order_active', 'protective_order_violations',
  'lethality_score', 'lethality_high_danger',
  'hotline_referral', 'shelter_referral', 'notes',
] as const;

const PURSUIT_COLS = [
  'pursuit_initiated_at', 'pursuit_terminated_at',
  'initiating_offense', 'offense_classification', 'pursuit_outcome', 'termination_reason',
  'pursuing_units', 'primary_unit_id', 'supervisor_id',
  'supervisor_authorized', 'supervisor_terminated',
  'max_speed_mph', 'total_distance_miles', 'total_duration_seconds',
  'jurisdictions_crossed', 'weather_conditions', 'road_conditions',
  'traffic_density', 'time_of_day', 'tactics_used',
  'stop_sticks_deployed', 'pit_maneuver_attempted', 'pit_maneuver_successful',
  'roadblock_used', 'ramming_used',
  'injuries_officer', 'injuries_suspect', 'injuries_bystander',
  'fatalities', 'vehicle_damage_estimate', 'property_damage_estimate',
  'suspect_apprehended', 'use_of_force',
  'review_status', 'reviewer_id', 'reviewed_at', 'narrative',
] as const;

type SupplementKind = 'dv' | 'pursuit';

const TABLE: Record<SupplementKind, string> = {
  dv: 'incident_dv_supplements',
  pursuit: 'incident_pursuit_supplements',
};

const COLS: Record<SupplementKind, readonly string[]> = {
  dv: DV_COLS,
  pursuit: PURSUIT_COLS,
};

function ensureIncident(req: Request, res: Response): number | null {
  const id = Number(paramStr(req.params.id));
  if (!id) { res.status(400).json({ error: 'Invalid incident id', code: 'INVALID_ID' }); return null; }
  const inc = getDb().prepare('SELECT id FROM incidents WHERE id = ?').get(id);
  if (!inc) { res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' }); return null; }
  return id;
}

function projectBody(body: any, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of allowed) if (k in body) out[k] = body[k];
  return out;
}

function buildRoutes(kind: SupplementKind, urlSuffix: string) {
  const table = TABLE[kind];
  const cols = COLS[kind];

  router.get(`/:id/supplements/${urlSuffix}`, requireRole(...READ_ROLES), (req: Request, res: Response) => {
    try {
      const id = ensureIncident(req, res);
      if (!id) return;
      const row = getDb().prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(id);
      if (!row) { res.status(404).json({ error: `No ${kind} supplement attached`, code: 'SUPPLEMENT_NOT_FOUND' }); return; }
      res.json(row);
    } catch (err: any) {
      logger.error({ err, kind }, 'supplement get failed');
      res.status(500).json({ error: 'Failed to fetch supplement', code: 'SUPPLEMENT_GET_ERROR' });
    }
  });

  router.post(`/:id/supplements/${urlSuffix}`, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
    try {
      const id = ensureIncident(req, res);
      if (!id) return;
      const db = getDb();
      const data = projectBody(req.body, cols);
      const keys = Object.keys(data);
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map((k) => data[k]);

      const existing = db.prepare(`SELECT id FROM ${table} WHERE incident_id = ?`).get(id) as { id: number } | undefined;
      if (existing) {
        if (keys.length > 0) {
          const setClause = keys.map((k) => `${k} = ?`).join(', ');
          db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = datetime('now','localtime') WHERE incident_id = ?`).run(...values, id);
        }
        auditLog(req, 'UPDATE', `${table}`, existing.id, null, data);
        res.json({ success: true, id: existing.id, action: 'updated' });
        return;
      }

      const ins = db.prepare(`
        INSERT INTO ${table} (incident_id, ${keys.join(', ')}, created_by)
        VALUES (?, ${placeholders}, ?)
      `).run(id, ...values, req.user!.userId);
      auditLog(req, 'CREATE', `${table}`, Number(ins.lastInsertRowid), null, data);
      res.json({ success: true, id: ins.lastInsertRowid, action: 'created' });
    } catch (err: any) {
      logger.error({ err, kind }, 'supplement upsert failed');
      res.status(500).json({ error: 'Failed to save supplement', code: 'SUPPLEMENT_SAVE_ERROR' });
    }
  });

  router.put(`/:id/supplements/${urlSuffix}`, requireRole(...WRITE_ROLES), (req: Request, res: Response) => {
    try {
      const id = ensureIncident(req, res);
      if (!id) return;
      const db = getDb();
      const data = projectBody(req.body, cols);
      const keys = Object.keys(data);
      if (keys.length === 0) { res.status(400).json({ error: 'No updatable fields supplied', code: 'NO_FIELDS' }); return; }
      const existing = db.prepare(`SELECT id FROM ${table} WHERE incident_id = ?`).get(id) as { id: number } | undefined;
      if (!existing) { res.status(404).json({ error: `No ${kind} supplement to update; POST first`, code: 'SUPPLEMENT_NOT_FOUND' }); return; }
      const setClause = keys.map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...keys.map((k) => data[k]), existing.id);
      auditLog(req, 'UPDATE', table, existing.id, null, data);
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err, kind }, 'supplement update failed');
      res.status(500).json({ error: 'Failed to update supplement', code: 'SUPPLEMENT_UPDATE_ERROR' });
    }
  });

  router.delete(`/:id/supplements/${urlSuffix}`, requireRole('admin'), (req: Request, res: Response) => {
    try {
      const id = ensureIncident(req, res);
      if (!id) return;
      const db = getDb();
      const r = db.prepare(`DELETE FROM ${table} WHERE incident_id = ?`).run(id);
      if (r.changes === 0) { res.status(404).json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' }); return; }
      auditLog(req, 'DELETE', table, id, null, null);
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err, kind }, 'supplement delete failed');
      res.status(500).json({ error: 'Failed to delete supplement', code: 'SUPPLEMENT_DELETE_ERROR' });
    }
  });
}

buildRoutes('dv', 'dv');
buildRoutes('pursuit', 'pursuit');

export default router;
