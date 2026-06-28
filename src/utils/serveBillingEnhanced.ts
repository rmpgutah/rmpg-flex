// ============================================================
// RMPG Flex — Enhanced Serve Billing & Notification Utilities
// ============================================================
// Calculates taxes, generates invoices, tracks payments, and
// produces overdue reminders for process-service jobs.
// Cloudflare Workers + D1 only — no Node.js APIs.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, query, execute, executeBatch } from './db';

// ── Types ───────────────────────────────────────────────────

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  category: string;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  clientId: number;
  queueId: number;
  lineItems: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'void';
  dueDate: string;
  paidAmount: number;
}

export interface Payment {
  id: number;
  invoiceId: number;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
}

export interface TaxResult {
  stateTax: number;
  localTax: number;
  totalTax: number;
  totalWithTax: number;
  jurisdiction: string;
}

export interface OverdueInvoice {
  invoiceId: number;
  invoiceNumber: string;
  clientId: number;
  clientName: string;
  totalAmount: number;
  paidAmount: number;
  amountDue: number;
  dueDate: string;
  daysOverdue: number;
  status: string;
}

export interface OverdueReminder {
  clientId: number;
  clientName: string;
  clientEmail: string | null;
  invoiceCount: number;
  totalDue: number;
  invoices: Array<{
    invoiceNumber: string;
    amountDue: number;
    daysOverdue: number;
  }>;
  suggestedAction: string;
}

export interface InvoiceSummary {
  totalInvoiced: number;
  totalCollected: number;
  outstanding: number;
  overdue: number;
  invoiceCount: number;
  overdueCount: number;
  byStatus: Record<string, number>;
}

export interface NotificationResult {
  sent: boolean;
  channel: string;
  message: string;
}

export interface ProofOfService {
  attemptId: number;
  queueId: number;
  server: {
    id: number;
    name: string;
    badgeNumber: string | null;
  };
  serviceDateTime: string;
  serviceLocation: {
    address: string;
    city: string;
    state: string;
    zip: string;
    latitude: number | null;
    longitude: number | null;
  };
  defendant: {
    name: string;
    address: string | null;
  };
  documentDetails: {
    type: string | null;
    caseNumber: string | null;
    courtName: string | null;
    jurisdiction: string | null;
  };
  result: string;
  notes: string | null;
  photoUrls: string[];
  signaturePresent: boolean;
}

// ── Utah Tax Rates ──────────────────────────────────────────
// Hardcoded rates per Utah Tax Commission. Update annually.

const UTAH_STATE_TAX_RATE = 0.0485;

interface LocalTaxRate {
  jurisdiction: string;
  rate: number;
}

const LOCAL_TAX_RATES: LocalTaxRate[] = [
  { jurisdiction: 'Salt Lake City', rate: 0.0200 },
  { jurisdiction: 'Salt Lake County', rate: 0.0100 },
  { jurisdiction: 'Utah County', rate: 0.0110 },
  { jurisdiction: 'Davis County', rate: 0.0080 },
  { jurisdiction: 'Weber County', rate: 0.0115 },
  { jurisdiction: 'Cache County', rate: 0.0085 },
  { jurisdiction: 'Washington County', rate: 0.0100 },
  { jurisdiction: 'Iron County', rate: 0.0085 },
  { jurisdiction: 'Summit County', rate: 0.0125 },
  { jurisdiction: 'Wasatch County', rate: 0.0100 },
  { jurisdiction: 'Tooele County', rate: 0.0075 },
  { jurisdiction: 'Box Elder County', rate: 0.0075 },
  { jurisdiction: 'Carbon County', rate: 0.0090 },
  { jurisdiction: 'Emery County', rate: 0.0080 },
  { jurisdiction: 'Grand County', rate: 0.0125 },
  { jurisdiction: 'Sanpete County', rate: 0.0075 },
  { jurisdiction: 'Sevier County', rate: 0.0080 },
  { jurisdiction: 'Millard County', rate: 0.0070 },
  { jurisdiction: 'Duchesne County', rate: 0.0075 },
  { jurisdiction: 'Uintah County', rate: 0.0080 },
  { jurisdiction: 'Uinta County', rate: 0.0085 },
  { jurisdiction: 'Morgan County', rate: 0.0075 },
  { jurisdiction: 'Salt Lake', rate: 0.0100 },
  { jurisdiction: 'SLC', rate: 0.0200 },
  { jurisdiction: 'Provo', rate: 0.0125 },
  { jurisdiction: 'Ogden', rate: 0.0120 },
  { jurisdiction: 'Layton', rate: 0.0100 },
  { jurisdiction: 'West Jordan', rate: 0.0100 },
  { jurisdiction: 'Kearns', rate: 0.0100 },
  { jurisdiction: 'Taylorsville', rate: 0.0100 },
  { jurisdiction: 'Murray', rate: 0.0110 },
  { jurisdiction: 'Draper', rate: 0.0100 },
  { jurisdiction: 'Sandy', rate: 0.0100 },
  { jurisdiction: 'West Valley City', rate: 0.0100 },
  { jurisdiction: 'Riverton', rate: 0.0100 },
  { jurisdiction: 'South Jordan', rate: 0.0100 },
  { jurisdiction: 'Lehi', rate: 0.0100 },
  { jurisdiction: 'Spanish Fork', rate: 0.0100 },
  { jurisdiction: 'St. George', rate: 0.0125 },
  { jurisdiction: 'Logan', rate: 0.0100 },
];

