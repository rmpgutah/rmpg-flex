// ============================================================
// RMPG Flex — Full-Drive video pipeline
// ============================================================
// Detects trip segments from GPS breadcrumbs (or unit_trips), creates one
// footage_request per trip via enqueueFootage, and polls the chunk queue
// independently of the flexcam_enabled gate so drives work without FlexCam
// being turned on.
// ============================================================

import { log } from './logger';
import type { Bindings } from '../types';
import { getDb, query, queryFirst, execute } from './db';
import { enqueueFootage, ensureFootageSchema, runRequestPass, pollAndDownload, resumeTruncatedRequests } from './footage/captureOrchestrator';
import { getApiConfig, isEnabled } from './clearpathGps';

// A gap of 15+ minutes between GPS pings means the vehicle was stopped / engine off.
const TRIP_GAP_MS = 15 * 60 * 1000;
// Minimum trip duration to be worth requesting footage for (2 min — shorter catches
// brief stops/turnarounds while still excluding single GPS pings).
const MIN_TRIP_MS = 2 * 60 * 1000;
// Maximum number of trips to enqueue per full-drive job.
const MAX_TRIPS = 20;

// ── Schema ──────────────────────────────────────────────────

let schemaReady = false;
export async function ensureFullDriveSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await execute(db, `CREATE TABLE IF NOT EXISTS cpg_drive_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL, unit_id INTEGER,
    from_ts INTEGER NOT NULL, to_ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'detecting',
    trip_count INTEGER DEFAULT 0, clips_requested INTEGER DEFAULT 0, clips_ready INTEGER DEFAULT 0,
    error_msg TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  await execute(db, `CREATE TABLE IF NOT EXISTS cpg_drive_job_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL, trip_number INTEGER NOT NULL, label TEXT NOT NULL,
    from_ts INTEGER NOT NULL, to_ts INTEGER NOT NULL,
    footage_request_id INTEGER,
    chunk_count INTEGER DEFAULT 0, chunks_done INTEGER DEFAULT 0, chunks_missing INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')))`);
  schemaReady = true;
}

// ── Trip detection ───────────────────────────────────────────

interface TripSegment { fromMs: number; toMs: number; label: string; }

function formatTripTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Denver',
  });
}

function buildTripLabel(n: number, fromMs: number, toMs: number): string {
  return `Trip ${n}: ${formatTripTime(fromMs)} – ${formatTripTime(toMs)}`;
}

/** Segment a sorted list of breadcrumb timestamps into moving trips by gap analysis. */
function segmentByGap(timestamps: number[]): Array<{ fromMs: number; toMs: number }> {
  if (!timestamps.length) return [];
  const trips: Array<{ fromMs: number; toMs: number }> = [];
  let segStart = timestamps[0];
  let prev = timestamps[0];
  for (let i = 1; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (ts - prev > TRIP_GAP_MS) {
      if (prev - segStart >= MIN_TRIP_MS) trips.push({ fromMs: segStart, toMs: prev });
      segStart = ts;
    }
    prev = ts;
  }
  if (prev - segStart >= MIN_TRIP_MS) trips.push({ fromMs: segStart, toMs: prev });
  return trips;
}

/** Detect trip segments for a unit in [fromMs, toMs]. Returns at most MAX_TRIPS trips.
 *  Priority: unit_trips table → gps_breadcrumbs gap analysis → full-window fallback. */
