import { Hono } from 'hono';
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