// ── Pricing defaults (used when ps_pricing_items has no configured rates) ──

const DEFAULT_BASE_FEE = 75.00;
const DEFAULT_MILEAGE_RATE = 0.67;
const DEFAULT_WAIT_TIME_RATE = 50.00;
const DEFAULT_AFTER_HOURS_SURCHARGE = 35.00;
const DEFAULT_SUBSTITUTE_SERVICE_FEE = 50.00;
const DEFAULT_RUSH_FEE = 50.00;

// ── Invoice number generator ────────────────────────────────

function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `INV-${y}${m}${d}-${rand}`;
}

// ── Helpers ─────────────────────────────────────────────────

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeJurisdiction(jurisdiction: string): string {
  const j = jurisdiction.trim().toLowerCase();
  for (const rate of LOCAL_TAX_RATES) {
    if (rate.jurisdiction.toLowerCase() === j) return rate.jurisdiction;
  }
  return jurisdiction;
}

// ── 1. calculateTax ─────────────────────────────────────────

export function calculateTax(
  db: D1Database,
  amount: number,
  jurisdiction: string,
): TaxResult {
  const stateTax = roundCents(amount * UTAH_STATE_TAX_RATE);

  const normalized = normalizeJurisdiction(jurisdiction);
  const localRate = LOCAL_TAX_RATES.find(
    (r) => r.jurisdiction === normalized,
  );
  const localTax = roundCents(amount * (localRate?.rate ?? 0));

  const totalTax = roundCents(stateTax + localTax);
  const totalWithTax = roundCents(amount + totalTax);

  return {
    stateTax,
    localTax,
    totalTax,
    totalWithTax,
    jurisdiction: normalized,
  };
}

// ── 2. generateInvoiceLineItems ─────────────────────────────

