import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';
import { getAdapters, getAdapter } from '../utils/screening/registry';
import { runScreeningScans } from '../utils/screening/runScreeningScans';
import { confirmScreeningHit, dismissScreeningHit } from '../utils/screening/confirm';
import { screenPersonAllSources } from '../utils/screening/screenPerson';

const screening = new Hono<Env>();

const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const SCAN_ROLES = ['admin', 'manager', 'supervisor'] as const;

// GET /api/screening/sources — registry + per-source state
screening.get('/sources', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const state = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_source_state');
    const byKey = new Map(state.map((s) => [s.source_key, s]));
    const sources = getAdapters().map((a) => ({
      sourceKey: a.sourceKey, label: a.label, kind: a.kind,
      supportsSearch: a.supportsSearch, supportsWatch: a.supportsWatch,
      state: byKey.get(a.sourceKey) ?? null,
    }));
    return c.json({ data: sources });
  } catch (err) {
    log.error('[screening] GET /sources failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ data: [] });
  }
});

// GET /api/screening/search?source=&name=&forename=&nationality=&ageMin=&ageMax=&sexId=&page=
// `source=all` fans out across every searchable registry (manual entry).
screening.get('/search', requireRole(...READ_ROLES), async (c) => {
  const sourceKey = c.req.query('source') ?? '';
  const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const params = {
    name: c.req.query('name'), forename: c.req.query('forename'),
    nationality: c.req.query('nationality'), sexId: c.req.query('sexId'),
    ageMin: num(c.req.query('ageMin')), ageMax: num(c.req.query('ageMax')),
    page: num(c.req.query('page')),
  };

  // All-sources fan-out. Each adapter is isolated: one failing/empty registry
  // never sinks the others. Per-source coverage warnings are preserved so an
  // empty registry in the set can never read as a clearance (false-clear guard).
  if (sourceKey === 'all') {
    const adapters = getAdapters().filter((a) => a.supportsSearch);
    const settled = await Promise.all(adapters.map(async (a) => {
      const results = await a.searchAdHoc(c.env, params).catch((err) => {
        log.error(`[screening/search:all] ${a.sourceKey}`, {}, err instanceof Error ? err : new Error(String(err))); return [];
      });
      const cov = a.coverage ? await a.coverage(c.env).catch(() => undefined) : undefined;
      return { a, results, cov };
    }));
    const data = settled.flatMap((s) => s.results);
    const coverages = settled
      .filter((s) => s.cov && !s.cov.available)
      .map((s) => ({ sourceKey: s.a.sourceKey, label: s.a.label, ...s.cov! }));
    return c.json({ data, coverages });
  }

  const adapter = getAdapter(sourceKey);
  if (!adapter || !adapter.supportsSearch) return c.json({ data: [], error: 'unknown or non-searchable source' }, 400);
  try {
    const results = await adapter.searchAdHoc(c.env, params);
    // Coverage tells the client WHY a result set is empty so a blank
    // registry can never read as a clearance (false-clear guard).
    const coverage = adapter.coverage
      ? await adapter.coverage(c.env).catch(() => undefined)
      : undefined;
    return c.json({ data: results, coverage });
  } catch (err) { log.error('[screening/search]', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ data: [], error: 'search failed' }, 500); }
});

