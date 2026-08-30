// ============================================================
// RMPG Flex — Billing / Financial Management
// ============================================================
// Spillman Flex Financial parity: client contracts, invoices,
// line items, payments, expense reports.
// Migration: 0047_spillman_modules.sql
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, executeBatch, columnExists } from '../utils/db';
import { recordAudit } from '../utils/auditLog';

import { log } from '../utils/logger';
import { containsAnyClause } from '../utils/searchText';
const billing = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

const VALID_LINE_TYPES = new Set([
  'custom', 'contract', 'contract_base', 'service_hours', 'incident_response',
  'dispatch_call', 'citation', 'late_fee', 'discount', 'pso_client_request',
]);

let _invoiceSchemaEnsured = false;
export async function ensureInvoiceSchema(db: ReturnType<typeof getDb>): Promise<void> {
  if (_invoiceSchemaEnsured) return;
  const invoiceCols: Array<[string, string]> = [
    ['period_start', 'TEXT'],
    ['period_end', 'TEXT'],
    ['internal_notes', 'TEXT'],
  ];
  const itemCols: Array<[string, string]> = [
    ['line_type', "TEXT DEFAULT 'custom'"],
    ['linked_entity_type', 'TEXT'],
    ['linked_entity_id', 'INTEGER'],
  ];
  for (const [col, type] of invoiceCols) {
    try {
      if (!(await columnExists(db, 'invoices', col))) {
        await db.prepare(`ALTER TABLE invoices ADD COLUMN ${col} ${type}`).run();
      }
    } catch { /* race / already-applied — tolerated */ }
  }
  for (const [col, type] of itemCols) {
    try {
      if (!(await columnExists(db, 'invoice_line_items', col))) {
        await db.prepare(`ALTER TABLE invoice_line_items ADD COLUMN ${col} ${type}`).run();
      }
    } catch { /* race / already-applied — tolerated */ }
  }
  _invoiceSchemaEnsured = true;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeLineTotal(lineType: string, qty: number, price: number): number {
  const raw = roundCents(qty * price);
  if (lineType === 'discount') return -Math.abs(raw);
  return raw;
}

function normalizeLineType(raw: unknown): string {
  const t = String(raw ?? 'custom').trim() || 'custom';
  return VALID_LINE_TYPES.has(t) ? t : 'custom';
}

/** Map live D1 invoice columns onto the shape InvoicesPage / AdminInvoiceTab render. */
function shapeInvoice(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  const total = Number(row.total_amount ?? row.total ?? 0) || 0;
  const paid = Number(row.paid_amount ?? row.amount_paid ?? 0) || 0;
  return {
    ...row,
    total,
    amount_paid: paid,
    balance_due: roundCents(total - paid),
    period_start: row.period_start || row.issue_date || '',
    period_end: row.period_end || row.due_date || '',
    discount_amount: Number(row.discount_amount ?? 0) || 0,
    late_fee_amount: Number(row.late_fee_amount ?? 0) || 0,
  };
}

const INVOICE_LIST_SQL = `SELECT i.*, cl.name AS client_name,
         cl.billing_email AS billing_email, cl.billing_address AS billing_address,
         COALESCE(cl.payment_terms, 'Net 30') AS payment_terms
       FROM invoices i LEFT JOIN clients cl ON i.client_id = cl.id`;

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
      `SELECT c.*, cl.name AS client_name FROM client_contracts c LEFT JOIN clients cl ON c.client_id = cl.id ${where} ORDER BY c.created_at DESC`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /contracts failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to list contracts' }, 500);
  }
});

