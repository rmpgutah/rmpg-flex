// ============================================================
// RMPG Flex — ServeManager integration route (Phase 1: outbound seed only)
// ============================================================
// Mounted at /api/servemanager, auth: 'required' (see src/routesConfig.ts).
// Mirrors src/routes/fleetio.ts's shape. Phase 2 adds inbound /pull +
// webhooks, following the same pattern as Fleet.io PR 1 -> PR 4.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { configFromEnv, ping, createJob } from '../utils/servemanager/client';
import { SERVEMANAGER_LINK_RESOURCE } from '../utils/servemanager/resources';
import { ServeManagerConfigError, ServeManagerError } from '../utils/servemanager/errors';
import { recordAudit } from '../utils/auditLog';

const servemanager = new Hono<Env>();

const PACE_MS = 1000; // conservative default; ServeManager doesn't publish a rate limit in the docs

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configOrNotConfigured(env: Env['Bindings']) {
  try {
    return { config: configFromEnv(env as unknown as Record<string, unknown>) };
  } catch (err) {
    if (err instanceof ServeManagerConfigError) {
      return { error: err };
    }
    throw err;
  }
}

servemanager.get('/test-connection', async (c) => {
  const { config, error } = configOrNotConfigured(c.env);
  if (error) return c.json({ ok: false, error: error.message, code: 'not_configured' }, 503);

  const result = await ping(config!);
  if (!result.ok) return c.json({ ok: false, error: result.error }, 502);
  return c.json({ ok: true, account_id: result.account_id, company_name: result.company_name });
});

servemanager.get('/sync-status', requireRole('admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const [linksTotal, pending, failed, conflicts] = await Promise.all([
    query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM servemanager_links`),
    query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM servemanager_events WHERE status = 'pending'`),
    query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM servemanager_events WHERE status = 'failed'`),
    query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM servemanager_conflicts WHERE resolved_at IS NULL`),
  ]);
  return c.json({
    links_total: linksTotal[0]?.n ?? 0,
    outbound_pending: pending[0]?.n ?? 0,
    outbound_failed_total: failed[0]?.n ?? 0,
    conflicts_unresolved: conflicts[0]?.n ?? 0,
  });
});

interface SeedableServeQueueRow {
  id: number;
  case_number: string | null;
  court_name: string | null;
  client_name: string | null;
  recipient_name: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_zip: string | null;
  document_type: string | null;
}

function buildJobPayload(row: SeedableServeQueueRow): Record<string, unknown> {
  return {
    job: {
      client_job_number: row.case_number ?? undefined,
      recipient: {
        recipient_name: row.recipient_name ?? undefined,
        address1: row.recipient_address ?? undefined,
        city: row.recipient_city ?? undefined,
        state: row.recipient_state ?? undefined,
        postal_code: row.recipient_zip ?? undefined,
      },
      documents_to_be_served_attributes: row.document_type
        ? [{ title: row.document_type }]
        : undefined,
    },
  };
}

servemanager.post('/seed', requireRole('admin'), async (c) => {
  const { config, error } = configOrNotConfigured(c.env);
  if (error) return c.json({ ok: false, error: error.message, code: 'not_configured' }, 503);

  const body = await c.req.json().catch(() => ({}));
  const dryRun = Boolean(body?.dry_run);
  const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);

  const db = getDb(c.env);
  const rows = await query<SeedableServeQueueRow>(
    db,
    `SELECT sq.id, sq.case_number, sq.court_name, sq.client_name, sq.recipient_name,
            sq.recipient_address, sq.recipient_city, sq.recipient_state, sq.recipient_zip,
            sq.document_type
     FROM serve_queue sq
     LEFT JOIN servemanager_links sl
       ON sl.rmpg_table = 'serve_queue' AND sl.rmpg_id = sq.id
     WHERE sl.id IS NULL
     ORDER BY sq.id ASC
     LIMIT ?`,
    limit
  );

  const outcomes: Array<{ id: number; status: string; servemanager_id?: number; error?: string }> = [];

  for (const row of rows) {
    if (dryRun) {
      outcomes.push({ id: row.id, status: 'would_create' });
      continue;
    }
    try {
      const job = await createJob(config!, buildJobPayload(row));
      await execute(
        db,
        `INSERT OR IGNORE INTO servemanager_links
           (rmpg_table, rmpg_id, servemanager_resource, servemanager_id, last_pushed_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        'serve_queue', row.id, SERVEMANAGER_LINK_RESOURCE.job, job.id
      );
      outcomes.push({ id: row.id, status: 'created', servemanager_id: job.id });
    } catch (err) {
      const message = err instanceof ServeManagerError ? err.message : 'Unknown error';
      outcomes.push({ id: row.id, status: 'failed', error: message });
    }
    await sleep(PACE_MS);
  }

  await recordAudit(c, {
    action: 'servemanager.seed',
    entityType: 'servemanager_sync',
    details: { dry_run: dryRun, count: rows.length },
  }).catch(() => undefined);

  const summary = {
    total: rows.length,
    created: outcomes.filter((o) => o.status === 'created').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  };

  return c.json({ ok: true, dry_run: dryRun, summary, outcomes });
});

export default servemanager;
