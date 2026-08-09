// ============================================================
// RMPG Flex — ServeManager Job Poller (Cloudflare Worker)
// ============================================================
// Cron-driven poller that fetches ServeManager jobs for the
// configured target client and creates dispatch calls for
// unlinked jobs. Replaces the legacy VPS setInterval poller.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { queryFirst, execute } from './db';
import { fetchRecentJobs, fetchJobAttempts, getStoredKey, type SmJob } from './serveManagerClient';
import { broadcastAll } from '../routes/ws';

const DEFAULT_TARGET_CLIENT = 'ICU Investigations, LLC';

// ── Config helpers ────────────────────────────────────────────

async function getSmConfig(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(
    db,
    "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1",
    key,
  );
  return row?.config_value ?? null;
}

// getSmConfig returns null both when a config row is absent AND when it exists
// with an explicitly empty string — JS's `|| DEFAULT` treats those the same,
// which silently re-applies DEFAULT_TARGET_CLIENT after an admin clears the
// field on /admin?tab=servemanager expecting "no filter" (confirmed live
// 2026-08-08: a real job was skipped because it didn't match ICU). Fetch the
// row directly so an existing-but-empty value can mean "sync everything".
async function getTargetClient(db: D1Database): Promise<string> {
  const row = await queryFirst<{ config_value: string }>(
    db,
    "SELECT config_value FROM system_config WHERE config_key = 'servemanager_target_client' AND category = 'integrations' AND is_active = 1 LIMIT 1",
  );
  if (row === null) return DEFAULT_TARGET_CLIENT;
  return row.config_value ?? '';
}

// ── Job upsert ────────────────────────────────────────────────

function guessProcessType(documents: any[]): string {
  const titles = documents.map((d: any) => (d.title || '').toLowerCase()).join(' ');
  if (titles.includes('subpoena')) return 'subpoena';
  if (titles.includes('summons')) return 'summons';
  if (titles.includes('complaint')) return 'complaint';
  if (titles.includes('eviction')) return 'eviction';
  return 'other';
}

function mapSmJobToCallData(job: SmJob) {
  const addresses = job.addresses || [];
  const primary = addresses.find((a) => a.primary) || addresses[0];
  const locAddress = primary
    ? [primary.address1, primary.address2, primary.city, primary.state, primary.postal_code].filter(Boolean).join(', ')
    : 'Address pending — see ServeManager';
  const lat = primary?.lat ?? primary?.latitude ?? null;
  const lng = primary?.lng ?? primary?.longitude ?? null;
  const documents = job.documents || [];
  const docNames = documents.map((d) => d.title).filter(Boolean).join(', ');

  const descParts: string[] = [];
  if (job.servemanager_job_number) descParts.push(`ServeManager Job #${job.servemanager_job_number}`);
  const recipientName = job.recipient?.name || job.recipient?.full_name;
  if (recipientName) descParts.push(`Serve to: ${recipientName}`);
  if (job.recipient?.description) descParts.push(`Description: ${job.recipient.description}`);
  if (docNames) descParts.push(`Documents: ${docNames}`);
  if (job.service_instructions) descParts.push(`Instructions: ${job.service_instructions}`);

  return {
    call_number: null as string | null, // generated after insert
    incident_type: 'pso_client_request',
    priority: job.rush ? 'P2' : 'P3',
    status: 'pending',
    source: 'servemanager',
    location_address: locAddress,
    latitude: lat,
    longitude: lat && lng ? lng : null,
    description: descParts.join(' | '),
    caller_name: job.client_company?.name || null,
    caller_phone: null,
    case_number: job.court_case?.number || null,
    due_date: job.due_date || null,
    serve_job_number: job.servemanager_job_number,
    process_type: guessProcessType(documents),
    servemanager_job_id: job.id,
    servemanager_updated_at: job.updated_at || null,
  };
}

// ── Main polling cycle ────────────────────────────────────────

