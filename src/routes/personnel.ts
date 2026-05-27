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

// GET /personnel
personnel.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { status, role } = c.req.query();
    let sql = 'SELECT id, username, full_name, role, badge_number, phone, email, status FROM users WHERE 1=1';
    const params: unknown[] = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (role) { sql += ' AND role = ?'; params.push(role); }
    sql += ' ORDER BY full_name';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

// GET /personnel/credentials
personnel.get('/credentials', async (c) => {
  return c.json([]);
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

// ── GET /personnel/time?start_date=...&end_date=...&officer_id=... ─
personnel.get('/time', async (c) => {
  const denied = requireManager(c);
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

    setCols.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE users SET ${setCols.join(', ')} WHERE id = ?`;
    bindings.push(targetId);
    await execute(db, sql, ...bindings);

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

export default personnel;
