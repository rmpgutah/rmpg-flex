// ============================================================
// RMPG Flex — Interagency Data Sharing
// ============================================================
// Spillman Flex multi-jurisdiction data sharing parity:
// interagency partners, data share agreements, exchange logs.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

import { log } from '../utils/logger';
const interagency = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// PARTNERS
// ═══════════════════════════════════════════════════════════════

interagency.get('/partners', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='interagency_partners'");
    if (!tableCheck?.n) return c.json({ data: [] });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM interagency_partners ${where} ORDER BY agency_name`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /partners failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to list partners' }, 500);
  }
});

interagency.post('/partners', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.agency_name !== 'string' || !b.agency_name.trim()) return c.json({ error: 'agency_name required' }, 400);
    const result = await execute(db,
      `INSERT INTO interagency_partners (agency_name, agency_type, jurisdiction, contact_name, contact_email, contact_phone, data_share_level, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      b.agency_name, b.agency_type ?? null, b.jurisdiction ?? null, b.contact_name ?? null, b.contact_email ?? null,
      b.contact_phone ?? null, b.data_share_level ?? 'none', b.status ?? 'pending');
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM interagency_partners WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /partners failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to create partner' }, 500);
  }
});

interagency.put('/partners/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['agency_name','agency_type','jurisdiction','contact_name','contact_email','contact_phone','data_share_level','status']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id); // UTC storage standard
    await execute(db, `UPDATE interagency_partners SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM interagency_partners WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /partners/:id failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to update partner' }, 500);
  }
});

interagency.delete('/partners/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const result = await execute(db, 'DELETE FROM interagency_partners WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Partner not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /partners/:id failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to delete partner', code: 'DELETE_ERROR' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// AGREEMENTS
// ═══════════════════════════════════════════════════════════════

interagency.get('/agreements', async (c) => {
  try {
    const db = getDb(c.env);
    const partnerId = c.req.query('partner_id');
    let where = '1=1'; const params: unknown[] = [];
    if (partnerId) { where = 'da.partner_id = ?'; params.push(partnerId); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT da.*, p.agency_name FROM data_share_agreements da LEFT JOIN interagency_partners p ON da.partner_id = p.id WHERE ${where} ORDER BY da.created_at DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /agreements failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to list agreements' }, 500);
  }
});

interagency.post('/agreements', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.partner_id) return c.json({ error: 'partner_id required' }, 400);
    if (typeof b.agreement_name !== 'string') return c.json({ error: 'agreement_name required' }, 400);
    if (typeof b.effective_date !== 'string') return c.json({ error: 'effective_date required' }, 400);
    const result = await execute(db,
      `INSERT INTO data_share_agreements (partner_id, agreement_name, agreement_type, effective_date, expiration_date, data_scope, signed_by, signed_date, status, document_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.partner_id, b.agreement_name, b.agreement_type ?? 'moa', b.effective_date, b.expiration_date ?? null,
      b.data_scope ?? null, b.signed_by ?? null, b.signed_date ?? null, b.status ?? 'draft', b.document_url ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM data_share_agreements WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /agreements failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to create agreement' }, 500);
  }
});

interagency.put('/agreements/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['agreement_name','agreement_type','effective_date','expiration_date','data_scope','signed_by','signed_date','status','document_url']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id); // UTC storage standard
    await execute(db, `UPDATE data_share_agreements SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM data_share_agreements WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /agreements/:id failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to update agreement' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// EXCHANGE LOGS
// ═══════════════════════════════════════════════════════════════

interagency.get('/exchanges', async (c) => {
  try {
    const db = getDb(c.env);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const perPage = 50; const offset = (page - 1) * perPage;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT el.*, p.agency_name, u.full_name as initiated_by_name
       FROM data_exchange_logs el
       LEFT JOIN interagency_partners p ON el.partner_id = p.id
       LEFT JOIN users u ON el.initiated_by = u.id
       ORDER BY el.initiated_at DESC LIMIT ? OFFSET ?`, perPage, offset);
    return c.json({ data: rows, pagination: { page, per_page: perPage } });
  } catch (err) {
    log.error('GET /exchanges failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to list exchange logs' }, 500);
  }
});

interagency.post('/exchanges', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    const result = await execute(db,
      `INSERT INTO data_exchange_logs (partner_id, agreement_id, exchange_type, data_type, record_count, status, initiated_by, completed_at, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.partner_id ?? null, b.agreement_id ?? null, b.exchange_type ?? 'query', b.data_type ?? null,
      b.record_count ?? 0, b.status ?? 'success', userId, b.completed_at ?? null, b.error_message ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM data_exchange_logs WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /exchanges failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to log exchange' }, 500);
  }
});

interagency.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const partnerTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='interagency_partners'");
    if (!partnerTable?.n) return c.json({ total_partners: 0, active_partners: 0, total_agreements: 0, active_agreements: 0, recent_exchanges: 0 });
    const partners = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM interagency_partners'))?.count ?? 0;
    const activeAgreements = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM data_share_agreements WHERE status = 'active'"))?.count ?? 0;
    const totalExchanges = (await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM data_exchange_logs'))?.count ?? 0;
    return c.json({ partners, active_agreements: activeAgreements, total_exchanges: totalExchanges });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/interagency.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default interagency;
