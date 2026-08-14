import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const ADMIN_ROLES = ['admin', 'manager', 'supervisor'] as const;
const ALL_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// Officers can only create notify_officer rules for themselves
const OFFICER_ALLOWED_ACTIONS = ['notify_officer'];
const OFFICER_ALLOWED_TRIGGERS = ['call_proximity', 'no_movement', 'low_accuracy', 'speed_threshold'];

const router = new Hono<Env>();

router.get('/', requireRole(...ALL_ROLES), async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const role = (c.get('user') as { role: string } | undefined)?.role ?? '';
  const isAdmin = ADMIN_ROLES.includes(role as any);

  const rows = isAdmin
    ? await query(db,
        `SELECT ar.*, u.full_name AS created_by_name
         FROM automation_rules ar
         LEFT JOIN users u ON u.id = ar.created_by
         ORDER BY ar.created_at DESC`)
    : await query(db,
        `SELECT ar.*, u.full_name AS created_by_name
         FROM automation_rules ar
         LEFT JOIN users u ON u.id = ar.created_by
         WHERE ar.scope = 'global'
            OR (ar.scope = 'user' AND ar.scope_id = ?)
         ORDER BY ar.created_at DESC`,
        userId);

  return c.json({ rules: rows });
});

router.post('/', requireRole(...ALL_ROLES), async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const role = (c.get('user') as { role: string } | undefined)?.role ?? '';
  const isAdmin = ADMIN_ROLES.includes(role as any);
  const body = await c.req.json<{
    name: string; description?: string; scope?: string; scope_id?: number;
    trigger_type: string; trigger_config?: object; action_type: string;
    action_config?: object; dedup_window_ms?: number;
    evaluate_client?: number; evaluate_server?: number;
  }>();

  if (!body.name || !body.trigger_type || !body.action_type) {
    return c.json({ error: 'name, trigger_type, and action_type are required' }, 400);
  }

  // Officers restricted to personal rules with safe action/trigger types
  if (!isAdmin) {
    if (!OFFICER_ALLOWED_ACTIONS.includes(body.action_type)) {
      return c.json({ error: 'Officers may only create notify_officer rules' }, 403);
    }
    if (!OFFICER_ALLOWED_TRIGGERS.includes(body.trigger_type)) {
      return c.json({ error: 'Trigger type not permitted for officer rules' }, 403);
    }
    body.scope = 'user';
    body.scope_id = userId;
  }

  try {
    const result = await db.prepare(
      `INSERT INTO automation_rules
       (name, description, created_by, scope, scope_id, trigger_type, trigger_config,
        action_type, action_config, dedup_window_ms, evaluate_client, evaluate_server)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      body.name, body.description ?? null, userId,
      body.scope ?? 'global', body.scope_id ?? null,
      body.trigger_type, JSON.stringify(body.trigger_config ?? {}),
      body.action_type, JSON.stringify(body.action_config ?? {}),
      body.dedup_window_ms ?? 300000,
      body.evaluate_client ?? 1, body.evaluate_server ?? 1,
    ).run();
    return c.json({ id: result.meta.last_row_id }, 201);
  } catch (err) {
    log.error('POST /automation-rules failed', {}, err);
    return c.json({ error: 'Insert failed' }, 500);
  }
});

router.put('/:id', requireRole(...ALL_ROLES), async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const role = (c.get('user') as { role: string } | undefined)?.role ?? '';
  const isAdmin = ADMIN_ROLES.includes(role as any);
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const existing = await queryFirst<{ created_by: number; scope: string; scope_id: number | null }>(
    db, `SELECT created_by, scope, scope_id FROM automation_rules WHERE id = ?`, id,
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  // Officers may only edit their own user-scoped rules
  if (!isAdmin && (existing.scope !== 'user' || existing.scope_id !== userId)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<Partial<{
    name: string; description: string; enabled: number;
    trigger_type: string; trigger_config: object;
    action_type: string; action_config: object;
    dedup_window_ms: number; evaluate_client: number; evaluate_server: number;
  }>>();

  if (!isAdmin && body.action_type && !OFFICER_ALLOWED_ACTIONS.includes(body.action_type)) {
    return c.json({ error: 'Officers may only use notify_officer action' }, 403);
  }
  if (!isAdmin && body.trigger_type && !OFFICER_ALLOWED_TRIGGERS.includes(body.trigger_type)) {
    return c.json({ error: 'Trigger type not permitted for officer rules' }, 403);
  }

  await db.prepare(
    `UPDATE automation_rules SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       enabled = COALESCE(?, enabled),
       trigger_type = COALESCE(?, trigger_type),
       trigger_config = COALESCE(?, trigger_config),
       action_type = COALESCE(?, action_type),
       action_config = COALESCE(?, action_config),
       dedup_window_ms = COALESCE(?, dedup_window_ms),
       evaluate_client = COALESCE(?, evaluate_client),
       evaluate_server = COALESCE(?, evaluate_server),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    body.name ?? null, body.description ?? null, body.enabled ?? null,
    body.trigger_type ?? null,
    body.trigger_config ? JSON.stringify(body.trigger_config) : null,
    body.action_type ?? null,
    body.action_config ? JSON.stringify(body.action_config) : null,
    body.dedup_window_ms ?? null,
    body.evaluate_client ?? null, body.evaluate_server ?? null,
    id,
  ).run();

  return c.json({ success: true });
});

router.delete('/:id', requireRole(...ALL_ROLES), async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const role = (c.get('user') as { role: string } | undefined)?.role ?? '';
  const isAdmin = ADMIN_ROLES.includes(role as any);
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  if (!isAdmin) {
    const existing = await queryFirst<{ scope: string; scope_id: number | null }>(
      db, `SELECT scope, scope_id FROM automation_rules WHERE id = ?`, id,
    );
    if (!existing || existing.scope !== 'user' || existing.scope_id !== userId) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  await db.prepare(`DELETE FROM automation_rules WHERE id = ?`).bind(id).run();
  return c.json({ success: true });
});

router.get('/firings', requireRole(...ADMIN_ROLES), async (c) => {
  const db = getDb(c.env);
  const rows = await query(db,
    `SELECT arf.*, ar.name AS rule_name, u.full_name AS officer_name
     FROM automation_rule_firings arf
     JOIN automation_rules ar ON ar.id = arf.rule_id
     JOIN users u ON u.id = arf.user_id
     ORDER BY arf.fired_at DESC LIMIT 500`,
  );
  return c.json({ firings: rows });
});

export default router;
