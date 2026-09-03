// src/routes/serveBilling.ts
// ============================================================
// RMPG Flex — Process Service Contracts billing
// Pricing rate card, per-contract PS terms, computed serve
// charges (review-gated), and invoice generation from charges.
// Mounted at /api/billing alongside billing.ts (Hono path-matches).
// Migration: 0104_process_service_billing.sql
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { loadPricing, loadTerms } from '../utils/serveChargeStore';
import { computeServeCharges, type ServeJobFacts } from '../utils/serveCharges';

const psb = new Hono<Env>();

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}
const MANAGE = ['admin', 'manager', 'contract_manager'];
const REVIEW = ['admin', 'manager', 'contract_manager', 'supervisor'];

/**
 * Parse a caller-supplied numeric field, or return null if it is not a finite
 * number.
 *
 * This exists because `Number(x) || 0` — the idiom previously used on the
 * pricing rate card — turns invalid input into a VALID ZERO. On a rate card
 * that means a typo silently creates a line item that bills nothing, with a
 * 201 and no complaint. The PUT path was worse: it had no guard at all, so a
 * bad value bound NaN straight into D1 and destroyed a rate that had been
 * correct.
 *
 * Money fields must fail loudly. Callers turn a null into a 400.
 */
function finiteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function logAudit(db: ReturnType<typeof getDb>, userId: number | null, action: string, entityType: string, entityId: number | null, details: unknown) {
  try {
    await execute(db,
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
      userId, action, entityType, entityId, JSON.stringify(details ?? {}));
  } catch { /* audit must never break the write */ }
}

// ── Pricing rate card ──────────────────────────────────────
psb.get('/ps-pricing/items', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM ps_pricing_items ORDER BY sort_order, id');
  return c.json({ data: rows });
});

// GET /cost-estimate?contract_id=&priority=&attempts=&skip_trace=&mileage=&wait_hours=
// Quote the fee for a serve BEFORE it's worked — same pure pricing engine the
// post-completion charge uses, so the estimate matches the eventual bill. Used at
// intake to show the client what a job will cost under their contract.
psb.get('/cost-estimate', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const num = (q: string | undefined): number | null => {
    if (q == null || q === '') return null; const n = Number(q); return Number.isFinite(n) ? n : null;
  };
  const contractId = num(c.req.query('contract_id'));
  const facts: ServeJobFacts = {
    serve_queue_id: 0,
    priority: c.req.query('priority') || 'normal',
    attempt_count: Math.max(1, Math.round(num(c.req.query('attempts')) ?? 1)),
    has_skip_trace: c.req.query('skip_trace') === '1' || c.req.query('skip_trace') === 'true',
    mileage: num(c.req.query('mileage')),
    wait_hours: num(c.req.query('wait_hours')),
  };
  const [pricing, terms] = await Promise.all([loadPricing(db), loadTerms(db, contractId)]);
  const computed = computeServeCharges(facts, terms, pricing);
  return c.json({
    contract_id: contractId, priority: facts.priority, attempts: facts.attempt_count,
    subtotal: computed.subtotal, lines: computed.lines,
  });
});

