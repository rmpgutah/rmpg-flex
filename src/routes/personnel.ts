import { Hono } from 'hono';
import { hashSync } from 'bcryptjs';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const personnel = new Hono<Env>();

// Columns a self-edit OR a manager-edit can touch. Order doesn't
// matter — present keys become SET fragments below. Excludes
// security-sensitive fields (password_hash, totp_*, role, status)
// which have their own gates further down.
const EDITABLE_COLUMNS = [
  'full_name', 'first_name', 'middle_name', 'last_name',
  'email', 'phone', 'badge_number', 'rank', 'department',
  'employee_id', 'hire_date', 'termination_date', 'shift_preference',
  'address', 'city', 'state', 'zip', 'date_of_birth',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'blood_type', 'allergies', 'uniform_size',
  'dl_number', 'dl_state', 'dl_expiry',
  'certifications', 'notes', 'profile_image',
  'voice_persona', 'voice_rate', 'voice_pitch', 'voice_terseness', 'voice_brain_enabled',
  'theme_preference', 'font_size_preference',
];

const MANAGER_ROLES = ['admin', 'manager', 'supervisor'];

// Sanitized projection — keeps password_hash, totp_secret_enc,
// totp_pending_secret, totp_backup_codes, password_history out
// of every response. Any new sensitive column added to `users`
// stays excluded by default until added here explicitly.
const USER_PUBLIC_COLUMNS = [
  'id', 'username', 'full_name', 'first_name', 'middle_name', 'last_name',
  'email', 'role', 'badge_number', 'phone', 'status', 'avatar_url', 'photo',
  'rank', 'department', 'employee_id', 'assigned_unit_id',
  'hire_date', 'termination_date', 'shift_preference',
  'address', 'city', 'state', 'zip', 'date_of_birth',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
  'blood_type', 'allergies', 'uniform_size', 'dl_number', 'dl_state', 'dl_expiry',
  'certifications', 'notes', 'profile_image', 'last_login_at', 'login_count',
  'voice_persona', 'voice_rate', 'voice_pitch', 'voice_terseness', 'voice_brain_enabled',
  'theme_preference', 'font_size_preference',
  'created_at', 'updated_at',
].join(', ');

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

export default personnel;

// GET /personnel/credentials
personnel.get('/credentials', async (c) => {
  return c.json([]);
});

// PUT /personnel/:id — update a user row.
//
// Authorization layers:
//   - bare auth (Hono middleware in routesConfig) ensures a JWT
//   - manager roles (admin/manager/supervisor) can edit anyone
//   - any user can edit their own row (themed prefs, contact info)
//   - `role`     changes are admin-only AND cannot self-promote
//   - `status`   changes require a manager role
//   - `password` resets require a manager role (force-change on
//     next login is set automatically)
//
// Body shape comes from client/src/pages/AdminPage.tsx
// handleUserSubmit (~line 395). Unknown keys are ignored silently
// because the field allowlist is the authoritative gate — that
// way an outdated client sending extra keys doesn't 400.
personnel.put('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number; role: string };

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const isSelf = user.id === id;
  const isManager = MANAGER_ROLES.includes(user.role);
  if (!isSelf && !isManager) {
    return c.json({ error: 'Insufficient permissions to edit this user' }, 403);
  }

  const sets: string[] = [];
  const bindings: unknown[] = [];

  for (const col of EDITABLE_COLUMNS) {
    if (col in body && body[col] !== undefined) {
      sets.push(`${col} = ?`);
      bindings.push(body[col]);
    }
  }

  // Role changes: admin only, never self-promote
  if ('role' in body && body.role !== undefined && body.role !== null) {
    if (user.role !== 'admin') {
      return c.json({ error: 'Only admins can change role' }, 403);
    }
    if (isSelf) {
      return c.json({ error: 'Cannot change your own role' }, 403);
    }
    sets.push('role = ?');
    bindings.push(body.role);
  }

  // Status changes: manager-only
  if ('status' in body && body.status !== undefined && body.status !== null) {
    if (!isManager) {
      return c.json({ error: 'Only admins/managers can change status' }, 403);
    }
    sets.push('status = ?');
    bindings.push(body.status);
  }

  // Password resets: manager-only, sets must_change_password so
  // the affected user is forced through a self-chosen password
  // on next login rather than running with one a manager knows.
  if ('password' in body && typeof body.password === 'string' && body.password.length > 0) {
    if (!isManager) {
      return c.json({ error: 'Only admins/managers can reset passwords' }, 403);
    }
    const password_hash = hashSync(body.password, 10);
    sets.push('password_hash = ?', 'must_change_password = ?', 'password_changed_at = CURRENT_TIMESTAMP');
    bindings.push(password_hash, 1);
  }

  if (sets.length === 0) {
    return c.json({ error: 'No editable fields provided' }, 400);
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  bindings.push(id);

  const db = getDb(c.env);
  try {
    const result = await execute(
      db,
      `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      ...bindings
    );
    if (!result.meta?.changes) {
      return c.json({ error: 'User not found' }, 404);
    }

    const updated = await queryFirst(
      db,
      `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`,
      id
    );
    return c.json(updated);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Update failed' },
      500
    );
  }
});
