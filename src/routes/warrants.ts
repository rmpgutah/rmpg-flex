// Warrants routes for the CF Worker. Initially minimal — surfaces the
// warrant-watch run history that the legacy server's /warrants page
// + dashboard widget consume. The CRUD warrant routes (list, create,
// archive, etc.) stay on the legacy server until the full warrants
// subsystem is migrated.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { runUtahWarrantScan } from '../utils/utahWarrantPoller';
import { runAllSourceScans } from '../utils/warrantSources/runScan';

const warrants = new Hono<Env>();

// authMiddleware (mounted per-prefix in routesConfig) only verifies a valid
// JWT — it does NOT enforce a role. Every other sensitive route adds an inline
// requireRole gate; these match that convention. READ covers all internal
// dispatch/records roles but excludes client_viewer (read-only external) and
// human_resources from pulling subject warrant data. SCAN is stricter — it
// fires an ~80s external scan, so limit it to dispatch supervisors+.
const READ_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;
const SCAN_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'] as const;

// GET /warrants/watch/runs?limit=N — recent warrant watch runs
// Used by:
//   - client/src/pages/DashboardPage.tsx (widget — limit=1)
//   - client/src/pages/WarrantsPage.tsx Sources tab (limit=20)
// Returns { data: WatchRun[] } shape to match legacy server.
warrants.get('/watch/runs', requireRole(...READ_ROLES), async (c) => {
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
warrants.post('/watch/scan', requireRole(...SCAN_ROLES), async (c) => {
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runAllSourceScans(db).catch((err) => {
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
warrants.get('/utah', requireRole(...READ_ROLES), async (c) => {
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

// POST /warrants/search-all — unified cross-source warrant search backing the
// WarrantsPage "SEARCH ALL" tab. Searches the LOCAL warrants table + the
// utah_warrants table (the cron poller's cache) and returns the SPA's
// UnifiedSearchResults shape { local, utah, scraped, meta }. Was 404 in both
// Workers → the tab threw "API endpoint not found" and the unhandled rejection
// surfaced in the console. `scraped` is now backed by the scraped_warrants
// table populated by the multi-source orchestrator (Ada/Natrona/etc.); it
// mirrors the utah branch (filter guard + LIKE escaping + defensive []).
warrants.post('/search-all', requireRole(...READ_ROLES), async (c) => {
  const startedAt = Date.now();
  let body: Record<string, unknown> = {};
  try { body = await c.req.json<Record<string, unknown>>(); } catch { body = {}; }

  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const firstName = s(body.firstName);
  const lastName = s(body.lastName);
  const dob = s(body.dob);
  const warrantNumber = s(body.warrantNumber);
  const court = s(body.court);
  const source = s(body.source);
  const offenseLevel = s(body.offenseLevel);
  const status = s(body.status);
  const type = s(body.type);
  const chargeKeyword = s(body.chargeKeyword);
  const dateFrom = s(body.dateFrom);
  const dateTo = s(body.dateTo);

  // Escape LIKE wildcards so a search for "50%" isn't a match-everything query.
  const like = (v: string) => `%${v.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const db = getDb(c.env);

  // ── Local warrants ──
  let local: Record<string, unknown>[] = [];
  try {
    const f: string[] = [];
    const p: unknown[] = [];
    if (firstName) { f.push("subject_first_name LIKE ? ESCAPE '\\'"); p.push(like(firstName)); }
    if (lastName) { f.push("subject_last_name LIKE ? ESCAPE '\\'"); p.push(like(lastName)); }
    if (dob) { f.push('subject_dob = ?'); p.push(dob); }
    if (warrantNumber) { f.push("warrant_number LIKE ? ESCAPE '\\'"); p.push(like(warrantNumber)); }
    if (court) { f.push("(issuing_court LIKE ? ESCAPE '\\' OR court LIKE ? ESCAPE '\\')"); p.push(like(court), like(court)); }
    if (source) { f.push('source = ?'); p.push(source); }
    if (offenseLevel) { f.push('offense_level = ?'); p.push(offenseLevel); }
    if (status) { f.push('status = ?'); p.push(status); }
    if (type) { f.push('type = ?'); p.push(type); }
    if (chargeKeyword) {
      f.push("(charge_description LIKE ? ESCAPE '\\' OR offense_description LIKE ? ESCAPE '\\' OR offense LIKE ? ESCAPE '\\')");
      p.push(like(chargeKeyword), like(chargeKeyword), like(chargeKeyword));
    }
    if (dateFrom) { f.push('COALESCE(issued_date, created_at) >= ?'); p.push(dateFrom); }
    if (dateTo) { f.push('COALESCE(issued_date, created_at) <= ?'); p.push(dateTo); }
    const where = f.length ? `WHERE ${f.join(' AND ')}` : '';
    local = await query<Record<string, unknown>>(
      db,
      `SELECT id, warrant_number, type, status,
              COALESCE(charge_description, offense_description, offense) AS charge_description,
              subject_first_name, subject_last_name,
              COALESCE(issuing_court, court) AS issuing_court,
              COALESCE(bail_amount, bond_amount) AS bail_amount,
              offense_level, created_at
         FROM warrants
         ${where}
         ORDER BY created_at DESC
         LIMIT 100`,
      ...p,
    );
  } catch (err) {
    console.error('[warrants] search-all local query error:', (err as Error)?.message);
    local = [];
  }

  // ── Utah warrants (cron poller cache) ──
  // Only run when there's a name/court/charge/number filter — an unfiltered
  // query would dump the entire active roster into the results panel.
  let utah: Record<string, unknown>[] = [];
  try {
    const hasUtahFilter = firstName || lastName || court || chargeKeyword || warrantNumber;
    if (hasUtahFilter) {
      const f: string[] = ['is_active = 1'];
      const p: unknown[] = [];
      if (firstName) { f.push("first_name LIKE ? ESCAPE '\\'"); p.push(like(firstName)); }
      if (lastName) { f.push("last_name LIKE ? ESCAPE '\\'"); p.push(like(lastName)); }
      if (court) { f.push("court_name LIKE ? ESCAPE '\\'"); p.push(like(court)); }
      if (chargeKeyword) { f.push("charges LIKE ? ESCAPE '\\'"); p.push(like(chargeKeyword)); }
      if (warrantNumber) { f.push("(utah_warrant_id LIKE ? ESCAPE '\\' OR case_id LIKE ? ESCAPE '\\')"); p.push(like(warrantNumber), like(warrantNumber)); }
      utah = await query<Record<string, unknown>>(
        db,
        `SELECT utah_warrant_id, first_name, middle_name, last_name, age, city,
                issue_date, court_name, case_id, charges
           FROM utah_warrants
           WHERE ${f.join(' AND ')}
           ORDER BY last_seen_at DESC
           LIMIT 100`,
        ...p,
      );
    }
  } catch (err) {
    console.error('[warrants] search-all utah query error:', (err as Error)?.message);
    utah = [];
  }

  // ── Multi-State scraped warrants (multi-source orchestrator cache) ──
  // Mirrors the utah branch: only run with a name/court/charge/number filter,
  // reuse the same like() ESCAPE pattern, and defensively fall back to [] if
  // the table is cold. Feeds the WarrantsPage "Multi-State Scraped" panel.
  let scraped: Record<string, unknown>[] = [];
  try {
    const hasScrapedFilter = firstName || lastName || court || chargeKeyword || warrantNumber;
    if (hasScrapedFilter) {
      const f: string[] = ["status = 'active'"];
      const p: unknown[] = [];
      if (firstName) { f.push("first_name LIKE ? ESCAPE '\\'"); p.push(like(firstName)); }
      if (lastName) { f.push("last_name LIKE ? ESCAPE '\\'"); p.push(like(lastName)); }
      if (court) { f.push("court_name LIKE ? ESCAPE '\\'"); p.push(like(court)); }
      if (chargeKeyword) { f.push("charge_description LIKE ? ESCAPE '\\'"); p.push(like(chargeKeyword)); }
      if (warrantNumber) { f.push("(case_number LIKE ? ESCAPE '\\' OR warrant_id LIKE ? ESCAPE '\\')"); p.push(like(warrantNumber), like(warrantNumber)); }
      scraped = await query<Record<string, unknown>>(
        db,
        `SELECT source_key, first_name, last_name, charge_description, court_name,
                case_number, issue_date, bail_amount, offense_level, warrant_id,
                city, state
           FROM scraped_warrants
           WHERE ${f.join(' AND ')}
           ORDER BY last_seen_at DESC
           LIMIT 100`,
        ...p,
      );
    }
  } catch (err) {
    console.error('[warrants] search-all scraped query error:', (err as Error)?.message);
    scraped = [];
  }

  return c.json({
    local,
    utah,
    scraped,
    meta: {
      duration: Date.now() - startedAt,
      sources: ['local', 'utah', 'scraped'],
      utahBlocked: false,
      searchedAt: new Date().toISOString(),
      totalHits: local.length + utah.length + scraped.length,
    },
  });
});

// GET /warrants/person/:id/profile — the WarrantsPage person drawer.
// Surfaces a local person's Utah warrants (from the cron poller's
// utah_warrants table, filtered by person_id) shaped into the SPA's
// PersonProfile { person, warrants[], scanHistory[], lastChecked }.
// Was 404 everywhere → the person drawer silently failed to open.
warrants.get('/person/:id/profile', requireRole(...READ_ROLES), async (c) => {
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
  // COUNT(*) always returns one row on an existing table; the ?? guards the
  // pre-migration window where the driver could hand back an empty array,
  // so we never destructure undefined.
  const activeRows = await query<{ active: number }>(
    db, 'SELECT COUNT(*) AS active FROM utah_warrants WHERE is_active = 1');
  const active = activeRows[0]?.active ?? 0;
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

// Empty-status fallback for the pre-migration / table-missing path. Built
// fresh per request so nextScheduledRun is always a real ISO string (the
// helper is pure and can't throw) — matching the live shape so cold-D1
// clients never see a null where they expect a date.
function emptyStatus() {
  return {
    lastSync: null, lastStatus: null, lastPersonsChecked: 0, lastNewWarrants: 0,
    lastWarrantsCleared: 0, lastErrors: 0, activeWarrants: 0,
    nextScheduledRun: nextScheduledRun(new Date()), isRunning: false,
    enabled: true, polling: false, lastRunAt: null, lastRunStatus: null,
  };
}
// /utah/sync-status + /scraped/status share the slim status shape. NOTE:
// /utah-search/auto-poll-status is deliberately NOT in this list — the
// WarrantsPage "Watch" tab needs the richer flaggedPersons/recentHits/runs
// payload (see the dedicated handler below). Collapsing all three onto the
// slim builder is what dropped those keys in the VPS→CF port and white-screened
// the watch tab (`autoPollStatus.flaggedPersons.length` on undefined).
for (const path of ['/utah/sync-status', '/scraped/status']) {
  warrants.get(path, requireRole(...READ_ROLES), async (c) => {
    try {
      return c.json(await buildUtahStatus(c));
    } catch (err) {
      // Pre-migration / table-missing → harmless empty status.
      return c.json(emptyStatus());
    }
  });
}

// GET /warrants/utah-search/auto-poll-status — rich payload for the WarrantsPage
// "Watch" tab. Restores the legacy VPS shape (server-vps/src/routes/warrants.ts)
// that the CF port dropped: { syncStatus, blocked, runs, flaggedPersons,
// recentHits, totalPersons }. All columns below were verified against live D1
// (785de7ae) on 2026-05-29 — warrants uses subject_person_id (parallel
// person_id is unused drift); status convention is 'active'.
warrants.get('/utah-search/auto-poll-status', requireRole(...READ_ROLES), async (c) => {
  // Empty-but-complete shape so the client always gets every key it reads,
  // even on cold/missing tables — the watch tab renders empty instead of 500.
  const empty = {
    syncStatus: { lastSync: null, warrantCount: 0, status: 'idle', lastError: null },
    blocked: false,
    runs: [] as Record<string, unknown>[],
    flaggedPersons: [] as Record<string, unknown>[],
    recentHits: [] as Record<string, unknown>[],
    totalPersons: 0,
  };
  try {
    const db = getDb(c.env);

    // Latest 10 runs, newest first (started_at matches /watch/runs above).
    const runs = await query<Record<string, any>>(
      db, 'SELECT * FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 10');
    const latest = runs[0] ?? null;

    // Persons with ≥1 active local warrant OR ≥1 active Utah hit linked to
    // them by person_id. We match on person_id — the linkage the poller
    // already resolved with age-tolerance — NOT a raw LOWER(name) compare,
    // which cross-attributed a DIFFERENT person's warrant whenever two local
    // records shared a name. `unverified` flags the namesake-attribution case
    // (DOB-less person → the poller couldn't age-confirm the match); the
    // client tags those hits so an officer treats them as leads, not
    // confirmed warrants. `warrant_severity IS NULL, ...` = portable NULLS LAST.
    const flagged = await query<Record<string, any>>(db, `
      SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.race, p.height,
        p.weight, p.hair_color, p.eye_color, p.address, p.photo_url,
        CASE WHEN ${DOB_PRESENT} THEN 0 ELSE 1 END AS unverified,
        (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') AS local_warrant_count,
        (SELECT COUNT(*) FROM utah_warrants uw WHERE uw.person_id = p.id AND uw.is_active = 1) AS utah_hit_count,
        (SELECT w2.offense_level FROM warrants w2 WHERE w2.subject_person_id = p.id AND w2.status = 'active'
          ORDER BY CASE w2.offense_level WHEN 'felony' THEN 1 WHEN 'misdemeanor' THEN 2 ELSE 3 END LIMIT 1) AS warrant_severity
      FROM persons p
      WHERE (SELECT COUNT(*) FROM warrants w WHERE w.subject_person_id = p.id AND w.status = 'active') > 0
        OR (SELECT COUNT(*) FROM utah_warrants uw WHERE uw.person_id = p.id AND uw.is_active = 1) > 0
      ORDER BY unverified ASC, warrant_severity IS NULL, warrant_severity, p.last_name
      LIMIT 200`);

    // Per-person warrant detail. N+1, but bounded by LIMIT 200 and flagged sets
    // are tiny in practice; Promise.all collapses it to two parallel D1 rounds.
    const flaggedPersons = await Promise.all(flagged.map(async (p) => {
      const [localWarrants, utahWarrants] = await Promise.all([
        query(db, `SELECT id, warrant_number, type, status, charge_description, offense_level,
                     bail_amount, issuing_court, source, created_at
                   FROM warrants WHERE subject_person_id = ? AND status = 'active'
                   ORDER BY created_at DESC`, p.id),
        query(db, `SELECT utah_warrant_id, charges, court_name, issue_date, city, age
                   FROM utah_warrants WHERE person_id = ? AND is_active = 1
                   ORDER BY last_seen_at DESC LIMIT 20`, p.id),
      ]);
      return { ...p, unverified: Number(p.unverified) === 1, warrants: localWarrants, utahWarrants };
    }));

    // Isolated try/catch: warrant_watch_log may not exist on live; a missing
    // table must not collapse the already-resolved runs/flaggedPersons into [].
    let recentHits: Record<string, any>[] = [];
    try {
      recentHits = await query<Record<string, any>>(db, `
        SELECT id, person_id, person_name, event, charges, court_name, created_at
        FROM warrant_watch_log WHERE event IN ('warrant_found', 'warrant_cleared')
        ORDER BY created_at DESC LIMIT 50`);
    } catch { recentHits = []; }

    const totalRows = await query<{ cnt: number }>(db,
      `SELECT COUNT(*) AS cnt FROM persons WHERE first_name IS NOT NULL AND last_name IS NOT NULL`);
    const activeUtah = await query<{ cnt: number }>(db,
      `SELECT COUNT(*) AS cnt FROM utah_warrants WHERE is_active = 1`);

    // No isUtahApiBlocked() helper in the CF worker (it was VPS-only); infer a
    // block from the latest run's error text instead of asserting ONLINE blind.
    const lastErr = latest?.error_message ? String(latest.error_message) : null;
    const blocked = !!(lastErr && /block|403|denied|captcha/i.test(lastErr));

    return c.json({
      syncStatus: {
        lastSync: latest ? (latest.completed_at ?? latest.started_at ?? null) : null,
        warrantCount: activeUtah[0]?.cnt ?? 0,
        status: (latest?.status as string) ?? 'idle',
        lastError: lastErr,
      },
      blocked,
      runs,
      flaggedPersons,
      recentHits,
      totalPersons: totalRows[0]?.cnt ?? 0,
    });
  } catch (err) {
    // Pre-migration / table-missing → complete empty shape, never 500.
    return c.json(empty);
  }
});

// ============================================================
// /dashboard/* + /expiring — Warrants DASHBOARD tab widgets
// ============================================================
// Ported from legacy, where they queried the (perpetually empty on live)
// manual `warrants` table and so returned all-zeros — making the DASHBOARD
// tab look dead while the Watch List showed real Utah hits. These read the
// data where it actually lives: utah_warrants (the cron poller's cache) +
// the manual warrants table + warrant_scraper_config.
//
// CONFIDENCE MODEL — confirmed vs unverified, with NO schema column:
//   The poller (utahWarrantPoller.ts:isLikelyMatch) only persists a Utah
//   warrant for a local person when the local DOB-derived age matches the
//   upstream age (±1) — it REJECTS age-mismatched candidates before storing.
//   So any stored row whose linked person HAS a dob necessarily passed
//   age-matching → CONFIRMED. A row linked to a DOB-less person came through
//   the deliberate "attribute the namesake rather than skip" branch → it's a
//   possible-namesake (the "8 Ryan Smiths" problem) → UNVERIFIED. We count
//   and surface UNVERIFIED separately and NEVER fold it into the confirmed
//   active total. Because it's derived from persons.dob at query time, a
//   backfilled DOB upgrades the row automatically on the next scan.
const DOB_PRESENT = "(p.dob IS NOT NULL AND TRIM(p.dob) != '')";

// GET /warrants/dashboard/stats → { activeWarrants, unverifiedWarrants,
//   hitsToday, personsFlagged, sourcesOnline, sourcesTotal }
warrants.get('/dashboard/stats', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);

    // Active Utah hits split by confidence (see CONFIDENCE MODEL above).
    const utahRow = await queryFirst<{ confirmed: number | null; unverified: number | null }>(db, `
      SELECT
        SUM(CASE WHEN ${DOB_PRESENT} THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN ${DOB_PRESENT} THEN 0 ELSE 1 END) AS unverified
      FROM utah_warrants uw
      LEFT JOIN persons p ON uw.person_id = p.id
      WHERE uw.is_active = 1`);

    const manualRow = await queryFirst<{ active: number }>(db,
      `SELECT COUNT(*) AS active FROM warrants WHERE status='active' AND archived_at IS NULL`);

    // Distinct persons flagged across BOTH sources (manual + active Utah).
    const flaggedRow = await queryFirst<{ n: number }>(db, `
      SELECT COUNT(*) AS n FROM (
        SELECT subject_person_id AS pid FROM warrants
          WHERE status='active' AND archived_at IS NULL AND subject_person_id IS NOT NULL
        UNION
        SELECT person_id AS pid FROM utah_warrants
          WHERE is_active=1 AND person_id IS NOT NULL
      )`);

    // Hits first seen today (UTC): new Utah rows + manual warrants created.
    const hitsRow = await queryFirst<{ n: number }>(db, `
      SELECT
        (SELECT COUNT(*) FROM utah_warrants WHERE is_active=1 AND date(first_seen_at)=date('now'))
        + (SELECT COUNT(*) FROM warrants WHERE status='active' AND archived_at IS NULL AND date(created_at)=date('now'))
        AS n`);

    // Sources online/total. One shared poller drives a global run history,
    // so circuit health is global: a source is offline only when its circuit
    // is broken (5+ trailing failed runs), mirroring the Scrapers-tab logic.
    const total = (await queryFirst<{ n: number }>(db,
      `SELECT COUNT(*) AS n FROM warrant_scraper_config`))?.n ?? 0;
    const trailing = await query<{ errors: number | null }>(db,
      `SELECT errors FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 10`);
    let consec = 0;
    for (const r of trailing) { if (r.errors && r.errors > 0) consec++; else break; }
    const sourcesOnline = consec >= 5 ? 0 : total;

    return c.json({
      activeWarrants: (utahRow?.confirmed ?? 0) + (manualRow?.active ?? 0),
      unverifiedWarrants: utahRow?.unverified ?? 0,
      hitsToday: hitsRow?.n ?? 0,
      personsFlagged: flaggedRow?.n ?? 0,
      sourcesOnline,
      sourcesTotal: total,
    });
  } catch (err) {
    console.error('[warrants] dashboard/stats error', err);
    return c.json({ activeWarrants: 0, unverifiedWarrants: 0, hitsToday: 0, personsFlagged: 0, sourcesOnline: 0, sourcesTotal: 0 });
  }
});

// GET /warrants/dashboard/feed?range=24h&limit=50 → { data: FeedEntry[] }
// Synthesised from utah_warrants lifecycle timestamps: first_seen_at = a
// FOUND event, and a cleared row's last_seen_at = a CLEARED event. (The
// poller records run COUNTS, not per-event rows — warrant_watch_log is
// unpopulated on live — so a log-table read would always be empty.)
warrants.get('/dashboard/feed', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const rangeRaw = (c.req.query('range') || '24h').toLowerCase().trim();
    const m = rangeRaw.match(/^(\d+)\s*([hd])$/);
    let hours = m ? parseInt(m[1], 10) * (m[2] === 'd' ? 24 : 1) : 24;
    if (!Number.isFinite(hours) || hours <= 0) hours = 24;
    hours = Math.min(hours, 24 * 90); // cap 90d
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);

    const rows = await query<Record<string, unknown>>(db, `
      SELECT uw.id, uw.person_id,
             COALESCE(NULLIF(TRIM(p.first_name || ' ' || p.last_name), ''),
                      TRIM(uw.first_name || ' ' || uw.last_name)) AS person_name,
             CASE WHEN uw.is_active = 1 THEN 'warrant_found' ELSE 'warrant_cleared' END AS event,
             uw.utah_warrant_id, uw.charges, uw.court_name,
             CASE WHEN uw.is_active = 1 THEN uw.first_seen_at ELSE uw.last_seen_at END AS created_at,
             p.photo_url
      FROM utah_warrants uw
      LEFT JOIN persons p ON uw.person_id = p.id
      WHERE datetime(CASE WHEN uw.is_active = 1 THEN uw.first_seen_at ELSE uw.last_seen_at END)
            >= datetime('now', ?)
      ORDER BY created_at DESC
      LIMIT ?`,
      `-${hours} hours`, limit);
    return c.json({ data: rows });
  } catch (err) {
    console.error('[warrants] dashboard/feed error', err);
    return c.json({ data: [] });
  }
});

// GET /warrants/dashboard/priority → { data: PriorityWarrant[] }
// High-priority active warrants for the right-rail. Manual felonies / high
// bail first, then active Utah hits whose charge text reads as serious.
// Each Utah row carries `unverified` so the UI can flag namesake leads.
warrants.get('/dashboard/priority', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);

    const manual = await query<Record<string, unknown>>(db, `
      SELECT w.id, w.warrant_number, COALESCE(w.warrant_type, w.type) AS type, w.status,
             COALESCE(w.charge_description, w.offense_description, w.offense) AS charge_description,
             w.offense_level, p.first_name AS subject_first_name, p.last_name AS subject_last_name,
             p.photo_url AS subject_photo_url,
             COALESCE(w.bail_amount, w.bond_amount) AS bail_amount, w.source, w.created_at,
             0 AS unverified
      FROM warrants w
      LEFT JOIN persons p ON w.subject_person_id = p.id
      WHERE w.status='active' AND w.archived_at IS NULL
        AND (w.offense_level='felony' OR COALESCE(w.bail_amount, w.bond_amount, 0) >= 5000)
      ORDER BY CASE w.offense_level WHEN 'felony' THEN 1 ELSE 2 END,
               COALESCE(w.bail_amount, w.bond_amount, 0) DESC
      LIMIT 25`);

    const utahRows = await query<Record<string, any>>(db, `
      SELECT uw.id, uw.utah_warrant_id AS warrant_number, 'arrest' AS type, 'active' AS status,
             uw.charges AS charge_description, NULL AS offense_level,
             uw.first_name AS subject_first_name, uw.last_name AS subject_last_name,
             p.photo_url AS subject_photo_url, NULL AS bail_amount,
             'utah-warrant-watch' AS source, uw.first_seen_at AS created_at,
             CASE WHEN ${DOB_PRESENT} THEN 0 ELSE 1 END AS unverified
      FROM utah_warrants uw
      LEFT JOIN persons p ON uw.person_id = p.id
      WHERE uw.is_active = 1
        AND (UPPER(uw.charges) LIKE '%ASSAULT%' OR UPPER(uw.charges) LIKE '%BATTERY%'
          OR UPPER(uw.charges) LIKE '%INFLUENCE%' OR UPPER(uw.charges) LIKE '%DUI%'
          OR UPPER(uw.charges) LIKE '%WEAPON%'   OR UPPER(uw.charges) LIKE '%FIREARM%'
          OR UPPER(uw.charges) LIKE '%FELONY%'   OR UPPER(uw.charges) LIKE '%ROBBERY%'
          OR UPPER(uw.charges) LIKE '%BURGLARY%' OR UPPER(uw.charges) LIKE '%DOMESTIC%'
          OR UPPER(uw.charges) LIKE '%HOMICIDE%' OR UPPER(uw.charges) LIKE '%THEFT%')
      ORDER BY unverified ASC, uw.first_seen_at DESC
      LIMIT 25`);

    const utah = utahRows.map((w) => {
      let chargeText = '';
      try {
        const arr = JSON.parse(String(w.charge_description || '[]'));
        chargeText = Array.isArray(arr) ? arr.join('; ') : String(w.charge_description || '');
      } catch { chargeText = String(w.charge_description || ''); }
      return { ...w, charge_description: chargeText, unverified: Number(w.unverified) === 1 };
    });

    return c.json({ data: [...manual, ...utah].slice(0, 30) });
  } catch (err) {
    console.error('[warrants] dashboard/priority error', err);
    return c.json({ data: [] });
  }
});

// GET /warrants/expiring?days=30 → { count } — active manual warrants whose
// expiry falls inside the window. Utah warrants have no expiry concept, so
// this is manual-only (returns 0 until manual warrants are entered).
warrants.get('/expiring', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const daysRaw = parseInt(c.req.query('days') || '30', 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 30;
    const row = await queryFirst<{ count: number }>(db, `
      SELECT COUNT(*) AS count FROM warrants
      WHERE status='active' AND archived_at IS NULL
        AND COALESCE(expiry_date, expires_at) IS NOT NULL
        AND date(COALESCE(expiry_date, expires_at)) BETWEEN date('now') AND date('now', ?)`,
      `+${days} days`);
    return c.json({ count: row?.count ?? 0 });
  } catch (err) {
    console.error('[warrants] expiring error', err);
    return c.json({ count: 0 });
  }
});

// ============================================================
// /scrapers — Sources tab on WarrantsPage + AdminWarrantScrapersTab
// ============================================================
// Live `warrant_scraper_config` carries only operational state
// (source_name + timestamps + errors + perf hints). Display metadata
// (display_name, state, county, source_url) is code-resident in
// SOURCE_REGISTRY below so adding a new scraper is a 5-line patch
// rather than a schema migration. The client's ScraperSource shape
// (client/src/types/scrapers.ts) is the contract; we synthesize it
// from JOIN(warrant_scraper_config, warrant_watch_runs, utah_warrants).
//
// `circuit_broken` and `consecutive_errors` are DERIVED from the
// trailing run history — live schema has no backing columns. The
// reset-circuit endpoint nulls `last_error` (the surfaced symptom);
// the next successful run keeps it null on its own via the poller's
// CASE statement (see src/utils/utahWarrantPoller.ts).

interface ScraperRegistryEntry {
  display_name: string;
  state: string;
  county: string | null;
  source_url: string;
  source_type: string;
  priority: 1 | 2 | 3 | 4;
}

const SOURCE_REGISTRY: Record<string, ScraperRegistryEntry> = {
  'utah-warrant-watch': {
    display_name: 'Utah State Warrants',
    state: 'UT',
    county: null,
    source_url: 'https://warrants.utah.gov',
    source_type: 'api',
    priority: 1,
  },
  'ada-county-id': {
    display_name: 'Ada County Sheriff (ID)',
    state: 'ID',
    county: 'Ada',
    source_url: 'https://apps.adacounty.id.gov/sheriff/reports/warrants.aspx',
    source_type: 'html',
    priority: 2,
  },
  'natrona-county-wy': {
    display_name: 'Natrona County Sheriff (WY)',
    state: 'WY',
    county: 'Natrona',
    source_url: 'https://warrants.natronacounty-wy.gov',
    source_type: 'html',
    priority: 2,
  },
};

// A-F grade per client/src/types/scrapers.ts cutoffs. Threshold-only —
// no time-of-day weighting; if you want "today only," filter the input
// by started_at first.
function gradeFromSuccessRate(rate: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (rate >= 0.95) return 'A';
  if (rate >= 0.85) return 'B';
  if (rate >= 0.70) return 'C';
  if (rate >= 0.50) return 'D';
  return 'F';
}

// Nearest-rank percentile on a pre-sorted ascending array. Inputs are
// duration-or-other numeric arrays from warrant_watch_runs; size is
// always small (≤ a few hundred rows / window) so the O(n log n) sort
// is cheap.
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[idx];
}

interface RunRow {
  started_at: string;
  completed_at: string | null;
  status: string;
  errors: number | null;
  persons_checked: number | null;
  new_warrants_found: number | null;
  warrants_cleared: number | null;
  error_message: string | null;
}

// Read the run history once and project it into:
//   - the rich `metrics_24h` block returned per source
//   - the trailing `consecutive_errors` count (used for circuit derivation)
//   - last_error_at (the started_at of the most recent failed run)
function summarizeRuns(runs24h: RunRow[], trailingRuns: RunRow[]) {
  const total = runs24h.length;
  // A run's success is its STATUS, not whether it logged any per-person errors —
  // a completed run that hit a few transient lookup errors is still a success.
  const failed = runs24h.filter((r) => r.status === 'failed').length;
  const successful = total - failed;
  // "unchanged" runs = successful runs that found and cleared nothing —
  // the steady-state with no roster churn. Matters because the dashboard
  // wants to distinguish "nothing happened" from "scan didn't run."
  const unchanged = runs24h.filter(
    (r) => (!r.errors || r.errors === 0) && !r.new_warrants_found && !r.warrants_cleared,
  ).length;

  const durations: number[] = runs24h
    .filter((r) => r.completed_at)
    .map((r) => new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime())
    .filter((d) => d > 0 && d < 24 * 60 * 60 * 1000) // discard zombies
    .sort((a, b) => a - b);

  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const successRate = total > 0 ? successful / total : 0;

  // Trailing consecutive failures, walking from most-recent backwards.
  // Stops at the first success (or at the start of history).
  let consecutiveErrors = 0;
  for (const r of trailingRuns) {
    if (r.errors && r.errors > 0) consecutiveErrors++;
    else break;
  }

  // last_error_at: started_at of the most recent failed run in the 24h
  // window. Distinct from `last_error` (the message), which lives on
  // warrant_scraper_config and survives across the window.
  const lastFailed = runs24h.find((r) => r.errors && r.errors > 0);

  return {
    total_runs: total,
    successful_runs: successful,
    unchanged_runs: unchanged,
    failed_runs: failed,
    success_rate: Number(successRate.toFixed(4)),
    avg_duration_ms: avgDuration,
    p50_duration_ms: percentile(durations, 0.5),
    p95_duration_ms: percentile(durations, 0.95),
    avg_parsed: total
      ? Number(
          (runs24h.reduce((a, r) => a + (r.new_warrants_found ?? 0), 0) / total).toFixed(2),
        )
      : 0,
    total_inserted: runs24h.reduce((a, r) => a + (r.new_warrants_found ?? 0), 0),
    total_updated: runs24h.reduce((a, r) => a + (r.warrants_cleared ?? 0), 0),
    last_error_at: lastFailed ? lastFailed.started_at : null,
    consecutive_errors: consecutiveErrors,
    health_grade: gradeFromSuccessRate(successRate),
  };
}

// GET /warrants/scrapers — { sources: ScraperSource[] }
// Polled by WarrantsPage Sources tab + AdminWarrantScrapersTab on mount.
warrants.get('/scrapers', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const configRows = await query<Record<string, any>>(
      db,
      'SELECT * FROM warrant_scraper_config ORDER BY priority, source_name',
    );

    const sources = await Promise.all(
      configRows.map(async (cfg) => {
        const sourceKey = String(cfg.source_name);
        const registry = SOURCE_REGISTRY[sourceKey] ?? {
          // Unknown source — show its key as the display name so it's
          // visible (not silently dropped) and an operator can decide
          // whether to register it or remove the row.
          display_name: sourceKey,
          state: '',
          county: null,
          source_url: '',
          source_type: cfg.source_type ?? 'unknown',
          priority: (cfg.priority as 1 | 2 | 3 | 4) ?? 4,
        };

        const runs24h = await query<RunRow>(
          db,
          `SELECT started_at, completed_at, status, errors, persons_checked,
                  new_warrants_found, warrants_cleared, error_message
             FROM warrant_watch_runs
            WHERE started_at >= datetime('now', '-24 hours')
            ORDER BY started_at DESC`,
        );
        const trailingRuns = await query<RunRow>(
          db,
          `SELECT started_at, completed_at, status, errors, persons_checked,
                  new_warrants_found, warrants_cleared, error_message
             FROM warrant_watch_runs
            ORDER BY started_at DESC
            LIMIT 10`,
        );
        const metrics = summarizeRuns(runs24h, trailingRuns);

        const warrantCountRow = await query<{ n: number }>(
          db,
          `SELECT COUNT(*) AS n FROM utah_warrants
            WHERE COALESCE(source, 'utah-warrant-watch') = ? AND is_active = 1`,
          sourceKey,
        );
        const warrant_count = warrantCountRow[0]?.n ?? 0;

        // Circuit derivation: 5+ consecutive failures = circuit broken.
        // Keeps the dashboard usable when a scrape is wedged — operator
        // hits "Reset Circuit" which clears last_error so the next
        // successful run renders healthy.
        const circuit_broken: 0 | 1 = metrics.consecutive_errors >= 5 ? 1 : 0;

        return {
          source_key: sourceKey,
          display_name: registry.display_name,
          state: registry.state,
          county: registry.county,
          source_url: registry.source_url,
          source_type: registry.source_type,
          enabled: 1 as const,
          circuit_broken,
          priority: registry.priority,
          consecutive_errors: metrics.consecutive_errors,
          warrant_count,
          last_scrape_at: cfg.last_run_at ?? null,
          last_success_at: cfg.last_success_at ?? null,
          // Sticky-error gotcha: the poller's CASE clears last_error on
          // every successful run, so a stale message here means the most
          // recent run actually failed. Don't synthetically null it on
          // "consecutive_errors === 0" — that hides legitimate state.
          last_error: cfg.last_error ?? null,
          avg_parse_count: cfg.avg_parse_count ?? null,
          p95_latency_ms: cfg.p95_latency_ms ?? null,
          metrics_24h: {
            source_key: sourceKey,
            window_hours: 24,
            ...metrics,
            last_success_at: cfg.last_success_at ?? null,
            last_error: cfg.last_error ?? null,
            // Client SourceMetrics expects status_distribution but the
            // legacy `warrant_scraper_runs` table doesn't exist here —
            // we project the same insight from run statuses we DO have.
            status_distribution: {
              completed: metrics.successful_runs,
              failed: metrics.failed_runs,
            } as Record<string, number>,
          },
        };
      }),
    );

    return c.json({ sources });
  } catch (err) {
    console.error('[warrants] /scrapers error', err);
    // Empty shape is what the legacy handler returned on its own (broken)
    // schema queries. Keep the same degraded UX so the page renders.
    return c.json({ sources: [] });
  }
});

// GET /warrants/scrapers/health — header badge in Layout.tsx (30s poll).
// Aggregates each source's grade into healthy/degraded/failed buckets so
// the badge can show "🟢 3/3 healthy" / "🟡 2/3 degraded" / "🔴 1/3 failed."
warrants.get('/scrapers/health', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const configRows = await query<Record<string, any>>(
      db,
      'SELECT source_name FROM warrant_scraper_config',
    );
    let healthy = 0;
    let degraded = 0;
    let failed = 0;
    let circuit_broken = 0;
    const total = configRows.length;

    for (const cfg of configRows) {
      const runs24h = await query<RunRow>(
        db,
        `SELECT started_at, completed_at, status, errors, persons_checked,
                new_warrants_found, warrants_cleared, error_message
           FROM warrant_watch_runs
          WHERE started_at >= datetime('now', '-24 hours')
          ORDER BY started_at DESC`,
      );
      const trailing = await query<RunRow>(
        db,
        `SELECT started_at, completed_at, status, errors, persons_checked,
                new_warrants_found, warrants_cleared, error_message
           FROM warrant_watch_runs ORDER BY started_at DESC LIMIT 10`,
      );
      const m = summarizeRuns(runs24h, trailing);
      // Same A-F → 3-bucket roll-up as the legacy handler so the badge
      // colors don't shift when this Worker takes over the path.
      if (m.total_runs === 0) failed++;
      else if (m.health_grade === 'A' || m.health_grade === 'B') healthy++;
      else if (m.health_grade === 'C' || m.health_grade === 'D') degraded++;
      else failed++;
      if (m.consecutive_errors >= 5) circuit_broken++;
    }

    // Last-hour activity is read directly from runs because it's a
    // global figure (not per-source) — the badge shows "12 runs in the
    // last hour" as a freshness hint.
    const lastHourRow = await query<{ runs: number; inserted: number }>(
      db,
      `SELECT COUNT(*) AS runs,
              COALESCE(SUM(new_warrants_found), 0) AS inserted
         FROM warrant_watch_runs
        WHERE started_at >= datetime('now', '-1 hour')`,
    );
    const last_hour_runs = lastHourRow[0]?.runs ?? 0;
    const last_hour_inserted = lastHourRow[0]?.inserted ?? 0;

    return c.json({
      healthy,
      degraded,
      failed,
      circuit_broken,
      total,
      last_hour_runs,
      last_hour_inserted,
    });
  } catch (err) {
    console.error('[warrants] /scrapers/health error', err);
    // Degraded UX > 500. The badge will render "0/0 healthy" which is
    // a self-evidently weird state and the operator opens the Sources
    // tab to dig in (where the real error surfaces).
    return c.json({
      healthy: 0,
      degraded: 0,
      failed: 0,
      circuit_broken: 0,
      total: 0,
      last_hour_runs: 0,
      last_hour_inserted: 0,
    });
  }
});

// POST /warrants/scrapers/:source_key/trigger — "Scan Now" button on a
// specific scraper card. Same fire-and-forget pattern as /watch/scan
// (waitUntil → return 202 immediately) because a full scan paces
// ~8s/person and blows past the request timeout if awaited.
//
// Tighter role gate (SCAN_ROLES) than reads — triggering pulls an
// external API for every roster row.
warrants.post('/scrapers/:source_key/trigger', requireRole(...SCAN_ROLES), async (c) => {
  const sourceKey = c.req.param('source_key');
  if (sourceKey !== 'utah-warrant-watch') {
    // Future-proofing: when a second scraper lands, dispatch on
    // sourceKey to its own runner. For now, refuse loudly so we
    // don't silently pretend to scan something unimplemented.
    return c.json({ error: `No scraper registered for source_key '${sourceKey}'` }, 404);
  }
  const db = getDb(c.env);
  c.executionCtx.waitUntil(
    runUtahWarrantScan(db).catch((err) => {
      console.error('[warrants] scrapers/:key/trigger scan failed:', err);
    }),
  );
  return c.json(
    { success: true, started: true, message: `Scan started for ${sourceKey}; poll /watch/runs.` },
    202,
  );
});

// POST /warrants/scrapers/:source_key/reset-circuit — "Reset Circuit"
// button. We have no circuit_broken column to flip, so clearing
// last_error is the operationally equivalent action: the dashboard
// derives circuit state from consecutive_errors (which falls to 0
// the moment the next run succeeds). Nulling last_error lets the
// next render show a clean state without waiting for a run.
warrants.post('/scrapers/:source_key/reset-circuit', requireRole(...SCAN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const sourceKey = c.req.param('source_key');
    const result = await db
      .prepare('UPDATE warrant_scraper_config SET last_error = NULL WHERE source_name = ?')
      .bind(sourceKey)
      .run();
    // changes === 0 means no row matched. Honest 404 prevents the
    // user from thinking they cleared a circuit they didn't.
    if ((result.meta?.changes ?? 0) === 0) {
      return c.json({ error: `No scraper registered for source_key '${sourceKey}'` }, 404);
    }
    return c.json({ success: true, message: `Circuit reset for ${sourceKey}` });
  } catch (err) {
    console.error('[warrants] reset-circuit error', err);
    return c.json({ error: 'Failed to reset circuit' }, 500);
  }
});

// ============================================================
// Warrant CRUD — ported from legacy/server-vps/src/routes/warrants.ts
// ============================================================
// These handlers replace the legacy POST/PUT/GET/DELETE /warrants
// endpoints that previously fell through the proxy to env.LEGACY.
// Two boundary invariants the legacy code didn't enforce strictly:
//
//   1. WRITE BOUNDARY — every nullable column normalises empty input
//      to SQL NULL. `nullify('')`, `nullify(undefined)`, `nullify(null)`,
//      and `nullify('  ')` all return null; non-empty strings are trimmed.
//      This is what stops literal 'N/A' / '' from landing in D1 cells
//      and surfacing as "N/A walls" downstream (see PR #808 and the
//      0046_warrants_null_out_sentinels.sql cleanup).
//
//   2. READ JOIN — `entered_by_name` / `served_by_name` are NEVER stored
//      on the warrants row. They're derived at SELECT time via
//      LEFT JOIN users on the entered_by / served_by foreign keys.
//      Storing the name was the cause of "Entered By: N/A" in PDFs
//      (a stale snapshot of the user's display name); deriving on read
//      means a user rename propagates everywhere automatically.
//
// What's NOT ported here (left on legacy via proxy fall-through):
//   - /dashboard/stats, /dashboard/feed, /dashboard/priority
//   - /expiring, /summary-report, /export
//   - /batch-update, /bulk-archive, /bulk-review
//   - /check/:personId, /person-intel, /utah-search
// These can be ported in follow-ups; they're independent of the
// write-boundary fix that motivated this port.

const ROLES_CRUD_WRITE = ['admin', 'manager', 'supervisor', 'dispatcher'] as const;
const ROLES_CRUD_DELETE = ['admin', 'manager'] as const;
const ROLES_CRUD_READ = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

// Trim a string and treat the empty result as null. Anything non-string
// is coerced to its string form first; null/undefined short-circuit.
// This is the only normalisation we apply on the write boundary; using
// ?? null directly would let an empty-string field land in D1 as ''
// rather than NULL (the exact bug that produced the 'N/A walls').
function nullify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : String(v);
  const t = s.trim();
  return t === '' ? null : t;
}

// Numeric variant — accepts numbers, numeric strings, or empty/null.
// Returns null for unparseable input rather than NaN (which D1 would
// store as a stringly-typed weird cell).
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.trunc(n);
}

// Validate warrant type against the schema CHECK constraint so we fail
// at the route boundary with a clean 400 instead of a D1 constraint
// error. Same enums as live schema (see legacy database.ts line 659).
const WARRANT_TYPES = new Set(['arrest', 'search', 'bench', 'civil', 'fta', 'other']);
const WARRANT_STATUSES = new Set(['active', 'served', 'recalled', 'expired', 'quashed']);
const OFFENSE_LEVELS = new Set(['felony', 'misdemeanor', 'infraction', 'civil']);

// Canonical projection used by every read endpoint. Aliased once so all
// callers — list, detail, post-write returns — speak the same shape and
// the client's Warrant interface gets a consistent payload.
const WARRANT_SELECT_COLS = `
  w.*,
  p.first_name AS subject_first_name,
  p.last_name  AS subject_last_name,
  (p.first_name || ' ' || p.last_name) AS subject_name,
  p.dob        AS subject_dob,
  p.gender     AS subject_gender,
  p.race       AS subject_race,
  p.height     AS subject_height,
  p.weight     AS subject_weight,
  p.hair_color AS subject_hair_color,
  p.eye_color  AS subject_eye_color,
  p.address    AS subject_address,
  p.photo_url  AS subject_photo_url,
  u_entered.full_name AS entered_by_name,
  u_served.full_name  AS served_by_name
`;

const WARRANT_FROM_JOINS = `
  FROM warrants w
  LEFT JOIN persons p          ON w.subject_person_id = p.id
  LEFT JOIN users   u_entered  ON w.entered_by        = u_entered.id
  LEFT JOIN users   u_served   ON w.served_by         = u_served.id
`;

// Derive a human warrant number from the row id. Manual entries use the
// WRN prefix; Utah-API ingests use EXT. Both pad to 5 digits so they
// sort lexicographically (matters for the alpha sort on the list).
function warrantNumberFor(prefix: 'WRN' | 'EXT', id: number | bigint): string {
  return `${prefix}-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
}

// ── GET /warrants/check/:personId — advisory active-warrant check ──
// Called by LinkPersonModal when a person is selected/created on an
// incident, to flash an "ACTIVE WARRANTS" banner. Advisory only (the
// client swallows errors), but legacy 404'd on it. Live `warrants`
// carries BOTH person_id and subject_person_id columns (schema drift),
// so we match either. Returns the shape the client's WarrantCheckResult
// expects: { has_warrants, count, warrants: [...] }.
warrants.get('/check/:personId{\\d+}', requireRole(...ROLES_CRUD_READ), async (c) => {
  try {
    const personId = parseInt(c.req.param('personId') || '', 10);
    if (!Number.isFinite(personId) || personId <= 0) {
      return c.json({ error: 'Invalid person id', code: 'INVALID_ID' }, 400);
    }
    const rows = await query<any>(getDb(c.env), `
      SELECT id, warrant_number, COALESCE(warrant_type, type) AS warrant_type,
             COALESCE(charge_description, offense_description, offense, description) AS charge_description,
             status
      FROM warrants
      WHERE (person_id = ? OR subject_person_id = ?)
        AND status = 'active' AND archived_at IS NULL
      ORDER BY COALESCE(issued_date, created_at) DESC`,
      personId, personId);
    return c.json({
      person_id: personId,
      has_warrants: rows.length > 0,
      count: rows.length,
      warrants: rows,
    });
  } catch (err) {
    console.error('[warrants] check error', err);
    return c.json({ error: 'Failed to check warrants', code: 'WARRANT_CHECK_ERR' }, 500);
  }
});

// ── GET /warrants — list with filters + pagination ──
// Mirrors the legacy filter surface so the WarrantsPage useEffect that
// passes ~16 query params keeps working unchanged. All optional filters
// are AND-combined; absent filter means no clause added.
warrants.get('/', requireRole(...ROLES_CRUD_READ), async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);

    const where: string[] = [];
    const params: unknown[] = [];

    const status = q('status');
    if (status) { where.push('w.status = ?'); params.push(status); }
    const type = q('type');
    if (type) { where.push('w.type = ?'); params.push(type); }
    const source = q('source');
    if (source) { where.push('w.source = ?'); params.push(source); }
    const personId = q('person_id');
    if (personId) {
      const n = parseInt(personId, 10);
      if (Number.isFinite(n)) { where.push('w.subject_person_id = ?'); params.push(n); }
    }
    const subjectName = q('subject_name');
    if (subjectName) {
      const pat = `%${subjectName.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      where.push("((p.first_name || ' ' || p.last_name) LIKE ? ESCAPE '\\' OR w.warrant_number LIKE ? ESCAPE '\\' OR w.charge_description LIKE ? ESCAPE '\\')");
      params.push(pat, pat, pat);
    }
    const court = q('court');
    if (court) {
      where.push("w.issuing_court LIKE ? ESCAPE '\\'");
      params.push(`%${court.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    }
    const severity = q('severity');
    if (severity && OFFENSE_LEVELS.has(severity)) {
      where.push('w.offense_level = ?');
      params.push(severity);
    }

    // Phase 1 chip filters from the WarrantsPage URL state.
    const priorityMin = q('priority_min');
    if (priorityMin) {
      const n = parseInt(priorityMin, 10);
      if (Number.isFinite(n)) {
        where.push('COALESCE(w.priority_score, 0) >= ?');
        params.push(n);
      }
    }
    const sinceDays = q('since_days');
    if (sinceDays) {
      const n = parseInt(sinceDays, 10);
      if (Number.isFinite(n)) {
        where.push("julianday('now') - julianday(COALESCE(w.issue_date, w.created_at)) <= ?");
        params.push(n);
      }
    }
    if (q('matches_person') === '1') {
      where.push('w.subject_person_id IS NOT NULL');
    }
    const state = q('state');
    if (state) {
      where.push('lower(w.source) LIKE ?');
      params.push(`${state.toLowerCase()}_%`);
    }
    const statePrefix = q('state_prefix');
    if (statePrefix) {
      where.push('w.source LIKE ?');
      params.push(`${statePrefix}%`);
    }

    // Archive semantics match the legacy convention:
    //   include_archived=1     → both archived + non-archived
    //   archived=true          → only archived
    //   anything else (incl. unset) → only non-archived
    if (q('include_archived') !== '1') {
      if (q('archived') === 'true') {
        where.push('w.archived_at IS NOT NULL');
      } else {
        where.push('w.archived_at IS NULL');
      }
    }

    // Sort — pick from a whitelist so an attacker can't inject ORDER BY.
    const sortMap: Record<string, string> = {
      priority: 'COALESCE(w.priority_score, 0)',
      age: "julianday('now') - julianday(COALESCE(w.issue_date, w.created_at))",
      freshness: "julianday('now') - julianday(COALESCE(w.last_checked_at, w.updated_at))",
      alpha: 'w.warrant_number',
      created_at: 'w.created_at',
    };
    const sortKey = q('sort') ?? 'created_at';
    const sortCol = sortMap[sortKey] ?? sortMap.created_at;
    const order = q('order') === 'asc' ? 'ASC' : 'DESC';

    const page = Math.max(1, parseInt(q('page') ?? '1', 10) || 1);
    const perPage = Math.min(500, Math.max(1, parseInt(q('per_page') ?? '50', 10) || 50));
    const offset = (page - 1) * perPage;

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await queryFirst<{ total: number }>(
      db,
      `SELECT COUNT(*) AS total FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id ${whereSql}`,
      ...params,
    );
    const total = countRow?.total ?? 0;

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT ${WARRANT_SELECT_COLS},
              CASE WHEN w.subject_person_id IS NOT NULL THEN 1 ELSE 0 END AS matches_person
       ${WARRANT_FROM_JOINS}
       ${whereSql}
       ORDER BY ${sortCol} ${order}
       LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );

    return c.json({
      data: rows,
      pagination: {
        page,
        per_page: perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
      },
    });
  } catch (err) {
    console.error('[warrants] list error', err);
    return c.json({ data: [], pagination: { page: 1, per_page: 0, total: 0, totalPages: 1 } });
  }
});

// ── POST /warrants — create ──
// Two-step write: INSERT with __PENDING__ for warrant_number, then
// UPDATE warrant_number = WRN-YYYY-{id5}. This is the legacy pattern
// — it keeps the number derivable from the row id (race-safe) without
// adding a sequence table. D1 doesn't support RETURNING on INSERT, so
// we read the lastRowId from result.meta.
warrants.post('/', requireRole(...ROLES_CRUD_WRITE), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };

    const typeRaw = nullify(body.type);
    const typeNorm = typeRaw ? typeRaw.toLowerCase() : null;
    if (!typeNorm || !WARRANT_TYPES.has(typeNorm)) {
      return c.json({ error: `type must be one of: ${[...WARRANT_TYPES].join(', ')}`, code: 'TYPE_INVALID' }, 400);
    }

    const charge = nullify(body.charge_description);
    if (!charge) {
      return c.json({ error: 'charge_description is required', code: 'CHARGE_DESCRIPTION_REQUIRED' }, 400);
    }

    const offenseLevel = nullify(body.offense_level);
    if (offenseLevel && !OFFENSE_LEVELS.has(offenseLevel)) {
      return c.json({ error: `offense_level must be one of: ${[...OFFENSE_LEVELS].join(', ')}`, code: 'OFFENSE_LEVEL_INVALID' }, 400);
    }

    const subjectPersonId = intOrNull(body.subject_person_id);
    if (subjectPersonId !== null) {
      const exists = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM persons WHERE id = ?', subjectPersonId);
      if (!exists) {
        return c.json({ error: 'Subject person not found', code: 'SUBJECT_PERSON_NOT_FOUND' }, 404);
      }
    }

    // INSERT — every nullable column normalised through nullify/intOrNull/
    // numOrNull. warrant_number lands as __PENDING__ and gets rewritten
    // below to WRN-YYYY-NNNNN. entered_by is ALWAYS the JWT user.id.
    const insertResult = await execute(
      db,
      `INSERT INTO warrants (
         warrant_number, type, status, subject_person_id, issuing_court, issuing_judge,
         charge_description, bail_amount, offense_level, entered_by, expires_at,
         notes, statute_id, statute_citation, source
       ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      '__PENDING__',
      typeNorm,
      subjectPersonId,
      nullify(body.issuing_court),
      nullify(body.issuing_judge),
      charge,
      numOrNull(body.bail_amount),
      offenseLevel,
      user.id,
      nullify(body.expires_at),
      nullify(body.notes),
      intOrNull(body.statute_id),
      nullify(body.statute_citation),
      'manual',
    );

    const warrantId = Number(insertResult.meta?.last_row_id ?? 0);
    if (!warrantId) {
      console.error('[warrants] create: no last_row_id from D1');
      return c.json({ error: 'Failed to create warrant', code: 'CREATE_WARRANT_ERROR' }, 500);
    }

    await execute(
      db,
      'UPDATE warrants SET warrant_number = ? WHERE id = ?',
      warrantNumberFor('WRN', warrantId),
      warrantId,
    );

    const created = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${WARRANT_SELECT_COLS} ${WARRANT_FROM_JOINS} WHERE w.id = ?`,
      warrantId,
    );

    return c.json(created, 201);
  } catch (err) {
    console.error('[warrants] create error', err);
    return c.json({ error: 'Failed to create warrant', code: 'CREATE_WARRANT_ERROR' }, 500);
  }
});

// ── GET /warrants/:id — detail ──
// Returns the full warrant row + the same JOINed person + entered_by /
// served_by user metadata as the list, plus an `activity` log array.
// Encounters / associates / vehicles deliberately NOT joined here —
// those live on legacy still; the client renders them when present and
// degrades gracefully when missing.
warrants.get('/:id{\\d+}', requireRole(...ROLES_CRUD_READ), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'Invalid warrant id' }, 400);
    }

    const warrant = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${WARRANT_SELECT_COLS} ${WARRANT_FROM_JOINS} WHERE w.id = ?`,
      id,
    );
    if (!warrant) {
      return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    }

    // Activity is optional — pre-migration installs may not have the
    // activity_log table. Degrade gracefully so the detail panel renders.
    let activity: Record<string, unknown>[] = [];
    try {
      activity = await query<Record<string, unknown>>(
        db,
        `SELECT al.id, al.action, al.details, al.created_at,
                u.full_name AS user_name
           FROM activity_log al
           LEFT JOIN users u ON al.user_id = u.id
          WHERE al.entity_type = 'warrant' AND al.entity_id = ?
          ORDER BY al.created_at DESC
          LIMIT 200`,
        id,
      );
    } catch { activity = []; }

    return c.json({ ...warrant, activity });
  } catch (err) {
    console.error('[warrants] detail error', err);
    return c.json({ error: 'Failed to load warrant' }, 500);
  }
});

// ── PUT /warrants/:id — update ──
// Sparse update: only fields present in the request body are touched.
// Same nullify / numOrNull / intOrNull discipline as POST. Non-admins
// can't mutate a 'served' warrant (matches legacy "God Mode" pattern);
// non-admins also can't override warrant_number.
warrants.put('/:id{\\d+}', requireRole(...ROLES_CRUD_WRITE), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const id = parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'Invalid warrant id' }, 400);
    }
    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);

    if (user.role !== 'admin' && existing.status === 'served') {
      return c.json({ error: 'Cannot update a served warrant', code: 'CANNOT_UPDATE_SERVED' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>();
    const provided = Object.keys(body);

    // Map of editable field → its boundary normaliser. nullify for text,
    // numOrNull for money, intOrNull for ids. Keys MUST match a real
    // column on warrants (any unknown key is silently dropped).
    const fieldMap: Record<string, (v: unknown) => unknown> = {
      type: (v) => {
        const n = nullify(v);
        return n ? n.toLowerCase() : null;
      },
      subject_person_id: intOrNull,
      issuing_court: nullify,
      issuing_judge: nullify,
      charge_description: nullify,
      bail_amount: numOrNull,
      offense_level: nullify,
      status: nullify,
      expires_at: nullify,
      notes: nullify,
      statute_id: intOrNull,
      statute_citation: nullify,
    };
    if (user.role === 'admin') {
      fieldMap.warrant_number = nullify;
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of provided) {
      if (!(key in fieldMap)) continue;
      const norm = fieldMap[key](body[key]);
      // Validate the enums we care about, same as POST.
      if (key === 'type' && norm !== null && !WARRANT_TYPES.has(String(norm))) {
        return c.json({ error: `type must be one of: ${[...WARRANT_TYPES].join(', ')}`, code: 'TYPE_INVALID' }, 400);
      }
      if (key === 'status' && norm !== null && !WARRANT_STATUSES.has(String(norm))) {
        return c.json({ error: `status must be one of: ${[...WARRANT_STATUSES].join(', ')}`, code: 'STATUS_INVALID' }, 400);
      }
      if (key === 'offense_level' && norm !== null && !OFFENSE_LEVELS.has(String(norm))) {
        return c.json({ error: `offense_level must be one of: ${[...OFFENSE_LEVELS].join(', ')}`, code: 'OFFENSE_LEVEL_INVALID' }, 400);
      }
      // charge_description NOT NULL — refuse to null it out.
      if (key === 'charge_description' && norm === null) {
        return c.json({ error: 'charge_description cannot be empty', code: 'CHARGE_DESCRIPTION_REQUIRED' }, 400);
      }
      sets.push(`${key} = ?`);
      vals.push(norm);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      vals.push(id);
      await execute(db, `UPDATE warrants SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    }

    const updated = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${WARRANT_SELECT_COLS} ${WARRANT_FROM_JOINS} WHERE w.id = ?`,
      id,
    );
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] update error', err);
    return c.json({ error: 'Failed to update warrant', code: 'UPDATE_WARRANT_ERROR' }, 500);
  }
});

// ── PUT /warrants/:id/serve — mark warrant served ──
// Client (WarrantsPage handleServe) sends PUT with { served_location }.
// Stamps served_by from the JWT, served_at to now, and flips status.
// Only 'active' warrants can be served; everything else is a 400.
warrants.put('/:id{\\d+}/serve', requireRole(...ROLES_CRUD_WRITE), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const id = parseInt(c.req.param('id') ?? '', 10);

    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    if (existing.status !== 'active') {
      return c.json({ error: 'Only active warrants can be served', code: 'ONLY_ACTIVE_CAN_SERVE' }, 400);
    }

    // served_location column added in migration 0064 — persist the operator's
    // typed "Location Served" (the client sends it; the detail panel + record
    // PDF render it). Sentinel-guarded to NULL when blank.
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const servedLocation = nullify(body.served_location);
    await execute(
      db,
      `UPDATE warrants
          SET status = 'served', served_by = ?, served_at = datetime('now'),
              served_location = ?, updated_at = datetime('now')
        WHERE id = ?`,
      user.id, servedLocation, id,
    );

    const updated = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT ${WARRANT_SELECT_COLS} ${WARRANT_FROM_JOINS} WHERE w.id = ?`,
      id,
    );
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] serve error', err);
    return c.json({ error: 'Failed to serve warrant', code: 'SERVE_WARRANT_ERROR' }, 500);
  }
});

