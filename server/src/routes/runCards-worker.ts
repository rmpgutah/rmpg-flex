// ============================================================
// RMPG Flex — Dispatch Run Cards (Hono / D1 port)
// Hono port of server/src/routes/dispatch/runCards.ts (Express).
// Routes mounted under /api/dispatch by worker.ts.
//
// Behavioural parity with Express version:
//   - GET /run-cards               list active (or all w/ ?includeInactive=1)
//   - GET /run-cards/by-type/:t    preview lookup by incident_type
//   - GET /run-cards/:id           single by numeric id
//   - POST /run-cards              create (admin/manager/supervisor)
//   - PUT /run-cards/:id           update (admin/manager/supervisor)
//   - DELETE /run-cards/:id        delete (admin/manager)
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

const READ_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'] as const;
const WRITE_ROLES = ['admin', 'manager', 'supervisor'] as const;
const DELETE_ROLES = ['admin', 'manager'] as const;
const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

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

function normalizeIncidentType(t: unknown): string {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, '_');
}

export function mountRunCardsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ── LIST ──────────────────────────────────────────────────
  api.get('/run-cards', requireRole(...READ_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const includeInactive = c.req.query('includeInactive') === '1';
      const sql = includeInactive
        ? 'SELECT * FROM dispatch_run_cards ORDER BY display_name ASC'
        : 'SELECT * FROM dispatch_run_cards WHERE active = 1 ORDER BY display_name ASC';
      const rows = await db.prepare(sql).all() as RunCardRow[];
      return c.json(rows.map(parseRunCard));
    } catch (err) {
      console.error('[run-cards] list error', err);
      return c.json({ error: 'Failed to list run cards', code: 'RC_LIST_ERR' }, 500);
    }
  });

  // ── BY INCIDENT TYPE (preview lookup) ────────────────────
  api.get('/run-cards/by-type/:incident_type', requireRole(...READ_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const t = normalizeIncidentType(c.req.param('incident_type'));
      const row = await db
        .prepare('SELECT * FROM dispatch_run_cards WHERE incident_type = ? AND active = 1')
        .get(t) as RunCardRow | undefined;
      if (!row) {
        return c.json({ error: 'No active run card for that incident type', code: 'RC_NOT_FOUND' }, 404);
      }
      return c.json(parseRunCard(row));
    } catch (err) {
      console.error('[run-cards] by-type error', err);
      return c.json({ error: 'Failed to fetch run card', code: 'RC_FETCH_ERR' }, 500);
    }
  });

  // ── BY ID ─────────────────────────────────────────────────
  api.get('/run-cards/:id', requireRole(...READ_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '', 10);
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
      }
      const row = await db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow | undefined;
      if (!row) return c.json({ error: 'Run card not found', code: 'RC_NOT_FOUND' }, 404);
      return c.json(parseRunCard(row));
    } catch (err) {
      console.error('[run-cards] get error', err);
      return c.json({ error: 'Failed to fetch run card', code: 'RC_FETCH_ERR' }, 500);
    }
  });

  // ── CREATE ────────────────────────────────────────────────
  api.post('/run-cards', requireRole(...WRITE_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json().catch(() => ({} as any));

      const incident_type = normalizeIncidentType(body.incident_type);
      const display_name = String(body.display_name || '').trim();
      const default_priority = String(body.default_priority || 'P3').toUpperCase();

      if (!incident_type || !display_name) {
        return c.json({ error: 'incident_type and display_name are required', code: 'RC_MISSING_FIELDS' }, 400);
      }
      if (!VALID_PRIORITIES.includes(default_priority)) {
        return c.json({ error: `default_priority must be one of ${VALID_PRIORITIES.join(', ')}`, code: 'RC_INVALID_PRIORITY' }, 400);
      }

      const required_units = Math.max(1, Number(body.required_units ?? 1));
      const backup_units = Math.max(0, Number(body.backup_units ?? 0));
      const required_roles = JSON.stringify(Array.isArray(body.required_roles) ? body.required_roles : []);
      const auto_flags = JSON.stringify(body.auto_flags && typeof body.auto_flags === 'object' ? body.auto_flags : {});
      const recommended_codes = JSON.stringify(Array.isArray(body.recommended_codes) ? body.recommended_codes : []);

      try {
        const result = await db.prepare(`
          INSERT INTO dispatch_run_cards
            (incident_type, display_name, default_priority, required_units, backup_units,
             required_roles, auto_flags, recommended_codes, officer_safety_alert,
             silent_response_default, ems_requested, fire_requested, notes, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          incident_type, display_name, default_priority, required_units, backup_units,
          required_roles, auto_flags, recommended_codes,
          body.officer_safety_alert ? 1 : 0,
          body.silent_response_default ? 1 : 0,
          body.ems_requested ? 1 : 0,
          body.fire_requested ? 1 : 0,
          body.notes || null,
          body.active === false ? 0 : 1,
        );

        const created = await db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(result.meta.last_row_id) as RunCardRow;
        return c.json(parseRunCard(created), 201);
      } catch (err: any) {
        if (String(err?.message || '').includes('UNIQUE')) {
          return c.json({ error: 'A run card for that incident_type already exists', code: 'RC_DUPLICATE' }, 409);
        }
        throw err;
      }
    } catch (err) {
      console.error('[run-cards] create error', err);
      return c.json({ error: 'Failed to create run card', code: 'RC_CREATE_ERR' }, 500);
    }
  });

  // ── UPDATE ────────────────────────────────────────────────
  api.put('/run-cards/:id', requireRole(...WRITE_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '', 10);
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
      }
      const before = await db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow | undefined;
      if (!before) return c.json({ error: 'Run card not found', code: 'RC_NOT_FOUND' }, 404);

      const b = await c.req.json().catch(() => ({} as any));
      const default_priority = b.default_priority ? String(b.default_priority).toUpperCase() : before.default_priority;
      if (!VALID_PRIORITIES.includes(default_priority)) {
        return c.json({ error: `default_priority must be one of ${VALID_PRIORITIES.join(', ')}`, code: 'RC_INVALID_PRIORITY' }, 400);
      }

      await db.prepare(`
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

      const after = await db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow;
      return c.json(parseRunCard(after));
    } catch (err) {
      console.error('[run-cards] update error', err);
      return c.json({ error: 'Failed to update run card', code: 'RC_UPDATE_ERR' }, 500);
    }
  });

  // ── DELETE ────────────────────────────────────────────────
  api.delete('/run-cards/:id', requireRole(...DELETE_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = parseInt(c.req.param('id') || '', 10);
      if (!Number.isFinite(id) || id <= 0) {
        return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
      }
      const before = await db.prepare('SELECT * FROM dispatch_run_cards WHERE id = ?').get(id) as RunCardRow | undefined;
      if (!before) return c.json({ error: 'Run card not found', code: 'RC_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM dispatch_run_cards WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (err) {
      console.error('[run-cards] delete error', err);
      return c.json({ error: 'Failed to delete run card', code: 'RC_DELETE_ERR' }, 500);
    }
  });

  app.route('/api/dispatch', api);
}

// ── Server-side helper consumed by dispatch call-create path ──
// Async version of the Express applyRunCard. Caller wins on per-key basis;
// run card fills only nullish/empty fields.
export interface RunCardApplyResult {
  card: ReturnType<typeof parseRunCard> | null;
  appliedPriority: string | null;
  appliedFlags: Record<string, unknown>;
  backupRequired: boolean;
  silentResponse: boolean;
}

export async function applyRunCardD1(
  db: D1Db,
  incidentType: string,
  callerProvidedPriority?: string | null,
  callerProvidedFlags?: Record<string, unknown>,
): Promise<RunCardApplyResult> {
  const t = normalizeIncidentType(incidentType);
  const row = await db
    .prepare('SELECT * FROM dispatch_run_cards WHERE incident_type = ? AND active = 1')
    .get(t) as RunCardRow | undefined;
  if (!row) {
    return { card: null, appliedPriority: null, appliedFlags: {}, backupRequired: false, silentResponse: false };
  }
  const card = parseRunCard(row);
  const appliedPriority = callerProvidedPriority?.toString().toUpperCase() || card.default_priority;
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
