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
import { validateParamId } from '../middleware/sanitize';
import { localNow, localToday } from '../utils/timeUtils';

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
      const stages = (stage as string).split(',');
      sql += ` AND p.stage IN (${stages.map(() => '?').join(',')})`;
      params.push(...stages);
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get Single Proposal ─────────────────────────────────────
router.get('/proposals/:id', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
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
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
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

    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const now = localNow();

    // Use a transaction to atomically generate the proposal number + insert
    const createProposal = db.transaction(() => {
      const proposalNumber = generateProposalNumber(db);

      // If template_type provided and no scope/terms, populate from template
      let finalScope = scope_of_work || null;
      let finalTerms = terms || null;
      let finalMonthly: number | null = monthly_value != null ? Number(monthly_value) : null;
      let finalBilling = billing_frequency || 'monthly';
      let finalContractMonths: number | null = contract_length_months != null ? Number(contract_length_months) : null;

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

      auditLog(req, 'CREATE', 'crm_proposals' as any, proposalId, `Created proposal ${proposalNumber}: ${title.trim()}`);

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
    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update Proposal ─────────────────────────────────────────
router.put('/proposals/:id', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found' });
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
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE crm_proposals SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE', 'crm_proposals' as any, String(id), `Updated proposal ${existing.proposal_number}`);

    const proposal = db.prepare(`
      SELECT p.*, l.business_name as lead_name, c.name as client_name
      FROM crm_proposals p
      LEFT JOIN crm_leads l ON l.id = p.lead_id
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ?
    `).get(id);

    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete Proposal ─────────────────────────────────────────
router.delete('/proposals/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    // Clear proposal_id on any linked leads
    db.prepare('UPDATE crm_leads SET proposal_id = NULL WHERE proposal_id = ?').run(id);

    db.prepare('DELETE FROM crm_proposals WHERE id = ?').run(id);
    auditLog(req, 'DELETE', 'crm_proposals' as any, String(id), `Deleted proposal ${existing.proposal_number}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update Proposal Stage ───────────────────────────────────
router.put('/proposals/:id/stage', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { stage, rejection_reason } = req.body;

    const existing = db.prepare('SELECT * FROM crm_proposals WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Proposal not found' });
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

    auditLog(req, 'UPDATE', 'crm_proposals' as any, String(id),
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

    res.json(proposal);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/proposal-templates', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      name, template_type, description, default_scope, default_terms,
      default_monthly_value, default_billing_frequency, default_contract_months,
    } = req.body;

    if (!name?.trim() || !template_type?.trim()) {
      res.status(400).json({ error: 'name and template_type are required' });
      return;
    }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO crm_proposal_templates (
        name, template_type, description, default_scope, default_terms,
        default_monthly_value, default_billing_frequency, default_contract_months,
        is_active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      name.trim(), template_type.trim(), description || null,
      default_scope || null, default_terms || null,
      default_monthly_value ?? null, default_billing_frequency || 'monthly',
      default_contract_months ?? 12,
      req.user?.userId || null, now, now,
    );

    const templateId = Number(result.lastInsertRowid);
    auditLog(req, 'CREATE', 'crm_proposals' as any, templateId, `Created proposal template: ${name.trim()}`);

    const template = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(templateId);
    res.json(template);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/proposal-templates/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
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
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE crm_proposal_templates SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'UPDATE', 'crm_proposals' as any, String(id), `Updated proposal template: ${existing.name}`);

    const template = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id);
    res.json(template);
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/proposal-templates/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM crm_proposal_templates WHERE id = ?').get(id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    // Soft delete
    const now = localNow();
    db.prepare('UPDATE crm_proposal_templates SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
    auditLog(req, 'DELETE', 'crm_proposals' as any, String(id), `Soft-deleted proposal template: ${existing.name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('CRM proposals error:', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