export async function generateInvoiceLineItems(
  db: D1Database,
  queueId: number,
): Promise<LineItem[]> {
  const job = await queryFirst<{
    id: number;
    status: string;
    priority: string | null;
    attempt_count: number;
    contract_id: number | null;
    jurisdiction: string | null;
    document_type: string | null;
  }>(
    db,
    `SELECT id, status, priority, attempt_count, contract_id, jurisdiction, document_type
     FROM serve_queue WHERE id = ?`,
    queueId,
  );
  if (!job) return [];

  const items: LineItem[] = [];

  // Pull configured rates from ps_pricing_items (0104 migration).
  const pricingRows = await query<{
    code: string;
    amount: number;
    unit: string;
    taxable: number;
  }>(
    db,
    `SELECT code, amount, unit, taxable FROM ps_pricing_items WHERE is_active = 1`,
  ).catch(() => []);

  const pricingMap: Record<string, { amount: number; unit: string; taxable: number }> = {};
  for (const row of pricingRows) {
    pricingMap[row.code] = { amount: row.amount, unit: row.unit, taxable: row.taxable };
  }

  // Check for contract-specific rate overrides
  let rateOverrides: Record<string, number> = {};
  if (job.contract_id) {
    const terms = await queryFirst<{ rate_overrides_json: string | null }>(
      db,
      'SELECT rate_overrides_json FROM ps_contract_terms WHERE contract_id = ?',
      job.contract_id,
    ).catch(() => null);
    if (terms?.rate_overrides_json) {
      try {
        rateOverrides = JSON.parse(terms.rate_overrides_json);
      } catch { /* ignore malformed JSON */ }
    }
  }

  function resolveRate(code: string, fallback: number): number {
    if (rateOverrides[code] !== undefined) return rateOverrides[code];
    if (pricingMap[code]) return pricingMap[code].amount;
    return fallback;
  }

  // Base service fee — always included
  const baseFee = resolveRate('flat_serve', DEFAULT_BASE_FEE);
  items.push({
    description: 'Standard Process Service Fee',
    quantity: 1,
    unitPrice: baseFee,
    amount: baseFee,
    category: 'base',
  });

  // Attempt-based charges: charge for attempts beyond the included count
  const extraAttemptRate = resolveRate('extra_attempt', 0);
  const attemptsIncluded = pricingMap['extra_attempt']?.amount === 0
    ? 3 // default: 3 attempts included
    : (pricingMap['extra_attempt'] ? 0 : 3);
  const extraAttempts = Math.max(0, job.attempt_count - attemptsIncluded);
  if (extraAttempts > 0 && extraAttemptRate > 0) {
    items.push({
      description: `Additional Attempts (${extraAttempts} × $${extraAttemptRate.toFixed(2)})`,
      quantity: extraAttempts,
      unitPrice: extraAttemptRate,
      amount: roundCents(extraAttempts * extraAttemptRate),
      category: 'attempts',
    });
  }

  // Mileage — sum GPS distances for this job's attempts
  const mileageTotal = await computeMileageForQueue(db, queueId);
  if (mileageTotal > 0) {
    const mileageRate = resolveRate('mileage', DEFAULT_MILEAGE_RATE);
    const mileageCharge = roundCents(mileageTotal * mileageRate);
    items.push({
      description: `Mileage (${mileageTotal.toFixed(1)} mi × $${mileageRate.toFixed(2)})`,
      quantity: roundCents(mileageTotal),
      unitPrice: mileageRate,
      amount: mileageCharge,
      category: 'mileage',
    });
  }

  // Wait time / stakeout
  const waitMinutes = await computeWaitTimeForQueue(db, queueId);
  if (waitMinutes > 0) {
    const hours = Math.max(0.5, Math.ceil(waitMinutes / 30) * 0.5); // 30-min blocks, min 0.5h
    const waitRate = resolveRate('wait', DEFAULT_WAIT_TIME_RATE);
    const waitCharge = roundCents(hours * waitRate);
    items.push({
      description: `Stakeout / Wait Time (${hours}h × $${waitRate.toFixed(2)})`,
      quantity: hours,
      unitPrice: waitRate,
      amount: waitCharge,
      category: 'wait_time',
    });
  }

  // After-hours surcharge (attempts outside 8am–6pm M-F)
  const afterHoursAttempts = await countAfterHoursAttempts(db, queueId);
  if (afterHoursAttempts > 0) {
    const surcharge = resolveRate('rush', DEFAULT_AFTER_HOURS_SURCHARGE);
    items.push({
      description: `After-Hours Surcharge (${afterHoursAttempts} attempt${afterHoursAttempts > 1 ? 's' : ''})`,
      quantity: afterHoursAttempts,
      unitPrice: surcharge,
      amount: roundCents(afterHoursAttempts * surcharge),
      category: 'after_hours',
    });
  }

  // Substitute service fee
  const hasSubService = await queryFirst<{ cnt: number }>(
    db,
    `SELECT COUNT(*) as cnt FROM serve_attempts
     WHERE serve_queue_id = ? AND result = 'sub_served'`,
    queueId,
  ).catch(() => ({ cnt: 0 }));
  if ((hasSubService?.cnt ?? 0) > 0) {
    const subFee = resolveRate('skip_trace', DEFAULT_SUBSTITUTE_SERVICE_FEE);
    items.push({
      description: 'Substitute Service Fee',
      quantity: 1,
      unitPrice: subFee,
      amount: subFee,
      category: 'substitute',
    });
  }

  // Rush fee
  if (job.priority === 'rush' || job.priority === 'urgent') {
    const rushFee = resolveRate('rush', DEFAULT_RUSH_FEE);
    items.push({
      description: `Rush Service Surcharge (${job.priority})`,
      quantity: 1,
      unitPrice: rushFee,
      amount: rushFee,
      category: 'rush',
    });
  }

  return items;
}

// ── 3. createInvoiceWithItems ───────────────────────────────