async function detectTrips(
  db: D1Database, unitId: number | null, fromMs: number, toMs: number,
): Promise<TripSegment[]> {
  // Bind SPACE-form UTC bounds ('YYYY-MM-DD HH:MM:SS'), matching how
  // unit_trips.start_time (tripStore.ts) and gps_breadcrumbs.recorded_at
  // (datetime('now')) are stored. SQLite compares TEXT lexically and
  // ' ' < 'T', so an ISO-T bound made every same-day row fail `>= fromIso`
  // — trip detection silently returned zero rows for single-day windows.
  const fromIso = new Date(fromMs).toISOString().replace('T', ' ').slice(0, 19);
  const toIso = new Date(toMs).toISOString().replace('T', ' ').slice(0, 19);
  // Space-form strings are zone-less; normalize before Date.parse so the
  // result is UTC regardless of the host zone.
  const epochMs = (s: string): number =>
    Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);

  // Option 1: Use already-detected unit_trips for this unit.
  // Filter by real duration (≥ MIN_TRIP_SEC) so single-ping GPS records are excluded.
  const MIN_TRIP_SEC = Math.ceil(MIN_TRIP_MS / 1000);
  if (unitId) {
    const rows = await query<{ start_time: string; end_time: string }>(db, `
      SELECT start_time, end_time FROM unit_trips
      WHERE unit_id = ? AND status = 'closed'
        AND start_time >= ? AND start_time <= ?
        AND end_time IS NOT NULL
        AND (strftime('%s', end_time) - strftime('%s', start_time)) >= ?
      ORDER BY start_time ASC LIMIT ?`,
      unitId, fromIso, toIso, MIN_TRIP_SEC, MAX_TRIPS,
    ).catch(() => []);
    if (rows.length) {
      return rows.map((r, i) => {
        const f = epochMs(r.start_time);
        const t = epochMs(r.end_time);
        return { fromMs: f, toMs: t, label: buildTripLabel(i + 1, f, t) };
      });
    }

    // Option 2: Gap-analyze gps_breadcrumbs.
    const crumbs = await query<{ recorded_at: string }>(db, `
      SELECT recorded_at FROM gps_breadcrumbs
      WHERE unit_id = ? AND recorded_at BETWEEN ? AND ?
      ORDER BY recorded_at ASC LIMIT 5000`,
      unitId, fromIso, toIso,
    ).catch(() => []);
    if (crumbs.length >= 2) {
      const ts = crumbs.map((r) => epochMs(r.recorded_at));
      const segs = segmentByGap(ts);
      if (segs.length) {
        return segs.slice(0, MAX_TRIPS).map((s, i) => ({
          ...s, label: buildTripLabel(i + 1, s.fromMs, s.toMs),
        }));
      }
    }
  }

  // Option 3: Full window as a single trip.
  return [{ fromMs, toMs, label: buildTripLabel(1, fromMs, toMs) }];
}

// ── Job creation ─────────────────────────────────────────────

export interface CreateJobArgs {
  deviceId: string;
  assetId: number;
  unitId: number | null;
  fromMs: number;
  toMs: number;
  createdBy?: number | null;
}

export interface FullDriveJob {
  jobId: number;
  tripCount: number;
  trips: Array<{ tripId: number; label: string; chunkCount: number; requestId: number | null }>;
}

/** Detect trips, enqueue footage for each, and persist a cpg_drive_jobs record.
 *  Returns the job ID and trip count so the client can poll for progress. */
