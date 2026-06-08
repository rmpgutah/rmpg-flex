import { Hono } from 'hono';
import type { Context } from 'hono';
import { hashSync } from 'bcryptjs';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { bodyCamerasRouter, bodycamVideosRouter } from './personnel/bodyCameras';
// Side-effect import: registers upload + stream handlers on
// bodycamVideosRouter. Splits the upload/stream surface (PR 2) into
// its own file so the read-only routes (PR 1) stay reviewable.
import './personnel/bodyCameraUploads';

const personnel = new Hono<Env>();

// Sub-routers — mounted BEFORE any /:id handler below so the literal
// '/body-cameras' and '/bodycam-videos' segments are matched first.
// Hono dispatches in registration order: a parametric /:id registered
// earlier would otherwise swallow these as id='body-cameras'.
personnel.route('/body-cameras', bodyCamerasRouter);
personnel.route('/bodycam-videos', bodycamVideosRouter);

// Manager-tier roles can edit anyone. A user may also edit their own row,
// but the editable column set is narrower (see SELF_EDITABLE).
const MANAGER_ROLES = new Set(['admin', 'manager', 'supervisor', 'human_resources']);

// Roles allowed to CREATE/EDIT time entries from the dispatch console. Editing
// clock_in/clock_out moves total_hours → overtime → payroll, so this is a
// deliberately scoped authorization set: the operator chose Admin / Manager /
// Supervisor / Dispatch (dispatcher logs an officer's time on radio request),
// and human_resources is retained because it already owns payroll/time reads.
// Every edit is audited in time_entry_edits (who / old / new / reason).
const TIME_WRITE_ROLES = new Set(['admin', 'manager', 'supervisor', 'human_resources', 'dispatcher']);

// Valid role values for POST /:id/role. Mirrors the role set documented
// in CLAUDE.md and the legacy users.role column. Adding a role here is
// the only place that has to change to recognize it for assignment.
const VALID_ROLES = new Set([
  'admin', 'manager', 'supervisor', 'officer', 'dispatcher',
  'contract_manager', 'client_viewer', 'human_resources',
]);

// Valid status values for POST /:id/status. Matches the union in
// client/src/types/index.ts. Keep these two in sync.
const VALID_STATUSES = new Set(['active', 'inactive', 'terminated']);

// Columns a manager-tier role may set via PUT /personnel/:id.
// Intentionally excludes: role, password*, totp_*, username, password_history,
// digital_signature, webauthn_credentials, login_count, last_login_at,
// created_at, id, status. Role/password/status each have their own dedicated
// endpoint (POST /:id/role, /:id/reset-password, /:id/status) so they get
// audited individually and can't be smuggled in via a form payload.
const MANAGER_EDITABLE: readonly string[] = [
  'full_name', 'first_name', 'middle_name', 'last_name',
  'email', 'phone',
  'badge_number', 'rank', 'department', 'assigned_unit_id', 'employee_id',
  'address', 'city', 'state', 'zip',
  'date_of_birth',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'hire_date', 'termination_date', 'shift_preference',
  'blood_type', 'allergies', 'uniform_size',
  'dl_number', 'dl_state', 'dl_expiry',
  'certifications', 'notes', 'profile_image',
  'voice_persona', 'voice_rate', 'voice_pitch', 'voice_terseness', 'voice_brain_enabled',
  'theme_preference', 'font_size_preference', 'notification_prefs', 'email_signature',
];

// Subset a user can change on their own row. Excludes anything that affects
// HR/duty assignment (badge, department, unit, rank, employee_id, dates,
// dl_*, certifications, medical) and anything identity-shaping (names, DOB).
const SELF_EDITABLE: readonly string[] = [
  'phone', 'email',
  'address', 'city', 'state', 'zip',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'voice_persona', 'voice_rate', 'voice_pitch', 'voice_terseness', 'voice_brain_enabled',
  'theme_preference', 'font_size_preference', 'notification_prefs', 'email_signature',
  'profile_image',
];

// GET /personnel[?status=&role=]
// Returns the FULL officer record set the client consumes, not just a thin
// summary: PersonnelPage feeds each list row straight into the detail panel's
// Profile tab (it does NOT refetch /personnel/:id), so the list must carry
// contact/HR/DL fields or the profile view goes blank. unit_call_sign is
// resolved via a correlated subquery (one unit per officer) to avoid row
// multiplication. ?status= drives the active/archived split (mapped to
// users.status active|inactive). Column count (~33) is well under the D1 cap.
personnel.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { status, role } = c.req.query();
    let sql = `SELECT u.id, u.username, u.full_name, u.first_name, u.last_name, u.middle_name,
                      u.role, u.badge_number, u.phone, u.email, u.status, u.rank, u.department,
                      u.address, u.city, u.state, u.zip, u.date_of_birth, u.hire_date, u.termination_date,
                      u.shift_preference, u.dl_number, u.dl_state, u.dl_expiry, u.blood_type, u.allergies,
                      u.uniform_size, u.emergency_contact_name, u.emergency_contact_phone,
                      u.emergency_contact_relationship, u.created_at, u.updated_at,
                      (SELECT call_sign FROM units WHERE officer_id = u.id LIMIT 1) AS unit_call_sign
               FROM users u WHERE 1=1`;
    const params: unknown[] = [];
    if (status) { sql += ' AND u.status = ?'; params.push(status); }
    if (role) { sql += ' AND u.role = ?'; params.push(role); }
    sql += ' ORDER BY u.full_name';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ── Officer credentials (certifications / licenses w/ expiry) ──────
// Backed by officer_credentials (migration 0076). GET is open to any
// authenticated user (read-only roster data); writes require manager tier.
const CREDENTIAL_FIELDS = ['officer_id', 'credential_type', 'credential_number', 'issuing_authority', 'issued_date', 'expiry_date', 'notes'] as const;
const CREDENTIAL_SELECT = `SELECT oc.*, u.full_name AS officer_name FROM officer_credentials oc LEFT JOIN users u ON u.id = oc.officer_id`;

// GET /personnel/credentials[?officer_id=]
personnel.get('/credentials', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    let sql = CREDENTIAL_SELECT;
    const params: unknown[] = [];
    if (officerId) { sql += ' WHERE oc.officer_id = ?'; params.push(officerId); }
    sql += ' ORDER BY (oc.expiry_date IS NULL), oc.expiry_date ASC, oc.id DESC';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/credentials failed:', err);
    return c.json([]);
  }
});

// POST /personnel/credentials
personnel.post('/credentials', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (body.officer_id == null || body.officer_id === '') return c.json({ error: 'officer_id is required' }, 400);
    const cols = CREDENTIAL_FIELDS.filter((f) => body[f] !== undefined);
    const res = await execute(
      db,
      `INSERT INTO officer_credentials (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...cols.map((f) => body[f]),
    );
    const row = await queryFirst<Record<string, unknown>>(db, `${CREDENTIAL_SELECT} WHERE oc.id = ?`, res.meta?.last_row_id);
    return c.json(row ?? { id: res.meta?.last_row_id }, 201);
  } catch (err) {
    console.error('POST /personnel/credentials failed:', err);
    return c.json({ error: 'Failed to create credential' }, 500);
  }
});

// PUT /personnel/credentials/:id
personnel.put('/credentials/:id', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const cols = CREDENTIAL_FIELDS.filter((f) => f !== 'officer_id' && body[f] !== undefined);
    if (cols.length === 0) return c.json({ error: 'No updatable fields' }, 400);
    const setClause = cols.map((f) => `${f} = ?`).join(', ');
    await execute(
      db,
      `UPDATE officer_credentials SET ${setClause}, updated_at = datetime('now','localtime') WHERE id = ?`,
      ...cols.map((f) => body[f]), id,
    );
    const row = await queryFirst<Record<string, unknown>>(db, `${CREDENTIAL_SELECT} WHERE oc.id = ?`, id);
    return c.json(row ?? { id });
  } catch (err) {
    console.error('PUT /personnel/credentials/:id failed:', err);
    return c.json({ error: 'Failed to update credential' }, 500);
  }
});

// DELETE /personnel/credentials/:id
personnel.delete('/credentials/:id', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    await execute(getDb(c.env), 'DELETE FROM officer_credentials WHERE id = ?', c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /personnel/credentials/:id failed:', err);
    return c.json({ error: 'Failed to delete credential' }, 500);
  }
});

// ── Officer equipment (issue / return / checkout log) ──────────────
// Backed by officer_equipment + equipment_checkout_log (both live). GET is
// open; mutations require manager tier. NOTE: equipment_type/condition/status
// are CHECK-constrained on live — out-of-list values 500 (handled gracefully).
const EQUIPMENT_FIELDS = ['equipment_type', 'make', 'model', 'serial_number', 'asset_tag', 'condition', 'status', 'issued_date', 'returned_date', 'notes'] as const;
const EQUIPMENT_SELECT = `SELECT oe.*, u.full_name AS officer_name FROM officer_equipment oe LEFT JOIN users u ON u.id = oe.officer_id`;

// GET /personnel/equipment[?officer_id=]
personnel.get('/equipment', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = c.req.query('officer_id');
    let sql = EQUIPMENT_SELECT;
    const params: unknown[] = [];
    if (officerId) { sql += ' WHERE oe.officer_id = ?'; params.push(officerId); }
    sql += ' ORDER BY oe.id DESC';
    return c.json(await query<Record<string, unknown>>(db, sql, ...params));
  } catch (err) {
    console.error('GET /personnel/equipment failed:', err);
    return c.json([]);
  }
});

// GET /personnel/equipment-log?days=30 — recent checkout/checkin activity.
personnel.get('/equipment-log', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Math.max(1, Math.min(365, Math.floor(Number(c.req.query('days')) || 30)));
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ecl.*, u.full_name AS officer_name
       FROM equipment_checkout_log ecl LEFT JOIN users u ON u.id = ecl.officer_id
       WHERE ecl.created_at >= datetime('now', '-${days} days')
       ORDER BY ecl.created_at DESC LIMIT 200`);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/equipment-log failed:', err);
    return c.json([]);
  }
});

// GET /personnel/equipment/:id/checkout-log
personnel.get('/equipment/:id/checkout-log', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, 'SELECT * FROM equipment_checkout_log WHERE equipment_id = ? ORDER BY created_at DESC', c.req.param('id'));
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/equipment/:id/checkout-log failed:', err);
    return c.json([]);
  }
});

