import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getDb } from '../models/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import { auditLog } from '../utils/auditLogger';
import { config } from '../config';

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
<<<<<<< HEAD
    console.error('Get clients error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get clients error:', error);
    res.status(500).json({ error: 'Failed to get clients', code: 'GET_CLIENTS_ERROR' });
>>>>>>> origin/main
  }
});

// GET /api/admin/clients/:id - Get single client
router.get('/clients/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
      return;
    }

    const properties = db.prepare('SELECT * FROM properties WHERE client_id = ?').all(client.id);

    res.json({ ...client, properties });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get client error:', error);
    res.status(500).json({ error: 'Failed to get client', code: 'GET_CLIENT_ERROR' });
>>>>>>> origin/main
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
      res.status(400).json({ error: 'name is required', code: 'NAME_IS_REQUIRED' });
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
<<<<<<< HEAD
    console.error('Create client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client', code: 'CREATE_CLIENT_ERROR' });
>>>>>>> origin/main
  }
});

// PUT /api/admin/clients/:id - Update client
router.put('/clients/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
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
<<<<<<< HEAD
    console.error('Update client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Update client error:', error);
    res.status(500).json({ error: 'Failed to update client', code: 'UPDATE_CLIENT_ERROR' });
>>>>>>> origin/main
  }
});

// DELETE /api/admin/clients/:id - Delete client
router.delete('/clients/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
      return;
    }

    // Check for associated properties
    // God Mode: admin bypass — cascade delete/unlink properties first
    const propCount = db.prepare('SELECT COUNT(*) as count FROM properties WHERE client_id = ?').get(client.id) as any;
    if (propCount.count > 0) {
      if (req.user?.role !== 'admin') {
        res.status(400).json({ error: `Cannot delete client with ${propCount.count} associated properties` });
        return;
      } else {
        // Admin force cleanup: unlink properties from this client
        db.prepare('UPDATE properties SET client_id = NULL WHERE client_id = ?').run(client.id);
        auditLog(req, 'ADMIN_OVERRIDE', 'client', client.id, `Admin God Mode: unlinked ${propCount.count} properties before deleting client ${client.name}`);
      }
    }

    db.prepare('DELETE FROM clients WHERE id = ?').run(client.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_deleted', 'client', ?, ?, ?)
    `).run(req.user!.userId, client.id, `Deleted client: ${client.name}`, req.ip || 'unknown');

    res.json({ message: 'Client deleted' });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Delete client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Failed to delete client', code: 'DELETE_CLIENT_ERROR' });
>>>>>>> origin/main
  }
});

// POST /api/admin/clients/:id/archive
router.post('/clients/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) { res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }); return; }
    if (client.archived_at) { res.status(400).json({ error: 'Client is already archived', code: 'CLIENT_IS_ALREADY_ARCHIVED' }); return; }

    const now = localNow();
    db.prepare('UPDATE clients SET archived_at = ? WHERE id = ?').run(now, client.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_archived', 'client', ?, ?, ?)`).run(
      req.user!.userId, client.id, `Archived client: ${client.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    res.json(updated);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Archive client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Archive client error:', error);
    res.status(500).json({ error: 'Failed to archive client', code: 'ARCHIVE_CLIENT_ERROR' });
>>>>>>> origin/main
  }
});

// POST /api/admin/clients/:id/unarchive
router.post('/clients/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) { res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }); return; }
    if (!client.archived_at) { res.status(400).json({ error: 'Client is not archived', code: 'CLIENT_IS_NOT_ARCHIVED' }); return; }

    db.prepare('UPDATE clients SET archived_at = NULL WHERE id = ?').run(client.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'client_unarchived', 'client', ?, ?, ?)`).run(
      req.user!.userId, client.id, `Unarchived client: ${client.name}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(client.id);
    res.json(updated);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Unarchive client error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Unarchive client error:', error);
    res.status(500).json({ error: 'Failed to unarchive client', code: 'UNARCHIVE_CLIENT_ERROR' });
>>>>>>> origin/main
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
    
      LIMIT 1000
    `).all();
    res.json(templates);
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Get call templates error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Get call templates error:', error);
    res.status(500).json({ error: 'Failed to get call templates', code: 'GET_CALL_TEMPLATES_ERROR' });
>>>>>>> origin/main
  }
});

// POST /api/admin/call-templates - Create call template
router.post('/call-templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, incident_type, priority, description_template, default_notes, source } = req.body;

    if (!name || !incident_type) {
      res.status(400).json({ error: 'name and incident_type are required', code: 'NAME_AND_INCIDENTTYPE_ARE' });
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
<<<<<<< HEAD
    console.error('Create call template error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Create call template error:', error);
    res.status(500).json({ error: 'Failed to create call template', code: 'CREATE_CALL_TEMPLATE_ERROR' });
>>>>>>> origin/main
  }
});

// PUT /api/admin/call-templates/:id - Update call template
router.put('/call-templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Call template not found', code: 'CALL_TEMPLATE_NOT_FOUND' });
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
<<<<<<< HEAD
    console.error('Update call template error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Update call template error:', error);
    res.status(500).json({ error: 'Failed to update call template', code: 'UPDATE_CALL_TEMPLATE_ERROR' });
>>>>>>> origin/main
  }
});

// DELETE /api/admin/call-templates/:id - Soft-delete call template
router.delete('/call-templates/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM call_templates WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Call template not found', code: 'CALL_TEMPLATE_NOT_FOUND' });
      return;
    }

    db.prepare('UPDATE call_templates SET is_active = 0 WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'template_deleted', 'call_template', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Removed call template: ${existing.name}`, req.ip || 'unknown');

    res.json({ message: 'Call template removed' });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Delete call template error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Delete call template error:', error);
    res.status(500).json({ error: 'Failed to delete call template', code: 'DELETE_CALL_TEMPLATE_ERROR' });
>>>>>>> origin/main
  }
});

// ============================================================
// System Settings - Batch update
// ============================================================

// GET /api/admin/system-settings - Read all system_settings config items
router.get('/system-settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT config_key, config_value FROM system_config WHERE category = 'system_settings' AND is_active = 1"
    ).all() as { config_key: string; config_value: string }[];

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.config_key] = row.config_value;
    }
    res.json(settings);
  } catch (error: any) {
    console.error('Get system settings error:', error);
    res.status(500).json({ error: 'Failed to get system settings', code: 'GET_SYSTEM_SETTINGS_ERROR' });
  }
});

// PUT /api/admin/system-settings - Upsert multiple system_settings config items
router.put('/system-settings', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const settings = req.body as Record<string, string>;

    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ error: 'Request body must be an object of key-value pairs', code: 'REQUEST_BODY_MUST_BE' });
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
<<<<<<< HEAD
    console.error('Update system settings error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Update system settings error:', error);
    res.status(500).json({ error: 'Failed to update system settings', code: 'UPDATE_SYSTEM_SETTINGS_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    console.error('Client incidents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Client incidents error:', error);
    res.status(500).json({ error: 'Failed to client incidents', code: 'CLIENT_INCIDENTS_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    console.error('Client calls error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Client calls error:', error);
    res.status(500).json({ error: 'Failed to client calls', code: 'CLIENT_CALLS_ERROR' });
>>>>>>> origin/main
  }
});

// GET /api/admin/clients/:id/billing - Billing summary
router.get('/clients/:id/billing', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clientId = req.params.id;
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId) as any;
    if (!client) {
      return res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
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
<<<<<<< HEAD
    console.error('Client billing error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Client billing error:', error);
    res.status(500).json({ error: 'Failed to client billing', code: 'CLIENT_BILLING_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    console.error('Admin get sessions error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin get sessions error:', error);
    res.status(500).json({ error: 'Failed to admin get sessions', code: 'ADMIN_GET_SESSIONS_ERROR' });
>>>>>>> origin/main
  }
});

router.delete('/sessions/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Session revoked' });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Admin revoke session error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin revoke session error:', error);
    res.status(500).json({ error: 'Failed to admin revoke session', code: 'ADMIN_REVOKE_SESSION_ERROR' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    console.error('Admin get radio channels error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin get radio channels error:', error);
    res.status(500).json({ error: 'Failed to admin get radio channels', code: 'ADMIN_GET_RADIO_CHANNELS' });
>>>>>>> origin/main
  }
});

// POST /api/admin/radio-channels — create a new radio channel
router.post('/radio-channels', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id, label, freq } = req.body;

    if (!id || !label) {
      res.status(400).json({ error: 'id and label are required', code: 'ID_AND_LABEL_ARE' });
      return;
    }

    // Check for duplicate
    const existing = db.prepare(
      "SELECT config_key FROM system_config WHERE category = 'radio_channel' AND config_key = ?"
    ).get(id);
    if (existing) {
      res.status(409).json({ error: 'A radio channel with that ID already exists', code: 'A_RADIO_CHANNEL_WITH' });
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
<<<<<<< HEAD
    console.error('Admin create radio channel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin create radio channel error:', error);
    res.status(500).json({ error: 'Failed to admin create radio channel', code: 'ADMIN_CREATE_RADIO_CHANNEL' });
>>>>>>> origin/main
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
      res.status(404).json({ error: 'Radio channel not found', code: 'RADIO_CHANNEL_NOT_FOUND' });
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
<<<<<<< HEAD
    console.error('Admin update radio channel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin update radio channel error:', error);
    res.status(500).json({ error: 'Failed to admin update radio channel', code: 'ADMIN_UPDATE_RADIO_CHANNEL' });
>>>>>>> origin/main
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
      res.status(404).json({ error: 'Radio channel not found', code: 'RADIO_CHANNEL_NOT_FOUND' });
      return;
    }

    db.prepare("DELETE FROM system_config WHERE category = 'radio_channel' AND config_key = ?").run(key);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'radio_channel_deleted', 'radio_channel', 0, ?, ?)"
    ).run(req.user!.userId, `Deleted radio channel: ${key}`, req.ip || 'unknown');

    res.json({ message: 'Radio channel deleted' });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Admin delete radio channel error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin delete radio channel error:', error);
    res.status(500).json({ error: 'Failed to admin delete radio channel', code: 'ADMIN_DELETE_RADIO_CHANNEL' });
>>>>>>> origin/main
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
<<<<<<< HEAD
    console.error('Admin seed radio channels error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin seed radio channels error:', error);
    res.status(500).json({ error: 'Failed to admin seed radio channels', code: 'ADMIN_SEED_RADIO_CHANNELS' });
>>>>>>> origin/main
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
    
      LIMIT 1000
    `).all();

    res.json({
      ...totals,
      topUsers,
      loginCounts: loginCounts || { last_24h: 0, last_7d: 0, last_30d: 0 },
      neverLoggedIn,
    });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Admin account stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Admin account stats error:', error);
    res.status(500).json({ error: 'Failed to admin account stats', code: 'ADMIN_ACCOUNT_STATS_ERROR' });
>>>>>>> origin/main
  }
});

// ─── DELETE /api/admin/users/:id/totp ────────────────
// Admin can reset a user's 2FA (e.g., lost authenticator)
router.delete('/users/:id/totp', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_USER_ID' });
      return;
    }

    const target = db.prepare('SELECT id, username, totp_enabled FROM users WHERE id = ?')
      .get(targetId) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
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
    res.status(500).json({ error: 'Failed to admin totp reset', code: 'ADMIN_TOTP_RESET_ERROR' });
  }
});

// ─── PUT /api/admin/users/:id/totp-exempt ────────────
// Admin can toggle a user's 2FA exemption
router.put('/users/:id/totp-exempt', authenticateToken, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_USER_ID' });
      return;
    }

    const { exempt } = req.body;
    const value = exempt ? 1 : 0;

    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
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
    res.status(500).json({ error: 'Failed to admin totp exempt toggle', code: 'ADMIN_TOTP_EXEMPT_TOGGLE' });
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

    res.json(rows);
  } catch (error: any) {
    console.error('User activity heatmap error:', error);
    res.status(500).json({ error: 'Failed to user activity heatmap', code: 'USER_ACTIVITY_HEATMAP_ERROR' });
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
    res.status(500).json({ error: 'Failed to audit export', code: 'AUDIT_EXPORT_ERROR' });
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

    res.json(rows);
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
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
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 27: Database backup status
// ═══════════════════════════════════════════════════════════
router.get('/backup-status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // fs, path imported at top of file
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

<<<<<<< HEAD
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
=======
    res.json({ data: { dbSize, lastModified, backups, walSize: 0 } });
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
>>>>>>> origin/main
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

    res.json(rows);
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
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
    
      LIMIT 1000
    `).all();
    res.json(rows);
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
});

