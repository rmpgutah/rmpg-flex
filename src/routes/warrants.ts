// Warrants routes for the CF Worker. Surfaces warrant-watch run history plus
// the full manual-warrant CRUD lifecycle (get/create/update/serve/archive/
// unarchive/delete) consumed by WarrantsPage.tsx. The CRUD routes were
// historically deferred to "the legacy server" — but that VPS was
// decommissioned 2026-06-15 (see CLAUDE.md), so they have nowhere else to
// live. Every POST/PUT/DELETE the client sent 404'd until these were added.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { log } from '../utils/logger';
import { runUtahWarrantScan, runUtahWarrantCheckForPerson } from '../utils/utahWarrantPoller';
import { getAllEnabledAdapters, ADAPTERS } from '../utils/warrantSources/registry';
import { US_STATES, matchesDobOrAge, mapScrapedWarrantRow, mapLocalWarrantRow } from '../utils/warrantNationalSearch';

const warrants = new Hono<Env>();

// D1 caps bound parameters at ~100 per prepared statement. Bulk warrant
// actions (batch-update/bulk-archive/bulk-review) build one `?` per selected
// id — split into safely-sized chunks so a selection over the cap doesn't
// throw and 500 the whole batch.
const ID_CHUNK_SIZE = 90;
function chunkIds(ids: number[]): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  return chunks;
}

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

