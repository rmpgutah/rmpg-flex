// ============================================================
// RMPG Flex — IPED (Cloudflare Worker)
// ============================================================
// Read-only surface over the forensic_hash_sets + forensic_hash_entries
// + iped_imports tables. Replaces the proxy stubs that PR #667 used
// to short-circuit /api/iped/{status,hash-sets} while there was no
// rewrite handler.
//
// "IPED" = Indexador e Processador de Evidências Digitais — the open
// source forensic analyzer the lab uses for disk/phone images. Hash
// sets feed IPED's known-file lookup (NSRL for benign system files,
// ProjectVic for CSAM hashes, custom for case-specific known-bad).
// `iped_imports` records each time the legacy worker pulled in results
// from an IPED case (findings, timeline, bookmarks, items).
//
// Out of scope:
//   - Initiating new IPED runs (the analyzer is offline-only)
//   - Streaming hash material to clients (large; detail endpoint
//     caps at 100 entries)
//   - The actual IPED API integration; we only report whether
//     IPED_API_KEY is bound, not whether the service is reachable.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb, query, queryFirst, execute } from '../utils/db';

// IPED_API_KEY is optional and only consulted by /status to report
// "configured". Declared here (not in src/types.ts) because no other
// route in the rewrite touches it — keeps the shared Bindings type lean.
type IpedEnv = {
  Bindings: Env['Bindings'] & { IPED_API_KEY?: string };
  Variables: Env['Variables'];
};

const iped = new Hono<IpedEnv>();

// ── IPED deployment config (system_config-backed) ───────────
// The analyzer is offline-only, so the Worker can't reach the lab
// machine to verify binaries. It stores the deployment profile
// (paths, default profile, toggles) as one JSON row and reports it
// back via /status; /validate is honest that it only confirms config
// is RECORDED, not that the binaries exist on the lab box.
const IPED_CONFIG_KEY = 'iped_config';
const DEFAULT_IPED_CONFIG = {
  installPath: null as string | null,
  javaHome: null as string | null,
  webApiUrl: null as string | null,
  webApiPort: null as string | null,
  defaultProfile: 'forensic',
  photodnaEnabled: false,
  autoHashOnUpload: false,
  hashSetsPath: null as string | null,
};
type IpedConfig = typeof DEFAULT_IPED_CONFIG;

async function loadIpedConfig(db: D1Database): Promise<IpedConfig> {
  const row = await queryFirst<{ config_value: string }>(
    db, `SELECT config_value FROM system_config WHERE config_key = ? ORDER BY id DESC LIMIT 1`, IPED_CONFIG_KEY,
  );
  if (!row) return { ...DEFAULT_IPED_CONFIG };
  try { return { ...DEFAULT_IPED_CONFIG, ...JSON.parse(row.config_value) }; }
  catch { return { ...DEFAULT_IPED_CONFIG }; }
}

async function saveIpedConfig(db: D1Database, cfg: IpedConfig): Promise<void> {
  const value = JSON.stringify(cfg);
  const r = await execute(
    db, `UPDATE system_config SET config_value = ?, updated_at = datetime('now','localtime') WHERE config_key = ?`,
    value, IPED_CONFIG_KEY,
  );
  if (!r.meta.changes) {
    await execute(db, `INSERT INTO system_config (config_key, config_value, category) VALUES (?, ?, 'forensics')`, IPED_CONFIG_KEY, value);
  }
}

