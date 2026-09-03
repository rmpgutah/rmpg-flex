// Warrants routes for the CF Worker. Surfaces warrant-watch run history plus
// the full manual-warrant CRUD lifecycle (get/create/update/serve/archive/
// unarchive/delete) consumed by WarrantsPage.tsx. The CRUD routes were
// historically deferred to "the legacy server" — but that VPS was
// decommissioned 2026-06-15 (see CLAUDE.md), so they have nowhere else to
// live. Every POST/PUT/DELETE the client sent 404'd until these were added.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, queryInChunks } from '../utils/db';
import { log, logErrorToDb } from '../utils/logger';
import { stateFromSourceKey } from '../utils/warrantSourceState';

// Per-table row cap for GET /unified. That route merges two heterogeneous tables
// in JS, so it cannot paginate purely in SQL — but it also must not read entire
// tables into a 128 MB isolate, which is what it did before (plain
// `SELECT * FROM warrants` / `FROM scraped_warrants`, no LIMIT). 5,000 per side
// is far above any realistic page depth (per_page maxes at 100) while keeping
// the isolate's memory bounded as scraped_warrants grows.
const UNIFIED_SCAN_CAP = 5000;
import { runUtahWarrantScan, runUtahWarrantCheckForPerson, fetchWarrantsForPerson, recordWarrant, MANUAL_RUN_WALL_BUDGET_MS } from '../utils/utahWarrantPoller';
import { runWarrantPersonIntel } from '../utils/personIntel/warrantPersonSearch';
import { confirmIdentity } from '../utils/identityConfirm';
import { screenPersonAllSources } from '../utils/screening/screenPerson';
import { getAllEnabledAdapters, ADAPTERS } from '../utils/warrantSources/registry';
import { US_STATES, matchesDobOrAge, mapScrapedWarrantRow, mapLocalWarrantRow } from '../utils/warrantNationalSearch';
import { containsClause } from '../utils/searchText';
import { rateLimitAllow } from '../utils/rateLimit';
import { requireRole } from '../middleware/auth';
import { isValidStatus, isValidTransition, TERMINAL_STATUSES, WARRANT_STATUSES, type WarrantStatus, applyLazyWarrantExpiry } from '../utils/warrantStatus';
import { denverDateExpr, denverNowDateExpr } from '../utils/denverTime';

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

    // Lazy auto-expiry: flip any overdue-active row on this page to
    // 'expired' before responding, so the list never shows a stale status.
    await applyLazyWarrantExpiry(db, rows);

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
// FIRE-AND-FORGET: a full scan paces ~8s/person, so it cannot be awaited inside
// the request. We hand it to executionCtx.waitUntil and return 202; the UI polls
// /watch/runs to observe the run row complete.
//
// ⚠️ waitUntil() extends a request by only 30 SECONDS (Cloudflare limit) — it is
// NOT the same budget as the cron's 15 minutes, despite "same async pattern as
// the cron" in the old comment here. A run pacing ~80s+ was therefore killed
// every single time, orphaning its warrant_watch_runs row as 'running' forever
// (three such rows inside three minutes in live D1 on 2026-07-30 — an operator
// clicking this button). So pass the SHORT manual budget: the run does a real,
// honestly-finalized slice inside the 30s window and its cursor resumes the rest
// on the next cron tick, instead of pretending to start a full scan it cannot
// possibly finish.
warrants.post('/watch/scan', async (c) => {
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runUtahWarrantScan(db, { wallBudgetMs: MANUAL_RUN_WALL_BUDGET_MS }).catch((err) => {
      console.error('[warrants] manual scan failed:', err);
    }),
  );
  return c.json({
    success: true,
    started: true,
    message: 'Scan started; poll /watch/runs for completion. Large rosters continue on the next scheduled tick.',
  }, 202);
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

/**
 * The Watch List tab's payload — the nested shape `WarrantsPage.tsx`'s
 * `AutoPollStatus` interface actually reads.
 *
 * ⚠️ WHY THIS EXISTS. `buildUtahStatus` returns a FLAT object (`lastSync`,
 * `lastPersonsChecked`, `activeWarrants`, …). The Watch List tab reads
 * `res.syncStatus.lastSync`, `res.totalPersons`, `res.runs`,
 * `res.flaggedPersons` and `res.recentHits` — NONE of which that payload
 * contains. Every one resolved to `undefined`.
 *
 * The client normalizes with `?? []` / `?? 0` / `?? {lastSync: null}` to avoid
 * `undefined.length` crashes. Reasonable instinct, but it converted a TOTAL
 * contract mismatch into a confident, plausible "empty but working" tab — which
 * is why this survived so long. Verified live 2026-07-31: the tab reported
 * "PERSONS MONITORED 0", "WARRANT HITS 0", "LAST SCAN: Never" and a completely
 * blank body, immediately after a run that checked 83 people and found 37
 * warrants. A crash would have been fixed in a day; a calm zero was not.
 *
 * Backwards compatibility matters here: `/utah/sync-status` and
 * `/scraped/status` read the FLAT keys. So the response is a SUPERSET — flat
 * keys retained verbatim, nested watch-tab keys added alongside.
 */
async function buildWatchTabPayload(c: Context<Env>) {
  const db = getDb(c.env);

  const runs = await query<Record<string, any>>(
    db, 'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 20');

  // The roster the poller actually scans — same eligibility the poller uses
  // (a named person row). This is "how many people are we watching", which is
  // what the tile claims to show.
  const personsRow = await queryFirst<{ n: number }>(
    db, `SELECT COUNT(*) AS n FROM persons
          WHERE first_name IS NOT NULL AND first_name != ''
            AND last_name  IS NOT NULL AND last_name  != ''`);

  // Distinct people with a live Utah hit, newest first.
  const flagged = await query<Record<string, any>>(
    db, `SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.race, p.height,
                p.weight, p.hair_color, p.eye_color, p.address, p.photo_url,
                COUNT(uw.id) AS utah_hit_count,
                MAX(uw.last_seen_at) AS last_hit_at
           FROM utah_warrants uw
           JOIN persons p ON p.id = uw.person_id
          WHERE uw.is_active = 1 AND uw.person_id IS NOT NULL
          GROUP BY p.id
          ORDER BY last_hit_at DESC
          LIMIT 100`);

  // Per-person Utah warrant detail for the flagged cards + the BOLO packet.
  // Bounded by the LIMIT 100 above, so the IN-list is capped well under D1's
  // 100-bound-parameter ceiling — but routed through chunking anyway so a future
  // LIMIT increase cannot silently break it (CLAUDE.md).
  const flaggedIds = flagged.map((f) => Number(f.id));
  const utahByPerson = new Map<number, Record<string, any>[]>();
  if (flaggedIds.length > 0) {
    const detail = await queryInChunks<Record<string, any>>(
      db,
      flaggedIds,
      (ph) => `SELECT person_id, utah_warrant_id, charges, court_name, issue_date, city, age
                 FROM utah_warrants
                WHERE is_active = 1 AND person_id IN (${ph})`,
    );
    for (const d of detail) {
      const list = utahByPerson.get(Number(d.person_id));
      if (list) list.push(d); else utahByPerson.set(Number(d.person_id), [d]);
    }
  }

  const flaggedPersons = flagged.map((f) => ({
    ...f,
    // A hit on a person with no local DOB could not be age-confirmed by the
    // poller, so it is a possible namesake — surfaced as a lead, not a match.
    unverified: !f.dob,
    warrant_severity: null,
    local_warrant_count: 0,
    warrants: [],
    utahWarrants: utahByPerson.get(Number(f.id)) ?? [],
  }));

  // Recent watch-log events feed the tab's hit list.
  let recentHits: Record<string, any>[] = [];
  try {
    recentHits = await query<Record<string, any>>(
      db, `SELECT id, person_id, person_name, event, charges, court_name, created_at
             FROM warrant_watch_log ORDER BY created_at DESC LIMIT 50`);
  } catch {
    // warrant_watch_log absent pre-migration — an empty hit list is honest here.
  }

  const latest = runs[0] ?? null;
  const flat = await buildUtahStatus(c);

  return {
    ...flat,
    // Nested shape the Watch List tab reads.
    syncStatus: {
      lastSync: latest ? latest.completed_at ?? latest.started_at : null,
      warrantCount: flat.activeWarrants,
      status: latest ? latest.status : 'unknown',
      lastError: latest ? latest.error_message ?? null : null,
    },
    blocked: false,
    runs,
    flaggedPersons,
    recentHits,
    totalPersons: personsRow?.n ?? 0,
  };
}

// All three resolve to the same rich status (see buildUtahStatus).
const EMPTY_STATUS = {
  lastSync: null, lastStatus: null, lastPersonsChecked: 0, lastNewWarrants: 0,
  lastWarrantsCleared: 0, lastErrors: 0, activeWarrants: 0,
  nextScheduledRun: null, isRunning: false, enabled: true, polling: false,
  lastRunAt: null, lastRunStatus: null,
  // Nested keys included so a degraded response still satisfies the Watch
  // List tab's shape rather than making it fall back to its own defaults.
  syncStatus: { lastSync: null, warrantCount: 0, status: 'unknown', lastError: null },
  blocked: false, runs: [], flaggedPersons: [], recentHits: [], totalPersons: 0,
};
for (const path of ['/utah/sync-status', '/utah-search/auto-poll-status', '/scraped/status']) {
  warrants.get(path, async (c) => {
    try {
      // The Watch List tab polls /utah-search/auto-poll-status and needs the
      // nested payload; the other two only read the flat keys, which are a
      // subset of it. One builder keeps all three from drifting apart.
      return c.json(
        path === '/utah-search/auto-poll-status'
          ? await buildWatchTabPayload(c)
          : await buildUtahStatus(c),
      );
    } catch (err) {
      log.error('[warrants] utah status build failed', { route: `GET /warrants${path}` }, err as Error);
      // Pre-migration / table-missing → harmless empty status.
      return c.json(EMPTY_STATUS);
    }
  });
}

// POST /warrants/person-intel — PersonIntelPanel live search.
// Identity-gated: when DOB/age is supplied, only the matching namesake is returned.
warrants.post('/person-intel', async (c) => {
  try {
    const body = await c.req.json<{
      firstName?: string; lastName?: string; dob?: string; age?: number | string; city?: string; state?: string;
    }>();
    const firstName = String(body.firstName ?? '').trim();
    const lastName = String(body.lastName ?? '').trim();
    if (!firstName || !lastName) return c.json({ error: 'firstName and lastName are required' }, 400);
    const age = body.age != null && body.age !== '' ? Number(body.age) : undefined;
    const result = await runWarrantPersonIntel(getDb(c.env), {
      firstName, lastName, dob: body.dob?.trim() || undefined,
      age: Number.isFinite(age) ? age : undefined,
      city: body.city?.trim() || undefined,
      state: body.state?.trim() || undefined,
    });
    return c.json(result);
  } catch (err) {
    log.error('warrants person-intel failed', {}, err instanceof Error ? err : undefined);
    return c.json({ error: 'Person intel search failed' }, 500);
  }
});

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

    // Require at least one meaningful filter — a completely empty body would run
    // SELECT * against all three tables with no WHERE clause and return up to
    // 1,500 rows, burning DB budget and leaking the full warrant roster.
    const hasAnyFilter = body.lastName || body.firstName || body.dob
      || body.courtName || body.charge || body.caseNumber
      || body.status || body.type || body.offenseLevel
      || body.dateFrom || body.dateTo;
    if (!hasAnyFilter) {
      return c.json({ error: 'At least one search filter is required.' }, 400);
    }

    // Per-user rate limit on live Utah API fetches. Each search-all with a
    // first+last name fires a real HTTP call to warrants.utah.gov. Excessive
    // calls risk RMPG's IP being flagged by their CloudFront WAF — which would
    // take warrant checks down completely. Cap at 20 live fetches per user per
    // 5 minutes. Fail-open (KV outage allows the call through).
    const UTAH_LIVE_LIMIT = 20;
    const UTAH_LIVE_WINDOW_S = 300;
    const userId = c.get('userId') as number | undefined;

    // Per-bucket ceiling — unlimited in the sense that all matching warrants are
    // returned, but bounded to protect the isolate's 128 MB memory limit. 500 per
    // source is far above any realistic result set for a name/DOB search.
    const SEARCH_LIMIT = 500;

    // Each source table has its own column names — there's no shared schema
    // to build one WHERE clause from. `warrants` only has a combined
    // subject_name (no first/last split) and no case_number column at all;
    // `utah_warrants` has no dob/status/type/offense_level columns at all
    // (status there is the separate is_active flag, not comparable to the
    // local/scraped status vocabulary) — only date-range applies to it;
    // `scraped_warrants` supports every filter (using date_of_birth, not dob).
    //
    // All text-contains clauses use containsClause() (instr-based) instead of
    // raw LIKE patterns. D1 caps LIKE pattern length at 50 chars — a charge
    // description or long name would produce "LIKE or GLOB pattern too complex"
    // at runtime. instr() has no such limit and is safe at any input length.
    const localConditions: string[] = [];
    const localParams: unknown[] = [];
    if (body.lastName) { const c = containsClause('subject_name'); localConditions.push(c.sql); localParams.push(c.bind(body.lastName)); }
    if (body.firstName) { const c = containsClause('subject_name'); localConditions.push(c.sql); localParams.push(c.bind(body.firstName)); }
    if (body.dob) { localConditions.push('subject_dob = ?'); localParams.push(body.dob); }
    if (body.courtName) { const c = containsClause('issuing_court'); localConditions.push(c.sql); localParams.push(c.bind(body.courtName)); }
    if (body.charge) { const c = containsClause('charge_description'); localConditions.push(c.sql); localParams.push(c.bind(body.charge)); }
    if (body.status) { localConditions.push('status = ?'); localParams.push(body.status); }
    if (body.type) { localConditions.push('type = ?'); localParams.push(body.type); }
    if (body.offenseLevel) { localConditions.push('offense_level = ?'); localParams.push(body.offenseLevel); }
    if (body.dateFrom) { localConditions.push('issued_date >= ?'); localParams.push(body.dateFrom); }
    if (body.dateTo) { localConditions.push('issued_date <= ?'); localParams.push(body.dateTo); }
    const localWhere = localConditions.length ? `WHERE ${localConditions.join(' AND ')}` : '';

    const utahConditions: string[] = [];
    const utahParams: unknown[] = [];
    if (body.lastName) { const c = containsClause('last_name'); utahConditions.push(c.sql); utahParams.push(c.bind(body.lastName)); }
    if (body.firstName) { const c = containsClause('first_name'); utahConditions.push(c.sql); utahParams.push(c.bind(body.firstName)); }
    if (body.courtName) { const c = containsClause('court_name'); utahConditions.push(c.sql); utahParams.push(c.bind(body.courtName)); }
    if (body.dateFrom) { utahConditions.push('issue_date >= ?'); utahParams.push(body.dateFrom); }
    if (body.dateTo) { utahConditions.push('issue_date <= ?'); utahParams.push(body.dateTo); }
    const utahWhere = utahConditions.length ? `WHERE ${utahConditions.join(' AND ')}` : '';

    const scrapedConditions: string[] = [];
    const scrapedParams: unknown[] = [];
    if (body.lastName) { const c = containsClause('last_name'); scrapedConditions.push(c.sql); scrapedParams.push(c.bind(body.lastName)); }
    if (body.firstName) { const c = containsClause('first_name'); scrapedConditions.push(c.sql); scrapedParams.push(c.bind(body.firstName)); }
    if (body.dob) { scrapedConditions.push('date_of_birth = ?'); scrapedParams.push(body.dob); }
    if (body.courtName) { const c = containsClause('court_name'); scrapedConditions.push(c.sql); scrapedParams.push(c.bind(body.courtName)); }
    if (body.charge) { const c = containsClause('charge_description'); scrapedConditions.push(c.sql); scrapedParams.push(c.bind(body.charge)); }
    if (body.caseNumber) { const c = containsClause('case_number'); scrapedConditions.push(c.sql); scrapedParams.push(c.bind(body.caseNumber)); }
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

    // The `utah_warrants` table is only a CACHE populated by the background
    // cron poller. A name typed into Search All that isn't already a local D1
    // person the cron polled would silently return zero Utah hits even when the
    // live API has real data for that name. When both first and last name are
    // given, run a live on-demand check first so freshly-found warrants are
    // persisted into utah_warrants BEFORE the cache SELECT below runs —
    // the subsequent query then naturally includes them via the upsert.
    //
    // Rate-safeguard: the live fetch hits warrants.utah.gov with the same
    // 15 s timeout + Chrome UA already used by the cron poller. This is a
    // single targeted name lookup (not a broad roster scan), so one live call
    // per Search-All submission does not risk IP blockage. The cron's 8 s
    // inter-person sleep is for bulk roster sweeps — it does not apply here.
    if (wantUtah && body.firstName && body.lastName) {
      // Gate the live API call behind the per-user rate limit. A KV outage
      // fails open (rateLimitAllow returns true) so a brief KV blip never
      // blocks a legitimate warrant check.
      const liveFetchAllowed = userId == null || await rateLimitAllow(
        c.env.KV, `warrant-live-fetch:${userId}`, UTAH_LIVE_LIMIT, UTAH_LIVE_WINDOW_S,
      );
      if (!liveFetchAllowed) {
        log.warn('warrants/search-all: live Utah fetch rate-limited', { userId, traceId });
      } else {
        try {
          const liveWarrants = await fetchWarrantsForPerson({
            id: 0,
            first_name: body.firstName,
            middle_name: null,
            last_name: body.lastName,
            dob: body.dob ?? null,
          });
          for (const w of liveWarrants) await recordWarrant(db, w, null);
        } catch (err) {
          log.error('warrants/search-all: live utah fetch failed', { traceId },
            err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    const [local, utahRaw] = await Promise.all([
      wantLocal
        ? query<Record<string, unknown>>(db, `SELECT * FROM warrants ${localWhere} LIMIT ?`, ...localParams, SEARCH_LIMIT)
            .catch((err) => { log.error('warrants/search-all: local query failed', { traceId }, err); return []; })
        : Promise.resolve([]),
      wantUtah
        ? query<Record<string, unknown>>(db, `SELECT * FROM utah_warrants ${utahWhere} LIMIT ?`, ...utahParams, SEARCH_LIMIT)
            .catch((err) => { log.error('warrants/search-all: utah query failed', { traceId }, err); return []; })
        : Promise.resolve([]),
    ]);

    // DOB/age post-filter on the Utah cache — the utah_warrants table stores
    // `age` (a number) but has no `dob` column, so a DOB in the search body
    // cannot be applied as a SQL predicate. Apply matchesDobOrAge() in memory
    // so a DOB-only or name+DOB search correctly rejects age-mismatched
    // namesakes from the cache rather than returning every John Smith on file.
    const utah = body.dob
      ? utahRaw.filter((row) =>
          matchesDobOrAge(body.dob!, {
            dob: null,
            age: typeof row.age === 'number' ? row.age : null,
          })
        )
      : utahRaw;

    // Only query scraped_warrants when there's a meaningful filter (not dob-only)
    const hasScrapedFilter = body.lastName || body.firstName || body.courtName || body.charge || body.caseNumber
      || body.status || body.type || body.offenseLevel || body.dateFrom || body.dateTo;
    let scraped: Record<string, unknown>[] = [];
    if (wantScraped && hasScrapedFilter) {
      scraped = await query<Record<string, unknown>>(db, `SELECT * FROM scraped_warrants ${scrapedWhere} LIMIT ?`, ...scrapedParams, SEARCH_LIMIT)
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
  if (body.first_name) { const cl = containsClause('first_name'); scrapedWhere.push(cl.sql); scrapedParams.push(cl.bind(body.first_name)); }
  if (body.last_name) { const cl = containsClause('last_name'); scrapedWhere.push(cl.sql); scrapedParams.push(cl.bind(body.last_name)); }
  if (body.state) { scrapedWhere.push('UPPER(state) = ?'); scrapedParams.push(body.state.toUpperCase()); }
  if (body.offense_level) { scrapedWhere.push('UPPER(offense_level) = ?'); scrapedParams.push(body.offense_level.toUpperCase()); }
  if (body.warrant_type) { scrapedWhere.push('UPPER(warrant_type) = ?'); scrapedParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { const cl = containsClause('charge_description'); scrapedWhere.push(cl.sql); scrapedParams.push(cl.bind(body.charge_keyword)); }

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
  if (body.first_name) { const cl = containsClause('subject_first_name'); localWhere.push(cl.sql); localParams.push(cl.bind(body.first_name)); }
  if (body.last_name) { const cl = containsClause('subject_last_name'); localWhere.push(cl.sql); localParams.push(cl.bind(body.last_name)); }
  if (body.offense_level) { localWhere.push('UPPER(offense_level) = ?'); localParams.push(body.offense_level.toUpperCase()); }
  if (body.warrant_type) { localWhere.push('UPPER(type) = ?'); localParams.push(body.warrant_type.toUpperCase()); }
  if (body.charge_keyword) { const cl = containsClause('charge_description'); localWhere.push(cl.sql); localParams.push(cl.bind(body.charge_keyword)); }

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
        db, `SELECT * FROM warrants WHERE ${localWhere.join(' AND ')} LIMIT 500`, ...localParams,
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
/**
 * Normalize an offense-severity value to the canonical word the scorer keys off.
 *
 * ⚠️ Live data does NOT spell these out. Measured 2026-07-31 over 100 unified
 * rows: `offense_level` was NULL on **100 of 100**, while the severity actually
 * sat in `type` as single-letter NCIC-style codes — `'M'` x93, `'F'` x7.
 * `computePriorityScore` compared against the literal strings 'FELONY' /
 * 'MISDEMEANOR', so `base` ALWAYS fell through to its 20 default and the only
 * live term left was `bail > 10_000` — which matched exactly those same 7 rows.
 * The result was a "priority score" that was really just a bail flag: every row
 * scored 20 or 30, and priorityBucket() rendered LOW for all of them.
 */
export function normalizeOffenseLevel(raw: unknown): 'FELONY' | 'MISDEMEANOR' | 'INFRACTION' | 'CIVIL' | null {
  const v = String(raw ?? '').trim().toUpperCase();
  if (!v) return null;
  // Spelled-out forms first (local/manual records use these).
  if (v.startsWith('FELON')) return 'FELONY';
  if (v.startsWith('MISD')) return 'MISDEMEANOR';
  if (v.startsWith('INFRAC')) return 'INFRACTION';
  if (v.startsWith('CIVIL')) return 'CIVIL';
  // Single-letter / short codes — the shape scraped sources actually emit.
  // Anchored to the whole token so a warrant TYPE like 'FTA' or a charge string
  // can't be misread as a felony off its first letter.
  if (v === 'F' || v === 'FEL') return 'FELONY';
  if (v === 'M' || v === 'MIS' || v === 'MISD') return 'MISDEMEANOR';
  if (v === 'I' || v === 'INF') return 'INFRACTION';
  if (v === 'C' || v === 'CIV') return 'CIVIL';
  return null;
}

/**
 * Priority score, 0-100, bucketed by the client as
 * >=90 critical / >=70 high / >=40 medium / else low.
 *
 * Weights are a judgment call for warrant SERVICE prioritization, not derived
 * from an external standard. The reasoning:
 *
 *  - Severity dominates (base 60/30/10/5). What the person is wanted for is the
 *    single most important input, so it sets the band and the other terms move
 *    within it. A felony starts at 60 = "high" before anything else applies.
 *  - Severity is read from `offense_level` OR, when that is null (which is every
 *    live row today), from `type`, which is where scraped sources put the M/F
 *    code. Falling back to a neutral 20 when severity is genuinely unknown is
 *    deliberate: an unknown charge must not silently outrank a known felony.
 *  - Age matters and previously did not count at all. Live warrants span 305 to
 *    10,169 days outstanding; a 27-year-old warrant scored identically to a
 *    10-month-old one. Long-outstanding warrants are the ones that never get
 *    served, so age adds up to 15 — enough to lift a stale misdemeanor toward
 *    review, never enough to push it past a fresh felony.
 *  - Service attempts add up to 20: repeated failed attempts mean the subject is
 *    evading, which is exactly what should escalate. (Dead for scraped rows,
 *    which carry no attempt count — real for local records.)
 *  - Imminent expiry adds 15: a warrant about to lapse is use-it-or-lose-it.
 *  - High bail adds 10 as a weak proxy for court-assessed seriousness. It stays
 *    LAST and smallest on purpose — it was accidentally the ONLY live signal
 *    before this fix, and bail correlates with means as much as with risk.
 */
export function computePriorityScore(row: Record<string, any>): number {
  // offense_level is authoritative when present; `type` carries the M/F code on
  // scraped rows, which is the only place severity lives in live data today.
  const level = normalizeOffenseLevel(row.offense_level) ?? normalizeOffenseLevel(row.type);
  const base = level === 'FELONY' ? 60
    : level === 'MISDEMEANOR' ? 30
    : level === 'INFRACTION' ? 10
    : level === 'CIVIL' ? 5
    : 20; // severity unknown — neutral, must not outrank a known felony

  const bail = Number(row.bail_amount) || 0;
  const attempts = Number(row.service_attempt_count) || 0;

  // Age of the WARRANT (issued_date, with created_at as the documented
  // fallback) — same source the AGE column uses, so the two cannot disagree.
  const ageDays = ageDaysFrom(row.issued_date ?? row.created_at);
  // CONTINUOUS, not banded. An earlier version used three steps (5/10/15 at
  // 6mo/1y/3y) and measured live that produced a useless distribution: nearly
  // every warrant in this dataset is 3+ years old, so they ALL collected the same
  // 15 and **64 of 100 rows landed on the identical score of 45**. No bucket
  // threshold can separate a cluster sitting on one value — the banding itself
  // created the tie.
  //
  // Ramping linearly to a 10-year ceiling instead means a 20-year-old warrant
  // genuinely outranks a 4-year-old one, which is the ordering a service queue
  // consumes (it sorts by score; the chip label is secondary). Still capped at 15
  // so age can never overtake severity: a maximally stale misdemeanor (30+15=45)
  // stays below a fresh felony (60).
  const STALENESS_MAX = 15;
  const STALENESS_RAMP_DAYS = 3650; // 10 years to reach the ceiling
  const staleness = ageDays == null
    ? 0
    : Math.min(STALENESS_MAX, (ageDays / STALENESS_RAMP_DAYS) * STALENESS_MAX);

  let urgency = 0;
  const expiresAt = row.expires_at;
  if (expiresAt) {
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    if (Number.isFinite(days) && days >= 0 && days <= 7) urgency = 15;
  }

  // Rounded because `staleness` is now continuous: the score is rendered directly
  // and compared against integer bucket thresholds, so a fractional value would
  // leak decimals into the UI and make boundary behaviour hard to reason about.
  return Math.round(Math.min(
    100,
    base + Math.min(attempts * 5, 20) + staleness + urgency + (bail > 10_000 ? 10 : 0),
  ));
}

function ageDaysFrom(createdAt: unknown): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt as string).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

/**
 * SQL for the "Hits Today" tile.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * This previously counted `date(last_seen_at) = date('now')`, which had two
 * independent defects:
 *
 *   1. `last_seen_at` is refreshed every time the poller re-observes a warrant,
 *      so it counted "warrants the poller looked at today" — i.e. all of them.
 *      On 2026-07-24 the tile read 44, exactly equal to Active Warrants.
 *   2. `date('now')` is UTC. At 19:28 Denver it is already tomorrow in UTC, so
 *      the window rolled over mid-evening, every day.
 *
 * Note that fixing (2) alone would NOT have fixed the tile: bucketed into
 * Denver, `last_seen_at` still returns 44. They had to be fixed separately.
 *
 * ── The definition in force ─────────────────────────────────────────────────
 * A "hit today" = a warrant record FIRST discovered during today's Denver
 * calendar day. On the live data that is 9, versus 44 before.
 *
 * ── Changing it ─────────────────────────────────────────────────────────────
 * This is an operational definition, not a technical one. If "hit" should mean
 * something else for RMPG — only warrants matched to a known person, only
 * confirmed (DOB-verified) matches, or every re-confirmation — this function is
 * the single place to change it. `utah_warrants` offers: `first_seen_at`,
 * `last_seen_at`, `fetched_at`, `issue_date`, `is_active`, `person_id`,
 * `source`.
 */
function hitsTodaySql(): string {
  return `SELECT COUNT(*) AS n FROM utah_warrants
           WHERE ${denverDateExpr('first_seen_at')} = ${denverNowDateExpr()}`;
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
    const hitsToday = await safeCount(hitsTodaySql());
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
    // Was a 200 with every stat zeroed. On a warrants dashboard that renders as
    // "ACTIVE WARRANTS 0 / SOURCES 0/0" with a calm LED — a DB failure presented
    // as an all-clear, and indistinguishable from a genuinely quiet jurisdiction.
    // Same silent-empty class as GET /unified. Fail loudly instead; the client
    // already renders '-' when dashStats is absent.
    const traceId = c.get('traceId');
    log.error('[warrants] dashboard/stats failed', { route: 'GET /warrants/dashboard/stats', traceId }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'GET /warrants/dashboard/stats' },
      traceId,
      source: 'GET /warrants/dashboard/stats',
      statusCode: 500,
    }, c.executionCtx);
    return c.json({ error: 'Failed to load warrant dashboard stats' }, 500);
  }
});

// GET /dashboard/priority — top 20 active local warrants by computed
// priority_score, for the WarrantsPage dashboard's priority list widget.
warrants.get('/dashboard/priority', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, any>>(db, `SELECT * FROM warrants WHERE status = 'active' LIMIT 500`);
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
      db, `SELECT expires_at FROM warrants WHERE status = 'active'`,
    );
    const now = Date.now();
    const count = rows.filter((row) => {
      const exp = row.expires_at;
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
    const watchedOnly = c.req.query('watched_only') === '1';
    let watchedWarrantIds: Set<number> = new Set();
    if (watchedOnly) {
      const userId = (c.get('user') as { id?: number } | undefined)?.id;
      if (userId) {
        const watched = await query<{ entity_id: number }>(db,
          `SELECT entity_id FROM intel_watchlist WHERE entity_type = 'warrant' AND added_by = ? AND active = 1`,
          userId);
        watchedWarrantIds = new Set(watched.map((w) => w.entity_id));
      }
    }

    // Both reads were `SELECT * FROM <table>` with NO LIMIT — the whole of both
    // tables was pulled into the isolate and then filtered/sorted/paginated in
    // JS, so pagination was cosmetic: the full cost was paid before the first
    // row was skipped. Push the filters that survive a cross-table merge down
    // into SQL, and cap each side.
    //
    // The merge, derived fields (priority/age/source_state) and final sort stay
    // in JS on purpose — they span two heterogeneous tables and cannot be
    // expressed as one D1 statement. But they no longer start from everything.
    //
    // These WHERE clauses are built from a FIXED set of scalar filters, never
    // from a caller-supplied array, so there is no IN-list and no exposure to
    // D1's 100-bound-parameter cap. If you add an IN filter here, route it
    // through queryInChunks/chunkBindings (see CLAUDE.md).
    const localWhere: string[] = [];
    const localBinds: unknown[] = [];
    if (!includeArchived) localWhere.push('archived_at IS NULL');
    if (status) { localWhere.push('status = ?'); localBinds.push(status); }
    if (type) { localWhere.push('type = ?'); localBinds.push(type); }
    if (personId) { localWhere.push('subject_person_id = ?'); localBinds.push(personId); }
    const localSql = `SELECT * FROM warrants${localWhere.length ? ` WHERE ${localWhere.join(' AND ')}` : ''} LIMIT ${UNIFIED_SCAN_CAP}`;

    const localRows = await query<Record<string, any>>(db, localSql, ...localBinds);
    let merged: Record<string, any>[] = localRows.map((row) => ({
      ...row,
      source: row.source ?? 'local',
      source_state: null,
    }));

    try {
      // scraped_warrants has no archived_at/subject_person_id, so only the
      // filters it genuinely supports are pushed down.
      const scrapedWhere: string[] = [];
      const scrapedBinds: unknown[] = [];
      if (status) { scrapedWhere.push('status = ?'); scrapedBinds.push(status); }
      const scrapedSql = `SELECT * FROM scraped_warrants${scrapedWhere.length ? ` WHERE ${scrapedWhere.join(' AND ')}` : ''} LIMIT ${UNIFIED_SCAN_CAP}`;
      const scrapedRows = await query<Record<string, any>>(db, scrapedSql, ...scrapedBinds);
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
        // ── Fields the reshape used to DROP ─────────────────────────────────
        // issued_date: omitted entirely before, even though issue_date is read
        // one line up as a created_at fallback. Its absence meant age_days fell
        // back to the batch-insert time, so the AGE column read the SAME value
        // ('8w') on every row in production, and the DATE column was blank for
        // every scraped warrant.
        issued_date: row.issue_date ?? row.issued_date ?? null,
        // last_scrape_at: never carried, so the client's freshnessClass(null)
        // always returned 'manual' and the FRESHNESS column rendered the same
        // pencil icon on every row. This gives that column a real input.
        last_scrape_at: row.fetched_at ?? row.last_scrape_at ?? null,
      }));
      merged = merged.concat(reshaped);
    } catch { /* scraped_warrants missing on this env — local-only unified list */ }

    // Last-scrape time PER SOURCE, for the FRESHNESS column.
    //
    // Verified live 2026-07-31: scraped_warrants.fetched_at is NULL on every row
    // (created_at falls all the way through to issue_date, e.g. "9/9/2015"), so a
    // per-row scrape timestamp does not exist to read. Freshness of a scraped
    // record is really a property of ITS SOURCE — when did we last pull that
    // jurisdiction — and scraper_runs is the authoritative record of that. One
    // grouped query, so this stays O(1) queries regardless of row count.
    const lastScrapeBySource = new Map<string, string>();
    try {
      const scrapeRows = await query<{ source_key: string; last_started: string }>(
        db, `SELECT source_key, MAX(started_at) AS last_started FROM scraper_runs GROUP BY source_key`,
      );
      for (const r of scrapeRows) {
        if (r.last_started) lastScrapeBySource.set(r.source_key, r.last_started);
      }
    } catch {
      // scraper_runs absent on this env — FRESHNESS degrades to 'manual', which
      // is the honest reading when we have no scrape history at all.
    }

    merged = merged.map((row) => {
      const priority_score = computePriorityScore(row);
      // Age is the age of the WARRANT, not of our database row. This used to read
      // created_at (batch insert / fetched_at), which is identical across a whole
      // scrape batch — hence the AGE column showing '8w' on every row in
      // production. created_at stays as an explicit last-resort fallback.
      const age_days = ageDaysFrom(row.issued_date ?? row.created_at);
      const matches_person = row.subject_person_id != null;
      // Single authority: src/utils/warrantSourceState.ts. The inline regex that
      // used to live here was prefix-anchored and resolved NOTHING for any live
      // source key ('ada-county-id' etc.), so ?state= filtered on a null.
      const source_state = row.source_state
        ?? (row.source && row.source !== 'local' ? stateFromSourceKey(row.source) : null);
      // WarrantsListTab renders freshnessIcon(freshnessClass(w.freshness_days)) —
      // a field this route never computed, so it was always undefined,
      // freshnessClass fell through to 'manual', and the FRESHNESS column showed
      // the same pencil icon on every row. Derived here (rather than in the
      // client) so there is one definition of "how stale is this record".
      // Falls back to the row's SOURCE last-scrape time, because scraped rows
      // carry no timestamp of their own (fetched_at is NULL live). null stays
      // null and legitimately means "manually entered, never scraped".
      const rowLastScrape = row.last_scrape_at
        ?? (row.source ? lastScrapeBySource.get(String(row.source)) ?? null : null);
      const freshness_days = ageDaysFrom(rowLastScrape);
      return { ...row, priority_score, age_days, freshness_days, matches_person, source_state, last_scrape_at: rowLastScrape };
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
      if (watchedOnly && !watchedWarrantIds.has(Number(row.id))) return false;
      return true;
    });

    const sortKeyMap: Record<string, string> = {
      created_at: 'created_at', updated_at: 'updated_at', warrant_number: 'warrant_number',
      type: 'type', status: 'status', subject_name: 'subject_name',
      // Was `issued_date: 'created_at'` — asking to sort by issue date silently
      // sorted by row-insert date instead. A wrong answer with no error, and
      // indistinguishable from a correct one in the UI. Now sorts by issue date,
      // which the reshape above finally carries.
      issued_date: 'issued_date',
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
    // Was `return c.json({ warrants: [], total: 0 })` with a 200 — a DB failure
    // was indistinguishable from "this jurisdiction has no warrants", which on a
    // warrants screen is the most dangerous possible lie. The 2026-07-21 rebuild
    // removed this pattern from GET / but never from here.
    const traceId = c.get('traceId');
    log.error('[warrants] unified failed', { route: 'GET /warrants/unified', traceId }, err as Error);
    logErrorToDb(c.env.DB, {
      severity: 'error',
      category: 'route',
      message: err instanceof Error ? err.message : String(err),
      details: { route: 'GET /warrants/unified' },
      traceId,
      source: 'GET /warrants/unified',
      statusCode: 500,
    }, c.executionCtx);
    return c.json({ error: 'Failed to load unified warrant list' }, 500);
  }
});