// POST /warrants/search-all — unified cross-source warrant search.
// Queries local warrants, Utah warrants, and scraped warrants tables
// with the supplied filters. Only scraped warrants are queried when a
// name, court, charge, or case number filter is provided (dob-only
// searches skip the scraped bucket to avoid noise).
warrants.post('/search-all', async (c) => {
  const traceId = c.get('traceId');
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{
      lastName?: string;
      firstName?: string;
      dob?: string;
      courtName?: string;
      charge?: string;
      caseNumber?: string;
      // Advanced filters — WarrantsPage.tsx's Search-All "Advanced Filters"
      // panel has always sent these; this route silently ignored all of
      // them (never read from `body`), so every combination of source/
      // status/type/offense-level/date-range was a no-op.
      source?: 'local' | 'utah' | 'scraped';
      status?: string;
      type?: string;
      offenseLevel?: string;
      dateFrom?: string;
      dateTo?: string;
    }>();

    const limit = 50;

    // Each source table has its own column names — there's no shared schema
    // to build one WHERE clause from. `warrants` only has a combined
    // subject_name (no first/last split) and no case_number column at all;
    // `utah_warrants` has no dob/status/type/offense_level columns at all
    // (status there is the separate is_active flag, not comparable to the
    // local/scraped status vocabulary) — only date-range applies to it;
    // `scraped_warrants` supports every filter (using date_of_birth, not dob).
    const localConditions: string[] = [];
    const localParams: unknown[] = [];
    if (body.lastName) { localConditions.push('subject_name LIKE ?'); localParams.push(`%${body.lastName}%`); }
    if (body.firstName) { localConditions.push('subject_name LIKE ?'); localParams.push(`%${body.firstName}%`); }
    if (body.dob) { localConditions.push('subject_dob = ?'); localParams.push(body.dob); }
    if (body.courtName) { localConditions.push('court LIKE ?'); localParams.push(`%${body.courtName}%`); }
    if (body.charge) { localConditions.push('offense LIKE ?'); localParams.push(`%${body.charge}%`); }
    if (body.status) { localConditions.push('status = ?'); localParams.push(body.status); }
    if (body.type) { localConditions.push('type = ?'); localParams.push(body.type); }
    if (body.offenseLevel) { localConditions.push('offense_level = ?'); localParams.push(body.offenseLevel); }
    if (body.dateFrom) { localConditions.push('issued_date >= ?'); localParams.push(body.dateFrom); }
    if (body.dateTo) { localConditions.push('issued_date <= ?'); localParams.push(body.dateTo); }
    const localWhere = localConditions.length ? `WHERE ${localConditions.join(' AND ')}` : '';

    const utahConditions: string[] = [];
    const utahParams: unknown[] = [];
    if (body.lastName) { utahConditions.push('last_name LIKE ?'); utahParams.push(`%${body.lastName}%`); }
    if (body.firstName) { utahConditions.push('first_name LIKE ?'); utahParams.push(`%${body.firstName}%`); }
    if (body.courtName) { utahConditions.push('court_name LIKE ?'); utahParams.push(`%${body.courtName}%`); }
    if (body.dateFrom) { utahConditions.push('issue_date >= ?'); utahParams.push(body.dateFrom); }
    if (body.dateTo) { utahConditions.push('issue_date <= ?'); utahParams.push(body.dateTo); }
    const utahWhere = utahConditions.length ? `WHERE ${utahConditions.join(' AND ')}` : '';

    const scrapedConditions: string[] = [];
    const scrapedParams: unknown[] = [];
    if (body.lastName) { scrapedConditions.push('last_name LIKE ?'); scrapedParams.push(`%${body.lastName}%`); }
    if (body.firstName) { scrapedConditions.push('first_name LIKE ?'); scrapedParams.push(`%${body.firstName}%`); }
    if (body.dob) { scrapedConditions.push('date_of_birth = ?'); scrapedParams.push(body.dob); }
    if (body.courtName) { scrapedConditions.push('court_name LIKE ?'); scrapedParams.push(`%${body.courtName}%`); }
    if (body.charge) { scrapedConditions.push('charge_description LIKE ?'); scrapedParams.push(`%${body.charge}%`); }
    if (body.caseNumber) { scrapedConditions.push('case_number LIKE ?'); scrapedParams.push(`%${body.caseNumber}%`); }
    if (body.status) { scrapedConditions.push('status = ?'); scrapedParams.push(body.status); }
    if (body.type) { scrapedConditions.push('warrant_type = ?'); scrapedParams.push(body.type); }
    if (body.offenseLevel) { scrapedConditions.push('offense_level = ?'); scrapedParams.push(body.offenseLevel); }
    if (body.dateFrom) { scrapedConditions.push('issue_date >= ?'); scrapedParams.push(body.dateFrom); }
    if (body.dateTo) { scrapedConditions.push('issue_date <= ?'); scrapedParams.push(body.dateTo); }
    const scrapedWhere = scrapedConditions.length ? `WHERE ${scrapedConditions.join(' AND ')}` : '';

    // `source` restricts the search to a single bucket rather than filtering
    // rows within all three — an empty selection means "all sources".
    const wantLocal = !body.source || body.source === 'local';
    const wantUtah = !body.source || body.source === 'utah';
    const wantScraped = !body.source || body.source === 'scraped';

    const [local, utah] = await Promise.all([
      wantLocal
        ? query<Record<string, unknown>>(db, `SELECT * FROM warrants ${localWhere} LIMIT ?`, ...localParams, limit)
            .catch((err) => { log.error('warrants/search-all: local query failed', { traceId }, err); return []; })
        : Promise.resolve([]),
      wantUtah
        ? query<Record<string, unknown>>(db, `SELECT * FROM utah_warrants ${utahWhere} LIMIT ?`, ...utahParams, limit)
            .catch((err) => { log.error('warrants/search-all: utah query failed', { traceId }, err); return []; })
        : Promise.resolve([]),
    ]);

    // Only query scraped_warrants when there's a meaningful filter (not dob-only)
    const hasScrapedFilter = body.lastName || body.firstName || body.courtName || body.charge || body.caseNumber
      || body.status || body.type || body.offenseLevel || body.dateFrom || body.dateTo;
    let scraped: Record<string, unknown>[] = [];
    if (wantScraped && hasScrapedFilter) {
      scraped = await query<Record<string, unknown>>(db, `SELECT * FROM scraped_warrants ${scrapedWhere} LIMIT ?`, ...scrapedParams, limit)
        .catch((err) => { log.error('warrants/search-all: scraped query failed', { traceId }, err); return []; });
    }

    const allResults = [...local, ...utah, ...scraped];
    return c.json({
      local,
      utah,
      scraped,
      meta: {
        sources: [
          ...(local.length ? ['local'] : []),
          ...(utah.length ? ['utah'] : []),
          ...(scraped.length ? ['scraped'] : []),
        ],
        totalHits: allResults.length,
      },
    });
  } catch (err) {
    log.error('warrants/search-all failed', { traceId }, err instanceof Error ? err : new Error(String(err)));
    return c.json({ local: [], utah: [], scraped: [], meta: { sources: [], totalHits: 0 } });
  }
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

  // Local `warrants` has no state/jurisdiction column to filter on. A
  // state-only search (the coverage-map "click a state" flow — the 400
  // guard above only requires ONE of first_name/last_name/state) used to
  // fall through to zero WHERE clauses, i.e. `SELECT * FROM warrants` with
  // no filter at all — every local warrant, regardless of relevance, got
  // dumped into the results for whatever state was clicked. With nothing
  // to scope local rows to a state, skip the local table entirely rather
  // than return unrelated records.
  const local = localWhere.length
    ? (await query<Record<string, unknown>>(
        db, `SELECT * FROM warrants WHERE ${localWhere.join(' AND ')}`, ...localParams,
      ))
        .filter((row) => matchesDobOrAge(queryDob, { dob: (row.subject_dob as string) ?? null, age: null }))
        .map(mapLocalWarrantRow)
    : [];

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

// ============================================================
// Manual warrant CRUD — WarrantsPage.tsx's New/Edit Warrant form, serve,
// archive/unarchive, and delete actions. Registered after every other
// literal-path route in this file so a numeric warrant id can never shadow
// a named route like /watch/runs or /dashboard/stats (Hono's router is a
// radix trie and prioritizes static segments regardless of declaration
// order, but keeping /: routes last matches this file's existing style
// and stays correct even if that routing guarantee ever changes).
// ============================================================

const ALLOWED_WARRANT_COLUMNS = [
  'type', 'status', 'charge_description', 'subject_person_id',
  'subject_name', 'subject_first_name', 'subject_last_name', 'subject_dob',
  'issuing_court', 'issuing_judge', 'bail_amount', 'offense_level',
  'expires_at', 'notes', 'statute_id', 'statute_citation', 'priority',
] as const;

// GET /warrants/:id — single warrant detail for WarrantsPage's fetchWarrantDetail.
warrants.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    if (!row) return c.json({ error: 'Warrant not found' }, 404);
    return c.json(row);
  } catch (err) {
    console.error('[warrants] get by id error', err);
    return c.json({ error: 'Failed to load warrant' }, 500);
  }
});

