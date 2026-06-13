import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { getAdapters, getAdapter } from '../utils/screening/registry';
import { runScreeningScans } from '../utils/screening/runScreeningScans';
import { confirmScreeningHit, dismissScreeningHit } from '../utils/screening/confirm';

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
  } catch { return c.json({ data: [] }); }
});

// GET /api/screening/search?source=&name=&forename=&nationality=&ageMin=&ageMax=&sexId=&page=
screening.get('/search', requireRole(...READ_ROLES), async (c) => {
  const sourceKey = c.req.query('source') ?? '';
  const adapter = getAdapter(sourceKey);
  if (!adapter || !adapter.supportsSearch) return c.json({ data: [], error: 'unknown or non-searchable source' }, 400);
  try {
    const num = (v: string | undefined) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const results = await adapter.searchAdHoc(c.env, {
      name: c.req.query('name'), forename: c.req.query('forename'),
      nationality: c.req.query('nationality'), sexId: c.req.query('sexId'),
      ageMin: num(c.req.query('ageMin')), ageMax: num(c.req.query('ageMax')),
      page: num(c.req.query('page')),
    });
    return c.json({ data: results });
  } catch (err) { return c.json({ data: [], error: String(err) }); }
});

// GET /api/screening/notice/:type/:id  (+ /images) — INTERPOL detail proxy
screening.get('/notice/:type/:id', requireRole(...READ_ROLES), async (c) => {
  const { type, id } = c.req.param();
  if (!['red', 'yellow', 'un'].includes(type)) return c.json({ error: 'bad type' }, 400);
  const res = await fetch(`https://ws-public.interpol.int/notices/v1/${type}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return c.json({ error: 'not found' }, 404);
  return c.json(await res.json());
});
screening.get('/notice/:type/:id/images', requireRole(...READ_ROLES), async (c) => {
  const { type, id } = c.req.param();
  const res = await fetch(`https://ws-public.interpol.int/notices/v1/${type}/${encodeURIComponent(id)}/images`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return c.json({ _embedded: { images: [] } });
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
  } catch { return c.json({ data: [] }); }
});

// POST /api/screening/hits/:id/confirm
screening.post('/hits/:id/confirm', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number };
  try {
    const res = await confirmScreeningHit(c.env, id, user.id);
    return c.json({ success: true, status: res.status, promotedRef: res.promotedRef });
  } catch (err) { return c.json({ success: false, error: String(err) }, 400); }
});

// POST /api/screening/hits/:id/dismiss
screening.post('/hits/:id/dismiss', requireRole(...SCAN_ROLES), async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user') as { id: number };
  try {
    await dismissScreeningHit(c.env, id, user.id);
    return c.json({ success: true });
  } catch (err) { return c.json({ success: false, error: String(err) }, 400); }
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
  } catch { return c.json({ data: [] }); }
});
screening.post('/watchlist', requireRole(...SCAN_ROLES), async (c) => {
  const body = await c.req.json<{ person_id?: number; source_scope?: string; reason?: string }>().catch(() => ({} as { person_id?: number; source_scope?: string; reason?: string }));
  const user = c.get('user') as { id: number };
  if (!body.person_id) return c.json({ success: false, error: 'person_id required' }, 400);
  const r = await execute(getDb(c.env),
    'INSERT INTO screening_watchlist (person_id, source_scope, reason, added_by) VALUES (?,?,?,?)',
    body.person_id, body.source_scope ?? null, body.reason ?? null, user.id);
  return c.json({ success: true, id: r.meta.last_row_id });
});
screening.delete('/watchlist/:id', requireRole(...SCAN_ROLES), async (c) => {
  await execute(getDb(c.env), 'UPDATE screening_watchlist SET active = 0 WHERE id = ?', Number(c.req.param('id')));
  return c.json({ success: true });
});

// POST /api/screening/scan — manual trigger (fire-and-forget)
screening.post('/scan', requireRole(...SCAN_ROLES), async (c) => {
  c.executionCtx.waitUntil(runScreeningScans(c.env).catch((err) => console.error('[screening] manual scan failed:', err)));
  return c.json({ success: true, started: true, message: 'Scan started; poll /hits and /status.' }, 202);
});

// GET /api/screening/status — recent runs + state
screening.get('/status', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const runs = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_scan_runs ORDER BY started_at DESC LIMIT 20');
    const state = await query<Record<string, unknown>>(db, 'SELECT * FROM screening_source_state');
    const pending = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) n FROM screening_hits WHERE status='pending' AND is_active=1");
    return c.json({ runs, state, pendingCount: pending?.n ?? 0 });
  } catch { return c.json({ runs: [], state: [], pendingCount: 0 }); }
});

export default screening;