// POST /personnel/:officerId/equipment — issue equipment to an officer.
personnel.post('/:officerId/equipment', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const officerId = c.req.param('officerId');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (!body.equipment_type) return c.json({ error: 'equipment_type is required' }, 400);
    const cols = ['officer_id', ...EQUIPMENT_FIELDS.filter((f) => body[f] !== undefined)];
    const vals = [officerId, ...EQUIPMENT_FIELDS.filter((f) => body[f] !== undefined).map((f) => body[f])];
    const res = await execute(
      db, `INSERT INTO officer_equipment (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...vals);
    const row = await queryFirst<Record<string, unknown>>(db, `${EQUIPMENT_SELECT} WHERE oe.id = ?`, res.meta?.last_row_id);
    return c.json(row ?? { id: res.meta?.last_row_id }, 201);
  } catch (err) {
    console.error('POST /personnel/:officerId/equipment failed:', err);
    return c.json({ error: 'Failed to create equipment record' }, 500);
  }
});

// PUT /personnel/equipment/:id
personnel.put('/equipment/:id', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const cols = EQUIPMENT_FIELDS.filter((f) => body[f] !== undefined);
    if (cols.length === 0) return c.json({ error: 'No updatable fields' }, 400);
    await execute(
      db,
      `UPDATE officer_equipment SET ${cols.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`,
      ...cols.map((f) => body[f]), id);
    const row = await queryFirst<Record<string, unknown>>(db, `${EQUIPMENT_SELECT} WHERE oe.id = ?`, id);
    return c.json(row ?? { id });
  } catch (err) {
    console.error('PUT /personnel/equipment/:id failed:', err);
    return c.json({ error: 'Failed to update equipment record' }, 500);
  }
});

// DELETE /personnel/equipment/:id
personnel.delete('/equipment/:id', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    await execute(getDb(c.env), 'DELETE FROM officer_equipment WHERE id = ?', c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /personnel/equipment/:id failed:', err);
    return c.json({ error: 'Failed to delete equipment record' }, 500);
  }
});

// POST /personnel/equipment/:id/checkout — log a checkout, mark issued.
personnel.post('/equipment/:id/checkout', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const actor = c.get('user') as { id: number } | undefined;
    const eq = await queryFirst<{ officer_id: string; equipment_type: string }>(db, 'SELECT officer_id, equipment_type FROM officer_equipment WHERE id = ?', id);
    if (!eq) return c.json({ error: 'Equipment not found' }, 404);
    await execute(
      db,
      `INSERT INTO equipment_checkout_log (equipment_id, officer_id, checkout_date, action, equipment_name, checked_by)
       VALUES (?, ?, datetime('now','localtime'), 'checkout', ?, ?)`,
      id, eq.officer_id, eq.equipment_type, actor?.id ?? null);
    await execute(db, "UPDATE officer_equipment SET status = 'issued', updated_at = datetime('now','localtime') WHERE id = ?", id);
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /personnel/equipment/:id/checkout failed:', err);
    return c.json({ error: 'Failed to check out equipment' }, 500);
  }
});

// POST /personnel/equipment/:id/checkin — log a return, mark returned.
personnel.post('/equipment/:id/checkin', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const actor = c.get('user') as { id: number } | undefined;
    const eq = await queryFirst<{ officer_id: string; equipment_type: string }>(db, 'SELECT officer_id, equipment_type FROM officer_equipment WHERE id = ?', id);
    if (!eq) return c.json({ error: 'Equipment not found' }, 404);
    await execute(
      db,
      `INSERT INTO equipment_checkout_log (equipment_id, officer_id, return_date, action, equipment_name, checked_by)
       VALUES (?, ?, datetime('now','localtime'), 'checkin', ?, ?)`,
      id, eq.officer_id, eq.equipment_type, actor?.id ?? null);
    await execute(db, "UPDATE officer_equipment SET status = 'returned', returned_date = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?", id);
    return c.json({ success: true });
  } catch (err) {
    console.error('POST /personnel/equipment/:id/checkin failed:', err);
    return c.json({ error: 'Failed to check in equipment' }, 500);
  }
});

// ────────────────────────────────────────────────────────────────
// Shift planning, time, deployments, coverage
// ────────────────────────────────────────────────────────────────
// All four require manager-tier role. PersonnelPage gates the UI on
// MANAGER_ROLES too, so unauthenticated/officer-tier callers shouldn't
// reach these in practice — but we still 403 defensively.
//
// Source-of-truth choices:
//   - /schedules     → shift_plans (the active shift roster). Each row
//                      stores its assignments as a JSON array; we expand
//                      to flat per-officer rows so the existing client
//                      mapper (mapSchedule) can consume them unchanged.
//   - /time          → time_entries + users (officer_name) + time_entry_edits
//                      (rolled up into an `edits` array per row).
//   - /deployments   → deployments + users + properties.
//   - /coverage-gaps → shift_plans grouped by shift_type, compared against
//                      system_config min_coverage_<shift> thresholds.

function requireManager(c: Context<Env>): Response | null {
  const actor = c.get('user') as { id: number; role: string } | undefined;
  if (!actor) return c.json({ error: 'Authentication required' }, 401);
  if (!MANAGER_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);
  return null;
}

function requireTimeWriter(c: Context<Env>): Response | null {
  const actor = c.get('user') as { id: number; role: string } | undefined;
  if (!actor) return c.json({ error: 'Authentication required' }, 401);
  if (!TIME_WRITE_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);
  return null;
}

// Net worked hours from a clock_in/clock_out pair, less break minutes. Returns
// null when the entry is still open (no clock_out) or the range is invalid, so
// total_hours stays NULL until the shift is actually closed. Rounded to 2dp to
// match the precision the roster + payroll rollups display.
function computeTotalHours(
  clockIn: string | null | undefined,
  clockOut: string | null | undefined,
  breakMinutes: number,
): number | null {
  if (!clockIn || !clockOut) return null;
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const grossHours = (end - start) / 3_600_000;
  const netHours = grossHours - (Number.isFinite(breakMinutes) ? breakMinutes : 0) / 60;
  return Math.round(Math.max(0, netHours) * 100) / 100;
}

// ── Helpers ───────────────────────────────────────────────────────

// Start-of-week (Sunday) in YYYY-MM-DD for a given ISO date string.
// Used by /schedules when no `week` query param is provided. Computed
// against the server clock (UTC) — accurate enough for a roster grid
// where shifts are date-stamped, not minute-precise. The client sends
// `week` explicitly when it cares.
function startOfWeek(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Default start/end times for each shift_type — used when a shift_plans
// assignment doesn't carry its own start/end. Mirrors the operational
// roster the agency runs; not configurable here because system_config
// doesn't currently store these as keyed values. If/when it does this
// becomes a lookup.
const SHIFT_TIMES: Record<string, { start: string; end: string }> = {
  day:       { start: '07:00:00', end: '19:00:00' },
  swing:     { start: '15:00:00', end: '23:00:00' },
  night:     { start: '19:00:00', end: '07:00:00' },
  graveyard: { start: '23:00:00', end: '07:00:00' },
  custom:    { start: '00:00:00', end: '00:00:00' },
};

// ── GET /personnel/schedules?week=YYYY-MM-DD&officer_id=N ────────
personnel.get('/schedules', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const weekParam = c.req.query('week');
    const officerIdParam = c.req.query('officer_id');

    const today = new Date().toISOString().slice(0, 10);
    const weekStart = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)
      ? startOfWeek(weekParam)
      : startOfWeek(today);
    const weekEnd = addDays(weekStart, 6);

    const plans = await query<{
      id: string;
      name: string;
      date: string;
      shift_type: string;
      assignments: string;
      status: string;
      created_at: string;
      updated_at: string;
    }>(
      db,
      `SELECT id, name, date, shift_type, assignments, status, created_at, updated_at
         FROM shift_plans
        WHERE date >= ? AND date <= ?
          AND status IN ('draft','active','completed')
        ORDER BY date ASC, shift_type ASC`,
      weekStart, weekEnd
    );

    // Officer-name backfill: assignments JSON usually carries `name` /
    // `officer_name`, but older rows just store `officer_id`. Hydrate
    // missing names with a single users-table lookup keyed by the union
    // of officer_ids actually present.
    const officerIds = new Set<number>();
    const expanded: Array<Record<string, unknown>> = [];
    for (const plan of plans) {
      let assignments: Array<Record<string, unknown>> = [];
      try {
        const raw = JSON.parse(plan.assignments || '[]');
        if (Array.isArray(raw)) assignments = raw;
      } catch {
        // Malformed JSON — treat as empty so one bad row doesn't poison
        // the week view.
        assignments = [];
      }

      for (let i = 0; i < assignments.length; i++) {
        const a = assignments[i];
        const officerId = Number(a.officer_id ?? a.id);
        if (!Number.isFinite(officerId) || officerId <= 0) continue;
        if (officerIdParam && String(officerId) !== officerIdParam) continue;
        officerIds.add(officerId);

        const defaults = SHIFT_TIMES[plan.shift_type] ?? SHIFT_TIMES.custom;
        const startTime = (typeof a.start === 'string' && a.start) || (typeof a.start_time === 'string' && a.start_time) || defaults.start;
        const endTime = (typeof a.end === 'string' && a.end) || (typeof a.end_time === 'string' && a.end_time) || defaults.end;

        expanded.push({
          id: `${plan.id}:${i}`,
          plan_id: plan.id,
          officer_id: officerId,
          officer_name: typeof a.name === 'string' ? a.name : (typeof a.officer_name === 'string' ? a.officer_name : ''),
          shift_date: plan.date,
          start_time: startTime,
          end_time: endTime,
          shift_type: plan.shift_type,
          role: typeof a.role === 'string' ? a.role : null,
          property_id: a.property_id ?? null,
          property_name: typeof a.property_name === 'string' ? a.property_name : null,
          notes: plan.name,
          status: plan.status === 'active' ? 'active' : (plan.status === 'completed' ? 'completed' : 'scheduled'),
          created_at: plan.created_at,
          updated_at: plan.updated_at,
        });
      }
    }

    // Backfill missing officer_name in one query rather than N lookups.
    const needsName = expanded.filter(r => !r.officer_name);
    if (needsName.length > 0 && officerIds.size > 0) {
      const placeholders = Array.from(officerIds).map(() => '?').join(',');
      const users = await query<{ id: number; full_name: string; badge_number: string | null }>(
        db,
        `SELECT id, full_name, badge_number FROM users WHERE id IN (${placeholders})`,
        ...Array.from(officerIds)
      );
      const nameById = new Map(users.map(u => [u.id, u.full_name]));
      for (const r of needsName) {
        r.officer_name = nameById.get(Number(r.officer_id)) ?? '';
      }
    }

    return c.json(expanded);
  } catch (err) {
    console.error('GET /personnel/schedules failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// POST /personnel/schedules — create a new shift plan.
personnel.post('/schedules', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const user = c.get('user') as { id: number } | undefined;
    if (!body.name || !body.date) return c.json({ error: 'name and date required' }, 400);
    const id = body.id || crypto.randomUUID();
    await execute(db,
      `INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
      id, body.name, body.date, body.shift_type || 'day',
      typeof body.assignments === 'string' ? body.assignments : JSON.stringify(body.assignments || []),
      body.status || 'draft', user?.id ?? null);
    const created = await queryFirst(db, 'SELECT * FROM shift_plans WHERE id = ?', id);
    return c.json(created, 201);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// PUT /personnel/schedules/:id — update a shift plan.
personnel.put('/schedules/:id', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: string }>(db, 'SELECT id FROM shift_plans WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Schedule not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const writable = new Set(['name', 'date', 'shift_type', 'assignments', 'status']);
    const cols: string[] = ["updated_at = datetime('now','localtime')"]; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (writable.has(key)) {
        cols.push(`${key} = ?`);
        params.push(key === 'assignments' && typeof val !== 'string' ? JSON.stringify(val) : val ?? null);
      }
    }
    if (cols.length === 1) return c.json({ message: 'No changes' });
    params.push(id);
    await execute(db, `UPDATE shift_plans SET ${cols.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst(db, 'SELECT * FROM shift_plans WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// DELETE /personnel/schedules/:id
personnel.delete('/schedules/:id', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: string }>(db, 'SELECT id FROM shift_plans WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Schedule not found' }, 404);
    await execute(db, 'DELETE FROM shift_plans WHERE id = ?', id);
    return c.json({ ok: true, id });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// ── GET /personnel/time?start_date=...&end_date=...&officer_id=... ─
// Read gate = WRITE roles (includes dispatcher): a dispatcher can POST/PUT/DELETE
// time entries, and the client re-fetches this list right after every mutation.
// Gating the read to MANAGER_ROLES (no dispatcher) 403'd that refresh, so a
// dispatcher's edit looked half-broken (write OK, table stale + error toast).
personnel.get('/time', async (c) => {
  const denied = requireTimeWriter(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const startParam = c.req.query('start_date');
    const endParam = c.req.query('end_date');
    const officerIdParam = c.req.query('officer_id');

    const today = new Date().toISOString().slice(0, 10);
    const defaultStart = addDays(today, -14);
    const start = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : defaultStart;
    const end = endParam && /^\d{4}-\d{2}-\d{2}$/.test(endParam) ? endParam : today;

    // clock_in is stored as a localtime ISO string; range-compare it
    // against `YYYY-MM-DD` boundaries (lex-sortable for ISO).
    const bindings: unknown[] = [start, end + 'T23:59:59'];
    let sql = `
      SELECT te.id, te.officer_id, te.schedule_id,
             te.clock_in, te.clock_out, te.clock_in_latitude, te.clock_in_longitude,
             te.total_hours, te.break_start, te.break_minutes, te.status,
             te.notes, te.created_at,
             u.full_name AS officer_name
        FROM time_entries te
        LEFT JOIN users u ON u.id = te.officer_id
       WHERE te.clock_in >= ? AND te.clock_in <= ?`;
    if (officerIdParam) {
      sql += ' AND te.officer_id = ?';
      bindings.push(officerIdParam);
    }
    sql += ' ORDER BY te.clock_in DESC';

    const entries = await query<Record<string, unknown>>(db, sql, ...bindings);

    // Edit history join — done as a second batch query rather than a
    // LEFT JOIN so the entries row isn't fanned out by edit count.
    // Safe to read all edits since time windows are bounded above.
    const ids = entries.map(e => e.id).filter(v => typeof v === 'number') as number[];
    let editsByEntry = new Map<number, Array<Record<string, unknown>>>();
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const edits = await query<Record<string, unknown>>(
        db,
        `SELECT id, time_entry_id, edited_by, edited_by_name, edit_type,
                old_value, new_value, reason, created_at
           FROM time_entry_edits
          WHERE time_entry_id IN (${placeholders})
          ORDER BY created_at ASC`,
        ...ids
      );
      editsByEntry = edits.reduce((map, e) => {
        const k = Number(e.time_entry_id);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(e);
        return map;
      }, new Map<number, Array<Record<string, unknown>>>());
    }

    let totalHours = 0;
    let overtimeHours = 0;
    // Overtime: anything past 8h on a single entry counts as OT. Matches
    // the legacy convention; the agency doesn't run a true 40h/week OT
    // engine yet, so per-entry is the closest approximation.
    for (const e of entries) {
      const h = typeof e.total_hours === 'number' ? e.total_hours : 0;
      totalHours += h;
      if (h > 8) overtimeHours += h - 8;
      const edits = editsByEntry.get(Number(e.id)) ?? [];
      (e as Record<string, unknown>).edits = edits;
    }

    // Returning an array (the shape mapTimeEntry consumes) keeps
    // PersonnelPage's `setTimeEntries(raw.map(mapTimeEntry))` working
    // unchanged. The summary is attached as non-enumerable-ish metadata
    // on the first row would be hacky; expose via response headers so
    // future consumers can pick them up without breaking the array
    // shape.
    return c.json(entries, 200, {
      'X-Total-Hours': totalHours.toFixed(2),
      'X-Overtime-Hours': overtimeHours.toFixed(2),
    });
  } catch (err) {
    console.error('GET /personnel/time failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ── POST /personnel/time/clock-in — officer self-service or dispatch-initiated clock in
personnel.post('/time/clock-in', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const selfId = c.get('userId') as number | undefined;
    const officerId = Number(body.officer_id) || selfId;
    if (!officerId || !Number.isFinite(officerId)) return c.json({ error: 'officer_id required' }, 400);

    const existing = await queryFirst<{ id: number }>(db,
      `SELECT id FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`, officerId);
    if (existing) return c.json({ error: 'Already clocked in', entry_id: existing.id }, 409);

    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const result = await execute(db,
      `INSERT INTO time_entries (officer_id, clock_in, status, created_at) VALUES (?, ?, 'active', datetime('now','localtime'))`,
      officerId, stamp);
    const entry = await queryFirst(db, 'SELECT * FROM time_entries WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(entry, 201);
  } catch (err) {
    console.error('POST /personnel/time/clock-in failed:', err);
    return c.json({ error: 'Clock in failed', detail: (err as Error)?.message }, 500);
  }
});

// ── POST /personnel/time/clock-out — close the officer's active time entry
personnel.post('/time/clock-out', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const selfId = c.get('userId') as number | undefined;
    const officerId = Number(body.officer_id) || selfId;
    if (!officerId || !Number.isFinite(officerId)) return c.json({ error: 'officer_id required' }, 400);

    const entry = await queryFirst<{ id: number; clock_in: string; break_minutes: number }>(db,
      `SELECT id, clock_in, break_minutes FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`, officerId);
    if (!entry) return c.json({ error: 'No active clock-in found' }, 404);

    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    const a = new Date(entry.clock_in).getTime();
    const b = new Date(stamp).getTime();
    const hrs = Number.isFinite(a) && Number.isFinite(b) && b > a
      ? Math.round(((b - a) / 3_600_000 - (entry.break_minutes || 0) / 60) * 100) / 100
      : 0;

    await execute(db, `UPDATE time_entries SET clock_out = ?, total_hours = ?, status = 'completed' WHERE id = ?`, stamp, hrs, entry.id);
    const updated = await queryFirst(db, 'SELECT * FROM time_entries WHERE id = ?', entry.id);
    return c.json(updated);
  } catch (err) {
    console.error('POST /personnel/time/clock-out failed:', err);
    return c.json({ error: 'Clock out failed', detail: (err as Error)?.message }, 500);
  }
});

// ── POST /personnel/time/start-break — mark break start on the active entry
personnel.post('/time/start-break', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const selfId = c.get('userId') as number | undefined;
    const officerId = Number(body.officer_id) || selfId;
    if (!officerId || !Number.isFinite(officerId)) return c.json({ error: 'officer_id required' }, 400);

    const entry = await queryFirst<{ id: number; status: string }>(db,
      `SELECT id, status FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`, officerId);
    if (!entry) return c.json({ error: 'No active clock-in found' }, 404);
    if (entry.status === 'on_break') return c.json({ error: 'Already on break' }, 409);

    await execute(db, `UPDATE time_entries SET status = 'on_break', break_start = datetime('now','localtime') WHERE id = ?`, entry.id);
    const updated = await queryFirst(db, 'SELECT * FROM time_entries WHERE id = ?', entry.id);
    return c.json(updated);
  } catch (err) {
    console.error('POST /personnel/time/start-break failed:', err);
    return c.json({ error: 'Start break failed', detail: (err as Error)?.message }, 500);
  }
});

// ── POST /personnel/time/end-break — close break, accumulate break_minutes
personnel.post('/time/end-break', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const selfId = c.get('userId') as number | undefined;
    const officerId = Number(body.officer_id) || selfId;
    if (!officerId || !Number.isFinite(officerId)) return c.json({ error: 'officer_id required' }, 400);

    const entry = await queryFirst<{ id: number; break_start: string | null; break_minutes: number }>(db,
      `SELECT id, break_start, break_minutes FROM time_entries WHERE officer_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`, officerId);
    if (!entry) return c.json({ error: 'No active clock-in found' }, 404);
    if (!entry.break_start) return c.json({ error: 'Not on break' }, 409);

    const breakStart = new Date(entry.break_start).getTime();
    const now = Date.now();
    const addedMinutes = Number.isFinite(breakStart) ? Math.round((now - breakStart) / 60000) : 0;
    const totalBreak = (entry.break_minutes || 0) + addedMinutes;

    await execute(db, `UPDATE time_entries SET status = 'active', break_start = NULL, break_minutes = ? WHERE id = ?`, totalBreak, entry.id);
    const updated = await queryFirst(db, 'SELECT * FROM time_entries WHERE id = ?', entry.id);
    return c.json(updated);
  } catch (err) {
    console.error('POST /personnel/time/end-break failed:', err);
    return c.json({ error: 'End break failed', detail: (err as Error)?.message }, 500);
  }
});

// ── POST /personnel/time — create a time entry on an officer's behalf ──
// Dispatch logs an officer's clock-in (and optionally clock-out) on radio
// request. Creating an entry isn't itself an "edit", so it's recorded as a
// normal 'active'/'completed' row; subsequent corrections go through PUT and
// are audited in time_entry_edits.
personnel.post('/time', async (c) => {
  const denied = requireTimeWriter(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();

    const officerId = Number(body.officer_id);
    if (!Number.isFinite(officerId) || officerId <= 0) {
      return c.json({ error: 'officer_id is required', code: 'MISSING_OFFICER' }, 400);
    }
    const clockIn = typeof body.clock_in === 'string' && body.clock_in.trim() ? body.clock_in.trim() : null;
    if (!clockIn) {
      return c.json({ error: 'clock_in is required', code: 'MISSING_CLOCK_IN' }, 400);
    }
    const clockOut = typeof body.clock_out === 'string' && body.clock_out.trim() ? body.clock_out.trim() : null;
    const breakMinutes = Number.isFinite(Number(body.break_minutes)) ? Number(body.break_minutes) : 0;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    // Reject a non-existent officer up front (FK has no enforcement on D1).
    const officer = await queryFirst<{ id: number }>(db, 'SELECT id FROM users WHERE id = ?', officerId);
    if (!officer) return c.json({ error: 'Officer not found', code: 'OFFICER_NOT_FOUND' }, 404);

    const totalHours = computeTotalHours(clockIn, clockOut, breakMinutes);
    const status = clockOut ? 'completed' : 'active';

    const res = await execute(
      db,
      `INSERT INTO time_entries (officer_id, clock_in, clock_out, break_minutes, total_hours, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
      officerId, clockIn, clockOut, breakMinutes, totalHours, status, notes,
    );

    const newId = res?.meta?.last_row_id;
    const created = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT te.*, u.full_name AS officer_name
         FROM time_entries te LEFT JOIN users u ON u.id = te.officer_id
        WHERE te.id = ?`,
      newId,
    );
    return c.json({ ...(created || {}), edits: [] }, 201);
  } catch (err) {
    console.error('POST /personnel/time failed:', err);
    return c.json({ error: 'Failed to create time entry', detail: (err as Error)?.message }, 500);
  }
});

// ── PUT /personnel/time/:id — edit an existing time entry ──
// Each changed field writes a time_entry_edits audit row (who/old/new/reason)
// and the entry is flagged status='edited'. total_hours is recomputed so the
// payroll rollup in GET /time stays correct. A `reason` is required because the
// edit feeds payroll — every correction must be explainable.
personnel.put('/time/:id', async (c) => {
  const denied = requireTimeWriter(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const actor = c.get('user') as { id: number; full_name?: string; username?: string } | undefined;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{
      id: number; clock_in: string | null; clock_out: string | null;
      break_minutes: number | null; notes: string | null; status: string;
    }>(db, 'SELECT id, clock_in, clock_out, break_minutes, notes, status FROM time_entries WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Time entry not found', code: 'ENTRY_NOT_FOUND' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    if (!reason) return c.json({ error: 'A reason for the change is required', code: 'MISSING_REASON' }, 400);

    // Build the change set. Only fields actually present in the body and
    // actually different from the stored value are touched + audited.
    type Edit = { edit_type: string; old: string | null; new: string | null };
    const edits: Edit[] = [];

    const newClockIn = typeof body.clock_in === 'string' && body.clock_in.trim() ? body.clock_in.trim() : existing.clock_in;
    if (body.clock_in !== undefined && newClockIn !== existing.clock_in) {
      edits.push({ edit_type: 'clock_in_changed', old: existing.clock_in, new: newClockIn });
    }

    // clock_out may be cleared (re-open an entry) by sending null/''.
    const newClockOut = body.clock_out === undefined
      ? existing.clock_out
      : (typeof body.clock_out === 'string' && body.clock_out.trim() ? body.clock_out.trim() : null);
    if (body.clock_out !== undefined && newClockOut !== existing.clock_out) {
      edits.push({ edit_type: 'clock_out_changed', old: existing.clock_out, new: newClockOut });
    }

    const existingBreak = Number(existing.break_minutes) || 0;
    const newBreak = body.break_minutes === undefined
      ? existingBreak
      : (Number.isFinite(Number(body.break_minutes)) ? Number(body.break_minutes) : existingBreak);
    if (body.break_minutes !== undefined && newBreak !== existingBreak) {
      edits.push({ edit_type: 'break_adjusted', old: String(existingBreak), new: String(newBreak) });
    }

    const newNotes = body.notes === undefined
      ? existing.notes
      : (typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null);
    if (body.notes !== undefined && newNotes !== existing.notes) {
      edits.push({ edit_type: 'notes_changed', old: existing.notes, new: newNotes });
    }

    if (edits.length === 0) {
      return c.json({ error: 'No changes supplied', code: 'NO_CHANGES' }, 400);
    }

    const totalHours = computeTotalHours(newClockIn, newClockOut, newBreak);
    // An edit that CLEARS clock_out re-opens the shift — it's genuinely active
    // again, so it must not stay 'edited' (the Currently-Active panel filters on
    // clocked_in/on_break and would hide a live, running shift). The edit is
    // still fully audited via the time_entry_edits rows + edited_by/edited_at.
    const newStatus = newClockOut ? 'edited' : 'active';

    await execute(
      db,
      `UPDATE time_entries
          SET clock_in = ?, clock_out = ?, break_minutes = ?, total_hours = ?, notes = ?,
              status = ?, edit_reason = ?, edited_by = ?, edited_at = datetime('now','localtime')
        WHERE id = ?`,
      newClockIn, newClockOut, newBreak, totalHours, newNotes, newStatus, reason, actor?.id ?? null, id,
    );

    const editorName = actor?.full_name || actor?.username || 'Unknown';
    for (const e of edits) {
      await execute(
        db,
        `INSERT INTO time_entry_edits (time_entry_id, edited_by, edited_by_name, edit_type, old_value, new_value, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
        id, actor?.id ?? 0, editorName, e.edit_type, e.old, e.new, reason,
      );
    }

    const updated = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT te.*, u.full_name AS officer_name
         FROM time_entries te LEFT JOIN users u ON u.id = te.officer_id
        WHERE te.id = ?`,
      id,
    );
    const editRows = await query<Record<string, unknown>>(
      db,
      `SELECT id, time_entry_id, edited_by, edited_by_name, edit_type, old_value, new_value, reason, created_at
         FROM time_entry_edits WHERE time_entry_id = ? ORDER BY created_at ASC`,
      id,
    );
    return c.json({ ...(updated || {}), edits: editRows });
  } catch (err) {
    console.error('PUT /personnel/time/:id failed:', err);
    return c.json({ error: 'Failed to update time entry', detail: (err as Error)?.message }, 500);
  }
});

// ── DELETE /personnel/time/:id — remove a time entry ──
// Hard delete (the client confirms "cannot be undone"). The deletion is logged
// to audit_log rather than time_entry_edits: the latter has ON DELETE CASCADE to
// time_entries, so an edit-row written here would be wiped by the delete it
// records. audit_log has no such FK, so the trail survives.
personnel.delete('/time/:id', async (c) => {
  const denied = requireTimeWriter(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const actor = c.get('user') as { id: number; full_name?: string; username?: string } | undefined;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);

    const existing = await queryFirst<{
      id: number; officer_id: number; clock_in: string | null; clock_out: string | null; total_hours: number | null;
    }>(db, 'SELECT id, officer_id, clock_in, clock_out, total_hours FROM time_entries WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Time entry not found', code: 'ENTRY_NOT_FOUND' }, 404);

    const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'No reason given';

    await execute(db, 'DELETE FROM time_entries WHERE id = ?', id);

    try {
      if (actor?.id != null) {
        await execute(
          db,
          `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, created_at)
           VALUES (?, 'TIME_ENTRY_DELETE', 'time_entry', ?, ?, datetime('now'))`,
          actor.id, id,
          `Deleted time entry #${id} (officer ${existing.officer_id}, ${existing.total_hours ?? 0}h) — ${reason}`,
        );
      }
    } catch (auditErr) {
      console.warn('audit_log insert failed for time-entry delete:', auditErr);
    }

    return c.json({ message: 'Time entry deleted', id });
  } catch (err) {
    console.error('DELETE /personnel/time/:id failed:', err);
    return c.json({ error: 'Failed to delete time entry', detail: (err as Error)?.message }, 500);
  }
});

