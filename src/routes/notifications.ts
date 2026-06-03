// ============================================================
// RMPG Flex — Mass Notification (Rave Alert parity)
// ============================================================
// Spillman Flex / Rave Alert parity: notification templates,
// batches, mass delivery tracking.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const alerts = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATES
// ═══════════════════════════════════════════════════════════════

alerts.get('/templates', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('channel')) { conditions.push('channel IN (?, ?)'); params.push(q('channel'), 'all'); }
    if (q('category')) { conditions.push('category = ?'); params.push(q('category')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM notification_templates ${where} ORDER BY created_at DESC`);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list templates' }, 500);
  }
});

alerts.post('/templates', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.template_name !== 'string' || !b.template_name.trim()) return c.json({ error: 'template_name required' }, 400);
    if (typeof b.body !== 'string' || !b.body.trim()) return c.json({ error: 'body required' }, 400);
    const result = await execute(db,
      `INSERT INTO notification_templates (template_name, subject, body, channel, category, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.template_name, b.subject ?? null, b.body, b.channel ?? 'email', b.category ?? 'general', userId,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM notification_templates WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create template' }, 500);
  }
});

alerts.put('/templates/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['template_name','subject','body','channel','category']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`); vals.push(id);
    await execute(db, `UPDATE notification_templates SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM notification_templates WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update template' }, 500);
  }
});

alerts.delete('/templates/:id', async (c) => {
  const denied = requireRole(c, 'admin');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    await execute(db, 'DELETE FROM notification_templates WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete template' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// BATCHES
// ═══════════════════════════════════════════════════════════════

alerts.get('/batches', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT b.*, u.full_name as created_by_name FROM notification_batches b LEFT JOIN users u ON b.created_by = u.id ORDER BY b.created_at DESC LIMIT 200');
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list batches' }, 500);
  }
});

alerts.post('/batches', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    const result = await execute(db,
      `INSERT INTO notification_batches (batch_name, template_id, channel, recipient_count, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      b.batch_name ?? null, b.template_id ?? null, b.channel ?? 'email', b.recipient_count ?? 0, 'draft', userId,
    );
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM notification_batches WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create batch' }, 500);
  }
});

alerts.put('/batches/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['batch_name','template_id','channel','recipient_count','sent_count','failed_count','status','sent_at']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE notification_batches SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM notification_batches WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update batch' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// RECIPIENTS
// ═══════════════════════════════════════════════════════════════

alerts.get('/batches/:id/recipients', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM notification_recipients WHERE batch_id = ? ORDER BY id', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list recipients' }, 500);
  }
});

alerts.post('/batches/:id/recipients', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const batchId = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const recipients = Array.isArray(b.recipients) ? b.recipients as Array<Record<string, unknown>> : [b];
    if (recipients.length === 0) return c.json({ error: 'No recipients' }, 400);
    for (const r of recipients) {
      if (typeof r.contact !== 'string' || !r.contact.trim()) continue;
      await execute(db,
        'INSERT INTO notification_recipients (batch_id, recipient_name, contact, channel) VALUES (?, ?, ?, ?)',
        batchId, r.recipient_name ?? null, r.contact, r.channel ?? 'email');
    }
    const total = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM notification_recipients WHERE batch_id = ?', batchId);
    await execute(db, 'UPDATE notification_batches SET recipient_count = ? WHERE id = ?', total?.count ?? 0, batchId);
    return c.json({ success: true, added: recipients.length });
  } catch (err) {
    return c.json({ error: 'Failed to add recipients' }, 500);
  }
});

alerts.put('/batches/:id/send', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const batchId = parseInt(c.req.param('id'), 10);
    // Mark as sent — actual delivery is stubbed (would go through email/SMS API in prod)
    await execute(db,
      `UPDATE notification_batches SET status = 'sent', sent_at = datetime('now','localtime'), sent_count = recipient_count WHERE id = ?`, batchId);
    await execute(db,
      `UPDATE notification_recipients SET status = 'sent', sent_at = datetime('now','localtime') WHERE batch_id = ?`, batchId);
    const batch = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM notification_batches WHERE id = ?', batchId);
    return c.json({ data: batch });
  } catch (err) {
    return c.json({ error: 'Failed to send batch' }, 500);
  }
});

alerts.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const templates = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM notification_templates'))?.count ?? 0;
    const batches = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM notification_batches'))?.count ?? 0;
    const sent = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM notification_batches WHERE status = 'sent'"))?.count ?? 0;
    return c.json({ templates, batches, sent_batches: sent });
  } catch (err) {
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default alerts;