psb.post('/ps-pricing/items', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  if (!b.code || !b.label) return c.json({ error: 'code and label required' }, 400);

  // `amount` is required and must be a real number. Previously this was
  // `Number(b.amount) || 0`, so "12.5o" or an empty object created a $0.00
  // rate and returned 201 — the operator saw success and the item billed
  // nothing until someone noticed the invoice was short.
  const amount = finiteNumber(b.amount);
  if (amount === null) return c.json({ error: 'amount must be a number', code: 'BAD_AMOUNT' }, 400);
  if (amount < 0) return c.json({ error: 'amount cannot be negative', code: 'BAD_AMOUNT' }, 400);
  const attemptsIncluded = b.attempts_included === undefined ? 0 : finiteNumber(b.attempts_included);
  if (attemptsIncluded === null) return c.json({ error: 'attempts_included must be a number', code: 'BAD_INPUT' }, 400);
  const sortOrder = b.sort_order === undefined ? 0 : finiteNumber(b.sort_order);
  if (sortOrder === null) return c.json({ error: 'sort_order must be a number', code: 'BAD_INPUT' }, 400);

  const user = c.get('user') as { id: number } | undefined;
  const ins = await execute(db,
    `INSERT INTO ps_pricing_items (code, label, unit, amount, taxable, attempts_included, sort_order, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    b.code, b.label, b.unit ?? 'per_serve', amount, b.taxable ? 1 : 0,
    attemptsIncluded, sortOrder, user?.id ?? null);
  const id = Number(ins.meta.last_row_id);
  await logAudit(db, user?.id ?? null, 'create', 'ps_pricing_item', id, b);
  const created = await queryFirst(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  return c.json({ data: created }, 201);
});

psb.put('/ps-pricing/items/:id', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const before = await queryFirst<any>(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  if (!before) return c.json({ error: 'Not found' }, 404);
  const b = await c.req.json<any>();

  // Every numeric field here was previously an unguarded `Number(...)`, so a
  // malformed value bound NaN directly into D1 — overwriting a rate that had
  // been correct. A partial update must never be able to destroy the field it
  // is not validly changing, so reject rather than coerce.
  let amount = before.amount;
  if (b.amount !== undefined) {
    const parsed = finiteNumber(b.amount);
    if (parsed === null) return c.json({ error: 'amount must be a number', code: 'BAD_AMOUNT' }, 400);
    if (parsed < 0) return c.json({ error: 'amount cannot be negative', code: 'BAD_AMOUNT' }, 400);
    amount = parsed;
  }
  let attemptsIncluded = before.attempts_included;
  if (b.attempts_included !== undefined) {
    const parsed = finiteNumber(b.attempts_included);
    if (parsed === null) return c.json({ error: 'attempts_included must be a number', code: 'BAD_INPUT' }, 400);
    attemptsIncluded = parsed;
  }
  let sortOrder = before.sort_order;
  if (b.sort_order !== undefined) {
    const parsed = finiteNumber(b.sort_order);
    if (parsed === null) return c.json({ error: 'sort_order must be a number', code: 'BAD_INPUT' }, 400);
    sortOrder = parsed;
  }

  const user = c.get('user') as { id: number } | undefined;
  await execute(db,
    `UPDATE ps_pricing_items SET
       label = ?, unit = ?, amount = ?, taxable = ?, attempts_included = ?, is_active = ?, sort_order = ?,
       updated_at = datetime('now'), updated_by = ?
     WHERE id = ?`,
    b.label ?? before.label, b.unit ?? before.unit,
    amount,
    b.taxable !== undefined ? (b.taxable ? 1 : 0) : before.taxable,
    attemptsIncluded,
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : before.is_active,
    sortOrder,
    user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'update', 'ps_pricing_item', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM ps_pricing_items WHERE id = ?', id);
  return c.json({ data: after });
});

psb.delete('/ps-pricing/items/:id', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user') as { id: number } | undefined;
  // Soft-delete: charges reference codes historically.
  await execute(db, `UPDATE ps_pricing_items SET is_active = 0, updated_at = datetime('now'), updated_by = ? WHERE id = ?`, user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'deactivate', 'ps_pricing_item', id, {});
  return c.json({ success: true });
});

// ── Per-contract process-service terms ─────────────────────
psb.get('/contracts/:id/ps-terms', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const row = await queryFirst(db, 'SELECT * FROM ps_contract_terms WHERE contract_id = ?', id);
  // 404-safe: return defaults so the UI can render an empty form.
  return c.json({ data: row ?? { contract_id: id, billing_trigger: 'on_completion', sla_days: null, retainer_amount: null, doc_types_json: null, rate_overrides_json: null, notes: null } });
});

psb.put('/contracts/:id/ps-terms', async (c) => {
  const denied = requireRole(c, ...MANAGE);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  const before = await queryFirst<any>(db, 'SELECT * FROM ps_contract_terms WHERE contract_id = ?', id);
  const overridesJson = b.rate_overrides_json
    ? (typeof b.rate_overrides_json === 'string' ? b.rate_overrides_json : JSON.stringify(b.rate_overrides_json))
    : (b.rate_overrides ? JSON.stringify(b.rate_overrides) : null);
  const docTypesJson = b.doc_types_json
    ? (typeof b.doc_types_json === 'string' ? b.doc_types_json : JSON.stringify(b.doc_types_json))
    : (b.doc_types ? JSON.stringify(b.doc_types) : null);
  await execute(db,
    `INSERT INTO ps_contract_terms (contract_id, billing_trigger, sla_days, retainer_amount, doc_types_json, rate_overrides_json, notes, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(contract_id) DO UPDATE SET
       billing_trigger = excluded.billing_trigger, sla_days = excluded.sla_days,
       retainer_amount = excluded.retainer_amount, doc_types_json = excluded.doc_types_json,
       rate_overrides_json = excluded.rate_overrides_json, notes = excluded.notes,
       updated_at = datetime('now'), updated_by = excluded.updated_by`,
    id, b.billing_trigger ?? 'on_completion', b.sla_days ?? null, b.retainer_amount ?? null,
    docTypesJson, overridesJson, b.notes ?? null, user?.id ?? null);
  await logAudit(db, user?.id ?? null, before ? 'update' : 'create', 'ps_contract', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM ps_contract_terms WHERE contract_id = ?', id);
  return c.json({ data: after });
});

// ── Audit history for a contract (from activity_log) ───────
psb.get('/contracts/:id/audit', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const rows = await query(db,
    `SELECT a.id, a.action, a.entity_type, a.details, a.created_at, u.full_name AS user_name
       FROM activity_log a LEFT JOIN users u ON a.user_id = u.id
      WHERE a.entity_type = 'ps_contract' AND a.entity_id = ?
      ORDER BY a.id DESC LIMIT 100`, id);
  return c.json({ data: rows });
});

// ── Serve charges review queue ─────────────────────────────
psb.get('/serve-charges', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const status = c.req.query('status') ?? 'pending_review';
  const charges = await query<any>(db,
    `SELECT sc.*, q.defendant_name, q.case_number, q.recipient_name, cl.name AS client_name
       FROM serve_charges sc
       JOIN serve_queue q ON sc.serve_queue_id = q.id
       LEFT JOIN client_contracts cc ON sc.contract_id = cc.id
       LEFT JOIN clients cl ON cc.client_id = cl.id
      WHERE sc.status = ?
      ORDER BY sc.computed_at DESC LIMIT 500`, status);
  for (const ch of charges) {
    ch.lines = await query(db, 'SELECT * FROM serve_charge_lines WHERE serve_charge_id = ? ORDER BY id', ch.id);
  }
  return c.json({ data: charges });
});

psb.put('/serve-charges/:id', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const current = await queryFirst<any>(db, 'SELECT status FROM serve_charges WHERE id = ?', id);
  if (!current) return c.json({ error: 'Not found' }, 404);
  if (current.status === 'invoiced') return c.json({ error: 'Charge already invoiced — locked' }, 409);
  const b = await c.req.json<any>();
  const user = c.get('user') as { id: number } | undefined;
  const before = await queryFirst<any>(db, 'SELECT * FROM serve_charges WHERE id = ?', id);

  if (Array.isArray(b.lines)) {
    // ⚠️ Validate EVERY line before touching the table. This handler deletes the
    // existing lines and rebuilds them, so validating inside the rebuild loop is
    // too late — the real lines are already gone by then. Combined with the old
    // `Number(x) || 0`, a malformed payload silently replaced a priced charge
    // with $0.00 rows and reported success.
    const parsedLines: Array<{ pricing_code: string | null; description: string; quantity: number; unit_price: number; line_total: number; taxable: number }> = [];
    for (const [i, l] of (b.lines as any[]).entries()) {
      const quantity = finiteNumber(l?.quantity);
      const unitPrice = finiteNumber(l?.unit_price);
      if (quantity === null) {
        return c.json({ error: `line ${i + 1}: quantity must be a number`, code: 'BAD_LINE' }, 400);
      }
      if (unitPrice === null) {
        return c.json({ error: `line ${i + 1}: unit_price must be a number`, code: 'BAD_LINE' }, 400);
      }
      if (quantity < 0 || unitPrice < 0) {
        return c.json({ error: `line ${i + 1}: quantity and unit_price cannot be negative`, code: 'BAD_LINE' }, 400);
      }
      parsedLines.push({
        pricing_code: l?.pricing_code ?? null,
        description: l?.description ?? '',
        quantity,
        unit_price: unitPrice,
        line_total: Math.round(quantity * unitPrice * 100) / 100,
        taxable: l?.taxable ? 1 : 0,
      });
    }

    await execute(db, 'DELETE FROM serve_charge_lines WHERE serve_charge_id = ?', id);
    let subtotal = 0;
    for (const l of parsedLines) {
      subtotal += l.line_total;
      await execute(db,
        `INSERT INTO serve_charge_lines (serve_charge_id, pricing_code, description, quantity, unit_price, line_total, taxable)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id, l.pricing_code, l.description, l.quantity, l.unit_price, l.line_total, l.taxable);
    }
    await execute(db, `UPDATE serve_charges SET subtotal = ? WHERE id = ?`, Math.round(subtotal * 100) / 100, id);
  }
  if (b.contract_id !== undefined) {
    await execute(db, 'UPDATE serve_charges SET contract_id = ? WHERE id = ?', b.contract_id ?? null, id);
  }
  if (b.notes !== undefined) {
    await execute(db, 'UPDATE serve_charges SET notes = ? WHERE id = ?', b.notes ?? null, id);
  }
  await logAudit(db, user?.id ?? null, 'update', 'serve_charge', id, { before, after: b });
  const after = await queryFirst(db, 'SELECT * FROM serve_charges WHERE id = ?', id);
  return c.json({ data: after });
});

