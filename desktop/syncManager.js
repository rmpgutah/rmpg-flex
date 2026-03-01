// ============================================================
// RMPG Flex — Background Sync Engine
// Pull: server → local (while online, keeps local DB fresh)
// Push: local → server (on reconnect, drains sync_queue)
// ============================================================

const https = require('https');
const { BrowserWindow } = require('electron');

const REMOTE_HOST = 'rmpgutah.us';
const PULL_INTERVAL_REF = 5 * 60 * 1000; // Reference data: 5 min
const PULL_INTERVAL_OPS = 60 * 1000;     // Operational data: 60s
const PUSH_MAX_RETRIES = 5;

let localDbModule = null;
let authToken = null;
let pullRefHandle = null;
let pullOpsHandle = null;
let isPushing = false;

function init(dbModule) {
  localDbModule = dbModule;
  console.log('[Sync] Manager initialized');
}

function setToken(token) {
  authToken = token;
}

function startPullSync() {
  if (pullRefHandle) return;
  console.log('[Sync] Starting pull sync');

  // Reference data (users, clients, properties): every 5 min
  pullRefHandle = setInterval(() => pullReferenceData(), PULL_INTERVAL_REF);
  // Operational data (calls, units): every 60s
  pullOpsHandle = setInterval(() => pullOperationalData(), PULL_INTERVAL_OPS);

  // Initial pull after 3s
  setTimeout(() => {
    pullReferenceData();
    setTimeout(() => pullOperationalData(), 2000);
  }, 3000);
}

function stopPullSync() {
  if (pullRefHandle) { clearInterval(pullRefHandle); pullRefHandle = null; }
  if (pullOpsHandle) { clearInterval(pullOpsHandle); pullOpsHandle = null; }
}

// ── Pull: Reference Data ─────────────────────────────────────

async function pullReferenceData() {
  if (!authToken || !localDbModule) return;

  try {
    const db = localDbModule.getDb();

    // Pull users (includes password_hash for offline auth)
    const users = await serverRequest('POST', '/api/offline/sync/pull', { table: 'users' });
    if (users.status === 200 && users.data && users.data.rows) {
      localDbModule.upsertRowsSimple('users', users.data.rows);
      updateSyncMeta(db, 'users', users.data.rows.length);
    }

    // Pull clients
    const clients = await serverRequest('POST', '/api/offline/sync/pull', { table: 'clients' });
    if (clients.status === 200 && clients.data && clients.data.rows) {
      localDbModule.upsertRowsSimple('clients', clients.data.rows);
      updateSyncMeta(db, 'clients', clients.data.rows.length);
    }

    // Pull properties
    const properties = await serverRequest('POST', '/api/offline/sync/pull', { table: 'properties' });
    if (properties.status === 200 && properties.data && properties.data.rows) {
      localDbModule.upsertRowsSimple('properties', properties.data.rows);
      updateSyncMeta(db, 'properties', properties.data.rows.length);
    }

    // Pull persons
    const persons = await serverRequest('POST', '/api/offline/sync/pull', { table: 'persons' });
    if (persons.status === 200 && persons.data && persons.data.rows) {
      localDbModule.upsertRowsSimple('persons', persons.data.rows);
      updateSyncMeta(db, 'persons', persons.data.rows.length);
    }

    // Pull vehicles
    const vehicles = await serverRequest('POST', '/api/offline/sync/pull', { table: 'vehicles_records' });
    if (vehicles.status === 200 && vehicles.data && vehicles.data.rows) {
      localDbModule.upsertRowsSimple('vehicles_records', vehicles.data.rows);
      updateSyncMeta(db, 'vehicles_records', vehicles.data.rows.length);
    }

    // Pull offline secrets (admin only — stored in local_config)
    try {
      const secrets = await serverRequest('GET', '/api/offline/secrets', null);
      if (secrets.status === 200 && secrets.data) {
        if (secrets.data.admin_secret) {
          db.prepare("INSERT OR REPLACE INTO local_config (key, value) VALUES ('admin_secret', ?)").run(secrets.data.admin_secret);
        }
        if (secrets.data.secrets) {
          for (const us of secrets.data.secrets) {
            db.prepare('UPDATE users SET offline_secret = ? WHERE id = ?').run(us.secret, us.user_id);
          }
        }
      }
    } catch { /* non-admin users won't get admin_secret — expected */ }

  } catch (err) {
    console.error('[Sync] Pull reference error:', err.message);
  }
}

// ── Pull: Operational Data ───────────────────────────────────

async function pullOperationalData() {
  if (!authToken || !localDbModule) return;

  try {
    const db = localDbModule.getDb();

    // Pull recent calls
    const lastPullCalls = getSyncMeta(db, 'calls_for_service');
    const calls = await serverRequest('POST', '/api/offline/sync/pull', {
      table: 'calls_for_service',
      since: lastPullCalls || '2020-01-01 00:00:00',
    });
    if (calls.status === 200 && calls.data && calls.data.rows) {
      localDbModule.upsertRows('calls_for_service', calls.data.rows.map(r => ({ ...r, server_id: r.id })));
      updateSyncMeta(db, 'calls_for_service', calls.data.rows.length);
    }

    // Pull units
    const units = await serverRequest('POST', '/api/offline/sync/pull', { table: 'units' });
    if (units.status === 200 && units.data && units.data.rows) {
      localDbModule.upsertRows('units', units.data.rows);
      updateSyncMeta(db, 'units', units.data.rows.length);
    }

    // Pull recent incidents
    const lastPullInc = getSyncMeta(db, 'incidents');
    const incidents = await serverRequest('POST', '/api/offline/sync/pull', {
      table: 'incidents',
      since: lastPullInc || '2020-01-01 00:00:00',
    });
    if (incidents.status === 200 && incidents.data && incidents.data.rows) {
      localDbModule.upsertRows('incidents', incidents.data.rows.map(r => ({ ...r, server_id: r.id })));
      updateSyncMeta(db, 'incidents', incidents.data.rows.length);
    }

    // Pull time entries
    const lastPullTE = getSyncMeta(db, 'time_entries');
    const timeEntries = await serverRequest('POST', '/api/offline/sync/pull', {
      table: 'time_entries',
      since: lastPullTE || '2020-01-01 00:00:00',
    });
    if (timeEntries.status === 200 && timeEntries.data && timeEntries.data.rows) {
      localDbModule.upsertRows('time_entries', timeEntries.data.rows.map(r => ({ ...r, server_id: r.id })));
      updateSyncMeta(db, 'time_entries', timeEntries.data.rows.length);
    }

    notifyRenderer('sync_pull_complete');
  } catch (err) {
    console.error('[Sync] Pull operational error:', err.message);
  }
}