billing.post('/contracts', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.client_id) return c.json({ error: 'client_id required' }, 400);
    if (typeof b.start_date !== 'string') return c.json({ error: 'start_date required' }, 400);
    // Audit 2026-06-21: rate_amount was bound raw — '500.001abc' or
    // negative values landed as strings and broke later SUM/AVG. The
    // companion line-items POST had a typeof guard; contracts did not.
    let rate: number | null = null;
    if (b.rate_amount != null && b.rate_amount !== '') {
      const r = Number(b.rate_amount);
      if (!Number.isFinite(r) || r < 0) return c.json({ error: 'rate_amount must be a non-negative number' }, 400);
      rate = r;
    }
    const result = await execute(db,
      `INSERT INTO client_contracts (client_id, contract_number, contract_type, start_date, end_date, billing_cycle, rate_amount, rate_type, status, auto_renew, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.client_id, b.contract_number ?? null, b.contract_type ?? null, b.start_date, b.end_date ?? null,
      b.billing_cycle ?? 'monthly', rate, b.rate_type ?? 'flat', b.status ?? 'active', b.auto_renew ?? 0, b.notes ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM client_contracts WHERE id = ?', newId);
    try {
      await recordAudit(c, {
        action: 'contract_created',
        entityType: 'client_contract',
        entityId: newId,
        details: `client=${b.client_id} type=${b.contract_type ?? 'n/a'} rate=${rate ?? 'n/a'}`,
        actorId: userId,
      });
    } catch { /* best-effort */ }
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /contracts failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to create contract' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════

billing.get('/invoices', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const tableCheck = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='invoices'");
    if (!tableCheck?.n) return c.json({ data: [], pagination: { page: 1, per_page: 50, total: 0, totalPages: 0 } });
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (q('client_id')) { conditions.push('i.client_id = ?'); params.push(q('client_id')); }
    if (q('status')) { conditions.push('i.status = ?'); params.push(q('status')); }
    if (q('date_from')) { conditions.push('i.issue_date >= ?'); params.push(q('date_from')); }
    if (q('date_to')) { conditions.push('i.issue_date <= ?'); params.push(q('date_to')); }
    if (q('q')) { const m = containsAnyClause(['i.invoice_number', 'i.notes']); conditions.push(m.sql); params.push(...m.binds(q('q')!)); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(q('limit') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM invoices i ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(db,
      `${INVOICE_LIST_SQL} ${where} ORDER BY i.issue_date DESC LIMIT ? OFFSET ?`, ...params, perPage, offset);
    const total = count?.total ?? 0;
    return c.json({ data: rows.map((r) => shapeInvoice(r)!), pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    log.error('GET /invoices failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to list invoices' }, 500);
  }
});

// GET /invoices/:id — full invoice detail for InvoicesPage.tsx's fetchDetail:
// the base row + client_name, line items (line_total aliased to `amount`,
// the field the client's detail view actually renders), and payments
// (with recorded_by_name joined in, matching the client's Payment type).
// No such endpoint existed anywhere — InvoicesPage previously called
// /api/invoices/:id (a different, stub-only router that only ever
// registered /stats and /:id/pdf-data), which always 404'd.
billing.get('/invoices/:id', async (c) => {
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const invoice = await queryFirst<Record<string, unknown>>(db,
      `SELECT i.*, cl.name AS client_name,
              cl.billing_email AS billing_email, cl.billing_address AS billing_address,
              COALESCE(cl.payment_terms, 'Net 30') AS payment_terms,
              u.full_name AS created_by_name
       FROM invoices i
       LEFT JOIN clients cl ON i.client_id = cl.id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.id = ?`, id);
    if (!invoice) return c.json({ error: 'Invoice not found', code: 'NOT_FOUND' }, 404);
    const lineItems = await query<Record<string, unknown>>(db,
      `SELECT id, invoice_id, COALESCE(line_type, 'custom') AS line_type, description, quantity, unit_price,
              line_total AS amount, sort_order, created_at, linked_entity_type, linked_entity_id
       FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id`, id);
    const discountAmount = roundCents(lineItems.filter((i) => i.line_type === 'discount').reduce((s, i) => s + Math.abs(Number(i.amount) || 0), 0));
    const lateFeeAmount = roundCents(lineItems.filter((i) => i.line_type === 'late_fee').reduce((s, i) => s + (Number(i.amount) || 0), 0));
    const payments = await query<Record<string, unknown>>(db,
      `SELECT p.*, u.full_name AS recorded_by_name FROM payments p
       LEFT JOIN users u ON p.recorded_by = u.id
       WHERE p.invoice_id = ? ORDER BY p.payment_date DESC`, id);
    return c.json({ data: {
      ...shapeInvoice(invoice),
      discount_amount: discountAmount,
      late_fee_amount: lateFeeAmount,
      line_items: lineItems,
      payments,
    } });
  } catch (err) {
    log.error('GET /invoices/:id failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to fetch invoice' }, 500);
  }
});

billing.post('/invoices', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.client_id) return c.json({ error: 'client_id required' }, 400);
    const invoiceNumber = await generateInvoiceNumber(db);
    const issueDate = typeof b.issue_date === 'string' && b.issue_date ? b.issue_date : null;
    const dueDate = b.due_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const result = await execute(db,
      `INSERT INTO invoices (invoice_number, client_id, contract_id, issue_date, due_date, tax_rate, status, notes, created_by, period_start, period_end, internal_notes)
       VALUES (?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceNumber, b.client_id, b.contract_id ?? null, issueDate, dueDate, b.tax_rate ?? 0, 'draft', b.notes ?? null, userId,
      b.period_start ?? null, b.period_end ?? null, b.internal_notes ?? null);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', newId);
    return c.json({ data: shapeInvoice(created), invoice_number: invoiceNumber }, 201);
  } catch (err) {
    log.error('POST /invoices failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to create invoice' }, 500);
  }
});

