// ============================================================
// CRM Leads API Routes
// ============================================================
// Full lead management for the Overwatch CRM: listing, CRUD,
// pipeline stage transitions, assignment, conversion to client,
// bulk actions, scrape source config, and scrape log viewing.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { calculateLeadScore, runScraper, getRegisteredScraper } from '../utils/leadScraperBase';

// Import scrapers so they register themselves
import '../utils/utahBizScraper';
import '../utils/constructionPermitScraper';
import '../utils/dabcLicenseScraper';
import '../utils/commercialReScraper';

const router = Router();
router.use(authenticate);

// ── List Leads ──────────────────────────────────────────────
router.get('/leads', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source, pipeline_stage, score_min, assigned_to, search, date_from, date_to } = req.query;

    let sql = `
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE 1=1
    `;
    const params: any[] = [];

    if (source) {
      sql += ' AND l.source = ?';
      params.push(source);
    }
    if (pipeline_stage) {
      const stages = (pipeline_stage as string).split(',');
      sql += ` AND l.pipeline_stage IN (${stages.map(() => '?').join(',')})`;
      params.push(...stages);
    }
    if (score_min) {
      sql += ' AND l.lead_score >= ?';
      params.push(parseInt(score_min as string) || 0);
    }
    if (assigned_to) {
      if (assigned_to === 'unassigned') {
        sql += ' AND l.assigned_to IS NULL';
      } else {
        sql += ' AND l.assigned_to = ?';
        params.push(assigned_to);
      }
    }
    if (search) {
      sql += " AND (l.business_name LIKE ? OR l.contact_name LIKE ? OR l.address LIKE ? OR l.city LIKE ?)";
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }
    if (date_from) {
      sql += ' AND l.created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      sql += ' AND l.created_at <= ?';
      params.push(date_to + ' 23:59:59');
    }

    sql += ' ORDER BY l.lead_score DESC, l.created_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get Single Lead ─────────────────────────────────────────
router.get('/leads/:id', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id) as any;

    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Include activity history
    const activity = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM crm_lead_activity a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.lead_id = ?
      ORDER BY a.created_at DESC
    `).all(id);

    res.json({ ...lead, activity });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create Lead ─────────────────────────────────────────────
router.post('/leads', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      business_name, source, source_id, source_url, industry, sic_code, business_type,
      contact_name, contact_email, contact_phone, contact_title,
      address, city, state, zip, latitude, longitude,
      estimated_value, permit_number, registration_date, license_number,
      project_type, property_size, notes, assigned_to, pipeline_stage,
    } = req.body;

    if (!business_name?.trim()) {
      res.status(400).json({ error: 'business_name is required' });
      return;
    }

    const now = localNow();
    const leadData = {
      source: source || 'manual',
      source_id: source_id || null,
      business_name: business_name.trim(),
      industry, sic_code, business_type,
      contact_name, contact_email, contact_phone, contact_title,
      address, city, state: state || 'UT', zip,
      estimated_value,
    };
    const score = calculateLeadScore(leadData);

    const result = db.prepare(`
      INSERT INTO crm_leads (
        source, source_id, source_url, business_name, industry, sic_code, business_type,
        contact_name, contact_email, contact_phone, contact_title,
        address, city, state, zip, latitude, longitude,
        estimated_value, permit_number, registration_date, license_number,
        project_type, property_size, notes,
        pipeline_stage, lead_score, assigned_to, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source || 'manual', source_id || null, source_url || null,
      business_name.trim(), industry || null, sic_code || null, business_type || null,
      contact_name || null, contact_email || null, contact_phone || null, contact_title || null,
      address || null, city || null, state || 'UT', zip || null,
      latitude || null, longitude || null,
      estimated_value || null, permit_number || null, registration_date || null,
      license_number || null, project_type || null, property_size || null, notes || null,
      pipeline_stage || 'new', score, assigned_to || null, now, now,
    );

    const leadId = Number(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'crm_leads' as any, leadId, `Created lead: ${business_name.trim()}`);

    // Log creation activity
    db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, created_by, created_at)
      VALUES (?, 'created', 'Lead created manually', ?, ?)
    `).run(leadId, req.user?.userId || null, now);

    const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(leadId);
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update Lead ─────────────────────────────────────────────
router.put('/leads/:id', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const now = localNow();
    const fields = [
      'business_name', 'source', 'source_id', 'source_url', 'industry', 'sic_code',
      'business_type', 'contact_name', 'contact_email', 'contact_phone', 'contact_title',
      'address', 'city', 'state', 'zip', 'latitude', 'longitude',
      'estimated_value', 'permit_number', 'registration_date', 'license_number',
      'project_type', 'property_size', 'notes', 'next_follow_up', 'lost_reason',
    ];

    const updates: string[] = [];
    const params: any[] = [];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field] === '' ? null : req.body[field]);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Recalculate lead score if relevant fields changed
    const scoreFields = ['business_type', 'industry', 'estimated_value', 'city', 'state', 'contact_email', 'contact_phone', 'contact_name'];
    if (scoreFields.some(f => req.body[f] !== undefined)) {
      const merged = { ...existing, ...req.body };
      const newScore = calculateLeadScore(merged);
      updates.push('lead_score = ?');
      params.push(newScore);
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE crm_leads SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE', 'crm_leads' as any, String(id), `Updated lead: ${existing.business_name}`);

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id);
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete Lead ─────────────────────────────────────────────
router.delete('/leads/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Cascade: delete activity (handled by FK ON DELETE CASCADE, but be explicit)
    db.prepare('DELETE FROM crm_lead_activity WHERE lead_id = ?').run(id);
    db.prepare('DELETE FROM crm_leads WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'crm_leads' as any, String(id), `Deleted lead: ${existing.business_name}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Move Pipeline Stage ─────────────────────────────────────