router.post('/announcements', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { title, message, priority, show_on_login, expires_at } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'title and message required', code: 'TITLE_AND_MESSAGE_REQUIRED' });

    const result = db.prepare(`
      INSERT INTO system_announcements (title, message, priority, show_on_login, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, message, priority || 'info', show_on_login !== false ? 1 : 0, expires_at || null, req.user!.userId);

    const row = db.prepare('SELECT * FROM system_announcements WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: row });
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
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
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
});

router.delete('/announcements/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM system_announcements WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
});

// ═══════════════════════════════════════════════════════════
// Feature 30: Maintenance mode toggle
// ═══════════════════════════════════════════════════════════
router.get('/maintenance-mode', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = 'maintenance_mode'").get() as any;
    res.json({ enabled: row?.config_value === 'true', message: '' });
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
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

<<<<<<< HEAD
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
=======
    res.json({ enabled: !!enabled });
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
>>>>>>> origin/main
});

// ═══════════════════════════════════════════════════════════
// Feature 36: Record locking
// ═══════════════════════════════════════════════════════════
router.post('/record-locks', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const { entity_type, entity_id } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required', code: 'ENTITYTYPE_AND_ENTITYID_REQUIRED' });

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
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
});

router.delete('/record-locks/:entity_type/:entity_id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // God Mode: admin bypass — can break any lock, not just their own
    if (req.user?.role === 'admin') {
      db.prepare('DELETE FROM record_locks WHERE entity_type = ? AND entity_id = ?')
        .run(req.params.entity_type, req.params.entity_id);
      auditLog(req, 'ADMIN_OVERRIDE', 'record_lock', 0, `Admin God Mode: broke record lock on ${req.params.entity_type}/${req.params.entity_id}`);
    } else {
      db.prepare('DELETE FROM record_locks WHERE entity_type = ? AND entity_id = ? AND locked_by = ?')
        .run(req.params.entity_type, req.params.entity_id, req.user!.userId);
    }
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: 'Server error in admin', code: 'ADMIN_ERROR' }); }
});

// ══════════════════════════════════════════════════════════════════
// ADMIN UPGRADES
// ══════════════════════════════════════════════════════════════════

// ── Upgrade 22: System health dashboard data ────────────────────
router.get('/system-health', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // fs, path, os imported at top of file

    // Database size
    const DATA_DIR = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
    const dbPath = path.join(DATA_DIR, 'rmpg-flex.db');
    let dbSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(dbPath).size; } catch { /* */ }

    // Table row counts
    const tables = ['users', 'incidents', 'calls_for_service', 'messages', 'bolos',
      'notifications', 'activity_log', 'sessions', 'evidence', 'citations'];
    const tableCounts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${t}`).get() as any;
        tableCounts[t] = row?.count || 0;
      } catch { tableCounts[t] = -1; }
    }

    // Active sessions count
    const activeSessions = db.prepare(
      "SELECT COUNT(*) as count FROM sessions WHERE is_active = 1 AND expires_at > datetime('now')"
    ).get() as any;

    // Server uptime
    const uptimeSeconds = process.uptime();

    // Memory usage
    const memUsage = process.memoryUsage();

    // Recent errors (last 24h)
    const recentErrors = db.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE (action LIKE '%error%' OR details LIKE '%error%' OR details LIKE '%failed%')
        AND created_at >= datetime('now', '-1 day')
    `).get() as any;

    // Activity in last hour
    const activityLastHour = db.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE created_at >= datetime('now', '-1 hour')
    `).get() as any;

    // OS info
    const systemInfo = {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      loadAvg: os.loadavg(),
    };

    res.json({
      database: {
        sizeBytes: dbSizeBytes,
        sizeMB: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
        tableCounts,
      },
      server: {
        uptimeSeconds: Math.round(uptimeSeconds),
        uptimeHours: Math.round(uptimeSeconds / 3600 * 10) / 10,
        memoryUsageMB: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        nodeVersion: process.version,
      },
      activity: {
        activeSessions: activeSessions?.count || 0,
        activityLastHour: activityLastHour?.count || 0,
        recentErrors: recentErrors?.count || 0,
      },
      system: systemInfo,
    });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Security overview error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('System health error:', error);
    res.status(500).json({ error: 'Failed to get system health', code: 'SYSTEM_HEALTH_ERROR' });
>>>>>>> origin/main
  }
});

// ── Upgrade 23: User activity tracking (detailed per-user) ─────
router.get('/user-activity/:userId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID', code: 'INVALID_USER_ID' }); return; }

    const user = db.prepare(`
      SELECT id, username, full_name, role, status, login_count, last_login_at, created_at
      FROM users WHERE id = ?
    `).get(userId) as any;
    if (!user) { res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' }); return; }

    // Action counts by type (last 30 days)
    const actionCounts = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE user_id = ? AND created_at >= datetime('now', '-30 days')
      GROUP BY action ORDER BY count DESC LIMIT 20
    `).all(userId);

    // Daily activity (last 30 days)
    const dailyActivity = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM activity_log
      WHERE user_id = ? AND created_at >= datetime('now', '-30 days')
      GROUP BY date ORDER BY date
    `).all(userId);

    // Total actions
    const totalActions = db.prepare(
      'SELECT COUNT(*) as count FROM activity_log WHERE user_id = ?'
    ).get(userId) as any;

    // Recent sessions
    const recentSessions = db.prepare(`
      SELECT id, ip_address, user_agent, created_at, last_used_at, is_active
      FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(userId);

    // Incidents written
    const incidentsWritten = db.prepare(
      'SELECT COUNT(*) as count FROM incidents WHERE officer_id = ?'
    ).get(userId) as any;

    // Messages sent
    const messagesSent = db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE from_user_id = ?'
    ).get(userId) as any;

    res.json({
      user,
      totalActions: totalActions?.count || 0,
      actionCounts,
      dailyActivity,
      recentSessions,
      incidentsWritten: incidentsWritten?.count || 0,
      messagesSent: messagesSent?.count || 0,
    });
  } catch (error: any) {
    console.error('User activity error:', error);
    res.status(500).json({ error: 'Failed to get user activity', code: 'USER_ACTIVITY_ERROR' });
  }
});

// ── Upgrade 24: All users activity summary ──────────────────────
router.get('/users-activity-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '30' } = req.query;
    const daysNum = Math.max(1, Math.min(365, parseInt(days as string, 10) || 30));

    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.status,
        u.login_count, u.last_login_at,
        COALESCE(a.action_count, 0) as recent_action_count,
        COALESCE(a.last_action_at, u.last_login_at) as last_active_at,
        COALESCE(i.incident_count, 0) as incidents_30d,
        COALESCE(m.message_count, 0) as messages_30d
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) as action_count, MAX(created_at) as last_action_at
        FROM activity_log WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY user_id
      ) a ON u.id = a.user_id
      LEFT JOIN (
        SELECT officer_id, COUNT(*) as incident_count
        FROM incidents WHERE created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY officer_id
      ) i ON u.id = i.officer_id
      LEFT JOIN (
        SELECT from_user_id, COUNT(*) as message_count
        FROM messages WHERE created_at >= datetime('now', '-' || ? || ' days') AND is_draft = 0
        GROUP BY from_user_id
      ) m ON u.id = m.from_user_id
      WHERE u.status = 'active'
      ORDER BY recent_action_count DESC
    `).all(daysNum, daysNum, daysNum);

    res.json({ data: users, period_days: daysNum });
  } catch (error: any) {
    console.error('Users activity summary error:', error);
    res.status(500).json({ error: 'Failed to get users activity summary', code: 'USERS_ACTIVITY_SUMMARY_ERROR' });
  }
});

