// ============================================================
// RMPG Flex — /api/reports/daily-reports/*
// ============================================================
// Serves the Fleet Daily Blotter archive consumed by
// client/src/pages/fleet/FleetReportsPage.tsx. R2 (DOWNLOADS) is the
// source of truth for which reports exist.
//
// Viewing is restricted to internal operational roles — admin, manager,
// supervisor, officer, dispatcher (BLOTTER_ROLES in the parent
// src/routes/reports.ts router, which gates this whole mount) — not any
// authenticated user, because the PDF carries call addresses,
// dispositions, officer names, and citations. Generating is admin-only,
// matching the page's own isAdmin gate.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
import { collectDailyReport, isEmpty } from '../utils/dailyReport/collect';
import { renderDailyReport } from '../utils/dailyReport/render';
import { getReport, listReports, parseReportKey, putReport, reportFilename, type StoredReport } from '../utils/dailyReport/store';

const dailyReports = new Hono<Env>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Unset binding → 200 { ok:false, code:'not_configured' }, never 503. */
function bucketOf(c: { env: Env['Bindings'] }) {
  return c.env.DOWNLOADS ?? null;
}

export function groupByMonth(reports: StoredReport[]): { month: string; days: StoredReport[] }[] {
  const byMonth = new Map<string, StoredReport[]>();
  for (const r of reports) {
    const month = r.date.slice(0, 7);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(r); else byMonth.set(month, [r]);
  }
  return [...byMonth.entries()]
    .map(([month, days]) => ({ month, days }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

dailyReports.get('/by-month', async (c) => {
  const bucket = bucketOf(c);
  if (!bucket) return c.json({ ok: false, code: 'not_configured', months: [], total_reports: 0 });
  try {
    const reports = await listReports(bucket);
    return c.json({ months: groupByMonth(reports), total_reports: reports.length });
  } catch (err) {
    log.error('GET /daily-reports/by-month failed', { src: 'src/routes/dailyReports.ts' }, err as Error);
    return c.json({ error: 'Failed to list reports' }, 500);
  }
});

dailyReports.post('/generate', requireRole('admin'), async (c) => {
  const bucket = bucketOf(c);
  if (!bucket) return c.json({ ok: false, code: 'not_configured' });
  const body = await c.req.json<{ date?: string }>().catch(() => ({} as { date?: string }));
  const date = body.date ?? '';
  if (!DATE_RE.test(date)) return c.json({ error: 'Invalid date; expected YYYY-MM-DD' }, 400);
  // DATE_RE only checks shape, so it admits calendar-impossible dates like
  // 2026-13-45. Round-trip through the store's own boundary — the same one
  // the download route uses to reject an unreadable key — rather than
  // adding a second, possibly-inconsistent date validator. An unparseable
  // date here would otherwise write an R2 object that parseReportKey later
  // rejects on read: permanently unlisted and undownloadable.
  if (!parseReportKey(reportFilename(date))) {
    return c.json({ error: 'Invalid date; expected YYYY-MM-DD' }, 400);
  }
  try {
    const data = await collectDailyReport(getDb(c.env), date);
    if (isEmpty(data)) {
      return c.json({ ok: false, message: `No activity recorded for ${date}.` });
    }
    await putReport(bucket, date, await renderDailyReport(data));
    return c.json({ ok: true, filename: reportFilename(date) });
  } catch (err) {
    log.error('POST /daily-reports/generate failed', { src: 'src/routes/dailyReports.ts', date }, err as Error);
    return c.json({ error: 'Generation failed' }, 500);
  }
});

// Declared LAST: a bare :filename would otherwise shadow the literal
// routes above. Hono matches in declaration order.
dailyReports.get('/:filename', async (c) => {
  const bucket = bucketOf(c);
  if (!bucket) return c.json({ ok: false, code: 'not_configured' });
  const obj = await getReport(bucket, c.req.param('filename'));
  if (!obj) return c.json({ error: 'Report not found' }, 404);
  return new Response(obj.body as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${c.req.param('filename')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

export default dailyReports;