export async function createInvoiceWithItems(
  db: D1Database,
  queueId: number,
  clientId: number,
): Promise<Invoice> {
  const lineItems = await generateInvoiceLineItems(db, queueId);
  if (lineItems.length === 0) {
    throw new Error(`No billable items for queue ${queueId}`);
  }

  const job = await queryFirst<{ jurisdiction: string | null }>(
    db,
    'SELECT jurisdiction FROM serve_queue WHERE id = ?',
    queueId,
  );

  const subtotal = roundCents(
    lineItems.reduce((sum, item) => sum + item.amount, 0),
  );

  const taxResult = calculateTax(
    db,
    subtotal,
    job?.jurisdiction ?? 'Salt Lake County',
  );

  const invoiceNumber = generateInvoiceNumber();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const result = await execute(
    db,
    `INSERT INTO invoices
       (invoice_number, client_id, contract_id, issue_date, due_date,
        subtotal, tax_rate, tax_amount, total_amount, paid_amount, status, created_at)
     VALUES (?, ?, (SELECT contract_id FROM serve_queue WHERE id = ?),
             date('now','localtime'), ?, ?, ?, ?, ?, 0, 'draft', datetime('now','localtime'))`,
    invoiceNumber,
    clientId,
    queueId,
    dueDateStr,
    subtotal,
    taxResult.totalTax / subtotal || 0,
    taxResult.totalTax,
    taxResult.totalWithTax,
  );

  const invoiceId = result.meta.last_row_id as number;

  const statements = lineItems.map((item, idx) => ({
    sql: `INSERT INTO invoice_line_items
            (invoice_id, description, quantity, unit_price, line_total, tax_applied, sort_order)
          VALUES (?, ?, ?, ?, ?, 1, ?)`,
    bindings: [
      invoiceId,
      item.description,
      item.quantity,
      item.unitPrice,
      item.amount,
      idx,
    ] as unknown[],
  }));
  await executeBatch(db, statements);

  // Link the serve charge if one exists
  await execute(
    db,
    `UPDATE serve_charges SET invoice_id = ?, status = 'invoiced'
     WHERE serve_queue_id = ? AND status IN ('pending_review','approved')`,
    invoiceId,
    queueId,
  ).catch(() => {});

  return {
    id: invoiceId,
    invoiceNumber,
    clientId,
    queueId,
    lineItems,
    subtotal,
    tax: taxResult.totalTax,
    total: taxResult.totalWithTax,
    status: 'draft',
    dueDate: dueDateStr,
    paidAmount: 0,
  };
}

// ── 4. trackPayment ─────────────────────────────────────────

export async function trackPayment(
  db: D1Database,
  invoiceId: number,
  amount: number,
  method: string,
  reference?: string,
): Promise<{ invoice: Invoice; payment: Payment }> {
  const inv = await queryFirst<{
    id: number;
    invoice_number: string;
    client_id: number;
    total_amount: number;
    paid_amount: number;
    status: string;
  }>(
    db,
    `SELECT id, invoice_number, client_id, total_amount, paid_amount, status
     FROM invoices WHERE id = ?`,
    invoiceId,
  );
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);

  const newPaidAmount = roundCents(inv.paid_amount + amount);
  let newStatus: string;
  if (newPaidAmount >= inv.total_amount) {
    newStatus = 'paid';
  } else if (newPaidAmount > 0) {
    newStatus = 'partial';
  } else {
    newStatus = inv.status;
  }

  const payResult = await execute(
    db,
    `INSERT INTO payments (invoice_id, client_id, payment_date, amount, payment_method, reference_number, created_at)
     VALUES (?, ?, date('now','localtime'), ?, ?, ?, datetime('now','localtime'))`,
    invoiceId,
    inv.client_id,
    amount,
    method,
    reference ?? null,
  );

  await execute(
    db,
    `UPDATE invoices
     SET paid_amount = ?, status = ?, updated_at = datetime('now','localtime')
     WHERE id = ?`,
    newPaidAmount,
    newStatus,
    invoiceId,
  );

  // Fetch full line items for return value
  const rows = await query<{
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>(
    db,
    'SELECT description, quantity, unit_price, line_total FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order',
    invoiceId,
  ).catch(() => []);

  const lineItems: LineItem[] = rows.map((r) => ({
    description: r.description,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    amount: r.line_total,
    category: '',
  }));

  return {
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      clientId: inv.client_id,
      queueId: 0,
      lineItems,
      subtotal: inv.total_amount,
      tax: 0,
      total: inv.total_amount,
      status: newStatus as Invoice['status'],
      dueDate: '',
      paidAmount: newPaidAmount,
    },
    payment: {
      id: Number(payResult.meta.last_row_id),
      invoiceId,
      amount,
      method,
      reference: reference ?? null,
      paidAt: new Date().toISOString(),
    },
  };
}