export async function createFullDriveJob(env: Bindings, args: CreateJobArgs): Promise<FullDriveJob> {
  const db = getDb(env);
  await ensureFullDriveSchema(db);
  await ensureFootageSchema(db);

  const trips = await detectTrips(db, args.unitId, args.fromMs, args.toMs);

  // Create the parent job row.
  const jobRes = await execute(db, `INSERT INTO cpg_drive_jobs
    (device_id, unit_id, from_ts, to_ts, status, trip_count)
    VALUES (?, ?, ?, ?, 'running', ?)`,
    args.deviceId, args.unitId, args.fromMs, args.toMs, trips.length);
  const jobId = Number(jobRes.meta.last_row_id);

  const result: FullDriveJob['trips'] = [];
  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i];
    const tripRes = await execute(db, `INSERT INTO cpg_drive_job_trips
      (job_id, trip_number, label, from_ts, to_ts, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      jobId, i + 1, trip.label, trip.fromMs, trip.toMs);
    const tripRowId = Number(tripRes.meta.last_row_id);

    // Enqueue footage request for this trip.
    let requestId: number | null = null;
    let chunkCount = 0;
    try {
      requestId = await enqueueFootage(env, {
        assetId: args.assetId,
        cpgDeviceId: args.deviceId,
        unitId: args.unitId,
        fromTs: trip.fromMs,
        toTs: trip.toMs,
        reason: 'on_demand',
        channels: ['outside'],
        title: trip.label,
        createdBy: args.createdBy ?? null,
      });
      if (requestId) {
        const req = await queryFirst<{ chunk_count: number }>(db,
          'SELECT chunk_count FROM footage_requests WHERE id = ? LIMIT 1', requestId);
        chunkCount = req?.chunk_count ?? 0;
        await execute(db, `UPDATE cpg_drive_job_trips
          SET footage_request_id = ?, chunk_count = ?, status = 'fulfilling'
          WHERE id = ?`, requestId, chunkCount, tripRowId);
      }
    } catch (err) {
      log.error('enqueue trip failed', { tripIndex: i + 1 }, err);
    }
    result.push({ tripId: tripRowId, label: trip.label, chunkCount, requestId });
  }

  const totalChunks = result.reduce((s, t) => s + t.chunkCount, 0);
  await execute(db, `UPDATE cpg_drive_jobs SET clips_requested = ?, updated_at = datetime('now') WHERE id = ?`,
    totalChunks, jobId);

  return { jobId, tripCount: trips.length, trips: result };
}

// ── Status query ─────────────────────────────────────────────

export interface DriveJobStatus {
  id: number; device_id: string; from_ts: number; to_ts: number; status: string;
  trip_count: number; clips_requested: number; clips_ready: number;
  created_at: string; updated_at: string; error_msg: string | null;
  trips: Array<{
    id: number; trip_number: number; label: string;
    from_ts: number; to_ts: number; footage_request_id: number | null;
    chunk_count: number; chunks_done: number; chunks_missing: number; status: string;
  }>;
}

export async function getJobStatus(db: D1Database, jobId: number): Promise<DriveJobStatus | null> {
  const job = await queryFirst<DriveJobStatus>(db,
    'SELECT * FROM cpg_drive_jobs WHERE id = ? LIMIT 1', jobId);
  if (!job) return null;

  const trips = await query<DriveJobStatus['trips'][number]>(db, `
    SELECT jt.*,
      COALESCE((SELECT COUNT(*) FROM footage_chunks WHERE request_id = jt.footage_request_id AND status = 'downloaded'), 0) AS chunks_done,
      COALESCE((SELECT COUNT(*) FROM footage_chunks WHERE request_id = jt.footage_request_id AND status = 'missing'), 0) AS chunks_missing
    FROM cpg_drive_job_trips jt WHERE jt.job_id = ? ORDER BY jt.trip_number ASC`, jobId);

  // Sync trip status from live chunk counts.
  let totalReady = 0;
  for (const t of trips) {
    totalReady += t.chunks_done;
    const done = t.chunks_done + t.chunks_missing;
    if (t.chunk_count > 0 && done >= t.chunk_count) {
      const newStatus = t.chunks_done > 0 ? 'done' : 'partial';
      if (t.status !== newStatus) {
        await execute(db, `UPDATE cpg_drive_job_trips SET chunks_done = ?, chunks_missing = ?, status = ? WHERE id = ?`,
          t.chunks_done, t.chunks_missing, newStatus, t.id).catch(() => {});
        t.status = newStatus;
      }
    }
  }

  // Sync parent job.
  const allDone = trips.every((t) => t.status === 'done' || t.status === 'partial');
  const newJobStatus = allDone && trips.length > 0 ? 'done' : job.status;
  if (newJobStatus !== job.status || totalReady !== job.clips_ready) {
    await execute(db, `UPDATE cpg_drive_jobs SET status = ?, clips_ready = ?, updated_at = datetime('now') WHERE id = ?`,
      newJobStatus, totalReady, jobId).catch(() => {});
  }

  return { ...job, status: newJobStatus, clips_ready: totalReady, trips };
}

// ── Cron poll (no flexcam_enabled gate) ─────────────────────

/** Process pending full-drive footage_chunks regardless of flexcam_enabled.
 *  Called by the per-minute ClearPath cron so drives work even without FlexCam turned on. */
export async function maybePollFullDriveChunks(env: Bindings): Promise<void> {
  const db = getDb(env);
  // Only run if ClearPath integration is active.
  const client = await getApiConfig(db, env).catch(() => null);
  if (!client) return;
  if (!(await isEnabled(db))) return;

  // Resume any requests where chunk creation was truncated by a Worker timeout.
  const resumed = await resumeTruncatedRequests(env).catch(() => null);
  if (resumed?.added) log.info('resumed requests', { resumed: resumed.resumed, added: resumed.added });

  // Are there any full-drive requests with pending chunks (any reason)?
  const pending = await queryFirst<{ n: number }>(db, `
    SELECT COUNT(*) AS n FROM footage_chunks ch
    JOIN footage_requests rq ON rq.id = ch.request_id
    WHERE ch.status IN ('pending_request','requested') LIMIT 1`).catch(() => null);
  if (!pending?.n) return;

  const r = await runRequestPass(env).catch((err) => {
    log.error('request pass failed', {}, err);
    return null;
  });
  if (r?.requested) log.info('requested chunks', { requested: r.requested });

  // Also run the download pass so requested → downloaded without flexcam_enabled gate.
  const d = await pollAndDownload(env).catch((err) => {
    log.error('download pass failed', {}, err);
    return null;
  });
  if (d?.downloaded) log.info('downloaded chunks', { downloaded: d.downloaded });
}
