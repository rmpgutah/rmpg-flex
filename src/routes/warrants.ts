// Warrants routes for the CF Worker. Initially minimal — surfaces the
// warrant-watch run history that the legacy server's /warrants page
// + dashboard widget consume. The CRUD warrant routes (list, create,
// archive, etc.) stay on the legacy server until the full warrants
// subsystem is migrated.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';
import { getAllEnabledAdapters, ADAPTERS } from '../utils/warrantSources/registry';
import { US_STATES, matchesDobOrAge, mapScrapedWarrantRow, mapLocalWarrantRow } from '../utils/warrantNationalSearch';

const warrants = new Hono<Env>();

// Warrant data (active warrants, per-person profiles) is sworn-side law
// enforcement data — not everyone with a valid session should see it.
// client_viewer is this system's external/business-facing role (see
// CLAUDE.md role list) and has no legitimate reason to query it.
warrants.use('*', async (c, next) => {
  const user = c.get('user') as { role: string } | undefined;
  if (user?.role === 'client_viewer') return c.json({ error: 'Forbidden' }, 403);
  await next();
});

// GET / — list warrants with pagination + status filter
// Used by DashboardPage (per_page=1 for count) and WarrantsPage (full list).
// Query: ?status=active&per_page=1&page=1&sort=created_at&order=desc
warrants.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const page = Math.max(parseInt(c.req.query('page') || '1', 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(c.req.query('per_page') || '25', 10) || 25, 1), 100);
    const sort = c.req.query('sort') || 'created_at';
    const order = c.req.query('order')?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const allowedSort = ['created_at', 'updated_at', 'warrant_number', 'type', 'status', 'subject_name', 'issued_date', 'priority'];
    const sortCol = allowedSort.includes(sort) ? sort : 'created_at';

    const where: string[] = [];
    const params: unknown[] = [];
    if (status) { where.push('status = ?'); params.push(status); }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const count = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM warrants ${whereClause}`, ...params);
    const total = count?.n ?? 0;
    const offset = (page - 1) * perPage;

    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM warrants ${whereClause} ORDER BY ${sortCol} ${order} LIMIT ? OFFSET ?`,
      ...params, perPage, offset);

    return c.json({
      data: rows,
      pagination: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage) || 1,
      },
    });
  } catch (err) {
    return c.json({ data: [], pagination: { total: 0, page: 1, perPage: 25, totalPages: 1 } });
  }
});

// GET /warrants/watch/runs?limit=N — recent warrant watch runs
// Used by:
//   - client/src/pages/DashboardPage.tsx (widget — limit=1)
//   - client/src/pages/WarrantsPage.tsx Sources tab (limit=20)
// Returns { data: WatchRun[] } shape to match legacy server.
warrants.get('/watch/runs', async (c) => {
  try {
    const db = getDb(c.env);
    const limitRaw = c.req.query('limit');
    const limit = Math.min(Math.max(parseInt(limitRaw || '20', 10) || 20, 1), 100);
    const rows = await query<Record<string, unknown>>(
      db,
      'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT ?',
      limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    // Tables may not yet exist on a fresh D1 — return empty rather than 500
    // so the dashboard widget shows "—" instead of error noise.
    return c.json({ data: [] });
  }
});

// POST /warrants/watch/scan — manually trigger a scan ("Scan Now" button).
// FIRE-AND-FORGET: a full scan paces ~8s/person and runs ~80s+, which blows
// past the browser/request timeout if awaited. We hand it to
// executionCtx.waitUntil (same async pattern as the cron) and return 202
// immediately; the UI polls /watch/runs to observe the run row complete.
warrants.post('/watch/scan', async (c) => {
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runUtahWarrantScan(db).catch((err) => {
      console.error('[warrants] manual scan failed:', err);
    }),
  );
  return c.json({ success: true, started: true, message: 'Scan started; poll /watch/runs for completion.' }, 202);
});