// ── Literal paths that MUST precede /:id ─────────────────────────────────────
// Both of these were registered BELOW warrants.get('/:id') and were therefore
// DEAD in production: GET /warrants/summary-report and PUT /warrants/batch-update
// both returned 400 {"error":"Invalid warrant id"} (verified live 2026-07-30),
// because /:id matched first and parseInt('summary-report') is NaN.
//
// The banner below claims Hono's radix trie prioritizes static segments
// "regardless of declaration order". For these two paths production did not
// behave that way, so declaration order IS load-bearing here — do not move a
// literal path below /:id on the strength of that claim. Covered by a route-
// order regression test in test-workers/warrants.test.ts.

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
      const r = await execute(
        db,
        `UPDATE warrants SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
        status, ...chunk,
      );
      updated += r.meta.changes;
    }
    return c.json({ success: true, updated });
  } catch (err) {
    console.error('[warrants] batch-update error', err);
    return c.json({ error: 'Batch update failed' }, 500);
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
      ? `WHERE ${where.join(' AND ')} AND issuing_court IS NOT NULL`
      : 'WHERE issuing_court IS NOT NULL';

    const [byStatusRows, byTypeRows, topCourtsRows, newCountRow, clearedCountRow, latestRun] = await Promise.all([
      query<{ status: string; n: number }>(db, `SELECT status, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY status`, ...params),
      query<{ type: string; n: number }>(db, `SELECT type, COUNT(*) AS n FROM warrants ${whereClause} GROUP BY type`, ...params),
      query<{ issuing_court: string; count: number }>(
        db,
        `SELECT issuing_court, COUNT(*) AS count FROM warrants ${topCourtsWhere} GROUP BY issuing_court ORDER BY count DESC LIMIT 10`,
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

// ============================================================
// Manual warrant CRUD — WarrantsPage.tsx's New/Edit Warrant form, serve,
// archive/unarchive, and delete actions. Registered after every other
// literal-path route in this file so a numeric warrant id can never shadow
// a named route like /watch/runs or /dashboard/stats.
//
// ⚠️ An earlier version of this comment said Hono's radix trie "prioritizes
// static segments regardless of declaration order". DO NOT RELY ON THAT.
// GET /summary-report and PUT /batch-update sat below /:id on that assumption
// and were dead in production for as long as they existed — both returned
// 400 {"error":"Invalid warrant id"} (verified live 2026-07-30). Declaration
// order is load-bearing: every literal path belongs ABOVE /:id, and there is a
// route-order regression test in test-workers/warrants.test.ts to keep it that way.
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
    // Lazy auto-expiry: flip an overdue-active warrant to 'expired' before
    // responding, so a direct GET never shows a stale status.
    await applyLazyWarrantExpiry(db, [row]);
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
         warrant_number, type, status,
         subject_person_id, subject_name,
         charge_description, issuing_court, issuing_judge,
         bail_amount, offense_level, expires_at, notes,
         statute_id, statute_citation, source, entered_by, created_by,
         created_at, updated_at
       ) VALUES (?, ?, 'active',
         ?, ?,
         ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, 'manual', ?, ?,
         datetime('now'), datetime('now'))`,
      warrantNumber, body.type,
      body.subject_person_id ?? null, subjectName,
      body.charge_description, body.issuing_court ?? null, body.issuing_judge ?? null,
      body.bail_amount ?? null, body.offense_level ?? null,
      body.expires_at ?? null, body.notes ?? null,
      body.statute_id ?? null, body.statute_citation ?? null,
      user?.id ?? null, user?.id ?? null,
    );

    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM warrants WHERE id = ?', result.meta.last_row_id);

    // Auto-screen the warrant's subject against all 7 screening sources
    // (Interpol, OFAC, Utah SOR, NSOPW, UDC, etc.) — fire-and-forget so a
    // screening failure never blocks warrant creation.
    if (body.subject_person_id) {
      c.executionCtx.waitUntil(
        screenPersonAllSources(c.env, Number(body.subject_person_id), { triggeredBy: 'warrant_create' })
          .catch((err) => console.error('[warrants] screening trigger failed:', err)),
      );
    }

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
    const existing = await queryFirst<{ id: number; subject_person_id: number | null; status: string }>(
      db, 'SELECT id, subject_person_id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();

    if ('status' in body) {
      if (!isValidStatus(body.status)) {
        return c.json({ error: 'invalid_status', message: `status must be one of: ${WARRANT_STATUSES.join(', ')}` }, 400);
      }
      const fromStatus = existing.status as WarrantStatus;
      if (isValidStatus(fromStatus) && !isValidTransition(fromStatus, body.status)) {
        return c.json({
          error: 'invalid_status_transition',
          from: fromStatus,
          to: body.status,
          message: TERMINAL_STATUSES.has(fromStatus)
            ? `Warrant is ${fromStatus} (terminal) — use POST /:id/reopen before changing status`
            : `Cannot transition from ${fromStatus} to ${body.status}`,
        }, 400);
      }
    }

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

    // Only re-screen when subject_person_id actually changed — an edit to
    // status/bail/notes/etc. must not trigger a fresh 7-source scan.
    if ('subject_person_id' in body && body.subject_person_id != null
        && Number(body.subject_person_id) !== existing.subject_person_id) {
      c.executionCtx.waitUntil(
        screenPersonAllSources(c.env, Number(body.subject_person_id), { triggeredBy: 'warrant_update' })
          .catch((err) => console.error('[warrants] screening trigger failed:', err)),
      );
    }
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
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    const fromStatus = existing.status as WarrantStatus;
    if (isValidStatus(fromStatus) && !isValidTransition(fromStatus, 'served')) {
      return c.json({ error: 'invalid_status_transition', from: fromStatus, to: 'served' }, 400);
    }

    const body = await c.req.json<{ served_location?: string | null }>().catch(() => ({} as { served_location?: string | null }));
    const user = c.get('user') as { id?: number } | undefined;

    await execute(
      db,
      `UPDATE warrants SET status = 'served', served_at = datetime('now'),
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

// POST /warrants/:id/reopen — the only way a terminal-status warrant
// (served/recalled/expired/quashed) can return to 'active'. Gated to
// admin/supervisor/manager (same tier as sensitive warrant-record actions
// elsewhere in this file) and audit-logged, since silently flipping a
// closed warrant back open is a meaningful record-keeping event.
warrants.post('/:id/reopen', requireRole('admin', 'supervisor', 'manager'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') ?? '0', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid warrant id' }, 400);
    const existing = await queryFirst<{ id: number; status: string }>(db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found' }, 404);
    const fromStatus = existing.status as WarrantStatus;
    if (isValidStatus(fromStatus) && !TERMINAL_STATUSES.has(fromStatus)) {
      return c.json({ error: 'not_terminal', message: `Warrant is already ${fromStatus}` }, 400);
    }

    const user = c.get('user') as { id?: number } | undefined;
    await execute(
      db,
      `UPDATE warrants SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
      id,
    );
    await execute(
      db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?, 'warrant_reopen', 'warrant', ?, ?)`,
      user?.id ?? null, String(id), JSON.stringify({ from_status: fromStatus }),
    );
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM warrants WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] reopen error', err);
    return c.json({ error: 'Failed to reopen warrant' }, 500);
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
    const body = await c.req.json<any>();
    const rows: any[] = Array.isArray(body.warrants)
      ? body.warrants
      : (body.utah_warrant_id || body.warrant_number || body.case_id ? [body] : []);
    if (!rows.length) return c.json({ error: 'warrants required' }, 400);
    let inserted = 0;
    for (const w of rows) {
      const warrantNumber = w.utah_warrant_id || w.warrant_number || w.case_id || null;
      const first = w.first_name ?? null;
      const last = w.last_name ?? null;
      const subjectName = [first, last].filter(Boolean).join(' ').trim() || w.subject_name || null;
      const existing = warrantNumber
        ? await queryFirst<{ id: number }>(db, 'SELECT id FROM warrants WHERE warrant_number = ?', warrantNumber)
        : subjectName
        ? await queryFirst<{ id: number }>(
            db, 'SELECT id FROM warrants WHERE warrant_number IS NULL AND subject_name = ? AND issued_date IS ?',
            subjectName, w.issue_date ?? null,
          )
        : null;
      if (existing) continue;

      let subjectPersonId: number | null = null;
      const requestedId = w.subject_person_id != null ? Number(w.subject_person_id) : NaN;
      if (Number.isFinite(requestedId) && requestedId > 0) {
        const person = await queryFirst<{ id: number; first_name: string; last_name: string; dob: string | null; city: string | null; state: string | null }>(
          db, 'SELECT id, first_name, last_name, dob, city, state FROM persons WHERE id = ?', requestedId);
        if (person && confirmIdentity(
          { first: person.first_name, last: person.last_name, dob: person.dob, city: person.city, state: person.state },
          { first, last, dob: w.subject_dob ?? w.dob, age: w.age, city: w.city },
        ).matched) {
          subjectPersonId = person.id;
        }
      }

      const charges = Array.isArray(w.charges)
        ? w.charges.filter(Boolean).join('; ')
        : (() => {
            if (typeof w.charges !== 'string' || !w.charges) return null;
            try {
              const v = JSON.parse(w.charges);
              if (Array.isArray(v)) return v.filter(Boolean).join('; ');
            } catch { /* already plain text */ }
            return w.charges;
          })();
      await execute(
        db,
        `INSERT INTO warrants (
            warrant_number, type, status, subject_name, subject_first_name, subject_last_name,
            subject_dob, subject_person_id, charge_description, issuing_court, bail_amount, issued_date
         ) VALUES (?, 'arrest', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        warrantNumber, subjectName, first, last,
        w.subject_dob ?? w.dob ?? null, subjectPersonId, charges,
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


export default warrants;
