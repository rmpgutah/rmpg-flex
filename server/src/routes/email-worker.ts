// Email routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, safeStr } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountEmailRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/email/unread-count
  api.get('/unread-count', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const row = await db.prepare("SELECT COUNT(*) as count FROM email_cache WHERE folder_id = 'inbox' AND is_read = 0 AND owner_user_id = ?").get(user.userId) as any;
      return c.json({ count: row?.count || 0 });
    } catch {
      return c.json({ count: 0 });
    }
  });

  // GET /api/email/status
  api.get('/status', async (c) => {
    try {
      const user = c.get('user');
      const db = new D1Db(c.env.DB);
      const cached = await db.prepare('SELECT COUNT(*) as count FROM email_cache WHERE owner_user_id = ?').get(user.userId) as any;
      return c.json({
        connected: false,
        enrolled: false,
        mailbox: null,
        cachedMessages: cached?.count || 0,
        provider: 'microsoft_graph',
        lastSync: null,
        error: 'Email sync requires desktop application or local server',
      });
    } catch {
      return c.json({ connected: false, enrolled: false, mailbox: null, cachedMessages: 0 });
    }
  });

  // GET /api/email/oauth/authorize
  api.get('/oauth/authorize', async (c) => {
    const url = c.env.PRIMARY_DOMAIN
      ? `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=CONFIGURE_ME&response_type=code&redirect_uri=https://${c.env.PRIMARY_DOMAIN}/api/email/oauth/callback&scope=Mail.ReadWrite%20Mail.Send%20User.Read%20offline_access`
      : '';
    return c.json({ authorizationUrl: url });
  });

  // GET /api/email/signature
  api.get('/signature', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const row = await db.prepare('SELECT email_signature FROM users WHERE id = ?').get(user.userId) as any;
      return c.json({ signature: row?.email_signature || '' });
    } catch {
      return c.json({ signature: '' });
    }
  });

  // PUT /api/email/signature
  api.put('/signature', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const { signature } = await c.req.json();
      if (signature !== undefined && typeof signature !== 'string') {
        return c.json({ error: 'Signature must be a string', code: 'SIGNATURE_MUST_BE_A' }, 400);
      }
      await db.prepare('UPDATE users SET email_signature = ?, updated_at = ? WHERE id = ?').run(signature || '', localNow(), user.userId);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to save signature' }, 500);
    }
  });

  // ─── Email Rules (mounted at /api/email/rules/*) ──────────────
  const rulesApi = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  rulesApi.use('/*', authenticateToken);

  // GET /api/email/rules
  rulesApi.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const rows = await db.prepare(
      'SELECT * FROM email_rules WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY priority ASC, id ASC'
    ).all(user.userId);
    return c.json(rows);
  });

  // POST /api/email/rules
  rulesApi.post('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const { name, priority = 100, enabled = 1, conditions, actions, global = false } = await c.req.json();
    if (!name || !conditions || !actions) {
      return c.json({ error: 'name, conditions, actions required' }, 400);
    }
    const isAdmin = user.role === 'admin' || user.role === 'manager';
    if (global && !isAdmin) return c.json({ error: 'Only admins can create global rules' }, 403);
    const ownerUserId = global ? null : user.userId;
    const now = localNow();
    const result = await db.prepare(
      `INSERT INTO email_rules (name, priority, enabled, conditions_json, actions_json, created_by, created_at, updated_at, owner_user_id)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(name, priority, enabled ? 1 : 0, JSON.stringify(conditions), JSON.stringify(actions), user.userId, now, now, ownerUserId);
    return c.json({ id: Number(result.meta.last_row_id), global: ownerUserId === null }, 201);
  });

  // PUT /api/email/rules/:id
  rulesApi.put('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const { name, priority, enabled, conditions, actions } = await c.req.json();
    const existing = await db.prepare('SELECT * FROM email_rules WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'not found' }, 404);
    if (existing.owner_user_id !== null && existing.owner_user_id !== user.userId) return c.json({ error: 'forbidden' }, 403);
    if (existing.owner_user_id === null && user.role !== 'admin' && user.role !== 'manager') return c.json({ error: 'forbidden' }, 403);
    await db.prepare(
      `UPDATE email_rules SET name=?, priority=?, enabled=?, conditions_json=?, actions_json=?, updated_at=? WHERE id=?`
    ).run(name, priority, enabled ? 1 : 0, JSON.stringify(conditions), JSON.stringify(actions), localNow(), id);
    return c.json({ success: true });
  });

  // DELETE /api/email/rules/:id
  rulesApi.delete('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT * FROM email_rules WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'not found' }, 404);
    if (existing.owner_user_id !== null && existing.owner_user_id !== user.userId) return c.json({ error: 'forbidden' }, 403);
    if (existing.owner_user_id === null && user.role !== 'admin' && user.role !== 'manager') return c.json({ error: 'forbidden' }, 403);
    await db.prepare('DELETE FROM email_rules WHERE id = ?').run(id);
    return c.json({ success: true });
  });

  // POST /api/email/rules/test-match
  rulesApi.post('/test-match', async (c) => {
    const { conditions } = await c.req.json();
    if (!conditions) return c.json({ error: 'conditions required' }, 400);
    return c.json({ matches: false, note: 'Rule test-match requires email poller to be running locally' });
  });

  app.route('/api/email/rules', rulesApi);

  app.route('/api/email', api);
}