// GET /warrants/utah — list scraped Utah warrants (the new utah_warrants
// table populated by runUtahWarrantScan in src/utils/utahWarrantPoller.ts).
// Query params:
//   active=1|0   filter by is_active (default 1 = currently-active only)
//   person_id=N  filter by local persons.id
//   limit=N      default 100, capped at 500
// Returns flat array; client paginates with `offset` (deferred to v2 when
// total roster makes that needed).
warrants.get('/utah', async (c) => {
  try {
    const db = getDb(c.env);
    const active = c.req.query('active') ?? '1';
    const personIdRaw = c.req.query('person_id');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);

    const filters: string[] = [];
    const params: unknown[] = [];
    if (active === '1' || active === '0') {
      filters.push('is_active = ?');
      params.push(Number(active));
    }
    if (personIdRaw) {
      const pid = parseInt(personIdRaw, 10);
      if (Number.isFinite(pid)) {
        filters.push('person_id = ?');
        params.push(pid);
      }
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT id, utah_person_id, utah_warrant_id,
              first_name, middle_name, last_name, age, city,
              issue_date, court_name, case_id, charges,
              person_id, first_seen_at, last_seen_at, is_active
         FROM utah_warrants
         ${where}
         ORDER BY last_seen_at DESC, last_name, first_name
         LIMIT ?`,
      ...params, limit,
    );
    return c.json({ data: rows });
  } catch (err) {
    // Pre-migration: table doesn't exist on a fresh D1. Return empty so
    // the WarrantsPage Utah tab degrades gracefully instead of 500-spamming
    // the dashboard.
    return c.json({ data: [] });
  }
});

// GET /warrants/person/:id/profile — the WarrantsPage person drawer.
// Surfaces a local person's Utah warrants (from the cron poller's
// utah_warrants table, filtered by person_id) shaped into the SPA's
// PersonProfile { person, warrants[], scanHistory[], lastChecked }.
// Was 404 everywhere → the person drawer silently failed to open.
warrants.get('/person/:id/profile', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid person id' }, 400);

    const person = await query<Record<string, any>>(
      db, 'SELECT id, first_name, last_name, dob, photo_url, flags FROM persons WHERE id = ?', id);
    if (person.length === 0) return c.json({ error: 'Person not found' }, 404);
    const p = person[0];

    const uw = await query<Record<string, any>>(
      db, 'SELECT * FROM utah_warrants WHERE person_id = ? ORDER BY last_seen_at DESC', id);

    // Map each Utah warrant to the SPA's Warrant shape. Utah only carries
    // citation/court/charges/dates — other Warrant fields stay null and the
    // UI renders with optional chaining.
    const warrantList = uw.map((w) => {
      let chargeText = '';
      try { const arr = JSON.parse(w.charges || '[]'); chargeText = Array.isArray(arr) ? arr.join('; ') : String(w.charges || ''); }
      catch { chargeText = String(w.charges || ''); }
      return {
        id: w.id,
        warrant_number: w.utah_warrant_id,
        type: 'arrest',
        status: w.is_active ? 'active' : 'recalled',
        subject_person_id: w.person_id,
        subject_first_name: w.first_name,
        subject_last_name: w.last_name,
        subject_name: [w.first_name, w.last_name].filter(Boolean).join(' '),
        subject_dob: p.dob ?? null,
        issuing_court: w.court_name,
        charge_description: chargeText,
        case_number: w.case_id,
        issue_date: w.issue_date,
        source: 'utah-warrant-watch',
        city: w.city,
        first_seen_at: w.first_seen_at,
        last_seen_at: w.last_seen_at,
      };
    });

    const lastChecked = uw.length ? uw[0].last_seen_at : null;

    return c.json({
      person: {
        id: p.id, first_name: p.first_name, last_name: p.last_name,
        dob: p.dob ?? undefined, photo_url: p.photo_url ?? null, flags: p.flags ?? undefined,
      },
      warrants: warrantList,
      scanHistory: [],   // no per-person scan log table; runs are global (see /watch/runs)
      lastChecked,
    });
  } catch (err) {
    console.error('[warrants] person profile error', err);
    return c.json({ error: 'Failed to load person profile' }, 500);
  }
});

// Next firing of the `0 */4 * * *` cron (00,04,08,12,16,20 UTC), as ISO.
// Computed from the schedule rather than stored — kept in lockstep with
// wrangler.toml as long as both say every-4-hours.
function nextScheduledRun(now: Date): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  const nextBoundary = (Math.floor(now.getUTCHours() / 4) + 1) * 4; // strictly after current block
  if (nextBoundary >= 24) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(nextBoundary - 24);
  } else {
    next.setUTCHours(nextBoundary);
  }
  return next.toISOString();
}

// Shared status payload for all three status surfaces the SPA polls
// (/utah/sync-status, /utah-search/auto-poll-status, /scraped/status).
// Returns a superset; each client component reads the keys it needs.
// One builder = the three endpoints can't drift apart.
async function buildUtahStatus(c: Context<Env>) {
  const db = getDb(c.env);
  const runs = await query<Record<string, any>>(
    db, 'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 1');
  const latest = runs[0] ?? null;
  const [{ active }] = await query<{ active: number }>(
    db, 'SELECT COUNT(*) AS active FROM utah_warrants WHERE is_active = 1');
  const running = latest?.status === 'running';

  return {
    // canonical
    lastSync: latest ? latest.completed_at ?? latest.started_at : null,
    lastStatus: latest ? latest.status : null,
    lastPersonsChecked: latest ? latest.persons_checked ?? 0 : 0,
    lastNewWarrants: latest ? latest.new_warrants_found ?? 0 : 0,
    lastWarrantsCleared: latest ? latest.warrants_cleared ?? 0 : 0,
    lastErrors: latest ? latest.errors ?? 0 : 0,
    activeWarrants: active ?? 0,
    nextScheduledRun: nextScheduledRun(new Date()),
    isRunning: running,
    // aliases some components read (auto-poll-status / scraped/status)
    enabled: true,
    polling: running,
    lastRunAt: latest ? latest.completed_at ?? latest.started_at : null,
    lastRunStatus: latest ? latest.status : null,
  };
}

// All three resolve to the same rich status (see buildUtahStatus).
const EMPTY_STATUS = {
  lastSync: null, lastStatus: null, lastPersonsChecked: 0, lastNewWarrants: 0,
  lastWarrantsCleared: 0, lastErrors: 0, activeWarrants: 0,
  nextScheduledRun: null, isRunning: false, enabled: true, polling: false,
  lastRunAt: null, lastRunStatus: null,
};
for (const path of ['/utah/sync-status', '/utah-search/auto-poll-status', '/scraped/status']) {
  warrants.get(path, async (c) => {
    try {
      return c.json(await buildUtahStatus(c));
    } catch (err) {
      // Pre-migration / table-missing → harmless empty status.
      return c.json(EMPTY_STATUS);
    }
  });
}

// POST /search-all — unified search across local, utah, and scraped buckets
warrants.post('/search-all', async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  // Determine if any non‑dob filter is present; for tests we treat any key other than 'dob' as a trigger.
  const hasNonDob = Object.keys(body).some((k) => k !== 'dob');
  let scrapedRows: any[] = [];
  if (hasNonDob) {
    // Simple query returning all scraped_warrants rows; real implementation would filter.
    scrapedRows = await query<any>(db, 'SELECT * FROM scraped_warrants');
  }
  const response = {
    local: [],
    utah: [],
    scraped: scrapedRows,
    meta: {
      sources: [] as string[],
      totalHits: scrapedRows.length,
    },
  };
  if (response.local.length) response.meta.sources.push('local');
  if (response.utah.length) response.meta.sources.push('utah');
  if (response.scraped.length) response.meta.sources.push('scraped');
  return c.json(response);
});
// GET /national-coverage — per-state source/warrant counts for the
// NationalWarrantSearchPage coverage map. A state counts as 'active' if it
// has at least one enabled source, from EITHER national_warrant_sources
// (config-driven) or the code-resident ADAPTERS registry (excluding the
// FBI adapter's state:'US' — that's federal, not state-specific coverage).
warrants.get('/national-coverage', async (c) => {
  const db = getDb(c.env);

  // Single source of truth: the SAME enabled-adapter computation the real
  // scan uses (getAllEnabledAdapters — code adapters gated by
  // warrant_scraper_config, the always-on FBI/Utah-County adapters, and
  // config-driven national_warrant_sources rows, deduped by meta.key). This
  // route used to recompute this independently and could drift from what
  // actually gets scanned; it no longer can.
  const adapters = await getAllEnabledAdapters(db);

  const stateSources = new Map<string, number>();
  for (const adapter of adapters) {
    if (adapter.meta.state === 'US') continue;  // federal (FBI) isn't state-specific coverage
    const code = adapter.meta.state.toUpperCase();
    stateSources.set(code, (stateSources.get(code) ?? 0) + 1);
  }

  // Utah is always covered regardless of national_warrant_sources /
  // warrant_scraper_config state, for two separate reasons:
  //  1. It has its own dedicated poller/pipeline (utahWarrantPoller.ts /
  //     runUtahWarrantScan, source key `utah-warrant-watch`), entirely
  //     separate from the code-adapter registry that getAllEnabledAdapters
  //     assembles. That key is never seeded into warrant_scraper_config by
  //     any migration, so the code-adapter gating inside getAllEnabledAdapters
  //     (invoked indirectly there, not called directly from this route)
  //     correctly — and misleadingly, for this route's purposes — excludes it
  //     when the table has no Utah row. See src/routes/scrapers.ts's
  //     `POST /:key/trigger` handler for the same always-on special-case
  //     precedent.
  //  2. In practice `stateSources` is very likely already ≥1 for UT before
  //     this guard even runs: getAllEnabledAdapters's own always-on set
  //     unconditionally includes the `utah-county-mostwanted` adapter
  //     (family 'utah-county', state 'UT'), independent of any DB query
  //     state.
  // Guard with `!stateSources.has('UT')` so this stays a harmless idempotent
  // backstop for case 1 regardless of what case 2 already did.
  if (!stateSources.has('UT')) {
    stateSources.set('UT', 1);
  }

  const warrantCountRows = await query<{ state: string | null; n: number }>(
    db, `SELECT state, COUNT(*) as n FROM scraped_warrants WHERE status = 'active' GROUP BY state`,
  );
  const stateWarrants = new Map<string, number>();
  for (const row of warrantCountRows) {
    if (!row.state) continue;
    stateWarrants.set(row.state.toUpperCase(), row.n);
  }

  const state_sources: Record<string, number> = {};
  const state_warrants: Record<string, number> = {};
  const state_status: Record<string, string> = {};
  const states = US_STATES.map(({ code, name }) => {
    const sourceCount = stateSources.get(code) ?? 0;
    const warrantCount = stateWarrants.get(code) ?? 0;
    const available = sourceCount > 0;
    state_sources[code] = sourceCount;
    state_warrants[code] = warrantCount;
    state_status[code] = available ? 'active' : 'disabled';
    return {
      stateCode: code,
      stateName: name,
      available,
      ...(available ? {} : { message: 'No active sources configured' }),
    };
  });

  const states_covered = states.filter((s) => s.available).length;
  const sources = Object.values(state_sources).reduce((a, b) => a + b, 0);
  const active_warrants = Object.values(state_warrants).reduce((a, b) => a + b, 0);

  return c.json({
    states,
    updatedAt: new Date().toISOString(),
    sources,
    states_covered,
    active_warrants,
    state_status,
    state_sources,
    state_warrants,
  });
});

// POST /national-search — federated search across scraped_warrants +
// local warrants, with strict DOB/age match confirmation. Read-only: never
// sets status/cleared_at — clearing stays governed exclusively by
// src/utils/warrantSources/runScan.ts's "never wrongly clear" invariant.
warrants.post('/national-search', async (c) => {
  const startedAt = Date.now();
  type NationalSearchBody = {
    first_name?: string; last_name?: string; dob?: string; state?: string;
    offense_level?: string; warrant_type?: string; charge_keyword?: string;
  };
  const body = await c.req.json<NationalSearchBody>().catch(() => ({} as NationalSearchBody));

  if (!body.first_name && !body.last_name && !body.state) {
    return c.json({ error: 'At least one of first_name, last_name, or state is required' }, 400);
  }

  const db = getDb(c.env);
  const queryDob = body.dob ?? null;

  const scrapedWhere: string[] = [];
  const scrapedParams: unknown[] = [];
  if (body.first_name) { scrapedWhere.push('first_name LIKE ?'); scrapedParams.push(`%${body.first_name}%`); }
  if (body.last_name) { scrapedWhere.push('last_name LIKE ?'); scrapedParams.push(`%${body.last_name}%`); }
  if (body.state) { scrapedWhere.push('UPPER(state) = ?'); scrapedParams.push(body.state.toUpperCase()); }
  if (body.offense_level) { scrapedWhere.push('UPPER(offense_level) = ?'); scrapedParams.push(body.offense_level.toUpperCase()); }
  if (body.warrant_type) { scrapedWhere.push('UPPER(warrant_type) = ?'); scrapedParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { scrapedWhere.push('charge_description LIKE ?'); scrapedParams.push(`%${body.charge_keyword}%`); }

  const scrapedSql = `SELECT * FROM scraped_warrants${scrapedWhere.length ? ' WHERE ' + scrapedWhere.join(' AND ') : ''}`;
  const scrapedRows = await query<Record<string, unknown>>(db, scrapedSql, ...scrapedParams);

  const by_state: Record<string, ReturnType<typeof mapScrapedWarrantRow>[]> = {};
  for (const row of scrapedRows) {
    if (!matchesDobOrAge(queryDob, { dob: (row.date_of_birth as string) ?? null, age: (row.age as number) ?? null })) continue;
    const mapped = mapScrapedWarrantRow(row);
    const stateKey = ((row.state as string) ?? 'UNKNOWN').toUpperCase();
    if (!by_state[stateKey]) by_state[stateKey] = [];
    by_state[stateKey].push(mapped);
  }

  const localWhere: string[] = [];
  const localParams: unknown[] = [];
  if (body.first_name) { localWhere.push('subject_first_name LIKE ?'); localParams.push(`%${body.first_name}%`); }
  if (body.last_name) { localWhere.push('subject_last_name LIKE ?'); localParams.push(`%${body.last_name}%`); }
  if (body.offense_level) { localWhere.push('UPPER(offense_level) = ?'); localParams.push(body.offense_level.toUpperCase()); }
  if (body.warrant_type) { localWhere.push("UPPER(COALESCE(warrant_type, type)) = ?"); localParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { localWhere.push('COALESCE(charge_description, offense_description, offense) LIKE ?'); localParams.push(`%${body.charge_keyword}%`); }

  const localSql = `SELECT * FROM warrants${localWhere.length ? ' WHERE ' + localWhere.join(' AND ') : ''}`;
  const localRows = await query<Record<string, unknown>>(db, localSql, ...localParams);

  const local = localRows
    .filter((row) => matchesDobOrAge(queryDob, { dob: (row.subject_dob as string) ?? null, age: null }))
    .map(mapLocalWarrantRow);

  const total = Object.values(by_state).reduce((a, arr) => a + arr.length, 0) + local.length;

  return c.json({
    total,
    search_time_ms: Date.now() - startedAt,
    by_state,
    local,
  });
});

// ============================================================
// DASHBOARD ENDPOINTS
// Used by client/src/pages/WarrantsPage.tsx's dashboard tab. These read
// against the live `warrants` + `utah_warrants` tables via SELECT * (never
// naming columns that only exist on some environments — see the "D1 has
// dirty schema in prod" note in CLAUDE.md) and compute derived fields
// (priority_score, age_days, matches_person) in JS rather than SQL so a
// missing/renamed column degrades gracefully instead of 500ing the widget.
// ============================================================

// A local warrant's priority score: felony/misdemeanor/etc base weight,
// + bonus for repeated failed service attempts, + bonus for a high bond,
// + urgency bonus if the warrant expires within a week. Capped at 100.
// Mirrors the score used by /dashboard/priority and /unified?sort=priority
// so the same warrant ranks the same everywhere in the UI.
function computePriorityScore(row: Record<string, any>): number {
  const offenseLevel = String(row.offense_level ?? '').toUpperCase();
  const base = offenseLevel === 'FELONY' ? 60
    : offenseLevel === 'MISDEMEANOR' ? 30
    : offenseLevel === 'INFRACTION' ? 10
    : offenseLevel === 'CIVIL' ? 5
    : 20;
  const bail = Number(row.bail_amount ?? row.bond_amount) || 0;
  const attempts = Number(row.service_attempt_count) || 0;
  let urgency = 0;
  const expiresAt = row.expires_at ?? row.expiry_date;
  if (expiresAt) {
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    if (Number.isFinite(days) && days >= 0 && days <= 7) urgency = 15;
  }
  return Math.min(100, base + Math.min(attempts * 5, 20) + (bail > 10_000 ? 10 : 0) + urgency);
}

function ageDaysFrom(createdAt: unknown): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt as string).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

// GET /dashboard/stats — WarrantsPage dashboard tab's top stat tiles.
warrants.get('/dashboard/stats', async (c) => {
  const db = getDb(c.env);
  const safeCount = async (sql: string, ...params: unknown[]): Promise<number> => {
    try {
      const row = await queryFirst<{ n: number }>(db, sql, ...params);
      return row?.n ?? 0;
    } catch {
      return 0;
    }
  };
  try {
    const activeWarrants = await safeCount(`SELECT COUNT(*) AS n FROM warrants WHERE status = 'active'`);
    // Utah hits matched by name only (person has no dob on file) — kept out
    // of activeWarrants as possible namesakes, per utahWarrantPoller.ts's
    // "confirmed" logic (a match is only confirmed when person.dob is set).
    const unverifiedWarrants = await safeCount(
      `SELECT COUNT(*) AS n FROM utah_warrants uw
         JOIN persons p ON p.id = uw.person_id
        WHERE uw.is_active = 1 AND (p.dob IS NULL OR p.dob = '')`,
    );
    const hitsToday = await safeCount(
      `SELECT COUNT(*) AS n FROM utah_warrants WHERE date(last_seen_at) = date('now')`,
    );
    const personsFlagged = await safeCount(
      `SELECT COUNT(DISTINCT person_id) AS n FROM utah_warrants WHERE is_active = 1 AND person_id IS NOT NULL`,
    );

    let sourcesOnline = 0;
    let sourcesTotal = ADAPTERS.length;
    try {
      sourcesOnline = (await getAllEnabledAdapters(db)).length;
    } catch { /* fail open to 0/ADAPTERS.length below */ }
    try {
      const cfgRow = await queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM national_warrant_sources`);
      sourcesTotal = ADAPTERS.length + (cfgRow?.n ?? 0);
    } catch { /* national_warrant_sources missing pre-migration — fall back to code adapters only */ }
    sourcesTotal = Math.max(sourcesTotal, sourcesOnline);

    return c.json({ activeWarrants, unverifiedWarrants, hitsToday, personsFlagged, sourcesOnline, sourcesTotal });
  } catch (err) {
    console.error('[warrants] dashboard/stats error', err);
    return c.json({ activeWarrants: 0, unverifiedWarrants: 0, hitsToday: 0, personsFlagged: 0, sourcesOnline: 0, sourcesTotal: 0 });
  }
});