// GET /api/screening/notice/:type?id=  (+ /images) — INTERPOL detail proxy.
// entity_id contains a literal '/' (e.g. "2021/12345"), so it's passed as a
// query param, not a path segment. Sanitize to digits/slash to prevent path injection.
// /images is registered FIRST so Hono doesn't swallow it with the bare /:type route.
screening.get('/notice/:type/images', requireRole(...READ_ROLES), async (c) => {
  const type = c.req.param('type') ?? '';
  if (!['red', 'yellow', 'un'].includes(type)) return c.json({ error: 'bad type' }, 400);
  const safeId = (c.req.query('id') ?? '').replace(/[^0-9/]/g, '');
  if (!safeId) return c.json({ _embedded: { images: [] } });
  const res = await fetch(`https://ws-public.interpol.int/notices/v1/${type}/${safeId}/images`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return c.json({ _embedded: { images: [] } });
  return c.json(await res.json());
});
screening.get('/notice/:type', requireRole(...READ_ROLES), async (c) => {
  const type = c.req.param('type') ?? '';
  if (!['red', 'yellow', 'un'].includes(type)) return c.json({ error: 'bad type' }, 400);
  const safeId = (c.req.query('id') ?? '').replace(/[^0-9/]/g, '');
  if (!safeId) return c.json({ error: 'id required' }, 400);
  const res = await fetch(`https://ws-public.interpol.int/notices/v1/${type}/${safeId}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return c.json({ error: 'not found' }, 404);
  return c.json(await res.json());
});

// GET /api/screening/hits?status=&person_id=&source=
screening.get('/hits', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const filters: string[] = ['is_active = 1']; const params: unknown[] = [];
    const status = c.req.query('status'); if (status) { filters.push('status = ?'); params.push(status); }
    const pid = c.req.query('person_id'); if (pid && Number.isFinite(Number(pid))) { filters.push('person_id = ?'); params.push(Number(pid)); }
    const src = c.req.query('source'); if (src) { filters.push('source_key = ?'); params.push(src); }
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM screening_hits WHERE ${filters.join(' AND ')} ORDER BY match_score DESC, last_seen_at DESC LIMIT 200`, ...params);
    return c.json({ data: rows });
  } catch (err) {
    log.error('[screening] GET /hits failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to load screening hits', code: 'DB_ERROR' }, 500);
  }
});

// POST /api/screening/screen-person/:id — manual "Screen Now" button.
// Runs every registered source for this person right now, independent of
// the watchlist/cadence system. Awaited (not fire-and-forget) since this
// is a user-initiated action expecting an immediate result.
screening.post('/screen-person/:id', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Invalid person id' }, 400);
  const user = c.get('user') as { id?: number } | undefined;
  try {
    const result = await screenPersonAllSources(c.env, id, {
      triggeredBy: user?.id ? `manual:${user.id}` : 'manual',
    });
    return c.json({ success: true, ...result });
  } catch (err) {
    log.error('[screening/screen-person]', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ success: false, error: 'screen failed' }, 500);
  }
});

// POST /api/screening/hits/:id/confirm
screening.post('/hits/:id/confirm', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number };
  try {
    const res = await confirmScreeningHit(c.env, id, user.id);
    return c.json({ success: true, status: res.status, promotedRef: res.promotedRef });
  } catch (err) { log.error('[screening/confirm]', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ success: false, error: 'confirm failed' }, 400); }
});

// POST /api/screening/hits/:id/dismiss
screening.post('/hits/:id/dismiss', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number };
  try {
    await dismissScreeningHit(c.env, id, user.id);
    return c.json({ success: true });
  } catch (err) { log.error('[screening/dismiss]', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ success: false, error: 'dismiss failed' }, 400); }
});

