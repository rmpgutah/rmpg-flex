import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin', 'manager'));

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
    console.error('Get clients error:', error);
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
    console.error('Get client error:', error);
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
      sla_response_minutes || null, notes || null,
      billing_email || null, billing_address || null, contract_type || null,
      contract_value || null, payment_terms || null, auto_renew ? 1 : 0,
      client_code || null, industry || null, website || null, tax_id || null,
      payment_method || null, billing_cycle || null, billing_day || null,
      discount_percent || null, late_fee_percent || null,
      account_manager || null, priority_client ? 1 : 0, client_since || null,
    );

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_created', 'client', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created client: ${name}`, req.ip || 'unknown');

    res.status(201).json(client);
  } catch (error: any) {
    console.error('Create client error:', error);
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
    console.error('Update client error:', error);
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
    if (propCount.count > 0) {
      res.status(400).json({ error: `Cannot delete client with ${propCount.count} associated properties` });
      return;
    }

    db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_deleted', 'client', ?, ?, ?)
    `).run(req.user!.userId, client.id, `Deleted client: ${client.name}`, req.ip || 'unknown');

    res.json({ message: 'Client deleted' });
  } catch (error: any) {
    console.error('Delete client error:', error);
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
    console.error('Archive client error:', error);
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
    console.error('Unarchive client error:', error);
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
    console.error('Get call templates error:', error);
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

    const template = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(result.lastInsertRowid);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'template_created', 'call_template', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created call template: ${name}`, req.ip || 'unknown');

    res.status(201).json(template);
  } catch (error: any) {
    console.error('Create call template error:', error);
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
    console.error('Update call template error:', error);
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
    console.error('Delete call template error:', error);
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
    console.error('Update system settings error:', error);
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
    console.error('Client incidents error:', error);
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
    console.error('Client calls error:', error);
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
    console.error('Client billing error:', error);
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
    console.error('Admin get sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sessions/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Session revoked' });
  } catch (error: any) {
    console.error('Admin revoke session error:', error);
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
    console.error('Admin get radio channels error:', error);
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
    console.error('Admin create radio channel error:', error);
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
    console.error('Admin update radio channel error:', error);
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
    console.error('Admin delete radio channel error:', error);
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
    console.error('Admin seed radio channels error:', error);
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
    console.error('Admin account stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/admin/users/:id/totp ────────────────
// Admin can reset a user's 2FA (e.g., lost authenticator)
router.delete('/users/:id/totp', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const target = db.prepare('SELECT id, username, totp_enabled FROM users WHERE id = ?')
      .get(targetId) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    db.prepare(`
      UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes = NULL,
        totp_pending_secret = NULL, updated_at = datetime('now','localtime') WHERE id = ?
    `).run(targetId);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'admin_reset_totp', 'user', ?, ?, ?)
    `).run(req.user!.userId, targetId, `Admin reset 2FA for ${target.username}`, req.ip || 'unknown');

    res.json({ message: `Two-factor authentication reset for ${target.username}` });
  } catch (error: any) {
    console.error('Admin TOTP reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/admin/users/:id/totp-exempt ────────────
// Admin can toggle a user's 2FA exemption
router.put('/users/:id/totp-exempt', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const { exempt } = req.body;
    const value = exempt ? 1 : 0;

    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    db.prepare("UPDATE users SET totp_exempt = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(value, targetId);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'admin_toggle_totp_exempt', 'user', ?, ?, ?)
    `).run(req.user!.userId, targetId, `Admin ${value ? 'exempted' : 'un-exempted'} ${target.username} from 2FA`, req.ip || 'unknown');

    res.json({ message: `${target.username} is now ${value ? 'exempt from' : 'subject to'} mandatory 2FA`, totp_exempt: value });
  } catch (error: any) {
    console.error('Admin TOTP exempt toggle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════
// Feature 22: User activity heatmap
// ═══════════════════════════════════════════════════════════
router.get('/user-activity-heatmap', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const daysNum = parseInt(days as string, 10) || 30;
    const cutoff = new Date(Date.now() - daysNum * 86400000).toISOString();

    const rows = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM activity_log
      WHERE created_at >= ?
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(cutoff);

    res.json({ data: rows });
  } catch (error: any) {
    console.error('User activity heatmap error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════
// Feature 23: Audit log export
// ═══════════════════════════════════════════════════════════
router.get('/audit/export', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date_from, date_to, action, entity_type } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (date_from) { where += ' AND al.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND al.created_at <= ?'; params.push(date_to); }
    if (action) { where += ' AND al.action = ?'; params.push(action); }
    if (entity_type) { where += ' AND al.entity_type = ?'; params.push(entity_type); }

    const rows = db.prepare(`
      SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.ip_address, al.created_at,
        u.full_name as user_name, u.username, u.role
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT 10000
    `).all(...params) as any[];

    // Build CSV
    const headers = ['ID', 'Timestamp', 'User', 'Username', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Details', 'IP Address'];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      csvRows.push([
        r.id, `"${r.created_at || ''}"`, `"${(r.user_name || '').replace(/"/g, '""')}"`,
        `"${r.username || ''}"`, r.role || '', `"${r.action || ''}"`,
        `"${r.entity_type || ''}"`, r.entity_id || '',
        `"${(r.details || '').replace(/"/g, '""')}"`, r.ip_address || '',
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csvRows.join('\n'));
  } catch (error: any) {
    console.error('Audit export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════
// Feature 24: Config change history
// ═══════════════════════════════════════════════════════════
router.get('/config-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { limit = '50' } = req.query;
    const limitNum = Math.min(500, parseInt(limit as string, 10) || 50);

    const rows = db.prepare(`
      SELECT cch.*, u.full_name as changed_by_name
      FROM config_change_history cch
      LEFT JOIN users u ON cch.changed_by = u.id
      ORDER BY cch.changed_at DESC
      LIMIT ?
    `).all(limitNum);

    res.json({ data: rows });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 25: API usage statistics
// ═══════════════════════════════════════════════════════════
router.get('/api-stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '7' } = req.query;
    const daysNum = parseInt(days as string, 10) || 7;
    const cutoff = new Date(Date.now() - daysNum * 86400000).toISOString();

    // Group activity by action to approximate API usage
    const byAction = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= ?
      GROUP BY action
      ORDER BY count DESC
      LIMIT 50
    `).all(cutoff);

    const byUser = db.prepare(`
      SELECT u.full_name, COUNT(*) as count
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
      GROUP BY al.user_id
      ORDER BY count DESC
      LIMIT 20
    `).all(cutoff);

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= ?
      GROUP BY hour
      ORDER BY hour
    `).all(cutoff);

    res.json({ data: { byAction, byUser, byHour } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 27: Database backup status
// ═══════════════════════════════════════════════════════════
router.get('/backup-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fs = require('fs');
    const path = require('path');
    const DATA_DIR = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
    const dbPath = path.join(DATA_DIR, 'rmpg-flex.db');

    let dbSize = 0;
    let lastModified = null;
    try {
      const stat = fs.statSync(dbPath);
      dbSize = stat.size;
      lastModified = stat.mtime.toISOString();
    } catch { /* file may not exist */ }

    // Check for backup files
    const backups: any[] = [];
    try {
      const files = fs.readdirSync(DATA_DIR);
      for (const f of files) {
        if (f.includes('backup') || f.endsWith('.bak')) {
          const stat = fs.statSync(path.join(DATA_DIR, f));
          backups.push({ filename: f, size: stat.size, created: stat.mtime.toISOString() });
        }
      }
    } catch { /* ignore */ }

    res.json({ data: { dbSize, lastModified, backups, walSize: 0 } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 28: Error log viewer
// ═══════════════════════════════════════════════════════════
router.get('/error-logs', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { limit = '50' } = req.query;
    const limitNum = Math.min(200, parseInt(limit as string, 10) || 50);

    // Use activity_log entries that contain 'error' in action/details
    const rows = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.action LIKE '%error%' OR al.details LIKE '%error%' OR al.details LIKE '%failed%'
        OR al.action LIKE '%fail%'
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(limitNum);

    res.json({ data: rows });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 29: System announcements
// ═══════════════════════════════════════════════════════════
router.get('/announcements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { active_only } = req.query;
    let where = '';
    if (active_only === 'true') where = 'WHERE a.active = 1 AND (a.expires_at IS NULL OR a.expires_at > datetime("now","localtime"))';

    const rows = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM system_announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ${where}
      ORDER BY a.created_at DESC
    `).all();
    res.json({ data: rows });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/announcements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, message, priority, show_on_login, expires_at } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });

    const result = db.prepare(`
      INSERT INTO system_announcements (title, message, priority, show_on_login, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, message, priority || 'info', show_on_login !== false ? 1 : 0, expires_at || null, req.user!.userId);

    const row = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/announcements/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, message, priority, active, show_on_login, expires_at } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (message !== undefined) { fields.push('message = ?'); values.push(message); }
    if (priority !== undefined) { fields.push('priority = ?'); values.push(priority); }
    if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
    if (show_on_login !== undefined) { fields.push('show_on_login = ?'); values.push(show_on_login ? 1 : 0); }
    if (expires_at !== undefined) { fields.push('expires_at = ?'); values.push(expires_at); }
    if (fields.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE system_announcements SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
    const row = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(req.params.id);
    res.json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/announcements/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM system_announcements WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 30: Maintenance mode toggle
// ═══════════════════════════════════════════════════════════
router.get('/maintenance-mode', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = 'maintenance_mode'").get() as any;
    res.json({ enabled: row?.config_value === 'true', message: '' });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/maintenance-mode', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { enabled, message } = req.body;
    const now = localNow();

    // Delete old maintenance_mode rows and insert fresh
    db.prepare("DELETE FROM system_config WHERE config_key = 'maintenance_mode'").run();
    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, updated_at)
      VALUES ('maintenance_mode', ?, 'system', ?)
    `).run(enabled ? 'true' : 'false', now);

    if (message) {
      db.prepare("DELETE FROM system_config WHERE config_key = 'maintenance_message'").run();
      db.prepare(`
        INSERT INTO system_config (config_key, config_value, category, updated_at)
        VALUES ('maintenance_message', ?, 'system', ?)
      `).run(message, now);
    }

    // Log change
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'maintenance_mode', 'system', 0, ?, ?)`).run(
      req.user!.userId, `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`, req.ip || 'unknown');

    res.json({ enabled: !!enabled });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 36: Record locking
// ═══════════════════════════════════════════════════════════
router.post('/record-locks', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { entity_type, entity_id } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

    // Check existing lock
    const existing = db.prepare(`
      SELECT rl.*, u.full_name as locked_by_name
      FROM record_locks rl LEFT JOIN users u ON rl.locked_by = u.id
      WHERE rl.entity_type = ? AND rl.entity_id = ? AND rl.expires_at > ?
    `).get(entity_type, entity_id, now) as any;

    if (existing && existing.locked_by !== req.user!.userId) {
      return res.status(409).json({
        error: 'Record is locked',
        locked_by: existing.locked_by_name,
        expires_at: existing.expires_at,
      });
    }

    // Create/update lock (5 min expiry)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO record_locks (entity_type, entity_id, locked_by, locked_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET locked_by = ?, locked_at = ?, expires_at = ?
    `).run(entity_type, entity_id, req.user!.userId, now, expiresAt, req.user!.userId, now, expiresAt);

    res.json({ data: { entity_type, entity_id, locked_by: req.user!.userId, expires_at: expiresAt } });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/record-locks/:entity_type/:entity_id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM record_locks WHERE entity_type = ? AND entity_id = ? AND locked_by = ?')
      .run(req.params.entity_type, req.params.entity_id, req.user!.userId);
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