// ── GET /personnel/deployments?active=true ────────────────────────
personnel.get('/deployments', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const activeParam = c.req.query('active');
    const officerIdParam = c.req.query('officer_id');

    const bindings: unknown[] = [];
    let where = ' WHERE 1=1';
    if (activeParam === 'true') {
      where += " AND d.status IN ('active','scheduled')";
    } else if (activeParam === 'false') {
      where += " AND d.status NOT IN ('active','scheduled')";
    }
    if (officerIdParam) {
      where += ' AND d.officer_id = ?';
      bindings.push(officerIdParam);
    }

    // properties LEFT JOIN — some rows may point at a deleted property
    // and we still want to surface the deployment, just with a blank
    // property_name. clients LEFT JOIN — properties.client_id is
    // nullable, and client_name is a nice-to-have for the page header.
    const sql = `
      SELECT d.id, d.officer_id, d.property_id, d.position,
             d.start_date, d.end_date, d.status, d.hours_per_week,
             d.notes, d.created_at, d.updated_at,
             u.full_name AS officer_name,
             p.name AS property_name,
             c.name AS client_name
        FROM deployments d
        LEFT JOIN users u ON u.id = d.officer_id
        LEFT JOIN properties p ON p.id = d.property_id
        LEFT JOIN clients c ON c.id = p.client_id
        ${where}
       ORDER BY d.start_date DESC, d.id DESC`;

    const rows = await query<Record<string, unknown>>(db, sql, ...bindings);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/deployments failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

const DEPLOYMENT_WRITABLE = new Set([
  'officer_id', 'property_id', 'position', 'start_date', 'end_date',
  'status', 'hours_per_week', 'notes',
]);

// POST /personnel/deployments
personnel.post('/deployments', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.officer_id || !body.property_id) return c.json({ error: 'officer_id and property_id required' }, 400);
    const cols: string[] = ['created_at', 'updated_at']; const vals: unknown[] = [];
    const ph: string[] = ["datetime('now','localtime')", "datetime('now','localtime')"];
    for (const [key, val] of Object.entries(body)) {
      if (DEPLOYMENT_WRITABLE.has(key)) { cols.push(key); vals.push(val ?? null); ph.push('?'); }
    }
    const result = await execute(db, `INSERT INTO deployments (${cols.join(', ')}) VALUES (${ph.join(', ')})`, ...vals);
    const created = await queryFirst(db, 'SELECT * FROM deployments WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// PUT /personnel/deployments/:id
personnel.put('/deployments/:id', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM deployments WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Deployment not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = ["updated_at = datetime('now','localtime')"]; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) {
      if (DEPLOYMENT_WRITABLE.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); }
    }
    if (cols.length === 1) return c.json({ message: 'No changes' });
    params.push(id);
    await execute(db, `UPDATE deployments SET ${cols.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst(db, 'SELECT * FROM deployments WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// DELETE /personnel/deployments/:id
personnel.delete('/deployments/:id', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM deployments WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Deployment not found' }, 404);
    await execute(db, 'DELETE FROM deployments WHERE id = ?', id);
    return c.json({ ok: true, id: Number(id) });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// ── GET /personnel/coverage-gaps?date=YYYY-MM-DD ──────────────────
//
// Returns CoverageGap[] (matches client/src/types/index.ts:1077):
//   { property_id, property_name, required_officers,
//     assigned_officers, gap, shift_type }
//
// Logic: for the given date, count assigned officers in shift_plans by
// shift_type, compare against system_config min_coverage_<shift>
// thresholds (per-property where present, otherwise the agency-wide
// minimum). Property-level minimums are stored as
// 'min_coverage_<shift>_<property_id>' keys; the bare key is the
// fallback. A missing config entry means "no coverage requirement set"
// and is silently skipped (vs. assuming 0 — which would flood the page
// with noise on properties the agency doesn't actually staff).
personnel.get('/coverage-gaps', async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  try {
    const db = getDb(c.env);
    const dateParam = c.req.query('date');
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toISOString().slice(0, 10);

    const plans = await query<{
      id: string;
      shift_type: string;
      assignments: string;
      status: string;
    }>(
      db,
      `SELECT id, shift_type, assignments, status
         FROM shift_plans
        WHERE date = ? AND status IN ('draft','active','completed')`,
      date
    );

    // Per-property assignment counts, keyed by `${property_id}|${shift_type}`.
    // `property_id` is read from each assignment if present; assignments
    // without a property_id are counted under the synthetic "" property
    // (general patrol pool).
    const assignedByKey = new Map<string, number>();
    const propertyById = new Map<string, string | null>();
    for (const plan of plans) {
      let assignments: Array<Record<string, unknown>> = [];
      try {
        const raw = JSON.parse(plan.assignments || '[]');
        if (Array.isArray(raw)) assignments = raw;
      } catch {
        assignments = [];
      }
      for (const a of assignments) {
        const pid = a.property_id != null ? String(a.property_id) : '';
        const pname = typeof a.property_name === 'string' ? a.property_name : null;
        const k = `${pid}|${plan.shift_type}`;
        assignedByKey.set(k, (assignedByKey.get(k) ?? 0) + 1);
        if (!propertyById.has(pid)) propertyById.set(pid, pname);
      }
    }

    // Load all min_coverage_* config rows once. Keys look like:
    //   min_coverage_day                    (agency-wide minimum for day)
    //   min_coverage_day_<property_id>      (override for one property)
    const configs = await query<{ config_key: string; config_value: string }>(
      db,
      `SELECT config_key, config_value FROM system_config
        WHERE is_active = 1 AND config_key LIKE 'min_coverage_%'`
    );
    const globalMin = new Map<string, number>();
    const propertyMin = new Map<string, number>(); // key = `${pid}|${shift_type}`
    for (const cfg of configs) {
      const value = Number(cfg.config_value);
      if (!Number.isFinite(value)) continue;
      // Strip prefix once, then peel off optional trailing `_<pid>`.
      const stripped = cfg.config_key.slice('min_coverage_'.length);
      const m = stripped.match(/^([a-z]+)(?:_(.+))?$/i);
      if (!m) continue;
      const shiftType = m[1];
      const pid = m[2];
      if (pid) propertyMin.set(`${pid}|${shiftType}`, value);
      else globalMin.set(shiftType, value);
    }

    // Hydrate property names for any property_id we have minimums for
    // but haven't seen in assignments (an unstaffed property still
    // produces a gap row).
    const allPropertyIds = new Set<string>(propertyById.keys());
    for (const key of propertyMin.keys()) {
      const pid = key.split('|')[0];
      if (pid) allPropertyIds.add(pid);
    }
    const missingNameIds = Array.from(allPropertyIds).filter(pid => pid && !propertyById.get(pid));
    if (missingNameIds.length > 0) {
      const placeholders = missingNameIds.map(() => '?').join(',');
      const rows = await query<{ id: number; name: string }>(
        db,
        `SELECT id, name FROM properties WHERE id IN (${placeholders})`,
        ...missingNameIds
      );
      for (const r of rows) propertyById.set(String(r.id), r.name);
    }

    const gaps: Array<{
      property_id: string;
      property_name: string;
      required_officers: number;
      assigned_officers: number;
      gap: number;
      shift_type: string;
    }> = [];

    // Emit one row per (property × shift_type) combination that has
    // either an assignment or a configured minimum. If a property has
    // a minimum but no assignments, the row shows the full gap (which
    // is the whole point of this endpoint).
    const seen = new Set<string>();
    const shiftTypes = new Set<string>(['day', 'swing', 'night', 'graveyard']);
    for (const k of propertyMin.keys()) shiftTypes.add(k.split('|')[1]);
    for (const k of assignedByKey.keys()) shiftTypes.add(k.split('|')[1]);

    for (const pid of allPropertyIds) {
      for (const shift of shiftTypes) {
        const k = `${pid}|${shift}`;
        if (seen.has(k)) continue;
        const required = propertyMin.get(k) ?? globalMin.get(shift);
        const assigned = assignedByKey.get(k) ?? 0;
        // Skip combos with no configured requirement AND no assignments
        // — those aren't gaps, just empty cells the UI doesn't need.
        if (required == null && assigned === 0) continue;
        const req = required ?? 0;
        gaps.push({
          property_id: pid,
          property_name: propertyById.get(pid) ?? '',
          required_officers: req,
          assigned_officers: assigned,
          gap: Math.max(0, req - assigned),
          shift_type: shift,
        });
        seen.add(k);
      }
    }

    // Sort: largest gap first so the DeploymentTab's gap-list lands the
    // worst offenders at the top without the client having to re-sort.
    gaps.sort((a, b) => b.gap - a.gap || a.property_name.localeCompare(b.property_name));

    return c.json(gaps);
  } catch (err) {
    console.error('GET /personnel/coverage-gaps failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// POST /personnel — create a new user.
//
// Auth: manager-tier only. This endpoint is the single biggest
// privilege-creation surface in the API (one call → new account
// with any role). The auth gate is the *sole* barrier here —
// unlike PUT, there's no target row whose ownership might fail
// a self-vs-other check.
//
// Required fields (validated explicitly):
//   - username  (will be lowercased before insert to prevent
//                confusable 'Smith' vs 'smith' pairs in the small-
//                org directory; case-insensitive uniqueness check
//                returns 409 instead of letting SQLite's UNIQUE
//                constraint raise an opaque error)
//   - password  (min 8 chars — minimal floor; org-level rotation
//                policy is enforced by must_change_password=1 on
//                first login)
//   - full_name (auto-derived from first+last if absent so the
//                form can leave it blank when first_name/last_name
//                are present, mirroring the AdminPage UX)
//   - role      (validated against VALID_ROLES; CHECK constraint
//                on the column is a defense-in-depth backstop)
//
// must_change_password defaults to 0: small-org operational
// reality is that the admin onboarding the officer is usually
// the supervisor handing them the laptop, so rotation friction
// on first login is more noise than security signal. The
// compensating control is POST /:id/reset-password which DOES
// set must_change_password=1 — i.e. the only time we force a
// rotation is when an admin signals (via reset) that the
// password is compromised or shared more widely.
personnel.post('/', async (c) => {
  try {
    const actor = c.get('user') as { id: number; role: string } | undefined;
    if (!actor) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    if (!MANAGER_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // ── Required-field validation ────────────────────────────
    const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
    const password   = typeof body.password === 'string' ? body.password : '';
    const role       = typeof body.role === 'string' ? body.role : '';
    const firstName  = typeof body.first_name === 'string' ? body.first_name.trim() : '';
    const lastName   = typeof body.last_name === 'string' ? body.last_name.trim() : '';
    const fullName   = typeof body.full_name === 'string' && body.full_name.trim().length > 0
      ? body.full_name.trim()
      : `${firstName} ${lastName}`.trim();

    if (!rawUsername) return c.json({ error: 'username is required' }, 400);
    if (password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);
    if (!fullName) return c.json({ error: 'full_name (or first_name + last_name) is required' }, 400);
    if (!VALID_ROLES.has(role)) {
      return c.json({ error: 'Invalid role', valid: Array.from(VALID_ROLES) }, 400);
    }

    // ── Username uniqueness (case-insensitive) ───────────────
    const username = rawUsername.toLowerCase();
    const db = getDb(c.env);
    const dup = await queryFirst<{ id: number }>(
      db,
      'SELECT id FROM users WHERE LOWER(username) = ?',
      username
    );
    if (dup) {
      return c.json({ error: 'Username already taken', existing_id: dup.id }, 409);
    }

    // ── Build INSERT from MANAGER_EDITABLE + the create-only
    // fields (username, password_hash, full_name, role,
    // must_change_password). Status uses the column's default
    // 'active' rather than being settable from the create form —
    // post-create status changes go through POST /:id/status.
    const cols: string[] = ['username', 'password_hash', 'full_name', 'role', 'must_change_password'];
    const vals: unknown[] = [username, hashSync(password, 10), fullName, role, 0];

    for (const key of MANAGER_EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        const raw = body[key];
        cols.push(key);
        vals.push(raw === '' ? null : raw);
      }
    }

    const placeholders = cols.map(() => '?').join(', ');
    const result = await execute(
      db,
      `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders})`,
      ...vals
    );

    const newId = result.meta?.last_row_id;
    if (!newId) {
      // Belt-and-suspenders: D1 should always populate last_row_id
      // for an AUTOINCREMENT INSERT, but if it doesn't we'd 500
      // here rather than return a row that might be someone else's.
      return c.json({ error: 'Insert succeeded but no id returned' }, 500);
    }

    const created = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT id, username, full_name, first_name, middle_name, last_name,
              email, phone, role, badge_number, rank, department,
              assigned_unit_id, employee_id, status, must_change_password,
              created_at, updated_at
         FROM users WHERE id = ?`,
      newId
    );
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /personnel failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// PUT /personnel/:id
// Updates an editable subset of the users row. Role/password/TOTP changes
// are intentionally NOT supported here — those need dedicated endpoints
// with stricter auth (see project-cf-existing-adoption follow-ups).
personnel.put('/:id', async (c) => {
  try {
    const idParam = c.req.param('id');
    const targetId = Number(idParam);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: 'Invalid user id' }, 400);
    }

    const actor = c.get('user') as { id: number; role: string } | undefined;
    const actorId = c.get('userId') as number | undefined;
    if (!actor || actorId == null) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const isManager = MANAGER_ROLES.has(actor.role);
    const isSelf = actorId === targetId;
    if (!isManager && !isSelf) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const allowed = isManager ? MANAGER_EDITABLE : SELF_EDITABLE;

    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const setCols: string[] = [];
    const bindings: unknown[] = [];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        setCols.push(`${key} = ?`);
        // Treat empty string as NULL for nullable fields — the client sends
        // "" for cleared inputs rather than omitting them.
        const raw = body[key];
        bindings.push(raw === '' ? null : raw);
      }
    }

    if (setCols.length === 0) {
      return c.json({ error: 'No editable fields provided' }, 400);
    }

    const db = getDb(c.env);

    // Verify target exists before UPDATE so we return a clean 404
    // instead of a successful 0-row update.
    const existing = await queryFirst<{ id: number }>(
      db,
      'SELECT id FROM users WHERE id = ?',
      targetId
    );
    if (!existing) {
      return c.json({ error: 'User not found' }, 404);
    }

    // ── Cross-integration guard (Claude Opus 4.8) ──
    // users.assigned_unit_id is a mirror of units.officer_id. Writing
    // one without the other leaves the dispatch list view
    // (LEFT JOIN users ON users.id = units.officer_id) showing the
    // wrong officer name for a unit, and the personnel detail panel
    // showing the wrong unit for the officer. The dispatch duty flow
    // keeps them in sync (assignUnitVehicle / duty.ts) but the
    // personnel PUT handler bypasses it. Validate the unit id points
    // at a real units row before persisting; on change, mirror the
    // new officer onto units.officer_id AND clear the previous
    // officer's units.officer_id if they had it.
    const unitChange = body.assigned_unit_id;
    if (unitChange !== undefined) {
      const newUnitId = unitChange === '' || unitChange === null ? null : Number(unitChange);
      if (newUnitId !== null && (!Number.isInteger(newUnitId) || newUnitId <= 0)) {
        return c.json({ error: 'assigned_unit_id must be a positive integer or null', code: 'INVALID_ASSIGNED_UNIT' }, 400);
      }
      if (newUnitId !== null) {
        const unitRow = await queryFirst<{ id: number }>(db, 'SELECT id FROM units WHERE id = ?', newUnitId);
        if (!unitRow) return c.json({ error: `assigned_unit_id ${newUnitId} does not match a known unit`, code: 'UNIT_NOT_FOUND' }, 400);
      }
    }

    setCols.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE users SET ${setCols.join(', ')} WHERE id = ?`;
    bindings.push(targetId);
    await execute(db, sql, ...bindings);

    // Mirror the assigned_unit_id write onto units.officer_id (the
    // authoritative dispatch-side pointer). Only runs when the body
    // actually touched assigned_unit_id, so a badge-number change
    // alone doesn't yank a unit's officer. Same pre-clear pattern as
    // dispatch/units.ts DELETE: any other unit that had this officer
    // as their pointer gets cleared first, so a transfer doesn't
    // leave two units pointing at the same person.
    if (unitChange !== undefined) {
      const newUnitId = unitChange === '' || unitChange === null ? null : Number(unitChange);
      await execute(db,
        `UPDATE units SET officer_id = NULL, updated_at = datetime('now')
          WHERE officer_id = ? AND (? IS NULL OR id != ?)`,
        targetId, newUnitId, newUnitId);
      if (newUnitId != null) {
        await execute(db,
          `UPDATE units SET officer_id = ?, updated_at = datetime('now') WHERE id = ?`,
          targetId, newUnitId);
      }
    }

    const updated = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT id, username, full_name, first_name, middle_name, last_name,
              email, phone, role, badge_number, rank, department,
              assigned_unit_id, employee_id, status, updated_at
         FROM users WHERE id = ?`,
      targetId
    );
    return c.json(updated);
  } catch (err) {
    console.error('PUT /personnel/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// POST /personnel/:id/role — admin-only role change.
// Lifted out of the general PUT so role assignment is its own audited
// surface and can't be smuggled in via a form payload. Self-role-change
// is explicitly disallowed even for admins (would let an admin
// demote themselves to officer and lose the only admin account).
personnel.post('/:id/role', async (c) => {
  try {
    const targetId = Number(c.req.param('id'));
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: 'Invalid user id' }, 400);
    }

    const actor = c.get('user') as { id: number; role: string } | undefined;
    const actorId = c.get('userId') as number | undefined;
    if (!actor || actorId == null) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    if (actor.role !== 'admin') {
      return c.json({ error: 'Admin only' }, 403);
    }
    if (actorId === targetId) {
      return c.json({ error: 'Cannot change your own role' }, 403);
    }

    const body = await c.req.json<{ role?: unknown }>().catch(() => null);
    const newRole = typeof body?.role === 'string' ? body.role : null;
    if (!newRole || !VALID_ROLES.has(newRole)) {
      return c.json({ error: 'Invalid role', valid: Array.from(VALID_ROLES) }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; role: string }>(
      db,
      'SELECT id, role FROM users WHERE id = ?',
      targetId
    );
    if (!existing) return c.json({ error: 'User not found' }, 404);

    await execute(
      db,
      'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      newRole, targetId
    );

    return c.json({ ok: true, id: targetId, previous_role: existing.role, role: newRole });
  } catch (err) {
    console.error('POST /personnel/:id/role failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// POST /personnel/:id/reset-password — admin-only password reset.
// Forces the target user to rotate on next login (must_change_password=1).
// Does NOT return the new hash; the admin has the plaintext they sent.
personnel.post('/:id/reset-password', async (c) => {
  try {
    const targetId = Number(c.req.param('id'));
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: 'Invalid user id' }, 400);
    }

    const actor = c.get('user') as { id: number; role: string } | undefined;
    if (!actor) return c.json({ error: 'Authentication required' }, 401);
    if (actor.role !== 'admin') return c.json({ error: 'Admin only' }, 403);

    const body = await c.req.json<{ new_password?: unknown }>().catch(() => null);
    const newPassword = typeof body?.new_password === 'string' ? body.new_password : null;
    if (!newPassword || newPassword.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(
      db,
      'SELECT id FROM users WHERE id = ?',
      targetId
    );
    if (!existing) return c.json({ error: 'User not found' }, 404);

    const hash = hashSync(newPassword, 10);
    await execute(
      db,
      `UPDATE users
         SET password_hash = ?,
             must_change_password = 1,
             password_changed_at = CURRENT_TIMESTAMP,
             last_password_change = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      hash, targetId
    );

    return c.json({ ok: true, id: targetId, must_change_password: true });
  } catch (err) {
    console.error('POST /personnel/:id/reset-password failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// POST /personnel/:id/status — manager-tier active/inactive/terminated toggle.
// Separated from the general PUT so deactivation is its own audited
// surface. Self-status-change is disallowed: a user shouldn't be able
// to mark themselves inactive (would lock out their own session via
// the authMiddleware status='active' check).
personnel.post('/:id/status', async (c) => {
  try {
    const targetId = Number(c.req.param('id'));
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: 'Invalid user id' }, 400);
    }

    const actor = c.get('user') as { id: number; role: string } | undefined;
    const actorId = c.get('userId') as number | undefined;
    if (!actor || actorId == null) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    if (!MANAGER_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    if (actorId === targetId) {
      return c.json({ error: 'Cannot change your own status' }, 403);
    }

    const body = await c.req.json<{ status?: unknown }>().catch(() => null);
    const newStatus = typeof body?.status === 'string' ? body.status : null;
    if (!newStatus || !VALID_STATUSES.has(newStatus)) {
      return c.json({ error: 'Invalid status', valid: Array.from(VALID_STATUSES) }, 400);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; status: string }>(
      db,
      'SELECT id, status FROM users WHERE id = ?',
      targetId
    );
    if (!existing) return c.json({ error: 'User not found' }, 404);

    await execute(
      db,
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      newStatus, targetId
    );

    return c.json({ ok: true, id: targetId, previous_status: existing.status, status: newStatus });
  } catch (err) {
    console.error('POST /personnel/:id/status failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// DELETE /personnel/:id — soft-delete only.
//
// Hard DELETE would orphan FK references in audit_log, incidents,
// units.assigned_user_id, time_entries, body_cameras, etc. — the
// users table is referenced almost everywhere. status='terminated'
// preserves the row so history queries still resolve.
//
// Manager-only. Self-delete is forbidden: if the only admin
// terminates themselves the org loses admin access with no in-app
// recovery path, so we 403 rather than fail dangerously. Idempotent
// — already-terminated returns 200 with previous_status='terminated'.
personnel.delete('/:id', async (c) => {
  try {
    const targetId = Number(c.req.param('id'));
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return c.json({ error: 'Invalid user id' }, 400);
    }

    const actor = c.get('user') as { id: number; role: string } | undefined;
    const actorId = c.get('userId') as number | undefined;
    if (!actor || actorId == null) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    if (!MANAGER_ROLES.has(actor.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    if (actorId === targetId) {
      return c.json({ error: 'Cannot terminate your own account' }, 403);
    }

    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number; status: string }>(
      db,
      'SELECT id, status FROM users WHERE id = ?',
      targetId
    );
    if (!existing) return c.json({ error: 'User not found' }, 404);

    await execute(
      db,
      `UPDATE users
       SET status = 'terminated',
           termination_date = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      targetId
    );

    return c.json({ ok: true, id: targetId, previous_status: existing.status, status: 'terminated' });
  } catch (err) {
    console.error('DELETE /personnel/:id failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// ============================================================
// Training (live tables: training_records, training_requirements)
// ============================================================

// GET /api/personnel/training — TrainingPage list of all training records,
// joined with officer name. No pagination yet; legacy tables hold <1k rows.
personnel.get('/training', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        tr.*,
        u.full_name AS officer_name,
        u.badge_number AS officer_badge
      FROM training_records tr
      LEFT JOIN users u ON u.id = tr.officer_id
      ORDER BY COALESCE(tr.completed_date, tr.created_at) DESC, tr.id DESC
    `);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/training error:', err);
    return c.json([], 200);
  }
});

// POST /api/personnel/training — create a training record.
personnel.post('/training', async (c) => {
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.course_name || !b.officer_id) return c.json({ error: 'course_name and officer_id required' }, 400);
    const r = await execute(db,
      `INSERT INTO training_records (officer_id, course_name, category, provider, completed_date, expiry_date, score, hours, certificate_number, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.officer_id, b.course_name, b.category || 'other', b.provider ?? null,
      b.completed_date ?? null, b.expiry_date ?? null,
      b.score != null ? Number(b.score) : null,
      b.hours != null ? Number(b.hours) : 0,
      b.certificate_number ?? null, b.status || 'scheduled', b.notes ?? null);
    return c.json({ success: true, id: r.meta.last_row_id }, 201);
  } catch (err) {
    console.error('POST /personnel/training error:', err);
    return c.json({ error: 'Failed to create training record' }, 500);
  }
});

// PUT /api/personnel/training/:id — update a training record.
personnel.put('/training/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const b = await c.req.json<Record<string, unknown>>();
    const existing = await queryFirst(db, 'SELECT id FROM training_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Training record not found' }, 404);
    await execute(db,
      `UPDATE training_records SET officer_id=?, course_name=?, category=?, provider=?,
         completed_date=?, expiry_date=?, score=?, hours=?, certificate_number=?, status=?, notes=?,
         updated_at=datetime('now')
       WHERE id=?`,
      b.officer_id, b.course_name, b.category || 'other', b.provider ?? null,
      b.completed_date ?? null, b.expiry_date ?? null,
      b.score != null ? Number(b.score) : null,
      b.hours != null ? Number(b.hours) : 0,
      b.certificate_number ?? null, b.status || 'scheduled', b.notes ?? null, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /personnel/training error:', err);
    return c.json({ error: 'Failed to update training record' }, 500);
  }
});

// DELETE /api/personnel/training/:id — delete a training record.
personnel.delete('/training/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst(db, 'SELECT id FROM training_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Training record not found' }, 404);
    await execute(db, 'DELETE FROM training_records WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /personnel/training error:', err);
    return c.json({ error: 'Failed to delete training record' }, 500);
  }
});

