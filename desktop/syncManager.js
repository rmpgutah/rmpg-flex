// ============================================================
// RMPG Flex — Background Sync Engine
// Pulls data from the server to keep the local DB fresh, and
// pushes locally-created records back when connectivity returns.
// ============================================================

const { net } = require('electron');
const { getLocalDb, replaceTable, deltaSync, getSyncMeta, getConfig, setConfig,
        getPendingQueue, markQueueItem, getQueueDepth } = require('./localDb');

let serverUrl = '';
let mainWindow = null;
let pullTimers = {};
let isSyncing = false;
let lastPushAt = null;

// ─── Pull Sync Intervals (ms) ───────────────────────────────
const PULL_INTERVALS = {
  users:              300_000,  // 5 min (reference)
  clients:            300_000,  // 5 min (reference)
  properties:         300_000,  // 5 min (reference)
  units:               10_000,  // 10s (most time-sensitive)
  calls_for_service:   30_000,  // 30s
  incidents:          120_000,  // 2 min
  time_entries:       120_000,  // 2 min
  persons:            600_000,  // 10 min
  vehicles_records:   600_000,  // 10 min
};

const REFERENCE_TABLES = ['users', 'clients', 'properties'];

// ─── Public API ──────────────────────────────────────────────

function startPullSchedule(url, window) {
  serverUrl = url;
  mainWindow = window;

  console.log('[SYNC] Starting pull schedule');

  // Do an initial full pull
  pullAll().catch(err => console.error('[SYNC] Initial pull failed:', err.message));

  // Also pull offline secrets for PIN system
  pullSecrets().catch(err => console.error('[SYNC] Secrets pull failed:', err.message));

  // Set up recurring timers per table
  for (const [table, interval] of Object.entries(PULL_INTERVALS)) {
    pullTimers[table] = setInterval(() => {
      pullTable(table).catch(err => {
        console.error(`[SYNC] Pull ${table} failed:`, err.message);
      });
    }, interval);
  }

  // Pull secrets every 10 minutes
  pullTimers._secrets = setInterval(() => {
    pullSecrets().catch(err => console.error('[SYNC] Secrets pull failed:', err.message));
  }, 600_000);
}

function stopPullSchedule() {
  console.log('[SYNC] Stopping pull schedule');
  for (const timer of Object.values(pullTimers)) {
    clearInterval(timer);
  }
  pullTimers = {};
}

async function pullAll() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    emit('offline:sync-progress', { phase: 'pull', table: 'all', current: 0, total: Object.keys(PULL_INTERVALS).length });

    let i = 0;
    for (const table of Object.keys(PULL_INTERVALS)) {
      await pullTable(table);
      i++;
      emit('offline:sync-progress', { phase: 'pull', table, current: i, total: Object.keys(PULL_INTERVALS).length });
    }

    emit('offline:sync-complete', { pulled: i, pushed: 0, errors: 0 });
    console.log('[SYNC] Pull all complete');
  } finally {
    isSyncing = false;
  }
}

async function pushAll() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const queueDepth = getQueueDepth();
    if (queueDepth === 0) {
      // Also push any unsynced GPS breadcrumbs
      await pushGpsBreadcrumbs();
      isSyncing = false;
      return;
    }

    console.log(`[SYNC] Pushing ${queueDepth} queued items`);
    emit('offline:sync-progress', { phase: 'push', table: 'sync_queue', current: 0, total: queueDepth });

    const pending = getPendingQueue(100);
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
            const item = batch.find(b => b.local_id === result.local_id);
            if (!item) continue;

            if (result.success) {
              markQueueItem(item.id, 'synced', JSON.stringify(result), null);

              // Update local record with server-assigned ID if applicable
              if (result.server_id && item.local_id && item.table_name) {
                try {
                  const db = getLocalDb();
                  db.prepare(`UPDATE ${item.table_name} SET server_id = ?, is_dirty = 0 WHERE local_id = ?`)
                    .run(result.server_id, item.local_id);
                } catch { /* table might not have these columns */ }
              }

              pushed++;
            } else {
              markQueueItem(item.id, item.attempts >= 4 ? 'failed' : 'pending', null, result.error);
              errors++;
            }
          }
        }
      } catch (err) {
        console.error('[SYNC] Batch push failed:', err.message);
        for (const item of batch) {
          markQueueItem(item.id, 'pending', null, err.message);
        }
        errors += batch.length;
      }

      emit('offline:sync-progress', { phase: 'push', table: 'sync_queue', current: offset + batch.length, total: pending.length });
    }

    // Also push GPS breadcrumbs
    await pushGpsBreadcrumbs();

    lastPushAt = new Date().toISOString();
    emit('offline:sync-complete', { pulled: 0, pushed, errors });
    console.log(`[SYNC] Push complete: ${pushed} synced, ${errors} errors`);
  } finally {
    isSyncing = false;
  }
}

// ─── Internal Helpers ────────────────────────────────────────

