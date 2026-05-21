import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function mountCrmLeadsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ── List Leads ──────────────────────────────────────────────
  api.get('/leads', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { source, pipeline_stage, score_min, assigned_to, search, date_from, date_to, service_interest } = q;

      let sql = `
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE 1=1
      `;
      const params: any[] = [];

      if (source) { sql += ' AND l.source = ?'; params.push(source); }
      if (pipeline_stage) {
        const stages = pipeline_stage.split(',').filter(Boolean).slice(0, 20);
        if (stages.length > 0) {
          sql += ` AND l.pipeline_stage IN (${stages.map(() => '?').join(',')})`;
          params.push(...stages);
        }
      }
      if (score_min) { sql += ' AND l.lead_score >= ?'; params.push(parseInt(score_min, 10) || 0); }
      if (assigned_to) {
        if (assigned_to === 'unassigned') { sql += ' AND l.assigned_to IS NULL'; }
        else { sql += ' AND l.assigned_to = ?'; params.push(assigned_to); }
      }
      if (search) {
        sql += " AND (l.business_name LIKE ? OR l.contact_name LIKE ? OR l.address LIKE ? OR l.city LIKE ?)";
        const esc = escapeLike(String(search));
        const q2 = `%${esc}%`;
        params.push(q2, q2, q2, q2);
      }
      if (date_from) { sql += ' AND l.created_at >= ?'; params.push(date_from); }
      if (date_to) { sql += ' AND l.created_at <= ?'; params.push(date_to + ' 23:59:59'); }
      if (service_interest) { sql += " AND l.service_interest LIKE ?"; params.push(`%${escapeLike(String(service_interest))}%`); }

      sql += ' ORDER BY l.lead_score DESC, l.created_at DESC LIMIT 500';

      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Pipeline Summary ────────────────────────────────────────
  api.get('/leads/pipeline-summary', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT pipeline_stage,
               COUNT(*) as count,
               COALESCE(SUM(estimated_value), 0) as total_value
        FROM crm_leads
        WHERE pipeline_stage NOT IN ('dismissed')
        GROUP BY pipeline_stage
      `).all();
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Follow-up Reminders ────────────────────────────────────────
  api.get('/leads/follow-ups', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localNow().slice(0, 10);

      const overdue = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.next_follow_up IS NOT NULL
          AND l.next_follow_up < ?
          AND l.pipeline_stage NOT IN ('won', 'lost', 'dismissed')
        ORDER BY l.next_follow_up ASC
        LIMIT 1000
      `).all(today);

      const todayFollowUps = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.next_follow_up = ?
          AND l.pipeline_stage NOT IN ('won', 'lost', 'dismissed')
        ORDER BY l.lead_score DESC
        LIMIT 1000
      `).all(today);

      const upcoming = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.next_follow_up > ?
          AND l.next_follow_up <= date(?, '+7 days')
          AND l.pipeline_stage NOT IN ('won', 'lost', 'dismissed')
        ORDER BY l.next_follow_up ASC
        LIMIT 1000
      `).all(today, today);

      return c.json({ overdue, today: todayFollowUps, upcoming });
    } catch {
      return c.json({ error: 'Failed to follow-ups', code: 'FOLLOWUPS_ERROR' }, 500);
    }
  });

  // ── Lead Source Tracking ───────────────────────────────────────
  api.get('/leads/source-analytics', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const days = q.days || '90';
      const cutoff = new Date(Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000).toISOString();

      const bySource = await db.prepare(`
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

      const enriched = (bySource as any[]).map((s: any) => ({
        ...s,
        conversion_rate: s.total_leads > 0 ? Math.round((s.won / s.total_leads) * 100) : 0,
        active: s.total_leads - s.won - s.lost,
      }));

      return c.json({ data: enriched, period_days: parseInt(days, 10) });
    } catch {
      return c.json({ error: 'Failed to source analytics', code: 'SOURCE_ANALYTICS_ERROR' }, 500);
    }
  });

  // ── Get Single Lead ─────────────────────────────────────────
  api.get('/leads/:id', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const lead = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.id = ?
      `).get(id) as any;

      if (!lead) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      const activity = await db.prepare(`
        SELECT a.*, u.full_name as created_by_name
        FROM crm_lead_activity a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.lead_id = ?
        ORDER BY a.created_at DESC
        LIMIT 1000
      `).all(id);

      return c.json({ ...lead, activity });
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Create Lead ─────────────────────────────────────────────
  api.post('/leads', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const {
        business_name, source, source_id, source_url, industry, sic_code, business_type,
        contact_name, contact_email, contact_phone, contact_title,
        address, city, state, zip, latitude, longitude,
        estimated_value, permit_number, registration_date, license_number,
        project_type, property_size, notes, assigned_to, pipeline_stage,
      } = body;

      const PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dismissed'] as const;
      const validBizName = business_name && typeof business_name === 'string' && business_name.trim().length > 0 && business_name.length <= 300 ? business_name.trim() : null;
      if (!validBizName) { return c.json({ error: 'business_name is required', code: 'BUSINESSNAME_IS_REQUIRED' }, 400); }

      const now = localNow();
      const user = c.get('user');
      const leadData = {
        source: source || 'manual',
        source_id: source_id || null,
        business_name: validBizName,
        industry, sic_code, business_type,
        contact_name, contact_email, contact_phone, contact_title,
        address, city, state: state || 'UT', zip,
        estimated_value,
      };
      const score = calculateLeadScoreSimple(leadData);

      const result = await db.prepare(`
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
        validBizName, industry || null, sic_code || null, business_type || null,
        contact_name || null, contact_email || null, contact_phone || null, contact_title || null,
        address || null, city || null, state || 'UT', zip || null,
        latitude ?? null, longitude ?? null,
        estimated_value ?? null, permit_number || null, registration_date || null,
        license_number || null, project_type || null, property_size || null, notes || null,
        pipeline_stage || 'new', score, assigned_to || null, now, now,
      );

      const leadId = Number(result.meta.last_row_id);

      await db.prepare(`
        INSERT INTO crm_lead_activity (lead_id, activity_type, subject, created_by, created_at)
        VALUES (?, 'created', 'Lead created manually', ?, ?)
      `).run(leadId, user?.userId || null, now);

      const lead = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(leadId);
      if (!lead) return c.json({ error: 'Lead not found after creation', code: 'LEAD_NOT_FOUND_AFTER' }, 404);
      return c.json(lead);
    } catch (err: any) {
      if (err?.message?.startsWith('Invalid ') || err?.message?.includes('must be') || err?.message?.includes('is required')) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Update Lead ─────────────────────────────────────────────
  api.put('/leads/:id', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      const now = localNow();
      const body = await c.req.json();
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
        if (body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(body[field] === '' ? null : body[field]);
        }
      }

      if (updates.length === 0) { return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400); }

      const scoreFields = ['business_type', 'industry', 'estimated_value', 'city', 'state', 'contact_email', 'contact_phone', 'contact_name'];
      if (scoreFields.some(f => body[f] !== undefined)) {
        const merged = { ...existing, ...body };
        const newScore = calculateLeadScoreSimple(merged);
        updates.push('lead_score = ?');
        params.push(newScore);
      }

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      await db.prepare(`UPDATE crm_leads SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const lead = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.id = ?
      `).get(id);
      return c.json(lead);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Delete Lead ─────────────────────────────────────────────
  api.delete('/leads/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      await db.prepare('DELETE FROM crm_lead_activity WHERE lead_id = ?').run(id);
      await db.prepare('DELETE FROM crm_leads WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Move Pipeline Stage ─────────────────────────────────────
  api.put('/leads/:id/stage', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { pipeline_stage, lost_reason } = body;

      const existing = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      const validStages = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dismissed'];
      if (!pipeline_stage || !validStages.includes(pipeline_stage)) {
        return c.json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` }, 400);
      }

      const now = localNow();
      const user = c.get('user');
      const updateFields: string[] = ['pipeline_stage = ?', 'updated_at = ?'];
      const updateParams: any[] = [pipeline_stage, now];

      if (pipeline_stage === 'lost' && lost_reason) {
        updateFields.push('lost_reason = ?');
        updateParams.push(lost_reason);
      }

      updateParams.push(id);
      await db.prepare(`UPDATE crm_leads SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateParams);

      await db.prepare(`
        INSERT INTO crm_lead_activity (lead_id, activity_type, subject, old_value, new_value, created_by, created_at)
        VALUES (?, 'stage_change', ?, ?, ?, ?, ?)
      `).run(id, `Pipeline: ${existing.pipeline_stage} → ${pipeline_stage}`, existing.pipeline_stage, pipeline_stage, user?.userId || null, now);

      const lead = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.id = ?
      `).get(id);
      return c.json(lead);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Assign Lead ─────────────────────────────────────────────
  api.put('/leads/:id/assign', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { assigned_to } = body;

      const existing = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      const now = localNow();
      const user = c.get('user');
      await db.prepare('UPDATE crm_leads SET assigned_to = ?, updated_at = ? WHERE id = ?').run(assigned_to || null, now, id);

      let assigneeName = 'Unassigned';
      if (assigned_to) {
        const u = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(assigned_to) as any;
        assigneeName = u?.full_name || `User #${assigned_to}`;
      }

      await db.prepare(`
        INSERT INTO crm_lead_activity (lead_id, activity_type, subject, old_value, new_value, created_by, created_at)
        VALUES (?, 'assignment', ?, ?, ?, ?, ?)
      `).run(id, `Assigned to ${assigneeName}`, String(existing.assigned_to || ''), String(assigned_to || ''), user?.userId || null, now);

      const lead = await db.prepare(`
        SELECT l.*, u.full_name as assigned_to_name
        FROM crm_leads l
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.id = ?
      `).get(id);
      return c.json(lead);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Convert Lead to Client ──────────────────────────────────
  api.post('/leads/:id/convert', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const user = c.get('user');

      const lead = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!lead) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      if (lead.pipeline_stage !== 'won') { return c.json({ error: 'Lead must be in "won" stage to convert', code: 'LEAD_MUST_BE_IN' }, 400); }
      if (lead.client_id) { return c.json({ error: 'Lead already converted to client', client_id: lead.client_id }, 400); }

      const now = localNow();

      const clientResult = await db.prepare(`
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
        user?.userId || null,
        now, now,
      );

      const clientId = Number(clientResult.meta.last_row_id);

      await db.prepare('UPDATE crm_leads SET client_id = ?, updated_at = ? WHERE id = ?').run(clientId, now, id);

      await db.prepare(`
        INSERT INTO crm_lead_activity (lead_id, activity_type, subject, new_value, created_by, created_at)
        VALUES (?, 'conversion', 'Lead converted to client', ?, ?, ?)
      `).run(id, String(clientId), user?.userId || null, now);

      const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
      return c.json({ success: true, client: client || null, lead_id: Number(id), client_id: clientId });
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Bulk Actions ────────────────────────────────────────────
  api.post('/leads/bulk-action', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { action, lead_ids, assigned_to } = body;

      if (!action || !Array.isArray(lead_ids) || lead_ids.length === 0) {
        return c.json({ error: 'action and lead_ids[] are required', code: 'ACTION_AND_LEADIDS_ARE' }, 400);
      }
      if (lead_ids.length > 200) { return c.json({ error: 'Maximum 200 IDs per bulk action', code: 'MAXIMUM_200_IDS_PER' }, 400); }
      const BULK_ACTIONS = ['mark_contacted', 'assign', 'dismiss'] as const;
      if (!BULK_ACTIONS.includes(action as any)) { return c.json({ error: 'Unknown action. Must be one of: mark_contacted, assign, dismiss', code: 'UNKNOWN_ACTION_MUST_BE' }, 400); }

      const now = localNow();
      const placeholders = lead_ids.map(() => '?').join(',');
      let updated = 0;

      switch (action) {
        case 'mark_contacted': {
          const r = await db.prepare(
            `UPDATE crm_leads SET pipeline_stage = 'contacted', updated_at = ? WHERE id IN (${placeholders}) AND pipeline_stage = 'new'`
          ).run(now, ...lead_ids);
          updated = r.meta.changes;
          break;
        }
        case 'assign':
          if (!assigned_to) { return c.json({ error: 'assigned_to is required for assign action', code: 'ASSIGNEDTO_IS_REQUIRED_FOR' }, 400); }
          {
            const r = await db.prepare(
              `UPDATE crm_leads SET assigned_to = ?, updated_at = ? WHERE id IN (${placeholders})`
            ).run(assigned_to, now, ...lead_ids);
            updated = r.meta.changes;
          }
          break;
        case 'dismiss': {
          const r = await db.prepare(
            `UPDATE crm_leads SET pipeline_stage = 'dismissed', updated_at = ? WHERE id IN (${placeholders})`
          ).run(now, ...lead_ids);
          updated = r.meta.changes;
          break;
        }
        default:
          return c.json({ error: 'Unknown action', code: 'UNKNOWN_ACTION_MUST_BE' }, 400);
      }

      return c.json({ success: true, updated });
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Lead Activity Log ───────────────────────────────────────
  api.get('/lead-activity/:leadId', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const leadId = paramNum(c.req.param('leadId'));
      const q = c.req.query();
      const limit = Math.min(100000, Math.max(1, (parseInt(q.limit || '', 10)) || 100000));

      const rows = await db.prepare(`
        SELECT a.*, u.full_name as created_by_name
        FROM crm_lead_activity a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.lead_id = ?
        ORDER BY a.created_at DESC
        LIMIT ?
      `).all(leadId, limit);

      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Log Lead Activity ───────────────────────────────────────
  api.post('/lead-activity', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { lead_id, activity_type, subject, details, old_value, new_value } = body;
      if (!lead_id || !activity_type) {
        return c.json({ error: 'lead_id and activity_type are required', code: 'LEADID_AND_ACTIVITYTYPE_ARE' }, 400);
      }

      const lead = await db.prepare('SELECT id FROM crm_leads WHERE id = ?').get(lead_id);
      if (!lead) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      const now = localNow();
      const user = c.get('user');
      const result = await db.prepare(`
        INSERT INTO crm_lead_activity (lead_id, activity_type, subject, details, old_value, new_value, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead_id, activity_type, subject || null, details || null, old_value || null, new_value || null, user?.userId || null, now);

      const activityId = Number(result.meta.last_row_id);
      const activity = await db.prepare(`
        SELECT a.*, u.full_name as created_by_name
        FROM crm_lead_activity a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = ?
      `).get(activityId);

      if (!activity) return c.json({ error: 'Activity not found', code: 'ACTIVITY_NOT_FOUND' }, 404);
      return c.json(activity);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Scrape Sources ──────────────────────────────────────────
  api.get('/scrape-sources', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare('SELECT * FROM lead_scrape_sources ORDER BY source_key').all();
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  api.put('/scrape-sources/:key', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const key = c.req.param('key');
      const body = await c.req.json();
      const { is_enabled, poll_interval_seconds, extra_config } = body;

      const existing = await db.prepare('SELECT * FROM lead_scrape_sources WHERE source_key = ?').get(key) as any;
      if (!existing) { return c.json({ error: 'Source not found', code: 'SOURCE_NOT_FOUND' }, 404); }

      const now = localNow();
      const updates: string[] = [];
      const params: any[] = [];

      if (is_enabled !== undefined) { updates.push('is_enabled = ?'); params.push(is_enabled ? 1 : 0); }
      if (poll_interval_seconds !== undefined) { updates.push('poll_interval_seconds = ?'); params.push(poll_interval_seconds); }
      if (extra_config !== undefined) { updates.push('extra_config = ?'); params.push(typeof extra_config === 'string' ? extra_config : JSON.stringify(extra_config)); }

      updates.push('updated_at = ?');
      params.push(now);
      params.push(key);

      await db.prepare(`UPDATE lead_scrape_sources SET ${updates.join(', ')} WHERE source_key = ?`).run(...params);

      const source = await db.prepare('SELECT * FROM lead_scrape_sources WHERE source_key = ?').get(key);
      return c.json(source);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Poll Now (Trigger Scraper) ──────────────────────────────
  api.post('/scrape-sources/:key/poll-now', requireRole('admin', 'manager'), async (c) => {
    return c.json({ message: 'Scraper polling not available in Workers runtime', stub: true });
  });

  // ── Scrape Log ──────────────────────────────────────────────
  api.get('/scrape-log', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { source_key } = q;
      const limit = Math.min(100000, Math.max(1, (parseInt(q.limit || '', 10)) || 100000));

      let sql = 'SELECT * FROM lead_scrape_log WHERE 1=1';
      const params: any[] = [];

      if (source_key) { sql += ' AND source_key = ?'; params.push(source_key); }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM leads', code: 'CRM_LEADS_ERROR' }, 500);
    }
  });

  // ── Lead Score Breakdown ────────────────────────────────────
  api.get('/leads/:id/score-breakdown', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const lead = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!lead) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      const activity = await db.prepare(
        'SELECT * FROM crm_lead_activity WHERE lead_id = ? ORDER BY created_at DESC'
      ).all(id) as any[];

      const emailEngagements = activity.filter((a: any) => a.activity_type === 'email').length;
      const callEngagements = activity.filter((a: any) => a.activity_type === 'call').length;
      const meetingEngagements = activity.filter((a: any) => a.activity_type === 'meeting').length;
      const webVisits = activity.filter((a: any) => a.activity_type === 'web_visit').length;
      const formFills = activity.filter((a: any) => a.activity_type === 'form_fill').length;

      const baseScore = lead.lead_score || 0;
      const engagementScore = Math.min(30,
        (emailEngagements * 3) + (callEngagements * 5) + (meetingEngagements * 10) + (webVisits * 2) + (formFills * 8)
      );

      const lastActivity = activity[0];
      let recencyBonus = 0;
      if (lastActivity) {
        const daysSinceLastActivity = (Date.now() - new Date(lastActivity.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLastActivity <= 7) recencyBonus = 15;
        else if (daysSinceLastActivity <= 14) recencyBonus = 10;
        else if (daysSinceLastActivity <= 30) recencyBonus = 5;
      }

      const totalScore = Math.min(100, baseScore + engagementScore + recencyBonus);

      await db.prepare('UPDATE crm_leads SET lead_score = ?, updated_at = ? WHERE id = ?')
        .run(totalScore, localNow(), id);

      return c.json({
        lead_id: lead.id,
        business_name: lead.business_name,
        base_score: baseScore,
        engagement_score: engagementScore,
        recency_bonus: recencyBonus,
        total_score: totalScore,
        breakdown: { emails: emailEngagements, calls: callEngagements, meetings: meetingEngagements, web_visits: webVisits, form_fills: formFills },
        last_activity: lastActivity?.created_at || null,
      });
    } catch {
      return c.json({ error: 'Failed to lead score breakdown', code: 'LEAD_SCORE_BREAKDOWN_ERROR' }, 500);
    }
  });

  // ── Pipeline Summary (detailed) ────────────────────────────
  api.get('/pipeline-summary', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const stages = await db.prepare(`
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
          WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'qualified' THEN 3
          WHEN 'proposal' THEN 4 WHEN 'negotiation' THEN 5 WHEN 'won' THEN 6
          WHEN 'lost' THEN 7 ELSE 8
        END
      `).all();

      const allLeads = await db.prepare('SELECT pipeline_stage FROM crm_leads').all() as any[];
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

      return c.json({ stages, conversions });
    } catch {
      return c.json({ error: 'Failed to pipeline summary', code: 'PIPELINE_SUMMARY_ERROR' }, 500);
    }
  });

  // ── Follow-up Set ──────────────────────────────────────────
  api.put('/leads/:id/follow-up', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { next_follow_up, follow_up_notes } = body;
      const now = localNow();
      const user = c.get('user');

      const existing = await db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' }, 404); }

      await db.prepare('UPDATE crm_leads SET next_follow_up = ?, updated_at = ? WHERE id = ?')
        .run(next_follow_up || null, now, id);

      await db.prepare(`
        INSERT INTO crm_lead_activity (lead_id, activity_type, subject, details, created_by, created_at)
        VALUES (?, 'follow_up_set', ?, ?, ?, ?)
      `).run(
        id,
        `Follow-up ${next_follow_up ? `set for ${next_follow_up}` : 'cleared'}`,
        follow_up_notes || null,
        user?.userId || null,
        now
      );

      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to set follow-up', code: 'SET_FOLLOWUP_ERROR' }, 500);
    }
  });

  // ── Revenue Forecast ───────────────────────────────────────
  api.get('/revenue-forecast', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const stageProbability: Record<string, number> = {
        new: 0.05, contacted: 0.10, qualified: 0.25, proposal: 0.50,
        negotiation: 0.75, won: 1.0, lost: 0, dismissed: 0,
      };

      const leads = await db.prepare(`
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
        return { ...l, probability: Math.round(probability * 100), expected_revenue: Math.round(expected * 100) / 100 };
      });

      const wonRevenue = ((await db.prepare(`
        SELECT COALESCE(SUM(estimated_value), 0) as total
        FROM crm_leads WHERE pipeline_stage = 'won' AND estimated_value IS NOT NULL
      `).get()) as any)?.total || 0;

      const byStage = await db.prepare(`
        SELECT pipeline_stage, COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as total_value
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

      return c.json({
        total_pipeline: Math.round(totalPipeline * 100) / 100,
        total_expected: Math.round(totalExpected * 100) / 100,
        won_revenue: wonRevenue,
        active_deals: leads.length,
        by_stage: stageBreakdown,
        deals: forecast.slice(0, 50),
      });
    } catch {
      return c.json({ error: 'Failed to revenue forecast', code: 'REVENUE_FORECAST_ERROR' }, 500);
    }
  });

  app.route('/api/crm', api);
}

function calculateLeadScoreSimple(leadData: any): number {
  let score = 0;
  if (leadData.business_name) score += 10;
  if (leadData.contact_email) score += 15;
  if (leadData.contact_phone) score += 10;
  if (leadData.address) score += 5;
  if (leadData.city) score += 5;
  if (leadData.state === 'UT') score += 10;
  if (leadData.estimated_value && leadData.estimated_value > 10000) score += 15;
  else if (leadData.estimated_value && leadData.estimated_value > 1000) score += 10;
  if (leadData.industry) score += 5;
  return Math.min(100, score);
}
