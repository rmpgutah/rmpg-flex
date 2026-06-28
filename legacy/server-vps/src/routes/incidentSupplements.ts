// ============================================================
// RMPG Flex — Incident Supplement Routes (NB-4)
// DV and Pursuit supplement forms. 1:1 with incidents — at most
// one of each per incident. UPSERT semantics: POST creates, PUT
// updates, GET fetches, DELETE removes.
// Both supplements follow the same shape pattern, so this router
// uses a generic helper to keep the code small.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken);

// Whitelisted columns per supplement type. Any field not in this
// list is silently dropped — keeps the API explicit and prevents
// arbitrary column injection through req.body.
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
    get: (req: Request, res: Response) => {
      try {
        const db = getDb();
        const incidentId = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) {
          res.status(400).json({ error: 'Invalid incident id', code: 'INVALID_ID' });
          return;
        }
        const row = db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId);
        if (!row) {
          res.status(404).json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' });
          return;
        }
        res.json(row);
      } catch (err) {
        logger.error({ err, table }, '[supplements] get error');
        res.status(500).json({ error: 'Failed to fetch supplement', code: 'SUPPLEMENT_FETCH_ERR' });
      }
    },

    upsert: (req: Request, res: Response) => {
      try {
        const db = getDb();
        const incidentId = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) {
          res.status(400).json({ error: 'Invalid incident id', code: 'INVALID_ID' });
          return;
        }
        const incident = db.prepare('SELECT id FROM incidents WHERE id = ?').get(incidentId);
        if (!incident) {
          res.status(404).json({ error: 'Incident not found', code: 'INCIDENT_NOT_FOUND' });
          return;
        }

        const existing = db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId) as any;
        const data: Record<string, unknown> = {};
        for (const col of cols) {
          if (col in req.body) data[col] = coerceValue(col, req.body[col]);
        }

        if (existing) {
          if (Object.keys(data).length === 0) {
            res.json(existing);
            return;
          }
          const setClause = Object.keys(data).map((c) => `${c} = ?`).join(', ');
          const values = Object.values(data);
          db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = ? WHERE incident_id = ?`)
            .run(...values, localNow(), incidentId);
          const after = db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId);
          auditLog(req, 'UPDATE', table, existing.id, existing, after);
          res.json(after);
          return;
        }

        // Insert
        const insertCols = ['incident_id', ...Object.keys(data), 'created_by'];
        const placeholders = insertCols.map(() => '?').join(', ');
        const values = [incidentId, ...Object.values(data), req.user!.userId];
        const result = db.prepare(`INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders})`)
          .run(...values);
        const created = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(result.lastInsertRowid);
        auditLog(req, 'CREATE', table, Number(result.lastInsertRowid), null, created);
        res.status(201).json(created);
      } catch (err) {
        logger.error({ err, table }, '[supplements] upsert error');
        res.status(500).json({ error: 'Failed to save supplement', code: 'SUPPLEMENT_SAVE_ERR' });
      }
    },

    remove: (req: Request, res: Response) => {
      try {
        const db = getDb();
        const incidentId = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(incidentId) || incidentId <= 0) {
          res.status(400).json({ error: 'Invalid incident id', code: 'INVALID_ID' });
          return;
        }
        const existing = db.prepare(`SELECT * FROM ${table} WHERE incident_id = ?`).get(incidentId);
        if (!existing) {
          res.status(404).json({ error: 'Supplement not found', code: 'SUPPLEMENT_NOT_FOUND' });
          return;
        }
        db.prepare(`DELETE FROM ${table} WHERE incident_id = ?`).run(incidentId);
        auditLog(req, 'DELETE', table, (existing as any).id, existing, null);
        res.json({ success: true });
      } catch (err) {
        logger.error({ err, table }, '[supplements] delete error');
        res.status(500).json({ error: 'Failed to delete supplement', code: 'SUPPLEMENT_DEL_ERR' });
      }
    },
  };
}

const dv = buildSupplementHandlers('dv_supplements', DV_COLS);
const pursuit = buildSupplementHandlers('pursuit_supplements', PURSUIT_COLS);

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'] as const;
const DELETE_ROLES = ['admin', 'manager', 'supervisor'] as const;

router.get('/:id/supplements/dv',       requireRole(...READ_ROLES),   dv.get);
router.post('/:id/supplements/dv',      requireRole(...WRITE_ROLES),  dv.upsert);
router.put('/:id/supplements/dv',       requireRole(...WRITE_ROLES),  dv.upsert);
router.delete('/:id/supplements/dv',    requireRole(...DELETE_ROLES), dv.remove);

router.get('/:id/supplements/pursuit',     requireRole(...READ_ROLES),   pursuit.get);
router.post('/:id/supplements/pursuit',    requireRole(...WRITE_ROLES),  pursuit.upsert);
router.put('/:id/supplements/pursuit',     requireRole(...WRITE_ROLES),  pursuit.upsert);
router.delete('/:id/supplements/pursuit',  requireRole(...DELETE_ROLES), pursuit.remove);

export default router;