// ── Upgrade 25: Real-time dashboard stats ───────────────────────
router.get('/realtime-stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE status IN ('pending', 'dispatched', 'enroute', 'onscene')
    `).get() as any;

    const unitsOnDuty = db.prepare(`
      SELECT COUNT(*) as count FROM units WHERE status != 'off_duty'
    `).get() as any;

    const pendingIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents WHERE status IN ('submitted', 'under_review')
    `).get() as any;

    const activeBolos = db.prepare(`
      SELECT COUNT(*) as count FROM bolos WHERE status = 'active'
    `).get() as any;

    const activeSessions = db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE is_active = 1 AND expires_at > datetime('now')
    `).get() as any;

    const todayActivity = db.prepare(`
      SELECT COUNT(*) as count FROM activity_log WHERE DATE(created_at) = DATE('now')
    `).get() as any;

    const unreadNotifications = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE is_read = 0
    `).get() as any;

    const todayCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service WHERE DATE(created_at) = DATE('now')
    `).get() as any;

    res.json({
      activeCalls: activeCalls?.count || 0,
      unitsOnDuty: unitsOnDuty?.count || 0,
      pendingIncidents: pendingIncidents?.count || 0,
      activeBolos: activeBolos?.count || 0,
      activeSessions: activeSessions?.count || 0,
      todayActivity: todayActivity?.count || 0,
      unreadNotifications: unreadNotifications?.count || 0,
      todayCalls: todayCalls?.count || 0,
      timestamp: localNow(),
    });
  } catch (error: any) {
    console.error('Realtime stats error:', error);
    res.status(500).json({ error: 'Failed to get realtime stats', code: 'REALTIME_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Dashboard - Shift-Aware Stats
// Returns stats filtered to the current shift window.
// ════════════════════════════════════════════════════════════
router.get('/shift-stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Determine current shift based on time of day
    const now = new Date();
    const hour = now.getHours();
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
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        shiftEnd = tomorrow.toISOString().split('T')[0] + 'T06:00:00';
      } else {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        shiftStart = yesterday.toISOString().split('T')[0] + 'T22:00:00';
        shiftEnd = localNow().split('T')[0] + 'T06:00:00';
      }
    }

    const shiftCalls = db.prepare(`
      SELECT COUNT(*) as count FROM calls_for_service
      WHERE created_at >= ? AND created_at < ?
    `).get(shiftStart, shiftEnd) as any;

    const shiftIncidents = db.prepare(`
      SELECT COUNT(*) as count FROM incidents
      WHERE created_at >= ? AND created_at < ?
    `).get(shiftStart, shiftEnd) as any;

    const shiftCitations = db.prepare(`
      SELECT COUNT(*) as count FROM citations
      WHERE created_at >= ? AND created_at < ?
    `).get(shiftStart, shiftEnd) as any;

    let shiftPatrolScans = { count: 0 } as any;
    try {
      shiftPatrolScans = db.prepare(`
        SELECT COUNT(*) as count FROM patrol_scans
        WHERE scanned_at >= ? AND scanned_at < ?
      `).get(shiftStart, shiftEnd) as any;
    } catch { /* patrol_scans may not exist */ }

    res.json({
      shift_name: shiftName,
      shift_start: shiftStart,
      shift_end: shiftEnd,
      calls: shiftCalls?.count || 0,
      incidents: shiftIncidents?.count || 0,
      citations: shiftCitations?.count || 0,
      patrol_scans: shiftPatrolScans?.count || 0,
    });
  } catch (error: any) {
    console.error('Shift stats error:', error);
    res.status(500).json({ error: 'Failed to get shift stats', code: 'SHIFT_STATS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Dashboard - Upcoming Court Dates Widget Data
// Returns court dates in the next 30 days.
// ════════════════════════════════════════════════════════════
router.get('/upcoming-court-dates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(String(req.query.days || '30'), 10)));

    let courtDates: any[] = [];
    try {
      courtDates = db.prepare(`
        SELECT cit.id, cit.citation_number, cit.court_date, cit.court_location,
          cit.violation_description, cit.defendant_name,
          u.full_name as officer_name
        FROM citations cit
        LEFT JOIN users u ON cit.issuing_officer_id = u.id
        WHERE cit.court_date IS NOT NULL
          AND cit.court_date >= date('now')
          AND cit.court_date <= date('now', '+' || ? || ' days')
          AND cit.status NOT IN ('voided', 'dismissed')
        ORDER BY cit.court_date ASC
        LIMIT 50
      `).all(days);
    } catch { /* citations table may not have court_date */ }

    res.json({
      court_dates: courtDates,
      count: courtDates.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Upcoming court dates error:', error);
    res.status(500).json({ error: 'Failed to get court dates', code: 'COURT_DATES_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Dashboard - Expiring Certifications Count
// Returns count and list of personnel with expiring certs.
// ════════════════════════════════════════════════════════════
router.get('/expiring-certifications', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.min(180, Math.max(1, parseInt(String(req.query.days || '30'), 10)));

    let expiring: any[] = [];
    try {
      expiring = db.prepare(`
        SELECT pc.id, pc.officer_id, pc.certification_name, pc.expiration_date,
          u.full_name as officer_name, u.badge_number,
          CAST(julianday(pc.expiration_date) - julianday('now') AS INTEGER) as days_until_expiry
        FROM personnel_certifications pc
        LEFT JOIN users u ON pc.officer_id = u.id
        WHERE pc.expiration_date IS NOT NULL
          AND pc.expiration_date >= date('now')
          AND pc.expiration_date <= date('now', '+' || ? || ' days')
          AND u.status = 'active'
        ORDER BY pc.expiration_date ASC
        LIMIT 50
      `).all(days);
    } catch { /* table may not exist */ }

    // Also check already-expired certs
    let expired: any[] = [];
    try {
      expired = db.prepare(`
        SELECT pc.id, pc.officer_id, pc.certification_name, pc.expiration_date,
          u.full_name as officer_name, u.badge_number
        FROM personnel_certifications pc
        LEFT JOIN users u ON pc.officer_id = u.id
        WHERE pc.expiration_date IS NOT NULL
          AND pc.expiration_date < date('now')
          AND u.status = 'active'
        ORDER BY pc.expiration_date DESC
        LIMIT 50
      `).all();
    } catch { /* table may not exist */ }

    res.json({
      expiring_soon: expiring,
      expiring_count: expiring.length,
      already_expired: expired,
      expired_count: expired.length,
      period_days: days,
    });
  } catch (error: any) {
    console.error('Expiring certifications error:', error);
    res.status(500).json({ error: 'Failed to get expiring certifications', code: 'EXPIRING_CERTS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Dashboard - Weather Summary
// Returns weather conditions from the most recent patrol scans.
// ════════════════════════════════════════════════════════════
router.get('/weather-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Try to get the most recent weather data from patrol scan notes
    let weatherData: any = null;
    try {
      const recentScan = db.prepare(`
        SELECT notes FROM patrol_scans
        WHERE notes LIKE '%[WEATHER]%'
        ORDER BY scanned_at DESC LIMIT 1
      `).get() as any;

      if (recentScan?.notes) {
        const weatherMatch = recentScan.notes.match(/\[WEATHER\]\s*({.*?})/);
        if (weatherMatch) {
          weatherData = JSON.parse(weatherMatch[1]);
        }
      }
    } catch { /* ok */ }

    res.json({
      weather: weatherData,
      source: weatherData ? 'patrol_scan' : 'unavailable',
    });
  } catch (error: any) {
    console.error('Weather summary error:', error);
    res.status(500).json({ error: 'Failed to get weather', code: 'WEATHER_SUMMARY_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// User Management Endpoints
// ═══════════════════════════════════════════════════════════

// GET /api/admin/users - List all users
router.get('/users', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const users = db.prepare("SELECT id, username, full_name, role, status, badge_number, email, phone FROM users ORDER BY full_name").all();
    res.json(users);
  } catch (error: any) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users', code: 'GET_USERS_ERROR' });
  }
});

// POST /api/admin/users/:userId/reset-2fa
router.post('/users/:userId/reset-2fa', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
  db.prepare(`UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes = NULL, totp_pending_secret = NULL, totp_setup_required = 1, webauthn_enabled = 0 WHERE id = ?`).run(userId);
  db.prepare(`DELETE FROM webauthn_credentials WHERE user_id = ?`).run(userId);
  res.json({ message: '2FA reset successfully' });
});

// POST /api/admin/users/:userId/force-password-change
router.post('/users/:userId/force-password-change', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  const db = getDb();
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
  db.prepare('UPDATE users SET force_password_change = 1 WHERE id = ?').run(userId);
  res.json({ message: 'Password change required on next login' });
});

// POST /api/admin/users/:userId/revoke-sessions
router.post('/users/:userId/revoke-sessions', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
  const result = db.prepare('UPDATE sessions SET is_active = 0, revoked_at = datetime(\'now\') WHERE user_id = ? AND is_active = 1').run(userId);
  res.json({ message: 'Sessions revoked', count: result.changes });
});

// PUT /api/admin/users/:userId/role
router.put('/users/:userId/role', requireRole('admin'), (req: Request, res: Response) => {
  const db = getDb();
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
  const { role } = req.body;
  const validRoles = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
  if (!validRoles.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  res.json({ message: 'Role updated' });
});

// ═════════════════════════════════════════════════════════════
// Third-Party API Keys — encrypted storage for RapidAPI keys etc.
// ═════════════════════════════════════════════════════════════

const ALLOWED_THIRD_PARTY_KEYS = [
  'lead_gen_rapidapi_key',
  'dl_ocr_rapidapi_key',
  'plate_check_rapidapi_key',
];

function encryptValue(plaintext: string): string {
  const key = crypto.createHash('sha256').update(config.jwt.secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

// GET /api/admin/third-party-keys — list which keys are configured
router.get('/third-party-keys', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = ALLOWED_THIRD_PARTY_KEYS.map(k => {
      const row = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1"
      ).get(k) as { config_value: string } | undefined;
      return { config_key: k, has_value: !!row?.config_value };
    });
    res.json(result);
  } catch (err: any) {
    console.error('[Admin] Third-party keys list error:', err);
    res.status(500).json({ error: 'Failed to list keys' });
  }
});

// GET /api/admin/third-party-keys/:key — check single key
router.get('/third-party-keys/:key', requireRole('admin'), (req: Request, res: Response) => {
  const { key } = req.params;
  if (!ALLOWED_THIRD_PARTY_KEYS.includes(key)) {
    res.status(400).json({ error: 'Unknown key' }); return;
  }
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    res.json({ configured: !!row?.config_value });
  } catch {
    res.json({ configured: false });
  }
});

// PUT /api/admin/third-party-keys — save an encrypted key
router.put('/third-party-keys', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key || !value || typeof value !== 'string') {
      res.status(400).json({ error: 'key and value are required' }); return;
    }
    if (!ALLOWED_THIRD_PARTY_KEYS.includes(key)) {
      res.status(400).json({ error: 'Unknown key' }); return;
    }

    const db = getDb();
    const encrypted = encryptValue(value.trim());
    const now = localNow();

    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = ? LIMIT 1").get(key) as { id: number } | undefined;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, is_active = 1, updated_at = ? WHERE config_key = ?").run(encrypted, now, key);
    } else {
      db.prepare(
        "INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 1, ?, ?)"
      ).run(key, encrypted, now, now);
    }

    res.json({ success: true, message: `${key} saved` });
  } catch (err: any) {
    console.error('[Admin] Save third-party key error:', err);
    res.status(500).json({ error: 'Failed to save key' });
  }
});

// DELETE /api/admin/third-party-keys — clear a key
router.delete('/third-party-keys', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    if (!key || !ALLOWED_THIRD_PARTY_KEYS.includes(key)) {
      res.status(400).json({ error: 'Unknown key' }); return;
    }

    const db = getDb();
    db.prepare("UPDATE system_config SET config_value = '', is_active = 0, updated_at = ? WHERE config_key = ?").run(localNow(), key);

    res.json({ success: true, message: `${key} cleared` });
  } catch (err: any) {
    console.error('[Admin] Clear third-party key error:', err);
    res.status(500).json({ error: 'Failed to clear key' });
  }
});


// ════════════════════════════════════════════════════════════
// GOD MODE: Admin Impersonation
// ════════════════════════════════════════════════════════════

// POST /admin/impersonate/:userId — Start impersonating a user
router.post('/impersonate/:userId', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const targetId = parseInt(req.params.userId, 10);
    if (isNaN(targetId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const target = db.prepare('SELECT id, username, full_name, role, badge_number, call_sign, email, status FROM users WHERE id = ?').get(targetId) as any;
    if (!target) { res.status(404).json({ error: 'User not found' }); return; }
    if (target.status !== 'active') { res.status(400).json({ error: 'Cannot impersonate inactive user' }); return; }

    // Generate a short-lived impersonation token (30 min)
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const impersonationToken = jwt.sign(
      {
        userId: target.id,
        username: target.username,
        role: target.role,
        type: 'access',
        impersonatedBy: req.user!.userId,
        impersonation: true,
      },
      secret,
      { expiresIn: '30m' }
    );

    // Audit this critical action
    auditLog(req, 'ADMIN_IMPERSONATE', 'user', targetId,
      `Admin ${req.user!.username} (ID:${req.user!.userId}) started impersonating ${target.username} (ID:${target.id}, role:${target.role})`);

    res.json({
      success: true,
      token: impersonationToken,
      user: {
        id: target.id,
        username: target.username,
        full_name: target.full_name,
        role: target.role,
        badge_number: target.badge_number,
        call_sign: target.call_sign,
        email: target.email,
      },
      expires_in: '30m',
      warning: 'Impersonation session — all actions will be logged under your admin account',
    });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Reset 2FA error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Impersonate error:', error);
    res.status(500).json({ error: 'Impersonation failed' });
>>>>>>> origin/main
  }
});

// POST /admin/stop-impersonation — End impersonation session
router.post('/stop-impersonation', requireRole('admin'), (req: Request, res: Response) => {
  auditLog(req, 'ADMIN_STOP_IMPERSONATE', 'user', req.user!.userId, 'Admin ended impersonation session');
  res.json({ success: true, message: 'Impersonation ended' });
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Database Maintenance
// ════════════════════════════════════════════════════════════

// GET /admin/database/stats — Database size, table counts, index info
router.get('/database/stats', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Get page count and page size for DB file size
    const pageCount = ((db.pragma('page_count') as any[])[0] as any)?.page_count || 0;
    const pageSize = ((db.pragma('page_size') as any[])[0] as any)?.page_size || 4096;
    const dbSizeBytes = pageCount * pageSize;
    const freelistCount = ((db.pragma('freelist_count') as any[])[0] as any)?.freelist_count || 0;
    const freelistBytes = freelistCount * pageSize;

    // Get table list with row counts
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];
    const tableStats = tables.map((t: any) => {
      const count = (db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get() as any)?.count || 0;
      return { name: t.name, row_count: count };
    });

    // Get index list
    const indexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name").all();

    // Integrity quick check
    const integrityResult = db.pragma('quick_check') as any[];
    const isHealthy = integrityResult.length === 1 && (integrityResult[0] as any)?.quick_check === 'ok';

    // WAL mode info
    const journalMode = ((db.pragma('journal_mode') as any[])[0] as any)?.journal_mode || 'unknown';

    const totalRows = tableStats.reduce((sum: number, t: any) => sum + t.row_count, 0);

    res.json({
      database_size_bytes: dbSizeBytes,
      database_size_mb: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
      freelist_bytes: freelistBytes,
      freelist_mb: Math.round(freelistBytes / 1024 / 1024 * 100) / 100,
      reclaimable_percent: dbSizeBytes > 0 ? Math.round(freelistBytes / dbSizeBytes * 10000) / 100 : 0,
      table_count: tables.length,
      total_rows: totalRows,
      index_count: indexes.length,
      journal_mode: journalMode,
      integrity: isHealthy ? 'OK' : 'ISSUES DETECTED',
      integrity_details: isHealthy ? null : integrityResult,
      tables: tableStats.sort((a: any, b: any) => b.row_count - a.row_count),
      indexes,
    });
  } catch (error: any) {
    console.error('Database stats error:', error);
    res.status(500).json({ error: 'Failed to get database stats' });
  }
});

// POST /admin/database/vacuum — Optimize database (reclaim space)
router.post('/database/vacuum', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const beforePages = ((db.pragma('page_count') as any[])[0] as any)?.page_count || 0;
    const pageSize = ((db.pragma('page_size') as any[])[0] as any)?.page_size || 4096;
    const beforeSize = beforePages * pageSize;

    db.exec('VACUUM');

    const afterPages = ((db.pragma('page_count') as any[])[0] as any)?.page_count || 0;
    const afterSize = afterPages * pageSize;
    const reclaimed = beforeSize - afterSize;

    auditLog(req, 'ADMIN_DB_VACUUM', 'database', 0,
      `Database VACUUM: ${Math.round(beforeSize/1024/1024*100)/100}MB → ${Math.round(afterSize/1024/1024*100)/100}MB (reclaimed ${Math.round(reclaimed/1024/1024*100)/100}MB)`);

    res.json({
      success: true,
      before_size_mb: Math.round(beforeSize / 1024 / 1024 * 100) / 100,
      after_size_mb: Math.round(afterSize / 1024 / 1024 * 100) / 100,
      reclaimed_mb: Math.round(reclaimed / 1024 / 1024 * 100) / 100,
    });
  } catch (error: any) {
    console.error('Database VACUUM error:', error);
    res.status(500).json({ error: 'VACUUM failed — database may be locked' });
  }
});

// POST /admin/database/integrity-check — Full integrity check
router.post('/database/integrity-check', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.pragma('integrity_check') as any[];
    const isHealthy = result.length === 1 && (result[0] as any)?.integrity_check === 'ok';

    auditLog(req, 'ADMIN_DB_INTEGRITY', 'database', 0,
      `Integrity check: ${isHealthy ? 'PASSED' : 'ISSUES DETECTED'}`);

    res.json({
      success: true,
      healthy: isHealthy,
      result: isHealthy ? ['ok'] : result.map((r: any) => r.integrity_check),
    });
  } catch (error: any) {
    console.error('Integrity check error:', error);
    res.status(500).json({ error: 'Integrity check failed' });
  }
});

// POST /admin/database/backup — Create database backup
router.post('/database/backup', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const dataDir = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(dataDir, `rmpg-flex-backup-${timestamp}.db`);

    db.backup(backupPath);

    const stats = fs.statSync(backupPath);

    auditLog(req, 'ADMIN_DB_BACKUP', 'database', 0,
      `Database backup created: ${backupPath} (${Math.round(stats.size/1024/1024*100)/100}MB)`);

    res.json({
      success: true,
      backup_path: backupPath,
      size_mb: Math.round(stats.size / 1024 / 1024 * 100) / 100,
      timestamp,
    });
  } catch (error: any) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// GET /admin/database/backups — List existing backups
router.get('/database/backups', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const dataDir = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');

    const files = fs.readdirSync(dataDir)
      .filter((f: string) => f.startsWith('rmpg-flex-backup-') && f.endsWith('.db'))
      .map((f: string) => {
        const stats = fs.statSync(path.join(dataDir, f));
        return {
          filename: f,
          size_mb: Math.round(stats.size / 1024 / 1024 * 100) / 100,
          created_at: stats.birthtime.toISOString(),
        };
      })
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json(files);
  } catch (error: any) {
    console.error('List backups error:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// DELETE /admin/database/backups/:filename — Delete a backup
router.delete('/database/backups/:filename', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const dataDir = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
    const filename = req.params.filename;

    // Security: only allow deleting backup files
    if (!filename.startsWith('rmpg-flex-backup-') || !filename.endsWith('.db')) {
      res.status(400).json({ error: 'Invalid backup filename' }); return;
    }

    const fullPath = path.join(dataDir, filename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Backup not found' }); return;
    }

    fs.unlinkSync(fullPath);
    auditLog(req, 'ADMIN_DB_DELETE_BACKUP', 'database', 0, `Deleted backup: ${filename}`);

    res.json({ success: true, deleted: filename });
  } catch (error: any) {
    console.error('Delete backup error:', error);
    res.status(500).json({ error: 'Failed to delete backup' });
  }
});

// POST /admin/database/analyze — Run ANALYZE for query optimizer
router.post('/database/analyze', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.exec('ANALYZE');
    auditLog(req, 'ADMIN_DB_ANALYZE', 'database', 0, 'Ran ANALYZE for query optimizer');
    res.json({ success: true, message: 'ANALYZE complete — query optimizer updated' });
  } catch (error: any) {
    console.error('ANALYZE error:', error);
    res.status(500).json({ error: 'ANALYZE failed' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Data Purge & Cleanup
// ════════════════════════════════════════════════════════════

// POST /admin/purge/activity-logs — Purge old activity logs
router.post('/purge/activity-logs', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days_to_keep = 90 } = req.body;
    const cutoff = new Date(Date.now() - days_to_keep * 24 * 60 * 60 * 1000).toISOString();

    const result = db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(cutoff);

    auditLog(req, 'ADMIN_PURGE_LOGS', 'activity_log', 0,
      `Purged ${result.changes} activity logs older than ${days_to_keep} days`);

    res.json({ success: true, purged: result.changes, cutoff });
  } catch (error: any) {
    console.error('Purge activity logs error:', error);
    res.status(500).json({ error: 'Purge failed' });
  }
});

// POST /admin/purge/notifications — Purge old notifications
router.post('/purge/notifications', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days_to_keep = 30 } = req.body;
    const cutoff = new Date(Date.now() - days_to_keep * 24 * 60 * 60 * 1000).toISOString();

    const result = db.prepare('DELETE FROM notifications WHERE created_at < ? AND is_read = 1').run(cutoff);

    auditLog(req, 'ADMIN_PURGE_NOTIFICATIONS', 'notification', 0,
      `Purged ${result.changes} read notifications older than ${days_to_keep} days`);

    res.json({ success: true, purged: result.changes, cutoff });
  } catch (error: any) {
    console.error('Purge notifications error:', error);
    res.status(500).json({ error: 'Purge failed' });
  }
});

// POST /admin/purge/sessions — Purge expired sessions
router.post('/purge/sessions', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);

    auditLog(req, 'ADMIN_PURGE_SESSIONS', 'refresh_token', 0,
      `Purged ${result.changes} expired sessions`);

    res.json({ success: true, purged: result.changes });
  } catch (error: any) {
    console.error('Purge sessions error:', error);
    res.status(500).json({ error: 'Purge failed' });
  }
});

// GET /admin/system-overview — Comprehensive system overview
router.get('/system-overview', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const counts: Record<string, number> = {};
    const tables = ['users', 'calls_for_service', 'incidents', 'citations', 'warrants', 'persons', 'vehicles',
                     'cases', 'arrests', 'field_interviews', 'trespass_orders', 'bolos', 'notifications',
                     'activity_log', 'sessions', 'fleet_vehicles', 'evidence_items'];

    for (const table of tables) {
      try {
        counts[table] = (db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as any)?.c || 0;
      } catch { counts[table] = -1; } // table doesn't exist
    }

    // Active users (logged in last 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const activeUsers = (db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE expires_at > ?').get(dayAgo) as any)?.c || 0;

    // Server uptime
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    res.json({
      server: {
        uptime: `${hours}h ${mins}m`,
        uptime_seconds: Math.round(uptime),
        node_version: process.version,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        total_memory_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100,
        free_memory_gb: Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100,
        load_average: os.loadavg().map((l: number) => Math.round(l * 100) / 100),
        cpus: os.cpus().length,
      },
      active_users_24h: activeUsers,
      record_counts: counts,
    });
  } catch (error: any) {
    console.error('System overview error:', error);
    res.status(500).json({ error: 'Failed to get system overview' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Bulk Call Operations
// ════════════════════════════════════════════════════════════

// POST /admin/calls/bulk-reassign — Reassign multiple calls to a different officer
router.post('/calls/bulk-reassign', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_ids, target_officer_id } = req.body;
    if (!Array.isArray(call_ids) || !call_ids.length) { res.status(400).json({ error: 'call_ids array required' }); return; }
    if (!target_officer_id) { res.status(400).json({ error: 'target_officer_id required' }); return; }

    const officer = db.prepare('SELECT id, full_name, call_sign FROM users WHERE id = ?').get(target_officer_id) as any;
    if (!officer) { res.status(404).json({ error: 'Target officer not found' }); return; }

    const update = db.prepare('UPDATE calls_for_service SET primary_unit = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    let updated = 0;

    const tx = db.transaction(() => {
      for (const id of call_ids) {
        const r = update.run(officer.call_sign || officer.full_name, now, id);
        if (r.changes > 0) updated++;
      }
    });
    tx();

    auditLog(req, 'ADMIN_BULK_REASSIGN', 'calls_for_service', 0,
      `Bulk reassigned ${updated} calls to ${officer.full_name} (${officer.call_sign || 'N/A'})`);

    res.json({ success: true, updated, target: officer.full_name });
  } catch (error: any) {
    console.error('Bulk reassign error:', error);
    res.status(500).json({ error: 'Bulk reassign failed' });
  }
});

// POST /admin/calls/force-close-all — Close all open calls (shift end)
router.post('/calls/force-close-all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { disposition = 'Closed by Admin', exclude_priorities } = req.body;
    const now = new Date().toISOString();

    let where = "status NOT IN ('closed', 'cancelled', 'archived')";
    const params: any[] = [];
    if (exclude_priorities && Array.isArray(exclude_priorities) && exclude_priorities.length) {
      where += ` AND (priority IS NULL OR priority NOT IN (${exclude_priorities.map(() => '?').join(',')}))`;
      params.push(...exclude_priorities);
    }

    const openCalls = db.prepare(`SELECT id FROM calls_for_service WHERE ${where}`).all(...params) as any[];

    const update = db.prepare(`UPDATE calls_for_service SET status = 'closed', disposition = ?, closed_at = ?, updated_at = ? WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const call of openCalls) {
        update.run(disposition, now, now, call.id);
      }
    });
    tx();

    auditLog(req, 'ADMIN_FORCE_CLOSE_ALL', 'calls_for_service', 0,
      `Force-closed ${openCalls.length} open calls with disposition: ${disposition}`);

    try {
      const { broadcast } = require('../utils/websocket');
      broadcast('dispatch', 'calls:bulk_closed', { count: openCalls.length });
    } catch {}

    res.json({ success: true, closed: openCalls.length, disposition });
  } catch (error: any) {
    console.error('Force close all error:', error);
    res.status(500).json({ error: 'Force close failed' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: SQL Query Console (Read-Only)
// ════════════════════════════════════════════════════════════

// POST /admin/query — Execute a read-only SQL query
router.post('/query', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { sql, limit = 100 } = req.body;
    if (!sql || typeof sql !== 'string') { res.status(400).json({ error: 'SQL query required' }); return; }

    // Security: only allow SELECT statements
    const trimmed = sql.trim().replace(/^\/\*[\s\S]*?\*\//g, '').trim();
    const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
    if (!['SELECT', 'PRAGMA', 'EXPLAIN', 'WITH'].includes(firstWord)) {
      res.status(403).json({ error: 'Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed', code: 'WRITE_QUERY_BLOCKED' });
      return;
    }

    // Block dangerous patterns
    const dangerous = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|VACUUM|REINDEX)\b/i;
    if (dangerous.test(trimmed)) {
      res.status(403).json({ error: 'Query contains blocked keywords (DROP, DELETE, INSERT, UPDATE, ALTER, CREATE)', code: 'DANGEROUS_QUERY_BLOCKED' });
      return;
    }

    // Add LIMIT if not present
    let finalSql = trimmed;
    if (firstWord === 'SELECT' && !/\bLIMIT\b/i.test(finalSql)) {
      finalSql = finalSql.replace(/;?\s*$/, '') + ` LIMIT ${Math.min(limit, 10000)}`;
    }

    const startMs = Date.now();
    const rows = db.prepare(finalSql).all() as any[];
    const durationMs = Date.now() - startMs;

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    auditLog(req, 'ADMIN_SQL_QUERY', 'database', 0,
      `SQL query (${durationMs}ms, ${rows.length} rows): ${finalSql.slice(0, 200)}`);

    res.json({
      success: true,
      columns,
      rows,
      row_count: rows.length,
      duration_ms: durationMs,
      sql: finalSql,
    });
  } catch (error: any) {
    console.error('SQL query error:', error);
    res.status(400).json({ error: error.message || 'Query execution failed', code: 'QUERY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Emergency Lockdown
// ════════════════════════════════════════════════════════════

// POST /admin/system/lockdown — Enable system lockdown (admin-only access)
router.post('/system/lockdown', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { message = 'System is in lockdown mode. Only administrators can access the system.', kick_sessions = false } = req.body;
    const now = new Date().toISOString();

    // Store lockdown state in system_config
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = 'system_lockdown'").get() as any;
    const lockdownData = JSON.stringify({ active: true, message, activated_by: req.user!.userId, activated_at: now });

    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = 'system_lockdown'").run(lockdownData, now);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES ('system_lockdown', ?, 'system', 1, ?, ?)").run(lockdownData, now, now);
    }

    // Optionally kill all non-admin sessions
    let sessionsKilled = 0;
    if (kick_sessions) {
      const result = db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role != 'admin')").run();
      sessionsKilled = result.changes;
    }

    auditLog(req, 'ADMIN_LOCKDOWN_ENABLED', 'system', 0,
      `System lockdown ENABLED. Message: ${message}. Sessions killed: ${sessionsKilled}`);

    try {
      const { broadcast } = require('../utils/websocket');
      broadcast('system', 'lockdown:enabled', { message });
    } catch {}

    res.json({ success: true, message: 'Lockdown enabled', sessions_killed: sessionsKilled });
  } catch (error: any) {
    console.error('Lockdown enable error:', error);
    res.status(500).json({ error: 'Failed to enable lockdown' });
  }
});

// DELETE /admin/system/lockdown — Disable lockdown
router.delete('/system/lockdown', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = 'system_lockdown'")
      .run(JSON.stringify({ active: false }), now);

    auditLog(req, 'ADMIN_LOCKDOWN_DISABLED', 'system', 0, 'System lockdown DISABLED');

    try {
      const { broadcast } = require('../utils/websocket');
      broadcast('system', 'lockdown:disabled', {});
    } catch {}

    res.json({ success: true, message: 'Lockdown disabled' });
  } catch (error: any) {
    console.error('Lockdown disable error:', error);
    res.status(500).json({ error: 'Failed to disable lockdown' });
  }
});

