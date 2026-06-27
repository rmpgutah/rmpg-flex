// ============================================================
// Smoke test for GET /api/invoices/:id/pdf-data
// ============================================================
// Added in PR #1648 follow-up — the endpoint was referenced by
// AdminInvoiceTab but never implemented on the Worker, so the
// Preview / Download PDF / Print buttons silently 404'd. This
// suite locks the payload shape against the InvoicePdfData
// interface in client/src/utils/invoicePdfGenerator.ts.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import invoices from '../src/routes/invoices';

type SqlCall = { sql: string; bindings: unknown[] };

function makeDbStub(scenario: 'found' | 'no-table' | 'not-found') {
  const calls: SqlCall[] = [];
  const respond = async (sql: string, bindings: unknown[]) => {
    calls.push({ sql, bindings });
    // sqlite_master existence probe
    if (/sqlite_master/.test(sql)) {
      return scenario === 'no-table' ? { n: 0 } : { n: 1 };
    }
    // Invoice + client + creator
    if (/FROM invoices i/.test(sql)) {
      if (scenario === 'not-found') return null;
      return {
        id: 42,
        invoice_number: 'INV-26-0007',
        status: 'sent',
        issue_date: '2026-06-01',
        due_date: '2026-07-01',
        subtotal: 1000,
        tax_amount: 47.5,
        total: 1047.5,
        amount_paid: 500,
        balance_due: 547.5,
        discount_amount: 0,
        late_fee_amount: 0,
        notes: 'Net 30',
        period_start: '2026-06-01',
        period_end: '2026-07-01',
        client_name: 'ACME Corp',
        client_address: '1 Main St',
        contact_name: 'Jane Doe',
        contact_email: 'jane@acme.test',
        contact_phone: '801-555-0100',
        client_code: 'ACME',
        tax_id: '99-9999999',
        billing_email: 'ap@acme.test',
        billing_address: 'PO Box 1',
        payment_terms: 'Net 30',
        created_by_name: 'Officer Smith',
      };
    }
    return null;
  };

  const allRespond = async (sql: string, bindings: unknown[]) => {
    calls.push({ sql, bindings });
    if (/FROM invoice_line_items/.test(sql)) {
      return {
        results: [
          { line_type: 'service', description: 'Patrol', quantity: 10, unit_price: 50, amount: 500 },
          { line_type: 'service', description: 'Mileage', quantity: 100, unit_price: 0.5, amount: 50 },
        ],
      };
    }
    if (/FROM payments p/.test(sql)) {
      return {
        results: [
          { payment_date: '2026-06-15', amount: 500, payment_method: 'check', reference_number: '#1234', recorded_by_name: 'Officer Smith' },
        ],
      };
    }
    return { results: [] };
  };

  // Match the dual code paths in src/utils/db.ts — query/queryFirst skip
  // `.bind()` entirely when there are no bindings. So the stub must expose
  // first()/all() directly on the prepared statement AND on bind(...).
  const makeOps = (sql: string, bindings: unknown[]) => ({
    first: async () => respond(sql, bindings),
    all:   async () => allRespond(sql, bindings),
    run:   async () => ({ meta: { last_row_id: 0, changes: 0 } }),
  });

  const db = {
    prepare: (sql: string) => {
      const noBind = makeOps(sql, []);
      return {
        ...noBind,
        bind: (...bindings: unknown[]) => makeOps(sql, bindings),
      };
    },
  };
  return { db, calls };
}

// Type the test app with the Worker's real Variables shape so c.set('user') /
// c.set('userId') typecheck against the same ContextVariableMap the
// invoices route reads from in production (src/types.ts).
type TestEnv = { Variables: import('../src/types').Variables };

function makeApp(stub: ReturnType<typeof makeDbStub>) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 7, username: 'tester', role: 'admin', full_name: 'Test Er' });
    c.set('userId', 7);
    (c as any).env = { DB: stub.db };
    await next();
  });
  app.route('/api/invoices', invoices);
  return app;
}

describe('GET /api/invoices/:id/pdf-data', () => {
  let stub: ReturnType<typeof makeDbStub>;
  let app: Hono<TestEnv>;

  beforeEach(() => {
    stub = makeDbStub('found');
    app = makeApp(stub);
  });

  it('rejects a non-numeric id with 400', async () => {
    const res = await app.request('/api/invoices/abc/pdf-data');
    expect(res.status).toBe(400);
  });

  it('returns 404 when the invoices table is missing', async () => {
    stub = makeDbStub('no-table');
    app = makeApp(stub);
    const res = await app.request('/api/invoices/42/pdf-data');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the invoice id does not exist', async () => {
    stub = makeDbStub('not-found');
    app = makeApp(stub);
    const res = await app.request('/api/invoices/999/pdf-data');
    expect(res.status).toBe(404);
  });

  it('returns the denormalized payload shape the PDF generator expects', async () => {
    const res = await app.request('/api/invoices/42/pdf-data');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { invoice: any } };
    const inv = body.data.invoice;
    // Core invoice fields used by the PDF
    expect(inv.invoice_number).toBe('INV-26-0007');
    expect(inv.status).toBe('sent');
    expect(inv.total).toBe(1047.5);
    expect(inv.amount_paid).toBe(500);
    expect(inv.balance_due).toBe(547.5);
    // Client fields
    expect(inv.client_name).toBe('ACME Corp');
    expect(inv.billing_address).toBe('PO Box 1');
    expect(inv.payment_terms).toBe('Net 30');
    // Line items + payments (arrays — generator iterates them)
    expect(Array.isArray(inv.line_items)).toBe(true);
    expect(inv.line_items).toHaveLength(2);
    expect(inv.line_items[0]).toMatchObject({ description: 'Patrol', quantity: 10, unit_price: 50, amount: 500 });
    expect(Array.isArray(inv.payments)).toBe(true);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]).toMatchObject({ payment_method: 'check', amount: 500, recorded_by_name: 'Officer Smith' });
  });

  it('binds the requested invoice id on the main SELECT', async () => {
    await app.request('/api/invoices/42/pdf-data');
    const invoiceQuery = stub.calls.find(c => /FROM invoices i/.test(c.sql));
    expect(invoiceQuery?.bindings).toEqual([42]);
  });
});