// POST /warrants — create a manual warrant.
warrants.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const user = c.get('user') as { id?: number } | undefined;

    if (!body.type || typeof body.type !== 'string') {
      return c.json({ error: 'type is required' }, 400);
    }
    if (!body.charge_description || typeof body.charge_description !== 'string' || body.charge_description.trim().length < 3) {
      return c.json({ error: 'charge_description is required (min 3 chars)' }, 400);
    }

    let subjectName: string | null = null;
    if (body.subject_person_id) {
      const person = await queryFirst<{ first_name: string; last_name: string }>(
        db, 'SELECT first_name, last_name FROM persons WHERE id = ?', body.subject_person_id);
      if (person) subjectName = [person.first_name, person.last_name].filter(Boolean).join(' ');
    }

    const warrantNumber = `manual-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const result = await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, warrant_type, status,
         subject_person_id, subject_name,
         charge_description, offense, issuing_court, court, issuing_judge, judge,
         bail_amount, bond_amount, offense_level, expires_at, expiry_date, notes,
         statute_id, statute_citation, source, entered_by, created_by,
         created_at, updated_at
       ) VALUES (?, ?, ?, 'active',
         ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, 'manual', ?, ?,
         datetime('now'), datetime('now'))`,
      warrantNumber, body.type, body.type,
      body.subject_person_id ?? null, subjectName,
      body.charge_description, body.charge_description, body.issuing_court ?? null, body.issuing_court ?? null,
      body.issuing_judge ?? null, body.issuing_judge ?? null,
      body.bail_amount ?? null, body.bail_amount ?? null, body.offense_level ?? null,
      body.expires_at ?? null, body.expires_at ?? null, body.notes ?? null,
      body.statute_id ?? null, body.statute_citation ?? null,
      user?.id ?? null, user?.id ?? null,
    );

    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM warrants WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    console.error('[warrants] create error', err);
    return c.json({ error: 'Failed to create warrant' }, 500);
  }
});