// ── POST /warrants/:id/archive — soft-delete by setting archived_at ──
warrants.post('/:id{\\d+}/archive', requireRole(...ROLES_CRUD_WRITE), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') ?? '', 10);
    const existing = await queryFirst<{ id: number; archived_at: string | null }>(
      db, 'SELECT id, archived_at FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    if (existing.archived_at) {
      return c.json({ error: 'Warrant is already archived', code: 'ALREADY_ARCHIVED' }, 400);
    }
    await execute(db, "UPDATE warrants SET archived_at = datetime('now') WHERE id = ?", id);
    const updated = await queryFirst<Record<string, unknown>>(
      db, `SELECT ${WARRANT_SELECT_COLS} ${WARRANT_FROM_JOINS} WHERE w.id = ?`, id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] archive error', err);
    return c.json({ error: 'Failed to archive warrant' }, 500);
  }
});

// ── POST /warrants/:id/unarchive — restore by nulling archived_at ──
warrants.post('/:id{\\d+}/unarchive', requireRole(...ROLES_CRUD_WRITE), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') ?? '', 10);
    const existing = await queryFirst<{ id: number; archived_at: string | null }>(
      db, 'SELECT id, archived_at FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    if (!existing.archived_at) {
      return c.json({ error: 'Warrant is not archived', code: 'NOT_ARCHIVED' }, 400);
    }
    await execute(db, 'UPDATE warrants SET archived_at = NULL WHERE id = ?', id);
    const updated = await queryFirst<Record<string, unknown>>(
      db, `SELECT ${WARRANT_SELECT_COLS} ${WARRANT_FROM_JOINS} WHERE w.id = ?`, id);
    return c.json(updated);
  } catch (err) {
    console.error('[warrants] unarchive error', err);
    return c.json({ error: 'Failed to unarchive warrant' }, 500);
  }
});

