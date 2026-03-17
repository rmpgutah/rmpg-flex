import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId } from '../middleware/sanitize';
import { localNow } from '../utils/timeUtils';
import { createSecurityNotification, parseDeviceName } from '../utils/deviceFingerprint';
import { sendNotificationEmail } from '../utils/emailSender';
import { setPasswordExpiry } from '../utils/passwordExpiry';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin', 'manager'));
// Validate all :id parameters as positive integers to prevent malformed input
router.param('id', (req: Request, res: Response, next: Function) => {
  const raw = String(req.params.id);
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || String(n) !== raw) {
    res.status(400).json({ error: 'Invalid ID parameter' });
    return;
  }
  next();
});

// GET /api/admin/clients - List all clients
router.get('/clients', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clients = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM properties WHERE client_id = c.id) as property_count
      FROM clients c
      ORDER BY c.name
    `).all();

    res.json(clients);
  } catch (error: any) {
    console.error('Get clients error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/clients/:id - Get single client
router.get('/clients/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const properties = db.prepare('SELECT * FROM properties WHERE client_id = ?').all(client.id);

    res.json({ ...client, properties });
  } catch (error: any) {
    console.error('Get client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/clients - Create client
router.post('/clients', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      name, contact_name, contact_email, contact_phone, address,
      contract_start, contract_end, sla_response_minutes, notes,
      billing_email, billing_address, contract_type, contract_value,
      payment_terms, auto_renew,
      client_code, industry, website, tax_id, payment_method,
      billing_cycle, billing_day, discount_percent, late_fee_percent,
      account_manager, priority_client, client_since,
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO clients (name, contact_name, contact_email, contact_phone, address,
        contract_start, contract_end, sla_response_minutes, notes,
        billing_email, billing_address, contract_type, contract_value,
        payment_terms, auto_renew,
        client_code, industry, website, tax_id, payment_method,
        billing_cycle, billing_day, discount_percent, late_fee_percent,
        account_manager, priority_client, client_since)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, contact_name || null, contact_email || null, contact_phone || null,
      address || null, contract_start || null, contract_end || null,
      sla_response_minutes ?? null, notes || null,
      billing_email || null, billing_address || null, contract_type || null,
      contract_value ?? null, payment_terms || null, auto_renew ? 1 : 0,
      client_code || null, industry || null, website || null, tax_id || null,
      payment_method || null, billing_cycle || null, billing_day ?? null,
      discount_percent ?? null, late_fee_percent ?? null,
      account_manager || null, priority_client ? 1 : 0, client_since || null,
    );

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    if (!client) { res.status(500).json({ error: 'Failed to retrieve created client' }); return; }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_created', 'client', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created client: ${name}`, req.ip || 'unknown');

    res.status(201).json(client);
  } catch (error: any) {
    console.error('Create client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/clients/:id - Update client
router.put('/clients/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    const {
      name, contact_name, contact_email, contact_phone, address,
      contract_start, contract_end, sla_response_minutes, notes, status,
      billing_email, billing_address, contract_type, contract_value,
      payment_terms, auto_renew,
      client_code, industry, website, tax_id, payment_method,
      billing_cycle, billing_day, discount_percent, late_fee_percent,
      account_manager, priority_client, client_since,
    } = req.body;

    // Build dynamic SET clause — only update fields explicitly provided
    const cFields: string[] = [];
    const cValues: any[] = [];
    const cBodyKeys = Object.keys(req.body);

    const cFieldMap: Record<string, (v: any) => any> = {
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
      billing_day: v => v ?? null,
      discount_percent: v => v ?? null, late_fee_percent: v => v ?? null,
      account_manager: v => v ?? null, priority_client: v => v ? 1 : 0,
      client_since: v => v ?? null,
      rate_per_hour: v => v ?? null, rate_per_incident: v => v ?? null, rate_per_cfs: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(cFieldMap)) {
      if (cBodyKeys.includes(key)) {
        cFields.push(`${key} = ?`);
        cValues.push(transform(req.body[key]));
      }
    }

    if (cFields.length > 0) {
      cFields.push("updated_at = ?");
      cValues.push(localNow());
      cValues.push(req.params.id);
      db.prepare(`UPDATE clients SET ${cFields.join(', ')} WHERE id = ?`).run(...cValues);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_updated', 'client', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated client: ${client.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/clients/:id - Delete client
router.delete('/clients/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found' });
      return;
    }

    // Check for associated properties
    const propCount = db.prepare('SELECT COUNT(*) as count FROM properties WHERE client_id = ?').get(client.id) as any;
    const propCountVal = propCount?.count ?? 0;
    if (propCountVal > 0) {
      res.status(400).json({ error: `Cannot delete client with ${propCountVal} associated properties` });
      return;
    }

    db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_deleted', 'client', ?, ?, ?)
    `).run(req.user!.userId, client.id, `Deleted client: ${client.name}`, req.ip || 'unknown');

    res.json({ message: 'Client deleted' });
  } catch (error: any) {
    console.error('Delete client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/clients/:id/archive
router.post('/clients/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }
    if (client.archived_at) { res.status(400).json({ error: 'Client is already archived' }); return; }

    const now = localNow();
    db.prepare('UPDATE clients SET archived_at = ? WHERE id = ?').run(now, client.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_archived', 'client', ?, ?, ?)`).run(
      req.user!.userId, client.id, `Archived client: ${client.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/clients/:id/unarchive
router.post('/clients/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) { res.status(404).json({ error: 'Client not found' }); return; }
    if (!client.archived_at) { res.status(400).json({ error: 'Client is not archived' }); return; }

    db.prepare('UPDATE clients SET archived_at = NULL WHERE id = ?').run(client.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_unarchived', 'client', ?, ?, ?)`).run(
      req.user!.userId, client.id, `Unarchived client: ${client.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// Call Templates CRUD
// ============================================================

// GET /api/admin/call-templates - List all call templates
router.get('/call-templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const templates = db.prepare(`
      SELECT ct.*, u.full_name as created_by_name
      FROM call_templates ct
      LEFT JOIN users u ON ct.created_by = u.id
      ORDER BY ct.sort_order ASC, ct.name ASC
    `).all();
    res.json(templates);
  } catch (error: any) {
    console.error('Get call templates error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/call-templates - Create call template
router.post('/call-templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, incident_type, priority, description_template, default_notes, source } = req.body;

    if (!name || !incident_type) {
      res.status(400).json({ error: 'name and incident_type are required' });
      return;
    }

    const maxOrder = db.prepare('SELECT MAX(sort_order) as max_order FROM call_templates').get() as any;
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;

    const result = db.prepare(`
      INSERT INTO call_templates (name, incident_type, priority, description_template, default_notes, source, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, incident_type, priority || 'P3',
      description_template || null, default_notes || null, source || 'dispatch',
      sortOrder, req.user!.userId,
    );

    const template = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(result.lastInsertRowid) || { id: result.lastInsertRowid };

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'template_created', 'call_template', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created call template: ${name}`, req.ip || 'unknown');

    res.status(201).json(template);
  } catch (error: any) {
    console.error('Create call template error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/call-templates/:id - Update call template
router.put('/call-templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Call template not found' });
      return;
    }

    const tmplFields = ['name', 'incident_type', 'priority', 'description_template', 'default_notes', 'source', 'is_active', 'sort_order'];
    const tmplBodyKeys = Object.keys(req.body);
    const tmplSet: string[] = [];
    const tmplVals: any[] = [];
    for (const f of tmplFields) {
      if (tmplBodyKeys.includes(f)) {
        tmplSet.push(`${f} = ?`);
        const v = req.body[f];
        tmplVals.push(v === '' ? null : v ?? null);
      }
    }
    if (tmplSet.length > 0) {
      tmplVals.push(req.params.id);
      db.prepare(`UPDATE call_templates SET ${tmplSet.join(', ')} WHERE id = ?`).run(...tmplVals);
    }

    const updated = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update call template error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/call-templates/:id - Soft-delete call template
router.delete('/call-templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Call template not found' });
      return;
    }

    db.prepare('UPDATE call_templates SET is_active = 0 WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'template_deleted', 'call_template', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Removed call template: ${existing.name}`, req.ip || 'unknown');

    res.json({ message: 'Call template removed' });
  } catch (error: any) {
    console.error('Delete call template error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// System Settings - Batch update
// ============================================================

// PUT /api/admin/system-settings - Upsert multiple system_settings config items
router.put('/system-settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const settings = req.body as Record<string, string>;

    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Request body must be an object of key-value pairs' });
      return;
    }

    const now = localNow();

    const upsert = db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
      VALUES (?, ?, 'system_settings', 0, ?, ?)
      ON CONFLICT(config_key, config_value) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = excluded.updated_at
    `);

    // For system_settings, we use config_key as the setting name and config_value as its value.
    // Because the unique index is on (config_key, config_value), we first delete old entries for each key.
    const deleteOld = db.prepare(
      "DELETE FROM system_config WHERE config_key = ? AND category = 'system_settings'"
    );

    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        deleteOld.run(key);
        db.prepare(`
          INSERT INTO system_config (config_key, config_value, category, sort_order, created_at, updated_at)
          VALUES (?, ?, 'system_settings', 0, ?, ?)
        `).run(key, String(value), now, now);
      }
    });
    tx();

    // Return all system_settings
    const all = db.prepare(
      "SELECT * FROM system_config WHERE category = 'system_settings' AND is_active = 1"
    ).all();

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'settings_updated', 'system_config', 0, ?, ?)
    `).run(req.user!.userId, `Updated system settings: ${Object.keys(settings).join(', ')}`, req.ip || 'unknown');

    res.json(all);
  } catch (error: any) {
    console.error('Update system settings error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/clients/:id/incidents - Incidents linked to client (via property FK or direct client_id)
router.get('/clients/:id/incidents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clientId = req.params.id;
    const incidents = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.priority, i.status,
             i.location_address, i.occurred_date, i.created_at,
             u.full_name as officer_name, p.name as property_name
      FROM incidents i
      LEFT JOIN users u ON i.officer_id = u.id
      LEFT JOIN properties p ON i.property_id = p.id
      WHERE i.client_id = ? OR p.client_id = ?
      ORDER BY i.created_at DESC
      LIMIT 100
    `).all(clientId, clientId);
    res.json(incidents);
  } catch (error: any) {
    console.error('Client incidents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/clients/:id/calls - CFS linked to client (via property FK or direct client_id)
router.get('/clients/:id/calls', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clientId = req.params.id;
    const calls = db.prepare(`
      SELECT c.id, c.call_number, c.incident_type, c.priority, c.status,
             c.location_address, c.description, c.created_at,
             p.name as property_name
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.client_id = ? OR p.client_id = ?
      ORDER BY c.created_at DESC
      LIMIT 100
    `).all(clientId, clientId);
    res.json(calls);
  } catch (error: any) {
    console.error('Client calls error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/clients/:id/billing - Billing summary
router.get('/clients/:id/billing', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clientId = req.params.id;
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any;
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const properties = db.prepare('SELECT id FROM properties WHERE client_id = ?').all(clientId) as any[];
    const propIds = properties.map((p: any) => p.id);

    let incidentCount = 0;
    let callCount = 0;
    if (propIds.length > 0) {
      const propPlaceholders = propIds.map(() => '?').join(',');
      const incResult = db.prepare(`SELECT COUNT(*) as cnt FROM incidents WHERE client_id = ? OR property_id IN (${propPlaceholders})`).get(clientId, ...propIds) as any;
      incidentCount = incResult?.cnt || 0;
      const callResult = db.prepare(`SELECT COUNT(*) as cnt FROM calls_for_service WHERE client_id = ? OR property_id IN (${propPlaceholders})`).get(clientId, ...propIds) as any;
      callCount = callResult?.cnt || 0;
    } else {
      const incResult = db.prepare('SELECT COUNT(*) as cnt FROM incidents WHERE client_id = ?').get(clientId) as any;
      incidentCount = incResult?.cnt || 0;
      const callResult = db.prepare('SELECT COUNT(*) as cnt FROM calls_for_service WHERE client_id = ?').get(clientId) as any;
      callCount = callResult?.cnt || 0;
    }

    // Invoice summary
    const invoiceSummary = db.prepare(`
      SELECT COUNT(*) as total_invoices,
             COALESCE(SUM(total), 0) as total_invoiced,
             COALESCE(SUM(amount_paid), 0) as total_paid,
             COALESCE(SUM(balance_due), 0) as outstanding,
             SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_count
      FROM invoices WHERE client_id = ? AND status NOT IN ('void','cancelled')
    `).get(clientId) as any;

    res.json({
      client_id: clientId,
      property_count: properties.length,
      incident_count: incidentCount,
      call_count: callCount,
      contract_value: client.contract_value,
      payment_terms: client.payment_terms,
      billing_email: client.billing_email,
      billing_address: client.billing_address,
      rate_per_hour: client.rate_per_hour,
      rate_per_incident: client.rate_per_incident,
      rate_per_cfs: client.rate_per_cfs,
      total_invoices: invoiceSummary?.total_invoices || 0,
      total_invoiced: invoiceSummary?.total_invoiced || 0,
      total_paid: invoiceSummary?.total_paid || 0,
      outstanding_balance: invoiceSummary?.outstanding || 0,
      overdue_count: invoiceSummary?.overdue_count || 0,
    });
  } catch (error: any) {
    console.error('Client billing error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── SESSIONS (admin-only: view all, revoke any) ─────────

router.get('/sessions', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT s.id, s.user_id, s.session_id, s.ip_address, s.user_agent,
        s.is_active, s.created_at, s.last_used_at, s.expires_at,
        u.username, u.full_name, u.role
      FROM sessions s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.last_used_at DESC
      LIMIT 200
    `).all();
    res.json(sessions);
  } catch (error: any) {
    console.error('Admin get sessions error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sessions/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Session revoked' });
  } catch (error: any) {
    console.error('Admin revoke session error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RADIO CHANNELS (admin CRUD) ──────────────────────────

// GET /api/admin/radio-channels — all channels (including inactive)
router.get('/radio-channels', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT config_key, config_value, sort_order, is_active, created_at, updated_at FROM system_config WHERE category = 'radio_channel' ORDER BY sort_order ASC"
    ).all() as { config_key: string; config_value: string; sort_order: number; is_active: number; created_at: string; updated_at: string }[];

    const channels = rows.map((r) => {
      let meta: any = {};
      try { meta = JSON.parse(r.config_value); } catch { /* */ }
      return {
        id: r.config_key,
        label: meta.label || r.config_key.toUpperCase(),
        freq: meta.freq || '0.000',
        sort_order: r.sort_order,
        is_active: !!r.is_active,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    res.json(channels);
  } catch (error: any) {
    console.error('Admin get radio channels error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/radio-channels — create a new radio channel
router.post('/radio-channels', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id, label, freq } = req.body;

    if (!id || !label) {
      res.status(400).json({ error: 'id and label are required' });
      return;
    }

    // Check for duplicate
    const existing = db.prepare(
      "SELECT config_key FROM system_config WHERE category = 'radio_channel' AND config_key = ?"
    ).get(id);
    if (existing) {
      res.status(409).json({ error: 'A radio channel with that ID already exists' });
      return;
    }

    // Get next sort_order
    const maxRow = db.prepare(
      "SELECT MAX(sort_order) as mx FROM system_config WHERE category = 'radio_channel'"
    ).get() as any;
    const sortOrder = (maxRow?.mx ?? -1) + 1;

    const now = localNow();
    const value = JSON.stringify({ label, freq: freq || '0.000' });

    db.prepare(
      "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'radio_channel', ?, 1, ?, ?)"
    ).run(id, value, sortOrder, now, now);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'radio_channel_created', 'radio_channel', 0, ?, ?)"
    ).run(req.user!.userId, `Created radio channel: ${label} (${id})`, req.ip || 'unknown');

    res.status(201).json({ id, label, freq: freq || '0.000', sort_order: sortOrder, is_active: true });
  } catch (error: any) {
    console.error('Admin create radio channel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/radio-channels/:key — update a radio channel
router.put('/radio-channels/:key', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const key = req.params.key;
    const existing = db.prepare(
      "SELECT config_key, config_value FROM system_config WHERE category = 'radio_channel' AND config_key = ?"
    ).get(key) as any;

    if (!existing) {
      res.status(404).json({ error: 'Radio channel not found' });
      return;
    }

    const { label, freq, is_active, sort_order } = req.body;
    let meta: any = {};
    try { meta = JSON.parse(existing.config_value); } catch { /* */ }

    if (label !== undefined) meta.label = label;
    if (freq !== undefined) meta.freq = freq;

    const now = localNow();

    const sets: string[] = ['config_value = ?', 'updated_at = ?'];
    const vals: any[] = [JSON.stringify(meta), now];

    if (is_active !== undefined) {
      sets.push('is_active = ?');
      vals.push(is_active ? 1 : 0);
    }
    if (sort_order !== undefined) {
      sets.push('sort_order = ?');
      vals.push(sort_order);
    }

    vals.push(key);
    db.prepare(
      `UPDATE system_config SET ${sets.join(', ')} WHERE category = 'radio_channel' AND config_key = ?`
    ).run(...vals);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'radio_channel_updated', 'radio_channel', 0, ?, ?)"
    ).run(req.user!.userId, `Updated radio channel: ${key}`, req.ip || 'unknown');

    res.json({ id: key, label: meta.label, freq: meta.freq, is_active: is_active !== undefined ? !!is_active : true, sort_order });
  } catch (error: any) {
    console.error('Admin update radio channel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/radio-channels/:key — remove a radio channel
router.delete('/radio-channels/:key', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const key = req.params.key;
    const existing = db.prepare(
      "SELECT config_key FROM system_config WHERE category = 'radio_channel' AND config_key = ?"
    ).get(key);

    if (!existing) {
      res.status(404).json({ error: 'Radio channel not found' });
      return;
    }

    db.prepare("DELETE FROM system_config WHERE category = 'radio_channel' AND config_key = ?").run(key);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'radio_channel_deleted', 'radio_channel', 0, ?, ?)"
    ).run(req.user!.userId, `Deleted radio channel: ${key}`, req.ip || 'unknown');

    res.json({ message: 'Radio channel deleted' });
  } catch (error: any) {
    console.error('Admin delete radio channel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/radio-channels/seed — seed default channels if none exist
router.post('/radio-channels/seed', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM system_config WHERE category = 'radio_channel'"
    ).get() as any;

    if (count.cnt > 0) {
      res.json({ message: 'Radio channels already configured', seeded: false });
      return;
    }

    const defaults = [
      { id: 'dispatch', label: 'DISPATCH', freq: '155.010' },
      { id: 'tac-1',    label: 'TAC-1',    freq: '155.475' },
      { id: 'tac-2',    label: 'TAC-2',    freq: '155.730' },
      { id: 'tac-3',    label: 'TAC-3',    freq: '156.090' },
      { id: 'patrol',   label: 'PATROL',   freq: '156.240' },
      { id: 'admin',    label: 'ADMIN',    freq: '158.985' },
    ];

    const now = localNow();
    const stmt = db.prepare(
      "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'radio_channel', ?, 1, ?, ?)"
    );

    db.transaction(() => {
      defaults.forEach((ch, i) => {
        stmt.run(ch.id, JSON.stringify({ label: ch.label, freq: ch.freq }), i, now, now);
      });
    })();

    res.json({ message: 'Seeded default radio channels', seeded: true, count: defaults.length });
  } catch (error: any) {
    console.error('Admin seed radio channels error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/account-stats - Aggregate account statistics
router.get('/account-stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_users,
        SUM(CASE WHEN status = 'terminated' THEN 1 ELSE 0 END) as terminated_users,
        SUM(COALESCE(login_count, 0)) as total_logins,
        AVG(COALESCE(login_count, 0)) as avg_logins_per_user,
        MAX(last_login_at) as most_recent_login
      FROM users
    `).get() as any;

    // Top 10 users by login count
    const topUsers = db.prepare(`
      SELECT id, username, full_name, login_count, last_login_at, role, status
      FROM users
      WHERE login_count > 0
      ORDER BY login_count DESC
      LIMIT 10
    `).all();

    // Logins in last 24h, 7d, 30d from activity_log
    const now = localNow();
    const loginCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN created_at >= datetime(?, '-1 day') THEN 1 ELSE 0 END) as last_24h,
        SUM(CASE WHEN created_at >= datetime(?, '-7 days') THEN 1 ELSE 0 END) as last_7d,
        SUM(CASE WHEN created_at >= datetime(?, '-30 days') THEN 1 ELSE 0 END) as last_30d
      FROM activity_log
      WHERE action = 'user_login'
    `).get(now, now, now) as any;

    // Users who never logged in
    const neverLoggedIn = db.prepare(`
      SELECT id, username, full_name, role, status, created_at
      FROM users
      WHERE (login_count IS NULL OR login_count = 0) AND status = 'active'
      ORDER BY created_at
    `).all();

    res.json({
      ...totals,
      topUsers,
      loginCounts: loginCounts || { last_24h: 0, last_7d: 0, last_30d: 0 },
      neverLoggedIn,
    });
  } catch (error: any) {
    console.error('Admin account stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/reset-2fa — Admin resets user's 2FA
// ═══════════════════════════════════════════════════════
router.post('/users/:id/reset-2fa', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id as string, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const user = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(targetId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const reqIp = req.ip || 'unknown';
    const reqUserAgent = req.headers['user-agent'] || 'unknown';

    // Delete TOTP secret and backup codes
    db.prepare('DELETE FROM user_totp_secrets WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(targetId);
    db.prepare('UPDATE users SET totp_enabled = 0, totp_setup_required = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), targetId);

    // Also clear legacy TOTP columns if they exist
    try {
      db.prepare(`
        UPDATE users SET totp_secret_enc = NULL, totp_backup_codes = NULL,
          totp_pending_secret = NULL WHERE id = ?
      `).run(targetId);
    } catch { /* legacy columns may not exist */ }

    // Log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, '2fa_reset', 'user', ?, ?, ?)
    `).run(req.user!.userId, targetId, `Admin reset 2FA for ${user.username}`, reqIp);

    createSecurityNotification(
      targetId,
      '2fa_reset',
      'Two-factor authentication reset',
      `Your 2FA was reset by an administrator. You will need to set it up again on next login.`,
      reqIp,
      parseDeviceName(reqUserAgent)
    );

    res.json({ message: `2FA reset for ${user.full_name}. They will be prompted to set up 2FA on next login.` });
  } catch (error: any) {
    console.error('Reset 2FA error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// GET /api/admin/security/overview — System-wide security metrics
// ═══════════════════════════════════════════════════════
router.get('/security/overview', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get() as { count: number };
    const with2FA = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active' AND totp_enabled = 1").get() as { count: number };
    const pendingSetup = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active' AND totp_setup_required = 1").get() as { count: number };
    const lockedAccounts = db.prepare(`
      SELECT COUNT(DISTINCT username) as count FROM login_attempts
      WHERE success = 0 AND created_at > datetime('now', '-15 minutes')
      GROUP BY username HAVING COUNT(*) >= 5
    `).all().length;
    const activeSessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE is_active = 1").get() as { count: number };
    const passwordsExpired = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active' AND password_expires_at IS NOT NULL AND password_expires_at < datetime('now','localtime')").get() as { count: number };

    // Recent failed login attempts (last 24h)
    const recentFailures = db.prepare(`
      SELECT COUNT(*) as count FROM login_attempts
      WHERE success = 0 AND created_at > datetime('now', '-1 day', 'localtime')
    `).get() as { count: number };

    const totalCount = totalUsers?.count ?? 0;
    const twoFACount = with2FA?.count ?? 0;
    res.json({
      totalActiveUsers: totalCount,
      usersWithTwoFA: twoFACount,
      usersPendingSetup: pendingSetup?.count ?? 0,
      twoFAAdoptionRate: totalCount > 0 ? Math.round((twoFACount / totalCount) * 100) : 0,
      lockedAccounts,
      activeSessions: activeSessions?.count ?? 0,
      passwordsExpired: passwordsExpired?.count ?? 0,
      failedLoginsLast24h: recentFailures?.count ?? 0,
    });
  } catch (error: any) {
    console.error('Security overview error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/reset-2fa — Admin resets user's 2FA (new tables)
// ═══════════════════════════════════════════════════════
router.post('/users/:id/reset-2fa', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const ip = String(req.ip || 'unknown');
    const userAgent = String(req.headers['user-agent'] || 'unknown');

    const user = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Delete TOTP secret and backup codes from new tables
    db.prepare('DELETE FROM user_totp_secrets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId);

    // Also clear old-style columns for full cleanup
    db.prepare(`
      UPDATE users SET totp_enabled = 0, totp_setup_required = 1,
        totp_secret_enc = NULL, totp_backup_codes = NULL, totp_pending_secret = NULL,
        updated_at = ? WHERE id = ?
    `).run(localNow(), userId);

    // Log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, '2fa_reset', 'user', ?, ?, ?)
    `).run(req.user!.userId, userId, `Admin reset 2FA for ${user.username}`, ip);

    createSecurityNotification(
      userId,
      '2fa_reset',
      'Two-factor authentication reset',
      `Your 2FA was reset by an administrator. You will need to set it up again on next login.`,
      ip,
      parseDeviceName(userAgent)
    );

    // Email alert for 2FA reset
    sendNotificationEmail(
      userId,
      'Two-Factor Authentication Reset',
      `Your RMPG Flex two-factor authentication has been reset by an administrator.\n\nYou will be required to set up 2FA again on your next login.\n\nTime: ${localNow()}\n\nIf you did not request this, contact your administrator immediately.`
    ).catch((err) => { console.error('[Admin] Background operation failed:', err.message || err); });

    res.json({ message: `2FA reset for ${user.full_name}. They will be prompted to set up 2FA on next login.` });
  } catch (error: any) {
    console.error('Reset 2FA error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/force-password-change
// ═══════════════════════════════════════════════════════
router.post('/users/:id/force-password-change', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const ip = String(req.ip || 'unknown');

    const user = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    db.prepare('UPDATE users SET force_password_change = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), userId);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'force_password_change', 'user', ?, ?, ?)
    `).run(req.user!.userId, userId, `Admin forced password change for ${user.username}`, ip);

    createSecurityNotification(
      userId,
      'password_expiring',
      'Password change required',
      'An administrator has required you to change your password on next login.',
      ip
    );

    res.json({ message: `${user.full_name} will be required to change password on next login.` });
  } catch (error: any) {
    console.error('Force password change error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/reset-password — Admin sets a new password for a user
// ═══════════════════════════════════════════════════════
router.post('/users/:id/reset-password', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const bcryptjs = require('bcryptjs');
    const db = getDb();
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const { password } = req.body;
    if (!password || typeof password !== 'string' || password.trim().length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }
    const ip = String(req.ip || 'unknown');

    const user = db.prepare('SELECT id, username, full_name, password_expiry_exempt FROM users WHERE id = ?').get(userId) as any;
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const hash = bcryptjs.hashSync(password.trim(), 12);

    // Exempt users (e.g., admin/chzamo5000) get their password set without
    // being forced to change it again on next login. Non-exempt users must
    // change it to maintain security.
    const forceChange = user.password_expiry_exempt ? 0 : 1;
    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = ?, force_password_change = ?,
        last_password_change = ?, password_changed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(hash, forceChange, forceChange, localNow(), localNow(), localNow(), userId);

    // Set proper password expiry (respects exemption — exempt users get NULL expiry)
    try { setPasswordExpiry(userId); } catch { /* column may not exist */ }

    // Invalidate all existing sessions
    db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(userId);

    // Clear any login lockout for this user
    db.prepare('DELETE FROM login_attempts WHERE username = ? AND success = 0').run(user.username);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'admin_password_reset', 'user', ?, ?, ?)
    `).run(req.user!.userId, userId, `Admin reset password for ${user.username}`, ip);

    const changeMsg = forceChange
      ? `Password reset for ${user.full_name}. They must change it on next login.`
      : `Password reset for ${user.full_name} (exempt from mandatory change).`;

    if (forceChange) {
      createSecurityNotification(
        userId,
        'password_expiring',
        'Password reset by administrator',
        'An administrator has reset your password. You will be required to set a new password on your next login.',
        ip
      );
    }

    res.json({ message: changeMsg });
  } catch (error: any) {
    console.error('Admin password reset error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/revoke-sessions — Revoke all sessions for a user
// ═══════════════════════════════════════════════════════
router.post('/users/:id/revoke-sessions', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const ip = String(req.ip || 'unknown');

    const user = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const result = db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(userId);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'admin_revoke_sessions', 'user', ?, ?, ?)
    `).run(req.user!.userId, userId, `Admin revoked ${result.changes} sessions for ${user.username}`, ip);

    createSecurityNotification(
      userId,
      'all_sessions_revoked',
      'Sessions Terminated',
      'An administrator has terminated all your active sessions. Please log in again.',
      ip
    );

    res.json({ message: `Revoked ${result.changes} session(s) for ${user.full_name}.`, count: result.changes });
  } catch (error: any) {
    console.error('Admin revoke sessions error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════
// PUT /api/admin/users/:id/role — Change a user's role
// ═══════════════════════════════════════════════════════
router.put('/users/:id/role', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const { role } = req.body;
    const ip = String(req.ip || 'unknown');

    const validRoles = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    const user = db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent self-demotion
    if (userId === req.user!.userId && role !== 'admin') {
      res.status(400).json({ error: 'Cannot change your own role' });
      return;
    }

    const oldRole = user.role;
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .run(role, localNow(), userId);

    // Invalidate all sessions — forces re-login so the new role takes effect in fresh JWTs
    // Without this, the user's existing JWTs still carry the old role until they expire
    db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(userId);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'role_changed', 'user', ?, ?, ?)
    `).run(req.user!.userId, userId, `Role changed: ${oldRole} → ${role} for ${user.username}`, ip);

    createSecurityNotification(
      userId,
      'role_changed',
      'Role Changed',
      `Your role has been changed from ${oldRole} to ${role} by an administrator.`,
      ip
    );

    // Email alert for role change
    sendNotificationEmail(
      userId,
      'Role Changed',
      `Your RMPG Flex role has been changed from ${oldRole} to ${role} by an administrator.\n\nTime: ${localNow()}\n\nIf you believe this is an error, contact your administrator.`
    ).catch((err) => { console.error('[Admin] Background operation failed:', err.message || err); });

    res.json({ message: `${user.full_name}'s role changed from ${oldRole} to ${role}.`, oldRole, newRole: role });
  } catch (error: any) {
    console.error('Change role error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════
// PUT /api/admin/users/:id/status — Change a user's status
// ═══════════════════════════════════════════════════════
router.put('/users/:id/status', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const { status } = req.body;
    const ip = String(req.ip || 'unknown');

    const validStatuses = ['active', 'inactive', 'terminated'];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status value' });
      return;
    }

    const user = db.prepare('SELECT id, username, full_name, status FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent self-deactivation
    if (userId === req.user!.userId && status !== 'active') {
      res.status(400).json({ error: 'Cannot deactivate your own account' });
      return;
    }

    const oldStatus = user.status;
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, localNow(), userId);

    // If deactivating/terminating, also revoke all sessions
    if (status !== 'active') {
      db.prepare('UPDATE sessions SET is_active = 0 WHERE user_id = ?').run(userId);
    }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'status_changed', 'user', ?, ?, ?)
    `).run(req.user!.userId, userId, `Status changed: ${oldStatus} → ${status} for ${user.username}`, ip);

    res.json({ message: `${user.full_name}'s status changed from ${oldStatus} to ${status}.`, oldStatus, newStatus: status });
  } catch (error: any) {
    console.error('Change status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
