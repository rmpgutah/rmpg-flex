// ============================================================
// RMPG Flex — Browser Sync Engine
// Mirrors desktop/syncManager.js — pulls data from the server
// to keep IndexedDB fresh, and pushes locally-created records
// back when connectivity returns. Uses fetch() + setInterval.
// ============================================================

import {
  getOfflineDb,
  replaceTable,
  deltaSync,
  getSyncMeta,
  getConfig,
  setConfig,
  getPendingQueue,
  markQueueItem,
  getQueueDepth,
  type StoreName,
} from './offlineDb';
import { isLikelyOnline } from './connectivityMonitor';

// ─── Types ──────────────────────────────────────────────────

type SyncEventType =
  | 'sync-progress'
  | 'sync-complete'
  | 'authorization-changed'
  | 'pin-expired';

type SyncEventCallback = (data: any) => void;

// ─── Module State ───────────────────────────────────────────

let serverUrl = '';
let authToken: string | null = null;
let pullTimers: Record<string, ReturnType<typeof setInterval>> = {};
let isSyncing = false;
let syncStartedAt: number | null = null;
let lastPushAt: string | null = null;
const SYNC_LOCK_TIMEOUT = 60_000; // force-release stale lock after 60s

const eventListeners: Map<SyncEventType, Set<SyncEventCallback>> = new Map();

// ─── Pull Sync Intervals (ms) — same as Electron ───────────

const PULL_INTERVALS: Record<string, number> = {
  users:              300_000,  // 5 min
  clients:            300_000,  // 5 min
  properties:         300_000,  // 5 min
  units:               10_000,  // 10s (most time-sensitive)
  calls_for_service:   30_000,  // 30s
  incidents:          120_000,  // 2 min
  time_entries:       120_000,  // 2 min
  persons:            600_000,  // 10 min
  vehicles_records:   600_000,  // 10 min
  citations:          120_000,  // 2 min
  field_interviews:   120_000,  // 2 min
  evidence:           300_000,  // 5 min
  criminal_history:   120_000,  // 2 min
  patrol_scans:       300_000,  // 5 min
  patrol_checkpoints: 300_000,  // 5 min (reference data)
  trespass_orders:    300_000,  // 5 min
  warrants:           600_000,  // 10 min (read-only cache)
};

const REFERENCE_TABLES = ['users', 'clients', 'properties', 'patrol_checkpoints'];

// ─── Event System ───────────────────────────────────────────

export function onSyncEvent(event: SyncEventType, callback: SyncEventCallback): () => void {
  if (!eventListeners.has(event)) eventListeners.set(event, new Set());
  eventListeners.get(event)!.add(callback);
  return () => { eventListeners.get(event)?.delete(callback); };
}

function emit(event: SyncEventType, data: any): void {
  eventListeners.get(event)?.forEach(cb => {
    try { cb(data); } catch { /* ignore */ }
  });
}

// ─── Sync Lock (with stale detection) ───────────────────────

function acquireSyncLock(): boolean {
  if (isSyncing && syncStartedAt && (Date.now() - syncStartedAt > SYNC_LOCK_TIMEOUT)) {
    console.warn('[SYNC] Force-releasing stale sync lock');
    isSyncing = false;
  }
  if (isSyncing) return false;
  isSyncing = true;
  syncStartedAt = Date.now();
  return true;
}

function releaseSyncLock(): void {
  isSyncing = false;
  syncStartedAt = null;
}

// ─── Public API ─────────────────────────────────────────────