// Audit 2026-06-21: PUT /invoices accepted any string for `status`,
// so a typo like 'Paid' (capital P) left the invoice as outstanding in
// stats (status IN ('draft'...)) but invisible to collection workflows.
// Downgrading from 'paid' to 'draft' was also allowed with no
// paid_amount recalc.
const VALID_INVOICE_STATUSES = new Set(['draft','sent','partial','paid','overdue','void','cancelled']);

billing.put('/invoices/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const userId = c.get('userId') as number;
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();

    // Tracks whether THIS request is an admin override flipping an
    // under-paid invoice to 'paid'. Audit caught (2026-06-21 safety
    // pass): the v1011 path landed the override but wrote the generic
    // 'invoice_updated' action, so a SOX reviewer scanning audit_log
    // for unusual financial actions could not distinguish an admin
    // force-paid from a normal status edit. Captured here so the
    // recordAudit call below can branch on it.
    let forcedPaid = false;
    let paidPriorToForce = 0;
    let totalForForce = 0;

    if ('status' in b) {
      const s = String(b.status);
      if (!VALID_INVOICE_STATUSES.has(s)) {
        return c.json({ error: `invalid status: ${s}`, valid: Array.from(VALID_INVOICE_STATUSES) }, 400);
      }
      if (s === 'paid') {
        // Reject status='paid' unless paid_amount >= total_amount —
        // admin can pass ?force=true to override (e.g. invoice paid
        // off-platform, will record payments later). Override is
        // audit-logged as invoice_marked_paid_admin.
        const inv = await queryFirst<{ paid_amount: number | null; total_amount: number | null }>(
          db, 'SELECT paid_amount, total_amount FROM invoices WHERE id = ?', id);
        const paid = Number(inv?.paid_amount || 0);
        const total = Number(inv?.total_amount || 0);
        const actorRole = (c.get('user') as { role?: string } | undefined)?.role;
        const force = c.req.query('force') === 'true' && actorRole === 'admin';
        if (paid < total && !force) {
          return c.json({
            error: `Cannot mark paid: ${paid} of ${total} received`,
            canOverride: actorRole === 'admin',
          }, 409);
        }
        if (paid < total && force) {
          forcedPaid = true;
          paidPriorToForce = paid;
          totalForForce = total;
        }
      }
    }

    const updatable = new Set(['client_id','contract_id','due_date','tax_rate','status','notes','period_start','period_end','internal_notes','issue_date']);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now')`); vals.push(id);
    await execute(db, `UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', id);
    try {
      await recordAudit(c, {
        action: forcedPaid ? 'invoice_marked_paid_admin' : 'invoice_updated',
        entityType: 'invoice',
        entityId: id,
        details: forcedPaid
          ? `ADMIN OVERRIDE: marked paid with ${paidPriorToForce} of ${totalForForce} received; changed=${Object.keys(b).filter(k => updatable.has(k)).join(',')}`
          : `changed=${Object.keys(b).filter(k => updatable.has(k)).join(',')}`,
        actorId: userId,
      });
    } catch { /* best-effort */ }
    return c.json({ data: shapeInvoice(updated) });
  } catch (err) {
    log.error('PUT /invoices/:id failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to update invoice' }, 500);
  }
});

billing.delete('/invoices/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    await execute(db, 'DELETE FROM invoice_line_items WHERE invoice_id = ?', id);
    await execute(db, 'DELETE FROM payments WHERE invoice_id = ?', id);
    const result = await execute(db, 'DELETE FROM invoices WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Invoice not found', code: 'NOT_FOUND' }, 404);
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /invoices/:id failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to delete invoice', code: 'DELETE_ERROR' }, 500);
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
    log.error('GET /invoices/:id/items failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to list line items' }, 500);
  }
});

billing.post('/invoices/:id/items', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const invoiceId = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();
    if (typeof b.description !== 'string' || !b.description.trim()) return c.json({ error: 'description required' }, 400);
    const qty = b.quantity == null || b.quantity === '' ? 1 : Number(b.quantity);
    const price = b.unit_price == null || b.unit_price === '' ? 0 : Number(b.unit_price);
    if (!Number.isFinite(qty) || qty <= 0) return c.json({ error: 'quantity must be a positive number' }, 400);
    if (!Number.isFinite(price)) return c.json({ error: 'unit_price must be a number' }, 400);
    const lineType = normalizeLineType(b.line_type);
    const lineTotal = computeLineTotal(lineType, qty, price);
    const taxApplied = lineType === 'discount' ? 0 : (b.tax_applied ?? 1);
    await execute(db,
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, tax_applied, sort_order, line_type, linked_entity_type, linked_entity_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, b.description.trim(), qty, price, lineTotal, taxApplied, b.sort_order ?? 0, lineType,
      b.linked_entity_type ?? null, b.linked_entity_id ?? null);
    await recalcInvoiceTotal(db, invoiceId);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', invoiceId);
    return c.json({ data: shapeInvoice(updated) }, 201);
  } catch (err) {
    log.error('POST /invoices/:id/items failed', { src: 'src/routes/billing.ts' }, err);
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
    return c.json({ data: shapeInvoice(updated) });
  } catch (err) {
    log.error('DELETE /invoices/:id/items/:itemId failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to delete line item' }, 500);
  }
});

// POST /invoices/:id/generate — rebuild auto-priced lines:
//   • flat-rate contract line (line_type contract_base)
//   • one PSO Client Request line per unbilled CFS of that type in the
//     invoice period (line_type pso_client_request, linked to the call)
// Manual custom lines are left in place. Hourly/per-call contracts still
// cannot be auto-priced and are skipped (not a 400) when PSO lines exist.
billing.post('/invoices/:id/generate', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const invoiceId = parseInt(c.req.param('id'), 10);
    const invoice = await queryFirst<{
      contract_id: number | null; status: string; client_id: number | null;
      period_start: string | null; period_end: string | null;
      issue_date: string | null; due_date: string | null;
    }>(db, 'SELECT contract_id, status, client_id, period_start, period_end, issue_date, due_date FROM invoices WHERE id = ?', invoiceId);
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
    if (invoice.status !== 'draft') {
      return c.json({ error: `Cannot regenerate a '${invoice.status}' invoice — only draft invoices can be regenerated (regenerating a sent/paid invoice would silently invalidate recorded payments).` }, 400);
    }

    const stmts: { sql: string; bindings?: unknown[] }[] = [
      { sql: `DELETE FROM invoice_line_items WHERE invoice_id = ? AND (
                line_type IN ('contract', 'contract_base')
                OR (line_type = 'pso_client_request' AND linked_entity_type = 'call')
              )`, bindings: [invoiceId] },
    ];
    let inserted = 0;

    if (invoice.contract_id) {
      const contract = await queryFirst<{ contract_number: string | null; billing_cycle: string; rate_amount: number | null; rate_type: string }>(
        db, 'SELECT contract_number, billing_cycle, rate_amount, rate_type FROM client_contracts WHERE id = ?', invoice.contract_id);
      if (!contract) return c.json({ error: 'Linked contract not found' }, 404);
      if (contract.rate_type === 'flat' && contract.rate_amount != null) {
        const description = `${contract.billing_cycle} service${contract.contract_number ? ` — ${contract.contract_number}` : ''}`;
        stmts.push({
          sql: `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, tax_applied, sort_order, line_type)
                VALUES (?, ?, 1, ?, ?, 1, 0, 'contract_base')`,
          bindings: [invoiceId, description, contract.rate_amount, contract.rate_amount],
        });
        inserted++;
      }
    }

    const periodStart = invoice.period_start || invoice.issue_date;
    const periodEnd = invoice.period_end || invoice.due_date || invoice.issue_date;
    if (invoice.client_id && periodStart && periodEnd) {
      const clientRates = await queryFirst<{ rate_per_cfs: number | null; rate_per_incident: number | null }>(
        db, 'SELECT rate_per_cfs, rate_per_incident FROM clients WHERE id = ?', invoice.client_id);
      const unitPrice = Number(clientRates?.rate_per_cfs || clientRates?.rate_per_incident || 0) || 0;
      const billed = await query<{ linked_entity_id: number }>(db,
        `SELECT linked_entity_id FROM invoice_line_items
         WHERE line_type = 'pso_client_request' AND linked_entity_type = 'call'
           AND linked_entity_id IS NOT NULL AND invoice_id != ?`, invoiceId);
      const billedSet = new Set(billed.map((r) => Number(r.linked_entity_id)));
      const calls = await query<{ id: number; call_number: string | null; location_address: string | null }>(db,
        `SELECT id, call_number, location_address FROM calls_for_service
         WHERE client_id = ? AND incident_type = 'pso_client_request'
           AND date(COALESCE(received_at, created_at)) >= date(?)
           AND date(COALESCE(received_at, created_at)) <= date(?)
         ORDER BY id`,
        invoice.client_id, periodStart, periodEnd);
      let sort = 10;
      for (const call of calls) {
        if (billedSet.has(call.id)) continue;
        const num = call.call_number || `#${call.id}`;
        const addr = call.location_address ? ` — ${call.location_address}` : '';
        const description = `PSO Client Request ${num}${addr}`;
        stmts.push({
          sql: `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, tax_applied, sort_order, line_type, linked_entity_type, linked_entity_id)
                VALUES (?, ?, 1, ?, ?, 1, ?, 'pso_client_request', 'call', ?)`,
          bindings: [invoiceId, description, unitPrice, unitPrice, sort, call.id],
        });
        sort++;
        inserted++;
      }
    }

    if (inserted === 0) {
      return c.json({
        error: 'Nothing to auto-generate. Link a flat-rate contract, or add a billing period covering PSO Client Request calls for this client (or add line items manually).',
      }, 400);
    }

    await executeBatch(db, stmts);
    await recalcInvoiceTotal(db, invoiceId);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', invoiceId);
    return c.json({ data: shapeInvoice(updated) });
  } catch (err) {
    log.error('POST /invoices/:id/generate failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to regenerate line items' }, 500);
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
    // AND the filters — reassigning `where` (the old bug) dropped a condition
    // while keeping both params, causing a placeholder/bind mismatch → 500.
    const cond: string[] = ['1=1']; const params: unknown[] = [];
    if (invoiceId) { cond.push('p.invoice_id = ?'); params.push(invoiceId); }
    if (clientId) { cond.push('p.client_id = ?'); params.push(clientId); }
    const where = cond.join(' AND ');
    const rows = await query<Record<string, unknown>>(db,
      `SELECT p.*, i.invoice_number, cl.name AS client_name FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE ${where} ORDER BY p.payment_date DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('GET /payments failed', { src: 'src/routes/billing.ts' }, err);
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
    // Audit 2026-06-21: the prior `!b.amount || Number(b.amount) <= 0`
    // guard was bypassed by 'NaN <= 0 is false' for strings like
    // '100abc' — the raw string landed in INSERT INTO payments,
    // SUM(amount) silently dropped it, and the invoice never flipped
    // to 'paid'. Use Number.isFinite + positive check, and bind the
    // coerced number (not the raw body field).
    const amt = Number(b.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return c.json({ error: 'amount must be a positive number' }, 400);
    }
    const clientId = b.client_id ?? (await queryFirst<{ client_id: number }>(db, 'SELECT client_id FROM invoices WHERE id = ?', b.invoice_id))?.client_id;
    const result = await execute(db,
      `INSERT INTO payments (invoice_id, client_id, payment_date, amount, payment_method, reference_number, notes, recorded_by)
       VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?)`,
      b.invoice_id ?? null, clientId ?? null, b.payment_date ?? null, amt, b.payment_method ?? 'check', b.reference_number ?? null, b.notes ?? null, userId);
    // Update invoice paid_amount
    if (b.invoice_id) {
      const total = await queryFirst<{ amt: number }>(db, 'SELECT COALESCE(SUM(amount),0) as amt FROM payments WHERE invoice_id = ?', b.invoice_id);
      const inv = await queryFirst<{ total_amount: number }>(db, 'SELECT total_amount FROM invoices WHERE id = ?', b.invoice_id);
      let status = 'partial';
      // Require a positive invoice total — a draft with total_amount = 0 would
      // otherwise flip to 'paid' on ANY payment (amt >= 0 is always true).
      if (inv && inv.total_amount > 0 && (total?.amt ?? 0) >= inv.total_amount) status = 'paid';
      await execute(db, 'UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', total?.amt ?? 0, status, b.invoice_id);
    }
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM payments WHERE id = ?', newId);
    try {
      await recordAudit(c, {
        action: 'payment_recorded',
        entityType: 'payment',
        entityId: newId,
        details: `invoice=${b.invoice_id ?? 'n/a'} amount=${amt} method=${b.payment_method ?? 'check'}`,
        actorId: userId,
      });
    } catch { /* best-effort */ }
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('POST /payments failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to record payment' }, 500);
  }
});

billing.delete('/payments/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'contract_manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const id = parseInt(c.req.param('id'), 10);
    const payment = await queryFirst<{ invoice_id: number | null }>(db, 'SELECT invoice_id FROM payments WHERE id = ?', id);
    if (!payment) return c.json({ error: 'Payment not found' }, 404);
    await execute(db, 'DELETE FROM payments WHERE id = ?', id);
    if (payment.invoice_id) {
      const total = await queryFirst<{ amt: number }>(db, 'SELECT COALESCE(SUM(amount),0) as amt FROM payments WHERE invoice_id = ?', payment.invoice_id);
      const inv = await queryFirst<{ total_amount: number; status: string }>(db, 'SELECT total_amount, status FROM invoices WHERE id = ?', payment.invoice_id);
      const paid = total?.amt ?? 0;
      // Only derive a new status from the payment-driven states (paid/partial/sent);
      // leave draft/overdue/cancelled etc. alone — deleting a payment shouldn't
      // silently overwrite an unrelated invoice lifecycle state.
      const paymentDrivenStatuses = new Set(['paid', 'partial', 'sent']);
      let status = inv?.status;
      if (!inv || paymentDrivenStatuses.has(inv.status)) {
        status = inv && inv.total_amount > 0 && paid >= inv.total_amount ? 'paid' : (paid > 0 ? 'partial' : 'sent');
      }
      await execute(db, 'UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?', paid, status, payment.invoice_id);
    }
    try {
      await recordAudit(c, {
        action: 'payment_deleted', entityType: 'payment', entityId: id,
        details: `invoice=${payment.invoice_id ?? 'n/a'}`, actorId: userId,
      });
    } catch { /* best-effort */ }
    return c.json({ success: true });
  } catch (err) {
    log.error('DELETE /payments/:id failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to delete payment' }, 500);
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
    log.error('GET /expenses failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to list expenses' }, 500);
  }
});

// Statuses where the row's financial fields are LOCKED — once approved
// or paid, neither the amount nor the category can be changed without
// rolling back through the audit trail.
const EXPENSE_LOCKED_STATUSES = new Set(['approved', 'paid', 'reimbursed']);

billing.post('/expenses', async (c) => {
  const denied = requireRole(c, 'admin', 'manager', 'supervisor', 'officer');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    // Numeric validation that 'NaN <= 0 is false' doesn't subvert —
    // the previous guard accepted '100abc' because the string was
    // truthy. Audit 2026-06-21 caught this on /payments and it
    // applied here too.
    const amt = Number(b.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return c.json({ error: 'amount must be a positive number' }, 400);
    }
    const reportNumber = `EXP-${Date.now()}`;
    const result = await execute(db,
      `INSERT INTO expense_reports (report_number, submitter_id, category, description, amount, expense_date, receipt_url, status)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?)`,
      reportNumber, userId, b.category ?? null, b.description ?? null, amt, b.expense_date ?? null, b.receipt_url ?? null, 'submitted');
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM expense_reports WHERE id = ?', newId);
    try {
      await recordAudit(c, {
        action: 'expense_submitted',
        entityType: 'expense_report',
        entityId: newId,
        details: `${reportNumber} amount=${amt}`,
        actorId: userId,
      });
    } catch { /* best-effort */ }
    return c.json({ data: created, report_number: reportNumber }, 201);
  } catch (err) {
    log.error('POST /expenses failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to submit expense' }, 500);
  }
});

billing.put('/expenses/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, unknown>>();

    // Fraud surface caught by the 2026-06-21 audit + softened
    // 2026-06-22 follow-up: a non-admin manager can never approve
    // their OWN expense (the segregation-of-duties wall stays). But
    // an ADMIN — the operator-owner — can self-approve and edit
    // post-lock fields. Every admin self-approval is tagged loudly
    // in audit_log so it shows up on any SOX review.

    const existing = await queryFirst<{ submitter_id: number; status: string | null; amount: number; category: string | null }>(
      db, 'SELECT submitter_id, status, amount, category FROM expense_reports WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Expense not found' }, 404);

    // Note: approved_by + approved_at are NOT in the updatable set —
    // they're stamped server-side from the JWT below.
    const updatable = new Set(['category','description','amount','expense_date','receipt_url','status','notes']);

    // Self-approval rule:
    //   • manager/contract_manager approving their OWN expense → 403
    //   • admin self-approving → allowed, but tagged in audit_log
    const newStatus = typeof b.status === 'string' ? b.status : undefined;
    const actorRole = (c.get('user') as { role?: string } | undefined)?.role;
    const isAdmin = actorRole === 'admin';
    const isSelfApproval = newStatus && EXPENSE_LOCKED_STATUSES.has(newStatus) && existing.submitter_id === userId;
    if (isSelfApproval && !isAdmin) {
      return c.json({ error: 'Cannot approve your own expense report (admin override required)' }, 403);
    }

    // Post-lock financial-field freeze. Non-admin gets 409; admin can
    // edit anyway (with audit_log entry). The frozen workflow exists
    // for non-admin actors only.
    const isLocked = EXPENSE_LOCKED_STATUSES.has(existing.status || '');
    if (isLocked && !isAdmin) {
      const lockedFields = ['amount','category','expense_date'];
      for (const f of lockedFields) {
        if (f in b) return c.json({ error: `Cannot modify ${f} on a ${existing.status} expense (admin override required)` }, 409);
      }
    }

    if ('amount' in b) {
      const amt = Number(b.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return c.json({ error: 'amount must be a positive number' }, 400);
      }
      b.amount = amt;
    }

    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }

    // Server-side approver stamp. If the actor is moving status into
    // a locked state, the approver fields are set from the JWT — body
    // values for approved_by/approved_at are ignored entirely above.
    if (newStatus && EXPENSE_LOCKED_STATUSES.has(newStatus) && !isLocked) {
      sets.push('approved_by = ?'); vals.push(userId);
      sets.push("approved_at = datetime('now')");
    }

    if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
    vals.push(id);
    await execute(db, `UPDATE expense_reports SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM expense_reports WHERE id = ?', id);

    try {
      let action: string;
      if (newStatus && EXPENSE_LOCKED_STATUSES.has(newStatus) && !isLocked) {
        action = isSelfApproval ? 'expense_self_approved_admin' : 'expense_approved';
      } else if (isLocked && isAdmin) {
        action = 'expense_locked_edited_admin';
      } else {
        action = 'expense_updated';
      }
      await recordAudit(c, {
        action,
        entityType: 'expense_report',
        entityId: id,
        details: `status=${newStatus ?? existing.status}; changed=${Object.keys(b).join(',')}${isSelfApproval ? ' [SELF-APPROVAL]' : ''}${isLocked && isAdmin ? ' [POST-LOCK ADMIN EDIT]' : ''}`,
        actorId: userId,
      });
    } catch { /* best-effort */ }

    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /expenses/:id failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to update expense' }, 500);
  }
});