router.put('/leads/:id/stage', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { pipeline_stage, lost_reason } = req.body;

    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const validStages = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dismissed'];
    if (!pipeline_stage || !validStages.includes(pipeline_stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
      return;
    }

    const now = localNow();
    const updateFields: string[] = ['pipeline_stage = ?', 'updated_at = ?'];
    const updateParams: any[] = [pipeline_stage, now];

    if (pipeline_stage === 'lost' && lost_reason) {
      updateFields.push('lost_reason = ?');
      updateParams.push(lost_reason);
    }

    updateParams.push(id);
    db.prepare(`UPDATE crm_leads SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateParams);

    // Log activity with old/new values
    db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, old_value, new_value, created_by, created_at)
      VALUES (?, 'stage_change', ?, ?, ?, ?, ?)
    `).run(id, `Pipeline: ${existing.pipeline_stage} → ${pipeline_stage}`, existing.pipeline_stage, pipeline_stage, req.user?.userId || null, now);

    auditLog(req, 'UPDATE', 'crm_leads' as any, String(id), `Stage: ${existing.pipeline_stage} → ${pipeline_stage}`);

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id);
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Assign Lead ─────────────────────────────────────────────
router.put('/leads/:id/assign', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { assigned_to } = req.body;

    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const now = localNow();
    db.prepare('UPDATE crm_leads SET assigned_to = ?, updated_at = ? WHERE id = ?').run(assigned_to || null, now, id);

    // Get assignee name
    let assigneeName = 'Unassigned';
    if (assigned_to) {
      const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(assigned_to) as any;
      assigneeName = user?.full_name || `User #${assigned_to}`;
    }

    db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, old_value, new_value, created_by, created_at)
      VALUES (?, 'assignment', ?, ?, ?, ?, ?)
    `).run(id, `Assigned to ${assigneeName}`, String(existing.assigned_to || ''), String(assigned_to || ''), req.user?.userId || null, now);

    auditLog(req, 'UPDATE', 'crm_leads' as any, String(id), `Assigned lead to ${assigneeName}`);

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id);
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Convert Lead to Client ──────────────────────────────────
router.post('/leads/:id/convert', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    if (lead.pipeline_stage !== 'won') {
      res.status(400).json({ error: 'Lead must be in "won" stage to convert' });
      return;
    }

    if (lead.client_id) {
      res.status(400).json({ error: 'Lead already converted to client', client_id: lead.client_id });
      return;
    }

    const now = localNow();

    // Create client from lead data
    const clientResult = db.prepare(`
      INSERT INTO clients (
        name, contact_name, contact_email, contact_phone,
        address, city, state, zip,
        industry, status, source,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `).run(
      lead.business_name,
      lead.contact_name || null,
      lead.contact_email || null,
      lead.contact_phone || null,
      lead.address || null,
      lead.city || null,
      lead.state || 'UT',
      lead.zip || null,
      lead.industry || lead.business_type || null,
      `lead:${lead.source}`,
      req.user?.userId || null,
      now, now,
    );

    const clientId = Number(clientResult.lastInsertRowid);

    // Update lead with client reference
    db.prepare('UPDATE crm_leads SET client_id = ?, updated_at = ? WHERE id = ?').run(clientId, now, id);

    // Log activity
    db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, new_value, created_by, created_at)
      VALUES (?, 'conversion', 'Lead converted to client', ?, ?, ?)
    `).run(id, String(clientId), req.user?.userId || null, now);

    auditLog(req, 'CREATE', 'client', clientId, `Converted lead "${lead.business_name}" to client`);
    auditLog(req, 'UPDATE', 'crm_leads' as any, String(id), `Converted to client #${clientId}`);

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    res.json({ success: true, client, lead_id: Number(id), client_id: clientId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk Actions ────────────────────────────────────────────
router.post('/leads/bulk-action', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { action, lead_ids, assigned_to } = req.body;

    if (!action || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      res.status(400).json({ error: 'action and lead_ids[] are required' });
      return;
    }

    const now = localNow();
    const placeholders = lead_ids.map(() => '?').join(',');
    let updated = 0;

    switch (action) {
      case 'mark_contacted':
        updated = db.prepare(
          `UPDATE crm_leads SET pipeline_stage = 'contacted', updated_at = ? WHERE id IN (${placeholders}) AND pipeline_stage = 'new'`
        ).run(now, ...lead_ids).changes;
        break;

      case 'assign':
        if (!assigned_to) {
          res.status(400).json({ error: 'assigned_to is required for assign action' });
          return;
        }
        updated = db.prepare(
          `UPDATE crm_leads SET assigned_to = ?, updated_at = ? WHERE id IN (${placeholders})`
        ).run(assigned_to, now, ...lead_ids).changes;
        break;

      case 'dismiss':
        updated = db.prepare(
          `UPDATE crm_leads SET pipeline_stage = 'dismissed', updated_at = ? WHERE id IN (${placeholders})`
        ).run(now, ...lead_ids).changes;
        break;

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }

    auditLog(req, 'UPDATE', 'crm_leads' as any, lead_ids.join(','), `Bulk ${action}: ${updated} leads`);
    res.json({ success: true, updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pipeline Summary ────────────────────────────────────────
router.get('/leads/pipeline-summary', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT pipeline_stage,
             COUNT(*) as count,
             COALESCE(SUM(estimated_value), 0) as total_value
      FROM crm_leads
      WHERE pipeline_stage NOT IN ('dismissed')
      GROUP BY pipeline_stage
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Lead Activity Log ───────────────────────────────────────
router.get('/lead-activity/:leadId', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { leadId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    const rows = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM crm_lead_activity a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.lead_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(leadId, limit);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Log Lead Activity ───────────────────────────────────────
router.post('/lead-activity', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { lead_id, activity_type, subject, details, old_value, new_value } = req.body;
    if (!lead_id || !activity_type) {
      res.status(400).json({ error: 'lead_id and activity_type are required' });
      return;
    }

    // Verify lead exists
    const lead = db.prepare('SELECT id FROM crm_leads WHERE id = ?').get(lead_id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, details, old_value, new_value, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lead_id, activity_type, subject || null, details || null, old_value || null, new_value || null, req.user?.userId || null, now);

    const activityId = Number(result.lastInsertRowid);
    const activity = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM crm_lead_activity a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.id = ?
    `).get(activityId);

    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scrape Sources ──────────────────────────────────────────
router.get('/scrape-sources', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM lead_scrape_sources ORDER BY source_key').all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/scrape-sources/:key', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { key } = req.params;
    const { is_enabled, poll_interval_seconds, extra_config } = req.body;

    const existing = db.prepare('SELECT * FROM lead_scrape_sources WHERE source_key = ?').get(key) as any;
    if (!existing) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    const now = localNow();
    const updates: string[] = [];
    const params: any[] = [];

    if (is_enabled !== undefined) { updates.push('is_enabled = ?'); params.push(is_enabled ? 1 : 0); }
    if (poll_interval_seconds !== undefined) { updates.push('poll_interval_seconds = ?'); params.push(poll_interval_seconds); }
    if (extra_config !== undefined) { updates.push('extra_config = ?'); params.push(typeof extra_config === 'string' ? extra_config : JSON.stringify(extra_config)); }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(key);

    db.prepare(`UPDATE lead_scrape_sources SET ${updates.join(', ')} WHERE source_key = ?`).run(...params);
    auditLog(req, 'UPDATE', 'system_config', String(key), `Updated scrape source: ${key}`);

    const source = db.prepare('SELECT * FROM lead_scrape_sources WHERE source_key = ?').get(key);
    res.json(source);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Poll Now (Trigger Scraper) ──────────────────────────────
router.post('/scrape-sources/:key/poll-now', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { key } = req.params;

    const sourceKey = String(key);
    const scraper = getRegisteredScraper(sourceKey);
    if (!scraper) {
      res.status(404).json({ error: `No scraper registered for source: ${sourceKey}` });
      return;
    }

    auditLog(req, 'UPDATE', 'system_config', sourceKey, `Manual poll triggered for: ${sourceKey}`);

    // Run the scraper
    const result = await runScraper(sourceKey);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Scrape Log ──────────────────────────────────────────────
router.get('/scrape-log', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source_key } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    let sql = 'SELECT * FROM lead_scrape_log WHERE 1=1';
    const params: any[] = [];

    if (source_key) {
      sql += ' AND source_key = ?';
      params.push(source_key);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