// GET /admin/system/lockdown — Check lockdown status
router.get('/system/lockdown', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = 'system_lockdown'").get() as any;
    if (!row) { res.json({ active: false }); return; }
    try {
      const data = JSON.parse(row.config_value);
      res.json(data);
    } catch { res.json({ active: false }); }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check lockdown status' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Merge Duplicate Records
// ════════════════════════════════════════════════════════════

// POST /admin/records/persons/merge — Merge two person records
router.post('/records/persons/merge', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { keep_id, merge_id } = req.body;
    if (!keep_id || !merge_id) { res.status(400).json({ error: 'keep_id and merge_id required' }); return; }
    if (keep_id === merge_id) { res.status(400).json({ error: 'Cannot merge a record with itself' }); return; }

    const keepPerson = db.prepare('SELECT * FROM persons WHERE id = ?').get(keep_id) as any;
    const mergePerson = db.prepare('SELECT * FROM persons WHERE id = ?').get(merge_id) as any;
    if (!keepPerson) { res.status(404).json({ error: 'Keep person not found' }); return; }
    if (!mergePerson) { res.status(404).json({ error: 'Merge person not found' }); return; }

    // Tables that reference person_id
    const refTables = [
      'calls_for_service', 'incidents', 'citations', 'arrests', 'warrants',
      'field_interviews', 'trespass_orders', 'dl_records', 'evidence_items',
    ];

    let reassigned = 0;
    const tx = db.transaction(() => {
      for (const table of refTables) {
        try {
          const r = db.prepare(`UPDATE "${table}" SET person_id = ? WHERE person_id = ?`).run(keep_id, merge_id);
          reassigned += r.changes;
        } catch {} // table may not have person_id column
      }

      // Also update incident_persons junction table if it exists
      try {
        db.prepare('UPDATE incident_persons SET person_id = ? WHERE person_id = ?').run(keep_id, merge_id);
      } catch {}

      // Fill in blank fields on the keep record from the merge record
      const fillableFields = ['phone', 'email', 'address', 'city', 'state', 'zip', 'ssn_last4', 'dl_number', 'dl_state', 'employer', 'occupation', 'emergency_contact', 'notes'];
      for (const field of fillableFields) {
        if (!keepPerson[field] && mergePerson[field]) {
          try {
            db.prepare(`UPDATE persons SET "${field}" = ? WHERE id = ?`).run(mergePerson[field], keep_id);
          } catch {}
        }
      }

      // Append merge person's notes to keep person
      if (mergePerson.notes) {
        const combined = [keepPerson.notes, `[Merged from Person #${merge_id}] ${mergePerson.notes}`].filter(Boolean).join('\n');
        db.prepare('UPDATE persons SET notes = ? WHERE id = ?').run(combined, keep_id);
      }

      // Soft-delete the merged record
      db.prepare("UPDATE persons SET full_name = ?, notes = ?, updated_at = ? WHERE id = ?")
        .run(`[MERGED INTO #${keep_id}] ${mergePerson.full_name}`, `Merged into Person #${keep_id} by admin on ${new Date().toISOString()}`, new Date().toISOString(), merge_id);
    });
    tx();

    auditLog(req, 'ADMIN_MERGE_PERSONS', 'person', keep_id,
      `Merged Person #${merge_id} (${mergePerson.full_name}) into Person #${keep_id} (${keepPerson.full_name}). ${reassigned} linked records reassigned.`);

    res.json({ success: true, kept: keep_id, merged: merge_id, records_reassigned: reassigned });
  } catch (error: any) {
    console.error('Merge persons error:', error);
    res.status(500).json({ error: 'Merge failed' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: WebSocket Monitoring & User Presence
// ════════════════════════════════════════════════════════════

// GET /admin/websocket/clients — List connected WebSocket clients
router.get('/websocket/clients', requireRole('admin'), (req: Request, res: Response) => {
  try {
    let clients: any[] = [];
    try {
      const ws = require('../utils/websocket');
      if (typeof ws.getConnectedClients === 'function') {
        clients = ws.getConnectedClients();
      }
    } catch {}
    res.json({ connected: clients.length, clients });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get WebSocket clients' });
  }
});

// GET /admin/users/presence — User online presence (from recent activity)
router.get('/users/presence', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Users active in last 15 minutes (based on refresh tokens and activity log)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const users = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.badge_number,
        (SELECT MAX(al.created_at) FROM activity_log al WHERE al.user_id = u.id) as last_activity,
        (SELECT COUNT(*) FROM sessions rt WHERE rt.user_id = u.id AND rt.expires_at > datetime('now')) as active_sessions,
        CASE
          WHEN (SELECT MAX(al.created_at) FROM activity_log al WHERE al.user_id = u.id) > ? THEN 'online'
          WHEN (SELECT MAX(al.created_at) FROM activity_log al WHERE al.user_id = u.id) > ? THEN 'idle'
          ELSE 'offline'
        END as status
      FROM users u
      WHERE u.status = 'active'
      ORDER BY last_activity DESC NULLS LAST
    `).all(fifteenMinAgo, oneHourAgo) as any[];

    const online = users.filter((u: any) => u.status === 'online').length;
    const idle = users.filter((u: any) => u.status === 'idle').length;
    const offline = users.filter((u: any) => u.status === 'offline').length;

    res.json({ online, idle, offline, total: users.length, users });
  } catch (error: any) {
    console.error('User presence error:', error);
    res.status(500).json({ error: 'Failed to get user presence' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Full System Export
// ════════════════════════════════════════════════════════════

// GET /admin/export/full — Export all system data as JSON
router.get('/export/full', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];

    const data: Record<string, any[]> = {};
    for (const t of tables) {
      // Skip sensitive tables
      if (['sessions'].includes(t.name)) continue;
      try {
        data[t.name] = db.prepare(`SELECT * FROM "${t.name}" ORDER BY id DESC LIMIT 50000`).all();
      } catch {
        try {
          data[t.name] = db.prepare(`SELECT * FROM "${t.name}" LIMIT 50000`).all();
        } catch { data[t.name] = []; }
      }
    }

    auditLog(req, 'ADMIN_FULL_EXPORT', 'database', 0, `Full system export: ${tables.length} tables`);

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="rmpg-flex-export-${timestamp}.json"`);
    res.json({
      exported_at: new Date().toISOString(),
      table_count: Object.keys(data).length,
      data,
    });
  } catch (error: any) {
    console.error('Full export error:', error);
    res.status(500).json({ error: 'Full export failed' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Live Activity Feed
// ════════════════════════════════════════════════════════════

// GET /admin/activity-feed — Real-time activity feed (recent actions)
router.get('/activity-feed', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 500);
    const since = req.query.since as string || new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const rows = db.prepare(`
      SELECT al.*, u.username, u.full_name, u.role
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at > ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).all(since, limit) as any[];

    res.json({ actions: rows, count: rows.length, since });
  } catch (error: any) {
    console.error('Activity feed error:', error);
    res.status(500).json({ error: 'Failed to get activity feed' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Restore Deleted/Archived Records
// ════════════════════════════════════════════════════════════

// POST /admin/records/restore — Restore a soft-deleted or archived record
router.post('/records/restore', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, target_status = 'active' } = req.body;
    if (!table || !id) { res.status(400).json({ error: 'table and id required' }); return; }

    // Whitelist allowed tables
    const allowedTables = [
      'persons', 'vehicles', 'properties', 'calls_for_service', 'incidents',
      'citations', 'arrests', 'warrants', 'field_interviews', 'trespass_orders',
      'cases', 'evidence_items', 'bolos', 'code_violations', 'invoices',
      'leave_requests', 'performance_reviews', 'daily_activity_reports',
    ];
    if (!allowedTables.includes(table)) {
      res.status(400).json({ error: `Table '${table}' not allowed for restore` }); return;
    }

    // Try to restore by updating status
    const statusFields = ['status', 'record_status'];
    let restored = false;
    for (const field of statusFields) {
      try {
        const result = db.prepare(`UPDATE "${table}" SET "${field}" = ?, updated_at = ? WHERE id = ?`).run(target_status, new Date().toISOString(), id);
        if (result.changes > 0) { restored = true; break; }
      } catch {}
    }

    if (!restored) {
      res.status(404).json({ error: 'Record not found or no status field to update' }); return;
    }

    auditLog(req, 'ADMIN_OVERRIDE', table, id, `Restored ${table} #${id} to status: ${target_status}`);
    res.json({ success: true, table, id, new_status: target_status });
  } catch (error: any) {
    console.error('Restore record error:', error);
    res.status(500).json({ error: 'Restore failed' });
  }
});

// POST /admin/records/field-update — Update any field on any record
router.post('/records/field-update', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, field, value } = req.body;
    if (!table || !id || !field) { res.status(400).json({ error: 'table, id, and field required' }); return; }

    // Whitelist allowed tables (same as restore)
    const allowedTables = [
      'persons', 'vehicles', 'properties', 'calls_for_service', 'incidents',
      'citations', 'arrests', 'warrants', 'field_interviews', 'trespass_orders',
      'cases', 'evidence_items', 'bolos', 'code_violations', 'invoices',
      'leave_requests', 'performance_reviews', 'daily_activity_reports',
      'users', 'serve_queue', 'offender_alerts',
    ];
    if (!allowedTables.includes(table)) {
      res.status(400).json({ error: `Table '${table}' not allowed` }); return;
    }

    // Block dangerous fields
    const blockedFields = ['password_hash', 'totp_secret_enc'];
    if (blockedFields.includes(field)) {
      res.status(403).json({ error: `Field '${field}' cannot be modified via this endpoint` }); return;
    }

    // Get old value for audit
    let oldValue: any = null;
    try {
      const row = db.prepare(`SELECT "${field}" FROM "${table}" WHERE id = ?`).get(id) as any;
      oldValue = row?.[field];
    } catch {}

    const result = db.prepare(`UPDATE "${table}" SET "${field}" = ?, updated_at = ? WHERE id = ?`).run(
      value === null ? null : value,
      new Date().toISOString(),
      id
    );

    if (result.changes === 0) {
      res.status(404).json({ error: 'Record not found' }); return;
    }

    auditLog(req, 'ADMIN_OVERRIDE', table, id,
      `Direct field update: ${table}.${field} on #${id} changed from "${oldValue}" to "${value}"`);

    res.json({ success: true, table, id, field, old_value: oldValue, new_value: value });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Force password change error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Field update error:', error);
    res.status(500).json({ error: 'Field update failed', detail: error.message });
>>>>>>> origin/main
  }
});

// POST /admin/records/batch-field-update — Update same field on multiple records
router.post('/records/batch-field-update', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, ids, field, value } = req.body;
    if (!table || !Array.isArray(ids) || !ids.length || !field) {
      res.status(400).json({ error: 'table, ids array, and field required' }); return;
    }

    const allowedTables = [
      'persons', 'vehicles', 'properties', 'calls_for_service', 'incidents',
      'citations', 'arrests', 'warrants', 'field_interviews', 'trespass_orders',
      'cases', 'evidence_items', 'bolos', 'code_violations', 'invoices',
      'leave_requests', 'performance_reviews', 'daily_activity_reports',
      'users', 'serve_queue', 'offender_alerts',
    ];
    if (!allowedTables.includes(table)) {
      res.status(400).json({ error: `Table '${table}' not allowed` }); return;
    }

    const blockedFields = ['password_hash', 'totp_secret_enc'];
    if (blockedFields.includes(field)) {
      res.status(403).json({ error: `Field '${field}' cannot be modified` }); return;
    }

    const now = new Date().toISOString();
    const update = db.prepare(`UPDATE "${table}" SET "${field}" = ?, updated_at = ? WHERE id = ?`);
    let updated = 0;

    const tx = db.transaction(() => {
      for (const id of ids) {
        const r = update.run(value === null ? null : value, now, id);
        updated += r.changes;
      }
    });
    tx();

    auditLog(req, 'ADMIN_OVERRIDE', table, 0,
      `Batch field update: ${table}.${field} = "${value}" on ${updated}/${ids.length} records`);

    res.json({ success: true, updated, total: ids.length });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Admin revoke sessions error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Batch field update error:', error);
    res.status(500).json({ error: 'Batch update failed' });
>>>>>>> origin/main
  }
});

