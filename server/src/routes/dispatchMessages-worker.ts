import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

export function mountDispatchMessagesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/dispatch-messages — List messages for current user
  api.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const userId = user.userId;
    const q = c.req.query();
    const { channel, call_id, limit: limitStr = '50' } = q;
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limitStr as string, 10)) || 100000));

    try {
      let userUnitId: number | null = null;
      try {
        const unitRow = await db.prepare(
          `SELECT id FROM dispatch_units WHERE officer_id = ? AND status != 'off_duty' LIMIT 1`
        ).get(userId) as any;
        if (unitRow) userUnitId = unitRow.id;
      } catch { /* dispatch_units may not exist */ }

      let where = 'WHERE (dm.recipient_id = ?';
      const params: any[] = [userId];

      if (userUnitId) {
        where += ' OR dm.recipient_unit_id = ?';
        params.push(userUnitId);
      }
      where += ')';

      if (channel) {
        where += ' AND dm.channel = ?';
        params.push(channel);
      }
      if (call_id) {
        where += ' AND dm.call_id = ?';
        params.push(call_id);
      }

      const rows = await db.prepare(`
        SELECT dm.*,
          sender.full_name as sender_name,
          recipient.full_name as recipient_name
        FROM dispatch_messages dm
        LEFT JOIN users sender ON dm.sender_id = sender.id
        LEFT JOIN users recipient ON dm.recipient_id = recipient.id
        ${where}
        ORDER BY dm.created_at DESC
        LIMIT ?
      `).all(...params, limitNum);

      return c.json({ data: rows });
    } catch (err: any) {
      return c.json({ error: 'Failed to list messages', code: 'LIST_MSG_ERROR' }, 500);
    }
  });

  // GET /api/dispatch-messages/unread-count
  api.get('/unread-count', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const userId = user.userId;

    try {
      const row = await db.prepare(
        `SELECT COUNT(*) as count FROM dispatch_messages
         WHERE recipient_id = ? AND read_at IS NULL`
      ).get(userId) as any;

      return c.json({ count: row?.count ?? 0 });
    } catch (err: any) {
      return c.json({ error: 'Failed to get unread count', code: 'UNREAD_COUNT_ERROR' }, 500);
    }
  });

  // GET /api/dispatch-messages/by-call/:callId
  api.get('/by-call/:callId', async (c) => {
    const db = new D1Db(c.env.DB);
    const callId = paramNum(c.req.param('callId'));
    if (isNaN(callId)) {
      return c.json({ error: 'Invalid call ID', code: 'INVALID_CALL_ID' }, 400);
    }

    try {
      const rows = await db.prepare(`
        SELECT dm.*,
          sender.full_name as sender_name,
          recipient.full_name as recipient_name
        FROM dispatch_messages dm
        LEFT JOIN users sender ON dm.sender_id = sender.id
        LEFT JOIN users recipient ON dm.recipient_id = recipient.id
        WHERE dm.call_id = ?
        ORDER BY dm.created_at ASC
      `).all(callId);

      return c.json({ data: rows });
    } catch (err: any) {
      return c.json({ error: 'Failed to get messages for call', code: 'BY_CALL_MSG_ERROR' }, 500);
    }
  });

  // POST /api/dispatch-messages — Send a message
  api.post('/', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const senderId = user.userId;
    const now = localNow();

    const body = await c.req.json();
    const { recipient_id, recipient_unit_id, channel, call_id, text } = body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return c.json({ error: 'text is required', code: 'MISSING_TEXT' }, 400);
    }
    if (!recipient_id && !recipient_unit_id) {
      return c.json({ error: 'recipient_id or recipient_unit_id is required', code: 'MISSING_RECIPIENT' }, 400);
    }

    try {
      const result = await db.prepare(`
        INSERT INTO dispatch_messages (
          sender_id, recipient_id, recipient_unit_id,
          channel, call_id, text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        senderId,
        recipient_id || null,
        recipient_unit_id || null,
        channel || 'general',
        call_id || null,
        text.trim(),
        now,
      );

      const newId = Number(result.meta.last_row_id);
      const created = await db.prepare(`
        SELECT dm.*, sender.full_name as sender_name
        FROM dispatch_messages dm
        LEFT JOIN users sender ON dm.sender_id = sender.id
        WHERE dm.id = ?
      `).get(newId);

      // broadcast('dispatch', 'dispatch_message', created); — skipped in Workers
      return c.json({ data: created }, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to send message', code: 'SEND_MSG_ERROR' }, 500);
    }
  });

  // PUT /api/dispatch-messages/:id/read
  api.put('/:id/read', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const userId = user.userId;

    if (isNaN(id)) {
      return c.json({ error: 'Invalid message ID', code: 'INVALID_MSG_ID' }, 400);
    }

    try {
      const msg = await db.prepare(
        'SELECT id, recipient_id FROM dispatch_messages WHERE id = ?'
      ).get(id) as any;

      if (!msg) {
        return c.json({ error: 'Message not found', code: 'MSG_NOT_FOUND' }, 404);
      }
      if (msg.recipient_id !== userId) {
        return c.json({ error: 'Not the recipient of this message', code: 'NOT_RECIPIENT' }, 403);
      }

      await db.prepare('UPDATE dispatch_messages SET read_at = ? WHERE id = ?').run(localNow(), id);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to mark message as read', code: 'MARK_READ_ERROR' }, 500);
    }
  });

  // POST /api/dispatch-messages/mark-all-read
  api.post('/mark-all-read', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const userId = user.userId;
    const now = localNow();

    try {
      const result = await db.prepare(
        'UPDATE dispatch_messages SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL'
      ).run(now, userId);

      return c.json({ success: true, updated: result.meta.changes });
    } catch (err: any) {
      return c.json({ error: 'Failed to mark all as read', code: 'MARK_ALL_READ_ERROR' }, 500);
    }
  });

  // DELETE /api/dispatch-messages/:id
  api.delete('/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const userId = user.userId;
    const role = user.role;

    if (isNaN(id)) {
      return c.json({ error: 'Invalid message ID', code: 'INVALID_MSG_ID' }, 400);
    }

    try {
      const msg = await db.prepare(
        'SELECT id, sender_id FROM dispatch_messages WHERE id = ?'
      ).get(id) as any;

      if (!msg) {
        return c.json({ error: 'Message not found', code: 'MSG_NOT_FOUND' }, 404);
      }
      if (msg.sender_id !== userId && role !== 'admin') {
        return c.json({ error: 'Only the sender or admin can delete this message', code: 'FORBIDDEN' }, 403);
      }

      await db.prepare('DELETE FROM dispatch_messages WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete message', code: 'DELETE_MSG_ERROR' }, 500);
    }
  });

  app.route('/api/dispatch-messages', api);
}
