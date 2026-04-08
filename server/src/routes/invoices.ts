// ============================================================
// RMPG Flex — Invoice Management API Routes
// ============================================================
// Full CRUD for invoices, line items, payments.
// Auto-generates invoice numbers in INV-YYYY-NNNN format.
// Supports auto-generation of line items from billing period.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastAdminUpdate } from '../utils/websocket';
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
    seq = isNaN(parsed) ? 1 : parsed + 1;
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
    res.status(500).json({ error: 'Failed to get invoice stats', code: 'INVOICE_STATS_ERROR' });
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
    res.status(500).json({ error: 'Failed to get invoice list', code: 'INVOICE_LIST_ERROR' });
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
      return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });
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
    
      LIMIT 1000
    `).all(req.params.id);

    res.json({ data: { ...invoice, line_items, payments } });
  } catch (error: any) {
    console.error('Invoice detail error:', error);
    res.status(500).json({ error: 'Failed to get invoice detail', code: 'INVOICE_DETAIL_ERROR' });
  }
});

// ─── POST /api/invoices ───────────────────────────────────
// Create a new invoice
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const { client_id, period_start, period_end, issue_date, notes, internal_notes } = req.body;

    if (!client_id || !period_start || !period_end) {
      return res.status(400).json({ error: 'client_id, period_start, and period_end are required', code: 'CLIENTID_PERIODSTART_AND_PERIODEND' });
    }

    // Get client for billing snapshot
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id) as any;
    if (!client) {
      return res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
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
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'invoice_created', 'invoice', result.lastInsertRowid, `Created invoice ${invoice_number} for client ${client.name}`, now);

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: invoice });
  } catch (error: any) {
    console.error('Invoice create error:', error);
    res.status(500).json({ error: 'Failed to create invoice', code: 'INVOICE_CREATE_ERROR' });
  }
});

// ─── POST /api/invoices/:id/generate ──────────────────────
// Auto-generate line items from billing period
router.post('/:id/generate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });
    if (invoice.status !== 'draft' && req.user?.role !== 'admin') {
      return res.status(400).json({ error: 'Can only generate line items for draft invoices', code: 'CAN_ONLY_GENERATE_LINE' });
    }
    if (req.user?.role === 'admin' && invoice.status !== 'draft') {
      auditLog(req, 'ADMIN_OVERRIDE', 'invoice', Number(req.params.id), `Admin God Mode: bypassed draft-only generate restriction (status: ${invoice.status})`);
    }

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id) as any;
    if (!client) return res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });

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
        
          LIMIT 1000
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
        
          LIMIT 1000
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
        
          LIMIT 1000
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
        
          LIMIT 1000
        `).all(invoice.id).map((r: any) => r.linked_entity_id || 0);

        const linkedIncIds = db.prepare(`
          SELECT id FROM invoice_line_items
          WHERE invoice_id = ? AND linked_entity_type = 'incident'
        
          LIMIT 1000
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
          
            LIMIT 1000
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
    res.status(500).json({ error: 'Failed to generate invoice', code: 'INVOICE_GENERATE_ERROR' });
  }
});

// ─── PUT /api/invoices/:id ────────────────────────────────
// Update invoice fields
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

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
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'invoice_updated', 'invoice', req.params.id, `Updated invoice ${invoice.invoice_number}`, now);

    const updated = db.prepare(`
      SELECT i.*, c.name as client_name FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?
    `).get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Invoice update error:', error);
    res.status(500).json({ error: 'Failed to update invoice', code: 'INVOICE_UPDATE_ERROR' });
  }
});

// ─── PUT /api/invoices/:id/status ─────────────────────────
// Status transition with validation
router.put('/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const { status } = req.body;

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

    // Validate transitions
    const allowed: Record<string, string[]> = {
      draft: ['sent', 'void', 'cancelled'],
      sent: ['paid', 'partial', 'overdue', 'void', 'cancelled'],
      partial: ['paid', 'void'],
      overdue: ['paid', 'partial', 'void', 'cancelled'],
    };

    const validTransitions = allowed[invoice.status] || [];
    // God Mode: admin bypass — can force any invoice status transition
    if (!validTransitions.includes(status)) {
      if (req.user?.role !== 'admin') {
        return res.status(400).json({
          error: `Cannot transition from '${invoice.status}' to '${status}'. Valid: ${validTransitions.join(', ')}`,
        });
      } else {
        auditLog(req, 'ADMIN_OVERRIDE', 'invoice', Number(req.params.id), `Admin God Mode: forced invoice status transition ${invoice.status} -> ${status}`);
      }
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
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'invoice_status_changed', 'invoice', req.params.id, `Status: ${invoice.status} → ${status}`, now);

    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Invoice status error:', error);
    res.status(500).json({ error: 'Failed to update invoice status', code: 'INVOICE_STATUS_ERROR' });
  }
});

// ─── POST /api/invoices/:id/line-items ────────────────────
// Add a line item
router.post('/:id/line-items', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

    const { line_type, description, quantity, unit_price, linked_entity_type, linked_entity_id } = req.body;
    if (!line_type || !description) {
      return res.status(400).json({ error: 'line_type and description are required', code: 'LINETYPE_AND_DESCRIPTION_ARE' });
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
    res.status(500).json({ error: 'Failed to add line item', code: 'ADD_LINE_ITEM_ERROR' });
  }
});

// ─── PUT /api/invoices/:id/line-items/:itemId ─────────────
// Update a line item
router.put('/:id/line-items/:itemId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();

    const item = db.prepare(
      'SELECT * FROM invoice_line_items WHERE id = ? AND invoice_id = ?'
    ).get(req.params.itemId, req.params.id) as any;
    if (!item) return res.status(404).json({ error: 'Line item not found', code: 'LINE_ITEM_NOT_FOUND' });

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
    res.status(500).json({ error: 'Failed to update line item', code: 'UPDATE_LINE_ITEM_ERROR' });
  }
});

// ─── DELETE /api/invoices/:id/line-items/:itemId ──────────
router.delete('/:id/line-items/:itemId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const item = db.prepare(
      'SELECT id FROM invoice_line_items WHERE id = ? AND invoice_id = ?'
    ).get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Line item not found', code: 'LINE_ITEM_NOT_FOUND' });

    db.prepare('DELETE FROM invoice_line_items WHERE id = ?').run(req.params.itemId);
    recalculateInvoiceTotals(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete line item error:', error);
    res.status(500).json({ error: 'Failed to delete line item', code: 'DELETE_LINE_ITEM_ERROR' });
  }
});

// ─── POST /api/invoices/:id/payments ──────────────────────
// Record a payment
router.post('/:id/payments', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

    const { amount, payment_date, payment_method, reference_number, notes } = req.body;
    if (!amount || !payment_date) {
      return res.status(400).json({ error: 'amount and payment_date are required', code: 'AMOUNT_AND_PAYMENTDATE_ARE' });
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
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'payment_recorded', 'invoice', req.params.id, `Payment of $${amount} recorded on invoice ${invoice.invoice_number}`, now);

    const payment = db.prepare(`
      SELECT p.*, u.full_name as recorded_by_name
      FROM payments p LEFT JOIN users u ON p.recorded_by = u.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json({ data: payment });
  } catch (error: any) {
    console.error('Record payment error:', error);
    res.status(500).json({ error: 'Failed to record payment', code: 'RECORD_PAYMENT_ERROR' });
  }
});