async function pullTable(table) {
  const meta = getSyncMeta(table);
  const isReference = REFERENCE_TABLES.includes(table);

  const body = {
    table,
    since: isReference ? null : meta.last_pull_at,
    limit: 1000,
  };

  try {
    const response = await serverFetch('/api/offline/sync/pull', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response || !response.rows) return;

    if (response.rows.length === 0) return;

    if (response.fullReplace) {
      replaceTable(table, response.rows);
    } else {
      deltaSync(table, response.rows);
    }

    console.log(`[SYNC] Pulled ${response.rows.length} rows for ${table}`);
  } catch (err) {
    // Silently fail — will retry on next interval
    console.warn(`[SYNC] Pull ${table} failed:`, err.message);
  }
}

async function pullSecrets() {
  try {
    const db = getLocalDb();
    const cachedRole = getConfig('current_user_role');

    let endpoint = '/api/offline/my-secret';
    if (cachedRole === 'admin') {
      endpoint = '/api/offline/secrets';
    }

    const response = await serverFetch(endpoint, { method: 'GET' });
    if (!response) return;

    if (response.admin_secret) {
      setConfig('admin_offline_secret', response.admin_secret);
    }

    if (cachedRole === 'admin' && response.secrets) {
      // Admin caches all user secrets
      setConfig('all_user_secrets', JSON.stringify(response.secrets));
    } else if (response.secret) {
      // Employee caches own secret
      setConfig('my_offline_secret', response.secret);
    }

    console.log('[SYNC] Offline secrets updated');
  } catch (err) {
    console.warn('[SYNC] Secrets pull failed:', err.message);
  }
}

async function pushGpsBreadcrumbs() {
  try {
    const db = getLocalDb();
    const unsyncedPoints = db.prepare(
      `SELECT * FROM gps_breadcrumbs WHERE is_synced = 0 ORDER BY recorded_at ASC LIMIT 500`
    ).all();

    if (unsyncedPoints.length === 0) return;

    const response = await serverFetch('/api/offline/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        items: [{
          method: 'POST',
          endpoint: '/api/dispatch/gps',
          body: JSON.stringify({ points: unsyncedPoints }),
          local_id: 'gps_batch',
          table_name: 'gps_breadcrumbs',
        }],
      }),
    });

    if (response && response.pushed > 0) {
      const ids = unsyncedPoints.map(p => p.id);
      // Mark as synced in batches
      const tx = db.transaction(() => {
        for (const id of ids) {
          db.prepare('UPDATE gps_breadcrumbs SET is_synced = 1 WHERE id = ?').run(id);
        }
      });
      tx();
      console.log(`[SYNC] Pushed ${unsyncedPoints.length} GPS breadcrumbs`);
    }
  } catch (err) {
    console.warn('[SYNC] GPS push failed:', err.message);
  }
}

/**
 * Make an authenticated request to the server.
 * Uses the cached JWT token from local_config.
 */
function serverFetch(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const token = getConfig('auth_token');
      const url = `${serverUrl}${endpoint}`;

      const request = net.request({
        url,
        method: options.method || 'GET',
      });

      request.setHeader('Content-Type', 'application/json');
      if (token) {
        request.setHeader('Authorization', `Bearer ${token}`);
      }

      const timer = setTimeout(() => {
        try { request.abort(); } catch { /* ignore */ }
        reject(new Error('Request timeout'));
      }, 15_000);

      let responseBody = '';

      request.on('response', (response) => {
        response.on('data', (chunk) => {
          responseBody += chunk.toString();
        });

        response.on('end', () => {
          clearTimeout(timer);
          try {
            if (response.statusCode === 401) {
              // Token expired — try refreshing
              refreshAndRetry(endpoint, options).then(resolve).catch(reject);
              return;
            }
            const data = JSON.parse(responseBody);
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error || `HTTP ${response.statusCode}`));
            }
          } catch (parseErr) {
            reject(new Error(`Failed to parse response: ${parseErr.message}`));
          }
        });
      });

      request.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      if (options.body) {
        request.write(options.body);
      }

      request.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Attempt to refresh the JWT token and retry the request.
 */
async function refreshAndRetry(endpoint, options) {
  const refreshToken = getConfig('refresh_token');
  if (!refreshToken) throw new Error('No refresh token available');

  const refreshResponse = await new Promise((resolve, reject) => {
    const request = net.request({
      url: `${serverUrl}/api/auth/refresh`,
      method: 'POST',
    });
    request.setHeader('Content-Type', 'application/json');

    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (response.statusCode === 200) {
            resolve(data);
          } else {
            reject(new Error('Refresh failed'));
          }
        } catch { reject(new Error('Refresh parse error')); }
      });
    });
    request.on('error', reject);
    request.write(JSON.stringify({ refreshToken }));
    request.end();
  });

  // Store new tokens
  setConfig('auth_token', refreshResponse.token);
  setConfig('refresh_token', refreshResponse.refreshToken);

  // Retry original request
  return serverFetch(endpoint, options);
}

function emit(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch { /* ignore */ }
}

module.exports = {
  startPullSchedule,
  stopPullSchedule,
  pullAll,
  pushAll,
  get isSyncing() { return isSyncing; },
  get lastPushAt() { return lastPushAt; },
};
