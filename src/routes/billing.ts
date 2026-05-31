// ============================================================
// RMPG Flex — Billing / Financial Management
// ============================================================
// Spillman Flex Financial parity: client contracts, invoices,
// line items, payments, expense reports.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const billing = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateInvoiceNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `INV-${yy}-`;
  const last = await queryFirst<{ invoice_number: string }>(
    db, 'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let nextNum = 1;
  if (last?.invoice_number) {
    const m = last.invoice_number.match(/^INV-\d{2}-(\d+)$/);
    if (m) nextNum = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

async function recalcInvoiceTotal(db: ReturnType<typeof getDb>, invoiceId: number) {
  const items = await query<{ line_total: number; tax_applied: number }>(db, 'SELECT line_total, tax_applied FROM invoice_line_items WHERE invoice_id = ?', invoiceId);
  const subtotal = items.reduce((sum, i) => sum + (i.line_total || 0), 0);
  const inv = await queryFirst<{ tax_rate: number }>(db, 'SELECT tax_rate FROM invoices WHERE id = ?', invoiceId);
  const taxRate = inv?.tax_rate ?? 0;
  const taxableSubtotal = items.filter(i => i.tax_applied).reduce((sum, i) => sum + (i.line_total || 0), 0);
  const taxAmount = Math.round(taxableSubtotal * taxRate * 100) / 100;
  const total = subtotal + taxAmount;
  await execute(db, 'UPDATE invoices SET subtotal = ?, tax_amount = ?, total_amount = ? WHERE id = ?', subtotal, taxAmount, total, invoiceId);
}

// ═══════════════════════════════════════════════════════════════
// CLIENT CONTRACTS
// ═══════════════════════════════════════════════════════════════

billing.get('/contracts', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='client_contracts'");
    if (!tableCheck?.n) return c.json({ data: [] });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('client_id')) { conditions.push('c.client_id = ?'); params.push(q('client_id')); }
    if (q('status')) { conditions.push('c.status = ?'); params.push(q('status')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT c.*, cl.client_name FROM client_contracts c LEFT JOIN clients cl ON c.client_id = cl.id ${where} ORDER BY c.created_at DESC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list contracts' }, 500);
  }
});

billing.post('/contracts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.client_id) return c.json({ error: 'client_id required' }, 400);
    if (typeof b.start_date !== 'string') return c.json({ error: 'start_date required' }, 400);
    const result = await execute(db,
      `INSERT INTO client_contracts (client_id, contract_number, contract_type, start_date, end_date, billing_cycle, rate_amount, rate_type, status, auto_renew, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.client_id, b.contract_number ?? null, b.contract_type ?? null, b.start_date, b.end_date ?? null,
      b.billing_cycle ?? 'monthly', b.rate_amount ?? null, b.rate_type ?? 'flat', b.status ?? 'active', b.auto_renew ?? 0, b.notes ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM client_contracts WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create contract' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════

billing.get('/invoices', async (c) => {
  try {
    const db = getDb(c.env);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='invoices'");
    if (!tableCheck?.n) return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 0 } });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('client_id')) { conditions.push('i.client_id = ?'); params.push(q('client_id')); }
    if (q('status')) { conditions.push('i.status = ?'); params.push(q('status')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = 50; const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM invoices i ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT i.*, cl.client_name FROM invoices i LEFT JOIN clients cl ON i.client_id = cl.id ${where} ORDER BY i.issue_date DESC LIMIT ? OFFSET ?`, ...params, perPage, offset);
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    return c.json({ error: 'Failed to list invoices' }, 500);
  }
});

billing.post('/invoices', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.client_id) return c.json({ error: 'client_id required' }, 400);
    const invoiceNumber = await generateInvoiceNumber(db);
    const dueDate = b.due_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const result = await execute(db,
      `INSERT INTO invoices (invoice_number, client_id, contract_id, issue_date, due_date, tax_rate, status, notes, created_by)
       VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?)`,
      invoiceNumber, b.client_id, b.contract_id ?? null, dueDate, b.tax_rate ?? 0, 'draft', b.notes ?? null, userId);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', newId);
    return c.json({ data: created, invoice_number: invoiceNumber }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create invoice' }, 500);
  }
});

