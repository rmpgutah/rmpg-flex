import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { createSecurityNotification, parseDeviceName } from '../utils/deviceFingerprint';

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

// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/reset-2fa — Admin resets user's 2FA
// ═══════════════════════════════════════════════════════
router.post('/users/:id/reset-2fa', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string);
    const ip = String(req.ip || 'unknown');
    const userAgent = String(req.headers['user-agent'] || 'unknown');

    const user = db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Delete TOTP secret and backup codes
    db.prepare('DELETE FROM user_totp_secrets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_backup_codes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET totp_enabled = 0, totp_setup_required = 1, updated_at = ? WHERE id = ?')
      .run(localNow(), userId);

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

    res.json({ message: `2FA reset for ${user.full_name}. They will be prompted to set up 2FA on next login.` });
  } catch (error: any) {
    console.error('Reset 2FA error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ═══════════════════════════════════════════════════════
// POST /api/admin/users/:id/force-password-change
// ═══════════════════════════════════════════════════════
router.post('/users/:id/force-password-change', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.id as string);
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
    console.error('Force password change error:', error);
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

    res.json({
      totalActiveUsers: totalUsers.count,
      usersWithTwoFA: with2FA.count,
      usersPendingSetup: pendingSetup.count,
      twoFAAdoptionRate: totalUsers.count > 0 ? Math.round((with2FA.count / totalUsers.count) * 100) : 0,
      lockedAccounts,
      activeSessions: activeSessions.count,
      passwordsExpired: passwordsExpired.count,
      failedLoginsLast24h: recentFailures.count,
    });
  } catch (error: any) {
    console.error('Security overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