// ── DELETE /warrants/:id — hard delete (admin/manager only) ──
// Active warrants can't be deleted (must be archived/recalled first)
// unless the actor is admin. Mirrors the legacy "God Mode" pattern.
warrants.delete('/:id{\\d+}', requireRole(...ROLES_CRUD_DELETE), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number; role: string };
    const id = parseInt(c.req.param('id') ?? '', 10);
    const existing = await queryFirst<{ id: number; status: string }>(
      db, 'SELECT id, status FROM warrants WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Warrant not found', code: 'WARRANT_NOT_FOUND' }, 404);
    if (user.role !== 'admin' && existing.status === 'active') {
      return c.json({ error: 'Cannot delete an active warrant — archive or recall first', code: 'CANNOT_DELETE_ACTIVE' }, 400);
    }
    await execute(db, 'DELETE FROM warrants WHERE id = ?', id);
    return c.json({ success: true, id });
  } catch (err) {
    console.error('[warrants] delete error', err);
    return c.json({ error: 'Failed to delete warrant' }, 500);
  }
});

// ── POST /warrants/ingest-utah — bulk import from Utah API search ──
// Body: { warrants: [{ utah_warrant_id, charges, court_name, ... }] }
// For each row: skip if external_warrant_id already exists (dedupe key),
// otherwise INSERT with source='utah_api', then update warrant_number
// to EXT-YYYY-NNNNN. Returns { imported, skipped, total }.
warrants.post('/ingest-utah', requireRole(...ROLES_CRUD_WRITE), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { id: number };
    const body = await c.req.json<{ warrants?: unknown[] }>().catch(() => ({ warrants: [] }));
    const incoming = Array.isArray(body.warrants) ? body.warrants : [];
    if (incoming.length === 0) {
      return c.json({ error: 'warrants array required', code: 'WARRANTS_ARRAY_REQUIRED' }, 400);
    }

    let imported = 0;
    let skipped = 0;

    for (const raw of incoming) {
      const w = (raw ?? {}) as Record<string, unknown>;
      const utahId = nullify(w.utah_warrant_id ?? w.id);
      if (!utahId) { skipped++; continue; }
      const extId = `utah_api:${utahId}`;

      const dupe = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM warrants WHERE external_warrant_id = ?', extId);
      if (dupe) { skipped++; continue; }

      // charges may arrive as a string OR a JSON-stringified array; collapse
      // both to a readable single string. JSON arrays become "A; B; C".
      let chargeText = nullify(w.charges ?? w.charge_description);
      if (chargeText && chargeText.startsWith('[')) {
        try {
          const arr = JSON.parse(chargeText);
          if (Array.isArray(arr)) chargeText = arr.join('; ') || chargeText;
        } catch { /* keep as-is */ }
      }
      const charge = chargeText ?? 'Utah warrant';

      const insertResult = await execute(
        db,
        `INSERT INTO warrants (
           warrant_number, type, status, charge_description, issuing_court,
           bail_amount, offense_level, entered_by, expires_at, notes,
           source, external_warrant_id, external_source_key, auto_created,
           subject_person_id
         ) VALUES (?, 'arrest', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        '__PENDING__',
        charge,
        nullify(w.court_name),
        numOrNull(w.bail_amount),
        (() => {
          const lv = nullify(w.offense_level);
          return lv && OFFENSE_LEVELS.has(lv) ? lv : null;
        })(),
        user.id,
        nullify(w.expires_at ?? w.issue_date),
        'Imported from Utah warrants API',
        'utah_api',
        extId,
        'utah_api',
        intOrNull(w.subject_person_id),
      );

      const newId = Number(insertResult.meta?.last_row_id ?? 0);
      if (newId) {
        await execute(
          db,
          'UPDATE warrants SET warrant_number = ? WHERE id = ?',
          warrantNumberFor('EXT', newId), newId,
        );
        imported++;
      } else {
        skipped++;
      }
    }

    return c.json({ imported, skipped, total: incoming.length });
  } catch (err) {
    console.error('[warrants] ingest-utah error', err);
    return c.json({ error: 'Failed to ingest utah warrants', code: 'INGEST_UTAH_WARRANTS_ERROR' }, 500);
  }
});

export default warrants;