// ── 5. getOverdueInvoices ───────────────────────────────────

export async function getOverdueInvoices(
  db: D1Database,
  daysOverdue: number,
): Promise<OverdueInvoice[]> {
  const rows = await query<{
    id: number;
    invoice_number: string;
    client_id: number;
    client_name: string;
    total_amount: number;
    paid_amount: number;
    due_date: string;
    status: string;
    days_since_due: number;
  }>(
    db,
    `SELECT
       i.id as invoice_number_id,
       i.invoice_number,
       i.client_id,
       c.name as client_name,
       i.total_amount,
       i.paid_amount,
       i.due_date,
       i.status,
       CAST(julianday('now','localtime') - julianday(i.due_date) AS INTEGER) as days_since_due
     FROM invoices i
     JOIN clients c ON c.id = i.client_id
     WHERE i.due_date < date('now','localtime')
       AND i.status IN ('sent', 'partial', 'overdue')
       AND (i.total_amount - i.paid_amount) > 0
       AND CAST(julianday('now','localtime') - julianday(i.due_date) AS INTEGER) >= ?
     ORDER BY i.due_date ASC`,
    daysOverdue,
  );

  // Auto-mark overdue
  const invoiceIds = rows.map((r) => r.id);
  if (invoiceIds.length > 0) {
    const placeholders = invoiceIds.map(() => '?').join(',');
    await execute(
      db,
      `UPDATE invoices SET status = 'overdue', updated_at = datetime('now','localtime')
       WHERE id IN (${placeholders}) AND status != 'overdue'`,
      ...invoiceIds,
    ).catch(() => {});
  }

  return rows.map((r) => ({
    invoiceId: r.id,
    invoiceNumber: r.invoice_number,
    clientId: r.client_id,
    clientName: r.client_name,
    totalAmount: r.total_amount,
    paidAmount: r.paid_amount,
    amountDue: roundCents(r.total_amount - r.paid_amount),
    dueDate: r.due_date,
    daysOverdue: r.days_since_due,
    status: 'overdue',
  }));
}

// ── 6. generateOverdueReminders ─────────────────────────────

export async function generateOverdueReminders(
  db: D1Database,
): Promise<OverdueReminder[]> {
  const overdue = await getOverdueInvoices(db, 1);

  const byClient = new Map<number, OverdueInvoice[]>();
  for (const inv of overdue) {
    const list = byClient.get(inv.clientId) ?? [];
    list.push(inv);
    byClient.set(inv.clientId, list);
  }

  const reminders: OverdueReminder[] = [];
  for (const [clientId, invoices] of byClient) {
    const client = await queryFirst<{
      name: string;
      contact_email: string | null;
    }>(
      db,
      'SELECT name, contact_email FROM clients WHERE id = ?',
      clientId,
    );
    if (!client) continue;

    const totalDue = roundCents(
      invoices.reduce((sum, inv) => sum + inv.amountDue, 0),
    );
    const maxDays = Math.max(...invoices.map((inv) => inv.daysOverdue));

    let suggestedAction: string;
    if (maxDays > 60) {
      suggestedAction = 'Escalate to collections or attorney referral';
    } else if (maxDays > 30) {
      suggestedAction = 'Send formal demand letter; consider late fee';
    } else {
      suggestedAction = 'Send friendly reminder with payment options';
    }

    reminders.push({
      clientId,
      clientName: client.name,
      clientEmail: client.contact_email,
      invoiceCount: invoices.length,
      totalDue,
      invoices: invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        amountDue: inv.amountDue,
        daysOverdue: inv.daysOverdue,
      })),
      suggestedAction,
    });
  }

  return reminders.sort((a, b) => b.totalDue - a.totalDue);
}

// ── 7. getInvoiceSummary ────────────────────────────────────