// GET /api/personnel/training-requirements — courses + cadence config.
personnel.get('/training-requirements', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, 'SELECT * FROM training_requirements ORDER BY category, course_name');
    return c.json(rows);
  } catch (err) {
    return c.json([], 200);
  }
});

// POST /api/personnel/training-requirements — admin creates a course requirement.
personnel.post('/training-requirements', async (c) => {
  try {
    const actor = (c as any).var?.user;
    if (!actor || !MANAGER_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.course_name) return c.json({ error: 'course_name is required' }, 400);
    const r = await execute(db,
      `INSERT INTO training_requirements (course_name, category, required_for_roles, renewal_period_months, minimum_hours, is_mandatory, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      b.course_name, b.category || 'other',
      typeof b.required_for_roles === 'string' ? b.required_for_roles : JSON.stringify(b.required_for_roles || ['officer']),
      b.renewal_period_months ?? 12, b.minimum_hours ?? 1, b.is_mandatory ?? 1,
      b.description || null, b.is_active ?? 1);
    const row = await queryFirst(db, 'SELECT * FROM training_requirements WHERE id = ?', Number(r.meta.last_row_id));
    return c.json(row, 201);
  } catch (err) {
    console.error('POST /personnel/training-requirements error:', err);
    return c.json({ error: 'Failed to create training requirement' }, 500);
  }
});

// PUT /api/personnel/training-requirements/:id
personnel.put('/training-requirements/:id', async (c) => {
  try {
    const actor = (c as any).var?.user;
    if (!actor || !MANAGER_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst(db, 'SELECT id FROM training_requirements WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Requirement not found' }, 404);
    const b = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (['course_name', 'category', 'required_for_roles', 'renewal_period_months', 'minimum_hours', 'is_mandatory', 'description', 'is_active'].includes(k)) {
        sets.push(`${k} = ?`);
        params.push(k === 'required_for_roles' && typeof v !== 'string' ? JSON.stringify(v) : v ?? null);
      }
    }
    if (!sets.length) return c.json({ message: 'No changes' });
    params.push(id);
    await execute(db, `UPDATE training_requirements SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const row = await queryFirst(db, 'SELECT * FROM training_requirements WHERE id = ?', id);
    return c.json(row);
  } catch (err) {
    console.error('PUT /personnel/training-requirements/:id error:', err);
    return c.json({ error: 'Failed to update training requirement' }, 500);
  }
});

// DELETE /api/personnel/training-requirements/:id
personnel.delete('/training-requirements/:id', async (c) => {
  try {
    const actor = (c as any).var?.user;
    if (!actor || !MANAGER_ROLES.has(actor.role)) return c.json({ error: 'Insufficient permissions' }, 403);
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst(db, 'SELECT id FROM training_requirements WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Requirement not found' }, 404);
    await execute(db, 'DELETE FROM training_requirements WHERE id = ?', id);
    return c.json({ message: 'Deleted', id: Number(id) });
  } catch (err) {
    console.error('DELETE /personnel/training-requirements/:id error:', err);
    return c.json({ error: 'Failed to delete training requirement' }, 500);
  }
});