// PUT /warrants/:id — partial update. Accepts any subset of
// ALLOWED_WARRANT_COLUMNS (WarrantsPage's edit form sends the full set;
// handleUpdateStatus sends just { status }).
warrants.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of ALLOWED_WARRANT_COLUMNS) {
      if (col in body) {
        sets.push(`${col} = ?`);
        params.push(body[col]);
      }
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400);
    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    await execute(db, `UPDATE warrants SET ${sets.join(', ')} WHERE id = ?`, ...params);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] update error', err);
    return c.json({ error: 'Failed to update warrant' }, 500);
  }
});

// PUT /warrants/:id/serve — mark a warrant served.
warrants.put('/:id/serve', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);

    const body = await c.req.json<{ served_location?: string | null }>().catch(() => ({} as { served_location?: string | null }));
    const user = c.get('user') as { id?: number } | undefined;

    await execute(
      db,
      `UPDATE warrants SET status = 'served', served_at = datetime('now'), service_date = datetime('now'),
         served_location = ?, served_by = ?, updated_at = datetime('now') WHERE id = ?`,
      body.served_location ?? null, user?.id ?? null, id,
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] serve error', err);
    return c.json({ error: 'Failed to mark warrant served' }, 500);
  }
});

// POST /warrants/:id/archive
warrants.post('/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    await execute(db, `UPDATE warrants SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[warrants] archive error', err);
    return c.json({ error: 'Failed to archive warrant' }, 500);
  }
});

// POST /warrants/:id/unarchive
warrants.post('/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    await execute(db, `UPDATE warrants SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?`, id);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] unarchive error', err);
    return c.json({ error: 'Failed to unarchive warrant' }, 500);
  }
});

// DELETE /warrants/:id
warrants.delete('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    await execute(db, 'DELETE FROM warrants WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[warrants] delete error', err);
    return c.json({ error: 'Failed to delete warrant' }, 500);
  }
});

