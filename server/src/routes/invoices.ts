// ============================================================
// RMPG Flex — Invoice Management API Routes
// ============================================================
// Full CRUD for invoices, line items, payments.
// Auto-generates invoice numbers in INV-YYYY-NNNN format.
// Supports auto-generation of line items from billing period.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow, localToday } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── Helper: Generate next invoice number ─────────────────
function generateInvoiceNumber(): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = db.prepare(
    "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}%`) as any;
  let seq = 1;
  if (last) {
    const parts = last.invoice_number.split('-');
    const parsed = parseInt(parts[2], 10);
    seq = (isNaN(parsed) ? 0 : parsed) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── Helper: Parse payment terms to days ──────────────────
function parsePaymentTermsDays(terms?: string): number {
  if (!terms) return 30;
  const match = terms.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 30;
}

// ─── Helper: Add days to a date string ────────────────────
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ─── Helper: Recalculate invoice totals ───────────────────
function recalculateInvoiceTotals(invoiceId: number | string | string[]): void {
  const db = getDb();
  const now = localNow();

  // Sum line items by type
  const items = db.prepare(`
    SELECT line_type, COALESCE(SUM(amount), 0) as total
    FROM invoice_line_items WHERE invoice_id = ?
    GROUP BY line_type
  `).all(invoiceId) as any[];

  let subtotal = 0;
  let discountAmount = 0;
  let lateFeeAmount = 0;
  for (const item of items) {
    if (item.line_type === 'discount') {
      discountAmount = Math.abs(item.total);
    } else if (item.line_type === 'late_fee') {
      lateFeeAmount = item.total;
    } else {
      subtotal += item.total;
    }
  }

  const total = subtotal - discountAmount + lateFeeAmount;

  // Sum payments
  const payResult = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?'
  ).get(invoiceId) as any;
  const amountPaid = payResult.paid;
  const balanceDue = Math.max(0, total - amountPaid);

  db.prepare(`
    UPDATE invoices
    SET subtotal = ?, discount_amount = ?, late_fee_amount = ?,
        total = ?, amount_paid = ?, balance_due = ?, updated_at = ?
    WHERE id = ?
  `).run(subtotal, discountAmount, lateFeeAmount, total, amountPaid, balanceDue, now, invoiceId);

  // Update client aggregates
  const inv = db.prepare('SELECT client_id FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (inv) {
    const agg = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total_invoiced,
             COALESCE(SUM(amount_paid), 0) as total_paid,
             COALESCE(SUM(balance_due), 0) as outstanding
      FROM invoices WHERE client_id = ? AND status NOT IN ('void','cancelled')
    `).get(inv.client_id) as any;
    db.prepare(`
      UPDATE clients SET total_invoiced = ?, total_paid = ?, outstanding_balance = ?, updated_at = ?
      WHERE id = ?
    `).run(agg.total_invoiced, agg.total_paid, agg.outstanding, now, inv.client_id);
  }
}

// ─── GET /api/invoices/stats ──────────────────────────────
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { client_id } = req.query;
    const clientFilter = client_id ? ' AND client_id = ?' : '';
    const params = client_id ? [client_id] : [];

    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM invoices
      WHERE status NOT IN ('void','cancelled') ${clientFilter}
      GROUP BY status
    `).all(...params) as any[];

    const statusMap: Record<string, number> = {};
    let totalInvoices = 0;
    for (const row of statusCounts) {
      statusMap[row.status] = row.count;
      totalInvoices += row.count;
    }

    const outstanding = db.prepare(`
      SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices
      WHERE status IN ('sent','partial','overdue') ${clientFilter}
    `).get(...params) as any;

    const collected = db.prepare(`
      SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices
      WHERE status NOT IN ('void','cancelled') ${clientFilter}
    `).get(...params) as any;

    res.json({
      data: {
        total_invoices: totalInvoices,
        total_outstanding: outstanding.total,
        total_collected: collected.total,
        overdue_count: statusMap['overdue'] || 0,
        draft_count: statusMap['draft'] || 0,
        by_status: statusMap,
      },
    });
  } catch (error: any) {
    console.error('Invoice stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/invoices ────────────────────────────────────
// List invoices with pagination and filters
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    if (req.query.status) {
      conditions.push('i.status = ?');
      params.push(req.query.status);
    }
    if (req.query.client_id) {
      conditions.push('i.client_id = ?');
      params.push(req.query.client_id);
    }
    if (req.query.date_from) {
      conditions.push('i.issue_date >= ?');
      params.push(req.query.date_from);
    }
    if (req.query.date_to) {
      conditions.push('i.issue_date <= ?');
      params.push(req.query.date_to);
    }
    if (req.query.q) {
      const q = `%${req.query.q}%`;
      conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR i.notes LIKE ?)');
      params.push(q, q, q);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      ${where}
    `).get(...params) as any;

    const rows = db.prepare(`
      SELECT i.*, c.name as client_name, u.full_name as created_by_name,
             (SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id = i.id) as line_item_count,
             (SELECT COUNT(*) FROM payments WHERE invoice_id = i.id) as payment_count
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN users u ON i.created_by = u.id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
      },
    });
  } catch (error: any) {
    console.error('Invoice list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/invoices/:id ────────────────────────────────
// Full invoice detail with line items and payments
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const invoice = db.prepare(`
      SELECT i.*, c.name as client_name, u.full_name as created_by_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.id = ?
    `).get(req.params.id) as any;

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const line_items = db.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id'
    ).all(req.params.id);

    const payments = db.prepare(`
      SELECT p.*, u.full_name as recorded_by_name
      FROM payments p
      LEFT JOIN users u ON p.recorded_by = u.id
      WHERE p.invoice_id = ?
      ORDER BY p.payment_date DESC
    `).all(req.params.id);

    res.json({ data: { ...invoice, line_items, payments } });
  } catch (error: any) {
    console.error('Invoice detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/invoices ───────────────────────────────────
// Create a new invoice
router.post('/', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const { client_id, period_start, period_end, issue_date, notes, internal_notes } = req.body;

    if (!client_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'client_id, period_start, and period_end are required' });
    }

    // Get client for billing snapshot
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id) as any;
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const invoice_number = generateInvoiceNumber();
    const issueDt = issue_date || localToday();
    const days = parsePaymentTermsDays(client.payment_terms);
    const due_date = addDays(issueDt, days);

    const result = db.prepare(`
      INSERT INTO invoices (
        invoice_number, client_id, status, period_start, period_end,
        issue_date, due_date, payment_terms, billing_email, billing_address,
        notes, internal_notes, created_by, created_at, updated_at
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice_number, client_id, period_start, period_end,
      issueDt, due_date, client.payment_terms || 'Net 30',
      client.billing_email || client.contact_email || '',
      client.billing_address || client.address || '',
      notes || '', internal_notes || '', user.userId, now, now
    );

    // Activity log
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'invoice_created', 'invoice', result.lastInsertRowid, `Created invoice ${invoice_number} for client ${client.name}`, req.ip || 'unknown', now);

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: invoice });
  } catch (error: any) {
    console.error('Invoice create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/invoices/:id/generate ──────────────────────
// Auto-generate line items from billing period
router.post('/:id/generate', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: 'Can only generate line items for draft invoices' });
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id) as any;
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const properties = db.prepare('SELECT id, name FROM properties WHERE client_id = ?').all(invoice.client_id) as any[];
    const propertyIds = properties.map((p: any) => p.id);

    // Use a transaction for atomicity
    const generateTx = db.transaction(() => {
      // Clear existing auto-generated items (keep custom ones)
      db.prepare(
        "DELETE FROM invoice_line_items WHERE invoice_id = ? AND line_type != 'custom'"
      ).run(invoice.id);

      const insertItem = db.prepare(`
        INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_price, amount, linked_entity_type, linked_entity_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let sortOrder = 0;
      const items: any[] = [];

      // 1. Contract base rate
      if (client.contract_value && client.contract_value > 0) {
        const desc = `Contract base rate — ${client.billing_cycle || 'monthly'} (${invoice.period_start} to ${invoice.period_end})`;
        insertItem.run(invoice.id, 'contract_base', desc, 1, client.contract_value, client.contract_value, null, null, sortOrder++, now);
        items.push({ type: 'contract_base', amount: client.contract_value });
      }

      // 2. Service hours from time_entries + schedules
      if (propertyIds.length > 0) {
        const propPlaceholders = propertyIds.map(() => '?').join(',');
        const hours = db.prepare(`
          SELECT te.id, te.total_hours, te.clock_in,
                 u.full_name as officer_name, s.property_id, p.name as property_name
          FROM time_entries te
          LEFT JOIN schedules s ON te.schedule_id = s.id
          LEFT JOIN users u ON te.officer_id = u.id
          LEFT JOIN properties p ON s.property_id = p.id
          WHERE s.property_id IN (${propPlaceholders})
            AND te.clock_in >= ? AND te.clock_in <= ?
            AND te.status = 'completed'
          ORDER BY te.clock_in
        `).all(...propertyIds, invoice.period_start, invoice.period_end + 'T23:59:59') as any[];

        const rate = client.rate_per_hour || 0;
        for (const h of hours) {
          const hrs = h.total_hours || 0;
          const amt = Math.round(hrs * rate * 100) / 100;
          const desc = `Service hours — ${h.officer_name || 'Officer'} at ${h.property_name || 'Property'} (${String(h.clock_in).substring(0, 10)}) — ${hrs.toFixed(2)} hrs`;
          insertItem.run(invoice.id, 'service_hours', desc, hrs, rate, amt, 'time_entry', h.id, sortOrder++, now);
          items.push({ type: 'service_hours', amount: amt });
        }
      }

      // 3. CFS calls in period
      {
        const conditions: string[] = [];
        const cfsParams: any[] = [];
        if (propertyIds.length > 0) {
          const propPlaceholders = propertyIds.map(() => '?').join(',');
          conditions.push(`(c.client_id = ? OR c.property_id IN (${propPlaceholders}))`);
          cfsParams.push(invoice.client_id, ...propertyIds);
        } else {
          conditions.push('c.client_id = ?');
          cfsParams.push(invoice.client_id);
        }
        conditions.push("c.created_at >= ?");
        conditions.push("c.created_at <= ?");
        conditions.push("c.status != 'cancelled'");
        cfsParams.push(invoice.period_start, invoice.period_end + 'T23:59:59');

        const calls = db.prepare(`
          SELECT c.id, c.call_number, c.incident_type, c.created_at, c.location_address
          FROM calls_for_service c
          WHERE ${conditions.join(' AND ')}
          ORDER BY c.created_at
        `).all(...cfsParams) as any[];

        const rate = client.rate_per_cfs || 0;
        for (const call of calls) {
          const desc = `Dispatch call ${call.call_number} — ${call.incident_type} at ${call.location_address || 'Unknown'} (${String(call.created_at).substring(0, 10)})`;
          insertItem.run(invoice.id, 'dispatch_call', desc, 1, rate, rate, 'call_for_service', call.id, sortOrder++, now);
          items.push({ type: 'dispatch_call', amount: rate });
        }
      }

      // 4. Incidents in period (with linked person details for traceability)
      {
        const conditions: string[] = [];
        const incParams: any[] = [];
        if (propertyIds.length > 0) {
          const propPlaceholders = propertyIds.map(() => '?').join(',');
          conditions.push(`(inc.client_id = ? OR inc.property_id IN (${propPlaceholders}))`);
          incParams.push(invoice.client_id, ...propertyIds);
        } else {
          conditions.push('inc.client_id = ?');
          incParams.push(invoice.client_id);
        }
        conditions.push("inc.created_at >= ?");
        conditions.push("inc.created_at <= ?");
        incParams.push(invoice.period_start, invoice.period_end + 'T23:59:59');

        const incidents = db.prepare(`
          SELECT inc.id, inc.incident_number, inc.incident_type, inc.created_at, inc.location_address
          FROM incidents inc
          WHERE ${conditions.join(' AND ')}
          ORDER BY inc.created_at
        `).all(...incParams) as any[];

        const rate = client.rate_per_incident || 0;
        for (const inc of incidents) {
          // Fetch linked persons for this incident to enhance description
          let personInfo = '';
          try {
            const linkedPersons = db.prepare(`
              SELECT p.first_name, p.last_name, ip.role
              FROM incident_persons ip
              JOIN persons p ON ip.person_id = p.id
              WHERE ip.incident_id = ?
              ORDER BY
                CASE ip.role WHEN 'suspect' THEN 1 WHEN 'victim' THEN 2 WHEN 'reporting_party' THEN 3 ELSE 4 END
              LIMIT 3
            `).all(inc.id) as any[];
            if (linkedPersons.length > 0) {
              personInfo = ' | Persons: ' + linkedPersons.map((lp: any) =>
                `${lp.first_name} ${lp.last_name} (${lp.role})`
              ).join(', ');
            }
          } catch { /* ignore if table doesn't exist */ }

          const desc = `Incident response ${inc.incident_number || '#' + inc.id} — ${inc.incident_type} (${String(inc.created_at).substring(0, 10)})${personInfo}`;
          insertItem.run(invoice.id, 'incident_response', desc, 1, rate, rate, 'incident', inc.id, sortOrder++, now);
          items.push({ type: 'incident_response', amount: rate });
        }
      }

      // 5. Citations linked to client calls/incidents
      // (citations have call_id and incident_id — find those linked to this client)
      {
        const linkedCallIds = db.prepare(`
          SELECT id FROM invoice_line_items
          WHERE invoice_id = ? AND linked_entity_type = 'call_for_service'
        `).all(invoice.id).map((r: any) => r.linked_entity_id || 0);

        const linkedIncIds = db.prepare(`
          SELECT id FROM invoice_line_items
          WHERE invoice_id = ? AND linked_entity_type = 'incident'
        `).all(invoice.id).map((r: any) => r.linked_entity_id || 0);

        if (linkedCallIds.length > 0 || linkedIncIds.length > 0) {
          const citConditions: string[] = [];
          const citParams: any[] = [];
          if (linkedCallIds.length > 0) {
            citConditions.push(`cit.call_id IN (${linkedCallIds.map(() => '?').join(',')})`);
            citParams.push(...linkedCallIds);
          }
          if (linkedIncIds.length > 0) {
            citConditions.push(`cit.incident_id IN (${linkedIncIds.map(() => '?').join(',')})`);
            citParams.push(...linkedIncIds);
          }

          const citations = db.prepare(`
            SELECT cit.id, cit.citation_number, cit.violation_description, cit.fine_amount
            FROM citations cit
            WHERE (${citConditions.join(' OR ')})
              AND cit.status != 'voided'
          `).all(...citParams) as any[];

          for (const cit of citations) {
            const amt = cit.fine_amount || 0;
            const desc = `Citation ${cit.citation_number} — ${cit.violation_description || 'Violation'}`;
            insertItem.run(invoice.id, 'citation', desc, 1, amt, amt, 'citation', cit.id, sortOrder++, now);
            items.push({ type: 'citation', amount: amt });
          }
        }
      }

      // 6. Apply discount
      if (client.discount_percent && client.discount_percent > 0) {
        // Calculate subtotal of non-discount items so far
        const sub = items.reduce((s, i) => s + (i.amount || 0), 0);
        const discountAmt = -Math.round(sub * client.discount_percent / 100 * 100) / 100;
        const desc = `Client discount (${client.discount_percent}%)`;
        insertItem.run(invoice.id, 'discount', desc, 1, discountAmt, discountAmt, null, null, sortOrder++, now);
      }

      return items.length;
    });

    const count = generateTx();
    recalculateInvoiceTotals(invoice.id);

    // Return updated invoice with items
    const updated = db.prepare(`
      SELECT i.*, c.name as client_name
      FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.id = ?
    `).get(invoice.id) as any;
    const line_items = db.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id'
    ).all(invoice.id);

    res.json({ data: { ...updated, line_items }, generated: count });
  } catch (error: any) {
    console.error('Invoice generate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/invoices/:id ────────────────────────────────
// Update invoice fields
router.put('/:id', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const fieldMap: Record<string, string> = {
      period_start: 'period_start',
      period_end: 'period_end',
      issue_date: 'issue_date',
      due_date: 'due_date',
      payment_terms: 'payment_terms',
      billing_email: 'billing_email',
      billing_address: 'billing_address',
      notes: 'notes',
      internal_notes: 'internal_notes',
      tax_amount: 'tax_amount',
      late_fee_amount: 'late_fee_amount',
    };

    const updates: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        updates.push(`${dbCol} = ?`);
        values.push(req.body[bodyKey]);
      }
    }

    values.push(req.params.id);
    db.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Recalculate if amounts changed
    if (req.body.tax_amount !== undefined || req.body.late_fee_amount !== undefined) {
      recalculateInvoiceTotals(req.params.id);
    }

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'invoice_updated', 'invoice', req.params.id, `Updated invoice ${invoice.invoice_number}`, req.ip || 'unknown', now);

    const updated = db.prepare(`
      SELECT i.*, c.name as client_name FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?
    `).get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Invoice update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/invoices/:id/status ─────────────────────────
