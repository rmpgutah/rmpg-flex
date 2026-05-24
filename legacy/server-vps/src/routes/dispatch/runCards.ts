// ============================================================
// RMPG Flex — Dispatch Run Cards
// Canned templates that pre-fill priority, unit count, roles,
// and operational flags when a matching incident_type is created.
// Spillman Flex parity feature: dispatchers stop hand-setting
// the same defaults for "structure_fire" or "domestic_in_progress"
// 50 times a day.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { auditLog } from '../../utils/auditLogger';
import { logger } from '../../utils/logger';

const router = Router();

interface RunCardRow {
  id: number;
  incident_type: string;
  display_name: string;
  default_priority: string;
  required_units: number;
  backup_units: number;
  required_roles: string;
  auto_flags: string;
  recommended_codes: string;
  officer_safety_alert: number;
  silent_response_default: number;
  ems_requested: number;
  fire_requested: number;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseRunCard(row: RunCardRow) {
  const safe = <T,>(s: string, fb: T): T => {
    try { return JSON.parse(s) as T; } catch { return fb; }
  };
  return {
    ...row,
    required_roles: safe<string[]>(row.required_roles, []),
    auto_flags: safe<Record<string, unknown>>(row.auto_flags, {}),
    recommended_codes: safe<string[]>(row.recommended_codes, []),
    officer_safety_alert: !!row.officer_safety_alert,
    silent_response_default: !!row.silent_response_default,
    ems_requested: !!row.ems_requested,
    fire_requested: !!row.fire_requested,
    active: !!row.active,
  };
}

const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

function normalizeIncidentType(t: unknown): string {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, '_');
}

// ── LIST ────────────────────────────────────────────────────
router.get(
  '/run-cards',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const includeInactive = req.query.includeInactive === '1';
      const where = includeInactive ? '' : 'WHERE active = 1';
      const rows = db
        .prepare(`SELECT * FROM dispatch_run_cards ${where} ORDER BY display_name ASC`)
        .all() as RunCardRow[];
      res.json(rows.map(parseRunCard));
    } catch (err) {
      logger.error({ err }, '[run-cards] list error');
      res.status(500).json({ error: 'Failed to list run cards', code: 'RC_LIST_ERR' });
    }
  },
);

// ── GET BY INCIDENT TYPE (used by dispatch UI for preview) ──
router.get(
  '/run-cards/by-type/:incident_type',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const t = normalizeIncidentType(req.params.incident_type);
      const row = db
        .prepare('SELECT * FROM dispatch_run_cards WHERE incident_type = ? AND active = 1')
        .get(t) as RunCardRow | undefined;
      if (!row) {
        res.status(404).json({ error: 'No active run card for that incident type', code: 'RC_NOT_FOUND' });
        return;
      }
      res.json(parseRunCard(row));
    } catch (err) {
      logger.error({ err }, '[run-cards] by-type error');
      res.status(500).json({ error: 'Failed to fetch run card', code: 'RC_FETCH_ERR' });
    }
  },
);

// ── GET BY ID ───────────────────────────────────────────────
router.get(
  '/run-cards/:id',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
        return;
      }
      const row = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow | undefined;
      if (!row) {
        res.status(404).json({ error: 'Run card not found', code: 'RC_NOT_FOUND' });
        return;
      }
      res.json(parseRunCard(row));
    } catch (err) {
      logger.error({ err }, '[run-cards] get error');
      res.status(500).json({ error: 'Failed to fetch run card', code: 'RC_FETCH_ERR' });
    }
  },
);