// GET/POST/DELETE /api/screening/watchlist
screening.get('/watchlist', requireRole(...READ_ROLES), async (c) => {
  try {
    const rows = await query<Record<string, unknown>>(getDb(c.env), `
      SELECT sw.id, sw.person_id, sw.source_scope, sw.reason, sw.active,
             p.first_name, p.last_name
        FROM screening_watchlist sw LEFT JOIN persons p ON p.id = sw.person_id
       WHERE sw.active = 1 ORDER BY sw.created_at DESC LIMIT 200`);
    return c.json({ data: rows });
  } catch (err) {
    log.error('[screening] GET /watchlist failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ data: [] });
  }
});
screening.post('/watchlist', requireRole(...SCAN_ROLES), async (c) => {
  const body = await c.req.json<{ person_id?: number; source_scope?: string; reason?: string }>().catch(() => ({} as { person_id?: number; source_scope?: string; reason?: string }));
  const user = c.get('user') as { id: number };
  if (!body.person_id) return c.json({ success: false, error: 'person_id required' }, 400);
  try {
    const r = await execute(getDb(c.env),
      'INSERT INTO screening_watchlist (person_id, source_scope, reason, added_by) VALUES (?,?,?,?)',
      body.person_id, body.source_scope ?? null, body.reason ?? null, user.id);
    return c.json({ success: true, id: r.meta.last_row_id });
  } catch (err) { log.error('[screening/watchlist]', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ success: false, error: 'failed' }, 500); }
});
screening.delete('/watchlist/:id', requireRole(...SCAN_ROLES), async (c) => {
  try {
    await execute(getDb(c.env), 'UPDATE screening_watchlist SET active = 0 WHERE id = ?', Number(c.req.param('id')));
    return c.json({ success: true });
  } catch (err) { log.error('[screening/watchlist-del]', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ success: false, error: 'failed' }, 500); }
});

// POST /api/screening/scan?source= — manual trigger (fire-and-forget).
// Manual triggers FORCE the scan, bypassing the per-source 6-month cadence;
// pass ?source=<key> to scrape a single source ("Scrape now"), else all.
screening.post('/scan', requireRole(...SCAN_ROLES), async (c) => {
  const sourceKey = c.req.query('source') || undefined;
  if (sourceKey && !getAdapter(sourceKey)) return c.json({ success: false, error: 'unknown source' }, 400);
  c.executionCtx.waitUntil(
    runScreeningScans(c.env, { force: true, sourceKey })
      .catch((err) => log.error('[screening] manual scan failed', {}, err instanceof Error ? err : new Error(String(err)))));
  return c.json({ success: true, started: true, sourceKey: sourceKey ?? null, message: 'Scan started; poll /hits and /status.' }, 202);
});

// POST /api/screening/sources/:key/interval — set the per-source re-scan
// cadence (days). A new source defaults to 180 (~6 months). Upserts state so
// the next successful scrape stamps next_run_at off the new interval.
screening.post('/sources/:key/interval', requireRole(...SCAN_ROLES), async (c) => {
  const key = c.req.param('key') ?? '';
  if (!getAdapter(key)) return c.json({ success: false, error: 'unknown source' }, 400);
  const body = await c.req.json<{ days?: number }>().catch(() => ({} as { days?: number }));
  const days = Number(body.days);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    return c.json({ success: false, error: 'days must be 1–3650' }, 400);
  }
  try {
    const db = getDb(c.env);
    // Reconcile columns first (deploy migration is continue-on-error).
    for (const ddl of [
      'ALTER TABLE screening_source_state ADD COLUMN scan_interval_days INTEGER NOT NULL DEFAULT 180',
      'ALTER TABLE screening_source_state ADD COLUMN next_run_at TEXT',
    ]) await execute(db, ddl).catch(() => {});
    await execute(db, `
      INSERT INTO screening_source_state (source_key, enabled, scan_interval_days)
      VALUES (?, 1, ?)
      ON CONFLICT(source_key) DO UPDATE SET scan_interval_days = excluded.scan_interval_days`,
      key, Math.round(days));
    return c.json({ success: true, sourceKey: key, scanIntervalDays: Math.round(days) });
  } catch (err) { log.error('[screening/interval]', {}, err instanceof Error ? err : new Error(String(err))); return c.json({ success: false, error: 'failed' }, 500); }
});

// GET /api/screening/status — recent runs + state
screening.get('/status', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const runs = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_scan_runs ORDER BY started_at DESC LIMIT 20');
    const state = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_source_state');
    const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) n FROM screening_hits WHERE status='pending' AND is_active=1");
    return c.json({ runs, state, pendingCount: pending?.n ?? 0 });
  } catch (err) {
    log.error('[screening] GET /status failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ runs: [], state: [], pendingCount: 0 });
  }
});

export default screening;
