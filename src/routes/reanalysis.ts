// src/routes/reanalysis.ts
// Admin-triggered data reanalysis pipelines:
//   POST /backfill-confidence  — cap footage/edge ALPR confidence to ≤0.84
//   POST /replay               — push D1 rows to Iceberg (idempotent, cursor-paged)
//   GET  /status               — last run stats for each pipeline (UI polling)
//
// Mounted at /api/admin/reanalysis in routesConfig.ts.
// All routes require 'admin' role.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { flexEvent } from '../utils/analytics';
import type { AnalyticsEvent } from '../utils/analytics';

const reanalysis = new Hono<Env>();
const adminOnly = requireRole('admin');

// ── Schema reconciler ─────────────────────────────────────────
// Runs once per isolate lifetime. Ensures job_runs exists and all idempotency /
// audit-trail columns are present. Runtime guard so migrations can be applied
// lazily after deploy.

let schemaReady = false;
async function ensureReanalysisSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;

  await execute(db, `CREATE TABLE IF NOT EXISTS job_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type       TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'running',
    total          INTEGER DEFAULT 0,
    processed      INTEGER DEFAULT 0,
    skipped        INTEGER DEFAULT 0,
    errors         INTEGER DEFAULT 0,
    error_detail   TEXT,
    skipped_detail TEXT,
    started_by     INTEGER,
    started_at     TEXT DEFAULT (datetime('now')),
    finished_at    TEXT
  )`).catch(() => {});
  await execute(db, `CREATE INDEX IF NOT EXISTS idx_job_runs_type ON job_runs(job_type, id DESC)`).catch(() => {});

  // Idempotency markers + audit-trail columns
  const newCols: Array<[string, string, string]> = [
    ['vehicle_sightings',  'analytics_replayed_at',    'TEXT'],
    ['vehicle_sightings',  'original_confidence',       'REAL'],
    ['audit_log',          'analytics_replayed_at',    'TEXT'],
    ['gps_breadcrumbs',    'analytics_replayed_at',    'TEXT'],
    ['calls_for_service',  'analytics_replayed_at',    'TEXT'],
    ['citations',          'analytics_replayed_at',    'TEXT'],
    ['incidents',          'analytics_replayed_at',    'TEXT'],
    ['alpr_captures',      'original_plate_confidence','REAL'],
    // skipped_detail on job_runs (added in CREATE above; guard legacy rows)
  ];
  for (const [table, col, type] of newCols) {
    try {
      if (!(await columnExists(db, table, col))) {
        await execute(db, `ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }
    } catch { /* tolerate — column may already exist */ }
  }

  schemaReady = true;
}

// ── Batch-size config ─────────────────────────────────────────
async function cfgBatch(db: D1Database, key: string, def: number): Promise<number> {
  const row = await queryFirst<{ config_value: string }>(db,
    "SELECT config_value FROM system_config WHERE config_key=? AND category='integrations' AND is_active=1 LIMIT 1", key,
  ).catch(() => null);
  const n = parseInt(row?.config_value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : def;
}

// ── POST /backfill-confidence ─────────────────────────────────
// Caps footage/edge plate confidence to ≤0.84 (the honest single-read max).
// Preserves original value in original_confidence / original_plate_confidence.
// Paginated via ?cursor=N (last processed vehicle_sightings.id, default 0).
// Default batch: 1000 rows; configurable via system_config key
// 'reanalysis_confidence_batch' in category 'integrations'.

reanalysis.post('/backfill-confidence', adminOnly, async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureReanalysisSchema(db);

  const cursor = parseInt(c.req.query('cursor') ?? '0', 10) || 0;
  const limit  = await cfgBatch(db, 'reanalysis_confidence_batch', 1000);

  const jr = await execute(db,
    `INSERT INTO job_runs (job_type, status, started_by) VALUES ('alpr_confidence','running',?)`,
    c.var.user.id,
  );
  const jobId = Number(jr.meta.last_row_id);

  try {
    const rows = await query<{ id: number; plate: string; confidence: number }>(db,
      `SELECT id, plate, confidence FROM vehicle_sightings
       WHERE confidence > 0.84 AND id > ?
       ORDER BY id ASC LIMIT ?`,
      cursor, limit + 1,
    );

    const hasMore = rows.length > limit;
    const batch   = rows.slice(0, limit);
    let corrected = 0;
    const firstId = batch[0]?.id ?? 0;
    const lastId  = batch[batch.length - 1]?.id ?? 0;

    for (const row of batch) {
      const capped = Math.min(row.confidence, 0.84);
      // Store original before overwriting (idempotent: only sets when NULL)
      await execute(db,
        `UPDATE vehicle_sightings
         SET original_confidence = CASE WHEN original_confidence IS NULL THEN confidence ELSE original_confidence END,
             confidence = ?
         WHERE id = ?`,
        capped, row.id,
      );
      // Mirror correction to linked alpr_captures.plate_confidence
      await execute(db,
        `UPDATE alpr_captures
         SET original_plate_confidence = CASE WHEN original_plate_confidence IS NULL THEN plate_confidence ELSE original_plate_confidence END,
             plate_confidence = ?
         WHERE sighting_id = ? AND plate_confidence > 0.84`,
        capped, row.id,
      ).catch(() => { /* plate_confidence column may not exist on older rows */ });
      corrected++;
    }

    if (batch.length > 0) {
      await execute(db,
        `INSERT INTO audit_log (action, entity_type, entity_id, user_id, detail)
         VALUES ('CONFIDENCE_BACKFILL','reanalysis',?,?,?)`,
        jobId, c.var.user.id,
        JSON.stringify({ corrected, id_range: [firstId, lastId], cursor }),
      ).catch(() => {});
    }

    await execute(db,
      `UPDATE job_runs SET status='complete', processed=?, finished_at=datetime('now') WHERE id=?`,
      corrected, jobId,
    );

    return c.json({ corrected, skipped: 0, has_more: hasMore, next_cursor: lastId, job_id: jobId });
  } catch (err) {
    const msg = (err as Error).message;
    await execute(db,
      `UPDATE job_runs SET status='failed', error_detail=?, finished_at=datetime('now') WHERE id=?`,
      msg, jobId,
    ).catch(() => {});
    return c.json({ error: 'Confidence backfill failed', detail: msg }, 500);
  }
});

// ── POST /replay ──────────────────────────────────────────────
// Push historical D1 rows to the Iceberg analytics warehouse.
// Six datasets, each with an independent cursor query param:
//   ?cursor_sightings=N  vehicle_sightings → alpr_reads   (ANALYTICS pipeline)
//   ?cursor_audit=N      audit_log         → flex_events   (EVENTS pipeline)
//   ?cursor_gps=N        gps_breadcrumbs   → flex_events
//   ?cursor_cfs=N        calls_for_service → flex_events
//   ?cursor_citations=N  citations         → flex_events
//   ?cursor_incidents=N  incidents         → flex_events
//
// Idempotent: rows already marked analytics_replayed_at IS NOT NULL are skipped.
// Default batch per dataset: 1000; configurable via 'reanalysis_replay_batch'.

reanalysis.post('/replay', adminOnly, async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureReanalysisSchema(db);

  if (!c.env.R2_ANALYTICS_WAREHOUSE || !c.env.R2_SQL_TOKEN) {
    // 200 with `skipped:true` instead of 503: the warehouse-missing case is
    // a benign configuration gap, not a server outage. 503 polluted the
    // browser console + tripped the client's error banner; the client now
    // sees a normal no-op replay (replayed:0, has_more:false). The admin
    // page's "Analytics warehouse not provisioned" banner remains the
    // single visible warning.
    const noop = {
      skipped: true,
      reason: 'analytics_not_provisioned' as const,
      replayed: 0,
      has_more: false,
      job_id: 0,
      next_cursor_sightings: parseInt(c.req.query('cursor_sightings') ?? '0', 10) || 0,
      next_cursor_audit:     parseInt(c.req.query('cursor_audit')     ?? '0', 10) || 0,
      next_cursor_gps:       parseInt(c.req.query('cursor_gps')       ?? '0', 10) || 0,
      next_cursor_cfs:       parseInt(c.req.query('cursor_cfs')       ?? '0', 10) || 0,
      next_cursor_citations: parseInt(c.req.query('cursor_citations') ?? '0', 10) || 0,
      next_cursor_incidents: parseInt(c.req.query('cursor_incidents') ?? '0', 10) || 0,
    };
    return c.json(noop);
  }

  const qi = (k: string) => parseInt(c.req.query(k) ?? '0', 10) || 0;
  const curSightings  = qi('cursor_sightings');
  const curAudit      = qi('cursor_audit');
  const curGps        = qi('cursor_gps');
  const curCfs        = qi('cursor_cfs');
  const curCitations  = qi('cursor_citations');
  const curIncidents  = qi('cursor_incidents');

  const limit = await cfgBatch(db, 'reanalysis_replay_batch', 1000);

  const jr = await execute(db,
    `INSERT INTO job_runs (job_type, status, started_by) VALUES ('analytics_replay','running',?)`,
    c.var.user.id,
  );
  const jobId = Number(jr.meta.last_row_id);

  let replayed = 0;
  let hasMore  = false;

  // Running cursors — updated as each dataset batch processes
  let nextSightings  = curSightings;
  let nextAudit      = curAudit;
  let nextGps        = curGps;
  let nextCfs        = curCfs;
  let nextCitations  = curCitations;
  let nextIncidents  = curIncidents;

  try {
    // 1. vehicle_sightings → alpr_reads (ANALYTICS pipeline)
    if (c.env.ANALYTICS) {
      const rows = await query<{
        id: number; plate: string | null; state: string | null;
        confidence: number | null;
        lat: number | null; lng: number | null; created_at: string; unit_id: number | null;
      }>(db,
        `SELECT id, plate, state, confidence, lat, lng, created_at, unit_id
         FROM vehicle_sightings
         WHERE id > ? AND analytics_replayed_at IS NULL
         ORDER BY id ASC LIMIT ?`,
        curSightings, limit + 1,
      ).catch(() => []);

      if (rows.length > limit) hasMore = true;
      const batch = rows.slice(0, limit);

      if (batch.length) {
        const events: AnalyticsEvent[] = batch.map(r => ({
          event_type: 'alpr_read',
          occurred_at: r.created_at,
          source: 'replay',
          plate: r.plate,
          state: r.state,
          trust: r.confidence,
          lat: r.lat,
          lng: r.lng,
          unit_id: r.unit_id,
          capture_id: null,
          call_id: null,
          incident_id: null,
        }));
        await c.env.ANALYTICS.send(events);
        nextSightings = batch[batch.length - 1].id;
        // If this UPDATE fails (e.g., schema drift on analytics_replayed_at),
        // we MUST not swallow it: events already landed in Iceberg but the
        // cursor never advances → next /replay duplicates the batch. Let the
        // outer try/catch (line 207/443) mark job_runs.status='failed' + 500
        // so the operator retries after fixing root cause instead of corrupting
        // the dataset on every subsequent admin click.
        await execute(db,
          `UPDATE vehicle_sightings SET analytics_replayed_at=datetime('now')
           WHERE id > ? AND id <= ? AND analytics_replayed_at IS NULL`,
          curSightings, nextSightings,
        );
        replayed += batch.length;
      }
    }

    // Helper: send a batch to EVENTS and mark rows replayed
    const sendEvents = async (
      events: AnalyticsEvent[],
      table: string,
      fromCursor: number,
      lastId: number,
    ) => {
      if (!events.length || !c.env.EVENTS) return;
      await c.env.EVENTS.send(events);
      // See vehicle_sightings UPDATE above — swallowing this corrupts
      // analytics by duplicating events on every subsequent replay.
      await execute(db,
        `UPDATE ${table} SET analytics_replayed_at=datetime('now')
         WHERE id > ? AND id <= ? AND analytics_replayed_at IS NULL`,
        fromCursor, lastId,
      );
      replayed += events.length;
    };

    // 2. audit_log → flex_events
    {
      const rows = await query<{
        id: number; action: string; entity_type: string | null;
        entity_id: string | null; user_id: number | null; detail: string | null; created_at: string;
      }>(db,
        `SELECT id, action, entity_type, entity_id, user_id, detail, created_at
         FROM audit_log WHERE id > ? AND analytics_replayed_at IS NULL
         ORDER BY id ASC LIMIT ?`,
        curAudit, limit + 1,
      ).catch(() => []);

      if (rows.length > limit) hasMore = true;
      const batch = rows.slice(0, limit);
      if (batch.length) {
        const events = batch.map(r => flexEvent({
          event_type: 'audit_action',
          occurred_at: r.created_at,
          actor_id: r.user_id,
          entity_type: r.entity_type,
          entity_id: r.entity_id ?? undefined,
          label: r.action,
          category: 'audit',
          payload: r.detail ? { detail: r.detail } : null,
        }));
        nextAudit = batch[batch.length - 1].id;
        await sendEvents(events, 'audit_log', curAudit, nextAudit);
      }
    }

    // 3. gps_breadcrumbs → flex_events
    {
      const rows = await query<{
        id: number; unit_id: number; officer_id: number;
        latitude: number; longitude: number; speed: number | null;
        unit_status: string | null; created_at: string;
      }>(db,
        `SELECT id, unit_id, officer_id, latitude, longitude, speed, unit_status, created_at
         FROM gps_breadcrumbs WHERE id > ? AND analytics_replayed_at IS NULL
         ORDER BY id ASC LIMIT ?`,
        curGps, limit + 1,
      ).catch(() => []);

      if (rows.length > limit) hasMore = true;
      const batch = rows.slice(0, limit);
      if (batch.length) {
        const events = batch.map(r => flexEvent({
          event_type: 'gps_ping',
          occurred_at: r.created_at,
          actor_id: r.officer_id,
          entity_type: 'unit',
          entity_id: r.unit_id,
          unit_id: r.unit_id,
          lat: r.latitude,
          lng: r.longitude,
          status: r.unit_status,
          value: r.speed,
          category: 'patrol',
        }));
        nextGps = batch[batch.length - 1].id;
        await sendEvents(events, 'gps_breadcrumbs', curGps, nextGps);
      }
    }

    // 4. calls_for_service → flex_events
    {
      const rows = await query<{
        id: number; call_number: string | null; call_type: string | null;
        status: string | null; priority: string | null;
        lat: number | null; lng: number | null; created_at: string;
      }>(db,
        `SELECT id, call_number, call_type, status, priority, lat, lng, created_at
         FROM calls_for_service WHERE id > ? AND analytics_replayed_at IS NULL
         ORDER BY id ASC LIMIT ?`,
        curCfs, limit + 1,
      ).catch(() => []);

      if (rows.length > limit) hasMore = true;
      const batch = rows.slice(0, limit);
      if (batch.length) {
        const events = batch.map(r => flexEvent({
          event_type: 'cfs_created',
          occurred_at: r.created_at,
          entity_type: 'call',
          entity_id: r.id,
          label: r.call_type ?? r.call_number,
          status: r.status,
          priority: r.priority,
          lat: r.lat,
          lng: r.lng,
          category: 'dispatch',
        }));
        nextCfs = batch[batch.length - 1].id;
        await sendEvents(events, 'calls_for_service', curCfs, nextCfs);
      }
    }

    // 5. citations → flex_events
    {
      const rows = await query<{
        id: number; citation_number: string | null; violation: string | null;
        issuing_officer_id: number | null; fine_amount: number | null;
        lat: number | null; lng: number | null; created_at: string;
      }>(db,
        `SELECT id, citation_number, violation, issuing_officer_id, fine_amount, lat, lng, created_at
         FROM citations WHERE id > ? AND analytics_replayed_at IS NULL
         ORDER BY id ASC LIMIT ?`,
        curCitations, limit + 1,
      ).catch(() => []);

      if (rows.length > limit) hasMore = true;
      const batch = rows.slice(0, limit);
      if (batch.length) {
        const events = batch.map(r => flexEvent({
          event_type: 'citation_issued',
          occurred_at: r.created_at,
          actor_id: r.issuing_officer_id,
          entity_type: 'citation',
          entity_id: r.id,
          label: r.violation ?? r.citation_number,
          value: r.fine_amount,
          lat: r.lat,
          lng: r.lng,
          category: 'enforcement',
        }));
        nextCitations = batch[batch.length - 1].id;
        await sendEvents(events, 'citations', curCitations, nextCitations);
      }
    }

    // 6. incidents → flex_events
    {
      const rows = await query<{
        id: number; incident_number: string | null; call_id: number | null;
        created_at: string;
      }>(db,
        `SELECT id, incident_number, call_id, created_at
         FROM incidents WHERE id > ? AND analytics_replayed_at IS NULL
         ORDER BY id ASC LIMIT ?`,
        curIncidents, limit + 1,
      ).catch(() => []);

      if (rows.length > limit) hasMore = true;
      const batch = rows.slice(0, limit);
      if (batch.length) {
        const events = batch.map(r => flexEvent({
          event_type: 'incident_created',
          occurred_at: r.created_at,
          entity_type: 'incident',
          entity_id: r.id,
          label: r.incident_number,
          payload: r.call_id != null ? { call_id: r.call_id } : null,
          category: 'patrol',
        }));
        nextIncidents = batch[batch.length - 1].id;
        await sendEvents(events, 'incidents', curIncidents, nextIncidents);
      }
    }

    await execute(db,
      `UPDATE job_runs SET status='complete', processed=?, finished_at=datetime('now') WHERE id=?`,
      replayed, jobId,
    );

    return c.json({
      replayed,
      has_more: hasMore,
      next_cursor_sightings:  nextSightings,
      next_cursor_audit:      nextAudit,
      next_cursor_gps:        nextGps,
      next_cursor_cfs:        nextCfs,
      next_cursor_citations:  nextCitations,
      next_cursor_incidents:  nextIncidents,
      job_id: jobId,
    });
  } catch (err) {
    const msg = (err as Error).message;
    await execute(db,
      `UPDATE job_runs SET status='failed', error_detail=?, finished_at=datetime('now') WHERE id=?`,
      msg, jobId,
    ).catch(() => {});
    return c.json({ error: 'Replay failed', detail: msg }, 500);
  }
});

// ── GET /status ───────────────────────────────────────────────
// Returns latest job_run row per pipeline type.
// Polled every 5 s by the admin UI while any job shows status='running'.

reanalysis.get('/status', adminOnly, async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureReanalysisSchema(db);

  const types = ['footage_backfill', 'alpr_confidence', 'analytics_replay'] as const;
  const out: Record<string, unknown> = {};

  for (const t of types) {
    const row = await queryFirst<{
      id: number; status: string; processed: number; skipped: number;
      errors: number; error_detail: string | null; skipped_detail: string | null;
      started_at: string; finished_at: string | null;
    }>(db,
      `SELECT id, status, processed, skipped, errors, error_detail, skipped_detail, started_at, finished_at
       FROM job_runs WHERE job_type=? ORDER BY id DESC LIMIT 1`, t,
    ).catch(() => null);

    out[t] = row ? {
      job_id:       row.id,
      status:       row.status,
      processed:    row.processed,
      skipped:      row.skipped,
      errors:       row.errors,
      error_detail: row.error_detail,
      skipped_units: row.skipped_detail ? (() => { try { return JSON.parse(row.skipped_detail!); } catch { return []; } })() : [],
      started_at:   row.started_at,
      finished_at:  row.finished_at,
    } : null;
  }

  return c.json(out);
});

export default reanalysis;