billing.put('/invoices/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['client_id','contract_id','due_date','tax_rate','status','notes']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`); vals.push(id);
    await execute(db, `UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update invoice' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// LINE ITEMS
// ═══════════════════════════════════════════════════════════════

billing.get('/invoices/:id/items', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id', id);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list line items' }, 500);
  }
});

billing.post('/invoices/:id/items', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const invoiceId = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.description !== 'string' || !b.description.trim()) return c.json({ error: 'description required' }, 400);
    const qty = typeof b.quantity === 'number' ? b.quantity : 1;
    const price = typeof b.unit_price === 'number' ? b.unit_price : 0;
    const lineTotal = Math.round(qty * price * 100) / 100;
    await execute(db,
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, tax_applied, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, b.description, qty, price, lineTotal, b.tax_applied ?? 1, b.sort_order ?? 0);
    await recalcInvoiceTotal(db, invoiceId);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', invoiceId);
    return c.json({ data: updated }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to add line item' }, 500);
  }
});

billing.delete('/invoices/:id/items/:itemId', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const invoiceId = parseInt(c.req.param('id'), 10);
    const itemId = parseInt(c.req.param('itemId'), 10);
    await execute(db, 'DELETE FROM invoice_line_items WHERE id = ? AND invoice_id = ?', itemId, invoiceId);
    await recalcInvoiceTotal(db, invoiceId);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', invoiceId);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to delete line item' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════

billing.get('/payments', async (c) => {
  try {
    const db = getDb(c.env);
    const invoiceId = c.req.query('invoice_id');
    const clientId = c.req.query('client_id');
    let where = '1=1'; const params: unknown[] = [];
    if (invoiceId) { where = 'p.invoice_id = ?'; params.push(invoiceId); }
    if (clientId) { where = 'p.client_id = ?'; params.push(clientId); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT p.*, i.invoice_number, cl.client_name FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE ${where} ORDER BY p.payment_date DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list payments' }, 500);
  }
});

billing.post('/payments', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.amount || Number(b.amount) <= 0) return c.json({ error: 'amount required' }, 400);
    const clientId = b.client_id ?? (await queryFirst<{ client_id: number }>(db, 'SELECT client_id FROM invoices WHERE id = ?', b.invoice_id))?.client_id;
    const result = await execute(db,
      `INSERT INTO payments (invoice_id, client_id, payment_date, amount, payment_method, reference_number, notes, recorded_by)
       VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?)`,
      b.invoice_id ?? null, clientId ?? null, b.payment_date ?? null, b.amount, b.payment_method ?? 'check', b.reference_number ?? null, b.notes ?? null, userId);
    // Update invoice paid_amount
    if (b.invoice_id) {
      const total = await queryFirst<{ amt: number }>(db, 'SELECT COALESCE(SUM(amount),0) as amt FROM payments WHERE invoice_id = ?', b.invoice_id);
      const inv = await queryFirst<{ total_amount: number }>(db, 'SELECT total_amount FROM invoices WHERE id = ?', b.invoice_id);
      let status = 'partial';
      if (inv && (total?.amt ?? 0) >= inv.total_amount) status = 'paid';
      await execute(db, 'UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', total?.amt ?? 0, status, b.invoice_id);
    }
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM payments WHERE id = ?', newId);
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to record payment' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// EXPENSE REPORTS
// ═══════════════════════════════════════════════════════════════

billing.get('/expenses', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('submitter_id')) { conditions.push('submitter_id = ?'); params.push(q('submitter_id')); }
    if (q('status')) { conditions.push('status = ?'); params.push(q('status')); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await query<Record<string, unknown>>(db,
      `SELECT er.*, u.full_name as submitter_name FROM expense_reports er LEFT JOIN users u ON er.submitter_id = u.id ${where} ORDER BY er.created_at DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to list expenses' }, 500);
  }
});

billing.post('/expenses', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.amount || Number(b.amount) <= 0) return c.json({ error: 'amount required' }, 400);
    const reportNumber = `EXP-${Date.now()}`;
    const result = await execute(db,
      `INSERT INTO expense_reports (report_number, submitter_id, category, description, amount, expense_date, receipt_url, status)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?)`,
      reportNumber, userId, b.category ?? null, b.description ?? null, b.amount, b.expense_date ?? null, b.receipt_url ?? null, 'submitted');
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM expense_reports WHERE id = ?', newId);
    return c.json({ data: created, report_number: reportNumber }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to submit expense' }, 500);
  }
});

billing.put('/expenses/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    const updatable = new Set(['category','description','amount','expense_date','receipt_url','status','approved_by','approved_at','notes']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE expense_reports SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM expense_reports WHERE id = ?', id);
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update expense' }, 500);
  }
});

billing.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const invoiceTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='invoices'");
    if (!invoiceTable?.n) return c.json({ total_contracts: 0, active_contracts: 0, total_invoices: 0, outstanding_invoices: 0, total_revenue: 0, collected_revenue: 0, total_expenses: 0, overdue_invoices: 0 });
    const contractsActive = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM client_contracts WHERE status = 'active'"))?.count ?? 0;
    const invoicesOutstanding = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM invoices WHERE status IN ('draft','sent','partial','overdue')"))?.count ?? 0;
    const totalOutstanding = (await queryFirst<{ total: number }>(db, "SELECT COALESCE(SUM(total_amount - paid_amount),0) as total FROM invoices WHERE status NOT IN ('paid','void','cancelled')"))?.total ?? 0;
    const expensesPending = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM expense_reports WHERE status = 'submitted'"))?.count ?? 0;
    return c.json({ active_contracts: contractsActive, outstanding_invoices: invoicesOutstanding, total_outstanding_amount: totalOutstanding, pending_expenses: expensesPending });
  } catch (err) {
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default billing;