// GET /api/personnel/training-completion — per-officer rollup of completion
// status against requirements. Lightweight implementation: joins every
// active officer with every requirement and reports the most-recent record
// status. Heavier compliance scoring (overdue-by-N-days etc.) can land in
// a follow-up.
personnel.get('/training-completion', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        u.id AS officer_id,
        u.full_name AS officer_name,
        req.id AS requirement_id,
        req.course_name AS requirement_course,
        req.category,
        rec.completed_date,
        rec.expiry_date,
        rec.status AS record_status,
        CASE
          WHEN rec.id IS NULL THEN 'missing'
          WHEN rec.expiry_date IS NOT NULL AND date(rec.expiry_date) < date('now') THEN 'expired'
          ELSE 'current'
        END AS compliance_status
      FROM users u
      CROSS JOIN training_requirements req
      LEFT JOIN training_records rec
        ON rec.officer_id = u.id AND rec.course_name = req.course_name
      WHERE u.status = 'active' AND COALESCE(req.is_active, 1) = 1
      ORDER BY u.full_name, req.category, req.course_name
    `);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/training-completion error:', err);
    return c.json([], 200);
  }
});

// ============================================================
// Body cameras + bodycam videos
// ============================================================

// GET /api/personnel/body-cameras — BodyCamerasPage device roster.
// No dedicated devices table yet; derive a one-row-per-distinct-camera_id
// view from the bodycam_videos table so the page can render an inventory
// without an explicit join target. Last-seen timestamp comes from the
// most-recent video for that camera.
personnel.get('/body-cameras', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        camera_id,
        MIN(officer_id) AS assigned_officer_id,
        COUNT(*) AS total_videos,
        SUM(COALESCE(duration_seconds, 0)) AS total_duration_seconds,
        MAX(recorded_at) AS last_recorded_at,
        SUM(CASE WHEN classification = 'evidence' THEN 1 ELSE 0 END) AS evidence_videos
      FROM bodycam_videos
      WHERE camera_id IS NOT NULL
      GROUP BY camera_id
      ORDER BY last_recorded_at DESC NULLS LAST
    `);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/body-cameras error:', err);
    return c.json([], 200);
  }
});

