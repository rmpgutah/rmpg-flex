// ============================================================
// RMPG Flex — Invoices summary (InvoicesPage stats tile) + PDF data
// ============================================================
// InvoicesPage.tsx calls GET /api/invoices/stats on mount. Full invoice
// CRUD lives under /api/billing/invoices (src/routes/billing.ts); this tiny
// router only owns the /api/invoices/* namespace the page's summary tile
// uses, computed from the live `invoices` table. Legacy 500'd this path
// (live sweep 2026-06-02).
//
// 2026-06-22 (Billing audit PR #1648): added GET /:id/pdf-data — the
// denormalized payload AdminInvoiceTab's Preview/Download PDF/Print buttons
// pass into client/src/utils/invoicePdfGenerator.ts. The endpoint was
// referenced from the client but never implemented on the Worker, so all
// three PDF buttons silently 404'd. Field names match the InvoicePdfData
// interface in invoicePdfGenerator.ts exactly; missing columns in our
// schema (period_start/end, discount_amount, late_fee_amount, payment_terms)
// are filled with sensible defaults via COALESCE. line_type is a real
// column (migration 0170); missing values default to 'custom'.
// ============================================================

import { Hono } from 'hono';
import { clampIntParam } from '../utils/paginationParams';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { ensureInvoiceSchema } from './billing';

import { log } from '../utils/logger';
const invoices = new Hono<Env>();

// GET /api/invoices/stats — summary tile (wrapped in { data } per the page).
invoices.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const tbl = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='invoices'");
    if (!tbl?.n) {
      return c.json({ data: { total_invoices: 0, total_outstanding: 0, total_collected: 0, overdue_count: 0, draft_count: 0, by_status: {} } });
    }
    const agg = await queryFirst<{ cnt: number; outstanding: number; collected: number; overdue: number; draft: number }>(
      db,
      `SELECT COUNT(*) AS cnt,
              COALESCE(SUM(COALESCE(total_amount,0) - COALESCE(paid_amount,0)),0) AS outstanding,
              COALESCE(SUM(COALESCE(paid_amount,0)),0) AS collected,
              SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft
         FROM invoices`,
    );
    const byStatusRows = await query<{ status: string; count: number }>(db, "SELECT COALESCE(status,'draft') AS status, COUNT(*) AS count FROM invoices GROUP BY COALESCE(status,'draft')");
    const by_status: Record<string, number> = {};
    for (const r of byStatusRows || []) by_status[r.status] = r.count;
    return c.json({
      data: {
        total_invoices: agg?.cnt ?? 0,
        total_outstanding: agg?.outstanding ?? 0,
        total_collected: agg?.collected ?? 0,
        overdue_count: agg?.overdue ?? 0,
        draft_count: agg?.draft ?? 0,
        by_status,
      },
    });
  } catch {
    return c.json({ data: { total_invoices: 0, total_outstanding: 0, total_collected: 0, overdue_count: 0, draft_count: 0, by_status: {} } });
  }
});

// GET /api/invoices/:id/pdf-data — denormalized payload for client-side PDF generator.
//
// Shape MUST stay aligned with InvoicePdfData in
// client/src/utils/invoicePdfGenerator.ts. The client invokes this and
// passes res.data.invoice (one level of unwrap) straight into
// generateInvoicePdf / generateInvoicePdfBlobUrl / generatePrintableInvoiceHtml.
//
// Field mapping (live invoices schema -> InvoicePdfData):
//   invoices.total_amount      -> total
//   invoices.paid_amount       -> amount_paid
//   total - paid_amount        -> balance_due
//   invoice_line_items.line_total -> amount
//   invoice_line_items.line_type  -> line_type (fallback 'custom')
//   invoices.period_start/end     -> period (fallback issue_date / due_date)
//   (no discount/late_fee col) -> 0
//   clients.payment_terms      -> payment_terms (fallback 'Net 30')
//   users.full_name (created)  -> created_by_name
//   users.full_name (recorded) -> recorded_by_name on each payment
invoices.get('/:id/pdf-data', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'Invalid invoice id' }, 400);
  }
  try {
    const db = getDb(c.env);
    await ensureInvoiceSchema(db);
    const tbl = await queryFirst<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='invoices'");
    if (!tbl?.n) return c.json({ error: 'Invoice not found' }, 404);

    // Invoice + client (LEFT JOIN — invoices may legitimately have no client row)
    // and creator's full name (LEFT JOIN users on invoices.created_by).
    const inv = await queryFirst<Record<string, unknown>>(db,
      `SELECT
         i.id,
         i.invoice_number,
         COALESCE(i.status, 'draft')                          AS status,
         i.issue_date,
         i.due_date,
         COALESCE(i.subtotal, 0)                              AS subtotal,
         COALESCE(i.tax_amount, 0)                            AS tax_amount,
         COALESCE(i.total_amount, 0)                          AS total,
         COALESCE(i.paid_amount, 0)                           AS amount_paid,
         (COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0)) AS balance_due,
         0                                                     AS discount_amount,
         0                                                     AS late_fee_amount,
         i.notes,
         COALESCE(i.period_start, i.issue_date, '')           AS period_start,
         COALESCE(i.period_end,   i.due_date, i.issue_date, '') AS period_end,
         cl.name                                              AS client_name,
         cl.address                                           AS client_address,
         cl.contact_name                                      AS contact_name,
         cl.contact_email                                     AS contact_email,
         cl.contact_phone                                     AS contact_phone,
         cl.client_code                                       AS client_code,
         cl.tax_id                                            AS tax_id,
         cl.billing_email                                     AS billing_email,
         cl.billing_address                                   AS billing_address,
         COALESCE(cl.payment_terms, 'Net 30')                 AS payment_terms,
         u.full_name                                          AS created_by_name
       FROM invoices i
       LEFT JOIN clients cl ON cl.id = i.client_id
       LEFT JOIN users   u  ON u.id  = i.created_by
       WHERE i.id = ?`,
      id);
    if (!inv) return c.json({ error: 'Invoice not found' }, 404);

    // Line items — persist line_type (0170). Older rows default to custom.
    const lineItems = await query<Record<string, unknown>>(db,
      `SELECT
         COALESCE(line_type, 'custom')        AS line_type,
         description,
         COALESCE(quantity, 0)              AS quantity,
         COALESCE(unit_price, 0)            AS unit_price,
         COALESCE(line_total, 0)            AS amount
       FROM invoice_line_items
       WHERE invoice_id = ?
       ORDER BY sort_order, id`,
      id);

    // Payments — recorded_by_name pulled via LEFT JOIN on users.
    const payments = await query<Record<string, unknown>>(db,
      `SELECT
         p.payment_date,
         COALESCE(p.amount, 0)              AS amount,
         p.payment_method,
         p.reference_number,
         u.full_name                        AS recorded_by_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.invoice_id = ?
       ORDER BY p.payment_date, p.id`,
      id);

    return c.json({
      data: {
        invoice: {
          ...inv,
          line_items: lineItems,
          payments,
        },
      },
    });
  } catch (err) {
    log.error('GET /:id/pdf-data failed', { src: 'src/routes/invoices.ts' }, err);
    return c.json({ error: 'Failed to load invoice PDF data' }, 500);
  }
});

