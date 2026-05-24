// Invoice routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow, localToday } from '../worker-middleware/d1Helpers';

export function mountInvoicesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  async function generateInvoiceNumber(db: D1Db): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const last = await db.prepare("SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1").get(`${prefix}%`) as any;
    let seq = 1;
    if (last) {
      const parts = last.invoice_number.split('-');
      const parsed = parseInt(parts[2], 10);
      seq = isNaN(parsed) ? 1 : parsed + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  function parsePaymentTermsDays(terms?: string): number {
    if (!terms) return 30;
    const match = terms.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 30;
  }

  function addDays(dateStr: string, days: number): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  async function recalculateInvoiceTotals(db: D1Db, invoiceId: number): Promise<void> {
    const now = localNow();
    const items = await db.prepare(`
      SELECT line_type, COALESCE(SUM(amount), 0) as total
      FROM invoice_line_items WHERE invoice_id = ? GROUP BY line_type
    `).all(invoiceId) as any[];
    let subtotal = 0; let discountAmount = 0; let lateFeeAmount = 0;
    for (const item of items) {
      if (item.line_type === 'discount') discountAmount = Math.abs(item.total);
      else if (item.line_type === 'late_fee') lateFeeAmount = item.total;
      else subtotal += item.total;
    }
    const total = subtotal - discountAmount + lateFeeAmount;
    const payResult = await db.prepare('SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE invoice_id = ?').get(invoiceId) as any;
    const amountPaid = payResult.paid;
    const balanceDue = Math.max(0, total - amountPaid);
    await db.prepare(`
      UPDATE invoices SET subtotal = ?, discount_amount = ?, late_fee_amount = ?,
        total = ?, amount_paid = ?, balance_due = ?, updated_at = ? WHERE id = ?
    `).run(subtotal, discountAmount, lateFeeAmount, total, amountPaid, balanceDue, now, invoiceId);
    const inv = await db.prepare('SELECT client_id FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (inv) {
      const agg = await db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total_invoiced, COALESCE(SUM(amount_paid), 0) as total_paid,
          COALESCE(SUM(balance_due), 0) as outstanding
        FROM invoices WHERE client_id = ? AND status NOT IN ('void','cancelled')
      `).get(inv.client_id) as any;
      await db.prepare(`
        UPDATE clients SET total_invoiced = ?, total_paid = ?, outstanding_balance = ?, updated_at = ? WHERE id = ?
      `).run(agg.total_invoiced, agg.total_paid, agg.outstanding, now, inv.client_id);
    }
  }

  api.get('/stats', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const client_id = q.client_id;
      const clientFilter = client_id ? ' AND client_id = ?' : '';
      const params = client_id ? [client_id] : [];
      const statusCounts = await db.prepare(`
        SELECT status, COUNT(*) as count FROM invoices WHERE status NOT IN ('void','cancelled') ${clientFilter} GROUP BY status
      `).all(...params) as any[];
      const statusMap: Record<string, number> = {};
      let totalInvoices = 0;
      for (const row of statusCounts) { statusMap[row.status] = row.count; totalInvoices += row.count; }
      const outstanding = await db.prepare(`SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('sent','partial','overdue') ${clientFilter}`).get(...params) as any;
      const collected = await db.prepare(`SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE status NOT IN ('void','cancelled') ${clientFilter}`).get(...params) as any;
      return c.json({ data: { total_invoices: totalInvoices, total_outstanding: outstanding.total, total_collected: collected.total, overdue_count: statusMap['overdue'] || 0, draft_count: statusMap['draft'] || 0, by_status: statusMap } });
    } catch {
      return c.json({ error: 'Failed to get invoice stats', code: 'INVOICE_STATS_ERROR' }, 500);
    }
  });

  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const page = Math.max(1, parseInt(q.page || '1') || 1);
      const limit = Math.min(100000, Math.max(1, parseInt(q.limit || '100000') || 100000));
      const offset = (page - 1) * limit;
      const conditions: string[] = [];
      const params: any[] = [];
      if (q.status) { conditions.push('i.status = ?'); params.push(q.status); }
      if (q.client_id) { conditions.push('i.client_id = ?'); params.push(q.client_id); }
      if (q.date_from) { conditions.push('i.issue_date >= ?'); params.push(q.date_from); }
      if (q.date_to) { conditions.push('i.issue_date <= ?'); params.push(q.date_to); }
      if (q.q) { const like = `%${q.q}%`; conditions.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR i.notes LIKE ?)'); params.push(like, like, like); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = await db.prepare(`SELECT COUNT(*) as count FROM invoices i LEFT JOIN clients c ON i.client_id = c.id ${where}`).get(...params) as any;
      const rows = await db.prepare(`
        SELECT i.*, c.name as client_name, u.full_name as created_by_name,
          (SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id = i.id) as line_item_count,
          (SELECT COUNT(*) FROM payments WHERE invoice_id = i.id) as payment_count
        FROM invoices i LEFT JOIN clients c ON i.client_id = c.id LEFT JOIN users u ON i.created_by = u.id
        ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];
      return c.json({ data: rows, pagination: { page, limit, total: total.count, totalPages: Math.ceil(total.count / limit) } });
    } catch {
      return c.json({ error: 'Failed to get invoice list', code: 'INVOICE_LIST_ERROR' }, 500);
    }
  });

  api.get('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const invoice = await db.prepare(`
        SELECT i.*, c.name as client_name, u.full_name as created_by_name
        FROM invoices i LEFT JOIN clients c ON i.client_id = c.id LEFT JOIN users u ON i.created_by = u.id WHERE i.id = ?
      `).get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const line_items = await db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id').all(id);
      const payments = await db.prepare(`
        SELECT p.*, u.full_name as recorded_by_name FROM payments p LEFT JOIN users u ON p.recorded_by = u.id
        WHERE p.invoice_id = ? ORDER BY p.payment_date DESC LIMIT 1000
      `).all(id);
      return c.json({ data: { ...invoice, line_items, payments } });
    } catch {
      return c.json({ error: 'Failed to get invoice detail', code: 'INVOICE_DETAIL_ERROR' }, 500);
    }
  });

  api.post('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const body = await c.req.json();
      const { client_id, period_start, period_end, issue_date, notes, internal_notes } = body;
      if (!client_id || !period_start || !period_end) return c.json({ error: 'client_id, period_start, and period_end are required', code: 'CLIENTID_PERIODSTART_AND_PERIODEND' }, 400);
      const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id) as any;
      if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);
      const invoice_number = await generateInvoiceNumber(db);
      const issueDt = issue_date || localToday();
      const days = parsePaymentTermsDays(client.payment_terms);
      const due_date = addDays(issueDt, days);
      const result = await db.prepare(`
        INSERT INTO invoices (invoice_number, client_id, status, period_start, period_end, issue_date, due_date,
          payment_terms, billing_email, billing_address, notes, internal_notes, created_by, created_at, updated_at)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(invoice_number, client_id, period_start, period_end, issueDt, due_date, client.payment_terms || 'Net 30',
        client.billing_email || client.contact_email || '', client.billing_address || client.address || '',
        notes || '', internal_notes || '', user.userId, now, now);
      const invId = Number(result.meta.last_row_id);
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.userId, 'invoice_created', 'invoice', invId, `Created invoice ${invoice_number} for client ${client.name}`, now);
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId);
      return c.json({ data: invoice }, 201);
    } catch {
      return c.json({ error: 'Failed to create invoice', code: 'INVOICE_CREATE_ERROR' }, 500);
    }
  });

  api.post('/:id/generate', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const user = c.get('user');
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      if (invoice.status !== 'draft' && user.role !== 'admin') return c.json({ error: 'Can only generate line items for draft invoices', code: 'CAN_ONLY_GENERATE_LINE' }, 400);
      const client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(invoice.client_id) as any;
      if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);
      const properties = await db.prepare('SELECT id, name FROM properties WHERE client_id = ?').all(invoice.client_id) as any[];
      const propertyIds = properties.map((p: any) => p.id);

      await db.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ? AND line_type != 'custom'").run(invoice.id);
      const insertItem = db.prepare(`
        INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_price, amount, linked_entity_type, linked_entity_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let sortOrder = 0;
      const items: any[] = [];

      if (client.contract_value && client.contract_value > 0) {
        const desc = `Contract base rate — ${client.billing_cycle || 'monthly'} (${invoice.period_start} to ${invoice.period_end})`;
        await insertItem.run(invoice.id, 'contract_base', desc, 1, client.contract_value, client.contract_value, null, null, sortOrder++, now);
        items.push({ type: 'contract_base', amount: client.contract_value });
      }

      if (propertyIds.length > 0) {
        const ph = propertyIds.map(() => '?').join(',');
        const hours = await db.prepare(`
          SELECT te.id, te.total_hours, te.clock_in, u.full_name as officer_name, s.property_id, p.name as property_name
          FROM time_entries te LEFT JOIN schedules s ON te.schedule_id = s.id LEFT JOIN users u ON te.officer_id = u.id LEFT JOIN properties p ON s.property_id = p.id
          WHERE s.property_id IN (${ph}) AND te.clock_in >= ? AND te.clock_in <= ? AND te.status = 'completed'
          ORDER BY te.clock_in LIMIT 1000
        `).all(...propertyIds, invoice.period_start, invoice.period_end + 'T23:59:59') as any[];
        const rate = client.rate_per_hour || 0;
        for (const h of hours) {
          const hrs = h.total_hours || 0;
          const amt = Math.round(hrs * rate * 100) / 100;
          const desc = `Service hours — ${h.officer_name || 'Officer'} at ${h.property_name || 'Property'} (${String(h.clock_in).substring(0, 10)}) — ${hrs.toFixed(2)} hrs`;
          await insertItem.run(invoice.id, 'service_hours', desc, hrs, rate, amt, 'time_entry', h.id, sortOrder++, now);
          items.push({ type: 'service_hours', amount: amt });
        }
      }

      {
        const conditions: string[] = [];
        const cfsParams: any[] = [];
        if (propertyIds.length > 0) {
          const ph = propertyIds.map(() => '?').join(',');
          conditions.push(`(c.client_id = ? OR c.property_id IN (${ph}))`);
          cfsParams.push(invoice.client_id, ...propertyIds);
        } else { conditions.push('c.client_id = ?'); cfsParams.push(invoice.client_id); }
        conditions.push("c.created_at >= ?"); conditions.push("c.created_at <= ?"); conditions.push("c.status != 'cancelled'");
        cfsParams.push(invoice.period_start, invoice.period_end + 'T23:59:59');
        const calls = await db.prepare(`
          SELECT c.id, c.call_number, c.incident_type, c.created_at, c.location_address FROM calls_for_service c
          WHERE ${conditions.join(' AND ')} ORDER BY c.created_at LIMIT 1000
        `).all(...cfsParams) as any[];
        const rate = client.rate_per_cfs || 0;
        for (const call of calls) {
          const desc = `Dispatch call ${call.call_number} — ${call.incident_type} at ${call.location_address || 'Unknown'} (${String(call.created_at).substring(0, 10)})`;
          await insertItem.run(invoice.id, 'dispatch_call', desc, 1, rate, rate, 'call_for_service', call.id, sortOrder++, now);
          items.push({ type: 'dispatch_call', amount: rate });
        }
      }

      {
        const conditions: string[] = [];
        const incParams: any[] = [];
        if (propertyIds.length > 0) {
          const ph = propertyIds.map(() => '?').join(',');
          conditions.push(`(inc.client_id = ? OR inc.property_id IN (${ph}))`);
          incParams.push(invoice.client_id, ...propertyIds);
        } else { conditions.push('inc.client_id = ?'); incParams.push(invoice.client_id); }
        conditions.push("inc.created_at >= ?"); conditions.push("inc.created_at <= ?");
        incParams.push(invoice.period_start, invoice.period_end + 'T23:59:59');
        const incidents = await db.prepare(`
          SELECT inc.id, inc.incident_number, inc.incident_type, inc.created_at, inc.location_address FROM incidents inc
          WHERE ${conditions.join(' AND ')} ORDER BY inc.created_at LIMIT 1000
        `).all(...incParams) as any[];
        const rate = client.rate_per_incident || 0;
        for (const inc of incidents) {
          let personInfo = '';
          try {
            const linkedPersons = await db.prepare(`
              SELECT p.first_name, p.last_name, ip.role FROM incident_persons ip JOIN persons p ON ip.person_id = p.id
              WHERE ip.incident_id = ? ORDER BY CASE ip.role WHEN 'suspect' THEN 1 WHEN 'victim' THEN 2 WHEN 'reporting_party' THEN 3 ELSE 4 END LIMIT 3
            `).all(inc.id) as any[];
            if (linkedPersons.length > 0) personInfo = ' | Persons: ' + linkedPersons.map((lp: any) => `${lp.first_name} ${lp.last_name} (${lp.role})`).join(', ');
          } catch { /* ignore */ }
          const desc = `Incident response ${inc.incident_number || '#' + inc.id} — ${inc.incident_type} (${String(inc.created_at).substring(0, 10)})${personInfo}`;
          await insertItem.run(invoice.id, 'incident_response', desc, 1, rate, rate, 'incident', inc.id, sortOrder++, now);
          items.push({ type: 'incident_response', amount: rate });
        }
      }

      {
        const linkedCallIds = (await db.prepare('SELECT linked_entity_id FROM invoice_line_items WHERE invoice_id = ? AND linked_entity_type = \'call_for_service\' LIMIT 1000').all(invoice.id) as any[]).map((r: any) => r.linked_entity_id || 0);
        const linkedIncIds = (await db.prepare('SELECT linked_entity_id FROM invoice_line_items WHERE invoice_id = ? AND linked_entity_type = \'incident\' LIMIT 1000').all(invoice.id) as any[]).map((r: any) => r.linked_entity_id || 0);
        if (linkedCallIds.length > 0 || linkedIncIds.length > 0) {
          const citConditions: string[] = [];
          const citParams: any[] = [];
          if (linkedCallIds.length > 0) { citConditions.push(`cit.call_id IN (${linkedCallIds.map(() => '?').join(',')})`); citParams.push(...linkedCallIds); }
          if (linkedIncIds.length > 0) { citConditions.push(`cit.incident_id IN (${linkedIncIds.map(() => '?').join(',')})`); citParams.push(...linkedIncIds); }
          const citations = await db.prepare(`
            SELECT cit.id, cit.citation_number, cit.violation_description, cit.fine_amount FROM citations cit
            WHERE (${citConditions.join(' OR ')}) AND cit.status != 'voided' LIMIT 1000
          `).all(...citParams) as any[];
          for (const cit of citations) {
            const amt = cit.fine_amount || 0;
            const desc = `Citation ${cit.citation_number} — ${cit.violation_description || 'Violation'}`;
            await insertItem.run(invoice.id, 'citation', desc, 1, amt, amt, 'citation', cit.id, sortOrder++, now);
            items.push({ type: 'citation', amount: amt });
          }
        }
      }

      if (client.discount_percent && client.discount_percent > 0) {
        const sub = items.reduce((s: number, i: any) => s + (i.amount || 0), 0);
        const discountAmt = -Math.round(sub * client.discount_percent / 100 * 100) / 100;
        const desc = `Client discount (${client.discount_percent}%)`;
        await insertItem.run(invoice.id, 'discount', desc, 1, discountAmt, discountAmt, null, null, sortOrder++, now);
      }

      await recalculateInvoiceTotals(db, invoice.id);
      const updated = await db.prepare('SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?').get(invoice.id) as any;
      const line_items = await db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id').all(invoice.id);
      return c.json({ data: { ...updated, line_items }, generated: items.length });
    } catch {
      return c.json({ error: 'Failed to generate invoice', code: 'INVOICE_GENERATE_ERROR' }, 500);
    }
  });

  api.put('/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const body = await c.req.json();
      const fieldMap: Record<string, string> = { period_start: 'period_start', period_end: 'period_end', issue_date: 'issue_date', due_date: 'due_date', payment_terms: 'payment_terms', billing_email: 'billing_email', billing_address: 'billing_address', notes: 'notes', internal_notes: 'internal_notes', tax_amount: 'tax_amount', late_fee_amount: 'late_fee_amount' };
      const updates: string[] = ['updated_at = ?'];
      const values: any[] = [now];
      for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
        if (body[bodyKey] !== undefined) { updates.push(`${dbCol} = ?`); values.push(body[bodyKey]); }
      }
      values.push(id);
      await db.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      if (body.tax_amount !== undefined || body.late_fee_amount !== undefined) await recalculateInvoiceTotals(db, id);
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.userId, 'invoice_updated', 'invoice', id, `Updated invoice ${invoice.invoice_number}`, now);
      const updated = await db.prepare('SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?').get(id);
      return c.json({ data: updated });
    } catch {
      return c.json({ error: 'Failed to update invoice', code: 'INVOICE_UPDATE_ERROR' }, 500);
    }
  });

  api.put('/:id/status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { status } = body;
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const allowed: Record<string, string[]> = { draft: ['sent', 'void', 'cancelled'], sent: ['paid', 'partial', 'overdue', 'void', 'cancelled'], partial: ['paid', 'void'], overdue: ['paid', 'partial', 'void', 'cancelled'] };
      const validTransitions = allowed[invoice.status] || [];
      if (!validTransitions.includes(status) && user.role !== 'admin') {
        return c.json({ error: `Cannot transition from '${invoice.status}' to '${status}'. Valid: ${validTransitions.join(', ')}` }, 400);
      }
      const updates: string[] = ['status = ?', 'updated_at = ?'];
      const values: any[] = [status, now];
      if (status === 'sent' && !invoice.sent_at) { updates.push('sent_at = ?'); values.push(now); }
      if (status === 'paid') { updates.push('paid_date = ?'); values.push(localToday()); }
      if (status === 'void') { updates.push('voided_at = ?', 'voided_by = ?'); values.push(now, user.userId); }
      values.push(id);
      await db.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      await recalculateInvoiceTotals(db, id);
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.userId, 'invoice_status_changed', 'invoice', id, `Status: ${invoice.status} → ${status}`, now);
      const updated = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      return c.json({ data: updated });
    } catch {
      return c.json({ error: 'Failed to update invoice status', code: 'INVOICE_STATUS_ERROR' }, 500);
    }
  });

  api.post('/:id/line-items', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const invoice = await db.prepare('SELECT id FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const body = await c.req.json();
      const { line_type, description, quantity, unit_price, linked_entity_type, linked_entity_id } = body;
      if (!line_type || !description) return c.json({ error: 'line_type and description are required', code: 'LINETYPE_AND_DESCRIPTION_ARE' }, 400);
      const qty = quantity || 1;
      const price = unit_price || 0;
      const amount = Math.round(qty * price * 100) / 100;
      const maxSort = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM invoice_line_items WHERE invoice_id = ?').get(id) as any;
      const result = await db.prepare(`
        INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_price, amount, linked_entity_type, linked_entity_id, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, line_type, description, qty, price, amount, linked_entity_type || null, linked_entity_id || null, maxSort.m + 1, now);
      await recalculateInvoiceTotals(db, id);
      const item = await db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(Number(result.meta.last_row_id));
      return c.json({ data: item }, 201);
    } catch {
      return c.json({ error: 'Failed to add line item', code: 'ADD_LINE_ITEM_ERROR' }, 500);
    }
  });

  api.put('/:id/line-items/:itemId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const itemId = paramNum(c.req.param('itemId'));
      const item = await db.prepare('SELECT * FROM invoice_line_items WHERE id = ? AND invoice_id = ?').get(itemId, id) as any;
      if (!item) return c.json({ error: 'Line item not found', code: 'LINE_ITEM_NOT_FOUND' }, 404);
      const body = await c.req.json();
      const { description, quantity, unit_price, sort_order } = body;
      const qty = quantity !== undefined ? quantity : item.quantity;
      const price = unit_price !== undefined ? unit_price : item.unit_price;
      const amount = Math.round(qty * price * 100) / 100;
      await db.prepare(`
        UPDATE invoice_line_items SET description = ?, quantity = ?, unit_price = ?, amount = ?, sort_order = ? WHERE id = ?
      `).run(description !== undefined ? description : item.description, qty, price, amount, sort_order !== undefined ? sort_order : item.sort_order, itemId);
      await recalculateInvoiceTotals(db, id);
      const updated = await db.prepare('SELECT * FROM invoice_line_items WHERE id = ?').get(itemId);
      return c.json({ data: updated });
    } catch {
      return c.json({ error: 'Failed to update line item', code: 'UPDATE_LINE_ITEM_ERROR' }, 500);
    }
  });

  api.delete('/:id/line-items/:itemId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const itemId = paramNum(c.req.param('itemId'));
      const item = await db.prepare('SELECT id FROM invoice_line_items WHERE id = ? AND invoice_id = ?').get(itemId, id);
      if (!item) return c.json({ error: 'Line item not found', code: 'LINE_ITEM_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM invoice_line_items WHERE id = ?').run(itemId);
      await recalculateInvoiceTotals(db, id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to delete line item', code: 'DELETE_LINE_ITEM_ERROR' }, 500);
    }
  });

  api.post('/:id/payments', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const body = await c.req.json();
      const { amount, payment_date, payment_method, reference_number, notes } = body;
      if (!amount || !payment_date) return c.json({ error: 'amount and payment_date are required', code: 'AMOUNT_AND_PAYMENTDATE_ARE' }, 400);
      const result = await db.prepare(`
        INSERT INTO payments (invoice_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, amount, payment_date, payment_method || null, reference_number || null, notes || null, user.userId, now);
      await recalculateInvoiceTotals(db, id);
      const updated = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (updated.balance_due <= 0 && updated.status !== 'paid') {
        await db.prepare("UPDATE invoices SET status = 'paid', paid_date = ?, updated_at = ? WHERE id = ?").run(localToday(), now, id);
      } else if (updated.amount_paid > 0 && updated.balance_due > 0 && updated.status === 'sent') {
        await db.prepare("UPDATE invoices SET status = 'partial', updated_at = ? WHERE id = ?").run(now, id);
      }
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.userId, 'payment_recorded', 'invoice', id, `Payment of $${amount} recorded on invoice ${invoice.invoice_number}`, now);
      const payment = await db.prepare('SELECT p.*, u.full_name as recorded_by_name FROM payments p LEFT JOIN users u ON p.recorded_by = u.id WHERE p.id = ?').get(Number(result.meta.last_row_id));
      return c.json({ data: payment }, 201);
    } catch {
      return c.json({ error: 'Failed to record payment', code: 'RECORD_PAYMENT_ERROR' }, 500);
    }
  });

  api.delete('/:id/payments/:paymentId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const paymentId = paramNum(c.req.param('paymentId'));
      const payment = await db.prepare('SELECT * FROM payments WHERE id = ? AND invoice_id = ?').get(paymentId, id) as any;
      if (!payment) return c.json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' }, 404);
      await db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
      await recalculateInvoiceTotals(db, id);
      const updated = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (updated.amount_paid <= 0 && (updated.status === 'paid' || updated.status === 'partial')) {
        await db.prepare("UPDATE invoices SET status = 'sent', paid_date = NULL, updated_at = ? WHERE id = ?").run(now, id);
      } else if (updated.balance_due > 0 && updated.status === 'paid') {
        await db.prepare("UPDATE invoices SET status = 'partial', paid_date = NULL, updated_at = ? WHERE id = ?").run(now, id);
      }
      await db.prepare('INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.userId, 'payment_reversed', 'invoice', id, `Payment of $${payment.amount} reversed on invoice ${updated.invoice_number}`, now);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to delete payment', code: 'DELETE_PAYMENT_ERROR' }, 500);
    }
  });

  api.get('/:id/pdf-data', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const invoice = await db.prepare(`
        SELECT i.*, c.name as client_name, c.contact_name, c.contact_email, c.contact_phone, c.address as client_address, c.client_code, c.tax_id, u.full_name as created_by_name
        FROM invoices i LEFT JOIN clients c ON i.client_id = c.id LEFT JOIN users u ON i.created_by = u.id WHERE i.id = ?
      `).get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const line_items = await db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id').all(id);
      const payments = await db.prepare('SELECT p.*, u.full_name as recorded_by_name FROM payments p LEFT JOIN users u ON p.recorded_by = u.id WHERE p.invoice_id = ? ORDER BY p.payment_date LIMIT 1000').all(id);
      return c.json({ data: { invoice: { ...invoice, line_items, payments } } });
    } catch {
      return c.json({ error: 'Failed to get invoice PDF data', code: 'INVOICE_PDF_DATA_ERROR' }, 500);
    }
  });

  api.get('/:id/person-chain', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      let linkedPersons: any[] = [];
      try { linkedPersons = await db.prepare(`
        SELECT cp.id as link_id, cp.relationship, cp.title, cp.is_primary, p.id as person_id, p.first_name, p.last_name, p.phone, p.email
        FROM client_persons cp JOIN persons p ON cp.person_id = p.id WHERE cp.client_id = ?
        ORDER BY cp.is_primary DESC, p.last_name, p.first_name LIMIT 1000
      `).all(invoice.client_id); } catch { /* table might not exist */ }
      const incidentLineItems = await db.prepare("SELECT linked_entity_id FROM invoice_line_items WHERE invoice_id = ? AND linked_entity_type = 'incident' LIMIT 1000").all(id) as any[];
      const incidentIds = incidentLineItems.map((i: any) => i.linked_entity_id).filter(Boolean);
      const incidentPersons: Record<number, any[]> = {};
      if (incidentIds.length > 0) {
        for (const incId of incidentIds) {
          try { incidentPersons[incId] = await db.prepare(`
            SELECT ip.role, ip.notes, p.id as person_id, p.first_name, p.last_name, p.phone
            FROM incident_persons ip JOIN persons p ON ip.person_id = p.id WHERE ip.incident_id = ? LIMIT 1000
          `).all(incId); } catch { /* ignore */ }
        }
      }
      const personChains = linkedPersons.map((lp: any) => {
        const involvedIncidents: any[] = [];
        for (const [incId, persons] of Object.entries(incidentPersons)) {
          const match = (persons as any[]).find((ip: any) => ip.person_id === lp.person_id);
          if (match) involvedIncidents.push({ incident_id: Number(incId), role: match.role, notes: match.notes });
        }
        return { ...lp, involved_incidents: involvedIncidents, incident_count: involvedIncidents.length };
      });
      return c.json({
        invoice_id: invoice.id, client_id: invoice.client_id, linked_persons: personChains, incident_persons: incidentPersons,
        summary: { total_linked_persons: linkedPersons.length, total_invoiced_incidents: incidentIds.length, persons_with_incidents: personChains.filter((pc: any) => pc.incident_count > 0).length },
      });
    } catch {
      return c.json({ error: 'Failed to get invoice person chain', code: 'INVOICE_PERSONCHAIN_ERROR' }, 500);
    }
  });

  api.get('/templates/list', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      let rows: any[];
      try { rows = await db.prepare('SELECT it.*, c.name as client_name FROM invoice_templates it LEFT JOIN clients c ON it.client_id = c.id ORDER BY it.is_active DESC, it.name ASC LIMIT 100').all(); } catch { rows = []; }
      return c.json({ data: rows });
    } catch {
      return c.json({ error: 'Failed to list templates', code: 'LIST_INVOICE_TEMPLATES_ERROR' }, 500);
    }
  });

  api.post('/templates', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const body = await c.req.json();
      const { name, client_id, frequency, line_items_json, notes, is_active } = body;
      if (!name || !client_id) return c.json({ error: 'name and client_id required', code: 'NAME_AND_CLIENTID_REQUIRED' }, 400);
      try { await db.exec(`CREATE TABLE IF NOT EXISTS invoice_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, client_id INTEGER NOT NULL, frequency TEXT DEFAULT 'monthly', line_items_json TEXT, notes TEXT, is_active INTEGER DEFAULT 1, last_generated_at TEXT, next_generate_at TEXT, created_by INTEGER, created_at TEXT, updated_at TEXT)`); } catch { /* already exists */ }
      const result = await db.prepare(`
        INSERT INTO invoice_templates (name, client_id, frequency, line_items_json, notes, is_active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, client_id, frequency || 'monthly', line_items_json || '[]', notes || null, is_active !== false ? 1 : 0, user.userId, now, now);
      return c.json({ data: { id: Number(result.meta.last_row_id), name } }, 201);
    } catch {
      return c.json({ error: 'Failed to create template', code: 'CREATE_INVOICE_TEMPLATE_ERROR' }, 500);
    }
  });

  api.delete('/templates/:templateId', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const tid = parseInt(c.req.param('templateId') || '0', 10);
      if (isNaN(tid)) return c.json({ error: 'Invalid template ID' }, 400);
      try { await db.prepare('DELETE FROM invoice_templates WHERE id = ?').run(tid); } catch { /* ok */ }
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to delete template', code: 'DELETE_INVOICE_TEMPLATE_ERROR' }, 500);
    }
  });

  api.get('/aging/report', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const today = localToday();
      const overdue = await db.prepare(`
        SELECT i.id, i.invoice_number, i.client_id, c.name as client_name, i.due_date, i.total, i.amount_paid, i.balance_due, i.status,
          CAST(julianday(?) - julianday(i.due_date) AS INTEGER) as days_overdue
        FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
        WHERE i.status IN ('sent', 'partial', 'overdue') AND i.due_date < ? ORDER BY days_overdue DESC LIMIT 500
      `).all(today, today) as any[];
      const buckets: Record<string, { invoices: any[]; total: number }> = { '1-30': { invoices: [], total: 0 }, '31-60': { invoices: [], total: 0 }, '61-90': { invoices: [], total: 0 }, '91-120': { invoices: [], total: 0 }, '120+': { invoices: [], total: 0 } };
      for (const inv of overdue) {
        const d = inv.days_overdue;
        const bucket = d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : d <= 120 ? '91-120' : '120+';
        buckets[bucket].invoices.push(inv);
        buckets[bucket].total += inv.balance_due || 0;
      }
      for (const b of Object.values(buckets)) b.total = Math.round(b.total * 100) / 100;
      const totalOverdue = overdue.reduce((s, i) => s + (i.balance_due || 0), 0);
      return c.json({ total_overdue_amount: Math.round(totalOverdue * 100) / 100, total_overdue_count: overdue.length, buckets, as_of: today });
    } catch {
      return c.json({ error: 'Failed to generate aging report', code: 'AGING_REPORT_ERROR' }, 500);
    }
  });

  api.post('/:id/recalculate', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { tax_rate } = body;
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      const now = localNow();
      if (tax_rate !== undefined) {
        const rate = parseFloat(String(tax_rate)) || 0;
        const items = await db.prepare('SELECT COALESCE(SUM(amount), 0) as subtotal FROM invoice_line_items WHERE invoice_id = ? AND line_type NOT IN (\'discount\', \'late_fee\', \'tax\')').get(id) as any;
        const taxAmount = Math.round(items.subtotal * rate / 100 * 100) / 100;
        await db.prepare('UPDATE invoices SET tax_rate = ?, tax_amount = ?, updated_at = ? WHERE id = ?').run(rate, taxAmount, now, id);
      }
      await recalculateInvoiceTotals(db, id);
      const updated = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      return c.json({ data: updated });
    } catch {
      return c.json({ error: 'Failed to recalculate', code: 'RECALCULATE_ERROR' }, 500);
    }
  });

  api.get('/:id/reminders', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      let rows: any[];
      try { rows = await db.prepare('SELECT * FROM invoice_reminders WHERE invoice_id = ? ORDER BY scheduled_at DESC LIMIT 50').all(id); } catch { rows = []; }
      return c.json({ data: rows });
    } catch {
      return c.json({ error: 'Failed to list reminders', code: 'LIST_REMINDERS_ERROR' }, 500);
    }
  });

  api.post('/:id/reminders', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { scheduled_at, reminder_type, message } = body;
      const invoice = await db.prepare('SELECT id, invoice_number, billing_email FROM invoices WHERE id = ?').get(id) as any;
      if (!invoice) return c.json({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' }, 404);
      try { await db.exec(`CREATE TABLE IF NOT EXISTS invoice_reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, reminder_type TEXT DEFAULT 'email', scheduled_at TEXT, sent_at TEXT, message TEXT, status TEXT DEFAULT 'pending', created_by INTEGER, created_at TEXT)`); } catch { /* already exists */ }
      const result = await db.prepare(`
        INSERT INTO invoice_reminders (invoice_id, reminder_type, scheduled_at, message, status, created_by, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(id, reminder_type || 'email', scheduled_at || now, message || `Payment reminder for invoice ${invoice.invoice_number}`, user.userId, now);
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'reminder_scheduled', 'invoice', ?, ?, ?)`).run(user.userId, id, `Payment reminder scheduled for invoice ${invoice.invoice_number}`, now);
      return c.json({ data: { id: Number(result.meta.last_row_id), status: 'pending' } }, 201);
    } catch {
      return c.json({ error: 'Failed to create reminder', code: 'CREATE_REMINDER_ERROR' }, 500);
    }
  });

  api.get('/reports/revenue', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const months = Math.min(24, Math.max(1, parseInt(q.months || '12') || 12));
      const monthly = await db.prepare(`
        SELECT strftime('%Y-%m', issue_date) as month, COUNT(*) as invoice_count, COALESCE(SUM(total), 0) as total_invoiced,
          COALESCE(SUM(amount_paid), 0) as total_collected, COALESCE(SUM(balance_due), 0) as total_outstanding
        FROM invoices WHERE status NOT IN ('void', 'cancelled') AND issue_date >= date('now', '-' || ? || ' months')
        GROUP BY month ORDER BY month
      `).all(months) as any[];
      const byClient = await db.prepare(`
        SELECT c.name as client_name, i.client_id, COUNT(*) as invoice_count, COALESCE(SUM(i.total), 0) as total_invoiced,
          COALESCE(SUM(i.amount_paid), 0) as total_collected
        FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
        WHERE i.status NOT IN ('void', 'cancelled') AND i.issue_date >= date('now', '-' || ? || ' months')
        GROUP BY i.client_id ORDER BY total_invoiced DESC LIMIT 20
      `).all(months) as any[];
      const grandTotal = monthly.reduce((s: any, m: any) => ({ invoiced: s.invoiced + m.total_invoiced, collected: s.collected + m.total_collected, outstanding: s.outstanding + m.total_outstanding }), { invoiced: 0, collected: 0, outstanding: 0 });
      return c.json({
        monthly, by_client: byClient,
        grand_total: { total_invoiced: Math.round(grandTotal.invoiced * 100) / 100, total_collected: Math.round(grandTotal.collected * 100) / 100, total_outstanding: Math.round(grandTotal.outstanding * 100) / 100, collection_rate: grandTotal.invoiced > 0 ? Math.round(grandTotal.collected / grandTotal.invoiced * 100) : 0 },
        period_months: months,
      });
    } catch {
      return c.json({ error: 'Failed to generate revenue report', code: 'REVENUE_REPORT_ERROR' }, 500);
    }
  });

  app.route('/api/invoices', api);
}