// ─── DELETE /api/invoices/:id/payments/:paymentId ─────────
// Reverse a payment
router.delete('/:id/payments/:paymentId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();

    const payment = db.prepare(
      'SELECT * FROM payments WHERE id = ? AND invoice_id = ?'
    ).get(req.params.paymentId, req.params.id) as any;
    if (!payment) return res.status(404).json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' });

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
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.userId, 'payment_reversed', 'invoice', req.params.id, `Payment of $${payment.amount} reversed on invoice ${updated.invoice_number}`, now);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete payment error:', error);
    res.status(500).json({ error: 'Failed to delete payment', code: 'DELETE_PAYMENT_ERROR' });
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

    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

    const line_items = db.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id'
    ).all(req.params.id);

    const payments = db.prepare(`
      SELECT p.*, u.full_name as recorded_by_name
      FROM payments p LEFT JOIN users u ON p.recorded_by = u.id
      WHERE p.invoice_id = ? ORDER BY p.payment_date
    
      LIMIT 1000
    `).all(req.params.id);

    res.json({
      data: {
        invoice: { ...invoice, line_items, payments },
      },
    });
  } catch (error: any) {
    console.error('Invoice PDF data error:', error);
    res.status(500).json({ error: 'Failed to get invoice PDF data', code: 'INVOICE_PDF_DATA_ERROR' });
  }
});