psb.post('/serve-charges/:id/approve', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const cur = await queryFirst<any>(db, 'SELECT status FROM serve_charges WHERE id = ?', id);
  if (!cur) return c.json({ error: 'Not found' }, 404);
  if (cur.status === 'invoiced') return c.json({ error: 'Already invoiced' }, 409);
  const user = c.get('user') as { id: number } | undefined;
  await execute(db, `UPDATE serve_charges SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`, user?.id ?? null, id);
  await logAudit(db, user?.id ?? null, 'approve', 'serve_charge', id, {});
  return c.json({ success: true });
});

psb.post('/serve-charges/:id/void', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const cur = await queryFirst<any>(db, 'SELECT status FROM serve_charges WHERE id = ?', id);
  if (!cur) return c.json({ error: 'Not found' }, 404);
  if (cur.status === 'invoiced') return c.json({ error: 'Already invoiced' }, 409);
  const b = await c.req.json<any>().catch(() => ({}));
  const user = c.get('user') as { id: number } | undefined;
  await execute(db, `UPDATE serve_charges SET status = 'void', notes = ? WHERE id = ?`, b.notes ?? null, id);
  await logAudit(db, user?.id ?? null, 'void', 'serve_charge', id, { notes: b.notes ?? null });
  return c.json({ success: true });
});