billing.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const invoiceTable = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='invoices'");
    // Match the happy-path key set BillingPage reads (was a divergent shape → blank tiles).
    if (!invoiceTable?.n) return c.json({ active_contracts: 0, outstanding_invoices: 0, total_outstanding_amount: 0, pending_expenses: 0 });
    const contractsActive = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM client_contracts WHERE status = 'active'"))?.count ?? 0;
    const invoicesOutstanding = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM invoices WHERE status IN ('draft','sent','partial','overdue')"))?.count ?? 0;
    const totalOutstanding = (await queryFirst<{ total: number }>(db, "SELECT COALESCE(SUM(total_amount - paid_amount),0) as total FROM invoices WHERE status NOT IN ('paid','void','cancelled')"))?.total ?? 0;
    const expensesPending = (await queryFirst<{ count: number }>(db, "SELECT COUNT(*) as count FROM expense_reports WHERE status = 'submitted'"))?.count ?? 0;
    return c.json({ active_contracts: contractsActive, outstanding_invoices: invoicesOutstanding, total_outstanding_amount: totalOutstanding, pending_expenses: expensesPending });
  } catch (err) {
    log.error('GET /stats failed', { src: 'src/routes/billing.ts' }, err);
    return c.json({ error: 'Failed to load stats' }, 500);
  }
});

export default billing;