// ─── GET /api/invoices/:id/person-chain ─────────────────
// Get Person ↔ Client ↔ Incident traceability data for this invoice
// Shows all persons linked to the client, and their involvement in invoiced incidents
router.get('/:id/person-chain', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

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
      
        LIMIT 1000
      `).all(invoice.client_id);
    } catch { /* table might not exist */ }

    // Get incidents referenced in invoice line items
    const incidentLineItems = db.prepare(`
      SELECT linked_entity_id FROM invoice_line_items
      WHERE invoice_id = ? AND linked_entity_type = 'incident'
    
      LIMIT 1000
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
          
            LIMIT 1000
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
    res.status(500).json({ error: 'Failed to get invoice person chain', code: 'INVOICE_PERSONCHAIN_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Recurring Invoice Templates
// Create, list, and apply templates for recurring invoices.
// ════════════════════════════════════════════════════════════
router.get('/templates/list', (req: Request, res: Response) => {
  try {
    const db = getDb();
    let rows: any[];
    try {
      rows = db.prepare(`
        SELECT it.*, c.name as client_name FROM invoice_templates it
        LEFT JOIN clients c ON it.client_id = c.id
        ORDER BY it.is_active DESC, it.name ASC LIMIT 100
      `).all();
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list templates', code: 'LIST_INVOICE_TEMPLATES_ERROR' });
  }
});

router.post('/templates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const { name, client_id, frequency, line_items_json, notes, is_active } = req.body;
    if (!name || !client_id) return res.status(400).json({ error: 'name and client_id required', code: 'NAME_AND_CLIENTID_REQUIRED' });

    // Ensure table exists
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS invoice_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, client_id INTEGER NOT NULL,
        frequency TEXT DEFAULT 'monthly',
        line_items_json TEXT, notes TEXT, is_active INTEGER DEFAULT 1,
        last_generated_at TEXT, next_generate_at TEXT,
        created_by INTEGER, created_at TEXT, updated_at TEXT
      )`);
    } catch { /* already exists */ }

    const result = db.prepare(`
      INSERT INTO invoice_templates (name, client_id, frequency, line_items_json, notes, is_active,
        created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, client_id, frequency || 'monthly', line_items_json || '[]',
      notes || null, is_active !== false ? 1 : 0, user.userId, now, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, name } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create template', code: 'CREATE_INVOICE_TEMPLATE_ERROR' });
  }
});

router.delete('/templates/:templateId', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tid = parseInt(req.params.templateId, 10);
    if (isNaN(tid)) { res.status(400).json({ error: 'Invalid template ID' }); return; }
    try { db.prepare('DELETE FROM invoice_templates WHERE id = ?').run(tid); } catch { /* ok */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete template', code: 'DELETE_INVOICE_TEMPLATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Payment Aging Reports
// Shows invoices grouped by days overdue (30/60/90/120+).
// ════════════════════════════════════════════════════════════
router.get('/aging/report', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const today = localToday();

    const overdue = db.prepare(`
      SELECT i.id, i.invoice_number, i.client_id, c.name as client_name,
        i.due_date, i.total, i.amount_paid, i.balance_due, i.status,
        CAST(julianday(?) - julianday(i.due_date) AS INTEGER) as days_overdue
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.status IN ('sent', 'partial', 'overdue')
        AND i.due_date < ?
      ORDER BY days_overdue DESC
      LIMIT 500
    `).all(today, today) as any[];

    // Group by aging bucket
    const buckets = {
      '1-30': { invoices: [] as any[], total: 0 },
      '31-60': { invoices: [] as any[], total: 0 },
      '61-90': { invoices: [] as any[], total: 0 },
      '91-120': { invoices: [] as any[], total: 0 },
      '120+': { invoices: [] as any[], total: 0 },
    };

    for (const inv of overdue) {
      const d = inv.days_overdue;
      const bucket = d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : d <= 120 ? '91-120' : '120+';
      buckets[bucket as keyof typeof buckets].invoices.push(inv);
      buckets[bucket as keyof typeof buckets].total += inv.balance_due || 0;
    }

    // Round totals
    for (const b of Object.values(buckets)) {
      b.total = Math.round(b.total * 100) / 100;
    }

    const totalOverdue = overdue.reduce((s, i) => s + (i.balance_due || 0), 0);

    res.json({
      total_overdue_amount: Math.round(totalOverdue * 100) / 100,
      total_overdue_count: overdue.length,
      buckets,
      as_of: today,
    });
  } catch (error: any) {
    console.error('Aging report error:', error);
    res.status(500).json({ error: 'Failed to generate aging report', code: 'AGING_REPORT_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: Auto-Calculate Totals with Tax
// Recalculates invoice totals including tax rate.
// ════════════════════════════════════════════════════════════
router.post('/:id/recalculate', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const invoiceId = req.params.id;
    const { tax_rate } = req.body;

    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

    const now = localNow();

    // If tax_rate provided, calculate and store tax_amount
    if (tax_rate !== undefined) {
      const rate = parseFloat(String(tax_rate)) || 0;
      const items = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as subtotal
        FROM invoice_line_items WHERE invoice_id = ? AND line_type NOT IN ('discount', 'late_fee', 'tax')
      `).get(invoiceId) as any;

      const taxAmount = Math.round(items.subtotal * rate / 100 * 100) / 100;
      db.prepare('UPDATE invoices SET tax_rate = ?, tax_amount = ?, updated_at = ? WHERE id = ?')
        .run(rate, taxAmount, now, invoiceId);
    }

    // Recalculate totals
    recalculateInvoiceTotals(invoiceId);

    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    res.json({ data: updated });
  } catch (error: any) {
    console.error('Recalculate error:', error);
    res.status(500).json({ error: 'Failed to recalculate', code: 'RECALCULATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: Payment Reminder Scheduling
// Creates/lists payment reminder records for overdue invoices.
// ════════════════════════════════════════════════════════════
router.get('/:id/reminders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    let rows: any[];
    try {
      rows = db.prepare(`
        SELECT * FROM invoice_reminders WHERE invoice_id = ?
        ORDER BY scheduled_at DESC LIMIT 50
      `).all(req.params.id);
    } catch {
      rows = [];
    }
    res.json({ data: rows });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list reminders', code: 'LIST_REMINDERS_ERROR' });
  }
});

router.post('/:id/reminders', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const now = localNow();
    const { scheduled_at, reminder_type, message } = req.body;

    const invoice = db.prepare('SELECT id, invoice_number, billing_email FROM invoices WHERE id = ?')
      .get(req.params.id) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' });

    // Ensure table exists
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS invoice_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL, reminder_type TEXT DEFAULT 'email',
        scheduled_at TEXT, sent_at TEXT, message TEXT,
        status TEXT DEFAULT 'pending',
        created_by INTEGER, created_at TEXT
      )`);
    } catch { /* already exists */ }

    const result = db.prepare(`
      INSERT INTO invoice_reminders (invoice_id, reminder_type, scheduled_at, message, status, created_by, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(req.params.id, reminder_type || 'email', scheduled_at || now, message || `Payment reminder for invoice ${invoice.invoice_number}`, user.userId, now);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'reminder_scheduled', 'invoice', ?, ?, ?)`).run(
      user.userId, req.params.id, `Payment reminder scheduled for invoice ${invoice.invoice_number}`, now);

    res.status(201).json({ data: { id: result.lastInsertRowid, status: 'pending' } });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create reminder', code: 'CREATE_REMINDER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Revenue Summary Report
// Returns revenue data grouped by month and client.
// ════════════════════════════════════════════════════════════
router.get('/reports/revenue', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const months = Math.min(24, Math.max(1, parseInt(String(req.query.months || '12'), 10)));

    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', issue_date) as month,
        COUNT(*) as invoice_count,
        COALESCE(SUM(total), 0) as total_invoiced,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(balance_due), 0) as total_outstanding
      FROM invoices
      WHERE status NOT IN ('void', 'cancelled')
        AND issue_date >= date('now', '-' || ? || ' months')
      GROUP BY month ORDER BY month
    `).all(months) as any[];

    const byClient = db.prepare(`
      SELECT c.name as client_name, i.client_id,
        COUNT(*) as invoice_count,
        COALESCE(SUM(i.total), 0) as total_invoiced,
        COALESCE(SUM(i.amount_paid), 0) as total_collected
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.status NOT IN ('void', 'cancelled')
        AND i.issue_date >= date('now', '-' || ? || ' months')
      GROUP BY i.client_id ORDER BY total_invoiced DESC LIMIT 20
    `).all(months) as any[];

    const grandTotal = monthly.reduce((s, m) => ({
      invoiced: s.invoiced + m.total_invoiced,
      collected: s.collected + m.total_collected,
      outstanding: s.outstanding + m.total_outstanding,
    }), { invoiced: 0, collected: 0, outstanding: 0 });

    res.json({
      monthly,
      by_client: byClient,
      grand_total: {
        total_invoiced: Math.round(grandTotal.invoiced * 100) / 100,
        total_collected: Math.round(grandTotal.collected * 100) / 100,
        total_outstanding: Math.round(grandTotal.outstanding * 100) / 100,
        collection_rate: grandTotal.invoiced > 0 ? Math.round(grandTotal.collected / grandTotal.invoiced * 100) : 0,
      },
      period_months: months,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate revenue report', code: 'REVENUE_REPORT_ERROR' });
  }
});

export default router;