// PUT /warrants/batch-update { ids: number[], status: string }
// WarrantsPage's batch status toolbar — the route never existed, so
// "Apply" always silently no-op'd (the button just showed a generic error).
warrants.put('/batch-update', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ ids?: number[]; status?: string }>();
    const ids = Array.isArray(body.ids) ? body.ids.map((n) => parseInt(String(n), 10)).filter(Number.isFinite) : [];
    const status = (body.status || '').trim();
    if (!ids.length || !status) return c.json({ error: 'ids and status required' }, 400);
    // D1 caps bound parameters at ~100/query — chunk so a selection over the
    // cap doesn't blow up the prepared statement and 500 the whole batch.
    let updated = 0;
    for (const chunk of chunkIds(ids)) {
      const placeholders = chunk.map(() => '?').join(',');
      await execute(
        db,
        `UPDATE warrants SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
        status, ...chunk,
      );
      updated += chunk.length;
    }
    return c.json({ success: true, updated });
  } catch (err) {
    console.error('[warrants] batch-update error', err);
    return c.json({ error: 'Batch update failed' }, 500);
  }
});

// POST /warrants/bulk-archive { warrant_ids: number[] }
// Same "never existed" gap as batch-update — reuses the archived_at column
// the single-warrant /:id/archive route already writes.
warrants.post('/bulk-archive', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ warrant_ids?: number[] }>();
    const ids = Array.isArray(body.warrant_ids) ? body.warrant_ids.map((n) => parseInt(String(n), 10)).filter(Number.isFinite) : [];
    if (!ids.length) return c.json({ error: 'warrant_ids required' }, 400);
    const rows: { id: number; archived_at: string | null }[] = [];
    for (const chunk of chunkIds(ids)) {
      const placeholders = chunk.map(() => '?').join(',');
      rows.push(...await query<{ id: number; archived_at: string | null }>(
        db, `SELECT id, archived_at FROM warrants WHERE id IN (${placeholders})`, ...chunk,
      ));
    }
    const toArchive = rows.filter((r) => !r.archived_at).map((r) => r.id);
    const skipped = rows.length - toArchive.length;
    for (const chunk of chunkIds(toArchive)) {
      const placeholders = chunk.map(() => '?').join(',');
      await execute(
        db,
        `UPDATE warrants SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id IN (${placeholders})`,
        ...chunk,
      );
    }
    return c.json({ archived: toArchive.length, skipped });
  } catch (err) {
    console.error('[warrants] bulk-archive error', err);
    return c.json({ error: 'Bulk archive failed' }, 500);
  }
});

// POST /warrants/bulk-review { warrant_ids: number[] }
// Stamps reviewed_at/reviewed_by (migration 0186) — same "never existed" gap.
warrants.post('/bulk-review', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ warrant_ids?: number[] }>();
    const ids = Array.isArray(body.warrant_ids) ? body.warrant_ids.map((n) => parseInt(String(n), 10)).filter(Number.isFinite) : [];
    if (!ids.length) return c.json({ error: 'warrant_ids required' }, 400);
    const user = c.get('user') as { id: number } | undefined;
    for (const chunk of chunkIds(ids)) {
      const placeholders = chunk.map(() => '?').join(',');
      await execute(
        db,
        `UPDATE warrants SET reviewed_at = datetime('now'), reviewed_by = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
        user?.id ?? null, ...chunk,
      );
    }
    return c.json({ reviewed: ids.length });
  } catch (err) {
    console.error('[warrants] bulk-review error', err);
    return c.json({ error: 'Bulk review failed' }, 500);
  }
});

// POST /warrants/ingest-utah { warrants: [{ utah_warrant_id, charges, court_name,
//   first_name, last_name, bail_amount, offense_level, case_id, issue_date }] }
// "Add to Local Records" from the Utah-source hit detail drawer — promotes a
// hit the operator is looking at into the canonical warrants records table.
// Idempotent on warrant_number so re-clicking doesn't create duplicates.
warrants.post('/ingest-utah', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<{ warrants?: any[] }>();
    const rows = Array.isArray(body.warrants) ? body.warrants : [];
    if (!rows.length) return c.json({ error: 'warrants required' }, 400);
    let inserted = 0;
    for (const w of rows) {
      const warrantNumber = w.utah_warrant_id || w.case_id || null;
      const subjectName = [w.first_name, w.last_name].filter(Boolean).join(' ').trim() || null;
      // SQLite's UNIQUE constraint permits multiple NULLs, so a warrant_number
      // lookup alone would let every re-click of a row with no identifier
      // insert a fresh duplicate. Fall back to subject_name + issue_date.
      const existing = warrantNumber
        ? await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE warrant_number = ?', warrantNumber)
        : subjectName
        ? await queryFirst<{ id: number }>(
            db, 'SELECT id FROM warrants WHERE warrant_number IS NULL AND subject_name = ? AND issued_date IS ?',
            subjectName, w.issue_date ?? null,
          )
        : null;
      if (existing) continue; // already ingested — idempotent no-op
      await execute(
        db,
        `INSERT INTO warrants (warrant_number, type, status, subject_name, offense, court, bond_amount, issued_date)
         VALUES (?, 'arrest', 'active', ?, ?, ?, ?, ?)`,
        warrantNumber, subjectName,
        Array.isArray(w.charges) ? w.charges.filter(Boolean).join('; ') : (w.charges || null),
        w.court_name ?? null, w.bail_amount ?? null, w.issue_date ?? null,
      );
      inserted++;
    }
    return c.json({ success: true, inserted, skipped: rows.length - inserted });
  } catch (err) {
    console.error('[warrants] ingest-utah error', err);
    return c.json({ error: 'Failed to ingest warrant' }, 500);
  }
});