// GET /api/invoices — paginated list for InvoicesPage
invoices.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const tbl = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='invoices'");
    if (!tbl?.n) return c.json({ data: [], total: 0 });
    const page = clampIntParam(c.req.query('page'), 1, 1, 1000000);
    const limit = clampIntParam(c.req.query('limit'), 50, 1, 200);
    const offset = (page - 1) * limit;
    const total = await queryFirst<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM invoices');
    const rows = await query<Record<string, unknown>>(db,
      'SELECT * FROM invoices ORDER BY created_at DESC LIMIT ? OFFSET ?', limit, offset);
    return c.json({ data: rows, total: total?.cnt ?? 0, page, limit });
  } catch {
    return c.json({ data: [], total: 0 });
  }
});

const INVOICE_WRITE_ROLES = ['admin', 'manager', 'contract_manager'] as const;

// Aliases for InvoicesPage, which historically called /api/invoices/* for
// mutations while CRUD actually lives under /api/billing/invoices.
invoices.post('/', requireRole(...INVOICE_WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const b = await c.req.json<Record<string, unknown>>();
    if (!b.client_id) return c.json({ error: 'client_id required' }, 400);
    const invoiceNumber = await generateInvoiceNumber(db);
    const dueDate = (b.due_date as string | undefined) ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const result = await execute(db,
      `INSERT INTO invoices (invoice_number, client_id, contract_id, issue_date, due_date, tax_rate, status, notes, created_by)
       VALUES (?, ?, ?, date('now'), ?, ?, ?, ?, ?)`,
      invoiceNumber, b.client_id, b.contract_id ?? null, dueDate, b.tax_rate ?? 0, 'draft', b.notes ?? null, userId);
    const newId = Number(result.meta.last_row_id);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM invoices WHERE id = ?', newId);
    return c.json({ data: created, invoice_number: invoiceNumber }, 201);
  } catch (err) {
    log.error('POST /api/invoices failed', { src: 'src/routes/invoices.ts' }, err);
    return c.json({ error: 'Failed to create invoice' }, 500);
  }
});

invoices.post('/:id/generate', requireRole(...INVOICE_WRITE_ROLES), async (c) => {
  const invoiceId = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return c.json({ error: 'Invalid invoice id' }, 400);
  }
  try {
    const result = await regenerateDraftInvoiceLines(getDb(c.env), invoiceId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ data: result.data });
  } catch (err) {
    log.error('POST /api/invoices/:id/generate failed', { src: 'src/routes/invoices.ts' }, err);
    return c.json({ error: 'Failed to regenerate line items' }, 500);
  }
});

const VALID_INVOICE_STATUSES = new Set(['draft', 'sent', 'partial', 'paid', 'overdue', 'void', 'cancelled']);

invoices.put('/:id/status', requireRole(...INVOICE_WRITE_ROLES), async (c) => {
  const invoiceId = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
    return c.json({ error: 'Invalid invoice id' }, 400);
  }
  try {
    const b = await c.req.json<{ status?: string }>();
    const status = String(b.status || '');
    if (!VALID_INVOICE_STATUSES.has(status)) {
      return c.json({ error: `invalid status: ${status}` }, 400);
    }
    await execute(getDb(c.env), `UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, invoiceId);
    const updated = await queryFirst<Record<string, unknown>>(getDb(c.env), 'SELECT * FROM invoices WHERE id = ?', invoiceId);
    if (!updated) return c.json({ error: 'Invoice not found' }, 404);
    return c.json({ data: updated });
  } catch (err) {
    log.error('PUT /api/invoices/:id/status failed', { src: 'src/routes/invoices.ts' }, err);
    return c.json({ error: 'Failed to update status' }, 500);
  }
});

export default invoices;