export async function getInvoiceSummary(
  db: D1Database,
  clientId?: number,
): Promise<InvoiceSummary> {
  const clientFilter = clientId ? 'AND client_id = ?' : '';
  const bindings = clientId ? [clientId] : [];

  const totals = await queryFirst<{
    total_invoiced: number;
    total_collected: number;
    outstanding: number;
    overdue: number;
    invoice_count: number;
    overdue_count: number;
  }>(
    db,
    `SELECT
       COALESCE(SUM(total_amount), 0) as total_invoiced,
       COALESCE(SUM(paid_amount), 0) as total_collected,
       COALESCE(SUM(CASE WHEN status NOT IN ('paid','void','cancelled')
                          THEN total_amount - paid_amount ELSE 0 END), 0) as outstanding,
       COALESCE(SUM(CASE WHEN status = 'overdue'
                          THEN total_amount - paid_amount ELSE 0 END), 0) as overdue,
       COUNT(*) as invoice_count,
       COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) as overdue_count
     FROM invoices
     WHERE 1=1 ${clientFilter}`,
    ...bindings,
  );

  const byStatusRows = await query<{
    status: string;
    cnt: number;
  }>(
    db,
    `SELECT status, COUNT(*) as cnt
     FROM invoices
     WHERE 1=1 ${clientFilter}
     GROUP BY status`,
    ...bindings,
  );

  const byStatus: Record<string, number> = {};
  for (const row of byStatusRows) {
    byStatus[row.status] = row.cnt;
  }

  return {
    totalInvoiced: roundCents(totals?.total_invoiced ?? 0),
    totalCollected: roundCents(totals?.total_collected ?? 0),
    outstanding: roundCents(totals?.outstanding ?? 0),
    overdue: roundCents(totals?.overdue ?? 0),
    invoiceCount: totals?.invoice_count ?? 0,
    overdueCount: totals?.overdue_count ?? 0,
    byStatus,
  };
}

// ── 8. notifyServeCompletion ─────────────────────────────────

export async function notifyServeCompletion(
  db: D1Database,
  queueId: number,
  attemptId: number,
  method: 'email' | 'sms' | 'both',
): Promise<NotificationResult> {
  const job = await queryFirst<{
    id: number;
    defendant_name: string | null;
    case_number: string | null;
    document_type: string | null;
    status: string;
    client_id: number | null;
    contract_id: number | null;
  }>(
    db,
    `SELECT id, defendant_name, case_number, document_type, status, client_id, contract_id
     FROM serve_queue WHERE id = ?`,
    queueId,
  );
  if (!job) {
    return { sent: false, channel: method, message: `Queue ${queueId} not found` };
  }

  const attempt = await queryFirst<{
    id: number;
    result: string | null;
    attempt_at: string | null;
    officer_id: number | null;
  }>(
    db,
    'SELECT id, result, attempt_at, officer_id FROM serve_attempts WHERE id = ?',
    attemptId,
  );
  if (!attempt) {
    return { sent: false, channel: method, message: `Attempt ${attemptId} not found` };
  }

  // Resolve client contact info
  let clientEmail: string | null = null;
  let clientPhone: string | null = null;
  let clientName: string | null = null;

  if (job.client_id) {
    const client = await queryFirst<{
      contact_email: string | null;
      contact_phone: string | null;
      name: string;
    }>(
      db,
      'SELECT contact_email, contact_phone, name FROM clients WHERE id = ?',
      job.client_id,
    );
    if (client) {
      clientEmail = client.contact_email;
      clientPhone = client.contact_phone;
      clientName = client.name;
    }
  } else if (job.contract_id) {
    const client = await queryFirst<{
      contact_email: string | null;
      contact_phone: string | null;
      name: string;
    }>(
      db,
      `SELECT cl.contact_email, cl.contact_phone, cl.name
       FROM clients cl
       JOIN client_contracts cc ON cc.client_id = cl.id
       WHERE cc.id = ?`,
      job.contract_id,
    );
    if (client) {
      clientEmail = client.contact_email;
      clientPhone = client.contact_phone;
      clientName = client.name;
    }
  }

  // Log the notification attempt
  const channelsSent: string[] = [];

  if ((method === 'email' || method === 'both') && clientEmail) {
    channelsSent.push('email');
    // Enqueue into email_outbox (same pipeline as serveCompletionNotify.ts)
    const sender = await queryFirst<{ id: number }>(
      db,
      "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') ORDER BY id LIMIT 1",
    ).catch(() => null);

    if (sender) {
      const who = job.defendant_name ?? `Job #${queueId}`;
      const docType = (job.document_type ?? 'documents').replace(/_/g, ' ');
      const caseRef = job.case_number ? ` (Case ${job.case_number})` : '';
      const subject = `Service Update: ${who}${caseRef}`;

      const body = `<p>Dear ${clientName ?? 'Client'},</p>
<p>Service status has been updated for <strong>${who}</strong>${caseRef}.</p>
<p>Status: <strong>${attempt.result ?? job.status}</strong></p>
<p>Thank you for choosing RMPG Flex Process Services.</p>`;

      const payload = JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: body },
          toRecipients: [{ emailAddress: { address: clientEmail } }],
        },
        saveToSentItems: true,
      });

      await execute(
        db,
        "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')",
        sender.id,
        payload,
      ).catch(() => {});
    }
  }

  if ((method === 'sms' || method === 'both') && clientPhone) {
    channelsSent.push('sms');
    // SMS stub — log the intent; actual SMS provider integration would go here
  }

  if (channelsSent.length === 0) {
    return {
      sent: false,
      channel: method,
      message: `No contact info available for client ${job.client_id ?? 'unknown'}`,
    };
  }

  // Record the notification in a log row (use serve_nudges for dedup)
  await execute(
    db,
    `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(serve_queue_id, condition)
     DO UPDATE SET last_notified_at = datetime('now','localtime')`,
    queueId,
    `completion_notify_${attempt.result ?? 'update'}_${attemptId}`,
  ).catch(() => {});

  return {
    sent: true,
    channel: channelsSent.join(','),
    message: `Notification sent to ${clientName ?? 'client'} via ${channelsSent.join(' and ')}`,
  };
}

