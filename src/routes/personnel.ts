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
// PersonnelAnalyticsDashboard shows hours-by-officer over a rolling window.
// No dedicated duty-hours/timeclock table on live D1 yet; derive a minimal
// shape from unit status changes if any exist, else return zeros. The
// component reads `entries[]` + `totals` so both keys must be present.
personnel.get('/duty-hours', async (c) => {
  try {
    const db = getDb(c.env);
    const officers = await query<{ id: number; full_name: string; badge_number: string }>(
      db, "SELECT id, full_name, badge_number FROM users WHERE status = 'active' ORDER BY full_name");
    const entries = officers.map(o => ({
      officer_id: o.id,
      officer_name: o.full_name,
      badge_number: o.badge_number,
      total_hours: 0,
      shifts_completed: 0,
    }));
    return c.json({
      entries,
      totals: { totalHours: 0, totalOfficers: entries.length },
      period_days: parseInt(c.req.query('period') || '14', 10),
    });
  } catch (err) {
    return c.json({ entries: [], totals: { totalHours: 0, totalOfficers: 0 } }, 200);
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

export default personnel;
