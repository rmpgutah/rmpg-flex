import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { broadcastNewMessage, broadcastAlert, sendToUser } from '../utils/websocket';
import { localNow } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);

// ─── MESSAGES ─────────────────────────────────────────

// POST /api/comms/messages - Send message
router.post('/messages', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { to_user_id, channel, content, priority, subject, parent_id } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const validChannels = ['direct', 'dispatch', 'broadcast', 'zone'];
    const msgChannel = channel || 'direct';
    if (!validChannels.includes(msgChannel)) {
      res.status(400).json({ error: 'Invalid channel', valid: validChannels });
      return;
    }

    // Direct messages require a recipient
    if (msgChannel === 'direct' && !to_user_id) {
      res.status(400).json({ error: 'to_user_id is required for direct messages' });
      return;
    }

    // Broadcast/dispatch require dispatcher+ role
    if (['broadcast', 'dispatch'].includes(msgChannel) && !['admin', 'manager', 'dispatcher', 'supervisor'].includes(req.user!.role)) {
      res.status(403).json({ error: 'Insufficient permissions for broadcast/dispatch messages' });
      return;
    }

    // Threading: compute thread_id from parent message
    let threadId: number | null = null;
    if (parent_id) {
      const parent = db.prepare('SELECT id, thread_id FROM messages WHERE id = ?').get(parent_id) as any;
      if (parent) {
        threadId = parent.thread_id || parent.id; // first message in thread IS the thread
      }
    }

    const result = db.prepare(`
      INSERT INTO messages (from_user_id, to_user_id, channel, content, priority, subject, parent_id, thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user!.userId, to_user_id || null, msgChannel, content, priority || 'routine', subject || null, parent_id || null, threadId);

    const message = db.prepare(`
      SELECT m.*, u.full_name as from_name
      FROM messages m
      LEFT JOIN users u ON m.from_user_id = u.id
      WHERE m.id = ?
    `).get(result.lastInsertRowid) as any;

    // Send via WebSocket
    if (msgChannel === 'direct' && to_user_id) {
      sendToUser(to_user_id, 'new_message', message);
    } else {
      broadcastNewMessage(message);
    }

    // Emergency priority triggers an alert
    if (priority === 'emergency') {
      broadcastAlert({
        type: 'emergency_message',
        message: content,
        from: req.user?.fullName || 'Unknown',
      });
    }

    res.status(201).json(message);
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/messages - Get messages for current user
router.get('/messages', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { channel, unreadOnly, thread_id, limit = '50' } = req.query;
    const limitNum = parseInt(limit as string, 10);

    let whereClause = 'WHERE (m.to_user_id = ? OR m.to_user_id IS NULL OR m.from_user_id = ?)';
    const params: any[] = [req.user!.userId, req.user!.userId];

    if (channel) {
      whereClause += ' AND m.channel = ?';
      params.push(channel);
    }

    if (unreadOnly === 'true') {
      whereClause += ' AND m.read_at IS NULL AND m.to_user_id = ?';
      params.push(req.user!.userId);
    }

    if (thread_id) {
      whereClause += ' AND (m.thread_id = ? OR m.id = ?)';
      params.push(thread_id, thread_id);
    }

    const messages = db.prepare(`
      SELECT m.*,
        f.full_name as from_name, f.badge_number as from_badge,
        t.full_name as to_name
      FROM messages m
      LEFT JOIN users f ON m.from_user_id = f.id
      LEFT JOIN users t ON m.to_user_id = t.id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(...params, limitNum);

    // Get unread count
    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE to_user_id = ? AND read_at IS NULL
    `).get(req.user!.userId) as any;

    res.json({
      data: messages,
      unreadCount: unreadCount.count,
    });
  } catch (error: any) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/comms/messages/:id/read - Mark message as read
router.put('/messages/:id/read', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    db.prepare(`
      UPDATE messages SET read_at = ? WHERE id = ? AND to_user_id = ? AND read_at IS NULL
    `).run(now, req.params.id, req.user!.userId);

    res.json({ message: 'Marked as read' });
  } catch (error: any) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comms/messages/mark-all-read - Mark all messages as read
router.post('/messages/mark-all-read', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    const result = db.prepare(`
      UPDATE messages SET read_at = ? WHERE to_user_id = ? AND read_at IS NULL
    `).run(now, req.user!.userId);

    res.json({ message: 'All messages marked as read', count: result.changes });
  } catch (error: any) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/comms/messages/:id - Delete message
router.delete('/messages/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
    if (!message) { res.status(404).json({ error: 'Message not found' }); return; }

    // Only sender or admin can delete
    if (message.from_user_id !== req.user!.userId && !['admin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ error: 'Only the sender or an admin can delete this message' });
      return;
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── BOLOS ────────────────────────────────────────────

// GET /api/comms/bolos - List all BOLOs
router.get('/bolos', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, type, archived } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (status) {
      whereClause += ' AND b.status = ?';
      params.push(status);
    }
    if (type) {
      whereClause += ' AND b.type = ?';
      params.push(type);
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND b.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND b.archived_at IS NULL';
    }

    const bolos = db.prepare(`
      SELECT b.*, u.full_name as issued_by_name
      FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      ${whereClause}
      ORDER BY
        CASE b.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END,
        b.created_at DESC
    `).all(...params);

    res.json(bolos);
  } catch (error: any) {
    console.error('Get BOLOs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/bolos/active - Get active BOLOs
router.get('/bolos/active', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolos = db.prepare(`
      SELECT b.*, u.full_name as issued_by_name
      FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.status = 'active'
        AND (b.expires_at IS NULL OR b.expires_at > ?)
      ORDER BY
        CASE b.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END,
        b.created_at DESC
    `).all(localNow());

    res.json(bolos);
  } catch (error: any) {
    console.error('Get active BOLOs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/bolos/check - Check active BOLOs for matching descriptions
router.get('/bolos/check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { address, subject, vehicle } = req.query;

    // Need at least one search term
    if (!address && !subject && !vehicle) {
      res.json({ matches: [], count: 0 });
      return;
    }

    // Build dynamic WHERE clause to match against BOLO descriptions
    const conditions: string[] = ["b.status = 'active'"];
    const params: any[] = [];

    // Extract keywords (3+ chars) from each field and match against BOLO fields
    const extractKeywords = (text: string) =>
      text.toUpperCase().split(/[\s,;]+/).filter(w => w.length >= 3);

    const matchClauses: string[] = [];

    if (subject && typeof subject === 'string' && subject.length >= 3) {
      const keywords = extractKeywords(subject);
      for (const kw of keywords.slice(0, 5)) {
        matchClauses.push('(UPPER(b.subject_description) LIKE ? OR UPPER(b.description) LIKE ?)');
        params.push(`%${kw}%`, `%${kw}%`);
      }
    }

    if (vehicle && typeof vehicle === 'string' && vehicle.length >= 3) {
      const keywords = extractKeywords(vehicle);
      for (const kw of keywords.slice(0, 5)) {
        matchClauses.push('(UPPER(b.vehicle_description) LIKE ? OR UPPER(b.description) LIKE ?)');
        params.push(`%${kw}%`, `%${kw}%`);
      }
    }

    if (address && typeof address === 'string' && address.length >= 3) {
      matchClauses.push('UPPER(b.description) LIKE ?');
      params.push(`%${(address as string).toUpperCase()}%`);
    }

    if (matchClauses.length === 0) {
      res.json({ matches: [], count: 0 });
      return;
    }

    conditions.push(`(${matchClauses.join(' OR ')})`);

    const matches = db.prepare(`
      SELECT b.id, b.bolo_number, b.type, b.title, b.description,
             b.subject_description, b.vehicle_description, b.priority,
             b.created_at, b.expires_at
      FROM bolos b
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.priority ASC, b.created_at DESC
      LIMIT 10
    `).all(...params) as any[];

    res.json({ matches, count: matches.length });
  } catch (error: any) {
    console.error('BOLO check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/bolos/:id - Get single BOLO
router.get('/bolos/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolo = db.prepare(`
      SELECT b.*, u.full_name as issued_by_name
      FROM bolos b
      LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.id = ?
    `).get(req.params.id) as any;

    if (!bolo) {
      res.status(404).json({ error: 'BOLO not found' });
      return;
    }

    res.json(bolo);
  } catch (error: any) {
    console.error('Get BOLO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comms/bolos - Create BOLO
router.post('/bolos', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      type, title, description, subject_description, vehicle_description,
      photo_url, priority, expires_at,
    } = req.body;

    if (!type || !title) {
      res.status(400).json({ error: 'type and title are required' });
      return;
    }

    // Generate BOLO number
    const lastBolo = db.prepare(`SELECT bolo_number FROM bolos ORDER BY id DESC LIMIT 1`).get() as any;
    let nextNum = 1;
    if (lastBolo) {
      const parts = lastBolo.bolo_number.split('-');
      nextNum = parseInt(parts[1], 10) + 1;
    }
    const boloNumber = `BOLO-${String(nextNum).padStart(3, '0')}`;

    const result = db.prepare(`
      INSERT INTO bolos (bolo_number, type, title, description, subject_description, vehicle_description,
        photo_url, priority, issued_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      boloNumber, type, title, description || null, subject_description || null,
      vehicle_description || null, photo_url || null, priority || 'P3',
      req.user!.userId, expires_at || null,
    );

    const bolo = db.prepare(`
      SELECT b.*, u.full_name as issued_by_name
      FROM bolos b LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.id = ?
    `).get(result.lastInsertRowid);

    // Broadcast alert for new BOLO
    broadcastAlert({
      type: 'new_bolo',
      bolo,
    });

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bolo_created', 'bolo', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created BOLO: ${title}`, req.ip || 'unknown');

    res.status(201).json(bolo);
  } catch (error: any) {
    console.error('Create BOLO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/comms/bolos/:id - Update BOLO
router.put('/bolos/:id', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolo = db.prepare('SELECT * FROM bolos WHERE id = ?').get(req.params.id) as any;
    if (!bolo) {
      res.status(404).json({ error: 'BOLO not found' });
      return;
    }

    const {
      title, description, subject_description, vehicle_description,
      photo_url, status, priority, expires_at,
    } = req.body;

    // Build dynamic SET clause — only update fields explicitly provided
    const bFields: string[] = [];
    const bValues: any[] = [];
    const bBodyKeys = Object.keys(req.body);

    const bFieldMap: Record<string, (v: any) => any> = {
      title: v => v ?? null, description: v => v ?? null,
      subject_description: v => v ?? null, vehicle_description: v => v ?? null,
      photo_url: v => v ?? null, status: v => v ?? null,
      priority: v => v ?? null, expires_at: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(bFieldMap)) {
      if (bBodyKeys.includes(key)) {
        bFields.push(`${key} = ?`);
        bValues.push(transform(req.body[key]));
      }
    }

    if (bFields.length > 0) {
      bValues.push(req.params.id);
      db.prepare(`UPDATE bolos SET ${bFields.join(', ')} WHERE id = ?`).run(...bValues);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bolo_updated', 'bolo', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated BOLO: ${bolo.title}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT b.*, u.full_name as issued_by_name
      FROM bolos b LEFT JOIN users u ON b.issued_by = u.id
      WHERE b.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (error: any) {
    console.error('Update BOLO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/comms/bolos/:id - Cancel BOLO
router.delete('/bolos/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolo = db.prepare('SELECT * FROM bolos WHERE id = ?').get(req.params.id) as any;
    if (!bolo) {
      res.status(404).json({ error: 'BOLO not found' });
      return;
    }

    db.prepare("UPDATE bolos SET status = 'cancelled' WHERE id = ?").run(bolo.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bolo_cancelled', 'bolo', ?, ?, ?)
    `).run(req.user!.userId, bolo.id, `Cancelled BOLO: ${bolo.title}`, req.ip || 'unknown');

    res.json({ message: 'BOLO cancelled' });
  } catch (error: any) {
    console.error('Cancel BOLO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comms/bolos/:id/archive
router.post('/bolos/:id/archive', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolo = db.prepare('SELECT * FROM bolos WHERE id = ?').get(req.params.id) as any;
    if (!bolo) { res.status(404).json({ error: 'BOLO not found' }); return; }
    if (bolo.archived_at) { res.status(400).json({ error: 'BOLO is already archived' }); return; }

    const now = localNow();
    db.prepare('UPDATE bolos SET archived_at = ? WHERE id = ?').run(now, bolo.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bolo_archived', 'bolo', ?, ?, ?)`).run(
      req.user!.userId, bolo.id, `Archived BOLO: ${bolo.title}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT b.*, u.full_name as issued_by_name FROM bolos b LEFT JOIN users u ON b.issued_by = u.id WHERE b.id = ?').get(bolo.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive BOLO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comms/bolos/:id/unarchive
router.post('/bolos/:id/unarchive', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolo = db.prepare('SELECT * FROM bolos WHERE id = ?').get(req.params.id) as any;
    if (!bolo) { res.status(404).json({ error: 'BOLO not found' }); return; }
    if (!bolo.archived_at) { res.status(400).json({ error: 'BOLO is not archived' }); return; }

    db.prepare('UPDATE bolos SET archived_at = NULL WHERE id = ?').run(bolo.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'bolo_unarchived', 'bolo', ?, ?, ?)`).run(
      req.user!.userId, bolo.id, `Unarchived BOLO: ${bolo.title}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT b.*, u.full_name as issued_by_name FROM bolos b LEFT JOIN users u ON b.issued_by = u.id WHERE b.id = ?').get(bolo.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive BOLO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ACTIVITY FEED ────────────────────────────────────

// GET /api/comms/activity-feed - Get recent activity (supports pagination)
router.get('/activity-feed', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { limit = '50', offset = '0', entityType } = req.query;
    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    let whereClause = '';
    const params: any[] = [];

    if (entityType) {
      whereClause = 'WHERE al.entity_type = ?';
      params.push(entityType);
    }

    // Get total count for pagination
    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM activity_log al ${whereClause}
    `).get(...params) as any;

    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name, u.badge_number, u.role as user_role
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offsetNum);

    res.json({
      data: activity,
      total: countRow.total,
      limit: limitNum,
      offset: offsetNum,
    });
  } catch (error: any) {
    console.error('Get activity feed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RADIO TRANSCRIPTS ─────────────────────────────────

// GET /api/comms/radio/transcripts - List radio transcripts with pagination + filtering
router.get('/radio/transcripts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { channel, user_id, search, limit, offset, from, to } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (channel) {
      whereClause += ' AND rt.channel = ?';
      params.push(channel);
    }
    if (user_id) {
      whereClause += ' AND rt.user_id = ?';
      params.push(user_id);
    }
    if (search) {
      whereClause += ' AND rt.transcript LIKE ?';
      params.push(`%${search}%`);
    }
    if (from) {
      whereClause += ' AND rt.transmitted_at >= ?';
      params.push(from);
    }
    if (to) {
      whereClause += ' AND rt.transmitted_at <= ?';
      params.push(to);
    }

    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 100));
    const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM radio_transcripts rt ${whereClause}`).get(...params) as any;
    const transcripts = db.prepare(`
      SELECT rt.*, u.full_name as user_full_name
      FROM radio_transcripts rt
      LEFT JOIN users u ON rt.user_id = u.id
      ${whereClause}
      ORDER BY rt.transmitted_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offsetNum);

    res.json({ data: transcripts, total: countRow.total, limit: limitNum, offset: offsetNum });
  } catch (error: any) {
    console.error('Get radio transcripts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RADIO CHANNELS (public — any authenticated user) ──────

// GET /api/comms/radio-channels — active radio channels for the UI
router.get('/radio-channels', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT config_key, config_value, sort_order FROM system_config WHERE category = 'radio_channel' AND is_active = 1 ORDER BY sort_order ASC"
    ).all() as { config_key: string; config_value: string; sort_order: number }[];

    if (rows.length > 0) {
      const channels = rows.map((r) => {
        try {
          const meta = JSON.parse(r.config_value);
          return { id: r.config_key, label: meta.label || r.config_key.toUpperCase(), freq: meta.freq || '0.000', sort_order: r.sort_order };
        } catch {
          return { id: r.config_key, label: r.config_key.toUpperCase(), freq: '0.000', sort_order: r.sort_order };
        }
      });
      res.json(channels);
    } else {
      // Return hardcoded defaults if none configured yet
      res.json([
        { id: 'dispatch', label: 'DISPATCH', freq: '155.010', sort_order: 0 },
        { id: 'tac-1',    label: 'TAC-1',    freq: '155.475', sort_order: 1 },
        { id: 'tac-2',    label: 'TAC-2',    freq: '155.730', sort_order: 2 },
        { id: 'tac-3',    label: 'TAC-3',    freq: '156.090', sort_order: 3 },
        { id: 'patrol',   label: 'PATROL',   freq: '156.240', sort_order: 4 },
        { id: 'admin',    label: 'ADMIN',    freq: '158.985', sort_order: 5 },
      ]);
    }
  } catch (error: any) {
    console.error('Get radio channels error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Feature 11: Message read receipts ──────────────────
router.put('/messages/:id/read-receipt', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const receipts = JSON.parse(msg.read_receipts || '{}');
    receipts[String(req.user!.userId)] = { at: now, name: req.user!.fullName };
    db.prepare('UPDATE messages SET read_receipts = ?, read_at = COALESCE(read_at, ?) WHERE id = ?')
      .run(JSON.stringify(receipts), now, req.params.id);

    res.json({ data: { receipts } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 13: BOLO expiration tracking ───────────────
router.post('/bolos/expire-check', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    // Auto-expire BOLOs that have passed their expires_at
    const result = db.prepare(`
      UPDATE bolos SET status = 'expired', expired_at = ?
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(now, now);

    // Also auto-expire BOLOs with auto_expire_hours set
    const result2 = db.prepare(`
      UPDATE bolos SET status = 'expired', expired_at = ?
      WHERE status = 'active' AND auto_expire_hours IS NOT NULL
      AND datetime(created_at, '+' || auto_expire_hours || ' hours') <= ?
    `).run(now, now);

    res.json({ expired: (result.changes || 0) + (result2.changes || 0) });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 14: Broadcast templates ────────────────────
router.get('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templates = db.prepare(`
      SELECT bt.*, u.full_name as created_by_name
      FROM broadcast_templates bt
      LEFT JOIN users u ON bt.created_by = u.id
      ORDER BY bt.category ASC, bt.name ASC
    `).all();
    res.json({ data: templates });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/templates', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, category, subject, content, priority } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'name and content required' });

    const result = db.prepare(`
      INSERT INTO broadcast_templates (name, category, subject, content, priority, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, category || 'general', subject || null, content, priority || 'routine', req.user!.userId);

    const template = db.prepare('SELECT * FROM broadcast_templates WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: template });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/templates/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM broadcast_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 16: Officer acknowledgment tracking ────────
router.put('/messages/:id/acknowledge', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const acks = JSON.parse(msg.acknowledgments || '{}');
    acks[String(req.user!.userId)] = { at: now, name: req.user!.fullName };
    db.prepare('UPDATE messages SET acknowledgments = ? WHERE id = ?')
      .run(JSON.stringify(acks), req.params.id);

    res.json({ data: { acknowledgments: acks } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 17: Broadcast scheduling ───────────────────
router.post('/messages/scheduled', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { content, subject, priority, channel, scheduled_at } = req.body;
    if (!content || !scheduled_at) return res.status(400).json({ error: 'content and scheduled_at required' });

    const result = db.prepare(`
      INSERT INTO messages (from_user_id, channel, content, priority, subject, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user!.userId, channel || 'broadcast', content, priority || 'routine', subject || null, scheduled_at);

    res.status(201).json({ data: { id: result.lastInsertRowid, scheduled_at } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 18: Message search with filters ────────────
router.get('/messages/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, date_from, date_to, sender_id, channel, priority, limit = '50' } = req.query;
    const limitNum = Math.min(200, parseInt(limit as string, 10) || 50);

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (q) {
      where += ' AND (m.content LIKE ? OR m.subject LIKE ?)';
      const s = `%${q}%`; params.push(s, s);
    }
    if (date_from) { where += ' AND m.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND m.created_at <= ?'; params.push(date_to); }
    if (sender_id) { where += ' AND m.from_user_id = ?'; params.push(sender_id); }
    if (channel) { where += ' AND m.channel = ?'; params.push(channel); }
    if (priority) { where += ' AND m.priority = ?'; params.push(priority); }

    const messages = db.prepare(`
      SELECT m.*, f.full_name as from_name, t.full_name as to_name
      FROM messages m
      LEFT JOIN users f ON m.from_user_id = f.id
      LEFT JOIN users t ON m.to_user_id = t.id
      ${where}
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(...params, limitNum);

    res.json({ data: messages });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 19: Alert escalation check ─────────────────
router.post('/alerts/escalation-check', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { minutes = 15 } = req.body;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    // Find emergency/urgent broadcast messages not acknowledged
    const unacked = db.prepare(`
      SELECT m.*, f.full_name as from_name
      FROM messages m
      LEFT JOIN users f ON m.from_user_id = f.id
      WHERE m.channel = 'broadcast'
      AND m.priority IN ('urgent', 'emergency')
      AND m.created_at <= ?
      AND (m.acknowledgments IS NULL OR m.acknowledgments = '{}')
    `).all(cutoff);

    // Broadcast escalation alert for each
    for (const msg of unacked as any[]) {
      broadcastAlert({
        type: 'escalation',
        message: `UNACKNOWLEDGED ${(msg.priority || '').toUpperCase()} ALERT: ${msg.content?.substring(0, 100)}`,
        original_message_id: msg.id,
        from: msg.from_name || 'System',
      });
    }

    res.json({ escalated: (unacked as any[]).length });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Feature 20: Broadcast history archive ──────────────
router.get('/messages/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to, channel = 'broadcast', page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, parseInt(limit as string, 10) || 50);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE m.channel = ?';
    const params: any[] = [channel];
    if (date_from) { where += ' AND m.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND m.created_at <= ?'; params.push(date_to); }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM messages m ${where}`).get(...params) as any).count;
    const messages = db.prepare(`
      SELECT m.*, f.full_name as from_name
      FROM messages m
      LEFT JOIN users f ON m.from_user_id = f.id
      ${where}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data: messages, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ── Feature 26: Message drafts ────────────────────────────────────
// POST /api/comms/drafts - Save a draft message
router.post('/drafts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { to_user_id, channel, content, subject, priority } = req.body;
    if (!content) { res.status(400).json({ error: 'content is required' }); return; }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO messages (from_user_id, to_user_id, channel, content, subject, priority, is_draft, draft_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(req.user!.userId, to_user_id || null, channel || 'direct', content, subject || null, priority || 'routine', now);

    res.status(201).json({ id: Number(result.lastInsertRowid), is_draft: true });
  } catch (error: any) {
    console.error('Save draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/drafts - Get user's draft messages
router.get('/drafts', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const drafts = db.prepare(`
      SELECT m.*, t.full_name as to_name
      FROM messages m
      LEFT JOIN users t ON m.to_user_id = t.id
      WHERE m.from_user_id = ? AND m.is_draft = 1
      ORDER BY m.draft_updated_at DESC
    `).all(req.user!.userId);
    res.json(drafts);
  } catch (error: any) {
    console.error('Get drafts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/comms/drafts/:id - Update a draft
router.put('/drafts/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const draft = db.prepare('SELECT * FROM messages WHERE id = ? AND from_user_id = ? AND is_draft = 1').get(req.params.id, req.user!.userId) as any;
    if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

    const { to_user_id, content, subject, priority } = req.body;
    const now = localNow();

    db.prepare(`
      UPDATE messages SET to_user_id = COALESCE(?, to_user_id), content = COALESCE(?, content),
        subject = COALESCE(?, subject), priority = COALESCE(?, priority), draft_updated_at = ?
      WHERE id = ?
    `).run(to_user_id, content, subject, priority, now, req.params.id);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Update draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/comms/drafts/:id/send - Send a draft
router.post('/drafts/:id/send', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const draft = db.prepare('SELECT * FROM messages WHERE id = ? AND from_user_id = ? AND is_draft = 1').get(req.params.id, req.user!.userId) as any;
    if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

    const now = localNow();
    db.prepare('UPDATE messages SET is_draft = 0, created_at = ?, delivery_status = ? WHERE id = ?').run(now, 'sent', draft.id);

    const message = db.prepare(`
      SELECT m.*, u.full_name as from_name FROM messages m LEFT JOIN users u ON m.from_user_id = u.id WHERE m.id = ?
    `).get(draft.id) as any;

    // Send via WebSocket
    if (draft.channel === 'direct' && draft.to_user_id) {
      sendToUser(draft.to_user_id, 'new_message', message);
    } else {
      broadcastNewMessage(message);
    }

    if (draft.priority === 'emergency') {
      broadcastAlert({ type: 'emergency_message', message: draft.content, from: req.user?.fullName || 'Unknown' });
    }

    res.json(message);
  } catch (error: any) {
    console.error('Send draft error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Feature 27: BOLO photo attachment ─────────────────────────────
// PUT /api/comms/bolos/:id/photos - Update BOLO photos
router.put('/bolos/:id/photos', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bolo = db.prepare('SELECT * FROM bolos WHERE id = ?').get(req.params.id) as any;
    if (!bolo) { res.status(404).json({ error: 'BOLO not found' }); return; }

    const { photos } = req.body; // Array of photo URLs
    if (!Array.isArray(photos)) { res.status(400).json({ error: 'photos must be an array' }); return; }

    db.prepare('UPDATE bolos SET photos = ? WHERE id = ?').run(JSON.stringify(photos), req.params.id);
    res.json({ success: true, photos });
  } catch (error: any) {
    console.error('Update BOLO photos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Feature 28: Broadcast channel groups ──────────────────────────
// POST /api/comms/broadcast-group - Send to a group by role
router.post('/broadcast-group', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { roles, content, subject, priority } = req.body;
    if (!content) { res.status(400).json({ error: 'content is required' }); return; }
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      res.status(400).json({ error: 'roles must be a non-empty array' }); return;
    }

    const now = localNow();
    const placeholders = roles.map(() => '?').join(',');
    const recipients = db.prepare(`SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`).all(...roles) as any[];

    const insertStmt = db.prepare(`
      INSERT INTO messages (from_user_id, to_user_id, channel, content, subject, priority, delivery_status, created_at)
      VALUES (?, ?, 'broadcast', ?, ?, ?, 'sent', ?)
    `);

    const results: number[] = [];
    const tx = db.transaction(() => {
      for (const recipient of recipients) {
        const result = insertStmt.run(req.user!.userId, recipient.id, content, subject || null, priority || 'routine', now);
        results.push(Number(result.lastInsertRowid));
        sendToUser(recipient.id, 'new_message', { id: result.lastInsertRowid, content, subject, priority, from_name: req.user?.fullName });
      }
    });
    tx();

    res.status(201).json({ success: true, recipients_count: recipients.length, message_ids: results });
  } catch (error: any) {
    console.error('Broadcast group error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Feature 29: Message delivery confirmation ─────────────────────
// POST /api/comms/messages/:id/delivered - Confirm delivery
router.post('/messages/:id/delivered', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    db.prepare(`UPDATE messages SET delivered_at = ?, delivery_status = 'delivered' WHERE id = ? AND to_user_id = ? AND delivered_at IS NULL`)
      .run(now, req.params.id, req.user!.userId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delivery confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/messages/:id/delivery-status - Get delivery status
router.get('/messages/:id/delivery-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const msg = db.prepare('SELECT delivery_status, delivered_at, read_at FROM messages WHERE id = ?').get(req.params.id) as any;
    if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }
    res.json(msg);
  } catch (error: any) {
    console.error('Delivery status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Feature 30: Emergency broadcast mode ──────────────────────────
// POST /api/comms/emergency-broadcast - Send to ALL active units/users
router.post('/emergency-broadcast', requireRole('admin', 'manager', 'dispatcher', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { content, subject } = req.body;
    if (!content) { res.status(400).json({ error: 'content is required' }); return; }

    const now = localNow();

    // Insert a single broadcast message (no to_user_id = broadcast to all)
    const result = db.prepare(`
      INSERT INTO messages (from_user_id, to_user_id, channel, content, subject, priority, delivery_status, created_at)
      VALUES (?, NULL, 'broadcast', ?, ?, 'emergency', 'sent', ?)
    `).run(req.user!.userId, content, subject || 'EMERGENCY BROADCAST', now);

    const message = db.prepare(`
      SELECT m.*, u.full_name as from_name FROM messages m LEFT JOIN users u ON m.from_user_id = u.id WHERE m.id = ?
    `).get(result.lastInsertRowid) as any;

    // Broadcast to ALL connected clients
    broadcastAlert({
      type: 'emergency_broadcast',
      message: content,
      subject: subject || 'EMERGENCY BROADCAST',
      from: req.user?.fullName || 'Unknown',
      timestamp: now,
    });
    broadcastNewMessage(message);

    // Also create high-priority notification
    try {
      db.prepare(`
        INSERT INTO notifications (type, priority, title, message, created_at)
        VALUES ('system', 'critical', ?, ?, ?)
      `).run(`EMERGENCY: ${subject || 'Emergency Broadcast'}`, content, now);
    } catch { /* notifications table may not exist */ }

    res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (error: any) {
    console.error('Emergency broadcast error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/comms/radio/audio/:entryId — Get radio audio recording
router.get('/radio/audio/:entryId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entry = db.prepare(
      'SELECT * FROM radio_transcripts WHERE id = ?'
    ).get(req.params.entryId) as any;

    if (!entry) { res.status(404).json({ error: 'Audio entry not found' }); return; }

    if (entry.audio_path) {
      const path = require('path');
      const fs = require('fs');
      const audioPath = path.resolve(entry.audio_path);
      if (fs.existsSync(audioPath)) {
        res.sendFile(audioPath);
        return;
      }
    }

    res.status(404).json({ error: 'Audio file not available' });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
