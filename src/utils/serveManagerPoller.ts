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
import { fetchRecentJobs, getStoredKey, type SmJob } from './serveManagerClient';
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
  descParts.push(`ServeManager Job #${job.job_number}`);
  if (job.recipient?.full_name) descParts.push(`Serve to: ${job.recipient.full_name}`);
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
    caller_name: job.client?.company_name || job.client?.full_name || null,
    caller_phone: null,
    case_number: job.court_case_number || null,
    due_date: job.due_date || null,
    serve_job_number: job.job_number,
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

    const targetClient = (await getSmConfig(db, 'servemanager_target_client')) || DEFAULT_TARGET_CLIENT;
    const lastPoll = await getSmConfig(db, 'servemanager_last_poll_at');

    const jobs = await fetchRecentJobs(db, jwtSecret, lastPoll || undefined);
    if (jobs.length === 0) return { synced: 0, callsCreated: 0 };

    let synced = 0;
    let callsCreated = 0;

    for (const job of jobs) {
      // Skip non-target-client jobs
      const clientName = job.client?.company_name || job.client?.full_name || '';
      if (!clientName.toLowerCase().includes(targetClient.toLowerCase())) continue;

      // Check if this job already has a linked call
      const existing = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM sm_jobs WHERE sm_job_id = ?', job.id,
      );
      if (existing) {
        // Update the cached job row
        await execute(db,
          `UPDATE sm_jobs SET job_status=?, service_status=?, updated_at=datetime('now','localtime') WHERE sm_job_id=?`,
          job.job_status, job.service_status, job.id);
        synced++;
        continue;
      }

      // Auto-create calls only if configured
      const autoCreate = await getSmConfig(db, 'servemanager_auto_create_calls');
      if (autoCreate !== 'true') continue;

      // Map and create dispatch call
      const callData = mapSmJobToCallData(job);
      const year = new Date().getFullYear().toString().slice(-2);
      const seq = await queryFirst<{ max: string | null }>(
        db, "SELECT MAX(call_number) AS max FROM calls_for_service WHERE call_number LIKE ?", `CFS${year}-%`,
      );
      const seqNum = seq?.max
        ? String(parseInt(seq.max.slice(4), 10) + 1).padStart(5, '0')
        : '00001';
      callData.call_number = `CFS${year}-${seqNum}`;

      const colNames = ['call_number', 'incident_type', 'priority', 'status', 'source',
        'location_address', 'latitude', 'longitude', 'description', 'caller_name',
        'created_at', 'updated_at'];
      const values = [callData.call_number, callData.incident_type, callData.priority,
        callData.status, callData.source, callData.location_address,
        callData.latitude, callData.longitude, callData.description,
        callData.caller_name];
      const placeholders = colNames.map(() => '?').join(',');
      const result = await execute(db,
        `INSERT INTO calls_for_service (${colNames.join(',')}, created_at, updated_at) VALUES (${placeholders}, datetime('now','localtime'), datetime('now','localtime'))`,
        ...values,
      );
      const callId = Number(result.meta.last_row_id);

      // Cache the SM job link
      await execute(db,
        `INSERT INTO sm_jobs (sm_job_id, sm_job_number, client_company_name, recipient_name,
           job_status, service_status, court_case_number, due_date, linked_call_id,
           process_type, addresses_json, documents_json, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`,
        job.id, job.job_number, clientName, job.recipient?.full_name || null,
        job.job_status, job.service_status, job.court_case_number || null,
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

    // Update last poll timestamp
    await execute(db,
      `DELETE FROM system_config WHERE config_key = 'servemanager_last_poll_at' AND category = 'integrations'`);
    await execute(db,
      `INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
       VALUES ('servemanager_last_poll_at', datetime('now','localtime'), 'integrations', 0, 1, datetime('now','localtime'), datetime('now','localtime'))`);

    return { synced, callsCreated };
  } catch (err) {
    console.error('[sm-poller] Cycle failed:', (err as Error).message);
    return { synced: 0, callsCreated: 0, error: (err as Error).message };
  }
}