psb.post('/serve-charges/:id/recompute', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);
  const charge = await queryFirst<any>(db, 'SELECT serve_queue_id, status FROM serve_charges WHERE id = ?', id);
  if (!charge) return c.json({ error: 'Not found' }, 404);
  if (charge.status === 'invoiced') return c.json({ error: 'Already invoiced' }, 409);
  const { generateServeCharges } = await import('../utils/serveChargeStore');
  const newId = await generateServeCharges(db, charge.serve_queue_id);
  return c.json({ success: newId !== null });
});

async function nextInvoiceNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `INV-${yy}-`;
  // Each retry increments by 1 from the last known maximum — NOT by the loop
  // index. The previous `+ skip` compound produced gaps (1, 3, 6, …) under
  // write contention. Cap at 20 iterations (not 10) for safety; a 500 here is
  // preferable to an infinite CPU spin inside a Workers request.
  for (let attempt = 0; attempt < 20; attempt++) {
    const last = await queryFirst<{ invoice_number: string }>(db, 'SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
    const m = last?.invoice_number?.match(/^INV-\d{2}-(\d+)$/);
    const n = m ? parseInt(m[1], 10) + 1 : 1;
    const candidate = `${prefix}${String(n).padStart(4, '0')}`;
    const exists = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM invoices WHERE invoice_number = ? LIMIT 1', candidate,
    );
    if (!exists) return candidate;
  }
  // Exhausted all attempts — surface a hard error rather than silently minting
  // a potentially-conflicting number. The caller's 5-retry loop will catch it.
  throw new Error(`[billing] Could not allocate a unique invoice number after 20 attempts for prefix ${prefix}`);
}