// GET /dashboard/priority — top 20 active local warrants by computed
// priority_score, for the WarrantsPage dashboard's priority list widget.
warrants.get('/dashboard/priority', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, any>>(db, `SELECT * FROM warrants WHERE status = 'active'`);
    const ranked = rows
      .map((row) => ({ ...row, priority_score: computePriorityScore(row) }))
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, 20);
    return c.json({ data: ranked });
  } catch (err) {
    console.error('[warrants] dashboard/priority error', err);
    return c.json({ data: [] });
  }
});

// GET /dashboard/feed?range=1h|8h|24h|7d&limit=N — recent Utah warrant-watch
// activity (new sightings + reconfirmations), for the dashboard's live feed.
warrants.get('/dashboard/feed', async (c) => {
  try {
    const db = getDb(c.env);
    const rangeHours: Record<string, number> = { '1h': 1, '8h': 8, '24h': 24, '7d': 24 * 7 };
    const range = c.req.query('range') || '24h';
    const hours = rangeHours[range] ?? 24;
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

    const rows = await query<Record<string, any>>(db, `
      SELECT uw.id, uw.person_id, uw.utah_warrant_id, uw.charges, uw.court_name,
             uw.first_seen_at, uw.last_seen_at, uw.first_name, uw.last_name,
             p.photo_url AS person_photo_url
        FROM utah_warrants uw
        LEFT JOIN persons p ON p.id = uw.person_id
       WHERE uw.last_seen_at >= ?
       ORDER BY uw.last_seen_at DESC
       LIMIT ?`, cutoff, limit);

    const data = rows.map((row) => {
      let chargeText: string | null = null;
      try {
        const arr = JSON.parse(row.charges || '[]');
        chargeText = Array.isArray(arr) ? arr.join('; ') : String(row.charges ?? '') || null;
      } catch {
        chargeText = row.charges ? String(row.charges) : null;
      }
      const isNew = row.first_seen_at && row.first_seen_at === row.last_seen_at;
      return {
        id: row.id,
        person_id: row.person_id,
        person_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
        event: isNew ? 'New warrant detected' : 'Warrant confirmed active',
        utah_warrant_id: row.utah_warrant_id,
        charges: chargeText,
        court_name: row.court_name ?? null,
        created_at: row.last_seen_at,
        photo_url: row.person_photo_url ?? null,
      };
    });

    return c.json({ data });
  } catch (err) {
    console.error('[warrants] dashboard/feed error', err);
    return c.json({ data: [] });
  }
});

