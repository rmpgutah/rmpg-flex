// ============================================================
// CRM Proposals API Routes
// ============================================================
// Proposal management for the Overwatch CRM: create, update,
// stage transitions, and template management for security
// service proposals.
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { validateParamId, validateParamIdMiddleware, validateStr, validateEnum, requireInt, requireFloat, validateDateStr } from '../middleware/sanitize';
import { localNow, localToday } from '../utils/timeUtils';
import { broadcast } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticate);

// ── Helper: Generate proposal number (called inside a transaction) ──
function generateProposalNumber(db: ReturnType<typeof getDb>): string {
  const year = parseInt(localToday().slice(0, 4), 10);
  const prefix = `PROP-${year}-`;

  const row = db.prepare(
    "SELECT proposal_number FROM crm_proposals WHERE proposal_number LIKE ? ORDER BY proposal_number DESC LIMIT 1"
  ).get(`${prefix}%`) as { proposal_number: string } | undefined;

  let nextNum = 1;
  if (row) {
    const match = row.proposal_number.match(/PROP-\d{4}-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ── List Proposals ──────────────────────────────────────────
router.get('/proposals', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { stage, lead_id, client_id, date_from, date_to } = req.query;

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
      const stages = (stage as string).split(',').filter(Boolean);
      if (stages.length > 0) {
        sql += ` AND p.stage IN (${stages.map(() => '?').join(',')})`;
        params.push(...stages);
      }
    }
    if (lead_id) {
      sql += ' AND p.lead_id = ?';
      params.push(lead_id);
    }
    if (client_id) {
      sql += ' AND p.client_id = ?';
      params.push(client_id);
    }
    if (date_from) {
      sql += ' AND p.created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      sql += ' AND p.created_at <= ?';
      params.push(date_to + ' 23:59:59');
    }

    sql += ' ORDER BY p.created_at DESC';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ── Get Single Proposal ─────────────────────────────────────
router.get('/proposals/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const proposal = db.prepare(`
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

    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' });
      return;
    }

    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ── Create Proposal ─────────────────────────────────────────
router.post('/proposals', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      lead_id, client_id, title, template_type, description,
      scope_of_work, terms, monthly_value, total_value,
      billing_frequency, valid_until, proposed_start, proposed_end,
      contract_length_months, assigned_to, notes,
    } = req.body;

    // ── Validate proposal inputs ──
    const validTitle = validateStr(title, 'title', 300);
    if (!validTitle) {
      res.status(400).json({ error: 'title is required', code: 'TITLE_IS_REQUIRED' });
      return;
    }
    const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'semi_annual', 'annual', 'one_time'] as const;
    if (lead_id) requireInt(lead_id, 'lead_id');
    if (client_id) requireInt(client_id, 'client_id');
    if (assigned_to) requireInt(assigned_to, 'assigned_to');
    if (monthly_value != null) requireFloat(monthly_value, 'monthly_value', 0, 100_000_000);
    if (total_value != null) requireFloat(total_value, 'total_value', 0, 100_000_000);
    if (contract_length_months != null) requireInt(contract_length_months, 'contract_length_months');
    if (billing_frequency) validateEnum(billing_frequency, BILLING_FREQUENCIES, 'billing_frequency');
    if (valid_until) validateDateStr(valid_until, 'valid_until');
    if (proposed_start) validateDateStr(proposed_start, 'proposed_start');
    if (proposed_end) validateDateStr(proposed_end, 'proposed_end');
    validateStr(template_type, 'template_type', 100);
    validateStr(description, 'description', 5000);

    const now = localNow();

    // Use a transaction to atomically generate the proposal number + insert
    const createProposal = db.transaction(() => {
      const proposalNumber = generateProposalNumber(db);

      // If template_type provided and no scope/terms, populate from template
      let finalScope = scope_of_work || null;
      let finalTerms = terms || null;
      let finalMonthly: number | null = monthly_value != null ? Number(monthly_value) : null;
      if (finalMonthly != null && (isNaN(finalMonthly) || !isFinite(finalMonthly))) finalMonthly = null;
      let finalBilling = billing_frequency || 'monthly';
      let finalContractMonths: number | null = contract_length_months != null ? Number(contract_length_months) : null;
      if (finalContractMonths != null && (isNaN(finalContractMonths) || !isFinite(finalContractMonths))) finalContractMonths = null;

      if (template_type && !scope_of_work && !terms) {
        const template = db.prepare(
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

      // Calculate total_value if not provided — guard against null multiplication
      let finalTotal: number | null = total_value != null ? Number(total_value) : null;
      if (finalTotal != null && (isNaN(finalTotal) || !isFinite(finalTotal))) finalTotal = null;
      if (finalTotal == null && finalMonthly != null && finalContractMonths != null) {
        finalTotal = finalMonthly * finalContractMonths;
      }

      const result = db.prepare(`
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
        title.trim(),
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
        req.user?.userId || null,
        assigned_to || null,
        notes || null,
        now, now,
      );

      const proposalId = Number(result.lastInsertRowid);

      // Update lead's proposal_id if linked
      if (lead_id) {
        db.prepare('UPDATE crm_leads SET proposal_id = ?, updated_at = ? WHERE id = ?').run(proposalId, now, lead_id);
      }

      auditLog(req, 'CREATE', 'crm_proposals', proposalId, `Created proposal ${proposalNumber}: ${title.trim()}`);

      const proposal = db.prepare(`
        SELECT p.*, l.business_name as lead_name, c.name as client_name
        FROM crm_proposals p
        LEFT JOIN crm_leads l ON l.id = p.lead_id
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.id = ?
      `).get(proposalId);

      return proposal;
    });

    const proposal = createProposal();
    broadcast('admin', 'proposal:created', proposal);
    res.json(proposal);
  } catch (err: any) {
    if (err.message?.startsWith('Invalid ') || err.message?.includes('must be')) {
      res.status(400).json({ error: err.message }); return;
    }
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ── Update Proposal ─────────────────────────────────────────
router.put('/proposals/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' });
      return;
    }

    const now = localNow();
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
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field] === '' ? null : req.body[field]);
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE crm_proposals SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE', 'crm_proposals', String(id), `Updated proposal ${existing.proposal_number}`);

    const proposal = db.prepare(`
      SELECT p.*, l.business_name as lead_name, c.name as client_name
      FROM crm_proposals p
      LEFT JOIN crm_leads l ON l.id = p.lead_id
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?
    `).get(id);

    broadcast('admin', 'proposal:updated', proposal);
    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ── Delete Proposal ─────────────────────────────────────────
router.delete('/proposals/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' });
      return;
    }

    // Clear proposal_id on any linked leads
    db.prepare('UPDATE crm_leads SET proposal_id = NULL WHERE proposal_id = ?').run(id);

    db.prepare('DELETE FROM crm_proposals WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'crm_proposals', String(id), `Deleted proposal ${existing.proposal_number}`);
    broadcast('admin', 'proposal:deleted', { id: Number(id) });
    res.json({ success: true });
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ── Update Proposal Stage ───────────────────────────────────
router.put('/proposals/:id/stage', validateParamIdMiddleware, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { stage, rejection_reason } = req.body;

    const existing = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found', code: 'PROPOSAL_NOT_FOUND' });
      return;
    }

    const validStages = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'];
    if (!stage || !validStages.includes(stage)) {
      res.status(400).json({ error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
      return;
    }

    const now = localNow();
    const updates: string[] = ['stage = ?', 'updated_at = ?'];
    const params: any[] = [stage, now];

    // Set timestamp fields based on stage transition
    switch (stage) {
      case 'sent':
        if (!existing.sent_at) {
          updates.push('sent_at = ?');
          params.push(now);
        }
        break;
      case 'viewed':
        if (!existing.viewed_at) {
          updates.push('viewed_at = ?');
          params.push(now);
        }
        break;
      case 'accepted':
        updates.push('accepted_at = ?');
        params.push(now);
        break;
      case 'rejected':
        updates.push('rejected_at = ?');
        params.push(now);
        if (rejection_reason) {
          updates.push('rejection_reason = ?');
          params.push(rejection_reason);
        }
        break;
    }

    params.push(id);
    db.prepare(`UPDATE crm_proposals SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'UPDATE', 'crm_proposals', String(id),
      `Proposal ${existing.proposal_number} stage: ${existing.stage} → ${stage}`);

    // If accepted and linked to a lead, update lead stage
    if (stage === 'accepted' && existing.lead_id) {
      db.prepare("UPDATE crm_leads SET pipeline_stage = 'won', updated_at = ? WHERE id = ? AND pipeline_stage != 'won'").run(now, existing.lead_id);
    }

    const proposal = db.prepare(`
      SELECT p.*, l.business_name as lead_name, c.name as client_name
      FROM crm_proposals p
      LEFT JOIN crm_leads l ON l.id = p.lead_id
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?
    `).get(id);

    broadcast('admin', 'proposal:updated', proposal);
    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ── Proposal Templates ──────────────────────────────────────
router.get('/proposal-templates', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM crm_proposal_templates WHERE is_active = 1 ORDER BY name').all();
    res.json(rows);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

router.post('/proposal-templates', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      name, template_type, description, default_scope, default_terms,
      default_monthly_value, default_billing_frequency, default_contract_months,
    } = req.body;

    // ── Validate template inputs ──
    const validName = validateStr(name, 'name', 200);
    const validTplType = validateStr(template_type, 'template_type', 100);
    if (!validName || !validTplType) {
      res.status(400).json({ error: 'name and template_type are required', code: 'NAME_AND_TEMPLATETYPE_ARE' });
      return;
    }
    if (default_monthly_value != null) requireFloat(default_monthly_value, 'default_monthly_value', 0, 100_000_000);
    if (default_contract_months != null) requireInt(default_contract_months, 'default_contract_months');
    const TMPL_BILLING = ['monthly', 'quarterly', 'semi_annual', 'annual', 'one_time'] as const;
    if (default_billing_frequency) validateEnum(default_billing_frequency, TMPL_BILLING, 'default_billing_frequency');

    const now = localNow();
    const result = db.prepare(`
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
      req.user?.userId || null, now, now,
    );

    const templateId = Number(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'crm_proposals', templateId, `Created proposal template: ${name.trim()}`);

    const template = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(templateId);
    res.json(template);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

router.put('/proposal-templates/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
      return;
    }

    const now = localNow();
    const fields = [
      'name', 'template_type', 'description', 'default_scope', 'default_terms',
      'default_monthly_value', 'default_billing_frequency', 'default_contract_months',
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

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE crm_proposal_templates SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE', 'crm_proposals', String(id), `Updated proposal template: ${existing.name}`);

    const template = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id);
    res.json(template);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

router.delete('/proposal-templates/:id', validateParamIdMiddleware, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' });
      return;
    }

    // Soft delete
    const now = localNow();
    db.prepare('UPDATE crm_proposal_templates SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
    auditLog(req, 'DELETE', 'crm_proposals', String(id), `Soft-deleted proposal template: ${existing.name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Failed to crm proposals', code: 'CRM_PROPOSALS_ERROR' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/crm/proposals/export/csv — Export proposals
router.get('/proposals/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.id, p.proposal_number, p.title, p.stage, p.template_type,
        p.monthly_value, p.total_value, p.billing_frequency,
        p.contract_length_months, p.valid_until,
        p.proposed_start, p.proposed_end,
        p.sent_at, p.viewed_at, p.accepted_at, p.rejected_at,
        p.created_at, p.updated_at,
        l.business_name as lead_name,
        c.name as client_name,
        u1.full_name as created_by_name,
        u2.full_name as assigned_to_name
      FROM crm_proposals p
      LEFT JOIN crm_leads l ON l.id = p.lead_id
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN users u1 ON u1.id = p.created_by
      LEFT JOIN users u2 ON u2.id = p.assigned_to
      ORDER BY p.created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'crm_proposals_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'proposal_number', header: 'Proposal Number' },
      { key: 'title', header: 'Title' },
      { key: 'stage', header: 'Stage' },
      { key: 'template_type', header: 'Template Type' },
      { key: 'lead_name', header: 'Lead' },
      { key: 'client_name', header: 'Client' },
      { key: 'monthly_value', header: 'Monthly Value' },
      { key: 'total_value', header: 'Total Value' },
      { key: 'billing_frequency', header: 'Billing Frequency' },
      { key: 'contract_length_months', header: 'Contract Months' },
      { key: 'valid_until', header: 'Valid Until' },
      { key: 'proposed_start', header: 'Proposed Start' },
      { key: 'proposed_end', header: 'Proposed End' },
      { key: 'assigned_to_name', header: 'Assigned To' },
      { key: 'created_by_name', header: 'Created By' },
      { key: 'sent_at', header: 'Sent At' },
      { key: 'accepted_at', header: 'Accepted At' },
      { key: 'rejected_at', header: 'Rejected At' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

export default router;
