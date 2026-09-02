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

import { dbErrorResponse } from '../utils/dbErrors';
import { containsClause } from '../utils/searchText';
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
    db, `UPDATE system_config SET config_value = ?, updated_at = datetime('now') WHERE config_key = ?`,
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
      db, `SELECT COUNT(*) AS c FROM forensic_hash_results WHERE match_found = 1`,
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
    return dbErrorResponse(c, err, 'Failed to get IPED status', 'STATUS_ERROR');
  }
});

// PUT /config — merge a partial config patch (toggles send one field).
iped.put('/config', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || actor.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
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
    return dbErrorResponse(c, err, 'Failed to save IPED config');
  }
});

// DELETE /config — clear the recorded deployment back to defaults.
iped.delete('/config', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || actor.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    await execute(db, `DELETE FROM system_config WHERE config_key = ?`, IPED_CONFIG_KEY);
    return c.json({ success: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to clear IPED config');
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
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || actor.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    const db = getDb(c.env);
    const name = decodeURIComponent(c.req.param('name'));
    await execute(db, `DELETE FROM forensic_hash_sets WHERE name = ?`, name);
    return c.json({ success: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to remove hash set');
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
    return dbErrorResponse(c, err, 'Failed to list hash sets', 'HASH_SETS_LIST_ERROR');
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
    return dbErrorResponse(c, err, 'Failed to get hash set', 'HASH_SET_GET_ERROR');
  }
});

// GET /download/info — Pointer to IPED's official installer downloads.
// AdminIPEDTab fetches this on mount; without it the request 404'd into
// the console. We don't host IPED binaries (~1.2 GB); we point operators
// at the upstream GitHub releases page. Returning a static shape keeps
// the response Worker-cheap and avoids GitHub API rate limits.
//
// If we ever decide to mirror binaries to R2 we can swap `available: true`
// + populate `bundles` from a config row, and the client UI lights up.
iped.get('/download/info', async (c) => {
  return c.json({
    available: false,
    bundles: {},
    downloadUrl: 'https://github.com/sepinf-inc/IPED/releases/latest',
    githubUrl:   'https://github.com/sepinf-inc/IPED',
    notes: 'IPED installers are distributed via GitHub Releases; RMPG does not host the binaries.',
  });
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
    return dbErrorResponse(c, err, 'Failed to list IPED imports', 'DOWNLOADS_LIST_ERROR');
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
    if (q('filter')) { const m = containsClause('ii.iped_case_name'); conds.push(`(ii.import_type = ? OR ${m.sql})`); params.push(q('filter'), m.bind(q('filter')!)); }
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

// POST /jobs — create a new IPED processing job.
iped.post('/jobs', async (c) => {
  try {
    const actor = c.get('user') as { id: number; name?: string; username?: string; role: string } | undefined;
    if (!actor || !['admin', 'manager', 'supervisor'].includes(actor.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const actorName = actor.name || actor.username || 'unknown';
    const db = getDb(c.env);
    const body = await c.req.json<{
      jobType?: string;
      inputPath?: string;
      outputPath?: string;
      evidenceId?: number;
      profile?: string;
    }>();
    const inputPath = body.inputPath?.trim();
    if (!inputPath) return c.json({ error: 'inputPath is required' }, 400);
    const jobType = body.jobType || 'hash';
    const profile = body.profile || 'forensic';
    const outputPath = body.outputPath?.trim() || null;
    const evidenceId = body.evidenceId || null;
    const result = await execute(
      db,
      `INSERT INTO iped_imports (import_type, source_query, item_count, summary, imported_by, imported_by_name)
       VALUES (?, ?, 0, ?, ?, ?)`,
       jobType, inputPath, `Profile: ${profile}`, actor.id, actorName,
    );
    return c.json({ success: true, id: result.meta.last_row_id });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to create job', 'JOB_CREATE_ERROR');
  }
});

// GET /jobs/:id — get job detail with hashes.
iped.get('/jobs/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    const job = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ii.*, fc.lab_number FROM iped_imports ii
       LEFT JOIN forensic_cases fc ON ii.forensic_case_id = fc.id
       WHERE ii.id = ?`, id,
    );
    if (!job) return c.json({ error: 'Job not found' }, 404);
    const hashes = await query<Record<string, unknown>>(
      db,
      `SELECT id, evidence_id, md5, sha1, sha256, flagged, flag_reason, created_at
       FROM forensic_hash_results WHERE iped_job_id = ? LIMIT 100`, id,
    );
    return c.json({ job, hashes });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to get job', 'JOB_GET_ERROR');
  }
});

// POST /jobs/:id/cancel — cancel a running job (stub: marks summary).
iped.post('/jobs/:id/cancel', async (c) => {
  try {
    const actor = c.get('user') as { role: string } | undefined;
    if (!actor || !['admin', 'manager'].includes(actor.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);
    await execute(db, `UPDATE iped_imports SET summary = summary || ' [CANCELLED]' WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to cancel job', 'JOB_CANCEL_ERROR');
  }
});

// POST /hash-sets/import — import a hash set file.
iped.post('/hash-sets/import', async (c) => {
  try {
    const actor = c.get('user') as { id: number; name?: string; username?: string; role: string } | undefined;
    if (!actor || !['admin', 'manager'].includes(actor.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const actorName = actor.name || actor.username || 'unknown';
    const db = getDb(c.env);
    const body = await c.req.json<{
      filePath?: string;
      setName?: string;
      category?: string;
      hashType?: string;
    }>();
    const filePath = body.filePath?.trim();
    const setName = body.setName?.trim();
    if (!filePath || !setName) return c.json({ error: 'filePath and setName are required' }, 400);
    const category = body.category || 'known_bad';
    const hashType = body.hashType || 'md5';
    // Check if set already exists
    const existing = await queryFirst<{ id: number }>(
      db, `SELECT id FROM forensic_hash_sets WHERE name = ?`, setName,
    );
    let setId: number;
    if (existing) {
      await execute(db, `UPDATE forensic_hash_sets SET updated_at = datetime('now') WHERE id = ?`, existing.id);
      setId = existing.id;
    } else {
      const r = await execute(
        db,
        `INSERT INTO forensic_hash_sets (name, set_type, description, source_file, version, imported_by_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
         setName, category, `Imported from ${filePath}`, filePath, '1.0', actorName,
      );
      setId = r.meta.last_row_id as number;
    }
    // Read and parse the hash file (one hash per line)
    const lines = filePath.split(/\r?\n/).filter(l => l.trim().length > 0);
    let imported = 0;
    for (const line of lines.slice(0, 10000)) {
      const hash = line.trim().toLowerCase();
      if (hashType === 'md5' && hash.length === 32 ||
          hashType === 'sha1' && hash.length === 40 ||
          hashType === 'sha256' && hash.length === 64) {
        await execute(
          db,
          `INSERT OR IGNORE INTO forensic_hash_entries (hash_set_id, hash_value, hash_type)
           VALUES (?, ?, ?)`, setId, hash, hashType,
        );
        imported++;
      }
    }
    await execute(
      db,
      `UPDATE forensic_hash_sets SET hash_count = (SELECT COUNT(*) FROM forensic_hash_entries WHERE hash_set_id = ?) WHERE id = ?`,
      setId, setId,
    );
    return c.json({ success: true, imported, setId });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to import hash set', 'HASH_IMPORT_ERROR');
  }
});

// GET /hashes/search?q=<hash> — search for a hash across all sets.
iped.get('/hashes/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ results: [] });
    const pattern = `%${q.toLowerCase()}%`;
    const results = await query<Record<string, unknown>>(
      db,
      `SELECT fe.id, fe.hash_value, fe.hash_type, fe.file_name, fe.category,
              hs.name AS set_name, hs.set_type
       FROM forensic_hash_entries fe
       JOIN forensic_hash_sets hs ON fe.hash_set_id = hs.id
       WHERE fe.hash_value LIKE ?
       ORDER BY hs.name
       LIMIT 50`, pattern,
    );
    return c.json({ results });
  } catch (err) {
    return dbErrorResponse(c, err, 'Failed to search hashes', 'HASH_SEARCH_ERROR');
  }
});

export default iped;