// GET /api/personnel/bodycam-videos[?case_number=...]
personnel.get('/bodycam-videos', async (c) => {
  try {
    const db = getDb(c.env);
    const { case_number, officer_id, classification, limit: limitParam } = c.req.query();
    const limit = Math.min(500, Math.max(1, parseInt(limitParam || '100', 10)));

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (case_number) { where += ' AND case_number = ?'; params.push(case_number); }
    if (officer_id) { where += ' AND officer_id = ?'; params.push(officer_id); }
    if (classification) { where += ' AND classification = ?'; params.push(classification); }

    const rows = await query<Record<string, unknown>>(db, `
      SELECT * FROM bodycam_videos ${where}
      ORDER BY recorded_at DESC, id DESC LIMIT ?
    `, ...params, limit);

    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/bodycam-videos error:', err);
    return c.json([], 200);
  }
});

// GET /api/personnel/bodycam-videos/retention/report — BodyCamerasPage
// retention dashboard tile. Groups videos by retention_status and reports
// total size + count per bucket.
personnel.get('/bodycam-videos/retention/report', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        COALESCE(retention_status, 'unset') AS retention_status,
        COUNT(*) AS video_count,
        COALESCE(SUM(file_size), 0) AS total_bytes,
        COALESCE(SUM(duration_seconds), 0) AS total_duration_seconds
      FROM bodycam_videos GROUP BY retention_status
    `);
    return c.json({ buckets: rows });
  } catch (err) {
    return c.json({ buckets: [] }, 200);
  }
});

// GET /api/personnel/bodycam-videos/reviews/pending — placeholder for the
// supervisor review queue. No reviews table on live D1 yet, so an empty
// list is the safest contract for now.
personnel.get('/bodycam-videos/reviews/pending', async (c) => {
  return c.json({ data: [] });
});

// GET /api/personnel/bodycam-videos/redaction-requests — same story.
personnel.get('/bodycam-videos/redaction-requests', async (c) => {
  return c.json([]);
});

// ============================================================
// Duty hours rollup (PersonnelAnalyticsDashboard)
// ============================================================

// GET /api/personnel/duty-hours?period=14
// Hours-by-officer over a rolling window, aggregated from the live
// `time_entries` clock-in/out table (clock-on persists there even though the
// clock UI is on the legacy worker — same shared D1). Overtime is hours beyond
// a 40h/week pro-rated baseline for the window. The dashboard panel reads
// `entries[]` + `totals` (+ optional flagged_excessive_hours), so all are sent.
personnel.get('/duty-hours', async (c) => {
  const period = Math.max(1, Math.min(366, Math.floor(Number(c.req.query('period')) || 14)));
  try {
    const db = getDb(c.env);
    const rows = await query<{ officer_id: number; officer_name: string; badge_number: string; total_hours: number; shifts_completed: number }>(
      db,
      `SELECT u.id AS officer_id, u.full_name AS officer_name, u.badge_number,
              ROUND(COALESCE(SUM(te.total_hours), 0), 1) AS total_hours,
              COUNT(CASE WHEN te.clock_out IS NOT NULL THEN 1 END) AS shifts_completed
       FROM users u
       LEFT JOIN time_entries te ON te.officer_id = u.id
            AND te.clock_in >= datetime('now', '-${period} days')
       WHERE u.status = 'active'
       GROUP BY u.id, u.full_name, u.badge_number
       ORDER BY total_hours DESC, u.full_name`);
    // OT baseline: 40h/week pro-rated across the window.
    const otThreshold = (period / 7) * 40;
    const flagThreshold = (period / 7) * 60; // "excessive" = >60h/week pace
    const entries = rows.map((o) => ({
      officer_id: o.officer_id,
      officer_name: o.officer_name,
      badge_number: o.badge_number,
      total_hours: o.total_hours,
      shifts_completed: o.shifts_completed,
      total_overtime: Math.round(Math.max(0, o.total_hours - otThreshold) * 10) / 10,
    }));
    const totalHours = Math.round(entries.reduce((s, e) => s + (e.total_hours || 0), 0) * 10) / 10;
    const flagged = entries
      .filter((e) => e.total_hours > flagThreshold)
      .map((e) => ({ officer_id: e.officer_id, officer_name: e.officer_name, total_hours: e.total_hours }));
    return c.json({
      entries,
      totals: { totalHours, totalOfficers: entries.length },
      flagged_excessive_hours: flagged,
      period_days: period,
    });
  } catch (err) {
    console.error('GET /personnel/duty-hours failed:', err);
    return c.json({ entries: [], totals: { totalHours: 0, totalOfficers: 0 }, flagged_excessive_hours: [], period_days: period }, 200);
  }
});

// ── Officer activity feed ────────────────────────────────────
// GET /api/personnel/activity/:id?limit=50 — the officer's recent audited
// actions. Unions the two live activity tables (audit_log + activity_log,
// identical columns) so the feed is complete regardless of which subsystem
// wrote the entry. Shapes to the client ActivityEntry contract.
personnel.get('/activity/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId)) return c.json([]);
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT id, src, action, details, entity_type, created_at, user_name FROM (
        SELECT 'audit-' || a.id AS id, 'audit' AS src, a.action, a.details, a.entity_type,
               a.created_at, u.full_name AS user_name
          FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.user_id = ?
        UNION ALL
        SELECT 'act-' || l.id AS id, 'activity' AS src, l.action, l.details, l.entity_type,
               l.created_at, u.full_name AS user_name
          FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
         WHERE l.user_id = ?
      )
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `, officerId, officerId, limit);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/activity/:id error:', err);
    return c.json([], 200);
  }
});

