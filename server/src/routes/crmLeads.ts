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
import { escapeLike, validateParamIdMiddleware, validateStr, validateEnum, requireInt, requireFloat, validateDateStr } from '../middleware/sanitize';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

// Import scrapers so they register themselves
import '../utils/utahBizScraper';
import '../utils/constructionPermitScraper';
import '../utils/dabcLicenseScraper';
import '../utils/commercialReScraper';
import '../utils/utahBarScraper';
import '../utils/utCommerceCollectionsScraper';
import '../utils/utConsumerProtectionScraper';
import '../utils/utCourtsScraper';
import '../utils/googlePlacesLeadScraper';
import '../utils/utahRealEstateLicenseScraper';
import '../utils/cfpbComplaintScraper';

const router = Router();
router.use(authenticate);

// ── List Leads ──────────────────────────────────────────────
router.get('/leads', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source, pipeline_stage, score_min, assigned_to, search, date_from, date_to, service_interest } = req.query;

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
      const stages = (pipeline_stage as string).split(',').filter(Boolean).slice(0, 20);
      if (stages.length > 0) {
        sql += ` AND l.pipeline_stage IN (${stages.map(() => '?').join(',')})`;
        params.push(...stages);
      }
    }
    if (score_min) {
      sql += ' AND l.lead_score >= ?';
      params.push(parseInt(score_min as string, 10) || 0);
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
      sql += " AND (l.business_name LIKE ? ESCAPE '\\' OR l.contact_name LIKE ? ESCAPE '\\' OR l.address LIKE ? ESCAPE '\\' OR l.city LIKE ? ESCAPE '\\')";
      const q = `%${escapeLike(String(search))}%`;
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
    if (service_interest) {
      sql += " AND l.service_interest LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(String(service_interest))}%`);
    }

    sql += ' ORDER BY l.lead_score DESC, l.created_at DESC LIMIT 500';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Get Single Lead ─────────────────────────────────────────
router.get('/leads/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
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
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
      return;
    }

    // Include activity history
    const activity = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM crm_lead_activity a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.lead_id = ?
      ORDER BY a.created_at DESC
    
      LIMIT 1000
    `).all(id);

    res.json({ ...lead, activity });
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
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

    // ── Validate lead inputs ──
    const PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dismissed'] as const;
    const validBizName = validateStr(business_name, 'business_name', 300);
    if (!validBizName) {
      res.status(400).json({ error: 'business_name is required', code: 'BUSINESSNAME_IS_REQUIRED' });
      return;
    }
    validateStr(contact_name, 'contact_name', 200);
    validateStr(contact_email, 'contact_email', 200);
    validateStr(contact_phone, 'contact_phone', 30);
    validateStr(contact_title, 'contact_title', 100);
    validateStr(address, 'address', 500);
    validateStr(city, 'city', 100);
    validateStr(state, 'state', 10);
    validateStr(zip, 'zip', 20);
    validateStr(industry, 'industry', 200);
    validateStr(source, 'source', 100);
    if (estimated_value != null) requireFloat(estimated_value, 'estimated_value', 0, 100_000_000);
    if (pipeline_stage) validateEnum(pipeline_stage, PIPELINE_STAGES, 'pipeline_stage');
    if (assigned_to) requireInt(assigned_to, 'assigned_to');
    if (latitude != null) requireFloat(latitude, 'latitude', -90, 90);
    if (longitude != null) requireFloat(longitude, 'longitude', -180, 180);

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
      latitude ?? null, longitude ?? null,
      estimated_value ?? null, permit_number || null, registration_date || null,
      license_number || null, project_type || null, property_size || null, notes || null,
      pipeline_stage || 'new', score, assigned_to || null, now, now,
    );

    const leadId = Number(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'crm_leads', leadId, `Created lead: ${business_name.trim()}`);

    // Log creation activity
    db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, created_by, created_at)
      VALUES (?, 'created', 'Lead created manually', ?, ?)
    `).run(leadId, req.user?.userId || null, now);

    const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found after creation', code: 'LEAD_NOT_FOUND_AFTER' });
    broadcast('admin', 'lead:created', lead);
    res.json(lead);
  } catch (err: any) {
    if (err.message?.startsWith('Invalid ') || err.message?.includes('must be')) {
      res.status(400).json({ error: err.message }); return;
    }
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Update Lead ─────────────────────────────────────────────
router.put('/leads/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
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
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
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
    auditLog(req, 'UPDATE', 'crm_leads', String(id), `Updated lead: ${existing.business_name}`);

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id);
    broadcast('admin', 'lead:updated', lead);
    res.json(lead);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Delete Lead ─────────────────────────────────────────────
router.delete('/leads/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
      return;
    }

    // Cascade: delete activity (handled by FK ON DELETE CASCADE, but be explicit)
    db.prepare('DELETE FROM crm_lead_activity WHERE lead_id = ?').run(id);
    db.prepare('DELETE FROM crm_leads WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'crm_leads', String(id), `Deleted lead: ${existing.business_name}`);
    broadcast('admin', 'lead:deleted', { id: Number(id) });
    res.json({ success: true });
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Move Pipeline Stage ─────────────────────────────────────
router.put('/leads/:id/stage', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { pipeline_stage, lost_reason } = req.body;

    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
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

    auditLog(req, 'UPDATE', 'crm_leads', String(id), `Stage: ${existing.pipeline_stage} → ${pipeline_stage}`);

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id);
    broadcast('admin', 'lead:updated', lead);
    res.json(lead);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Assign Lead ─────────────────────────────────────────────
router.put('/leads/:id/assign', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { assigned_to } = req.body;

    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
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

    auditLog(req, 'UPDATE', 'crm_leads', String(id), `Assigned lead to ${assigneeName}`);

    const lead = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = ?
    `).get(id);
    broadcast('admin', 'lead:updated', lead);
    res.json(lead);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Convert Lead to Client ──────────────────────────────────
router.post('/leads/:id/convert', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
    if (!lead) {
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
      return;
    }

    if (lead.pipeline_stage !== 'won') {
      res.status(400).json({ error: 'Lead must be in "won" stage to convert', code: 'LEAD_MUST_BE_IN' });
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
    auditLog(req, 'UPDATE', 'crm_leads', String(id), `Converted to client #${clientId}`);

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    broadcast('admin', 'lead:updated', { id: Number(id), converted: true, client_id: clientId });
    res.json({ success: true, client: client || null, lead_id: Number(id), client_id: clientId });
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Bulk Actions ────────────────────────────────────────────
router.post('/leads/bulk-action', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { action, lead_ids, assigned_to } = req.body;

    if (!action || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      res.status(400).json({ error: 'action and lead_ids[] are required', code: 'ACTION_AND_LEADIDS_ARE' });
      return;
    }
    if (lead_ids.length > 200) { res.status(400).json({ error: 'Maximum 200 IDs per bulk action', code: 'MAXIMUM_200_IDS_PER' }); return; }
    const BULK_ACTIONS = ['mark_contacted', 'assign', 'dismiss'] as const;
    try { validateEnum(action, BULK_ACTIONS, 'action'); } catch (e: any) { res.status(400).json({ error: e.message }); return; }
    for (const lid of lead_ids) { if (isNaN(parseInt(String(lid), 10)) || parseInt(String(lid), 10) < 1) { res.status(400).json({ error: 'All lead_ids must be positive integers', code: 'ALL_LEADIDS_MUST_BE' }); return; } }

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
          res.status(400).json({ error: 'assigned_to is required for assign action', code: 'ASSIGNEDTO_IS_REQUIRED_FOR' });
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
        res.status(400).json({ error: 'Unknown action. Must be one of: mark_contacted, assign, dismiss', code: 'UNKNOWN_ACTION_MUST_BE' });
        return;
    }

    auditLog(req, 'UPDATE', 'crm_leads', lead_ids.join(','), `Bulk ${action}: ${updated} leads`);
    broadcast('admin', 'lead:updated', { action, updated, lead_ids });
    res.json({ success: true, updated });
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
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
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Lead Activity Log ───────────────────────────────────────
router.get('/lead-activity/:leadId', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { leadId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);

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
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Log Lead Activity ───────────────────────────────────────
router.post('/lead-activity', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { lead_id, activity_type, subject, details, old_value, new_value } = req.body;
    if (!lead_id || !activity_type) {
      res.status(400).json({ error: 'lead_id and activity_type are required', code: 'LEADID_AND_ACTIVITYTYPE_ARE' });
      return;
    }

    // Verify lead exists
    const lead = db.prepare('SELECT id FROM crm_leads WHERE id = ?').get(lead_id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' });
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

    if (!activity) return res.status(404).json({ error: 'Activity not found', code: 'ACTIVITY_NOT_FOUND' });
    res.json(activity);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Scrape Sources ──────────────────────────────────────────
router.get('/scrape-sources', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM lead_scrape_sources ORDER BY source_key').all();
    res.json(rows);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

router.put('/scrape-sources/:key', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { key } = req.params;
    const { is_enabled, poll_interval_seconds, extra_config } = req.body;

    const existing = db.prepare('SELECT * FROM lead_scrape_sources WHERE source_key = ?').get(key) as any;
    if (!existing) {
      res.status(404).json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' });
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
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Poll Now (Trigger Scraper) ──────────────────────────────
router.post('/scrape-sources/:key/poll-now', requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { key } = req.params;

    const sourceKey = String(key);
    const scraper = getRegisteredScraper(sourceKey);
    if (!scraper) {
      res.status(404).json({ error: 'No scraper registered for the specified source', code: 'NO_SCRAPER_REGISTERED_FOR' });
      return;
    }

    auditLog(req, 'UPDATE', 'system_config', sourceKey, `Manual poll triggered for: ${sourceKey}`);

    // Run the scraper
    const result = await runScraper(sourceKey);
    res.json(result);
  } catch (err: any) {
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ── Scrape Log ──────────────────────────────────────────────
router.get('/scrape-log', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source_key } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);

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
    console.error('CRM leads error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm leads', code: 'CRM_LEADS_ERROR' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/crm/leads/export/csv — Export leads
router.get('/leads/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT l.id, l.source, l.business_name, l.industry, l.business_type,
        l.contact_name, l.contact_email, l.contact_phone,
        l.address, l.city, l.state, l.zip,
        l.estimated_value, l.pipeline_stage, l.lead_score,
        l.created_at, l.updated_at,
        u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      ORDER BY l.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'crm_leads_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'source', header: 'Source' },
      { key: 'business_name', header: 'Business Name' },
      { key: 'industry', header: 'Industry' },
      { key: 'business_type', header: 'Business Type' },
      { key: 'contact_name', header: 'Contact Name' },
      { key: 'contact_email', header: 'Contact Email' },
      { key: 'contact_phone', header: 'Contact Phone' },
      { key: 'address', header: 'Address' },
      { key: 'city', header: 'City' },
      { key: 'state', header: 'State' },
      { key: 'zip', header: 'ZIP' },
      { key: 'estimated_value', header: 'Estimated Value' },
      { key: 'pipeline_stage', header: 'Pipeline Stage' },
      { key: 'lead_score', header: 'Lead Score' },
      { key: 'assigned_to_name', header: 'Assigned To' },
      { key: 'created_at', header: 'Created At' },
      { key: 'updated_at', header: 'Updated At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 11: Enhanced Lead Scoring
// Score leads based on engagement (website visits, emails, form fills)
// ════════════════════════════════════════════════════════════

router.get('/leads/:id/score-breakdown', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(req.params.id) as any;
    if (!lead) { res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }); return; }

    const activity = db.prepare(
      'SELECT * FROM crm_lead_activity WHERE lead_id = ? ORDER BY created_at DESC'
    ).all(req.params.id) as any[];

    // Engagement-based scoring
    const emailEngagements = activity.filter((a: any) => a.activity_type === 'email').length;
    const callEngagements = activity.filter((a: any) => a.activity_type === 'call').length;
    const meetingEngagements = activity.filter((a: any) => a.activity_type === 'meeting').length;
    const webVisits = activity.filter((a: any) => a.activity_type === 'web_visit').length;
    const formFills = activity.filter((a: any) => a.activity_type === 'form_fill').length;

    const baseScore = lead.lead_score || 0;
    const engagementScore = Math.min(30,
      (emailEngagements * 3) +
      (callEngagements * 5) +
      (meetingEngagements * 10) +
      (webVisits * 2) +
      (formFills * 8)
    );

    // Recency bonus: more recent activity = higher score
    const lastActivity = activity[0];
    let recencyBonus = 0;
    if (lastActivity) {
      const daysSinceLastActivity = (Date.now() - new Date(lastActivity.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastActivity <= 7) recencyBonus = 15;
      else if (daysSinceLastActivity <= 14) recencyBonus = 10;
      else if (daysSinceLastActivity <= 30) recencyBonus = 5;
    }

    const totalScore = Math.min(100, baseScore + engagementScore + recencyBonus);

    // Update the lead score
    db.prepare('UPDATE crm_leads SET lead_score = ?, updated_at = ? WHERE id = ?')
      .run(totalScore, localNow(), req.params.id);

    res.json({
      lead_id: lead.id,
      business_name: lead.business_name,
      base_score: baseScore,
      engagement_score: engagementScore,
      recency_bonus: recencyBonus,
      total_score: totalScore,
      breakdown: {
        emails: emailEngagements,
        calls: callEngagements,
        meetings: meetingEngagements,
        web_visits: webVisits,
        form_fills: formFills,
      },
      last_activity: lastActivity?.created_at || null,
    });
  } catch (err: any) {
    console.error('Lead score breakdown error:', err);
    res.status(500).json({ error: 'Failed to lead score breakdown', code: 'LEAD_SCORE_BREAKDOWN_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 12: Sales Pipeline Stages Summary
// Track leads through: Prospect → Qualified → Proposal → Won/Lost
// ════════════════════════════════════════════════════════════

router.get('/pipeline-summary', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const stages = db.prepare(`
      SELECT
        pipeline_stage,
        COUNT(*) as count,
        COALESCE(SUM(estimated_value), 0) as total_value,
        COALESCE(AVG(estimated_value), 0) as avg_value,
        COALESCE(AVG(lead_score), 0) as avg_score
      FROM crm_leads
      WHERE pipeline_stage NOT IN ('dismissed')
      GROUP BY pipeline_stage
      ORDER BY CASE pipeline_stage
        WHEN 'new' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'qualified' THEN 3
        WHEN 'proposal' THEN 4
        WHEN 'negotiation' THEN 5
        WHEN 'won' THEN 6
        WHEN 'lost' THEN 7
        ELSE 8
      END
    `).all();

    // Conversion rates between stages
    const allLeads = db.prepare('SELECT pipeline_stage FROM crm_leads').all() as any[];
    const stageOrder = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won'];
    const conversions: any[] = [];
    for (let i = 0; i < stageOrder.length - 1; i++) {
      const fromStageIdx = stageOrder.indexOf(stageOrder[i]);
      const fromCount = allLeads.filter((l: any) => stageOrder.indexOf(l.pipeline_stage) >= fromStageIdx).length;
      const toCount = allLeads.filter((l: any) => stageOrder.indexOf(l.pipeline_stage) >= fromStageIdx + 1).length;
      conversions.push({
        from: stageOrder[i],
        to: stageOrder[i + 1],
        rate: fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0,
      });
    }

    res.json({ stages, conversions });
  } catch (err: any) {
    console.error('Pipeline summary error:', err);
    res.status(500).json({ error: 'Failed to pipeline summary', code: 'PIPELINE_SUMMARY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 13: Follow-up Reminders
// Set follow-up date on leads, show overdue reminders
// ════════════════════════════════════════════════════════════

router.get('/leads/follow-ups', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localNow().slice(0, 10);

    const overdue = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.next_follow_up IS NOT NULL
        AND l.next_follow_up < ?
        AND l.pipeline_stage NOT IN ('won', 'lost', 'dismissed')
      ORDER BY l.next_follow_up ASC
    
      LIMIT 1000
    `).all(today);

    const todayFollowUps = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.next_follow_up = ?
        AND l.pipeline_stage NOT IN ('won', 'lost', 'dismissed')
      ORDER BY l.lead_score DESC
    
      LIMIT 1000
    `).all(today);

    const upcoming = db.prepare(`
      SELECT l.*, u.full_name as assigned_to_name
      FROM crm_leads l
      LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.next_follow_up > ?
        AND l.next_follow_up <= date(?, '+7 days')
        AND l.pipeline_stage NOT IN ('won', 'lost', 'dismissed')
      ORDER BY l.next_follow_up ASC
    
      LIMIT 1000
    `).all(today, today);

    res.json({ overdue, today: todayFollowUps, upcoming });
  } catch (err: any) {
    console.error('Follow-ups error:', err);
    res.status(500).json({ error: 'Failed to follow-ups', code: 'FOLLOWUPS_ERROR' });
  }
});

router.put('/leads/:id/follow-up', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { next_follow_up, follow_up_notes } = req.body;
    const now = localNow();

    const existing = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }); return; }

    db.prepare('UPDATE crm_leads SET next_follow_up = ?, updated_at = ? WHERE id = ?')
      .run(next_follow_up || null, now, req.params.id);

    // Log activity
    db.prepare(`
      INSERT INTO crm_lead_activity (lead_id, activity_type, subject, details, created_by, created_at)
      VALUES (?, 'follow_up_set', ?, ?, ?, ?)
    `).run(
      req.params.id,
      `Follow-up ${next_follow_up ? `set for ${next_follow_up}` : 'cleared'}`,
      follow_up_notes || null,
      req.user?.userId || null,
      now
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error('Set follow-up error:', err);
    res.status(500).json({ error: 'Failed to set follow-up', code: 'SET_FOLLOWUP_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 14: Lead Source Tracking
// Track where leads come from (website, referral, cold call, etc.)
// ════════════════════════════════════════════════════════════

router.get('/leads/source-analytics', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { days = '90' } = req.query;
    const cutoff = new Date(Date.now() - parseInt(days as string, 10) * 24 * 60 * 60 * 1000).toISOString();

    const bySource = db.prepare(`
      SELECT
        COALESCE(source, 'unknown') as source,
        COUNT(*) as total_leads,
        SUM(CASE WHEN pipeline_stage = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN pipeline_stage = 'lost' THEN 1 ELSE 0 END) as lost,
        COALESCE(SUM(estimated_value), 0) as total_value,
        COALESCE(AVG(lead_score), 0) as avg_score,
        COALESCE(AVG(CASE WHEN pipeline_stage = 'won' THEN estimated_value END), 0) as avg_won_value
      FROM crm_leads
      WHERE created_at >= ?
      GROUP BY source
      ORDER BY total_leads DESC
    `).all(cutoff);

    // Conversion rate by source
    const enriched = bySource.map((s: any) => ({
      ...s,
      conversion_rate: s.total_leads > 0 ? Math.round((s.won / s.total_leads) * 100) : 0,
      active: s.total_leads - s.won - s.lost,
    }));

    res.json({ data: enriched, period_days: parseInt(days as string, 10) });
  } catch (err: any) {
    console.error('Source analytics error:', err);
    res.status(500).json({ error: 'Failed to source analytics', code: 'SOURCE_ANALYTICS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 15: Revenue Forecast
// Expected revenue = sum(deal_value * probability)
// ════════════════════════════════════════════════════════════

router.get('/revenue-forecast', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Probability by stage
    const stageProbability: Record<string, number> = {
      new: 0.05,
      contacted: 0.10,
      qualified: 0.25,
      proposal: 0.50,
      negotiation: 0.75,
      won: 1.0,
      lost: 0,
      dismissed: 0,
    };

    const leads = db.prepare(`
      SELECT id, business_name, pipeline_stage, estimated_value, assigned_to, next_follow_up
      FROM crm_leads
      WHERE pipeline_stage NOT IN ('won', 'lost', 'dismissed')
        AND estimated_value IS NOT NULL AND estimated_value > 0
      ORDER BY estimated_value DESC
    
      LIMIT 1000
    `).all() as any[];

    let totalExpected = 0;
    let totalPipeline = 0;
    const forecast = leads.map((l: any) => {
      const probability = stageProbability[l.pipeline_stage] || 0;
      const expected = (l.estimated_value || 0) * probability;
      totalExpected += expected;
      totalPipeline += l.estimated_value || 0;
      return {
        ...l,
        probability: Math.round(probability * 100),
        expected_revenue: Math.round(expected * 100) / 100,
      };
    });

    // Won revenue (actual)
    const wonRevenue = (db.prepare(`
      SELECT COALESCE(SUM(estimated_value), 0) as total
      FROM crm_leads WHERE pipeline_stage = 'won' AND estimated_value IS NOT NULL
    `).get() as any)?.total || 0;

    // By stage breakdown
    const byStage = db.prepare(`
      SELECT pipeline_stage,
        COUNT(*) as count,
        COALESCE(SUM(estimated_value), 0) as total_value
      FROM crm_leads
      WHERE pipeline_stage NOT IN ('won', 'lost', 'dismissed')
        AND estimated_value IS NOT NULL AND estimated_value > 0
      GROUP BY pipeline_stage
    `).all() as any[];

    const stageBreakdown = byStage.map((s: any) => ({
      ...s,
      probability: Math.round((stageProbability[s.pipeline_stage] || 0) * 100),
      expected: Math.round(s.total_value * (stageProbability[s.pipeline_stage] || 0) * 100) / 100,
    }));

    res.json({
      total_pipeline: Math.round(totalPipeline * 100) / 100,
      total_expected: Math.round(totalExpected * 100) / 100,
      won_revenue: wonRevenue,
      active_deals: leads.length,
      by_stage: stageBreakdown,
      deals: forecast.slice(0, 50),
    });
  } catch (err: any) {
    console.error('Revenue forecast error:', err);
    res.status(500).json({ error: 'Failed to revenue forecast', code: 'REVENUE_FORECAST_ERROR' });
  }
});

export default router;