// Status transition with validation
router.put('/:id/status', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const { status } = req.body;

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Validate transitions
    const allowed: Record<string, string[]> = {
      draft: ['sent', 'void', 'cancelled'],
      sent: ['paid', 'partial', 'overdue', 'void', 'cancelled'],
      partial: ['paid', 'void'],
      overdue: ['paid', 'partial', 'void', 'cancelled'],
    };

    const validTransitions = allowed[invoice.status] || [];
    if (!validTransitions.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from '${invoice.status}' to '${status}'. Valid: ${validTransitions.join(', ')}`,
      });
    }

    const updates: string[] = ['status = ?', 'updated_at = ?'];
    const values: any[] = [status, now];

    if (status === 'sent' && !invoice.sent_at) {
      updates.push('sent_at = ?');
      values.push(now);
    }
    if (status === 'paid') {
      updates.push('paid_date = ?');
      values.push(localToday());
    }
    if (status === 'void') {
      updates.push('voided_at = ?', 'voided_by = ?');
      values.push(now, user.userId);
    }

    values.push(req.params.id);
    db.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Recalculate client aggregates
    recalculateInvoiceTotals(req.params.id);

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'invoice_status_changed', 'invoice', req.params.id, `Status: ${invoice.status} → ${status}`, req.ip || 'unknown', now);

    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Invoice status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/invoices/:id/line-items ────────────────────
// Add a line item
router.post('/:id/line-items', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { line_type, description, quantity, unit_price, linked_entity_type, linked_entity_id } = req.body;
    if (!line_type || !description) {
      return res.status(400).json({ error: 'line_type and description are required' });
    }

    const qty = quantity || 1;
    const price = unit_price || 0;
    const amount = Math.round(qty * price * 100) / 100;

    // Get max sort order
    const maxSort = db.prepare(
      'SELECT COALESCE(MAX(sort_order), 0) as m FROM invoice_line_items WHERE invoice_id = ?'
    ).get(req.params.id) as any;

    const result = db.prepare(`
      INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_price, amount, linked_entity_type, linked_entity_id, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, line_type, description, qty, price, amount, linked_entity_type || null, linked_entity_id || null, maxSort.m + 1, now);

    recalculateInvoiceTotals(req.params.id);

    const item = db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: item });
  } catch (error: any) {
    console.error('Add line item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/invoices/:id/line-items/:itemId ─────────────
// Update a line item
router.put('/:id/line-items/:itemId', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    const item = db.prepare(
      'SELECT * FROM invoice_line_items WHERE id = ? AND invoice_id = ?'
    ).get(req.params.itemId, req.params.id) as any;
    if (!item) return res.status(404).json({ error: 'Line item not found' });

    const { description, quantity, unit_price, sort_order } = req.body;
    const qty = quantity !== undefined ? quantity : item.quantity;
    const price = unit_price !== undefined ? unit_price : item.unit_price;
    const amount = Math.round(qty * price * 100) / 100;

    db.prepare(`
      UPDATE invoice_line_items
      SET description = ?, quantity = ?, unit_price = ?, amount = ?, sort_order = ?
      WHERE id = ?
    `).run(
      description !== undefined ? description : item.description,
      qty, price, amount,
      sort_order !== undefined ? sort_order : item.sort_order,
      req.params.itemId
    );

    recalculateInvoiceTotals(req.params.id);

    const updated = db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(req.params.itemId);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Update line item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/invoices/:id/line-items/:itemId ──────────
router.delete('/:id/line-items/:itemId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const item = db.prepare(
      'SELECT id FROM invoice_line_items WHERE id = ? AND invoice_id = ?'
    ).get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Line item not found' });

    db.prepare('DELETE FROM invoice_line_items WHERE id = ?').run(req.params.itemId);
    recalculateInvoiceTotals(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete line item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/invoices/:id/payments ──────────────────────
// Record a payment
router.post('/:id/payments', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { amount, payment_date, payment_method, reference_number, notes } = req.body;
    if (!amount || !payment_date) {
      return res.status(400).json({ error: 'amount and payment_date are required' });
    }

    const result = db.prepare(`
      INSERT INTO payments (invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.params.id, amount, payment_date, payment_method || null, reference_number || null, notes || null, user.userId, now);

    // Recalculate totals
    recalculateInvoiceTotals(req.params.id);

    // Auto-transition status
    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (updated.balance_due <= 0 && updated.status !== 'paid') {
      db.prepare("UPDATE invoices SET status = 'paid', paid_date = ?, updated_at = ? WHERE id = ?").run(localToday(), now, req.params.id);
    } else if (updated.amount_paid > 0 && updated.balance_due > 0 && updated.status === 'sent') {
      db.prepare("UPDATE invoices SET status = 'partial', updated_at = ? WHERE id = ?").run(now, req.params.id);
    }

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'payment_recorded', 'invoice', req.params.id, `Payment of $${amount} recorded on invoice ${invoice.invoice_number}`, req.ip || 'unknown', now);

    const payment = db.prepare(`
      SELECT p.*, u.full_name as recorded_by_name
      FROM payments p LEFT JOIN users u ON p.recorded_by = u.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json({ data: payment });
  } catch (error: any) {
    console.error('Record payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/invoices/:id/payments/:paymentId ─────────
// Reverse a payment
router.delete('/:id/payments/:paymentId', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const payment = db.prepare(
      'SELECT * FROM payments WHERE id = ? AND invoice_id = ?'
    ).get(req.params.paymentId, req.params.id) as any;
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.paymentId);
    recalculateInvoiceTotals(req.params.id);

    // May need to revert status from paid/partial back to sent
    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (updated.amount_paid <= 0 && (updated.status === 'paid' || updated.status === 'partial')) {
      db.prepare("UPDATE invoices SET status = 'sent', paid_date = NULL, updated_at = ? WHERE id = ?").run(now, req.params.id);
    } else if (updated.balance_due > 0 && updated.status === 'paid') {
      db.prepare("UPDATE invoices SET status = 'partial', paid_date = NULL, updated_at = ? WHERE id = ?").run(now, req.params.id);
    }

    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'payment_reversed', 'invoice', req.params.id, `Payment of $${payment.amount} reversed on invoice ${updated.invoice_number}`, req.ip || 'unknown', now);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/invoices/:id/pdf-data ───────────────────────
// Return all data needed for client-side PDF generation
router.get('/:id/pdf-data', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const invoice = db.prepare(`
      SELECT i.*, c.name as client_name, c.contact_name, c.contact_email, c.contact_phone,
             c.address as client_address, c.client_code, c.tax_id,
             u.full_name as created_by_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN users u ON i.created_by = u.id
      WHERE i.id = ?
    `).get(req.params.id) as any;

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const line_items = db.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id'
    ).all(req.params.id);

    const payments = db.prepare(`
      SELECT p.*, u.full_name as recorded_by_name
      FROM payments p LEFT JOIN users u ON p.recorded_by = u.id
      WHERE p.invoice_id = ? ORDER BY p.payment_date
    `).all(req.params.id);

    res.json({
      data: {
        invoice: { ...invoice, line_items, payments },
      },
    });
  } catch (error: any) {
    console.error('Invoice PDF data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/invoices/:id/person-chain ─────────────────
// Get Person ↔ Client ↔ Incident traceability data for this invoice
// Shows all persons linked to the client, and their involvement in invoiced incidents
router.get('/:id/person-chain', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Get all persons linked to this client
    let linkedPersons: any[] = [];
    try {
      linkedPersons = db.prepare(`
        SELECT cp.id as link_id, cp.relationship, cp.title, cp.is_primary,
               p.id as person_id, p.first_name, p.last_name, p.phone, p.email
        FROM client_persons cp
        JOIN persons p ON cp.person_id = p.id
        WHERE cp.client_id = ?
        ORDER BY cp.is_primary DESC, p.last_name, p.first_name
      `).all(invoice.client_id);
    } catch { /* table might not exist */ }

    // Get incidents referenced in invoice line items
    const incidentLineItems = db.prepare(`
      SELECT linked_entity_id FROM invoice_line_items
      WHERE invoice_id = ? AND linked_entity_type = 'incident'
    `).all(invoice.id) as any[];
    const incidentIds = incidentLineItems.map((i: any) => i.linked_entity_id).filter(Boolean);

    // For each incident, get linked persons with their roles
    const incidentPersons: Record<number, any[]> = {};
    if (incidentIds.length > 0) {
      for (const incId of incidentIds) {
        try {
          incidentPersons[incId] = db.prepare(`
            SELECT ip.role, ip.notes,
                   p.id as person_id, p.first_name, p.last_name, p.phone
            FROM incident_persons ip
            JOIN persons p ON ip.person_id = p.id
            WHERE ip.incident_id = ?
          `).all(incId);
        } catch { /* ignore */ }
      }
    }

    // Build the chain: for each linked person, show which invoiced incidents they're in
    const personChains = linkedPersons.map((lp: any) => {
      const involvedIncidents: any[] = [];
      for (const [incId, persons] of Object.entries(incidentPersons)) {
        const match = (persons as any[]).find((ip: any) => ip.person_id === lp.person_id);
        if (match) {
          involvedIncidents.push({
            incident_id: Number(incId),
            role: match.role,
            notes: match.notes,
          });
        }
      }
      return {
        ...lp,
        involved_incidents: involvedIncidents,
        incident_count: involvedIncidents.length,
      };
    });

    res.json({
      invoice_id: invoice.id,
      client_id: invoice.client_id,
      linked_persons: personChains,
      incident_persons: incidentPersons,
      summary: {
        total_linked_persons: linkedPersons.length,
        total_invoiced_incidents: incidentIds.length,
        persons_with_incidents: personChains.filter((pc: any) => pc.incident_count > 0).length,
      },
    });
  } catch (error: any) {
    console.error('Invoice person-chain error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