export function startSyncSchedule(url: string, token?: string): void {
  serverUrl = url;
  if (token) authToken = token;

  console.log('[SYNC] Starting pull schedule');

  // Do an initial full pull
  pullAll().catch(err => console.error('[SYNC] Initial pull failed:', err?.message || err));

  // Also pull offline secrets for PIN system
  pullSecrets().catch(err => console.error('[SYNC] Secrets pull failed:', err?.message || err));

  // Set up recurring timers per table
  for (const [table, interval] of Object.entries(PULL_INTERVALS)) {
    pullTimers[table] = setInterval(() => {
      // Only poll when page is visible AND we're online.
      // Use the connectivity monitor's authoritative state so that a false
      // `navigator.onLine === false` (common in Chromium VMs / iOS Safari
      // standalone) doesn't silently pause sync for hours despite the
      // server being reachable the whole time.
      if (document.visibilityState === 'visible' && isLikelyOnline()) {
        pullTable(table).catch(err => {
          console.error(`[SYNC] Pull ${table} failed:`, err?.message || err);
        });
      }
    }, interval);
  }

  // Pull secrets every 10 minutes
  pullTimers._secrets = setInterval(() => {
    pullSecrets().catch(err => console.error('[SYNC] Secrets pull failed:', err?.message || err));
  }, 600_000);

  // When tab becomes visible, do a quick refresh
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

export function stopSyncSchedule(): void {
  console.log('[SYNC] Stopping pull schedule');
  for (const timer of Object.values(pullTimers)) {
    clearInterval(timer);
  }
  pullTimers = {};
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

export function updateAuthToken(token: string): void {
  authToken = token;
}

export async function pullAll(): Promise<void> {
  if (!acquireSyncLock()) return;

  try {
    const tables = Object.keys(PULL_INTERVALS);
    emit('sync-progress', { phase: 'pull', table: 'all', current: 0, total: tables.length });

    let i = 0;
    for (const table of tables) {
      await pullTable(table);
      i++;
      emit('sync-progress', { phase: 'pull', table, current: i, total: tables.length });
    }

    emit('sync-complete', { pulled: i, pushed: 0, errors: 0 });
    console.log('[SYNC] Pull all complete');
  } finally {
    releaseSyncLock();
  }
}

export async function pushAll(): Promise<void> {
  if (!acquireSyncLock()) return;

  try {
    const queueDepthCount = await getQueueDepth();
    if (queueDepthCount === 0) {
      await pushGpsBreadcrumbs();
      releaseSyncLock();
      return;
    }

    console.log(`[SYNC] Pushing ${queueDepthCount} queued items`);
    emit('sync-progress', { phase: 'push', table: 'sync_queue', current: 0, total: queueDepthCount });

    const pending = await getPendingQueue(100);
    let pushed = 0;
    let errors = 0;

    // Batch push via the server's sync/push endpoint
    const batchSize = 20;
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize);

      try {
        const response = await serverFetch('/api/offline/sync/push', {
          method: 'POST',
          body: JSON.stringify({ items: batch }),
        });

        if (response && response.results) {
          for (const result of response.results) {
            const item = batch.find((b: any) => b.local_id === result.local_id);
            if (!item) continue;

            if (result.success) {
              await markQueueItem(item.id!, 'synced', JSON.stringify(result), null);

              // Update local record with server-assigned ID
              if (result.server_id && item.local_id && item.table_name) {
                try {
                  const db = getOfflineDb();
                  const tableName = item.table_name as StoreName;
                  const tx = db.transaction(tableName, 'readwrite');
                  const store = tx.objectStore(tableName);
                  const idx = (store as any).index('by-local-id');
                  const record = await idx.get(item.local_id);
                  if (record) {
                    await (store as any).put({
                      ...record,
                      server_id: result.server_id,
                      is_dirty: 0,
                    });
                  }
                  await tx.done;
                } catch { /* store might not have these fields */ }
              }

              pushed++;
            } else {
              await markQueueItem(
                item.id!,
                (item.attempts || 0) >= 4 ? 'failed' : 'pending',
                null,
                result.error
              );
              errors++;
            }
          }
        }
      } catch (err: any) {
        console.error('[SYNC] Batch push failed:', err?.message || err);
        for (const item of batch) {
          await markQueueItem(item.id!, 'pending', null, err?.message || 'Sync failed');
        }
        errors += batch.length;
      }

      emit('sync-progress', {
        phase: 'push',
        table: 'sync_queue',
        current: offset + batch.length,
        total: pending.length,
      });
    }

    // Also push GPS breadcrumbs
    await pushGpsBreadcrumbs();

    lastPushAt = new Date().toISOString();
    emit('sync-complete', { pulled: 0, pushed, errors });
    console.log(`[SYNC] Push complete: ${pushed} synced, ${errors} errors`);
  } finally {
    releaseSyncLock();
  }
}

export function getSyncState() {
  return {
    isSyncing,
    lastPushAt,
  };
}

