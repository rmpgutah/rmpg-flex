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
import { log } from './logger';
import { fetchRecentJobs, extractJobAttempts, type SmJob } from './serveManagerClient';
import { broadcastAll } from '../routes/ws';
import { recordAuditCore } from './auditLog';

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

// Upserts every attempt embedded on a job into sm_attempts, keyed by the
// attempt's own id (INSERT OR REPLACE — idempotent across repeat syncs of
// the same job). Returns how many were written. See SmJob.attempts for the
// caveat that this field mapping is unverified against a real non-empty
// sample — the account had zero served attempts as of 2026-08-09.
async function upsertJobAttempts(db: D1Database, job: SmJob): Promise<number> {
  const attempts = extractJobAttempts(job);
  let count = 0;
  for (const a of attempts) {
    if (a.id == null) continue;
    await execute(db,
      `INSERT OR REPLACE INTO sm_attempts (id, job_id, description, success, service_status,
         serve_type, served_at, lat, lng, gps_timestamp, server_name, recipient_name,
         attachments_json, sm_created_at, sm_updated_at, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      String(a.id), String(job.id), a.description ?? null, a.success == null ? null : (a.success ? 1 : 0),
      a.service_status ?? null, a.serve_type ?? null, a.served_at ?? null,
      a.lat ?? a.latitude ?? null, a.lng ?? a.longitude ?? null, a.gps_timestamp ?? null,
      a.server_name ?? a.employee_process_server?.name ?? null,
      a.recipient_name ?? null, JSON.stringify(a.attachments ?? []),
      a.created_at ?? null, a.updated_at ?? null,
    );
    count++;
  }
  return count;
}

// employee_process_server (in-house server) uses first_name/last_name, while
// process_server_company/process_server_contact (external server) are name-
// keyed like every other confirmed ServeManager resource. Confirmed live
// 2026-08-09 against a real in-house-served job. Attempts also embed an
// employee_process_server; its name field is first_name/last_name as well.
function getProcessServerName(job: SmJob): string | null {
  const emp = job.employee_process_server;
  if (emp?.first_name || emp?.last_name) {
    return [emp.first_name, emp.last_name].filter(Boolean).join(' ');
  }
  return job.process_server_company?.name || job.process_server_contact?.name || null;
}

// Normalize the `rush` field — ServeManager returns boolean or 0/1 integer
// depending on API version. Store as SQLite INTEGER (1/0/null).
function rushToInt(rush: boolean | number | undefined | null): number | null {
  if (rush == null) return null;
  return rush ? 1 : 0;
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
    priority: (job.rush) ? 'P2' : 'P3',
    status: 'pending',
    source: 'servemanager',
    location_address: locAddress,
    latitude: lat,
    // Latitude and longitude are independent — only omit longitude if it is
    // genuinely absent. The original `lat && lng ? lng : null` expression used
    // lat's truthiness as the guard for lng, so a job with lat=0 (impossible
    // for Utah but logically wrong) or a null lat would zero out both.
    longitude: lng,
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

// Upserts the sm_jobs cache row for a job. `linkedCallId` is left untouched
// on an UPDATE unless explicitly provided — cacheJob(db, job) (no call yet)
// must never clobber a linked_call_id an earlier createDispatchCallForJob
// call already set for the same job.
async function cacheJob(db: D1Database, job: SmJob, linkedCallId?: number): Promise<void> {
  const clientName = job.client_company?.name || '';
  const recipientName = (job.recipient?.name || job.recipient?.full_name) || null;
  const processType = guessProcessType(job.documents || []);
  const rushVal = rushToInt(job.rush);

  const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM sm_jobs WHERE sm_job_id = ?', job.id);
  if (existing) {
    // Refresh ALL mutable fields on update — addresses, documents, status,
    // recipient, and rush can all change between syncs. Omitting them (as
    // the original code did) meant a job cached before a location correction
    // in SM would forever show the wrong address in RMPG.
    const sets = [
      'job_status=?', 'service_status=?', 'sm_job_number=?',
      'process_server_name=?', 'client_job_number=?',
      'client_company_name=?', 'recipient_name=?',
      'due_date=?', 'rush=?', 'service_instructions=?',
      'addresses_json=?', 'documents_json=?',
      'court_case_number=?',
      "sm_updated_at=?", "updated_at=datetime('now')",
    ];
    const vals: unknown[] = [
      job.job_status ?? null, job.service_status ?? null,
      job.servemanager_job_number ?? null,
      getProcessServerName(job), job.client_job_number || null,
      clientName, recipientName,
      job.due_date || null, rushVal, job.service_instructions || null,
      JSON.stringify(job.addresses || []), JSON.stringify(job.documents || []),
      job.court_case?.number || null,
      job.updated_at || null,
    ];
    if (linkedCallId != null) { sets.push('linked_call_id=?'); vals.push(linkedCallId); }
    await execute(db, `UPDATE sm_jobs SET ${sets.join(', ')} WHERE sm_job_id=?`, ...vals, job.id);
    return;
  }
  await execute(db,
    `INSERT INTO sm_jobs (
       sm_job_id, sm_job_number, client_company_name, recipient_name,
       recipient_description, job_status, service_status, court_case_number,
       due_date, rush, service_instructions, linked_call_id, process_type,
       addresses_json, documents_json, process_server_name, client_job_number,
       sm_created_at, sm_updated_at, synced_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    job.id, job.servemanager_job_number ?? null, clientName, recipientName,
    job.recipient?.description || null,
    job.job_status ?? null, job.service_status ?? null, job.court_case?.number || null,
    job.due_date || null, rushVal, job.service_instructions || null,
    linkedCallId ?? null, processType,
    JSON.stringify(job.addresses || []), JSON.stringify(job.documents || []),
    getProcessServerName(job), job.client_job_number || null,
    job.created_at || null, job.updated_at || null,
  );
}

// After upserting attempts, keep sm_jobs.attempt_count in sync so the
// Cached Jobs table shows an accurate attempt tally without a separate query.
async function syncAttemptCount(db: D1Database, jobId: number | string): Promise<void> {
  const row = await queryFirst<{ n: number }>(
    db, 'SELECT COUNT(*) AS n FROM sm_attempts WHERE job_id = ?', String(jobId),
  );
  if (row != null) {
    await execute(db, 'UPDATE sm_jobs SET attempt_count = ? WHERE sm_job_id = ?', row.n, jobId);
  }
}

// Creates the dispatch call + linked serve_queue row for a job, and upserts
// its sm_jobs cache row with the new linked_call_id. Extracted so the manual
// "Create Dispatch" action (POST /servemanager/jobs/:jobId/create-dispatch)
// shares the identical, comprehensive mapping instead of a second,
// inevitably-divergent copy — every field-name bug this integration has hit
// (job_number, client, court_case, recipient, process_server, ...) came from
// exactly that kind of duplication. Caller must have already verified the
// job isn't already linked (sm_jobs.linked_call_id is null or absent).
export async function createDispatchCallForJob(
  env: Bindings, job: SmJob,
): Promise<{ callId: number; callNumber: string; queueId: number }> {
  const db = env.DB;
  const clientName = job.client_company?.name || '';
  const callData = mapSmJobToCallData(job);
  const year = new Date().getFullYear().toString().slice(-2);
  const prefix = `CFS${year}-`;
  const nextCallNumber = async () => {
    const seq = await queryFirst<{ max: string | null }>(
      db, 'SELECT MAX(call_number) AS max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`,
    );
    const seqNum = seq?.max
      ? String(parseInt(seq.max.split('-')[1], 10) + 1).padStart(5, '0')
      : '00001';
    return `${prefix}${seqNum}`;
  };
  callData.call_number = await nextCallNumber();

  // `contract_id` is a FK to a PSO contracts table row, not a free-text job
  // number — storing job.servemanager_job_number there caused FK violations on
  // accounts where the column has a FK constraint, and placed a text identifier
  // in a numeric FK column. SM job number belongs in `pso_billing_code` (a text
  // field that already carries client billing references).
  const colNames = ['call_number', 'incident_type', 'priority', 'status', 'source',
    'location_address', 'latitude', 'longitude', 'description', 'caller_name',
    'pso_requestor_name', 'pso_requestor_email', 'pso_billing_code', 'pso_service_type'];
  const values = [callData.call_number, callData.incident_type, callData.priority,
    callData.status, callData.source, callData.location_address,
    callData.latitude, callData.longitude, callData.description,
    callData.caller_name,
    job.attorney_name || clientName || null, job.attorney_email || null,
    job.servemanager_job_number ?? null, callData.process_type];
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

  // Audit trail entry — matches the CREATE row POST /dispatch/calls writes
  // (dispatch/calls.ts). Without this, every ServeManager-created call (the
  // majority of the queue) starts with zero audit_log rows, so its Timeline
  // and Audit tabs both read as empty until a human takes some other action
  // on the call. Best-effort: never block call creation on it.
  try {
    await recordAuditCore(env, {
      action: 'CREATE',
      entityType: 'call',
      entityId: callId,
      details: `Created call ${callData.call_number} from ServeManager job ${job.servemanager_job_number ?? job.id}`,
    });
  } catch (auditErr) {
    console.warn('audit_log insert failed for ServeManager call create:', auditErr);
  }

  await cacheJob(db, job, callId);

  const primaryAddr = (job.addresses || []).find((a) => a.primary) || (job.addresses || [])[0];
  const queueResult = await execute(db,
    `INSERT INTO serve_queue (
       call_id, sm_job_id, serve_date,
       recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
       recipient_lat, recipient_lng, case_number, client_name, priority, deadline,
       service_instructions, status
     ) VALUES (?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?)`,
    callId, job.id, job.due_date || null,
    (job.recipient?.name || job.recipient?.full_name) || null, primaryAddr?.address1 || null,
    primaryAddr?.city || null, primaryAddr?.state || null, primaryAddr?.postal_code || null,
    primaryAddr?.lat ?? primaryAddr?.latitude ?? null, primaryAddr?.lng ?? primaryAddr?.longitude ?? null,
    job.court_case?.number || null, clientName || null, job.rush ? 'rush' : 'normal', job.due_date || null,
    job.service_instructions || null, 'pending',
  );

  try {
    broadcastAll('dispatch_update', {
      action: 'call_created',
      call: { id: callId, call_number: callData.call_number, priority: callData.priority,
              incident_type: callData.incident_type, status: callData.status,
              location_address: callData.location_address, description: callData.description },
    });
  } catch { /* best-effort */ }

  return { callId, callNumber: callData.call_number as string, queueId: Number(queueResult.meta.last_row_id) };
}

// ── Main polling cycle ────────────────────────────────────────

export async function pollServeManagerJobs(env: Bindings): Promise<{ synced: number; callsCreated: number; attemptsSynced: number; error?: string }> {
  const db = env.DB;

  try {
    const enabled = await getSmConfig(db, 'servemanager_poller_enabled');
    if (enabled !== 'true') return { synced: 0, callsCreated: 0, attemptsSynced: 0 };

    const targetClient = await getTargetClient(db);
    const lastPoll = await getSmConfig(db, 'servemanager_last_poll_at');

    const jobs = await fetchRecentJobs(db, env, lastPoll || undefined);
    if (jobs.length === 0) return { synced: 0, callsCreated: 0, attemptsSynced: 0 };

    // Hoist the auto-create config read outside the loop — fetching it per job
    // burns one D1 round-trip per job and was the primary reason large syncs
    // were slow. One read at cycle start is sufficient; admin changes take effect
    // on the next poll cycle (acceptable for a 5-min+ interval setting).
    const autoCreate = await getSmConfig(db, 'servemanager_auto_create_calls');

    let synced = 0;
    let callsCreated = 0;
    let attemptsSynced = 0;

    for (const job of jobs) {
      // Skip non-target-client jobs — an empty targetClient (admin explicitly
      // cleared the field) means "no filter", not "match nothing".
      const clientName = job.client_company?.name || '';
      if (targetClient && !clientName.toLowerCase().includes(targetClient.toLowerCase())) continue;

      // Sync attempts regardless of whether the job's call already exists —
      // a job can accrue new service attempts after its call was created.
      const newAttempts = await upsertJobAttempts(db, job);
      attemptsSynced += newAttempts;
      // Keep sm_jobs.attempt_count in sync so the Cached Jobs table is accurate.
      if (newAttempts > 0) await syncAttemptCount(db, job.id);

      // Check if this job is already cached and/or already has a linked call.
      const existing = await queryFirst<{ linked_call_id: number | null }>(
        db, 'SELECT linked_call_id FROM sm_jobs WHERE sm_job_id = ?', job.id,
      );
      if (existing?.linked_call_id) {
        // Refresh ALL mutable cached fields — the original code omitted
        // addresses, documents, rush, and other fields on subsequent syncs.
        await cacheJob(db, job);
        synced++;
        continue;
      }

      // Not yet linked to a call — cache it regardless of auto-create so it
      // shows up in the Cached Jobs list and can be manually dispatched.
      if (!existing) await cacheJob(db, job);

      if (autoCreate !== 'true') { synced++; continue; }

      try {
        await createDispatchCallForJob(env, job);
        callsCreated++;
      } catch (callErr) {
        log.error('createDispatchCallForJob failed for job', { jobId: job.id }, callErr as Error);
      }
      synced++;
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

    return { synced, callsCreated, attemptsSynced };
  } catch (err) {
    console.error('[sm-poller] Cycle failed:', (err as Error).message);
    return { synced: 0, callsCreated: 0, attemptsSynced: 0, error: (err as Error).message };
  }
}