// ── CREATE ──────────────────────────────────────────────────
router.post(
  '/run-cards',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const incident_type = normalizeIncidentType(req.body.incident_type);
      const display_name = String(req.body.display_name || '').trim();
      const default_priority = String(req.body.default_priority || 'P3').toUpperCase();

      if (!incident_type || !display_name) {
        res.status(400).json({ error: 'incident_type and display_name are required', code: 'RC_MISSING_FIELDS' });
        return;
      }
      if (!VALID_PRIORITIES.includes(default_priority)) {
        res.status(400).json({ error: `default_priority must be one of ${VALID_PRIORITIES.join(', ')}`, code: 'RC_INVALID_PRIORITY' });
        return;
      }

      const required_units = Math.max(1, Number(req.body.required_units ?? 1));
      const backup_units = Math.max(0, Number(req.body.backup_units ?? 0));
      const required_roles = JSON.stringify(Array.isArray(req.body.required_roles) ? req.body.required_roles : []);
      const auto_flags = JSON.stringify(req.body.auto_flags && typeof req.body.auto_flags === 'object' ? req.body.auto_flags : {});
      const recommended_codes = JSON.stringify(Array.isArray(req.body.recommended_codes) ? req.body.recommended_codes : []);

      const result = db.prepare(`
        INSERT INTO dispatch_run_cards
          (incident_type, display_name, default_priority, required_units, backup_units,
           required_roles, auto_flags, recommended_codes, officer_safety_alert,
           silent_response_default, ems_requested, fire_requested, notes, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        incident_type, display_name, default_priority, required_units, backup_units,
        required_roles, auto_flags, recommended_codes,
        req.body.officer_safety_alert ? 1 : 0,
        req.body.silent_response_default ? 1 : 0,
        req.body.ems_requested ? 1 : 0,
        req.body.fire_requested ? 1 : 0,
        req.body.notes || null,
        req.body.active === false ? 0 : 1,
      );

      const created = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(result.lastInsertRowid) as RunCardRow;
      auditLog(req, 'CREATE', 'dispatch_run_card', Number(result.lastInsertRowid), null, created);
      res.status(201).json(parseRunCard(created));
    } catch (err: any) {
      if (String(err?.message || '').includes('UNIQUE')) {
        res.status(409).json({ error: 'A run card for that incident_type already exists', code: 'RC_DUPLICATE' });
        return;
      }
      logger.error({ err }, '[run-cards] create error');
      res.status(500).json({ error: 'Failed to create run card', code: 'RC_CREATE_ERR' });
    }
  },
);

// ── UPDATE ──────────────────────────────────────────────────
router.put(
  '/run-cards/:id',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
        return;
      }
      const before = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow | undefined;
      if (!before) {
        res.status(404).json({ error: 'Run card not found', code: 'RC_NOT_FOUND' });
        return;
      }

      const b = req.body;
      const default_priority = b.default_priority ? String(b.default_priority).toUpperCase() : before.default_priority;
      if (!VALID_PRIORITIES.includes(default_priority)) {
        res.status(400).json({ error: `default_priority must be one of ${VALID_PRIORITIES.join(', ')}`, code: 'RC_INVALID_PRIORITY' });
        return;
      }

      db.prepare(`
        UPDATE dispatch_run_cards SET
          display_name = ?,
          default_priority = ?,
          required_units = ?,
          backup_units = ?,
          required_roles = ?,
          auto_flags = ?,
          recommended_codes = ?,
          officer_safety_alert = ?,
          silent_response_default = ?,
          ems_requested = ?,
          fire_requested = ?,
          notes = ?,
          active = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        b.display_name ?? before.display_name,
        default_priority,
        b.required_units != null ? Math.max(1, Number(b.required_units)) : before.required_units,
        b.backup_units != null ? Math.max(0, Number(b.backup_units)) : before.backup_units,
        Array.isArray(b.required_roles) ? JSON.stringify(b.required_roles) : before.required_roles,
        b.auto_flags && typeof b.auto_flags === 'object' ? JSON.stringify(b.auto_flags) : before.auto_flags,
        Array.isArray(b.recommended_codes) ? JSON.stringify(b.recommended_codes) : before.recommended_codes,
        b.officer_safety_alert != null ? (b.officer_safety_alert ? 1 : 0) : before.officer_safety_alert,
        b.silent_response_default != null ? (b.silent_response_default ? 1 : 0) : before.silent_response_default,
        b.ems_requested != null ? (b.ems_requested ? 1 : 0) : before.ems_requested,
        b.fire_requested != null ? (b.fire_requested ? 1 : 0) : before.fire_requested,
        b.notes !== undefined ? (b.notes || null) : before.notes,
        b.active != null ? (b.active ? 1 : 0) : before.active,
        id,
      );

      const after = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow;
      auditLog(req, 'UPDATE', 'dispatch_run_card', id, before, after);
      res.json(parseRunCard(after));
    } catch (err) {
      logger.error({ err }, '[run-cards] update error');
      res.status(500).json({ error: 'Failed to update run card', code: 'RC_UPDATE_ERR' });
    }
  },
);

// ── DELETE ──────────────────────────────────────────────────
router.delete(
  '/run-cards/:id',
  requireRole('admin', 'manager'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
        return;
      }
      const before = db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow | undefined;
      if (!before) {
        res.status(404).json({ error: 'Run card not found', code: 'RC_NOT_FOUND' });
        return;
      }
      db.prepare('DELETE FROM dispatch_run_cards WHERE id = ?').run(id);
      auditLog(req, 'DELETE', 'dispatch_run_card', id, before, null);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, '[run-cards] delete error');
      res.status(500).json({ error: 'Failed to delete run card', code: 'RC_DELETE_ERR' });
    }
  },
);

export default router;

// ── Server-side helper consumed by calls.ts POST ────────────
// Pure function: given an incident_type and the existing call payload,
// return the run card (or null) plus the merged defaults the caller
// should apply. The caller decides whether to override.
export interface RunCardApplyResult {
  card: ReturnType<typeof parseRunCard> | null;
  appliedPriority: string | null;
  appliedFlags: Record<string, unknown>;
  backupRequired: boolean;
  silentResponse: boolean;
}

export function applyRunCard(
  db: ReturnType<typeof getDb>,
  incidentType: string,
  callerProvidedPriority?: string | null,
  callerProvidedFlags?: Record<string, unknown>,
): RunCardApplyResult {
  const t = normalizeIncidentType(incidentType);
  const row = db
    .prepare('SELECT * FROM dispatch_run_cards WHERE incident_type = ? AND active = 1')
    .get(t) as RunCardRow | undefined;
  if (!row) {
    return {
      card: null,
      appliedPriority: null,
      appliedFlags: {},
      backupRequired: false,
      silentResponse: false,
    };
  }
  const card = parseRunCard(row);

  // Caller-provided priority always wins. Only fill from card when missing.
  const appliedPriority = callerProvidedPriority?.toString().toUpperCase() || card.default_priority;

  // Caller-provided flags always win on per-key basis. Card fills only the gaps.
  const callerFlags = callerProvidedFlags || {};
  const appliedFlags: Record<string, unknown> = { ...card.auto_flags };
  for (const k of Object.keys(callerFlags)) {
    if (callerFlags[k] != null && callerFlags[k] !== '') {
      appliedFlags[k] = callerFlags[k];
    }
  }

  return {
    card,
    appliedPriority,
    appliedFlags,
    backupRequired: card.backup_units > 0,
    silentResponse: card.silent_response_default,
  };
}