// GET /status — dashboard polls on mount. Returns the recorded config
// merged with live usage counts over the forensic_* + iped_imports
// tables. `configured` is true when a deployment has been recorded OR
// the IPED_API_KEY binding is present.
iped.get('/status', async (c) => {
  try {
    const db = getDb(c.env);
    const cfg = await loadIpedConfig(db);
    const jobs = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) AS total FROM iped_imports`);
    const hashAgg = await queryFirst<{ sets: number; hashes: number }>(
      db, `SELECT COUNT(*) AS sets, COALESCE(SUM(hash_count), 0) AS hashes FROM forensic_hash_sets`,
    );
    const flagged = await queryFirst<{ c: number }>(
      db, `SELECT COUNT(*) AS c FROM forensic_hash_results WHERE is_match = 1`,
    ).catch(() => ({ c: 0 }));
    const totalJobs = jobs?.total ?? 0;
    const configured = !!c.env.IPED_API_KEY || !!cfg.installPath || !!cfg.webApiUrl;
    return c.json({
      configured,
      installed: !!cfg.installPath,
      installPath: cfg.installPath,
      javaHome: cfg.javaHome,
      webApiUrl: cfg.webApiUrl,
      webApiPort: cfg.webApiPort,
      defaultProfile: cfg.defaultProfile,
      photodnaEnabled: cfg.photodnaEnabled,
      autoHashOnUpload: cfg.autoHashOnUpload,
      hashSetsPath: cfg.hashSetsPath,
      totalJobs,
      completedJobs: totalJobs,
      runningJobs: 0,
      failedJobs: 0,
      totalHashes: hashAgg?.hashes ?? 0,
      flaggedHashes: flagged?.c ?? 0,
      hashSetCount: hashAgg?.sets ?? 0,
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get IPED status',
      code: 'STATUS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// PUT /config — merge a partial config patch (toggles send one field).
iped.put('/config', async (c) => {
  try {
    const db = getDb(c.env);
    const patch = await c.req.json<Partial<IpedConfig>>();
    const current = await loadIpedConfig(db);
    const next: IpedConfig = { ...current };
    for (const k of Object.keys(DEFAULT_IPED_CONFIG) as (keyof IpedConfig)[]) {
      if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined) {
        (next as Record<string, unknown>)[k] = patch[k];
      }
    }
    await saveIpedConfig(db, next);
    return c.json({ success: true, config: next });
  } catch (err) {
    return c.json({ error: 'Failed to save IPED config', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// DELETE /config — clear the recorded deployment back to defaults.
iped.delete('/config', async (c) => {
  try {
    const db = getDb(c.env);
    await execute(db, `DELETE FROM system_config WHERE config_key = ?`, IPED_CONFIG_KEY);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to clear IPED config', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /validate — honest validation. The edge can't see the lab
// machine's filesystem, so this confirms the deployment profile is
// RECORDED (paths present) rather than that binaries exist on disk.
iped.post('/validate', async (c) => {
  try {
    const db = getDb(c.env);
    const cfg = await loadIpedConfig(db);
    const ipedFound = !!cfg.installPath;
    const javaFound = !!cfg.javaHome;
    const errors: string[] = [];
    if (!ipedFound) errors.push('IPED install path not configured');
    if (!javaFound) errors.push('JAVA_HOME not configured');
    errors.push('Note: the server records configuration but cannot verify binaries on the offline analyzer host.');
    return c.json({
      valid: ipedFound && javaFound,
      ipedFound, javaFound,
      ipedVersion: null, javaVersion: null,
      platform: 'recorded-config',
      errors,
    });
  } catch (err) {
    return c.json({
      valid: false, ipedFound: false, javaFound: false,
      ipedVersion: null, javaVersion: null, platform: 'unknown',
      errors: [err instanceof Error ? err.message : 'Validation failed'],
    });
  }
});

// POST /test-api — attempt to reach the configured IPED Web API. From
// the Cloudflare edge a LAN URL is unreachable; report that honestly.
iped.post('/test-api', async (c) => {
  const db = getDb(c.env);
  const cfg = await loadIpedConfig(db);
  if (!cfg.webApiUrl) {
    return c.json({ success: false, message: 'No IPED Web API URL configured.' });
  }
  const base = cfg.webApiUrl.replace(/\/+$/, '') + (cfg.webApiPort ? `:${cfg.webApiPort}` : '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(base, { signal: ctrl.signal });
    clearTimeout(t);
    return c.json({ success: res.ok, message: res.ok ? `Reachable (HTTP ${res.status})` : `Responded HTTP ${res.status}` });
  } catch (err) {
    return c.json({
      success: false,
      message: `Unreachable from server: ${err instanceof Error ? err.message : String(err)}. A LAN-only analyzer URL can't be tested from the cloud.`,
    });
  }
});