// ── Physical fitness tracking ────────────────────────────────
// GET /api/personnel/fitness/:id — fitness scores, newest first.
personnel.get('/fitness/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId)) return c.json([]);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT id, date, score, run_time, pushups, situps, notes, created_at
        FROM personnel_fitness WHERE officer_id = ?
       ORDER BY COALESCE(date, created_at) DESC, id DESC
    `, officerId);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/fitness/:id error:', err);
    return c.json([], 200);
  }
});

// POST /api/personnel/fitness/:id — record a fitness score.
personnel.post('/fitness/:id', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId)) return c.json({ error: 'Invalid officer id' }, 400);
    const recordedBy = c.get('userId') as number | undefined;
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
    const result = await execute(db, `
      INSERT INTO personnel_fitness (officer_id, date, score, run_time, pushups, situps, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, officerId, b.date ?? null, num(b.score), b.run_time ?? null, num(b.pushups), num(b.situps), b.notes ?? null, recordedBy ?? null);
    return c.json({ success: true, id: result.meta?.last_row_id }, 201);
  } catch (err) {
    console.error('POST /personnel/fitness/:id error:', err);
    return c.json({ error: 'Failed to record fitness score' }, 500);
  }
});

// ── Commendations ────────────────────────────────────────────
// GET /api/personnel/commendations/:id — commendations, newest first.
personnel.get('/commendations/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId)) return c.json([]);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT cm.id, cm.date, cm.type, cm.description, cm.created_at,
             u.full_name AS awarded_by_name
        FROM personnel_commendations cm
        LEFT JOIN users u ON u.id = cm.awarded_by
       WHERE cm.officer_id = ?
       ORDER BY COALESCE(cm.date, cm.created_at) DESC, cm.id DESC
    `, officerId);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel/commendations/:id error:', err);
    return c.json([], 200);
  }
});

// POST /api/personnel/commendations/:id — add a commendation.
personnel.post('/commendations/:id', async (c) => {
  const denied = requireManager(c); if (denied) return denied;
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId)) return c.json({ error: 'Invalid officer id' }, 400);
    const awardedBy = c.get('userId') as number | undefined;
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (!b.description || !String(b.description).trim()) return c.json({ error: 'Description is required' }, 400);
    const result = await execute(db, `
      INSERT INTO personnel_commendations (officer_id, date, type, description, awarded_by)
      VALUES (?, ?, ?, ?, ?)
    `, officerId, b.date ?? null, b.type ?? 'commendation', String(b.description).trim(), awardedBy ?? null);
    return c.json({ success: true, id: result.meta?.last_row_id }, 201);
  } catch (err) {
    console.error('POST /personnel/commendations/:id error:', err);
    return c.json({ error: 'Failed to add commendation' }, 500);
  }
});

// ── GET /personnel/:id/dispatch-stats — officer's dispatch activity summary
personnel.get('/:id/dispatch-stats', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId) || officerId <= 0) return c.json({ error: 'Invalid officer id' }, 400);

    const [callStats, unitInfo, recentCalls, tripStats] = await Promise.all([
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_calls,
          SUM(CASE WHEN priority = 1 THEN 1 ELSE 0 END) as priority1_calls,
          SUM(CASE WHEN priority = 2 THEN 1 ELSE 0 END) as priority2_calls,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_calls,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_calls,
          AVG(CASE WHEN starting_mileage IS NOT NULL AND ending_mileage IS NOT NULL
               THEN ending_mileage - starting_mileage END) as avg_call_miles
        FROM calls_for_service
        WHERE reporting_officer_id = ?`, officerId),
      queryFirst<Record<string, unknown>>(db, `
        SELECT u.id as unit_id, u.call_sign, u.status as unit_status,
          u.vehicle_id, u.current_call_id,
          fv.vehicle_number, fv.make as vehicle_make, fv.model as vehicle_model
        FROM units u
        LEFT JOIN fleet_vehicles fv ON fv.assigned_unit_id = u.id
        WHERE u.officer_id = ?`, officerId),
      query<Record<string, unknown>>(db, `
        SELECT id, call_number, incident_type, priority, status,
          location_address, created_at
        FROM calls_for_service
        WHERE reporting_officer_id = ?
        ORDER BY created_at DESC LIMIT 10`, officerId),
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as total_trips,
          SUM(distance_miles) as total_miles,
          AVG(distance_miles) as avg_trip_miles,
          AVG(max_speed_mph) as avg_max_speed,
          SUM(duration_seconds) as total_drive_seconds
        FROM nav_trip_log
        WHERE officer_id = ? AND status = 'completed'`, officerId),
    ]);

    return c.json({
      officer_id: officerId,
      calls: callStats,
      current_unit: unitInfo,
      recent_calls: recentCalls,
      trips: tripStats,
    });
  } catch (err) {
    console.error('GET /personnel/:id/dispatch-stats error:', err);
    return c.json({ error: 'Failed to fetch dispatch stats' }, 500);
  }
});

// ── GET /personnel/:id/fleet-summary — officer's vehicle history + usage
personnel.get('/:id/fleet-summary', async (c) => {
  try {
    const db = getDb(c.env);
    const officerId = Number(c.req.param('id'));
    if (!Number.isFinite(officerId) || officerId <= 0) return c.json({ error: 'Invalid officer id' }, 400);

    const [currentVehicle, assignmentHistory, fuelUsage, maintenanceEvents] = await Promise.all([
      queryFirst<Record<string, unknown>>(db, `
        SELECT fv.id, fv.vehicle_number, fv.make, fv.model, fv.year,
          fv.plate_number, fv.status, fv.current_mileage,
          fv.next_service_date, fv.next_service_mileage,
          fv.insurance_expiry, fv.registration_expiry,
          fa.assigned_at
        FROM units u
        JOIN fleet_vehicles fv ON fv.assigned_unit_id = u.id
        LEFT JOIN fleet_assignments fa ON fa.vehicle_id = fv.id
          AND fa.unit_id = u.id AND fa.unassigned_at IS NULL
        WHERE u.officer_id = ?
        LIMIT 1`, officerId),
      query<Record<string, unknown>>(db, `
        SELECT fa.vehicle_id, fa.assigned_at, fa.unassigned_at, fa.mileage_at_assign,
          fa.mileage_at_unassign,
          fv.vehicle_number, fv.make, fv.model
        FROM fleet_assignments fa
        JOIN units u ON fa.unit_id = u.id
        JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
        WHERE u.officer_id = ?
        ORDER BY fa.assigned_at DESC LIMIT 20`, officerId),
      queryFirst<Record<string, unknown>>(db, `
        SELECT COUNT(*) as fuel_entries,
          SUM(ff.cost) as total_fuel_cost,
          SUM(ff.gallons) as total_gallons,
          AVG(ff.cost_per_gallon) as avg_cost_per_gallon
        FROM fleet_fuel_log ff
        JOIN fleet_vehicles fv ON ff.vehicle_id = fv.id
        JOIN units u ON fv.assigned_unit_id = u.id
        WHERE u.officer_id = ?`, officerId),
      query<Record<string, unknown>>(db, `
        SELECT fm.id, fm.vehicle_id, fm.service_type, fm.description,
          fm.cost, COALESCE(fm.performed_at, fm.service_date) as date, fm.vendor, fm.mileage_at_service,
          fv.vehicle_number
        FROM fleet_maintenance fm
        JOIN fleet_vehicles fv ON fm.vehicle_id = fv.id
        JOIN units u ON fv.assigned_unit_id = u.id
        WHERE u.officer_id = ?
        ORDER BY date DESC LIMIT 10`, officerId),
    ]);

    return c.json({
      officer_id: officerId,
      current_vehicle: currentVehicle,
      assignment_history: assignmentHistory,
      fuel: fuelUsage,
      recent_maintenance: maintenanceEvents,
    });
  } catch (err) {
    console.error('GET /personnel/:id/fleet-summary error:', err);
    return c.json({ error: 'Failed to fetch fleet summary' }, 500);
  }
});

export default personnel;