psb.post('/invoices/from-serve-charges', async (c) => {
  const denied = requireRole(c, ...REVIEW);
  if (denied) return c.json({ error: denied, code: 'FORBIDDEN' }, 403);
  const db = getDb(c.env);
  const b = await c.req.json<any>();
  const { from, to } = b;
  if (!from || !to) return c.json({ error: 'from and to dates required' }, 400);

  const conds = ["sc.status = 'approved'", 'date(sc.computed_at) >= date(?)', 'date(sc.computed_at) <= date(?)'];
  const params: unknown[] = [from, to];
  if (b.contract_id) { conds.push('sc.contract_id = ?'); params.push(b.contract_id); }
  if (b.client_id) { conds.push('cc.client_id = ?'); params.push(b.client_id); }
  const charges = await query<any>(db,
    `SELECT sc.id, sc.contract_id, cc.client_id
       FROM serve_charges sc LEFT JOIN client_contracts cc ON sc.contract_id = cc.id
      WHERE ${conds.join(' AND ')}`, ...params);
  if (charges.length === 0) return c.json({ data: { invoices: [], skipped_no_contract: 0 }, message: 'No approved charges in range' });

  // Group approved charges by contract so each invoice ties to exactly ONE
  // contract/client. Charges with no contract cannot be billed — skip them
  // (the UI blocks approving contract-less charges, but the API allows it).
  const byContract = new Map<number, { client_id: number | null; ids: number[] }>();
  let skippedNoContract = 0;
  for (const ch of charges) {
    if (!ch.contract_id) { skippedNoContract++; continue; }
    const g = byContract.get(ch.contract_id) ?? { client_id: (ch.client_id ?? null) as number | null, ids: [] as number[] };
    g.ids.push(Number(ch.id));
    byContract.set(ch.contract_id, g);
  }
  if (byContract.size === 0) {
    return c.json({ data: { invoices: [], skipped_no_contract: skippedNoContract }, message: 'No billable approved charges (none had a contract).' });
  }

  const user = c.get('user') as { id: number } | undefined;
  const invoices: Array<{ invoice_id: number; invoice_number: string; contract_id: number; client_id: number | null; charge_count: number; subtotal: number }> = [];

  for (const [contractId, group] of byContract) {
    // Atomic invoice number: retry on UNIQUE collision (same pattern as call_number).
    let invoiceId: number | null = null;
    let invNumber = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      invNumber = await nextInvoiceNumber(db);
      try {
        const invIns = await execute(db,
          `INSERT INTO invoices (invoice_number, client_id, contract_id, issue_date, subtotal, tax_rate, tax_amount, total_amount)
           VALUES (?, ?, ?, date('now'), 0, 0, 0, 0)`,
          invNumber, group.client_id, contractId);
        invoiceId = Number(invIns.meta.last_row_id);
        break;
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
        if (attempt < 4 && (msg.includes('unique') || msg.includes('2067'))) continue;
        throw err;
      }
    }
    if (invoiceId == null) continue;

    // Collect all dependent writes as a batch so they succeed or fail atomically.
    // The invoice header INSERT is outside the batch (we need last_row_id first);
    // if the batch fails we clean up the orphaned header row ourselves.
    let subtotal = 0;
    const batchStmts: D1PreparedStatement[] = [];
    for (const chargeId of group.ids) {
      const lines = await query<any>(db, 'SELECT * FROM serve_charge_lines WHERE serve_charge_id = ?', chargeId);
      for (const l of lines) {
        subtotal += finiteNumber(l.line_total) ?? 0;
        batchStmts.push(
          db.prepare(`INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, line_total, tax_applied)
                      VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(invoiceId, l.description, l.quantity, l.unit_price, l.line_total, l.taxable ? 1 : 0),
        );
      }
      batchStmts.push(
        db.prepare(`UPDATE serve_charges SET status = 'invoiced', invoice_id = ? WHERE id = ?`)
          .bind(invoiceId, chargeId),
      );
    }
    subtotal = Math.round(subtotal * 100) / 100;
    batchStmts.push(
      db.prepare(`UPDATE invoices SET subtotal = ?, total_amount = ? WHERE id = ?`)
        .bind(subtotal, subtotal, invoiceId),
    );
    try {
      await db.batch(batchStmts);
    } catch (batchErr) {
      // Clean up the orphaned invoice header so the charge IDs remain billable.
      await execute(db, `DELETE FROM invoices WHERE id = ?`, invoiceId).catch(() => {});
      throw batchErr;
    }
    await logAudit(db, user?.id ?? null, 'invoice', 'serve_charge', invoiceId, { invoice_number: invNumber, contract_id: contractId, charge_ids: group.ids });
    invoices.push({ invoice_id: invoiceId, invoice_number: invNumber, contract_id: contractId, client_id: group.client_id, charge_count: group.ids.length, subtotal });
  }

  return c.json({ data: { invoices, skipped_no_contract: skippedNoContract } }, 201);
});

export default psb;
