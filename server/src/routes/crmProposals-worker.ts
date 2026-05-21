import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow, localToday } from '../worker-middleware/d1Helpers';

async function generateProposalNumber(db: D1Db): Promise<string> {
  const year = parseInt(localToday().slice(0, 4), 10);
  const prefix = `PROP-${year}-`;

  const row = await db.prepare(
    "SELECT proposal_number FROM crm_proposals WHERE proposal_number LIKE ? ORDER BY proposal_number DESC LIMIT 1"
  ).get(`${prefix}%`) as { proposal_number: string } | undefined;

  let nextNum = 1;
  if (row) {
    const match = row.proposal_number.match(/PROP-\d{4}-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

export function mountCrmProposalsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ── List Proposals ──────────────────────────────────────────
  api.get('/proposals', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { stage, lead_id, client_id, date_from, date_to } = q;

      let sql = `
        SELECT p.*,
               l.business_name as lead_name,
               c.name as client_name,
               u1.full_name as created_by_name,
               u2.full_name as assigned_to_name
        FROM crm_proposals p
        LEFT JOIN crm_leads l ON l.id = p.lead_id
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN users u1 ON u1.id = p.created_by
        LEFT JOIN users u2 ON u2.id = p.assigned_to
        WHERE 1=1
      `;
      const params: any[] = [];

      if (stage) {
        const stages = stage.split(',').filter(Boolean);
        if (stages.length > 0) {
          sql += ` AND p.stage IN (${stages.map(() => '?').join(',')})`;
          params.push(...stages);
        }
      }
      if (lead_id) { sql += ' AND p.lead_id = ?'; params.push(lead_id); }
      if (client_id) { sql += ' AND p.client_id = ?'; params.push(client_id); }
      if (date_from) { sql += ' AND p.created_at >= ?'; params.push(date_from); }
      if (date_to) { sql += ' AND p.created_at <= ?'; params.push(date_to + ' 23:59:59'); }

      sql += ' ORDER BY p.created_at DESC';

      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  // ── Get Single Proposal ─────────────────────────────────────
  api.get('/proposals/:id', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const proposal = await db.prepare(`
        SELECT p.*,
               l.business_name as lead_name,
               c.name as client_name,
               u1.full_name as created_by_name,
               u2.full_name as assigned_to_name
        FROM crm_proposals p
        LEFT JOIN crm_leads l ON l.id = p.lead_id
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN users u1 ON u1.id = p.created_by
        LEFT JOIN users u2 ON u2.id = p.assigned_to
        WHERE p.id = ?
      `).get(id);

      if (!proposal) { return c.json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' }, 404); }

      return c.json(proposal);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  // ── Create Proposal ─────────────────────────────────────────
  api.post('/proposals', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const {
        lead_id, client_id, title, template_type, description,
        scope_of_work, terms, monthly_value, total_value,
        billing_frequency, valid_until, proposed_start, proposed_end,
        contract_length_months, assigned_to, notes,
      } = body;

      const validTitle = title && typeof title === 'string' && title.trim().length > 0 && title.length <= 300 ? title.trim() : null;
      if (!validTitle) { return c.json({ error: 'title is required', code: 'TITLE_IS_REQUIRED' }, 400); }

      const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual', 'one_time'] as const;

      const now = localNow();
      const user = c.get('user');

      const proposalNumber = await generateProposalNumber(db);

      let finalScope = scope_of_work || null;
      let finalTerms = terms || null;
      let finalMonthly: number | null = monthly_value != null ? Number(monthly_value) : null;
      if (finalMonthly != null && (isNaN(finalMonthly) || !isFinite(finalMonthly))) finalMonthly = null;
      let finalBilling = billing_frequency || 'monthly';
      let finalContractMonths: number | null = contract_length_months != null ? Number(contract_length_months) : null;
      if (finalContractMonths != null && (isNaN(finalContractMonths) || !isFinite(finalContractMonths))) finalContractMonths = null;

      if (template_type && !scope_of_work && !terms) {
        const template = await db.prepare(
          'SELECT * FROM crm_proposal_templates WHERE template_type = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
        ).get(template_type) as any;

        if (template) {
          finalScope = template.default_scope;
          finalTerms = template.default_terms;
          if (finalMonthly == null) finalMonthly = template.default_monthly_value;
          if (!billing_frequency) finalBilling = template.default_billing_frequency || 'monthly';
          if (finalContractMonths == null) finalContractMonths = template.default_contract_months;
        }
      }

      let finalTotal: number | null = total_value != null ? Number(total_value) : null;
      if (finalTotal != null && (isNaN(finalTotal) || !isFinite(finalTotal))) finalTotal = null;
      if (finalTotal == null && finalMonthly != null && finalContractMonths != null) {
        finalTotal = finalMonthly * finalContractMonths;
      }

      const result = await db.prepare(`
        INSERT INTO crm_proposals (
          proposal_number, lead_id, client_id, title, template_type, description,
          scope_of_work, terms, monthly_value, total_value,
          billing_frequency, valid_until, proposed_start, proposed_end,
          contract_length_months, stage, created_by, assigned_to, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
      `).run(
        proposalNumber,
        lead_id || null,
        client_id || null,
        validTitle,
        template_type || null,
        description || null,
        finalScope,
        finalTerms,
        finalMonthly,
        finalTotal,
        finalBilling,
        valid_until || null,
        proposed_start || null,
        proposed_end || null,
        finalContractMonths,
        user?.userId || null,
        assigned_to || null,
        notes || null,
        now, now,
      );

      const proposalId = Number(result.meta.last_row_id);

      if (lead_id) {
        await db.prepare('UPDATE crm_leads SET proposal_id = ?, updated_at = ? WHERE id = ?').run(proposalId, now, lead_id);
      }

      const proposal = await db.prepare(`
        SELECT p.*, l.business_name as lead_name, c.name as client_name
        FROM crm_proposals p
        LEFT JOIN crm_leads l ON l.id = p.lead_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ?
      `).get(proposalId);

      return c.json(proposal);
    } catch (err: any) {
      if (err?.message?.startsWith('Invalid ') || err?.message?.includes('must be')) {
        return c.json({ error: err.message }, 400);
      }
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  // ── Update Proposal ─────────────────────────────────────────
  api.put('/proposals/:id', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const existing = await db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' }, 404); }

      const now = localNow();
      const body = await c.req.json();
      const fields = [
        'title', 'lead_id', 'client_id', 'template_type', 'description',
        'scope_of_work', 'terms', 'monthly_value', 'total_value',
        'billing_frequency', 'valid_until', 'proposed_start', 'proposed_end',
        'contract_length_months', 'assigned_to', 'notes', 'pdf_path',
        'rejection_reason',
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

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      await db.prepare(`UPDATE crm_proposals SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const proposal = await db.prepare(`
        SELECT p.*, l.business_name as lead_name, c.name as client_name
        FROM crm_proposals p
        LEFT JOIN crm_leads l ON l.id = p.lead_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ?
      `).get(id);

      return c.json(proposal);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  // ── Delete Proposal ─────────────────────────────────────────
  api.delete('/proposals/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const existing = await db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' }, 404); }

      await db.prepare('UPDATE crm_leads SET proposal_id = NULL WHERE proposal_id = ?').run(id);
      await db.prepare('DELETE FROM crm_proposals WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  // ── Update Proposal Stage ───────────────────────────────────
  api.put('/proposals/:id/stage', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { stage, rejection_reason } = body;

      const existing = await db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' }, 404); }

      const validStages = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'];
      if (!stage || !validStages.includes(stage)) {
        return c.json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` }, 400);
      }

      const now = localNow();
      const updates: string[] = ['stage = ?', 'updated_at = ?'];
      const params: any[] = [stage, now];

      switch (stage) {
        case 'sent':
          if (!existing.sent_at) { updates.push('sent_at = ?'); params.push(now); }
          break;
        case 'viewed':
          if (!existing.viewed_at) { updates.push('viewed_at = ?'); params.push(now); }
          break;
        case 'accepted':
          updates.push('accepted_at = ?'); params.push(now);
          break;
        case 'rejected':
          updates.push('rejected_at = ?'); params.push(now);
          if (rejection_reason) { updates.push('rejection_reason = ?'); params.push(rejection_reason); }
          break;
      }

      params.push(id);
      await db.prepare(`UPDATE crm_proposals SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      if (stage === 'accepted' && existing.lead_id) {
        await db.prepare("UPDATE crm_leads SET pipeline_stage = 'won', updated_at = ? WHERE id = ? AND pipeline_stage != 'won'").run(now, existing.lead_id);
      }

      const proposal = await db.prepare(`
        SELECT p.*, l.business_name as lead_name, c.name as client_name
        FROM crm_proposals p
        LEFT JOIN crm_leads l ON l.id = p.lead_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ?
      `).get(id);

      return c.json(proposal);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  // ── Proposal Templates ──────────────────────────────────────
  api.get('/proposal-templates', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare('SELECT * FROM crm_proposal_templates WHERE is_active = 1 ORDER BY name').all();
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  api.post('/proposal-templates', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const {
        name, template_type, description, default_scope, default_terms,
        default_monthly_value, default_billing_frequency, default_contract_months,
      } = body;

      const validName = name && typeof name === 'string' && name.trim().length > 0 && name.length <= 200 ? name.trim() : null;
      const validTplType = template_type && typeof template_type === 'string' && template_type.length <= 100 ? template_type : null;
      if (!validName || !validTplType) { return c.json({ error: 'name and template_type are required', code: 'NAME_AND_TEMPLATETYPE_ARE' }, 400); }

      const now = localNow();
      const user = c.get('user');
      const result = await db.prepare(`
        INSERT INTO crm_proposal_templates (
          name, template_type, description, default_scope, default_terms,
          default_monthly_value, default_billing_frequency, default_contract_months,
          is_active, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        validName, validTplType, description || null,
        default_scope || null, default_terms || null,
        default_monthly_value ?? null, default_billing_frequency || 'monthly',
        default_contract_months ?? 12,
        user?.userId || null, now, now,
      );

      const templateId = Number(result.meta.last_row_id);
      const template = await db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(templateId);
      return c.json(template);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  api.put('/proposal-templates/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const existing = await db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }, 404); }

      const now = localNow();
      const body = await c.req.json();
      const fields = [
        'name', 'template_type', 'description', 'default_scope', 'default_terms',
        'default_monthly_value', 'default_billing_frequency', 'default_contract_months',
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

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      await db.prepare(`UPDATE crm_proposal_templates SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const template = await db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id);
      return c.json(template);
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  api.delete('/proposal-templates/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));

      const existing = await db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }, 404); }

      const now = localNow();
      await db.prepare('UPDATE crm_proposal_templates SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to process CRM proposals', code: 'CRM_PROPOSALS_ERROR' }, 500);
    }
  });

  app.route('/api/crm', api);
}
