// ============================================================
// ServeManager Auto-Poller
// ============================================================
// Polls ServeManager for new jobs from a target client (default:
// ICU Investigations, LLC) and auto-creates dispatch calls for
// each unlinked job. Follows the same start/stop/restart pattern
// as emailPoller.ts and clearPathGpsPoller.ts.

import { getDb } from '../models/database';
import { smGet, getApiKey } from './serveManagerClient';
import { upsertJobFromApi, upsertAttemptFromApi } from '../routes/servemanager';
import { generateCallNumber } from './caseNumbers';
import { broadcastDispatchUpdate } from './websocket';
import { geocodeCallIfNeeded } from './geocode';
import { createNotificationForRoles } from '../routes/notifications';
import { localNow } from './timeUtils';

// ── Config keys (system_config, category='integrations') ─────

const CONFIG_KEYS = {
  pollerEnabled: 'servemanager_poller_enabled',
  pollInterval: 'servemanager_poll_interval',
  targetClient: 'servemanager_target_client',
  autoCreateCalls: 'servemanager_auto_create_calls',
  lastPollAt: 'servemanager_last_poll_at',
};

const DEFAULT_TARGET_CLIENT = 'ICU Investigations, LLC';
const DEFAULT_POLL_INTERVAL = 300; // seconds
const MAX_CALLS_PER_CYCLE = 25;   // prevent notification flood on first run
const INITIAL_DELAY = 20_000;     // 20s after server boot

// ── Config helpers ───────────────────────────────────────────

function getSmConfig(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function setSmConfig(key: string, value: string): void {
  const db = getDb();
  const now = localNow();
  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);
  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, value, now, now);
}

function isEnabled(): boolean {
  return getSmConfig(CONFIG_KEYS.pollerEnabled) === 'true';
}

function getTargetClient(): string {
  return getSmConfig(CONFIG_KEYS.targetClient) || DEFAULT_TARGET_CLIENT;
}

function getPollIntervalMs(): number {
  const secs = parseInt(getSmConfig(CONFIG_KEYS.pollInterval) || String(DEFAULT_POLL_INTERVAL), 10);
  return Math.max(60, Math.min(1800, secs)) * 1000;
}

// ── Field mapping: SM job → dispatch call ────────────────────

interface SmJobRow {
  id: number;
  sm_job_number: string;
  job_status: string;
  service_status: string;
  client_company_name: string;
  recipient_name: string | null;
  recipient_description: string | null;
  service_instructions: string | null;
  court_case_number: string | null;
  due_date: string | null;
  rush: number;
  addresses_json: string;
  documents_json: string;
  attempt_count: number;
}

function guessProcessType(documents: any[]): string {
  const titles = documents.map((d: any) => (d.title || '').toLowerCase()).join(' ');
  if (titles.includes('subpoena')) return 'subpoena';
  if (titles.includes('summons')) return 'summons';
  if (titles.includes('complaint')) return 'complaint';
  if (titles.includes('eviction')) return 'eviction';
  if (titles.includes('restraining') || titles.includes('protective')) return 'restraining_order';
  return 'other';
}

function mapSmJobToCallData(job: SmJobRow) {
  let addresses: any[] = [];
  try { addresses = JSON.parse(job.addresses_json || '[]'); } catch { /* malformed — use empty */ }
  if (!Array.isArray(addresses)) addresses = [];
  const primary = addresses.find((a: any) => a.primary) || addresses[0];

  const locationAddress = primary
    ? [primary.address1, primary.address2, primary.city, primary.state, primary.postal_code]
        .filter(Boolean).join(', ')
    : 'Address pending — see ServeManager';

  const latitude = primary?.lat || primary?.latitude || null;
  const longitude = primary?.lng || primary?.longitude || null;

  let documents: any[] = [];
  try { documents = JSON.parse(job.documents_json || '[]'); } catch { /* malformed — use empty */ }
  if (!Array.isArray(documents)) documents = [];
  const docNames = documents.map((d: any) => d.title).filter(Boolean).join(', ');

  const descParts: string[] = [];
  descParts.push(`ServeManager Job #${job.sm_job_number}`);
  if (job.recipient_name) descParts.push(`Serve to: ${job.recipient_name}`);
  if (job.recipient_description) descParts.push(`Description: ${job.recipient_description}`);
  if (job.service_instructions) descParts.push(`Instructions: ${job.service_instructions}`);
  if (job.court_case_number) descParts.push(`Court Case: ${job.court_case_number}`);
  if (docNames) descParts.push(`Documents: ${docNames}`);
  if (job.due_date) descParts.push(`Due: ${job.due_date}`);

  return {
    incident_type: 'Process Service',
    priority: job.rush ? 'P2' : 'P3',
    location_address: locationAddress,
    latitude,
    longitude,
    description: descParts.join('\n'),
    source: 'servemanager',
    caller_name: job.client_company_name || 'ServeManager',
    pso_service_type: 'process_service',
    process_service_type: guessProcessType(documents),
    process_served_to: job.recipient_name || null,
    process_served_address: locationAddress,
    process_attempts: job.attempt_count || 0,
    notes: `Auto-created from ServeManager job #${job.sm_job_number}`,
  };
}

// ── Core poll logic ──────────────────────────────────────────