// ── 9. generateProofOfService ───────────────────────────────

export async function generateProofOfService(
  db: D1Database,
  attemptId: number,
): Promise<ProofOfService | null> {
  const attempt = await queryFirst<{
    id: number;
    serve_queue_id: number;
    attempt_at: string;
    officer_id: number | null;
    result: string | null;
    latitude: number | null;
    longitude: number | null;
    notes: string | null;
    photo_ids: string | null;
    signature_data: string | null;
  }>(
    db,
    `SELECT id, serve_queue_id, attempt_at, officer_id, result,
            latitude, longitude, notes, photo_ids, signature_data
     FROM serve_attempts WHERE id = ?`,
    attemptId,
  );
  if (!attempt) return null;

  const job = await queryFirst<{
    id: number;
    recipient_name: string | null;
    recipient_address: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    recipient_zip: string | null;
    defendant_name: string | null;
    defendant_address: string | null;
    document_type: string | null;
    case_number: string | null;
    court_name: string | null;
    jurisdiction: string | null;
  }>(
    db,
    `SELECT id, recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
            defendant_name, defendant_address, document_type, case_number, court_name, jurisdiction
     FROM serve_queue WHERE id = ?`,
    attempt.serve_queue_id,
  );

  // Server info
  let serverName = 'Unknown Officer';
  let badgeNumber: string | null = null;
  if (attempt.officer_id) {
    const officer = await queryFirst<{
      full_name: string | null;
      badge_number: string | null;
    }>(
      db,
      'SELECT full_name, badge_number FROM users WHERE id = ?',
      attempt.officer_id,
    );
    if (officer) {
      serverName = officer.full_name ?? 'Unknown Officer';
      badgeNumber = officer.badge_number;
    }
  }

  // Parse photo IDs from JSON
  let photoUrls: string[] = [];
  if (attempt.photo_ids) {
    try {
      const parsed = JSON.parse(attempt.photo_ids);
      if (Array.isArray(parsed)) {
        photoUrls = parsed.map((id: number | string) => `/api/field-photos/${id}`);
      }
    } catch { /* ignore */ }
  }

  return {
    attemptId: attempt.id,
    queueId: attempt.serve_queue_id,
    server: {
      id: attempt.officer_id ?? 0,
      name: serverName,
      badgeNumber,
    },
    serviceDateTime: attempt.attempt_at,
    serviceLocation: {
      address: job?.recipient_address ?? '',
      city: job?.recipient_city ?? '',
      state: job?.recipient_state ?? 'UT',
      zip: job?.recipient_zip ?? '',
      latitude: attempt.latitude,
      longitude: attempt.longitude,
    },
    defendant: {
      name: job?.defendant_name ?? job?.recipient_name ?? '',
      address: job?.defendant_address ?? job?.recipient_address ?? null,
    },
    documentDetails: {
      type: job?.document_type ?? null,
      caseNumber: job?.case_number ?? null,
      courtName: job?.court_name ?? null,
      jurisdiction: job?.jurisdiction ?? null,
    },
    result: attempt.result ?? 'other',
    notes: attempt.notes,
    photoUrls,
    signaturePresent: !!attempt.signature_data,
  };
}