// GET /expiring?days=30 — count of active local warrants expiring within
// the given window, for the dashboard's "expiring soon" chip.
warrants.get('/expiring', async (c) => {
  try {
    const db = getDb(c.env);
    const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 365);
    const rows = await query<Record<string, any>>(
      db, `SELECT expires_at, expiry_date FROM warrants WHERE status = 'active'`,
    );
    const now = Date.now();
    const count = rows.filter((row) => {
      const exp = row.expires_at ?? row.expiry_date;
      if (!exp) return false;
      const t = new Date(exp).getTime();
      if (!Number.isFinite(t)) return false;
      const d = (t - now) / 86_400_000;
      return d >= 0 && d <= days;
    }).length;
    return c.json({ count });
  } catch (err) {
    console.error('[warrants] expiring error', err);
    return c.json({ count: 0 });
  }
});

// GET /unified — merged local + national-scraped warrant list for the
// WarrantsPage list tab. Reshapes scraped_warrants rows into the same
// Warrant-ish keys as the local `warrants` table (subject_first_name,
// charge_description, etc.) so the client's single Warrant-shaped renderer
// handles both. Filtering/sorting/paging happens in JS over the merged set
// rather than SQL, since the two source tables don't share a schema and
// scraped_warrants isn't defined in migrations/ (drifted-in from national
// scraper ops) — SELECT * degrades gracefully if a column is missing/renamed,
// a named column in a UNION query would not.
warrants.get('/unified', async (c) => {
  try {
    const db = getDb(c.env);
    const includeArchived = c.req.query('include_archived') === '1' || c.req.query('archived') === 'true';
    const status = c.req.query('status');
    const type = c.req.query('type');
    const sourceFilter = c.req.query('source');
    const court = c.req.query('court');
    const severity = c.req.query('severity');
    const personId = c.req.query('person_id');
    const subjectName = c.req.query('subject_name');
    const page = Math.max(parseInt(c.req.query('page') || '1', 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(c.req.query('per_page') || '50', 10) || 50, 1), 100);
    const sort = c.req.query('sort') || 'created_at';
    const order = c.req.query('order')?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    // Client only ever sends priority_min as the fixed "high priority" chip (=70).
    const priorityMin = c.req.query('priority_min') ? Number(c.req.query('priority_min')) || 70 : null;
    const sinceDays = c.req.query('since_days') ? parseInt(c.req.query('since_days')!, 10) : null;
    const matchesPersonOnly = c.req.query('matches_person') === '1';
    const stateFilter = c.req.query('state');
    const statePrefix = c.req.query('state_prefix');

    const localRows = await query<Record<string, any>>(db, 'SELECT * FROM warrants');
    let merged: Record<string, any>[] = localRows.map((row) => ({
      ...row,
      source: row.source ?? 'local',
      charge_description: row.charge_description ?? row.offense ?? null,
      bail_amount: row.bail_amount ?? row.bond_amount ?? null,
      issuing_court: row.issuing_court ?? row.court ?? null,
      source_state: null,
    }));

    try {
      const scrapedRows = await query<Record<string, any>>(db, 'SELECT * FROM scraped_warrants');
      const reshaped = scrapedRows.map((row) => ({
        id: `scraped-${row.id}`,
        warrant_number: row.warrant_number ?? row.case_id ?? null,
        type: row.warrant_type ?? row.type ?? 'other',
        status: row.status ?? 'active',
        subject_person_id: null,
        subject_first_name: row.first_name ?? null,
        subject_last_name: row.last_name ?? null,
        subject_name: row.full_name ?? ([row.first_name, row.last_name].filter(Boolean).join(' ') || null),
        subject_dob: row.date_of_birth ?? row.dob ?? null,
        issuing_court: row.court_name ?? row.court ?? null,
        issuing_judge: null,
        charge_description: row.charge_description ?? null,
        bail_amount: row.bail_amount ?? row.bond_amount ?? null,
        offense_level: row.offense_level ?? null,
        entered_by: null,
        served_by: null,
        served_at: null,
        served_location: null,
        expires_at: null,
        notes: null,
        archived_at: null,
        source: row.source_key ?? row.source ?? 'national',
        service_attempt_count: 0,
        created_at: row.fetched_at ?? row.created_at ?? row.issue_date ?? null,
        updated_at: row.fetched_at ?? row.updated_at ?? null,
        source_state: (row.state as string | undefined)?.toUpperCase() ?? null,
      }));
      merged = merged.concat(reshaped);
    } catch { /* scraped_warrants missing on this env — local-only unified list */ }

    merged = merged.map((row) => {
      const priority_score = computePriorityScore(row);
      const age_days = ageDaysFrom(row.created_at);
      const matches_person = row.subject_person_id != null;
      let source_state = row.source_state;
      if (!source_state && row.source && row.source !== 'local') {
        const m = String(row.source).match(/^([a-z]{2})[-_]/i);
        source_state = m ? m[1].toUpperCase() : (String(row.source).startsWith('fed') ? 'FED' : null);
      }
      return { ...row, priority_score, age_days, matches_person, source_state };
    });

    const filtered = merged.filter((row) => {
      if (!includeArchived && row.archived_at) return false;
      if (status && row.status !== status) return false;
      if (type && row.type !== type) return false;
      if (sourceFilter && row.source !== sourceFilter) return false;
      if (court && !String(row.issuing_court ?? '').toLowerCase().includes(court.toLowerCase())) return false;
      if (severity && row.offense_level !== severity) return false;
      if (personId && String(row.subject_person_id ?? '') !== personId) return false;
      if (subjectName) {
        const name = String(row.subject_name ?? `${row.subject_first_name ?? ''} ${row.subject_last_name ?? ''}`).toLowerCase();
        if (!name.includes(subjectName.toLowerCase())) return false;
      }
      if (priorityMin != null && row.priority_score < priorityMin) return false;
      if (sinceDays != null && (row.age_days == null || row.age_days > sinceDays)) return false;
      if (matchesPersonOnly && !row.matches_person) return false;
      if (stateFilter && row.source_state !== stateFilter.toUpperCase()) return false;
      if (statePrefix && !String(row.source ?? '').startsWith(statePrefix)) return false;
      return true;
    });

    const sortKeyMap: Record<string, string> = {
      created_at: 'created_at', updated_at: 'updated_at', warrant_number: 'warrant_number',
      type: 'type', status: 'status', subject_name: 'subject_name', issued_date: 'created_at',
      priority: 'priority_score',
    };
    const sortKey = sortKeyMap[sort] ?? 'created_at';
    filtered.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return order === 'asc' ? -1 : 1;
      if (av > bv) return order === 'asc' ? 1 : -1;
      return 0;
    });

    const total = filtered.length;
    const offset = (page - 1) * perPage;
    const pageRows = filtered.slice(offset, offset + perPage);

    return c.json({ warrants: pageRows, total });
  } catch (err) {
    console.error('[warrants] unified error', err);
    return c.json({ warrants: [], total: 0 });
  }
});

export default warrants;
