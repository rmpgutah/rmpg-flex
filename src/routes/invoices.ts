// ============================================================
// RMPG Flex — Invoices summary (InvoicesPage stats tile)
// ============================================================
// InvoicesPage.tsx calls GET /api/invoices/stats on mount. Full invoice
// CRUD lives under /api/billing/invoices (src/routes/billing.ts); this tiny
// router only owns the /api/invoices/* namespace the page's summary tile
// uses, computed from the live `invoices` table. Legacy 500'd this path
// (live sweep 2026-06-02).
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

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

export default invoices;