// POST /warrants/check/:personId — "Run Check Now" in the person drawer.
// On-demand single-person Utah warrant check (see
// runUtahWarrantCheckForPerson's doc comment for why this can't just call
// the population-wide runUtahWarrantScan with a filter).
warrants.post('/check/:personId', async (c) => {
  try {
    const db = getDb(c.env);
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId) || personId <= 0) return c.json({ error: 'Invalid person id' }, 400);
    const result = await runUtahWarrantCheckForPerson(db, personId);
    return c.json({ success: true, ...result });
  } catch (err) {
    console.error('[warrants] check person error', err);
    return c.json({ error: 'Warrant check failed' }, 500);
  }
});

// GET /warrants/summary-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// Feeds WarrantSummaryData for the client-side PDF generator
// (generateWarrantSummaryPdf) — this route only aggregates; the PDF itself
// is built in the browser. bySeverity/bySource are scoped to what the local
// `warrants` records table actually carries (no severity column exists on
// it, and only ingested/local records count toward source counts — hits
// still living only in utah_warrants/scraped_warrants aren't "local" yet).
warrants.get('/summary-report', async (c) => {
  try {
    const db = getDb(c.env);
    const from = c.req.query('from') || null;
    const to = c.req.query('to') || null;
    const dateCol = 'issued_date';
    const where: string[] = [];
    const params: unknown[] = [];
    if (from) { where.push(`${dateCol} >= ?`); params.push(from); }
    if (to) { where.push(`${dateCol} <= ?`); params.push(to); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const topCourtsWhere = where.length
      ? `WHERE ${where.join(' AND ')} AND court IS NOT NULL`
      : 'WHERE court IS NOT NULL';

    const [byStatusRows, byTypeRows, topCourtsRows, newCountRow, clearedCountRow, latestRun] = await Promise.all([
      query<{ status: string; n: number }>(db, `SELECT status, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY status`, ...params),
      query<{ type: string; n: number }>(db, `SELECT type, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY type`, ...params),
      query<{ issuing_court: string; count: number }>(
        db,
        `SELECT court AS issuing_court, COUNT(*) AS count FROM warrants ${topCourtsWhere} GROUP BY court ORDER BY count DESC LIMIT 10`,
        ...params,
      ).catch(() => []),
      queryFirst<{ n: number }>(db, `SELECT COUNT(*) AS n FROM warrants ${whereClause}`, ...params),
      queryFirst<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM warrants WHERE archived_at IS NOT NULL ${from ? 'AND archived_at >= ?' : ''} ${to ? 'AND archived_at <= ?' : ''}`,
        ...(from ? [from] : []), ...(to ? [to] : []),
      ),
      query<{ persons_checked: number; new_warrants_found: number; warrants_cleared: number }>(
        db,
        `SELECT persons_checked, new_warrants_found, warrants_cleared FROM warrant_watch_runs
          WHERE started_at >= COALESCE(?, '0000-01-01') AND started_at <= COALESCE(?, '9999-12-31')`,
        from, to,
      ).catch(() => []),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of byStatusRows) byStatus[r.status] = r.n;
    const byType: Record<string, number> = {};
    for (const r of byTypeRows) byType[r.type] = r.n;
    const scanActivity = latestRun.reduce(
      (acc, r) => ({
        totalScans: acc.totalScans + 1,
        totalFound: acc.totalFound + (r.new_warrants_found ?? 0),
        totalCleared: acc.totalCleared + (r.warrants_cleared ?? 0),
      }),
      { totalScans: 0, totalFound: 0, totalCleared: 0 },
    );

    return c.json({
      period: { from, to },
      byStatus,
      byType,
      bySeverity: {},
      bySource: { local: newCountRow?.n ?? 0 },
      topCourts: topCourtsRows,
      newThisPeriod: newCountRow?.n ?? null,
      clearedThisPeriod: clearedCountRow?.n ?? null,
      scanActivity,
    });
  } catch (err) {
    console.error('[warrants] summary-report error', err);
    return c.json({ error: 'Failed to build summary report' }, 500);
  }
});

export default warrants;