export async function pollServeManagerJobs(env: Bindings): Promise<{ synced: number; callsCreated: number; error?: string }> {
  const db = env.DB;
  const jwtSecret = env.JWT_SECRET;

  try {
    const enabled = await getSmConfig(db, 'servemanager_poller_enabled');
    if (enabled !== 'true') return { synced: 0, callsCreated: 0 };

    const targetClient = await getTargetClient(db);
    const lastPoll = await getSmConfig(db, 'servemanager_last_poll_at');

    const jobs = await fetchRecentJobs(db, jwtSecret, lastPoll || undefined);
    if (jobs.length === 0) return { synced: 0, callsCreated: 0 };

    // TEMP DIAGNOSTIC (remove immediately after capturing one log line):
    // attempts_synced is hardcoded to 0 everywhere — there is no attempts
    // sync at all. fetchJobAttempts() exists but is never called. Job keys
    // captured 2026-08-08 include a top-level "attempts" — checking whether
    // it's embedded inline vs needs the separate /jobs/:id/attempts call,
    // and which id (numeric job.id vs servemanager_job_number) that
    // endpoint actually wants.
    const j0: any = jobs[0];
    try {
      const viaId = await fetchJobAttempts(db, jwtSecret, String(j0.id));
      console.error('[sm-poller] DIAGNOSTIC attempts:', JSON.stringify({
        embedded_attempts: j0.attempts,
        attempt_count: j0.attempt_count,
        via_numeric_id: viaId,
      }));
    } catch (diagErr) {
      console.error('[sm-poller] DIAGNOSTIC attempts fetch threw:', (diagErr as Error).message);
    }

    let synced = 0;
    let callsCreated = 0;

    for (const job of jobs) {
      // Skip non-target-client jobs — an empty targetClient (admin explicitly
      // cleared the field) means "no filter", not "match nothing". The real
      // payload has no top-level `client` object (confirmed live 2026-08-08)
      // — the client company lives under the nested `client_company.name`.
      const clientName = job.client_company?.name || '';
      if (targetClient && !clientName.toLowerCase().includes(targetClient.toLowerCase())) continue;

      // Check if this job already has a linked call
      const existing = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM sm_jobs WHERE sm_job_id = ?', job.id,
      );
      if (existing) {
        // Update the cached job row. sm_job_number is included here (not
        // just on the initial INSERT below) because a row cached before
        // the servemanager_job_number field-name fix landed would
        // otherwise be stuck showing a blank "Job #" forever — the
        // existing-job branch never re-derives it once cached. Confirmed
        // live 2026-08-09: the fix deployed, but a job cached moments
        // earlier still showed sm_job_number: null until this refresh.
        await execute(db,
          `UPDATE sm_jobs SET job_status=?, service_status=?, sm_job_number=?, updated_at=datetime('now') WHERE sm_job_id=?`,
          job.job_status ?? null, job.service_status ?? null, job.servemanager_job_number ?? null, job.id);
        synced++;
        continue;
      }

      // Auto-create calls only if configured
      const autoCreate = await getSmConfig(db, 'servemanager_auto_create_calls');
      if (autoCreate !== 'true') continue;

      // Map and create dispatch call
      const callData = mapSmJobToCallData(job);
      const year = new Date().getFullYear().toString().slice(-2);
      const prefix = `CFS${year}-`;
      // call_number carries a UNIQUE constraint, and this read-max-then-
      // increment isn't atomic — two near-simultaneous poll cycles (a
      // manual sync racing the cron poller, or two rapid manual syncs) can
      // read the same MAX and collide on insert even with the slice bug
      // above fixed. nextCallNumber() is re-run on that specific collision
      // in the retry loop below, matching the pattern dispatch/calls.ts's
      // nextCallNumber() already uses for new-call creation.
      const nextCallNumber = async () => {
        const seq = await queryFirst<{ max: string | null }>(
          db, 'SELECT MAX(call_number) AS max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`,
        );
        // seq.max is e.g. "CFS26-00007" — the numeric suffix starts after
        // the '-', not at a fixed offset from the start (confirmed live
        // 2026-08-09: a fixed slice(4) offset parsed only the leading digit
        // of the year, recomputing the SAME seqNum forever).
        const seqNum = seq?.max
          ? String(parseInt(seq.max.split('-')[1], 10) + 1).padStart(5, '0')
          : '00001';
        return `${prefix}${seqNum}`;
      };
      callData.call_number = await nextCallNumber();

      // ⚠️ created_at / updated_at are supplied by the SQL below as
      // datetime('now') and must NOT appear here. Listing them produced:
      //   INSERT INTO calls_for_service (…,created_at,updated_at, created_at, updated_at)
      //   VALUES (12 placeholders, datetime('now'), datetime('now'))
      // — 14 columns with two duplicated (a hard SQLite error on its own),
      // 14 value expressions, and only 10 bindings supplied for 12 '?'.
      //
      // The statement could never succeed, and the blast radius is the whole
      // cycle rather than the one call: the throw unwinds to the function's
      // outer try/catch, so `synced` is discarded, the
      // servemanager_last_poll_at watermark never advances, and the caller
      // always sees {synced: 0, callsCreated: 0, error}. It is console-logged
      // but never reaches error_log, so the only evidence was a line in
      // Workers Logs saying the cycle failed.
      const colNames = ['call_number', 'incident_type', 'priority', 'status', 'source',
        'location_address', 'latitude', 'longitude', 'description', 'caller_name'];
      const values = [callData.call_number, callData.incident_type, callData.priority,
        callData.status, callData.source, callData.location_address,
        callData.latitude, callData.longitude, callData.description,
        callData.caller_name];
      const placeholders = colNames.map(() => '?').join(',');
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await execute(db,
            `INSERT INTO calls_for_service (${colNames.join(',')}, created_at, updated_at) VALUES (${placeholders}, datetime('now'), datetime('now'))`,
            ...values,
          );
          break;
        } catch (raceErr: any) {
          const raceMsg = String(raceErr?.message || raceErr || 'unknown');
          if (attempt < 4 && /SQLITE_CONSTRAINT/i.test(raceMsg) && /call_number/i.test(raceMsg)) {
            callData.call_number = await nextCallNumber();
            values[0] = callData.call_number;
            continue;
          }
          throw raceErr;
        }
      }
      const callId = Number(result.meta.last_row_id);

      // Cache the SM job link
      await execute(db,
        `INSERT INTO sm_jobs (sm_job_id, sm_job_number, client_company_name, recipient_name,
           job_status, service_status, court_case_number, due_date, linked_call_id,
           process_type, addresses_json, documents_json, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
        job.id, job.servemanager_job_number ?? null, clientName, (job.recipient?.name || job.recipient?.full_name) || null,
        job.job_status ?? null, job.service_status ?? null, job.court_case?.number || null,
        job.due_date || null, callId,
        callData.process_type,
        JSON.stringify(job.addresses || []), JSON.stringify(job.documents || []),
      );

      synced++;
      callsCreated++;

      // Broadcast the new dispatch call
      try {
        broadcastAll('dispatch_update', {
          action: 'call_created',
          call: { id: callId, call_number: callData.call_number, priority: callData.priority,
                  incident_type: callData.incident_type, status: callData.status,
                  location_address: callData.location_address, description: callData.description },
        });
      } catch { /* best-effort */ }
    }

    // Update last poll timestamp. system_config has a UNIQUE(config_key,
    // config_value) index (not just config_key), and datetime('now') is
    // second-precision, so two poll cycles completing in the same wall-clock
    // second (a manual sync racing the cron poller, or two rapid manual
    // syncs — confirmed live 2026-08-09) both DELETE the old row and then
    // race to INSERT the identical new (key, value) pair: whichever loses
    // hits SQLITE_CONSTRAINT_UNIQUE. That collision means the desired end
    // state — a row for this key holding this exact timestamp — already
    // exists via the winner, so it's safe to swallow rather than let it
    // unwind to the outer try/catch and discard synced/callsCreated for
    // the whole cycle.
    await execute(db,
      `DELETE FROM system_config WHERE config_key = 'servemanager_last_poll_at' AND category = 'integrations'`);
    try {
      await execute(db,
        `INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
         VALUES ('servemanager_last_poll_at', datetime('now'), 'integrations', 0, 1, datetime('now'), datetime('now'))`);
    } catch (raceErr: any) {
      const raceMsg = String(raceErr?.message || raceErr || 'unknown');
      if (!/SQLITE_CONSTRAINT/i.test(raceMsg) || !/system_config/i.test(raceMsg)) throw raceErr;
    }

    return { synced, callsCreated };
  } catch (err) {
    console.error('[sm-poller] Cycle failed:', (err as Error).message);
    return { synced: 0, callsCreated: 0, error: (err as Error).message };
  }
}