// ─── Internal Helpers ───────────────────────────────────────

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && isLikelyOnline()) {
    // Tab became visible and online — catch up on missed data
    pullAll().catch(err => console.warn('[SYNC] Visibility pull failed:', err?.message || err));
  }
}

async function pullTable(table: string): Promise<void> {
  const meta = await getSyncMeta(table);
  const isReference = REFERENCE_TABLES.includes(table);

  const reqBody = {
    table,
    since: isReference ? null : meta.last_pull_at,
    limit: 1000,
  };

  try {
    const response = await serverFetch('/api/offline/sync/pull', {
      method: 'POST',
      body: JSON.stringify(reqBody),
    });

    if (!response || !response.rows) return;
    if (response.rows.length === 0) return;

    if (response.fullReplace) {
      await replaceTable(table as StoreName, response.rows);
    } else {
      await deltaSync(table as StoreName, response.rows);
    }

    console.log(`[SYNC] Pulled ${response.rows.length} rows for ${table}`);
  } catch (err: any) {
    // Silently fail — will retry on next interval
    console.warn(`[SYNC] Pull ${table} failed:`, err?.message || err);
  }
}

async function pullSecrets(): Promise<void> {
  try {
    const cachedRole = await getConfig('current_user_role');

    let endpoint = '/api/offline/my-secret';
    if (cachedRole === 'admin') {
      endpoint = '/api/offline/secrets';
    }

    const response = await serverFetch(endpoint, { method: 'GET' });
    if (!response) return;

    if (response.admin_secret) {
      await setConfig('admin_offline_secret', response.admin_secret);
    }

    if (cachedRole === 'admin' && response.secrets) {
      await setConfig('all_user_secrets', JSON.stringify(response.secrets));
    } else if (response.secret) {
      await setConfig('my_offline_secret', response.secret);
    }

    console.log('[SYNC] Offline secrets updated');
  } catch (err: any) {
    console.warn('[SYNC] Secrets pull failed:', err?.message || err);
  }
}

async function pushGpsBreadcrumbs(): Promise<void> {
  try {
    const db = getOfflineDb();
    const unsyncedPoints = await db.getAllFromIndex('gps_breadcrumbs', 'by-synced', 0);
    const batch = unsyncedPoints.slice(0, 500);

    if (batch.length === 0) return;

    const response = await serverFetch('/api/offline/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        items: [{
          method: 'POST',
          endpoint: '/api/dispatch/gps',
          body: JSON.stringify({ points: batch }),
          local_id: 'gps_batch',
          table_name: 'gps_breadcrumbs',
        }],
      }),
    });

    if (response && response.pushed > 0) {
      const tx = db.transaction('gps_breadcrumbs', 'readwrite');
      for (const point of batch) {
        if (point.id) {
          const existing = await tx.store.get(point.id);
          if (existing) {
            await tx.store.put({ ...existing, is_synced: 1 });
          }
        }
      }
      await tx.done;
      console.log(`[SYNC] Pushed ${batch.length} GPS breadcrumbs`);
    }
  } catch (err: any) {
    console.warn('[SYNC] GPS push failed:', err?.message || err);
  }
}

/**
 * Make an authenticated fetch request to the server.
 */
async function serverFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = authToken || (await getConfig('auth_token'));
  const url = `${serverUrl}${endpoint}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string> || {}) },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 401) {
      // Token expired — try refreshing
      return refreshAndRetry(endpoint, options);
    }

    // Parse JSON safely — non-2xx responses may not have valid JSON bodies
    let data: any;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      throw new Error('Invalid JSON response');
    }

    if (response.ok) {
      return data;
    } else {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  }
}

/**
 * Attempt to refresh the JWT token and retry the request.
 */
async function refreshAndRetry(endpoint: string, options: RequestInit): Promise<any> {
  const refreshToken = await getConfig('refresh_token');
  if (!refreshToken) throw new Error('No refresh token available');

  const refreshResponse = await fetch(`${serverUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!refreshResponse.ok) {
    throw new Error('Refresh failed');
  }

  const data = await refreshResponse.json();

  // Store new tokens
  authToken = data.token;
  await setConfig('auth_token', data.token);
  await setConfig('refresh_token', data.refreshToken);

  // Retry original request with new token
  return serverFetch(endpoint, options);
}
