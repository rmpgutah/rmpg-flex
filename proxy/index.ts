// ============================================================
// RMPG Flex — API Routing Proxy (rmpg-api-proxy)
// ============================================================
// Sits in front of rmpgutah.us/api/* at the zone level (see proxy/wrangler.toml).
// Dispatches each request to one of two backends:
//
//   env.API    → rmpg-flex-api    (the new Hono Worker in /src/)
//   env.LEGACY → rmpg-flex        (the original CF Worker, bundled Express
//                                  port, source not in this repo)
//
// This is the strangler-fig seam: every path on this list goes to the
// rewrite; everything else falls through to legacy. The rewrite is
// gradually growing its handler coverage, so this list grows over
// time and the legacy Worker shrinks toward eventual deletion.
//
// Matcher kinds:
//   - { kind: 'prefix', value }      — pathname.startsWith(value)
//   - { kind: 'regex',  value, methods? } — value.test(pathname); if methods is
//                                            present, only those HTTP methods route here
//
// Order matters: first match wins. Put more-specific patterns first so a
// /api/dispatch/calls/:id/recommended-units route is recognized before
// the broader /api/dispatch/calls/:id pattern.
// ============================================================

type RouteRule =
  | { kind: 'prefix'; value: string; methods?: string[] }
  | { kind: 'regex'; value: RegExp; methods?: string[] };

// Stubs short-circuit BEFORE any backend dispatch — used when neither
// rmpg-flex nor rmpg-flex-api can serve a path correctly (typically
// missing data or missing handler) and the user-visible 5xx noise is
// worse than a cleanly-empty 200. Each stub MUST include a reason
// comment so future maintainers can see whether the underlying bug
// has since been fixed and the stub is now hiding a working backend.
//
// Stubs match FIRST. Add only paths that:
//   - currently 500 or 4xx in legacy AND
//   - rewrite either doesn't implement them OR can't serve them yet
// Remove a stub the moment its underlying bug is fixed.
interface StubRule {
  match: RegExp;
  methods?: string[];
  // Static JSON body returned with 200 OK. Stubs are intentionally NOT
  // configurable per-request — they exist to silence broken routes, not
  // to model business logic in the proxy layer.
  body: unknown;
  // Free-text reason — shown in `wrangler tail` so it's obvious when a
  // stub fires.
  reason: string;
}