async function pollOnce(): Promise<{ synced: number; callsCreated: number }> {
  if (!getApiKey()) return { synced: 0, callsCreated: 0 };
  if (!isEnabled()) return { synced: 0, callsCreated: 0 };

  const db = getDb();
  let synced = 0;
  let callsCreated = 0;

  // 1. Fetch recent jobs from SM API (incremental)
  const params: Record<string, string> = { per_page: '100' };
  const lastPoll = getSmConfig(CONFIG_KEYS.lastPollAt);
  if (lastPoll) {
    params['filter[date_range][type]'] = 'updated_at';
    params['filter[date_range][min]'] = lastPoll;
  }

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    params.page = String(page);
    const result = await smGet('/jobs', params);

    if (Array.isArray(result.data)) {
      for (const job of result.data) {
        upsertJobFromApi(job);
        synced++;
        // Also upsert attempts inline
        if (Array.isArray(job.attempts)) {
          for (const attempt of job.attempts) {
            upsertAttemptFromApi({ ...attempt, job_id: job.id });
          }
        }
      }
      hasMore = result.links?.next != null && result.data.length > 0;
      page++;
    } else {
      hasMore = false;
    }

    if (page > 50) hasMore = false; // safety valve
  }

  // 2. Record poll timestamp
  setSmConfig(CONFIG_KEYS.lastPollAt, localNow());

  // 3. Create dispatch calls for unlinked target-client jobs
  if (getSmConfig(CONFIG_KEYS.autoCreateCalls) !== 'false') {
    const targetClient = getTargetClient();

    const unlinkedJobs = db.prepare(`
      SELECT * FROM sm_jobs
      WHERE client_company_name = ?
        AND linked_call_id IS NULL
        AND job_status NOT IN ('Cancelled', 'Closed')
        AND archived_at IS NULL
      ORDER BY id ASC
      LIMIT ?
    `).all(targetClient, MAX_CALLS_PER_CYCLE) as SmJobRow[];

    for (const job of unlinkedJobs) {
      try {
        const callData = mapSmJobToCallData(job);
        const callNumber = generateCallNumber(db);
        const now = localNow();

        const callId = db.transaction(() => {
          const result = db.prepare(`
            INSERT INTO calls_for_service (
              call_number, incident_type, priority, status,
              location_address, latitude, longitude, description, notes, source,
              caller_name, dispatcher_id,
              pso_service_type, process_service_type, process_served_to,
              process_served_address, process_attempts,
              created_at, updated_at
            ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            callNumber, callData.incident_type, callData.priority,
            callData.location_address, callData.latitude, callData.longitude,
            callData.description, callData.notes, callData.source,
            callData.caller_name, 1, // dispatcher_id = system admin
            callData.pso_service_type, callData.process_service_type,
            callData.process_served_to, callData.process_served_address,
            callData.process_attempts, now, now
          );

          const newCallId = result.lastInsertRowid as number;

          // Link SM job to prevent future duplicates
          db.prepare('UPDATE sm_jobs SET linked_call_id = ? WHERE id = ?').run(newCallId, job.id);

          // Audit log
          db.prepare(
            'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(1, 'call_created', 'call', newCallId,
            `Auto-created from SM job #${job.sm_job_number}: Process Service`,
            'system', now);

          return newCallId;
        })();

        // Post-transaction: geocode, broadcast, notify
        const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);

        if (!callData.latitude) {
          geocodeCallIfNeeded(callId as number, callData.location_address, null, null);
        }

        broadcastDispatchUpdate({ action: 'call_created', call });

        createNotificationForRoles(
          ['admin', 'manager', 'supervisor', 'dispatcher'],
          'dispatch',
          `New Process Service: ${callNumber}`,
          `SM Job #${job.sm_job_number} — ${job.recipient_name || 'Unknown'} at ${callData.location_address}`,
          'call', callId as number, 'normal', 'dispatch.call_created'
        );

        callsCreated++;
        console.log(`[ServeManager] Created call ${callNumber} from SM job #${job.sm_job_number}`);
      } catch (err: any) {
        console.error(`[ServeManager] Failed to create call for SM job #${job.sm_job_number}:`, err.message);
      }
    }
  }

  if (synced > 0 || callsCreated > 0) {
    console.log(`[ServeManager] Poll complete: ${synced} jobs synced, ${callsCreated} calls created`);
  }

  return { synced, callsCreated };
}

// ── Start / Stop / Restart ───────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startServeManagerPoller(): void {
  if (intervalHandle) return;

  // Don't start if not configured
  if (!getApiKey()) {
    console.log('[ServeManager] Poller skipped — no API key configured');
    return;
  }
  if (!isEnabled()) {
    console.log('[ServeManager] Poller skipped — not enabled');
    return;
  }

  const pollMs = getPollIntervalMs();
  console.log(`[ServeManager] Starting auto-poller — every ${pollMs / 1000}s`);

  // Initial poll after delay
  setTimeout(() => {
    pollOnce().catch(err => {
      console.error('[ServeManager] Initial poll error:', err.message || err);
    });
  }, INITIAL_DELAY);

  intervalHandle = setInterval(() => {
    pollOnce().catch(err => {
      console.error('[ServeManager] Poll error:', err.message || err);
    });
  }, pollMs);
  intervalHandle.unref();
}

export function stopServeManagerPoller(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[ServeManager] Auto-poller stopped');
  }
}

export function restartServeManagerPoller(): void {
  stopServeManagerPoller();
  startServeManagerPoller();
}

/** Trigger an immediate poll (for admin "Poll Now" button). */
export async function pollServeManagerNow(): Promise<{ synced: number; callsCreated: number; error?: string }> {
  try {
    return await pollOnce();
  } catch (err: any) {
    return { synced: 0, callsCreated: 0, error: err.message };
  }
}