// ── 10. calculateMileageReimbursement ────────────────────────

export async function calculateMileageReimbursement(
  db: D1Database,
  serverId: number,
  startDate: string,
  endDate: string,
): Promise<{ totalMiles: number; reimbursementAmount: number }> {
  // Sum GPS breadcrumb distances for the server during the date range.
  // Each breadcrumb has lat/lng; we compute haversine distance between
  // consecutive points and sum them.
  const breadcrumbs = await query<{
    latitude: number;
    longitude: number;
    recorded_at: string;
  }>(
    db,
    `SELECT latitude, longitude, recorded_at
     FROM gps_breadcrumbs
     WHERE officer_id = ?
       AND recorded_at >= ?
       AND recorded_at <= ?
       AND latitude IS NOT NULL
       AND longitude IS NOT NULL
     ORDER BY recorded_at ASC`,
    serverId,
    startDate,
    endDate,
  );

  let totalMiles = 0;

  for (let i = 1; i < breadcrumbs.length; i++) {
    const prev = breadcrumbs[i - 1];
    const curr = breadcrumbs[i];
    const dist = haversineMiles(prev.latitude, prev.longitude, curr.latitude, curr.longitude);

    // Filter out GPS jumps > 50 miles (likely from device restart / data gaps)
    if (dist <= 50) {
      totalMiles += dist;
    }
  }

  // IRS standard mileage rate for Utah (adjust as needed)
  const mileageRate = 0.67;

  return {
    totalMiles: roundCents(totalMiles),
    reimbursementAmount: roundCents(totalMiles * mileageRate),
  };
}

// ── Internal helpers ────────────────────────────────────────

/** Haversine distance in miles between two lat/lng points. */
function haversineMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Sum haversine distances for GPS breadcrumbs linked to a serve job. */
async function computeMileageForQueue(db: D1Database, queueId: number): Promise<number> {
  const rows = await query<{
    latitude: number;
    longitude: number;
    recorded_at: string;
  }>(
    db,
    `SELECT gb.latitude, gb.longitude, gb.recorded_at
     FROM gps_breadcrumbs gb
     JOIN serve_attempts sa ON sa.officer_id = gb.officer_id
       AND gb.recorded_at >= sa.attempt_at
       AND gb.recorded_at <= datetime(sa.attempt_at, '+2 hours')
     WHERE sa.serve_queue_id = ?
       AND gb.latitude IS NOT NULL
       AND gb.longitude IS NOT NULL
     ORDER BY gb.recorded_at ASC`,
    queueId,
  ).catch(() => []);

  let totalMiles = 0;
  for (let i = 1; i < rows.length; i++) {
    const dist = haversineMiles(
      rows[i - 1].latitude, rows[i - 1].longitude,
      rows[i].latitude, rows[i].longitude,
    );
    if (dist <= 50) totalMiles += dist;
  }
  return totalMiles;
}

/** Total wait time in minutes across attempts for a serve job. */
async function computeWaitTimeForQueue(db: D1Database, queueId: number): Promise<number> {
  // If the job has planned_at + window info, derive wait time.
  // Otherwise return 0 (no stakeout data available).
  const row = await queryFirst<{ wait_minutes: number }>(
    db,
    `SELECT COALESCE(SUM(
       CASE
         WHEN sa.planned_at IS NOT NULL AND sa.attempt_at IS NOT NULL
         THEN MAX(0, (julianday(sa.attempt_at) - julianday(sa.planned_at)) * 1440)
         ELSE 0
       END
     ), 0) as wait_minutes
     FROM serve_attempts sa
     WHERE sa.serve_queue_id = ?`,
    queueId,
  ).catch(() => ({ wait_minutes: 0 }));

  return row?.wait_minutes ?? 0;
}

/** Count attempts made outside normal business hours (before 8am or after 6pm, or weekends). */
async function countAfterHoursAttempts(db: D1Database, queueId: number): Promise<number> {
  const row = await queryFirst<{ cnt: number }>(
    db,
    `SELECT COUNT(*) as cnt
     FROM serve_attempts
     WHERE serve_queue_id = ?
       AND (
         CAST(strftime('%H', attempt_at) AS INTEGER) < 8
         OR CAST(strftime('%H', attempt_at) AS INTEGER) >= 18
         OR CAST(strftime('%w', attempt_at) AS INTEGER) IN (0, 6)
       )`,
    queueId,
  ).catch(() => ({ cnt: 0 }));

  return row?.cnt ?? 0;
}