const STUBS: StubRule[] = [
  // /api/warrants/utah-search/auto-poll-status — no handler exists in legacy
  // OR rewrite. WarrantsPage polls this on mount of the Watch tab, so a 404
  // floods the console. Return the empty AutoPollStatus shape the UI tolerates.
  // Remove this stub once the poller is actually implemented in /src/routes/warrants.ts.
  {
    match: /^\/api\/warrants\/utah-search\/auto-poll-status$/,
    methods: ['GET'],
    body: {
      syncStatus: { lastSync: null, warrantCount: 0, status: 'disabled', lastError: null },
      blocked: false,
      runs: [],
      flaggedPersons: [],
      recentHits: [],
      totalPersons: 0,
    },
    reason: 'no poller backend; UI tolerates empty status',
  },
  // /api/personnel/equipment — no equipment table or handler in either backend.
  // PersonnelPage's Equipment tab issues this GET on mount; without a stub
  // it 404s and produces visible console noise. Return [] (callsites do
  // `apiFetch<any[]>('/personnel/equipment')`). Sub-routes (/equipment/:id,
  // /equipment/:id/checkout, etc.) are user-triggered, not background, so they
  // stay 404 until a real implementation lands.
  {
    match: /^\/api\/personnel\/equipment$/,
    methods: ['GET'],
    body: [],
    reason: 'no equipment table/handler; empty list silences dashboard polling',
  },
  // /api/hr/benefits — no hr_benefits table on live D1 (HR rewrite only
  // patched leave_requests / disciplinary_records / review_cycles in
  // PR #660). BenefitsTab GETs this on mount; without a stub it 500s
  // and shows the "Failed to load benefits" toast on every Benefits
  // tab visit. Remove the stub the moment a real hr_benefits schema
  // lands on live D1 — POST is intentionally NOT stubbed so the admin
  // "Add benefit" button still fails loudly until the table exists.
  {
    match: /^\/api\/hr\/benefits$/,
    methods: ['GET'],
    body: [],
    reason: 'no hr_benefits table on live D1',
  },
  // /api/arrests/recent — handler queries `FROM arrests`, no such table
  // on live D1, so it 500s. Both ArrestRecordsPage and the AdminArrestsTab
  // hit this on mount. Stub the shape AdminArrestsTab expects (the wider
  // page also reads `data.records` per ArrestRecordsPage.tsx:291).
  {
    match: /^\/api\/arrests\/recent(\?.*)?$/,
    methods: ['GET'],
    body: { records: [], total: 0 },
    reason: 'no arrests table on live D1',
  },
  // ── Body camera surfaces ──────────────────────────────────────
  // None of these are implemented on the new worker, but the proxy
  // routes /api/personnel/body-cameras + /api/personnel/bodycam-videos
  // to env.API (lines 197-198). BodyCamerasPage fires four parallel
  // GETs on mount and each 404 produces a [BodyCameras] ... console
  // warning. The /upload-*, POST, PUT, DELETE, and /:id sub-paths are
  // user-triggered (not background polling), so they stay 404 until
  // a real implementation lands. GETs only.
  {
    match: /^\/api\/personnel\/body-cameras$/,
    methods: ['GET'],
    body: [],
    reason: 'no body_cameras table; UI tolerates empty list',
  },
  {
    match: /^\/api\/personnel\/bodycam-videos$/,
    methods: ['GET'],
    body: [],
    reason: 'no bodycam_videos table; UI tolerates empty list',
  },
  {
    match: /^\/api\/personnel\/bodycam-videos\/reviews\/pending$/,
    methods: ['GET'],
    body: [],
    reason: 'no reviews surface yet',
  },
  {
    match: /^\/api\/personnel\/bodycam-videos\/redaction-requests$/,
    methods: ['GET'],
    body: [],
    reason: 'no redaction queue yet',
  },
  {
    match: /^\/api\/personnel\/bodycam-videos\/retention\/report$/,
    methods: ['GET'],
    // BodyCamerasPage reads this via apiFetch<any>(...).catch(null), so any
    // empty-shape object is fine. Mirror what the UI actually reads on the
    // retention card: counts default to 0.
    body: { total_videos: 0, retained: 0, eligible_for_purge: 0, purged_this_month: 0 },
    reason: 'no retention engine yet',
  },
  // ── Audit log surfaces ────────────────────────────────────────
  // AuditLogPage opens on /audit/logs?page=1&limit=100 (paginated list) +
  // /audit/stats (totals + top users/actions) on mount, then optionally
  // /audit/compliance-report and /audit/index-stats. Legacy implements
  // /audit/logs at deployed-source line 16641 — but it returns 404 in
  // production (likely a route-registration / auth bug on legacy). Until
  // the real handlers come back, stub all four so the page renders.
  {
    match: /^\/api\/audit\/logs(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 100 } },
    reason: 'legacy /audit/logs 404s; new worker has no audit router',
  },
  {
    match: /^\/api\/audit\/stats$/,
    methods: ['GET'],
    // Matches the AuditStats interface in client/src/pages/AuditLogPage.tsx.
    body: { totalEntries: 0, entriesToday: 0, topActions: [], topUsers: [] },
    reason: 'no audit/stats handler',
  },
  {
    match: /^\/api\/audit\/compliance-report(\?.*)?$/,
    methods: ['GET'],
    body: { compliant: true, gaps: [], generated_at: null },
    reason: 'no compliance engine yet',
  },
  {
    match: /^\/api\/audit\/index-stats$/,
    methods: ['GET'],
    body: { total_entries: 0, estimated_size_mb: 0 },
    reason: 'no index-stats handler',
  },
  // ── Fleet surfaces ────────────────────────────────────────────
  // Proxy routes the whole /api/fleet prefix to env.API but the new
  // worker has no fleet router. FleetPage hits four endpoints on mount.
  // Stub the GETs the dashboards poll. POST/PUT/DELETE stay 404 since
  // those are user-triggered.
  {
    match: /^\/api\/fleet$/,
    methods: ['GET'],
    // The page does `apiFetch<...>('/fleet?...')` and reads `.data` from
    // the result (see fleet-B_2rGABR.js console error path). Match a
    // paginated empty shape; the wider FleetVehicle[] consumers tolerate
    // an empty `data` array.
    body: { data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 200 } },
    reason: 'no fleet handler in new worker yet',
  },
  // Trailing /?... variants — FleetPage calls /fleet?per_page=200 and
  // /fleet?archived=false. The bare-match regex above already covers
  // /fleet (no slash); explicitly match query-string variants too.
  {
    match: /^\/api\/fleet\?.*/,
    methods: ['GET'],
    body: { data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 200 } },
    reason: 'no fleet handler in new worker yet',
  },
  {
    match: /^\/api\/fleet\/analytics(\?.*)?$/,
    methods: ['GET'],
    // Mirrors FleetAnalytics interface in client/src/types/index.ts:1631.
    body: {
      maintenance_cost_trend: [],
      mileage_distribution: [],
      status_breakdown: [],
      fuel_economy_trend: [],
      fleet_summary: {
        total_vehicles: 0,
        avg_mileage: 0,
        avg_mpg: null,
      },
    },
    reason: 'no fleet analytics handler',
  },
  {
    match: /^\/api\/fleet\/dashcam-videos(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 25 } },
    reason: 'no fleet dashcam handler',
  },
  // ── Other dashboard polls ─────────────────────────────────────
  {
    match: /^\/api\/reports\/crime-analysis(\?.*)?$/,
    methods: ['GET'],
    body: { totals: {}, by_type: [], by_day: [], by_hour: [], by_property: [], generated_at: null },
    reason: 'no crime-analysis report yet',
  },
  // /api/records/vehicles/:id/history — PrintRecordButton + VehiclesTab
  // both fetch this when opening a vehicle detail / running a printout.
  // Empty array degrades cleanly to "no prior history".
  {
    match: /^\/api\/records\/vehicles\/\d+\/history$/,
    methods: ['GET'],
    body: [],
    reason: 'no vehicle history index yet',
  },
  // ── Bucket G (system review 2026-05-27) ───────────────────────
  // The following routes are listed in API_ROUTES below as going to
  // env.API, but the new worker has no matching handler (either no
  // mount in routesConfig.ts, or the mount exists but the sub-path
  // isn't registered on the mounted router). All return 404 today.
  // None appeared in the original console dump that triggered this
  // session — they're dashboard polls that haven't actually fired
  // yet because the parent page isn't open. Stubbing pre-emptively
  // so they degrade quietly when those pages eventually open.
  //
  // Skip tracer status/stats — SkipTracerPage dashboard polls.
  // No /api/skiptracer mount in src/routesConfig.ts.
  {
    match: /^\/api\/skiptracer\/status$/,
    methods: ['GET'],
    body: { status: 'idle', running_searches: 0, last_run: null },
    reason: 'no /api/skiptracer mount in new worker',
  },
  {
    match: /^\/api\/skiptracer\/stats$/,
    methods: ['GET'],
    body: { total_searches: 0, searches_this_month: 0, recent_dossiers: [] },
    reason: 'no /api/skiptracer mount in new worker',
  },
  // IPED forensics surface — no /api/iped mount in new worker.
  // ForensicsPage polls the status sub-path on mount.
  {
    match: /^\/api\/iped\/status$/,
    methods: ['GET'],
    body: { configured: false, last_sync: null },
    reason: 'no /api/iped mount in new worker',
  },
  {
    match: /^\/api\/iped\/hash-sets(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no /api/iped mount in new worker',
  },
  // Personnel sub-paths — /api/personnel is mounted (personnel router)
  // but these sub-paths aren't registered there. PersonnelPage opens
  // four tabs that GET them on mount.
  {
    match: /^\/api\/personnel\/schedules(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no /schedules handler in personnel router',
  },
  {
    match: /^\/api\/personnel\/time(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no /time handler in personnel router',
  },
  {
    match: /^\/api\/personnel\/deployments(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no /deployments handler in personnel router',
  },
  {
    match: /^\/api\/personnel\/coverage-gaps(\?.*)?$/,
    methods: ['GET'],
    body: { gaps: [], total_uncovered_minutes: 0 },
    reason: 'no /coverage-gaps handler in personnel router',
  },
  // Reports sub-paths — /api/reports IS mounted to the stubs router
  // in src/routes/stubs.ts but only /response-times exists there.
  // Everything else 404s.
  {
    match: /^\/api\/reports\/incidents-summary(\?.*)?$/,
    methods: ['GET'],
    body: { total_incidents: 0, by_type: [], by_status: [], by_day: [] },
    reason: 'no /incidents-summary in stubs router',
  },
  {
    match: /^\/api\/reports\/crime-trends(\?.*)?$/,
    methods: ['GET'],
    body: { trends: [], top_categories: [] },
    reason: 'no /crime-trends in stubs router',
  },
  {
    match: /^\/api\/reports\/beat-activity(\?.*)?$/,
    methods: ['GET'],
    body: { beats: [] },
    reason: 'no /beat-activity in stubs router',
  },
  {
    match: /^\/api\/reports\/citation-revenue(\?.*)?$/,
    methods: ['GET'],
    body: { total_revenue: 0, by_violation: [], by_month: [] },
    reason: 'no /citation-revenue in stubs router',
  },
  {
    match: /^\/api\/reports\/schedules(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no /schedules in stubs router',
  },
  {
    match: /^\/api\/reports\/templates(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no /templates in stubs router',
  },
  {
    match: /^\/api\/reports\/statute-analytics(\?.*)?$/,
    methods: ['GET'],
    body: { top_statutes: [], by_category: [] },
    reason: 'no /statute-analytics in stubs router',
  },
  // ── Surfaces flagged in 2026-05-27 second-pass console log ────
  // (PR #667 was still open / unmerged when the user opened these pages.
  //  Adding now so they degrade quietly post-merge.)
  //
  // Personnel training tabs — TrainingPage opens three GETs on mount.
  // No `training_records` queries in /src/, legacy queries the table but
  // didn't surface the path. Empty list each.
  {
    match: /^\/api\/personnel\/training(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no training records handler',
  },
  {
    match: /^\/api\/personnel\/training-requirements(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no training-requirements handler',
  },
  {
    match: /^\/api\/personnel\/training-completion(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no training-completion handler',
  },
  // PersonnelAnalyticsDashboard's DutyHoursPanel — guards on
  // `data?.officers?.length` so any object shape passes; we still
  // need to silence the 500 noise.
  {
    match: /^\/api\/personnel\/duty-hours(\?.*)?$/,
    methods: ['GET'],
    body: { officers: [], flagged_excessive_hours: [] },
    reason: 'no duty-hours aggregation handler',
  },
  // ── CRM module (entirely legacy-only on live D1) ──────────────
  // CrmPage's mount issues 6 GETs in parallel. All hit legacy which
  // queries crm_leads / crm_tasks / crm_activity etc — those tables
  // don't exist on live D1. Empty/zeroed shapes match each consumer.
  {
    match: /^\/api\/crm\/dashboard(\?.*)?$/,
    methods: ['GET'],
    body: {
      total_leads: 0, qualified_leads: 0, won_deals: 0, lost_deals: 0,
      pipeline_value: 0, expected_revenue: 0, conversion_rate: 0,
      avg_deal_size: 0, avg_sales_cycle_days: 0,
    },
    reason: 'no crm tables on live D1',
  },
  {
    match: /^\/api\/crm\/recent-activity(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no crm_activity table on live D1',
  },
  {
    match: /^\/api\/crm\/tasks(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no crm_tasks table on live D1',
  },
  {
    match: /^\/api\/crm\/expiring-contracts(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no contract expiry tracking yet',
  },
  {
    match: /^\/api\/crm\/leads\/source-analytics(\?.*)?$/,
    methods: ['GET'],
    body: { by_source: [], total: 0 },
    reason: 'no crm_leads table on live D1',
  },
  {
    match: /^\/api\/crm\/leads\/follow-ups(\?.*)?$/,
    methods: ['GET'],
    body: { overdue: [], today: [], upcoming: [] },
    reason: 'no crm_leads table on live D1',
  },
  {
    match: /^\/api\/crm\/leads\/pipeline-summary(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no crm_leads table on live D1',
  },
  {
    match: /^\/api\/crm\/pipeline-summary(\?.*)?$/,
    methods: ['GET'],
    body: { stages: [], total_value: 0 },
    reason: 'no crm tables on live D1',
  },
  {
    match: /^\/api\/crm\/revenue-forecast(\?.*)?$/,
    methods: ['GET'],
    body: { monthly: [], total_forecast: 0 },
    reason: 'no crm revenue forecast engine',
  },
  // /records/reports/approval-queue — ReportsPage opens this on mount.
  // Was previously routed to env.API via the proxy (line ~152) but no
  // handler exists in /src/routes/records.ts for /reports/approval-queue.
  {
    match: /^\/api\/records\/reports\/approval-queue(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no approval-queue handler in /src/',
  },
  //
  // History:
  //   2026-05-24: Added stub for /api/statutes/search after live D1
  //   was found missing the utah_statutes table. Removed the same day
  //   after schema was applied (PR #637) AND 1387 sections were seeded
  //   from le.utah.gov XML downloads. See scripts/seed/utah_statutes.sql.
  //   2026-05-26: Added stubs above for /warrants/utah-search/auto-poll-status
  //   and /personnel/equipment to silence dashboard polling 404s.
  //   2026-05-27: Added stubs for /hr/benefits, /arrests/recent, the
  //   bodycam quad, the audit quad, fleet (+/analytics, +/dashcam-videos),
  //   /reports/crime-analysis, and /records/vehicles/:id/history to
  //   silence broken-route console floods documented in TRIAGE.md.
];

const API_ROUTES: RouteRule[] = [
  // ── More specific dispatch sub-paths (new in rewrite) ──
  // /api/dispatch/calls/:id/{recommended-units, closest-unit, auto-assign,
  // timeline, warnings} all live on env.API. Listed BEFORE the
  // bare /api/dispatch/calls/:id rule so they win the match.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(recommended-units|closest-unit|auto-assign|timeline|warnings|audit-trail)(\/.*)?$/ },

  // /api/dispatch/calls/:id/{persons,vehicles}[/...] — rewrite implements
  // POST/DELETE/PATCH plus the quick-add fast-path; legacy implements ONLY
  // GET on these (no POST handler) so the dispatch panel's "Link Person"
  // / "Link Vehicle" pickers were silently 404'ing on submit. The client's
  // catch only console.errors, so the user saw no toast and an empty list
  // after refetch — exactly the "I pick + submit, no error, link doesn't
  // appear" symptom reported 2026-05-24. Routing ALL methods on the entire
  // sub-tree to the rewrite makes the round-trip self-consistent.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(persons|vehicles)(\/.*)?$/ },

  // /api/dispatch/calls/check-duplicate — rewrite has correct route ordering
  // (literal /check-duplicate registered before parametric /:id). Legacy
  // hits the /:id handler first and 500s on NaN cast.
  { kind: 'prefix', value: '/api/dispatch/calls/check-duplicate' },

  // GET/PUT/DELETE /api/dispatch/calls/{id} (exact match, no trailing segment)
  // — rewrite avoids the D1 100-column-cap that 500s the legacy GET handler.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+$/, methods: ['GET', 'PUT', 'DELETE'] },

  // POST /api/dispatch/calls (create) — moved to the rewrite 2026-05-26 after
  // the legacy POST was found to compute callNumber but never include it in
  // its INSERT field map (all 4 live rows had call_number = NULL). The new
  // worker generates CFS{YY}-{NNNNN} format, broadcasts on create, and
  // writes an activity_log row for the audit trail.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/?$/, methods: ['POST'] },

  // GET /api/dispatch/calls (bare list, with filters) — moved to the rewrite
  // 2026-05-27 after the legacy handler was found doing `SELECT c.*` against
  // calls_for_service which sits at the D1 100-column cap. SELECT * + three
  // joined helper columns (property_name, dispatcher_name, client_name)
  // returns 103 columns and D1 throws SQLITE_ERROR. The rewrite's handler
  // uses LIST_VIEW_COLUMNS (src/routes/dispatch/calls.ts) for an explicit
  // projection. MdtPage + DispatchPage + archived-list all hit this.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/?(\?.*)?$/, methods: ['GET'] },

  // GET /api/dispatch/queue (MapPage active-calls queue) — same 100-col cap
  // bug as the bare /calls list. New handler in src/routes/dispatch/aggregates.ts
  // uses LIST_VIEW_COLUMNS and mirrors the legacy enrichment loop
  // (age_minutes + _overdue + _expected_response_minutes).
  { kind: 'prefix', value: '/api/dispatch/queue', methods: ['GET'] },

  // POST /api/dispatch/calls/:id/{assign-unit,unassign-unit,dispatch} —
  // MdtPage self-dispatch calls these; the rewrite implements the
  // duplicate-assignment guard + the call_status_for_officer push that
  // the legacy worker doesn't. Without this rule MDT requests fall
  // through to legacy and skip both behaviors.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(assign-unit|unassign-unit|dispatch)$/, methods: ['POST'] },

  // ── Records search (rewrite has all three; legacy is missing /search
  // and /vehicles/search and returns empty `[]` instead) ──
  { kind: 'prefix', value: '/api/records/persons/search' },
  { kind: 'prefix', value: '/api/records/vehicles/search' },
  // /api/records/search?q=...&type=person|vehicle|business — used by
  // client/src/components/LinkRecordModal.tsx. Regex (not prefix) so
  // we don't accidentally swallow /api/records/searchfoo if someone
  // adds an adjacent endpoint later.
  { kind: 'regex', value: /^\/api\/records\/search(\?|$)/ },

  // ── Warrants watch (rewrite has /watch/runs, /watch/scan) ──
  // Legacy uses /warrants/scrapers/* against a different table — those stay
  // on legacy. Only /watch/* is moved.
  { kind: 'prefix', value: '/api/warrants/watch' },

  // ── TTS + PDF signing (rewrite ports of legacy/server-vps endpoints) ──
  // Both currently return 503 from the rewrite (configurable in a follow-up).
  // Routing here so the client gets a structured "not configured" instead
  // of a 404 it logs as a bug.
  { kind: 'prefix', value: '/api/tts' },
  { kind: 'prefix', value: '/api/pdf-tools/sign-payload' },

  // ── Existing routes (preserved from prior proxy deployment) ──
  // Records — Businesses tab, approval queue.
  // /api/records/evidence intentionally NOT routed here: the rewrite has no
  // /evidence handler in src/routes/records.ts, so the prefix sent every
  // GET to a 404. Removed 2026-05-26 so it falls through to legacy, which
  // has the full handler and a populated evidence table on live D1.
  { kind: 'prefix', value: '/api/records/businesses' },
  { kind: 'prefix', value: '/api/records/reports/approval-queue' },
  // Admin extras the legacy worker doesn't implement
  { kind: 'prefix', value: '/api/admin/retention' },
  { kind: 'prefix', value: '/api/admin/departments' },
  { kind: 'prefix', value: '/api/admin/notification-rules' },
  { kind: 'prefix', value: '/api/admin/announcements' },
  // AdminHealthTab observability — currently stubs in the new
  // Worker (src/routes/admin.ts). Listed individually rather than
  // a broad /api/admin prefix because most /api/admin/* still
  // lives on legacy (config, call-templates, clients, audit, etc.)
  // and broadening would silently break those.
  { kind: 'prefix', value: '/api/admin/health/detailed' },
  { kind: 'prefix', value: '/api/admin/changelog' },
  { kind: 'prefix', value: '/api/admin/system-health' },
  { kind: 'prefix', value: '/api/admin/users-activity-summary' },
  { kind: 'prefix', value: '/api/admin/realtime-stats' },
  // Auth security history
  { kind: 'prefix', value: '/api/auth/security/login-history' },
  // Offline-cache sync engine (browser IndexedDB) — entire namespace
  // lives on the new Worker: /sync/pull, /sync/push, /secrets,
  // /my-secret, /secrets/generate. Legacy never implemented any of
  // these, so route everything under /api/offline to env.API.
  { kind: 'prefix', value: '/api/offline' },
  // AI namespace (all)
  { kind: 'prefix', value: '/api/ai/' },
  // Skip tracer v1 status/stats stubs (NOT skiptracer-v2, which is legacy)
  { kind: 'prefix', value: '/api/skiptracer/status' },
  { kind: 'prefix', value: '/api/skiptracer/stats' },
  // IPED status / download info / hash sets
  { kind: 'prefix', value: '/api/iped/' },
  // Personnel tabs that didn't exist in legacy
  { kind: 'prefix', value: '/api/personnel/schedules' },
  { kind: 'prefix', value: '/api/personnel/time' },
  { kind: 'prefix', value: '/api/personnel/deployments' },
  { kind: 'prefix', value: '/api/personnel/coverage-gaps' },
  { kind: 'prefix', value: '/api/personnel/body-cameras' },
  { kind: 'prefix', value: '/api/personnel/bodycam-videos' },
  // PUT + DELETE /api/personnel/:id — rewrite implements edit handler
  // (manager-tier roles can edit anyone, self-edit allowed on a narrow
  // contact/prefs subset) and soft-delete (manager-only, can't delete
  // self, sets status='terminated'). Legacy 404s on both. Scoped to
  // PUT/DELETE only so GET keeps flowing to legacy until the rewrite
  // has a read handler.
  { kind: 'regex', value: /^\/api\/personnel\/\d+$/, methods: ['PUT', 'DELETE'] },
  // POST /api/personnel — rewrite implements create handler
  // (manager-only, case-insensitive username dedup, must_change_password
  // defaults on). Bare /api/personnel kept routing to legacy for GET
  // (list endpoint with org-context filters legacy still owns).
  { kind: 'regex', value: /^\/api\/personnel\/?$/, methods: ['POST'] },
  // Dedicated audited surfaces for role/password/status changes — rewrite-only.
  // Each is locked to a tighter role tier than the general PUT (admin-only
  // for role and password; manager-tier for status). See src/routes/personnel.ts.
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/role$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/reset-password$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/status$/, methods: ['POST'] },
  // Fleet — entire namespace
  { kind: 'prefix', value: '/api/fleet' },
  // Comms BOLOs + message priority stats (legacy has /comms/messages
  // and /comms/bolos/active via stubs; the specific stats paths are new)
  { kind: 'prefix', value: '/api/comms/bolos' },
  { kind: 'prefix', value: '/api/comms/messages/priority-stats' },
  // Reports — analytics endpoints
  { kind: 'prefix', value: '/api/reports/incidents-summary' },
  { kind: 'prefix', value: '/api/reports/response-times' },
  { kind: 'prefix', value: '/api/reports/crime-trends' },
  { kind: 'prefix', value: '/api/reports/beat-activity' },
  { kind: 'prefix', value: '/api/reports/citation-revenue' },
  { kind: 'prefix', value: '/api/reports/schedules' },
  { kind: 'prefix', value: '/api/reports/templates' },
  { kind: 'prefix', value: '/api/reports/statute-analytics' },
  { kind: 'prefix', value: '/api/reports/crime-analysis' },
  // MDT page calls this on first render
  { kind: 'prefix', value: '/api/dispatch/units/mine/audio-mode' },

  // ── Radio subsystem (PR #661) ──
  // The new worker is the only handler. Legacy has no /api/radio/*
  // routes at all, so requests to this prefix have no fallback —
  // they MUST route to the new worker or 404. Without this entry
  // the radio console was effectively broken in production despite
  // /src/routes/radio.ts existing on main.
  { kind: 'prefix', value: '/api/radio' },
];

function matches(rule: RouteRule, pathname: string, method: string): boolean {
  if (rule.methods && !rule.methods.includes(method)) return false;
  if (rule.kind === 'prefix') return pathname.startsWith(rule.value);
  return rule.value.test(pathname);
}

interface Env {
  API: { fetch: typeof fetch };
  LEGACY: { fetch: typeof fetch };
}

function stubMatches(stub: StubRule, pathname: string, method: string): boolean {
  if (stub.methods && !stub.methods.includes(method)) return false;
  return stub.match.test(pathname);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Stubs win over everything else — they exist precisely BECAUSE the
    // real backends can't serve these paths. Visible in wrangler tail.
    for (const stub of STUBS) {
      if (stubMatches(stub, pathname, method)) {
        console.log(`[stub] ${method} ${pathname} — ${stub.reason}`);
        return new Response(JSON.stringify(stub.body), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            // 60s cache so the SPA stops re-hammering the proxy for the
            // same dead endpoint while a user types into a search box.
            'cache-control': 'private, max-age=60',
          },
        });
      }
    }

    for (const rule of API_ROUTES) {
      if (matches(rule, pathname, method)) {
        return env.API.fetch(request);
      }
    }
    return env.LEGACY.fetch(request);
  },
};
