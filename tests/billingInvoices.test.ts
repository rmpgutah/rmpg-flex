import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import billing from '../src/routes/billing';
import { INVOICE_LINE_TYPES } from '../client/src/utils/invoiceLineTypes';

const SRC = readFileSync(join(process.cwd(), 'src/routes/billing.ts'), 'utf8');

type SqlCall = { sql: string; bindings: unknown[] };

function makeDbStub() {
  const calls: SqlCall[] = [];
  const inserts: Record<string, unknown>[] = [];

  const respondFirst = async (sql: string, bindings: unknown[]) => {
    calls.push({ sql, bindings });
    if (/sqlite_master/.test(sql)) return { n: 1 };
    if (/pragma_table_info/.test(sql)) return { 1: 1 };
    if (/FROM invoices i/.test(sql) && /WHERE i\.id/.test(sql)) {
      return {
        id: 7,
        invoice_number: 'INV-26-0001',
        client_id: 3,
        status: 'draft',
        total_amount: 150,
        paid_amount: 40,
        subtotal: 150,
        tax_amount: 0,
        tax_rate: 0,
        issue_date: '2026-08-01',
        due_date: '2026-08-31',
        period_start: '2026-08-01',
        period_end: '2026-08-31',
        client_name: 'ACME',
        billing_email: 'ap@acme.test',
        payment_terms: 'Net 30',
        created_by_name: 'Admin',
      };
    }
    if (/SELECT \* FROM invoices WHERE id/.test(sql)) {
      return {
        id: 7,
        invoice_number: 'INV-26-0001',
        client_id: 3,
        status: 'draft',
        total_amount: 150,
        paid_amount: 0,
        subtotal: 150,
        tax_amount: 0,
        tax_rate: 0,
        issue_date: '2026-08-01',
        due_date: '2026-08-31',
      };
    }
    if (/SELECT line_total, tax_applied/.test(sql)) {
      return null; // query() uses all(), not first()
    }
    if (/SELECT tax_rate FROM invoices/.test(sql)) return { tax_rate: 0 };
    return null;
  };

  const respondAll = async (sql: string, bindings: unknown[]) => {
    calls.push({ sql, bindings });
    if (/FROM invoice_line_items WHERE invoice_id/.test(sql) && /line_total AS amount/.test(sql)) {
      return {
        results: [
          { id: 1, invoice_id: 7, line_type: 'pso_client_request', description: 'PSO Client Request 26-CFS1', quantity: 1, unit_price: 150, amount: 150, sort_order: 10 },
        ],
      };
    }
    if (/FROM payments p/.test(sql)) return { results: [] };
    if (/SELECT line_total, tax_applied/.test(sql)) {
      return { results: inserts.map((i) => ({ line_total: i.line_total, tax_applied: i.tax_applied })) };
    }
    return { results: [] };
  };

  const makeOps = (sql: string, bindings: unknown[]) => ({
    first: async () => respondFirst(sql, bindings),
    all: async () => respondAll(sql, bindings),
    run: async () => {
      calls.push({ sql, bindings });
      if (/INSERT INTO invoice_line_items/.test(sql)) {
        inserts.push({
          description: bindings[1],
          quantity: bindings[2],
          unit_price: bindings[3],
          line_total: bindings[4],
          tax_applied: bindings[5],
          line_type: bindings[7],
          linked_entity_type: bindings[8],
          linked_entity_id: bindings[9],
        });
      }
      return { meta: { last_row_id: 11, changes: 1 } };
    },
  });

  const db = {
    prepare: (sql: string) => {
      const noBind = makeOps(sql, []);
      return { ...noBind, bind: (...bindings: unknown[]) => makeOps(sql, bindings) };
    },
    batch: async (stmts: { bind?: unknown }[]) => stmts,
  };
  return { db, calls, inserts };
}

type TestEnv = { Variables: import('../src/types').Variables };

function makeApp(stub: ReturnType<typeof makeDbStub>) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('user', { id: 7, username: 'tester', role: 'admin', full_name: 'Test Er' });
    c.set('userId', 7);
    (c as any).env = { DB: stub.db };
    await next();
  });
  app.route('/api/billing', billing);
  return app;
}

describe('invoice line types (client catalog)', () => {
  it('includes PSO Client Request', () => {
    expect(INVOICE_LINE_TYPES.map((t) => t.value)).toContain('pso_client_request');
    expect(INVOICE_LINE_TYPES.find((t) => t.value === 'pso_client_request')?.label).toBe('PSO Client Request');
  });
});

describe('billing invoice routes', () => {
  let stub: ReturnType<typeof makeDbStub>;
  let app: Hono<TestEnv>;

  beforeEach(() => {
    stub = makeDbStub();
    app = makeApp(stub);
  });

  it('GET /invoices/:id aliases total_amount → total and paid_amount → amount_paid', async () => {
    const res = await app.request('/api/billing/invoices/7');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.total).toBe(150);
    expect(body.data.amount_paid).toBe(40);
    expect(body.data.balance_due).toBe(110);
    expect(body.data.line_items).toEqual(expect.arrayContaining([
      expect.objectContaining({ line_type: 'pso_client_request' }),
    ]));
  });

  it('POST /invoices/:id/items persists pso_client_request', async () => {
    const res = await app.request('/api/billing/invoices/7/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        line_type: 'pso_client_request',
        description: 'PSO Client Request 26-CFS0099',
        quantity: 1,
        unit_price: 125,
      }),
    });
    expect(res.status).toBe(201);
    const insert = stub.calls.find((c) => /INSERT INTO invoice_line_items/.test(c.sql));
    expect(insert?.bindings).toEqual(expect.arrayContaining(['PSO Client Request 26-CFS0099', 1, 125, 125]));
    expect(insert?.bindings).toContain('pso_client_request');
  });

  it('POST /invoices/:id/items stores discounts as a negative line_total', async () => {
    const res = await app.request('/api/billing/invoices/7/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        line_type: 'discount',
        description: 'Courtesy credit',
        quantity: 1,
        unit_price: 25,
      }),
    });
    expect(res.status).toBe(201);
    const insert = stub.calls.find((c) => /INSERT INTO invoice_line_items/.test(c.sql));
    expect(insert?.bindings).toContain(-25);
    expect(insert?.bindings).toContain('discount');
  });
});

describe('billing invoice source contracts', () => {
  it('InvoicesPage mutations live on /billing, not the stub /api/invoices router', () => {
    expect(SRC).toMatch(/billing\.post\('\/invoices\/:id\/items'/);
    expect(SRC).toMatch(/pso_client_request/);
    expect(SRC).toMatch(/function shapeInvoice/);
  });

  it('generate pulls PSO Client Request CFS in the invoice period', () => {
    expect(SRC).toMatch(/incident_type = 'pso_client_request'/);
    expect(SRC).toMatch(/linked_entity_type = 'call'/);
  });
});