// DELETE /hash-sets/:name — remove a loaded hash set by name.
iped.delete('/hash-sets/:name', async (c) => {
  try {
    const db = getDb(c.env);
    const name = decodeURIComponent(c.req.param('name'));
    await execute(db, `DELETE FROM forensic_hash_sets WHERE name = ?`, name);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to remove hash set', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /hash-sets — list of loaded hash sets. Cap at 100 (NSRL +
// ProjectVic + lab-custom is on the order of a dozen entries; a 100
// cap is purely a defensive upper bound). IpedPage reads `data.sets`
// and renders `hs.category`/`hs.count`, so wrap in { sets } and alias
// set_type->category, hash_count->count.
iped.get('/hash-sets', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT hs.id, hs.name, hs.set_type, hs.description, hs.hash_count,
              hs.source_file, hs.version, hs.imported_by_name,
              hs.created_at, hs.updated_at
         FROM forensic_hash_sets hs
         ORDER BY hs.updated_at DESC, hs.id DESC
         LIMIT 100`,
    );
    return c.json({
      sets: rows.map((r) => ({ ...r, category: r.set_type, count: r.hash_count })),
    });
  } catch (err) {
    return c.json({
      error: 'Failed to list hash sets',
      code: 'HASH_SETS_LIST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /hash-sets/:id — detail + first 100 hash entries.
// Hash material is intentionally only on the detail endpoint; never
// on the list. Even at 100 rows the SHA-256 column alone can be 6 KB.
iped.get('/hash-sets/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

    const set = await queryFirst<Record<string, unknown>>(
      db, `SELECT * FROM forensic_hash_sets WHERE id = ?`, id,
    );
    if (!set) return c.json({ error: 'Hash set not found', code: 'NOT_FOUND' }, 404);

    const entries = await query<Record<string, unknown>>(
      db,
      `SELECT id, hash_value, hash_type, file_name, file_size, category
         FROM forensic_hash_entries
        WHERE hash_set_id = ?
        ORDER BY id
        LIMIT 100`,
      id,
    );
    return c.json({
      data: { ...set, entries, entries_truncated: (set.hash_count as number) > entries.length },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get hash set',
      code: 'HASH_SET_GET_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /downloads — IPED import history. Name retained for client
// compatibility (the legacy endpoint is `/api/iped/downloads`); the
// underlying table is `iped_imports` since each row represents data
// pulled from IPED into D1, not a binary download.
iped.get('/downloads', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const limit = Math.min(200, Math.max(1, parseInt(q('limit') || '50', 10) || 50));

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ii.id, ii.forensic_case_id, ii.import_type, ii.iped_case_id,
              ii.iped_case_name, ii.source_query, ii.item_count, ii.summary,
              ii.imported_by, ii.imported_by_name, ii.created_at,
              fc.lab_number
         FROM iped_imports ii
         LEFT JOIN forensic_cases fc ON ii.forensic_case_id = fc.id
         ORDER BY ii.created_at DESC, ii.id DESC
         LIMIT ?`,
      limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({
      error: 'Failed to list IPED imports',
      code: 'DOWNLOADS_LIST_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// GET /jobs?page=&limit=&filter= — IPED processing jobs. IpedPage reads
// `data.jobs` + `data.total`. Each iped_imports row is a processing job
// (case_link / findings / timeline / report / bookmarks / items). Legacy
// had no /jobs handler → 404 (live sweep 2026-06-02).
iped.get('/jobs', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const page = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q('limit') || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const conds: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q('filter')) { conds.push('(ii.import_type = ? OR ii.iped_case_name LIKE ?)'); params.push(q('filter'), `%${q('filter')}%`); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const total = (await queryFirst<{ c: number }>(db, `SELECT COUNT(*) AS c FROM iped_imports ii ${where}`, ...params))?.c ?? 0;
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ii.id, ii.forensic_case_id, ii.import_type, ii.iped_case_id,
              ii.iped_case_name, ii.source_query, ii.item_count, ii.summary,
              ii.imported_by, ii.imported_by_name, ii.created_at,
              fc.lab_number
         FROM iped_imports ii
         LEFT JOIN forensic_cases fc ON ii.forensic_case_id = fc.id
         ${where}
         ORDER BY ii.created_at DESC, ii.id DESC
         LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );
    return c.json({ jobs: rows, total, page, limit });
  } catch (err) {
    return c.json({ jobs: [], total: 0, page: 1, limit: 20, detail: err instanceof Error ? err.message : String(err) });
  }
});

export default iped;
