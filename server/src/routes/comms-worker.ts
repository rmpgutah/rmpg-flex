// Comms routes for Workers (bolos, activity feed)
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow, paramNum } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

export function mountCommsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/comms/bolos/active
  api.get('/bolos/active', async (c) => {
    const db = new D1Db(c.env.DB);
    const bolos = await db.prepare(`
      SELECT b.*, u.full_name as issued_by_name FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.status = 'active' AND (b.expires_at IS NULL OR b.expires_at > ?)
      ORDER BY CASE b.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END, b.created_at DESC
      LIMIT 1000
    `).all(localNow());
    return c.json(bolos);
  });

  // GET /api/comms/radio-channels — active radio channels for the UI
  api.get('/radio-channels', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(
        "SELECT config_key, config_value, sort_order FROM system_config WHERE category = 'radio_channel' AND is_active = 1 ORDER BY sort_order ASC"
      ).all() as any[];
      if (rows.length > 0) {
        const channels = rows.map((r: any) => {
          try {
            const meta = JSON.parse(r.config_value);
            return { id: r.config_key, label: meta.label || r.config_key.toUpperCase(), freq: meta.freq || '0.000', sort_order: r.sort_order };
          } catch {
            return { id: r.config_key, label: r.config_key.toUpperCase(), freq: '0.000', sort_order: r.sort_order };
          }
        });
        return c.json(channels);
      }
      return c.json([
        { id: 'dispatch', label: 'DISPATCH', freq: '155.010', sort_order: 0 },
        { id: 'tac-1',    label: 'TAC-1',    freq: '155.475', sort_order: 1 },
        { id: 'tac-2',    label: 'TAC-2',    freq: '155.730', sort_order: 2 },
        { id: 'tac-3',    label: 'TAC-3',    freq: '156.090', sort_order: 3 },
        { id: 'patrol',   label: 'PATROL',   freq: '156.240', sort_order: 4 },
        { id: 'admin',    label: 'ADMIN',    freq: '158.985', sort_order: 5 },
      ]);
    } catch (error: any) {
      return c.json({ error: 'Failed to load radio channels', code: 'RADIO_CHANNELS_ERROR' }, 500);
    }
  });

  // GET /api/comms/activity-feed
  api.get('/activity-feed', async (c) => {
    const db = new D1Db(c.env.DB);
    const { limit = '50', offset = '0', entityType } = c.req.query();
    const limitNum = Math.min(100000, Math.max(1, parseInt(limit, 10) || 100000));
    const offsetNum = parseInt(offset, 10) || 0;

    let whereClause = '';
    const params: any[] = [];
    if (entityType) { whereClause = 'WHERE al.entity_type = ?'; params.push(entityType); }

    const countRow = await db.prepare(`SELECT COUNT(*) as total FROM activity_log al ${whereClause}`).get(...params) as any;
    const activity = await db.prepare(`
      SELECT al.*, u.full_name as user_name, u.badge_number, u.role as user_role
      FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
      ${whereClause} ORDER BY al.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offsetNum);

    return c.json({ data: activity, total: (countRow as any)?.total ?? 0, limit: limitNum, offset: offsetNum });
  });

  // POST /api/comms/messages - Send a message
  api.post('/messages', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { to_user_id, channel, content, priority, subject, parent_id } = body;

    if (!content) return c.json({ error: 'content is required', code: 'MISSING_CONTENT' }, 400);

    const cleanContent = typeof content === 'string' ? content.trim() : content;
    if (typeof cleanContent === 'string' && cleanContent.length === 0) {
      return c.json({ error: 'content cannot be empty', code: 'EMPTY_CONTENT' }, 400);
    }
    if (typeof content === 'string' && content.length > 10000) {
      return c.json({ error: 'content must be 10000 characters or less', code: 'CONTENT_TOO_LONG' }, 400);
    }

    const validChannels = ['direct', 'dispatch', 'broadcast', 'zone'];
    const msgChannel = channel || 'direct';
    if (!validChannels.includes(msgChannel)) {
      return c.json({ error: 'Invalid channel', valid: validChannels }, 400);
    }

    if (msgChannel === 'direct' && !to_user_id) {
      return c.json({ error: 'to_user_id is required for direct messages', code: 'TOUSERID_IS_REQUIRED_FOR' }, 400);
    }

    if (['broadcast', 'dispatch'].includes(msgChannel) && !['admin', 'manager', 'dispatcher', 'supervisor'].includes(user.role)) {
      return c.json({ error: 'Insufficient permissions for broadcast/dispatch messages', code: 'INSUFFICIENT_PERMISSIONS_FOR_BROADCASTDISPATCH' }, 403);
    }

    let threadId: number | null = null;
    if (parent_id) {
      const parent = await db.prepare('SELECT id, thread_id FROM messages WHERE id = ?').get(parent_id) as any;
      if (parent) {
        threadId = parent.thread_id || parent.id;
      }
    }

    const result = await db.prepare(
      'INSERT INTO messages (from_user_id, to_user_id, channel, content, priority, subject, parent_id, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, to_user_id || null, msgChannel, content, priority || 'routine', subject || null, parent_id || null, threadId);

    const message = await db.prepare(
      'SELECT m.*, u.full_name as from_name FROM messages m LEFT JOIN users u ON m.from_user_id = u.id WHERE m.id = ?'
    ).get(Number(result.meta.last_row_id));

    await auditLog(db, c, 'message_sent', 'message', Number(result.meta.last_row_id), `Sent ${msgChannel} message`);
    return c.json({ data: message }, 201);
  });

  // POST /api/comms/bolos - Create a BOLO
  api.post('/bolos', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { type, title, description, subject_description, vehicle_description, photo_url, priority, expires_at } = body;

    if (!type || !title) {
      return c.json({ error: 'type and title are required', code: 'TYPE_AND_TITLE_ARE' }, 400);
    }

    const lastBolo = await db.prepare('SELECT bolo_number FROM bolos ORDER BY id DESC LIMIT 1').get() as any;
    let nextNum = 1;
    if (lastBolo) {
      const parts = lastBolo.bolo_number.split('-');
      const parsed = parseInt(parts[1], 10);
      nextNum = isNaN(parsed) ? 1 : parsed + 1;
    }
    const boloNumber = `BOLO-${String(nextNum).padStart(3, '0')}`;

    const result = await db.prepare(
      'INSERT INTO bolos (bolo_number, type, title, description, subject_description, vehicle_description, photo_url, priority, issued_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(boloNumber, type, title, description || null, subject_description || null, vehicle_description || null, photo_url || null, priority || 'P3', user.userId, expires_at || null);

    const bolo = await db.prepare(
      'SELECT b.*, u.full_name as issued_by_name FROM bolos b LEFT JOIN users u ON b.issued_by = u.id WHERE b.id = ?'
    ).get(Number(result.meta.last_row_id));

    await auditLog(db, c, 'bolo_created', 'bolo', Number(result.meta.last_row_id), `Created BOLO: ${title}`);
    return c.json(bolo, 201);
  });

  // POST /api/comms/bolos/:id/archive
  api.post('/bolos/:id/archive', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const bolo = await db.prepare('SELECT * FROM bolos WHERE id = ?').get(id) as any;
    if (!bolo) return c.json({ error: 'BOLO not found', code: 'BOLO_NOT_FOUND' }, 404);
    if (bolo.archived_at) return c.json({ error: 'BOLO is already archived', code: 'BOLO_IS_ALREADY_ARCHIVED' }, 400);

    const now = localNow();
    await db.prepare('UPDATE bolos SET archived_at = ? WHERE id = ?').run(now, id);
    await auditLog(db, c, 'bolo_archived', 'bolo', id, `Archived BOLO: ${bolo.title}`);

    const updated = await db.prepare(
      'SELECT b.*, u.full_name as issued_by_name FROM bolos b LEFT JOIN users u ON b.issued_by = u.id WHERE b.id = ?'
    ).get(id);
    return c.json(updated);
  });

  app.route('/api/comms', api);
}
