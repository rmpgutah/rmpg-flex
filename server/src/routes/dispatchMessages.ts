import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { apiRateLimit } from '../middleware/rateLimiter';
import { localNow } from '../utils/timeUtils';
import { broadcast } from '../utils/websocket';

const router = Router();
router.use(apiRateLimit);
router.use(authenticateToken);

// ─── GET / — List messages for current user ──────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const { channel, call_id, limit: limitStr = '50' } = req.query;
    const limitNum = Math.min(200, Math.max(1, parseInt(limitStr as string, 10) || 50));

    // Get the user's assigned unit ID (if any)
    let userUnitId: number | null = null;
    try {
      const unitRow = db.prepare(
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

    const rows = db.prepare(`
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

    res.json({ data: rows });
  } catch (err: any) {
    console.error('[DispatchMessages] List error:', err?.message);
    res.status(500).json({ error: 'Failed to list messages', code: 'LIST_MSG_ERROR' });
  }
});

// ─── GET /unread-count — Count of unread messages ────────────
router.get('/unread-count', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const row = db.prepare(
      `SELECT COUNT(*) as count FROM dispatch_messages
       WHERE recipient_id = ? AND read_at IS NULL`
    ).get(userId) as any;

    res.json({ count: row.count });
  } catch (err: any) {
    console.error('[DispatchMessages] Unread count error:', err?.message);
    res.status(500).json({ error: 'Failed to get unread count', code: 'UNREAD_COUNT_ERROR' });
  }
});

// ─── GET /by-call/:callId — All messages for a call ──────────
router.get('/by-call/:callId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const callId = parseInt(req.params.callId as string, 10);
    if (isNaN(callId)) {
      res.status(400).json({ error: 'Invalid call ID', code: 'INVALID_CALL_ID' });
      return;
    }

    const rows = db.prepare(`
      SELECT dm.*,
        sender.full_name as sender_name,
        recipient.full_name as recipient_name
      FROM dispatch_messages dm
      LEFT JOIN users sender ON dm.sender_id = sender.id
      LEFT JOIN users recipient ON dm.recipient_id = recipient.id
      WHERE dm.call_id = ?
      ORDER BY dm.created_at ASC
    `).all(callId);

    res.json({ data: rows });
  } catch (err: any) {
    console.error('[DispatchMessages] By-call error:', err?.message);
    res.status(500).json({ error: 'Failed to get messages for call', code: 'BY_CALL_MSG_ERROR' });
  }
});

// ─── POST / — Send a message ─────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const senderId = req.user!.userId;
    const now = localNow();

    const { recipient_id, recipient_unit_id, channel, call_id, text } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required', code: 'MISSING_TEXT' });
      return;
    }
    if (!recipient_id && !recipient_unit_id) {
      res.status(400).json({ error: 'recipient_id or recipient_unit_id is required', code: 'MISSING_RECIPIENT' });
      return;
    }

    const result = db.prepare(`
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

    const newId = result.lastInsertRowid as number;
    const created = db.prepare(`
      SELECT dm.*, sender.full_name as sender_name
      FROM dispatch_messages dm
      LEFT JOIN users sender ON dm.sender_id = sender.id
      WHERE dm.id = ?
    `).get(newId);

    broadcast('dispatch', 'dispatch_message', created);
    res.status(201).json({ data: created });
  } catch (err: any) {
    console.error('[DispatchMessages] Send error:', err?.message);
    res.status(500).json({ error: 'Failed to send message', code: 'SEND_MSG_ERROR' });
  }
});

// ─── PUT /:id/read — Mark a single message as read ──────────
router.put('/:id/read', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid message ID', code: 'INVALID_MSG_ID' });
      return;
    }

    const msg = db.prepare(
      'SELECT id, recipient_id FROM dispatch_messages WHERE id = ?'
    ).get(id) as any;

    if (!msg) {
      res.status(404).json({ error: 'Message not found', code: 'MSG_NOT_FOUND' });
      return;
    }
    if (msg.recipient_id !== userId) {
      res.status(403).json({ error: 'Not the recipient of this message', code: 'NOT_RECIPIENT' });
      return;
    }

    db.prepare('UPDATE dispatch_messages SET read_at = ? WHERE id = ?').run(localNow(), id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[DispatchMessages] Mark read error:', err?.message);
    res.status(500).json({ error: 'Failed to mark message as read', code: 'MARK_READ_ERROR' });
  }
});

// ─── POST /mark-all-read — Mark all unread messages as read ──
router.post('/mark-all-read', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const now = localNow();

    const result = db.prepare(
      'UPDATE dispatch_messages SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL'
    ).run(now, userId);

    res.json({ success: true, updated: result.changes });
  } catch (err: any) {
    console.error('[DispatchMessages] Mark all read error:', err?.message);
    res.status(500).json({ error: 'Failed to mark all as read', code: 'MARK_ALL_READ_ERROR' });
  }
});

// ─── DELETE /:id — Delete message (sender or admin only) ─────
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const userId = req.user!.userId;
    const role = req.user!.role;

    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid message ID', code: 'INVALID_MSG_ID' });
      return;
    }

    const msg = db.prepare(
      'SELECT id, sender_id FROM dispatch_messages WHERE id = ?'
    ).get(id) as any;

    if (!msg) {
      res.status(404).json({ error: 'Message not found', code: 'MSG_NOT_FOUND' });
      return;
    }
    if (msg.sender_id !== userId && role !== 'admin') {
      res.status(403).json({ error: 'Only the sender or admin can delete this message', code: 'FORBIDDEN' });
      return;
    }

    db.prepare('DELETE FROM dispatch_messages WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[DispatchMessages] Delete error:', err?.message);
    res.status(500).json({ error: 'Failed to delete message', code: 'DELETE_MSG_ERROR' });
  }
});

export default router;