// POST /admin/records/clone — Clone a record
router.post('/records/clone', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, overrides = {} } = req.body;
    if (!table || !id) { res.status(400).json({ error: 'table and id required' }); return; }

<<<<<<< HEAD
    const validRoles = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
=======
    const allowedTables = [
      'persons', 'vehicles', 'calls_for_service', 'incidents', 'citations',
      'field_interviews', 'trespass_orders', 'cases', 'bolos', 'code_violations',
    ];
    if (!allowedTables.includes(table)) {
      res.status(400).json({ error: `Table '${table}' not allowed for cloning` }); return;
>>>>>>> origin/main
    }

    const original = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as any;
    if (!original) { res.status(404).json({ error: 'Record not found' }); return; }

    // Remove id and apply overrides
    const clone = { ...original, ...overrides };
    delete clone.id;
    clone.created_at = new Date().toISOString();
    clone.updated_at = new Date().toISOString();

    const columns = Object.keys(clone);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(c => clone[c]);

    const result = db.prepare(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(...values);

    auditLog(req, 'ADMIN_OVERRIDE', table, Number(result.lastInsertRowid),
      `Cloned ${table} #${id} → #${result.lastInsertRowid}`);

    res.json({ success: true, original_id: id, new_id: result.lastInsertRowid });
  } catch (error: any) {
<<<<<<< HEAD
    console.error('Change role error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
=======
    console.error('Clone record error:', error);
    res.status(500).json({ error: 'Clone failed', detail: error.message });
>>>>>>> origin/main
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Database Table Schema Inspector
// ════════════════════════════════════════════════════════════

// GET /admin/schema/:table — Get table schema (columns, types)
router.get('/schema/:table', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const table = req.params.table;
    const columns = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as any[];
    if (!columns.length) { res.status(404).json({ error: 'Table not found' }); return; }

<<<<<<< HEAD
    const validStatuses = ['active', 'inactive', 'terminated'];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status value' });
      return;
=======
    const indexes = db.prepare(`PRAGMA index_list("${table.replace(/"/g, '')}")`).all() as any[];
    const rowCount = db.prepare(`SELECT COUNT(*) as count FROM "${table.replace(/"/g, '')}"`).get() as any;

    res.json({
      table,
      columns: columns.map((c: any) => ({
        name: c.name,
        type: c.type,
        notnull: !!c.notnull,
        default_value: c.dflt_value,
        pk: !!c.pk,
      })),
      indexes,
      row_count: rowCount?.count || 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Schema lookup failed' });
  }
});

// GET /admin/schema — List all tables
router.get('/schema', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];
    res.json({ tables: tables.map((t: any) => t.name) });
  } catch (error: any) {
    res.status(500).json({ error: 'Schema listing failed' });
  }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Data Management & Cleanup
// ════════════════════════════════════════════════════════════

// 1. POST /admin/records/bulk-delete — Hard-delete multiple records
router.post('/records/bulk-delete', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, ids } = req.body;
    if (!table || !Array.isArray(ids) || !ids.length) { res.status(400).json({ error: 'table and ids array required' }); return; }
    const allowed = ['persons','vehicles','properties','calls_for_service','incidents','citations','arrests','warrants','field_interviews','trespass_orders','cases','evidence_items','bolos','code_violations','invoices','leave_requests','performance_reviews','daily_activity_reports','serve_queue','offender_alerts'];
    if (!allowed.includes(table)) { res.status(400).json({ error: 'Table not allowed' }); return; }
    const del = db.prepare(`DELETE FROM "${table}" WHERE id = ?`);
    let deleted = 0;
    db.transaction(() => { for (const id of ids) { deleted += del.run(id).changes; } })();
    auditLog(req, 'ADMIN_OVERRIDE', table, 0, `Bulk hard-deleted ${deleted}/${ids.length} records from ${table}`);
    res.json({ success: true, deleted });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 2. POST /admin/records/bulk-status — Change status on multiple records
router.post('/records/bulk-status', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, ids, status } = req.body;
    if (!table || !Array.isArray(ids) || !status) { res.status(400).json({ error: 'table, ids, and status required' }); return; }
    const now = new Date().toISOString();
    const upd = db.prepare(`UPDATE "${table}" SET status = ?, updated_at = ? WHERE id = ?`);
    let updated = 0;
    db.transaction(() => { for (const id of ids) { updated += upd.run(status, now, id).changes; } })();
    auditLog(req, 'ADMIN_OVERRIDE', table, 0, `Bulk status change to '${status}' on ${updated} ${table} records`);
    res.json({ success: true, updated });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 3. GET /admin/records/orphans — Find orphaned records (FK refs to deleted parents)
router.get('/records/orphans', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const orphans: any[] = [];
    const checks = [
      { table: 'incidents', fk: 'reporting_officer_id', parent: 'users' },
      { table: 'citations', fk: 'person_id', parent: 'persons' },
      { table: 'arrests', fk: 'person_id', parent: 'persons' },
      { table: 'field_interviews', fk: 'person_id', parent: 'persons' },
      { table: 'trespass_orders', fk: 'person_id', parent: 'persons' },
      { table: 'calls_for_service', fk: 'created_by', parent: 'users' },
      { table: 'evidence_items', fk: 'incident_id', parent: 'incidents' },
    ];
    for (const c of checks) {
      try {
        const rows = db.prepare(`SELECT t.id, t."${c.fk}" as fk_value FROM "${c.table}" t LEFT JOIN "${c.parent}" p ON t."${c.fk}" = p.id WHERE t."${c.fk}" IS NOT NULL AND p.id IS NULL LIMIT 100`).all();
        if (rows.length) orphans.push({ table: c.table, fk_field: c.fk, parent_table: c.parent, count: rows.length, sample_ids: rows.slice(0, 10).map((r: any) => r.id) });
      } catch {}
>>>>>>> origin/main
    }
    res.json({ orphan_groups: orphans, total_issues: orphans.reduce((s, o) => s + o.count, 0) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 4. POST /admin/records/fix-orphans — Null out orphaned FK references
router.post('/records/fix-orphans', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, fk_field, parent_table } = req.body;
    if (!table || !fk_field || !parent_table) { res.status(400).json({ error: 'table, fk_field, parent_table required' }); return; }
    const result = db.prepare(`UPDATE "${table}" SET "${fk_field}" = NULL, updated_at = ? WHERE "${fk_field}" IS NOT NULL AND "${fk_field}" NOT IN (SELECT id FROM "${parent_table}")`).run(new Date().toISOString());
    auditLog(req, 'ADMIN_OVERRIDE', table, 0, `Fixed ${result.changes} orphaned ${fk_field} refs in ${table}`);
    res.json({ success: true, fixed: result.changes });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 5. GET /admin/records/duplicates/:table — Find potential duplicate records
router.get('/records/duplicates/:table', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const table = req.params.table;
    let dupes: any[] = [];
    if (table === 'persons') {
      dupes = db.prepare(`SELECT full_name, dob, COUNT(*) as cnt, GROUP_CONCAT(id) as ids FROM persons WHERE full_name IS NOT NULL GROUP BY LOWER(full_name), dob HAVING cnt > 1 ORDER BY cnt DESC LIMIT 50`).all();
    } else if (table === 'vehicles') {
      dupes = db.prepare(`SELECT plate_number, vin, COUNT(*) as cnt, GROUP_CONCAT(id) as ids FROM vehicles WHERE plate_number IS NOT NULL GROUP BY UPPER(plate_number) HAVING cnt > 1 ORDER BY cnt DESC LIMIT 50`).all();
    } else {
      res.status(400).json({ error: 'Duplicate detection only for persons and vehicles' }); return;
    }
    res.json({ table, duplicates: dupes, count: dupes.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 6. POST /admin/records/merge-vehicles — Merge duplicate vehicle records
router.post('/records/merge-vehicles', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { keep_id, merge_id } = req.body;
    if (!keep_id || !merge_id || keep_id === merge_id) { res.status(400).json({ error: 'keep_id and merge_id required, must differ' }); return; }
    const keep = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(keep_id) as any;
    const merge = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(merge_id) as any;
    if (!keep || !merge) { res.status(404).json({ error: 'Vehicle not found' }); return; }
    let reassigned = 0;
    db.transaction(() => {
      for (const t of ['calls_for_service', 'incidents', 'citations', 'trespass_orders', 'field_interviews']) {
        try { reassigned += db.prepare(`UPDATE "${t}" SET vehicle_id = ? WHERE vehicle_id = ?`).run(keep_id, merge_id).changes; } catch {}
      }
      const fill = ['vin', 'make', 'model', 'year', 'color', 'plate_state', 'owner_name', 'insurance_company', 'insurance_policy'];
      for (const f of fill) { if (!keep[f] && merge[f]) { try { db.prepare(`UPDATE vehicles SET "${f}" = ? WHERE id = ?`).run(merge[f], keep_id); } catch {} } }
      db.prepare("UPDATE vehicles SET full_name = ?, notes = ? WHERE id = ?").run(`[MERGED INTO #${keep_id}] ${merge.plate_number || ''}`, `Merged into Vehicle #${keep_id}`, merge_id);
    })();
    auditLog(req, 'ADMIN_OVERRIDE', 'vehicle', keep_id, `Merged Vehicle #${merge_id} into #${keep_id}, ${reassigned} linked records`);
    res.json({ success: true, kept: keep_id, merged: merge_id, records_reassigned: reassigned });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 7. GET /admin/records/count — Get record counts for all tables
router.get('/records/count', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try { counts[t.name] = (db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any)?.c || 0; } catch { counts[t.name] = -1; }
    }
    res.json({ counts, total_tables: Object.keys(counts).length, total_records: Object.values(counts).filter(v => v > 0).reduce((s, v) => s + v, 0) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 8. POST /admin/records/truncate — Empty a table (keep structure)
router.post('/records/truncate', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, confirm } = req.body;
    if (!table || confirm !== 'CONFIRM_TRUNCATE') { res.status(400).json({ error: 'table required, confirm must be "CONFIRM_TRUNCATE"' }); return; }
    const blocked = ['users', 'system_config', 'sessions', 'migrations'];
    if (blocked.includes(table)) { res.status(403).json({ error: 'Cannot truncate system table' }); return; }
    const count = (db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as any)?.c || 0;
    db.prepare(`DELETE FROM "${table}"`).run();
    auditLog(req, 'ADMIN_OVERRIDE', table, 0, `TRUNCATED table ${table} (${count} records deleted)`);
    res.json({ success: true, table, records_deleted: count });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 9. POST /admin/records/transfer-ownership — Transfer all records from one user to another
router.post('/records/transfer-ownership', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from_user_id, to_user_id } = req.body;
    if (!from_user_id || !to_user_id) { res.status(400).json({ error: 'from_user_id and to_user_id required' }); return; }
    const now = new Date().toISOString();
    let total = 0;
    const fields = [
      { table: 'calls_for_service', field: 'created_by' },
      { table: 'incidents', field: 'reporting_officer_id' },
      { table: 'incidents', field: 'assigned_officer_id' },
      { table: 'citations', field: 'issuing_officer_id' },
      { table: 'arrests', field: 'arresting_officer_id' },
      { table: 'field_interviews', field: 'officer_id' },
      { table: 'daily_activity_reports', field: 'officer_id' },
      { table: 'evidence_items', field: 'collected_by' },
    ];
    db.transaction(() => {
      for (const f of fields) {
        try { total += db.prepare(`UPDATE "${f.table}" SET "${f.field}" = ?, updated_at = ? WHERE "${f.field}" = ?`).run(to_user_id, now, from_user_id).changes; } catch {}
      }
    })();
    auditLog(req, 'ADMIN_OVERRIDE', 'users', from_user_id, `Transferred ${total} records from user #${from_user_id} to #${to_user_id}`);
    res.json({ success: true, records_transferred: total });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 10. GET /admin/data-integrity — Run comprehensive data integrity checks
router.get('/data-integrity', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const issues: any[] = [];
    // Check for NULL required fields
    const nullChecks = [
      { table: 'persons', field: 'full_name', label: 'Persons without name' },
      { table: 'calls_for_service', field: 'call_number', label: 'Calls without number' },
      { table: 'incidents', field: 'incident_number', label: 'Incidents without number' },
      { table: 'citations', field: 'citation_number', label: 'Citations without number' },
      { table: 'users', field: 'username', label: 'Users without username' },
    ];
    for (const c of nullChecks) {
      try {
        const count = (db.prepare(`SELECT COUNT(*) as c FROM "${c.table}" WHERE "${c.field}" IS NULL OR "${c.field}" = ''`).get() as any)?.c || 0;
        if (count > 0) issues.push({ type: 'null_required', ...c, count });
      } catch {}
    }
    // Check DB integrity
    const integ = db.prepare('PRAGMA integrity_check').get() as any;
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
    res.json({ issues, integrity: integ, fk_violations: fkCheck.length, fk_details: fkCheck.slice(0, 20) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 11. POST /admin/records/swap-ids — Swap IDs between two records (same table)
router.post('/records/swap-ids', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id_a, id_b } = req.body;
    if (!table || !id_a || !id_b) { res.status(400).json({ error: 'table, id_a, id_b required' }); return; }
    const tempId = -999999;
    db.transaction(() => {
      db.prepare(`UPDATE "${table}" SET id = ? WHERE id = ?`).run(tempId, id_a);
      db.prepare(`UPDATE "${table}" SET id = ? WHERE id = ?`).run(id_a, id_b);
      db.prepare(`UPDATE "${table}" SET id = ? WHERE id = ?`).run(id_b, tempId);
    })();
    auditLog(req, 'ADMIN_OVERRIDE', table, id_a, `Swapped IDs: ${table} #${id_a} ↔ #${id_b}`);
    res.json({ success: true, swapped: [id_a, id_b] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 12. POST /admin/records/reindex — Reindex a column
router.post('/records/reindex', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, column } = req.body;
    if (!table || !column) { res.status(400).json({ error: 'table and column required' }); return; }
    const idxName = `idx_admin_${table}_${column}`;
    try { db.prepare(`DROP INDEX IF EXISTS "${idxName}"`).run(); } catch {}
    db.prepare(`CREATE INDEX "${idxName}" ON "${table}"("${column}")`).run();
    auditLog(req, 'ADMIN_OVERRIDE', 'database', 0, `Created index ${idxName} on ${table}.${column}`);
    res.json({ success: true, index: idxName });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 13. GET /admin/records/recent-changes — Get recently modified records across all tables
router.get('/records/recent-changes', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const hours = Math.min(parseInt(String(req.query.hours || '24'), 10), 168);
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    const tables = ['calls_for_service', 'incidents', 'citations', 'arrests', 'persons', 'vehicles', 'warrants'];
    const changes: any[] = [];
    for (const t of tables) {
      try {
        const rows = db.prepare(`SELECT id, updated_at FROM "${t}" WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 20`).all(cutoff) as any[];
        for (const r of rows) changes.push({ table: t, id: r.id, updated_at: r.updated_at });
      } catch {}
    }
    changes.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json({ changes: changes.slice(0, 100), hours, cutoff });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 14. POST /admin/records/set-sequence — Reset auto-increment sequence for a table
router.post('/records/set-sequence', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, next_id } = req.body;
    if (!table || !next_id) { res.status(400).json({ error: 'table and next_id required' }); return; }
    db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`).run(next_id - 1, table);
    auditLog(req, 'ADMIN_OVERRIDE', 'database', 0, `Reset sequence for ${table} to ${next_id}`);
    res.json({ success: true, table, next_id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 15. POST /admin/records/copy-field — Copy value from one field to another
router.post('/records/copy-field', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, source_field, target_field, where_clause } = req.body;
    if (!table || !source_field || !target_field) { res.status(400).json({ error: 'table, source_field, target_field required' }); return; }
    const sql = where_clause
      ? `UPDATE "${table}" SET "${target_field}" = "${source_field}", updated_at = ? WHERE ${where_clause}`
      : `UPDATE "${table}" SET "${target_field}" = "${source_field}", updated_at = ?`;
    const result = db.prepare(sql).run(new Date().toISOString());
    auditLog(req, 'ADMIN_OVERRIDE', table, 0, `Copied ${table}.${source_field} → ${target_field} on ${result.changes} rows`);
    res.json({ success: true, updated: result.changes });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: Workflow & Approval Overrides
// ════════════════════════════════════════════════════════════

// 16. POST /admin/workflow/force-approve — Force-approve any pending item
router.post('/workflow/force-approve', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, notes = 'Force-approved by admin' } = req.body;
    if (!table || !id) { res.status(400).json({ error: 'table and id required' }); return; }
    const now = new Date().toISOString();
    db.prepare(`UPDATE "${table}" SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?`)
      .run(req.user!.userId, now, now, `\n[ADMIN FORCE-APPROVED: ${notes}]`, id);
    auditLog(req, 'ADMIN_OVERRIDE', table, id, `Force-approved ${table} #${id}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 17. POST /admin/workflow/force-reject — Force-reject any pending item
router.post('/workflow/force-reject', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, reason = 'Rejected by admin' } = req.body;
    if (!table || !id) { res.status(400).json({ error: 'table and id required' }); return; }
    const now = new Date().toISOString();
    db.prepare(`UPDATE "${table}" SET status = 'rejected', updated_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?`)
      .run(now, `\n[ADMIN FORCE-REJECTED: ${reason}]`, id);
    auditLog(req, 'ADMIN_OVERRIDE', table, id, `Force-rejected ${table} #${id}: ${reason}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 18. POST /admin/workflow/force-status — Set any status on any record
router.post('/workflow/force-status', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, status, reason = '' } = req.body;
    if (!table || !id || !status) { res.status(400).json({ error: 'table, id, status required' }); return; }
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE "${table}" SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, id);
    if (result.changes === 0) { res.status(404).json({ error: 'Record not found' }); return; }
    auditLog(req, 'ADMIN_OVERRIDE', table, id, `Force-set status to '${status}' on ${table} #${id}. ${reason}`);
    res.json({ success: true, new_status: status });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 19. POST /admin/workflow/reopen — Reopen any closed/archived/completed record
router.post('/workflow/reopen', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, target_status = 'open' } = req.body;
    if (!table || !id) { res.status(400).json({ error: 'table and id required' }); return; }
    const now = new Date().toISOString();
    // Clear closed_at/archived_at if they exist
    try { db.prepare(`UPDATE "${table}" SET closed_at = NULL WHERE id = ?`).run(id); } catch {}
    try { db.prepare(`UPDATE "${table}" SET archived_at = NULL WHERE id = ?`).run(id); } catch {}
    db.prepare(`UPDATE "${table}" SET status = ?, updated_at = ? WHERE id = ?`).run(target_status, now, id);
    auditLog(req, 'ADMIN_OVERRIDE', table, id, `Reopened ${table} #${id} to status '${target_status}'`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 20. POST /admin/workflow/bulk-approve — Approve all pending items in a table
router.post('/workflow/bulk-approve', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, status_from = 'pending' } = req.body;
    if (!table) { res.status(400).json({ error: 'table required' }); return; }
    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE "${table}" SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE status = ?`)
      .run(req.user!.userId, now, now, status_from);
    auditLog(req, 'ADMIN_OVERRIDE', table, 0, `Bulk-approved ${result.changes} ${status_from} records in ${table}`);
    res.json({ success: true, approved: result.changes });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: User & Session Management
// ════════════════════════════════════════════════════════════

// 21. POST /admin/users/set-password — Directly set a user's password
router.post('/users/set-password', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, new_password } = req.body;
    if (!user_id || !new_password) { res.status(400).json({ error: 'user_id and new_password required' }); return; }
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), user_id);
    auditLog(req, 'ADMIN_OVERRIDE', 'users', user_id, `Admin directly set password for user #${user_id}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 22. POST /admin/users/toggle-status — Enable/disable user account
router.post('/users/toggle-status', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, status } = req.body;
    if (!user_id || !['active', 'suspended', 'disabled', 'locked'].includes(status)) { res.status(400).json({ error: 'user_id and valid status required' }); return; }
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), user_id);
    if (status !== 'active') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
    }
    auditLog(req, 'ADMIN_OVERRIDE', 'users', user_id, `Set user #${user_id} status to '${status}'`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 23. GET /admin/users/login-history/:userId — Get login history
router.get('/users/login-history/:userId', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = parseInt(req.params.userId, 10);
    const rows = db.prepare(`SELECT * FROM activity_log WHERE user_id = ? AND (action LIKE '%login%' OR action LIKE '%LOGIN%' OR action LIKE '%auth%') ORDER BY created_at DESC LIMIT 100`).all(userId);
    res.json({ user_id: userId, logins: rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

<<<<<<< HEAD
    res.json({ message: `${user.full_name}'s status changed from ${oldStatus} to ${status}.`, oldStatus, newStatus: status });
  } catch (error: any) {
    console.error('Change status error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
=======
// 24. POST /admin/users/unlock — Unlock a locked account
router.post('/users/unlock', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id } = req.body;
    if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }
    db.prepare('UPDATE users SET status = ?, failed_login_attempts = 0, lockout_until = NULL, updated_at = ? WHERE id = ?').run('active', new Date().toISOString(), user_id);
    auditLog(req, 'ADMIN_OVERRIDE', 'users', user_id, `Unlocked user #${user_id}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 25. POST /admin/users/kill-sessions — Kill all sessions for a user
router.post('/users/kill-sessions', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id } = req.body;
    if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }
    const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
    auditLog(req, 'ADMIN_OVERRIDE', 'users', user_id, `Killed ${result.changes} sessions for user #${user_id}`);
    try { const { broadcast } = require('../utils/websocket'); broadcast('system', 'session:killed', { user_id }); } catch {}
    res.json({ success: true, sessions_killed: result.changes });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 26. GET /admin/users/all-sessions — List all active sessions
router.get('/users/all-sessions', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT rt.id, rt.user_id, rt.created_at, rt.expires_at, rt.ip_address, rt.user_agent, u.username, u.full_name, u.role FROM sessions rt JOIN users u ON rt.user_id = u.id WHERE rt.expires_at > datetime('now') ORDER BY rt.created_at DESC`).all();
    res.json({ sessions: rows, count: rows.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 27. POST /admin/users/bulk-role — Change role for multiple users
router.post('/users/bulk-role', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_ids, role } = req.body;
    if (!Array.isArray(user_ids) || !role) { res.status(400).json({ error: 'user_ids and role required' }); return; }
    const valid = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher', 'contract_manager'];
    if (!valid.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    const now = new Date().toISOString();
    let updated = 0;
    db.transaction(() => { for (const id of user_ids) { updated += db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ? AND id != ?').run(role, now, id, req.user!.userId).changes; } })();
    auditLog(req, 'ADMIN_OVERRIDE', 'users', 0, `Bulk role change to '${role}' for ${updated} users`);
    res.json({ success: true, updated });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 28. POST /admin/users/create — Create user directly (bypass registration)
router.post('/users/create', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { username, password, full_name, role = 'officer', email, badge_number, call_sign } = req.body;
    if (!username || !password || !full_name) { res.status(400).json({ error: 'username, password, full_name required' }); return; }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) { res.status(409).json({ error: 'Username already exists' }); return; }
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO users (username, password_hash, full_name, role, email, badge_number, call_sign, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(username, hash, full_name, role, email || null, badge_number || null, call_sign || null, 'active', now, now);
    auditLog(req, 'ADMIN_OVERRIDE', 'users', Number(result.lastInsertRowid), `Created user ${username} (${role})`);
    res.json({ success: true, id: result.lastInsertRowid, username });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 29. POST /admin/users/edit-profile — Edit any user's profile fields
router.post('/users/edit-profile', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, ...fields } = req.body;
    if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }
    const allowed = ['full_name', 'email', 'phone', 'badge_number', 'call_sign', 'department', 'rank', 'hire_date', 'notes'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) { updates.push(`"${k}" = ?`); values.push(v); }
    }
    if (!updates.length) { res.status(400).json({ error: 'No valid fields to update' }); return; }
    updates.push('updated_at = ?'); values.push(new Date().toISOString());
    values.push(user_id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    auditLog(req, 'ADMIN_OVERRIDE', 'users', user_id, `Edited profile fields: ${Object.keys(fields).join(', ')}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 30. POST /admin/users/deactivate — Deactivate user and transfer their records
router.post('/users/deactivate', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id, transfer_to_id } = req.body;
    if (!user_id) { res.status(400).json({ error: 'user_id required' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run('disabled', now, user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
    let transferred = 0;
    if (transfer_to_id) {
      const fields = [
        { table: 'calls_for_service', field: 'created_by' },
        { table: 'incidents', field: 'assigned_officer_id' },
      ];
      for (const f of fields) {
        try { transferred += db.prepare(`UPDATE "${f.table}" SET "${f.field}" = ? WHERE "${f.field}" = ? AND status IN ('open','active','pending','dispatched','enroute','onscene')`).run(transfer_to_id, user_id).changes; } catch {}
      }
    }
    auditLog(req, 'ADMIN_OVERRIDE', 'users', user_id, `Deactivated user #${user_id}, transferred ${transferred} active records`);
    res.json({ success: true, transferred });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// GOD MODE: System Configuration & Notifications
// ════════════════════════════════════════════════════════════

// 31. POST /admin/config/set — Set any system_config value
router.post('/config/set', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { key, value, category = 'admin' } = req.body;
    if (!key) { res.status(400).json({ error: 'key required' }); return; }
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = ?").get(key) as any;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, category = ?, updated_at = ? WHERE config_key = ?").run(typeof value === 'object' ? JSON.stringify(value) : String(value), category, now, key);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)").run(key, typeof value === 'object' ? JSON.stringify(value) : String(value), category, now, now);
    }
    auditLog(req, 'ADMIN_OVERRIDE', 'system_config', 0, `Set config ${key} = ${String(value).slice(0, 100)}`);
    res.json({ success: true, key, value });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 32. GET /admin/config/all — Get all system config values
router.get('/config/all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM system_config ORDER BY category, config_key').all();
    res.json({ configs: rows, count: rows.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 33. DELETE /admin/config/:key — Delete a config entry
router.delete('/config/:key', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM system_config WHERE config_key = ?').run(req.params.key);
    auditLog(req, 'ADMIN_OVERRIDE', 'system_config', 0, `Deleted config key: ${req.params.key}`);
    res.json({ success: true, deleted: result.changes > 0 });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 34. POST /admin/notifications/send-as — Send notification as any user
router.post('/notifications/send-as', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { from_user_id, to_user_id, title, message, type = 'info' } = req.body;
    if (!to_user_id || !message) { res.status(400).json({ error: 'to_user_id and message required' }); return; }
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO notifications (user_id, from_user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(to_user_id, from_user_id || req.user!.userId, title || 'Admin Message', message, type, now);
    try { const { broadcast } = require('../utils/websocket'); broadcast('system', 'notification:new', { user_id: to_user_id }); } catch {}
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 35. POST /admin/notifications/clear-all — Clear all notifications for a user
router.post('/notifications/clear-all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_id } = req.body;
    const result = user_id
      ? db.prepare('DELETE FROM notifications WHERE user_id = ?').run(user_id)
      : db.prepare('DELETE FROM notifications WHERE is_read = 1').run();
    res.json({ success: true, cleared: result.changes });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 36. POST /admin/audit/purge-before — Purge audit logs before a date
router.post('/audit/purge-before', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { before_date } = req.body;
    if (!before_date) { res.status(400).json({ error: 'before_date required (ISO format)' }); return; }
    const result = db.prepare('DELETE FROM activity_log WHERE created_at < ?').run(before_date);
    auditLog(req, 'ADMIN_OVERRIDE', 'activity_log', 0, `Purged ${result.changes} audit entries before ${before_date}`);
    res.json({ success: true, purged: result.changes });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 37. GET /admin/audit/user/:userId — Get all audit entries for a user
router.get('/audit/user/:userId', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(String(req.query.limit || '200'), 10), 1000);
    const rows = db.prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(parseInt(req.params.userId, 10), limit);
    res.json({ entries: rows, count: rows.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 38. GET /admin/audit/entity/:type/:id — Get audit trail for a specific record
router.get('/audit/entity/:type/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT al.*, u.username, u.full_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.entity_type = ? AND al.entity_id = ? ORDER BY al.created_at DESC LIMIT 200').all(req.params.type, parseInt(req.params.id, 10));
    res.json({ trail: rows, count: rows.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 39. POST /admin/system/restart-hint — Create a restart-needed flag
router.post('/system/restart-hint', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = 'restart_requested'").get() as any;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = 'restart_requested'").run(JSON.stringify({ requested: true, by: req.user!.userId, at: now }), now);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES ('restart_requested', ?, 'system', 1, ?, ?)").run(JSON.stringify({ requested: true, by: req.user!.userId, at: now }), now, now);
    }
    auditLog(req, 'ADMIN_OVERRIDE', 'system', 0, 'Restart requested');
    res.json({ success: true, message: 'Restart flag set. Deploy script will pick it up.' });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 40. GET /admin/system/disk-usage — Get database file size and disk info
router.get('/system/disk-usage', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const pageCount = (db.prepare('PRAGMA page_count').get() as any)?.page_count || 0;
    const pageSize = (db.prepare('PRAGMA page_size').get() as any)?.page_size || 4096;
    const freelistCount = (db.prepare('PRAGMA freelist_count').get() as any)?.freelist_count || 0;
    const dbSizeBytes = pageCount * pageSize;
    const freeBytes = freelistCount * pageSize;
    res.json({
      database_size_mb: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
      free_space_mb: Math.round(freeBytes / 1024 / 1024 * 100) / 100,
      utilization_pct: Math.round((1 - freelistCount / Math.max(pageCount, 1)) * 100),
      page_count: pageCount,
      page_size: pageSize,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 41. POST /admin/system/feature-flag — Toggle a feature flag
router.post('/system/feature-flag', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { flag, enabled } = req.body;
    if (!flag || typeof enabled !== 'boolean') { res.status(400).json({ error: 'flag and enabled required' }); return; }
    const now = new Date().toISOString();
    const key = `feature_flag_${flag}`;
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = ?").get(key) as any;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, is_active = ?, updated_at = ? WHERE config_key = ?").run(String(enabled), enabled ? 1 : 0, now, key);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES (?, ?, 'features', ?, ?, ?)").run(key, String(enabled), enabled ? 1 : 0, now, now);
    }
    auditLog(req, 'ADMIN_OVERRIDE', 'system_config', 0, `Feature flag '${flag}' ${enabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ success: true, flag, enabled });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 42. GET /admin/system/feature-flags — List all feature flags
router.get('/system/feature-flags', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT config_key, config_value, is_active FROM system_config WHERE config_key LIKE 'feature_flag_%' ORDER BY config_key").all() as any[];
    const flags = rows.map((r: any) => ({ flag: r.config_key.replace('feature_flag_', ''), enabled: r.is_active === 1 }));
    res.json({ flags });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 43. POST /admin/broadcast/system-message — Send system-wide banner message
router.post('/broadcast/system-message', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { message, type = 'info', duration_minutes = 60 } = req.body;
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + duration_minutes * 60000).toISOString();
    const data = JSON.stringify({ message, type, created_by: req.user!.userId, created_at: now, expires_at: expires });
    const existing = db.prepare("SELECT id FROM system_config WHERE config_key = 'system_banner'").get() as any;
    if (existing) {
      db.prepare("UPDATE system_config SET config_value = ?, updated_at = ? WHERE config_key = 'system_banner'").run(data, now);
    } else {
      db.prepare("INSERT INTO system_config (config_key, config_value, category, is_active, created_at, updated_at) VALUES ('system_banner', ?, 'system', 1, ?, ?)").run(data, now, now);
    }
    try { const { broadcast } = require('../utils/websocket'); broadcast('system', 'banner:update', JSON.parse(data)); } catch {}
    auditLog(req, 'ADMIN_OVERRIDE', 'system', 0, `System banner: ${message.slice(0, 100)}`);
    res.json({ success: true, expires_at: expires });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 44. DELETE /admin/broadcast/system-message — Clear system banner
router.delete('/broadcast/system-message', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM system_config WHERE config_key = 'system_banner'").run();
    try { const { broadcast } = require('../utils/websocket'); broadcast('system', 'banner:clear', {}); } catch {}
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 45. POST /admin/dispatch/reassign-unit — Reassign a unit to different call
router.post('/dispatch/reassign-unit', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { unit_id, from_call_id, to_call_id } = req.body;
    if (!unit_id || !to_call_id) { res.status(400).json({ error: 'unit_id and to_call_id required' }); return; }
    const now = new Date().toISOString();
    if (from_call_id) {
      db.prepare('DELETE FROM call_unit_assignments WHERE call_id = ? AND unit_id = ?').run(from_call_id, unit_id);
    }
    try { db.prepare('INSERT INTO call_unit_assignments (call_id, unit_id, assigned_at) VALUES (?, ?, ?)').run(to_call_id, unit_id, now); } catch {}
    db.prepare('UPDATE dispatch_units SET current_call_id = ?, status = ?, updated_at = ? WHERE id = ?').run(to_call_id, 'dispatched', now, unit_id);
    auditLog(req, 'ADMIN_OVERRIDE', 'dispatch_units', unit_id, `Reassigned unit #${unit_id} from call #${from_call_id || 'none'} to call #${to_call_id}`);
    try { const { broadcast } = require('../utils/websocket'); broadcast('dispatch', 'units:reassigned', { unit_id, to_call_id }); } catch {}
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 46. POST /admin/dispatch/clear-unit — Force-clear a unit from its current call
router.post('/dispatch/clear-unit', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { unit_id } = req.body;
    if (!unit_id) { res.status(400).json({ error: 'unit_id required' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE dispatch_units SET current_call_id = NULL, status = ?, updated_at = ? WHERE id = ?').run('available', now, unit_id);
    auditLog(req, 'ADMIN_OVERRIDE', 'dispatch_units', unit_id, `Force-cleared unit #${unit_id} to available`);
    try { const { broadcast } = require('../utils/websocket'); broadcast('dispatch', 'units:cleared', { unit_id }); } catch {}
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 47. POST /admin/dispatch/set-priority — Force-set call priority
router.post('/dispatch/set-priority', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_id, priority } = req.body;
    if (!call_id || !priority) { res.status(400).json({ error: 'call_id and priority required' }); return; }
    db.prepare('UPDATE calls_for_service SET priority = ?, updated_at = ? WHERE id = ?').run(priority, new Date().toISOString(), call_id);
    auditLog(req, 'ADMIN_OVERRIDE', 'calls_for_service', call_id, `Force-set priority to '${priority}'`);
    try { const { broadcast } = require('../utils/websocket'); broadcast('dispatch', 'calls:updated', { id: call_id }); } catch {}
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 48. POST /admin/records/add-note — Append a note to any record
router.post('/records/add-note', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, id, note } = req.body;
    if (!table || !id || !note) { res.status(400).json({ error: 'table, id, note required' }); return; }
    const now = new Date().toISOString();
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
    const appendNote = `\n[ADMIN NOTE ${timestamp}]: ${note}`;
    try {
      db.prepare(`UPDATE "${table}" SET notes = COALESCE(notes, '') || ?, updated_at = ? WHERE id = ?`).run(appendNote, now, id);
    } catch {
      try { db.prepare(`UPDATE "${table}" SET description = COALESCE(description, '') || ?, updated_at = ? WHERE id = ?`).run(appendNote, now, id); } catch {}
    }
    auditLog(req, 'ADMIN_OVERRIDE', table, id, `Added admin note to ${table} #${id}`);
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 49. POST /admin/records/search-all — Search across all tables
router.post('/records/search-all', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { query } = req.body;
    if (!query || query.length < 2) { res.status(400).json({ error: 'query (2+ chars) required' }); return; }
    const q = `%${query}%`;
    const results: any[] = [];
    const searches = [
      { table: 'persons', fields: ['full_name', 'dob', 'phone', 'email', 'address'], label: 'Persons' },
      { table: 'vehicles', fields: ['plate_number', 'vin', 'make', 'model', 'owner_name'], label: 'Vehicles' },
      { table: 'calls_for_service', fields: ['call_number', 'location', 'call_type', 'notes'], label: 'Calls' },
      { table: 'incidents', fields: ['incident_number', 'title', 'location_address', 'narrative'], label: 'Incidents' },
      { table: 'citations', fields: ['citation_number', 'person_name', 'violation_description'], label: 'Citations' },
      { table: 'warrants', fields: ['warrant_number', 'subject_name', 'description'], label: 'Warrants' },
      { table: 'users', fields: ['username', 'full_name', 'email', 'badge_number'], label: 'Users' },
    ];
    for (const s of searches) {
      try {
        const where = s.fields.map(f => `"${f}" LIKE ?`).join(' OR ');
        const params = s.fields.map(() => q);
        const rows = db.prepare(`SELECT id, ${s.fields.map(f => `"${f}"`).join(', ')} FROM "${s.table}" WHERE ${where} LIMIT 10`).all(...params) as any[];
        if (rows.length) results.push({ table: s.table, label: s.label, matches: rows });
      } catch {}
    }
    res.json({ query, results, total_matches: results.reduce((s, r) => s + r.matches.length, 0) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 50. POST /admin/records/raw-insert — Insert a raw record into any table
router.post('/records/raw-insert', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { table, data } = req.body;
    if (!table || !data || typeof data !== 'object') { res.status(400).json({ error: 'table and data object required' }); return; }
    const blocked = ['users', 'sessions', 'system_config', 'migrations'];
    if (blocked.includes(table)) { res.status(403).json({ error: 'Cannot raw-insert into system tables' }); return; }
    if (!data.created_at) data.created_at = new Date().toISOString();
    if (!data.updated_at) data.updated_at = new Date().toISOString();
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(c => data[c]);
    const result = db.prepare(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(...values);
    auditLog(req, 'ADMIN_OVERRIDE', table, Number(result.lastInsertRowid), `Raw insert into ${table}`);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
>>>>>>> origin/main
});

export default router;
