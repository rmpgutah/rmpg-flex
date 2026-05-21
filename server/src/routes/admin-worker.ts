// ============================================================
// RMPG Flex — Admin Routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/admin.ts for Workers runtime.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow, paramStr, paramNum } from '../worker-middleware/d1Helpers';
import { auditLog } from '../worker-middleware/auditLogger';

export function mountAdminRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  api.use('/*', authenticateToken);
  api.use('/*', requireRole('admin', 'manager'));

  // ═══════════════════════════════════════════════════════════
  // CLIENTS
  // ═══════════════════════════════════════════════════════════

  // GET /api/admin/clients - List all clients
  api.get('/clients', async (c) => {
    const db = new D1Db(c.env.DB);
    const clients = await db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM properties WHERE client_id = c.id) as property_count
      FROM clients c ORDER BY c.name
    `).all();
    return c.json(clients);
  });

  // GET /api/admin/clients/:id - Get single client
  api.get('/clients/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);
    const properties = await db.prepare('SELECT * FROM properties WHERE client_id = ?').all(id);
    return c.json({ ...client, properties });
  });

  // POST /api/admin/clients - Create client
  api.post('/clients', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { name, contact_name, contact_email, contact_phone, address, contract_start, contract_end, sla_response_minutes, notes, billing_email, billing_address, contract_type, contract_value, payment_terms, auto_renew, client_code, industry, website, tax_id, payment_method, billing_cycle, billing_day, discount_percent, late_fee_percent, account_manager, priority_client, client_since } = body;

    if (!name) return c.json({ error: 'name is required', code: 'NAME_IS_REQUIRED' }, 400);

    const result = await db.prepare(`
      INSERT INTO clients (name, contact_name, contact_email, contact_phone, address,
        contract_start, contract_end, sla_response_minutes, notes,
        billing_email, billing_address, contract_type, contract_value,
        payment_terms, auto_renew, client_code, industry, website, tax_id, payment_method,
        billing_cycle, billing_day, discount_percent, late_fee_percent,
        account_manager, priority_client, client_since)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, contact_name || null, contact_email || null, contact_phone || null, address || null,
      contract_start || null, contract_end || null, sla_response_minutes || null, notes || null,
      billing_email || null, billing_address || null, contract_type || null, contract_value || null,
      payment_terms || null, auto_renew ? 1 : 0, client_code || null, industry || null,
      website || null, tax_id || null, payment_method || null, billing_cycle || null,
      billing_day || null, discount_percent || null, late_fee_percent || null,
      account_manager || null, priority_client ? 1 : 0, client_since || null,
    );

    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(result.meta.last_row_id);
    await auditLog(db, c, 'client_created', 'client', Number(result.meta.last_row_id), `Created client: ${name}`);
    return c.json(client, 201);
  });

  // PUT /api/admin/clients/:id - Update client
  api.put('/clients/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const bodyKeys = Object.keys(body);

    const fieldMap: Record<string, (v: any) => any> = {
      name: v => v ?? null, contact_name: v => v ?? null, contact_email: v => v ?? null,
      contact_phone: v => v ?? null, address: v => v ?? null,
      contract_start: v => v ?? null, contract_end: v => v ?? null,
      sla_response_minutes: v => v ?? null, notes: v => v ?? null, status: v => v ?? null,
      billing_email: v => v ?? null, billing_address: v => v ?? null,
      contract_type: v => v ?? null, contract_value: v => v ?? null,
      payment_terms: v => v ?? null, auto_renew: v => v ? 1 : 0,
      client_code: v => v ?? null, industry: v => v ?? null,
      website: v => v ?? null, tax_id: v => v ?? null,
      payment_method: v => v ?? null, billing_cycle: v => v ?? null,
      billing_day: v => v ?? null, discount_percent: v => v ?? null,
      late_fee_percent: v => v ?? null, account_manager: v => v ?? null,
      priority_client: v => v ? 1 : 0, client_since: v => v ?? null,
      rate_per_hour: v => v ?? null, rate_per_incident: v => v ?? null, rate_per_cfs: v => v ?? null,
    };

    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, transform] of Object.entries(fieldMap)) {
      if (bodyKeys.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(transform(body[key]));
      }
    }

    if (fields.length > 0) {
      fields.push('updated_at = ?');
      values.push(localNow());
      values.push(id);
      await db.prepare(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    await auditLog(db, c, 'client_updated', 'client', id, `Updated client: ${client.name}`);
    const updated = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return c.json(updated);
  });

  // DELETE /api/admin/clients/:id - Delete client
  api.delete('/clients/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const id = paramNum(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);

    const propCount = await db.prepare('SELECT COUNT(*) as count FROM properties WHERE client_id = ?').get(id) as any;
    if (propCount.count > 0) {
      if (user.role !== 'admin') return c.json({ error: `Cannot delete client with ${propCount.count} associated properties` }, 400);
      await db.prepare('UPDATE properties SET client_id = NULL WHERE client_id = ?').run(id);
    }

    await db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    await auditLog(db, c, 'client_deleted', 'client', id, `Deleted client: ${client.name}`);
    return c.json({ message: 'Client deleted' });
  });

  // POST /api/admin/clients/:id/archive
  api.post('/clients/:id/archive', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);
    if (client.archived_at) return c.json({ error: 'Client is already archived', code: 'CLIENT_IS_ALREADY_ARCHIVED' }, 400);

    await db.prepare('UPDATE clients SET archived_at = ? WHERE id = ?').run(localNow(), id);
    await auditLog(db, c, 'client_archived', 'client', id, `Archived client: ${client.name}`);
    const updated = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return c.json(updated);
  });

  // POST /api/admin/clients/:id/unarchive
  api.post('/clients/:id/unarchive', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);
    if (!client.archived_at) return c.json({ error: 'Client is not archived', code: 'CLIENT_IS_NOT_ARCHIVED' }, 400);

    await db.prepare('UPDATE clients SET archived_at = NULL WHERE id = ?').run(id);
    await auditLog(db, c, 'client_unarchived', 'client', id, `Unarchived client: ${client.name}`);
    const updated = await db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    return c.json(updated);
  });

  // GET /api/admin/clients/:id/incidents
  api.get('/clients/:id/incidents', async (c) => {
    const db = new D1Db(c.env.DB);
    const clientId = paramNum(c.req.param('id'));
    const incidents = await db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.location_address, i.occurred_date, i.created_at,
        u.full_name as officer_name, p.name as property_name
      FROM incidents i
      LEFT JOIN users u ON i.officer_id = u.id
      LEFT JOIN properties p ON i.property_id = p.id
      WHERE i.client_id = ? OR p.client_id = ?
      ORDER BY i.created_at DESC LIMIT 100
    `).all(clientId, clientId);
    return c.json(incidents);
  });

  // GET /api/admin/clients/:id/calls
  api.get('/clients/:id/calls', async (c) => {
    const db = new D1Db(c.env.DB);
    const clientId = paramNum(c.req.param('id'));
    const calls = await db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status,
        c.location_address, c.description, c.created_at, p.name as property_name
      FROM calls_for_service c LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.client_id = ? OR p.client_id = ? ORDER BY c.created_at DESC LIMIT 100
    `).all(clientId, clientId);
    return c.json(calls);
  });

  // GET /api/admin/clients/:id/billing
  api.get('/clients/:id/billing', async (c) => {
    const db = new D1Db(c.env.DB);
    const clientId = paramNum(c.req.param('id'));
    const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any;
    if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);

    const properties = await db.prepare('SELECT id FROM properties WHERE client_id = ?').all(clientId) as any[];
    const propIds = properties.map((p: any) => p.id);

    let incidentCount = 0, callCount = 0;
    if (propIds.length > 0) {
      const placeholders = propIds.map(() => '?').join(',');
      const incResult = await db.prepare(`SELECT COUNT(*) as cnt FROM incidents WHERE client_id = ? OR property_id IN (${placeholders})`).get(clientId, ...propIds) as any;
      incidentCount = incResult?.cnt || 0;
      const callResult = await db.prepare(`SELECT COUNT(*) as cnt FROM calls_for_service WHERE client_id = ? OR property_id IN (${placeholders})`).get(clientId, ...propIds) as any;
      callCount = callResult?.cnt || 0;
    } else {
      const incResult = await db.prepare('SELECT COUNT(*) as cnt FROM incidents WHERE client_id = ?').get(clientId) as any;
      incidentCount = incResult?.cnt || 0;
      const callResult = await db.prepare('SELECT COUNT(*) as cnt FROM calls_for_service WHERE client_id = ?').get(clientId) as any;
      callCount = callResult?.cnt || 0;
    }

    const invoiceSummary = await db.prepare(`
      SELECT COUNT(*) as total_invoices, COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_paid, COALESCE(SUM(balance_due), 0) as outstanding,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_count
      FROM invoices WHERE client_id = ? AND status NOT IN ('void','cancelled')
    `).get(clientId) as any;

    return c.json({
      client_id: clientId, property_count: properties.length,
      incident_count: incidentCount, call_count: callCount,
      contract_value: client.contract_value, payment_terms: client.payment_terms,
      billing_email: client.billing_email, billing_address: client.billing_address,
      rate_per_hour: client.rate_per_hour, rate_per_incident: client.rate_per_incident,
      rate_per_cfs: client.rate_per_cfs,
      total_invoices: invoiceSummary?.total_invoices || 0,
      total_invoiced: invoiceSummary?.total_invoiced || 0,
      total_paid: invoiceSummary?.total_paid || 0,
      outstanding_balance: invoiceSummary?.outstanding || 0,
      overdue_count: invoiceSummary?.overdue_count || 0,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CALL TEMPLATES
  // ═══════════════════════════════════════════════════════════

  // GET /api/admin/call-templates
  api.get('/call-templates', async (c) => {
    const db = new D1Db(c.env.DB);
    const templates = await db.prepare(`
      SELECT ct.*, u.full_name as created_by_name
      FROM call_templates ct LEFT JOIN users u ON ct.created_by = u.id
      ORDER BY ct.sort_order ASC, ct.name ASC LIMIT 1000
    `).all();
    return c.json(templates);
  });

  // POST /api/admin/call-templates
  api.post('/call-templates', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { name, incident_type, priority, description_template, default_notes, source } = body;

    if (!name || !incident_type) return c.json({ error: 'name and incident_type are required', code: 'NAME_AND_INCIDENTTYPE_ARE' }, 400);

    const maxOrder = await db.prepare('SELECT MAX(sort_order) as max_order FROM call_templates').get() as any;
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    const result = await db.prepare(`
      INSERT INTO call_templates (name, incident_type, priority, description_template, default_notes, source, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, incident_type, priority || 'P3', description_template || null, default_notes || null, source || 'dispatch', sortOrder, user.userId);

    const template = await db.prepare('SELECT * FROM call_templates WHERE id = ?').get(result.meta.last_row_id);
    await auditLog(db, c, 'template_created', 'call_template', Number(result.meta.last_row_id), `Created call template: ${name}`);
    return c.json(template, 201);
  });

  // PUT /api/admin/call-templates/:id
  api.put('/call-templates/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT * FROM call_templates WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Call template not found', code: 'CALL_TEMPLATE_NOT_FOUND' }, 404);

    const body = await c.req.json();
    const tmplFields = ['name', 'incident_type', 'priority', 'description_template', 'default_notes', 'source', 'is_active', 'sort_order'];
    const bodyKeys = Object.keys(body);
    const set: string[] = [];
    const vals: any[] = [];
    for (const f of tmplFields) {
      if (bodyKeys.includes(f)) {
        set.push(`${f} = ?`);
        const v = body[f];
        vals.push(v === '' ? null : v ?? null);
      }
    }
    if (set.length > 0) {
      vals.push(id);
      await db.prepare(`UPDATE call_templates SET ${set.join(', ')} WHERE id = ?`).run(...vals);
    }

    const updated = await db.prepare('SELECT * FROM call_templates WHERE id = ?').get(id);
    return c.json(updated);
  });

  // DELETE /api/admin/call-templates/:id
  api.delete('/call-templates/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const existing = await db.prepare('SELECT * FROM call_templates WHERE id = ?').get(id) as any;
    if (!existing) return c.json({ error: 'Call template not found', code: 'CALL_TEMPLATE_NOT_FOUND' }, 404);

    await db.prepare('UPDATE call_templates SET is_active = 0 WHERE id = ?').run(id);
    await auditLog(db, c, 'template_deleted', 'call_template', existing.id, `Removed call template: ${existing.name}`);
    return c.json({ message: 'Call template removed' });
  });

  // ═══════════════════════════════════════════════════════════
  // SESSIONS
  // ═══════════════════════════════════════════════════════════

  api.get('/sessions', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const sessions = await db.prepare(`
      SELECT s.id, s.user_id, s.session_id, s.ip_address, s.user_agent,
        s.is_active, s.created_at, s.last_used_at, s.expires_at,
        u.username, u.full_name, u.role
      FROM sessions s LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.last_used_at DESC LIMIT 200
    `).all();
    return c.json(sessions);
  });

  api.delete('/sessions/:id', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    await db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(id);
    return c.json({ message: 'Session revoked' });
  });

  // ═══════════════════════════════════════════════════════════
  // RADIO CHANNELS
  // ═══════════════════════════════════════════════════════════

  api.get('/radio-channels', async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare("SELECT config_key, config_value, sort_order, is_active, created_at, updated_at FROM system_config WHERE category = 'radio_channel' ORDER BY sort_order ASC").all() as any[];
    const channels = rows.map((r: any) => {
      let meta: any = {};
      try { meta = JSON.parse(r.config_value); } catch { /* */ }
      return { id: r.config_key, label: meta.label || r.config_key.toUpperCase(), freq: meta.freq || '0.000', sort_order: r.sort_order, is_active: !!r.is_active, created_at: r.created_at, updated_at: r.updated_at };
    });
    return c.json(channels);
  });

  api.post('/radio-channels', async (c) => {
    const db = new D1Db(c.env.DB);
    const user = c.get('user');
    const body = await c.req.json();
    const { id, label, freq } = body;
    if (!id || !label) return c.json({ error: 'id and label are required', code: 'ID_AND_LABEL_ARE' }, 400);

    const existing = await db.prepare("SELECT config_key FROM system_config WHERE category = 'radio_channel' AND config_key = ?").get(id);
    if (existing) return c.json({ error: 'A radio channel with that ID already exists', code: 'A_RADIO_CHANNEL_WITH' }, 409);

    const maxRow = await db.prepare("SELECT MAX(sort_order) as mx FROM system_config WHERE category = 'radio_channel'").get() as any;
    const sortOrder = (maxRow?.mx ?? -1) + 1;
    const now = localNow();
    const value = JSON.stringify({ label, freq: freq || '0.000' });

    await db.prepare("INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'radio_channel', ?, 1, ?, ?)").run(id, value, sortOrder, now, now);
    await auditLog(db, c, 'radio_channel_created', 'radio_channel', 0, `Created radio channel: ${label} (${id})`);
    return c.json({ id, label, freq: freq || '0.000', sort_order: sortOrder, is_active: true }, 201);
  });

  api.put('/radio-channels/:key', async (c) => {
    const db = new D1Db(c.env.DB);
    const key = paramStr(c.req.param('key'));
    const existing = await db.prepare("SELECT config_key, config_value FROM system_config WHERE category = 'radio_channel' AND config_key = ?").get(key) as any;
    if (!existing) return c.json({ error: 'Radio channel not found', code: 'RADIO_CHANNEL_NOT_FOUND' }, 404);

    const body = await c.req.json();
    let meta: any = {};
    try { meta = JSON.parse(existing.config_value); } catch { /* */ }
    if (body.label !== undefined) meta.label = body.label;
    if (body.freq !== undefined) meta.freq = body.freq;

    const now = localNow();
    const sets: string[] = ['config_value = ?', 'updated_at = ?'];
    const vals: any[] = [JSON.stringify(meta), now];
    if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
    if (body.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(body.sort_order); }
    vals.push(key);
    await db.prepare(`UPDATE system_config SET ${sets.join(', ')} WHERE category = 'radio_channel' AND config_key = ?`).run(...vals);
    return c.json({ id: key, label: meta.label, freq: meta.freq, is_active: body.is_active !== undefined ? !!body.is_active : true, sort_order: body.sort_order });
  });

  api.delete('/radio-channels/:key', async (c) => {
    const db = new D1Db(c.env.DB);
    const key = paramStr(c.req.param('key'));
    const existing = await db.prepare("SELECT config_key FROM system_config WHERE category = 'radio_channel' AND config_key = ?").get(key);
    if (!existing) return c.json({ error: 'Radio channel not found', code: 'RADIO_CHANNEL_NOT_FOUND' }, 404);
    await db.prepare("DELETE FROM system_config WHERE category = 'radio_channel' AND config_key = ?").run(key);
    return c.json({ message: 'Radio channel deleted' });
  });

  api.post('/radio-channels/seed', async (c) => {
    const db = new D1Db(c.env.DB);
    const count = await db.prepare("SELECT COUNT(*) as cnt FROM system_config WHERE category = 'radio_channel'").get() as any;
    if (count.cnt > 0) return c.json({ message: 'Radio channels already configured', seeded: false });

    const defaults = [
      { id: 'dispatch', label: 'DISPATCH', freq: '155.010' },
      { id: 'tac-1', label: 'TAC-1', freq: '155.475' },
      { id: 'tac-2', label: 'TAC-2', freq: '155.730' },
      { id: 'tac-3', label: 'TAC-3', freq: '156.090' },
      { id: 'patrol', label: 'PATROL', freq: '156.240' },
      { id: 'admin', label: 'ADMIN', freq: '158.985' },
    ];
    const now = localNow();
    for (let i = 0; i < defaults.length; i++) {
      const ch = defaults[i];
      await db.prepare("INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'radio_channel', ?, 1, ?, ?)").run(ch.id, JSON.stringify({ label: ch.label, freq: ch.freq }), i, now, now);
    }
    return c.json({ message: 'Seeded default radio channels', seeded: true, count: defaults.length });
  });

  // ═══════════════════════════════════════════════════════════
  // ACCOUNT STATS
  // ═══════════════════════════════════════════════════════════

  api.get('/account-stats', async (c) => {
    const db = new D1Db(c.env.DB);
    const totals = await db.prepare(`
      SELECT COUNT(*) as total_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_users,
        SUM(CASE WHEN status = 'terminated' THEN 1 ELSE 0 END) as terminated_users,
        SUM(COALESCE(login_count, 0)) as total_logins,
        AVG(COALESCE(login_count, 0)) as avg_logins_per_user,
        MAX(last_login_at) as most_recent_login FROM users
    `).get() as any;

    const topUsers = await db.prepare(`
      SELECT id, username, full_name, login_count, last_login_at, role, status
      FROM users WHERE login_count > 0 ORDER BY login_count DESC LIMIT 10
    `).all();

    const now = localNow();
    const loginCounts = await db.prepare(`
      SELECT
        SUM(CASE WHEN created_at >= datetime(?, '-1 day') THEN 1 ELSE 0 END) as last_24h,
        SUM(CASE WHEN created_at >= datetime(?, '-7 days') THEN 1 ELSE 0 END) as last_7d,
        SUM(CASE WHEN created_at >= datetime(?, '-30 days') THEN 1 ELSE 0 END) as last_30d
      FROM activity_log WHERE action = 'user_login'
    `).get(now, now, now) as any;

    const neverLoggedIn = await db.prepare(`
      SELECT id, username, full_name, role, status, created_at FROM users
      WHERE (login_count IS NULL OR login_count = 0) AND status = 'active'
      ORDER BY created_at LIMIT 1000
    `).all();

    return c.json({ ...totals, topUsers, loginCounts: loginCounts || { last_24h: 0, last_7d: 0, last_30d: 0 }, neverLoggedIn });
  });

  // ═══════════════════════════════════════════════════════════
  // USER TOTP ADMIN
  // ═══════════════════════════════════════════════════════════

  api.delete('/users/:id/totp', authenticateToken, requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    const targetId = paramNum(c.req.param('id'));
    if (isNaN(targetId)) return c.json({ error: 'Invalid user ID', code: 'INVALID_USER_ID' }, 400);

    const target = await db.prepare('SELECT id, username, totp_enabled FROM users WHERE id = ?').get(targetId) as any;
    if (!target) return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);

    await db.prepare(`UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes = NULL, totp_pending_secret = NULL, updated_at = datetime('now','localtime') WHERE id = ?`).run(targetId);
    await auditLog(db, c, 'admin_reset_totp', 'user', targetId, `Admin reset 2FA for ${target.username}`);
    return c.json({ message: `Two-factor authentication reset for ${target.username}` });
  });

  // GET /api/admin/users
  api.get('/users', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
      const rows = await db.prepare(`
        SELECT id, username, full_name, email, role, badge_number, status, created_at, last_login_at
        FROM users ORDER BY full_name LIMIT ?
      `).all(limit);
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // GET /api/admin/system-settings
  api.get('/system-settings', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const rows = await db.prepare("SELECT * FROM system_config WHERE category = 'setting' ORDER BY config_key").all();
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // GET /api/admin/audit-log
  api.get('/audit-log', requireRole('admin', 'manager'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const limit = Math.min(10000, Math.max(1, parseInt(c.req.query('limit') || '100', 10) || 100));
      const rows = await db.prepare(`
        SELECT a.*, u.full_name as user_name FROM audit_log a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC LIMIT ?
      `).all(limit);
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // GET /api/admin/stats
  api.get('/stats', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const [users, calls, incidents, warrants] = await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM users').get(),
        db.prepare('SELECT COUNT(*) as count FROM calls_for_service').get(),
        db.prepare('SELECT COUNT(*) as count FROM incidents').get(),
        db.prepare('SELECT COUNT(*) as count FROM warrants').get(),
      ]);
      return c.json({
        users: (users as any)?.count || 0,
        calls: (calls as any)?.count || 0,
        incidents: (incidents as any)?.count || 0,
        warrants: (warrants as any)?.count || 0,
      });
    } catch { return c.json({ users: 0, calls: 0, incidents: 0, warrants: 0 }); }
  });

  // GET /api/admin/feature-flags
  api.get('/feature-flags', requireRole('admin'), async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const rows = await db.prepare("SELECT * FROM system_config WHERE category = 'feature_flag' ORDER BY config_key").all();
      return c.json(rows);
    } catch { return c.json([]); }
  });

  // Mount all admin routes under /admin
  // ═══════════════════════════════════════════════════════════
  // THIRD-PARTY API KEYS
  // ═══════════════════════════════════════════════════════════

  const ALLOWED_THIRD_PARTY_KEYS = [
    'lead_gen_rapidapi_key', 'dl_ocr_rapidapi_key', 'plate_check_rapidapi_key',
    'google_cloud_vision_key', 'google_cloud_speech_key', 'google_generative_language_key',
    'mapbox_api_key', 'mapbox_access_token', 'mapbox_username', 'mapbox_password', 'mapbox_style_url',
    'ncic_api_key', 'utah_dps_api_key', 'utah_courts_api_key', 'fbi_wanted_api_key',
    'dea_api_key', 'usms_api_key', 'atf_api_key', 'interpol_api_key', 'nsopw_api_key', 'ofac_api_key',
    'openweathermap_api_key', 'nominatim_api_key', 'opencage_api_key',
    'ipinfo_api_key', 'virustotal_api_key', 'abuseipdb_api_key', 'shodan_api_key',
    'have_i_been_pwned_key', 'censys_api_key', 'hunter_io_api_key', 'numverify_api_key',
    'abstract_api_key', 'whoisxml_api_key', 'urlscan_api_key', 'emailrep_api_key',
    'twilio_api_key', 'twilio_account_sid', 'sendgrid_api_key', 'pushover_api_key',
    'ntfy_topic_key', 'slack_webhook_url', 'discord_webhook_url', 'telegram_bot_token',
    'openai_api_key', 'anthropic_api_key', 'replicate_api_key', 'huggingface_api_key',
    'deepgram_api_key', 'assemblyai_api_key',
    'aws_access_key_id', 'aws_secret_access_key', 'aws_s3_bucket',
    'backblaze_key_id', 'backblaze_app_key', 'cloudflare_api_key', 'wasabi_access_key',
    'openmeteo_api_key', 'clearpath_gps_api_key', 'microbilt_client_id', 'microbilt_client_secret',
    'nhtsa_api_key', 'fcc_api_key', 'here_api_key', 'what3words_api_key',
    'plaid_api_key', 'clearbit_api_key', 'pipl_api_key', 'towerdata_api_key',
    'plate_recognizer_api_key', 'roboflow_api_key', 'carjam_api_key', 'spokeo_api_key',
    'owntracks_webhook_token', 'traccar_webhook_token',
  ];

  // GET /api/admin/third-party-keys
  api.get('/third-party-keys', async (c) => {
    const db = new D1Db(c.env.DB);
    const result = await Promise.all(ALLOWED_THIRD_PARTY_KEYS.map(async (k) => {
      const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1").get(k) as any;
      return { config_key: k, has_value: !!row?.config_value };
    }));
    return c.json(result);
  });

  // GET /api/admin/third-party-keys/:key
  api.get('/third-party-keys/:key', async (c) => {
    const key = c.req.param('key');
    if (!ALLOWED_THIRD_PARTY_KEYS.includes(key)) return c.json({ error: 'Unknown key' }, 400);
    const db = new D1Db(c.env.DB);
    const row = await db.prepare("SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1").get(key) as any;
    return c.json({ configured: !!row?.config_value });
  });

  // PUT /api/admin/third-party-keys
  api.put('/third-party-keys', async (c) => {
    const body = await c.req.json();
    const { key, value } = body;
    if (!key || !value || typeof value !== 'string') return c.json({ error: 'key and value are required' }, 400);
    if (!ALLOWED_THIRD_PARTY_KEYS.includes(key)) return c.json({ error: 'Unknown key' }, 400);

    const db = new D1Db(c.env.DB);
    const now = localNow();
    const existing = await db.prepare("SELECT id FROM system_config WHERE config_key = ? LIMIT 1").get(key) as any;
    if (existing) {
      await db.prepare("UPDATE system_config SET config_value = ?, is_active = 1, updated_at = ? WHERE config_key = ?").run(value, now, key);
    } else {
      await db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 1, ?, ?)").run(key, value, now, now);
    }
    return c.json({ success: true, message: `${key} saved` });
  });

  // DELETE /api/admin/third-party-keys
  api.delete('/third-party-keys', async (c) => {
    const body = await c.req.json();
    const { key } = body;
    if (!key || !ALLOWED_THIRD_PARTY_KEYS.includes(key)) return c.json({ error: 'Unknown key' }, 400);
    const db = new D1Db(c.env.DB);
    await db.prepare("UPDATE system_config SET config_value = '', is_active = 0, updated_at = ? WHERE config_key = ?").run(localNow(), key);
    return c.json({ success: true, message: `${key} cleared` });
  });

  // ═══════════════════════════════════════════════════════════
  // TRAFFIC PULL STATUS
  // ═══════════════════════════════════════════════════════════

  api.get('/traccar-pull-status', async (c) => {
    return c.json({ status: 'idle', last_pull: null, next_pull: null });
  });

  // ═══════════════════════════════════════════════════════════
  // SYSTEM CONFIG
  // ═══════════════════════════════════════════════════════════

  // GET /api/admin/config
  api.get('/config', async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare('SELECT * FROM system_config ORDER BY category, config_key').all();
    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const row of rows) {
      const cat = (row as any).category || 'general';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(row);
    }
    return c.json(grouped);
  });

  // GET /api/admin/config/branding
  api.get('/config/branding', async (c) => {
    const db = new D1Db(c.env.DB);
    const rows = await db.prepare("SELECT * FROM system_config WHERE category = 'branding' ORDER BY config_key").all();
    return c.json(rows);
  });

  // POST /api/admin/config
  api.post('/config', async (c) => {
    const db = new D1Db(c.env.DB);
    const body = await c.req.json();
    const now = localNow();
    const key = body.config_key || body.key;
    const value = body.config_value || body.value;
    const category = body.category || 'system_settings';
    if (!key) return c.json({ error: 'config_key is required' }, 400);

    const existing = await db.prepare('SELECT id FROM system_config WHERE config_key = ?').get(key) as any;
    if (existing) {
      await db.prepare('UPDATE system_config SET config_value = ?, updated_at = ? WHERE id = ?').run(value || '', now, existing.id);
    } else {
      await db.prepare('INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(key, value || '', category, now, now);
    }
    const row = await db.prepare('SELECT * FROM system_config WHERE config_key = ?').get(key);
    return c.json(row);
  });

  // PUT /api/admin/config/:id
  api.put('/config/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const body = await c.req.json();
    const now = localNow();
    const sets: string[] = ['updated_at = ?'];
    const vals: any[] = [now];

    if (body.config_value !== undefined) { sets.push('config_value = ?'); vals.push(body.config_value); }
    if (body.category !== undefined) { sets.push('category = ?'); vals.push(body.category); }
    if (body.is_active !== undefined) { sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0); }
    vals.push(id);

    await db.prepare(`UPDATE system_config SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = await db.prepare('SELECT * FROM system_config WHERE id = ?').get(id);
    return c.json(row || {});
  });

  // ═══════════════════════════════════════════════════════════
  // SHIFT STATS
  // ═══════════════════════════════════════════════════════════

  api.get('/shift-stats', async (c) => {
    const db = new D1Db(c.env.DB);
    const hour = new Date().getHours();
    let shiftName: string;
    let shiftStart: string;
    let shiftEnd: string;

    if (hour >= 6 && hour < 14) {
      shiftName = 'Day Shift (0600-1400)';
      shiftStart = localNow().split('T')[0] + 'T06:00:00';
      shiftEnd = localNow().split('T')[0] + 'T14:00:00';
    } else if (hour >= 14 && hour < 22) {
      shiftName = 'Swing Shift (1400-2200)';
      shiftStart = localNow().split('T')[0] + 'T14:00:00';
      shiftEnd = localNow().split('T')[0] + 'T22:00:00';
    } else {
      shiftName = 'Graveyard Shift (2200-0600)';
      if (hour >= 22) {
        shiftStart = localNow().split('T')[0] + 'T22:00:00';
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        shiftEnd = tomorrow.toISOString().split('T')[0] + 'T06:00:00';
      } else {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        shiftStart = yesterday.toISOString().split('T')[0] + 'T22:00:00';
        shiftEnd = localNow().split('T')[0] + 'T06:00:00';
      }
    }

    const [shiftCalls, shiftIncidents, shiftCitations] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM calls_for_service WHERE created_at >= ? AND created_at < ?').get(shiftStart, shiftEnd) as any,
      db.prepare('SELECT COUNT(*) as count FROM incidents WHERE created_at >= ? AND created_at < ?').get(shiftStart, shiftEnd) as any,
      db.prepare('SELECT COUNT(*) as count FROM citations WHERE created_at >= ? AND created_at < ?').get(shiftStart, shiftEnd) as any,
    ]);

    let shiftPatrolScans = { count: 0 } as any;
    try {
      shiftPatrolScans = await db.prepare('SELECT COUNT(*) as count FROM patrol_scans WHERE scanned_at >= ? AND scanned_at < ?').get(shiftStart, shiftEnd) as any;
    } catch { /* patrol_scans may not exist */ }

    return c.json({
      shift_name: shiftName, shift_start: shiftStart, shift_end: shiftEnd,
      calls: shiftCalls?.count || 0, incidents: shiftIncidents?.count || 0,
      citations: shiftCitations?.count || 0, patrol_scans: shiftPatrolScans?.count || 0,
    });
  });

  // ═══════════════════════════════════════════════════════════
  // UPCOMING COURT DATES
  // ═══════════════════════════════════════════════════════════

  api.get('/upcoming-court-dates', async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') || '30', 10)));

    let courtDates: any[] = [];
    try {
      courtDates = await db.prepare(`
        SELECT cit.id, cit.citation_number, cit.court_date, cit.court_location,
          cit.violation_description, cit.defendant_name, u.full_name as officer_name
        FROM citations cit LEFT JOIN users u ON cit.issuing_officer_id = u.id
        WHERE cit.court_date IS NOT NULL
          AND cit.court_date >= date('now')
          AND cit.court_date <= date('now', '+' || ? || ' days')
          AND cit.status NOT IN ('voided', 'dismissed')
        ORDER BY cit.court_date ASC LIMIT 50
      `).all(days);
    } catch { /* citations table may not have court_date */ }

    return c.json({ court_dates: courtDates, count: courtDates.length, period_days: days });
  });

  // ═══════════════════════════════════════════════════════════
  // EXPIRING CERTIFICATIONS
  // ═══════════════════════════════════════════════════════════

  api.get('/expiring-certifications', async (c) => {
    const db = new D1Db(c.env.DB);
    const days = Math.min(180, Math.max(1, parseInt(c.req.query('days') || '30', 10)));

    let expiring: any[] = [];
    try {
      expiring = await db.prepare(`
        SELECT pc.id, pc.officer_id, pc.certification_name, pc.expiration_date,
          u.full_name as officer_name, u.badge_number,
          CAST(julianday(pc.expiration_date) - julianday('now') AS INTEGER) as days_until_expiry
        FROM personnel_certifications pc LEFT JOIN users u ON pc.officer_id = u.id
        WHERE pc.expiration_date IS NOT NULL
          AND pc.expiration_date >= date('now')
          AND pc.expiration_date <= date('now', '+' || ? || ' days')
          AND u.status = 'active'
        ORDER BY pc.expiration_date ASC LIMIT 50
      `).all(days);
    } catch { /* table may not exist */ }

    let expired: any[] = [];
    try {
      expired = await db.prepare(`
        SELECT pc.id, pc.officer_id, pc.certification_name, pc.expiration_date,
          u.full_name as officer_name, u.badge_number
        FROM personnel_certifications pc LEFT JOIN users u ON pc.officer_id = u.id
        WHERE pc.expiration_date IS NOT NULL
          AND pc.expiration_date < date('now')
          AND u.status = 'active'
        ORDER BY pc.expiration_date DESC LIMIT 50
      `).all();
    } catch { /* table may not exist */ }

    return c.json({ expiring_soon: expiring, expiring_count: expiring.length, already_expired: expired, expired_count: expired.length, period_days: days });
  });

  app.route('/api/admin', api);
}