// ── Push: Local → Server ─────────────────────────────────────

async function pushSync() {
  if (isPushing || !authToken || !localDbModule) return;
  isPushing = true;

  try {
    const db = localDbModule.getDb();

    // Drain sync_queue in order
    const pending = db.prepare("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50").all();
    if (pending.length === 0) { isPushing = false; return; }

    console.log('[Sync] Pushing', pending.length, 'queued item(s)');
    let pushed = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const body = item.body ? JSON.parse(item.body) : null;
        const result = await serverRequest(item.method, item.endpoint, body);

        if (result.status >= 200 && result.status < 300) {
          // Success — mark complete
          db.prepare("UPDATE sync_queue SET status = 'completed', completed_at = datetime('now','localtime') WHERE id = ?").run(item.id);

          // If this was a POST that created a record, update local ID mapping
          if (item.local_id && result.data && result.data.id) {
            const tableName = item.table_name;
            if (tableName) {
              db.prepare('UPDATE ' + tableName + ' SET server_id = ?, is_dirty = 0 WHERE local_id = ?').run(result.data.id, item.local_id);
            }
          }
          pushed++;
        } else {
          // Server error — retry later
          const retries = item.retry_count + 1;
          if (retries >= PUSH_MAX_RETRIES) {
            db.prepare("UPDATE sync_queue SET status = 'failed', error = ?, retry_count = ? WHERE id = ?")
              .run(JSON.stringify(result.data), retries, item.id);
          } else {
            db.prepare('UPDATE sync_queue SET retry_count = ?, error = ? WHERE id = ?')
              .run(retries, JSON.stringify(result.data), item.id);
          }
          failed++;
        }
      } catch (err) {
        failed++;
        db.prepare('UPDATE sync_queue SET retry_count = retry_count + 1, error = ? WHERE id = ?').run(err.message, item.id);
      }
    }

    // Push unsynced GPS breadcrumbs
    const unsyncedGps = db.prepare('SELECT * FROM gps_breadcrumbs WHERE is_synced = 0 LIMIT 500').all();
    if (unsyncedGps.length > 0) {
      try {
        const result = await serverRequest('POST', '/api/offline/sync/push-gps', { points: unsyncedGps });
        if (result.status >= 200 && result.status < 300) {
          const ids = unsyncedGps.map(g => g.id);
          db.prepare('UPDATE gps_breadcrumbs SET is_synced = 1 WHERE id IN (' + ids.join(',') + ')').run();
          console.log('[Sync] Pushed', unsyncedGps.length, 'GPS points');
        }
      } catch (err) {
        console.error('[Sync] GPS push error:', err.message);
      }
    }

    console.log('[Sync] Push complete:', pushed, 'pushed,', failed, 'failed');
    notifyRenderer('sync_push_complete', { pushed, failed });
  } catch (err) {
    console.error('[Sync] Push error:', err.message);
  } finally {
    isPushing = false;
  }
}

// Immediate push (called on reconnect)
function triggerPush() {
  pushSync();
}

// ── HTTP helpers ─────────────────────────────────────────────

function serverRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: REMOTE_HOST,
      port: 443,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      rejectUnauthorized: false,
      timeout: 15000,
    };
    if (authToken) options.headers['Authorization'] = 'Bearer ' + authToken;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────

function updateSyncMeta(db, tableName, rowCount) {
  db.prepare(`
    INSERT INTO sync_metadata (table_name, last_pull, row_count)
    VALUES (?, datetime('now','localtime'), ?)
    ON CONFLICT(table_name) DO UPDATE SET last_pull = datetime('now','localtime'), row_count = ?
  `).run(tableName, rowCount, rowCount);
}

function getSyncMeta(db, tableName) {
  const row = db.prepare('SELECT last_pull FROM sync_metadata WHERE table_name = ?').get(tableName);
  return row ? row.last_pull : null;
}

function getSyncStatus() {
  if (!localDbModule) return { error: 'Not initialized' };
  try {
    const db = localDbModule.getDb();
    const meta = db.prepare('SELECT * FROM sync_metadata').all();
    const queuePending = db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'").get().count;
    const queueFailed = db.prepare("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'").get().count;
    const gpsUnsynced = db.prepare('SELECT COUNT(*) as count FROM gps_breadcrumbs WHERE is_synced = 0').get().count;
    return { tables: meta, queue: { pending: queuePending, failed: queueFailed }, gps_unsynced: gpsUnsynced };
  } catch (err) {
    return { error: err.message };
  }
}

function notifyRenderer(event, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('offline:sync-progress', { event, ...data });
    }
  }
}

module.exports = {
  init, setToken,
  startPullSync, stopPullSync,
  pushSync, triggerPush,
  getSyncStatus,
};
