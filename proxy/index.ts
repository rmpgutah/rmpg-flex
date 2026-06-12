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
  // (removed 2026-05-29) /api/warrants/utah-search/auto-poll-status stub —
  // the rewrite now serves a real status handler (src/routes/warrants.ts,
  // buildUtahStatus). Routed to env.API below.
  // /api/personnel/equipment — REAL implementation landed (src/routes/personnel.ts
  // over officer_equipment + equipment_checkout_log, routed to env.API in
  // API_ROUTES). The old GET [] stub is removed so the list + writes + checkout
  // log reach the rewrite instead of being faked empty.
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
  // (2026-05-29 stub-shadowing audit) Removed arrests/recent, body-camera,
  // audit (logs/stats/compliance-report/index-stats), and fleet
  // (bare/analytics/dashcam-videos) stubs — each now has a real handler in
  // the rewrite (arrests.ts, personnel.ts, audit.ts, fleet.ts) whose tables
  // exist on live D1 (verified column-by-column). STUBS run BEFORE
  // API_ROUTES, so leaving them shadowed the real handlers and the pages
  // showed empty data instead of real rows (e.g. Audit's login-failure rate).
  // ── Other dashboard polls ─────────────────────────────────────
  // /api/reports/crime-analysis stub REMOVED 2026-06-09 — the rewrite now has
  // a real handler (reports.ts GET /crime-analysis + /export) returning the
  // CrimeAnalysisPage's {data:{topOffenses,hotspots,...}} contract. The stub's
  // flat shape never matched the client, so the page rendered a permanent
  // "No data available". Routed via API_ROUTES below.
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
  // (2026-05-29 audit) skiptracer /status + /stats stubs removed — real
  // handlers in src/routes/skiptracer.ts (microbilt_searches + skiptracer_dossiers).
  // IPED /status stub REMOVED 2026-06-07: iped.ts GET /status now serves
  // real data; routed to env.API via the /api/iped/ prefix in API_ROUTES.
  // /api/iped/hash-sets stub REMOVED 2026-06-01: iped.ts GET /hash-sets now
  // serves real rows from forensic_hash_sets (returns { sets:[...] }) and is
  // routed to env.API. The stub was shadowing it → page showed no hash sets.
  // (2026-05-29 audit) Removed shadowing stubs for personnel /schedules,
  // /time, /deployments, /coverage-gaps (real handlers in personnel.ts over
  // shift_plans/time_entries/deployments/system_config) and reports
  // /incidents-summary, /crime-trends, /beat-activity, /citation-revenue
  // (real handlers in reports.ts; columns verified on live D1).
  // /reports/schedules + /templates stubs REMOVED 2026-06-07: reports.ts has
  // real GET /schedules and GET /templates handlers. These stubs were
  // shadowing them and forcing those tabs permanently empty.
  // ── Surfaces flagged in 2026-05-27 second-pass console log ────
  // (PR #667 was still open / unmerged when the user opened these pages.
  //  Adding now so they degrade quietly post-merge.)
  //
  // (2026-05-29 audit) Removed shadowing stubs for personnel /training,
  // /training-requirements, /training-completion, /duty-hours — real handlers
  // in personnel.ts over training_records + training_requirements (present on
  // live D1; each wraps queries in try/catch → [] so a schema gap degrades
  // to the same empty the stub returned). /training-alerts + /training-materials
  // stubs stay (no handler / no backing table).
  // ── CRM module — REAL backend now lives on the rewrite ───────────
  // crm_leads / crm_lead_activity / crm_proposals / crm_proposal_templates /
  // crm_tasks / crm_activity were created on live D1 (2026-06-01) and
  // src/routes/crm.ts now serves real data. The fake-data stubs that used to
  // sit here were DELETED — leaving them would shadow the real handlers
  // (STUBS are checked before API_ROUTES). /api/crm now routes to env.API.
  // /records/reports/approval-queue — ReportsPage 'Pending Approvals' tab.
  // STUB REMOVED 2026-06-01: records.ts GET /reports/approval-queue now exists
  // (try/catch-safe, returns [] on error) and is routed to env.API via
  // API_ROUTES. The stub was shadowing it and forcing the tab permanently empty.
  //
  // ── 2026-05-27 batch — silence broken pages until real handlers land ──
  // Each of the entries below was sourced from a single prod console log
  // export covering 60+ unique 4xx/5xx responses across ~12 pages. The
  // common pattern: legacy worker handler exists but the underlying table
  // is missing OR the column the handler reads has been renamed; rewrite
  // has no replacement handler yet. Empty-shape stubs let the page render
  // its empty state instead of crashing into an ErrorBoundary.
  //
  // Categorized by page to make removal triage obvious — when a real
  // handler lands for a subsystem, drop ALL its stubs together.
  //
  // (removed 2026-05-31) Fleet sub-tab stub for fuel-cards/fuel/recalls/
  // health-scores/maintenance-schedule/driver-performance/service-alerts/
  // cost-trends/vehicle-lifecycle/fleet-cost-analytics/inspection-stats/
  // notifications/overdue-inspections/dash-cameras/pretrip. Every one of
  // these now has a real handler in src/routes/fleet.ts AND a backing table
  // on live D1 (migration 0057 aligned the schema to the handlers — fleet
  // tables went 10 → 72). The stub was intercepting GET *and* POST/PUT/DELETE,
  // so it faked `{data:[],total:0}` success on every fuel-log edit/delete,
  // fuel-card CRUD, and recall CRUD — the "saves then vanishes" bug. All
  // fleet paths now fall through to the `/api/fleet` API_ROUTES rule → env.API.
  // (See feedback-proxy-stub-shadows-handler.)
  // Howen handlers now live in src/routes/howen.ts (devices, events, status,
  // devices/:id). Stub removed; requests reach the rewrite via the API_ROUTES
  // rule below.
  // ── Personnel sub-tabs not yet ported ─────────────────────────────────
  // training, training-requirements, training-completion, body-cameras,
  // bodycam-videos (+ retention/report, reviews/pending, redaction-requests),
  // and duty-hours are now real handlers in src/routes/personnel.ts. The
  // remaining sub-paths below (training-alerts, training-materials) still
  // 404 from the rewrite — no backing tables yet — so stub them empty.
  {
    match: /^\/api\/personnel\/training-alerts$/,
    methods: ['GET'],
    body: { alerts: [] },
    reason: 'no training alerts pipeline yet; TrainingPage tolerates empty',
  },
  {
    match: /^\/api\/personnel\/training-materials$/,
    methods: ['GET'],
    body: { data: [] },
    reason: 'no training materials table; TrainingPage tolerates empty data',
  },
  // (2026-05-29 audit) Combined skiptracer /(status|stats) stub removed —
  // real handlers in src/routes/skiptracer.ts. v2 (/api/skiptracer-v2/*) stub
  // is untouched below.
  // (removed 2026-05-29) /api/warrants/scraped/status stub — the rewrite
  // now serves a real status handler (src/routes/warrants.ts). Routed to
  // env.API below.
  // ── HR sub-modules with no backing tables on live D1 yet ─────────────
  // /api/hr/leave* now has a real handler in src/routes/hr.ts (uses the
  // leave_requests table). The remaining sub-paths still 500 on legacy
  // because their tables don't exist. Stub them empty until the schema
  // patches land.
  {
    match: /^\/api\/hr\/(payroll\/(periods|rates|entries|overtime)|grievances|documents|attendance|pips|benefits)/,
    methods: ['GET'],
    body: [],
    reason: 'no backing tables yet; HrPage tabs render empty until schema lands',
  },
  // ── CRM module — stubs removed 2026-06-01; real handlers on the rewrite
  // now own the whole /api/crm namespace (see note above + src/routes/crm.ts).
  // /api/offender-registry/stats now has a real handler in
  // src/routes/offenderRegistry.ts. 2026-06-10: the sex-offender-registry
  // stats/root stubs were REMOVED — routesConfig.ts deliberately dual-mounts
  // offenderRegistry at BOTH /api/offender-registry AND
  // /api/sex-offender-registry (backed by offender_alerts, which exists on
  // live D1), and a /api/sex-offender-registry prefix rule now routes the
  // namespace to env.API below.
  // /api/admin/shift-swaps now has a real handler in src/routes/shiftPlans.ts
  // (alias of /shift-swaps to match the client's existing path). Stub removed.

  // ── 2026-05-27 batch 3 — legacy worker prod-readiness scan ───────────
  // Subagent audit of the deployed `rmpg-flex` (legacy) bundle vs live D1
  // schema found ~22 user-triggered endpoints that 500 because they query
  // missing tables. These are all visible-page mounts (NOT background
  // polling). The proxy can stub the GET responses with shapes the SPA
  // already tolerates; POST/PUT/DELETE on the same paths intentionally
  // stay 404 — those are user-initiated writes and should fail loudly
  // until a real schema + handler lands. Each subsystem grouped for easy
  // bulk removal when the real implementation arrives.
  //
  // ── Admin → Training/Credentials tabs ───────────────────────────────
  // Legacy queries `personnel_certifications` + `officer_credentials`,
  // neither on live D1. Admin training tab opens these on tab switch.
  {
    match: /^\/api\/admin\/expiring-certifications(\?.*)?$/,
    methods: ['GET'],
    body: { certifications: [], total: 0 },
    reason: 'no personnel_certifications table on live D1; admin tab tolerates empty',
  },
  {
    match: /^\/api\/admin\/training(\?.*)?$/,
    methods: ['GET'],
    body: { credentials: [], total: 0 },
    reason: 'no officer_credentials table on live D1; admin training tab tolerates empty',
  },
  // ── Sex-offender registry ────────────────────────────────────────────
  // Root list / stats / export now route to env.API (offenderRegistry.ts is
  // dual-mounted on this prefix). Only /expiring-registrations remains
  // stubbed — no handler for it exists in offenderRegistry.ts, and the
  // routed prefix would otherwise return the rewrite's 404. Listed BEFORE
  // the API_ROUTES prefix rule (STUBS are checked first).
  {
    match: /^\/api\/(sex-)?offender-registry\/expiring-registrations(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no expiring-registrations handler in offenderRegistry.ts; page tolerates empty list',
  },
  // speed-zones stub REMOVED 2026-06-07: gps.ts GET /speed-zones is a real handler;
  // routed to env.API via the new regex rule in API_ROUTES below.
  // ── Trespass orders → violations sub-tab ────────────────────────────
  // TrespassPage detail view opens this when a card is clicked. Empty
  // list = "no violations on file" — a valid UX state.
  {
    match: /^\/api\/trespass-orders\/\d+\/violations(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no trespass_violations table; trespass detail tolerates empty list',
  },
  // Dashcam video links stub REMOVED 2026-06-10: dead — no client calls the
  // bare /api/dashcam-videos path anymore (all callers use
  // /api/fleet/dashcam-videos/:id/links, routed via the /api/fleet prefix),
  // and dashcam_video_links now exists on live D1 (migration 0086).
  // ── Dispatch messages namespace (entire mount dead — no table) ──────
  // Legacy has ~7 routes under /api/dispatch-messages/ all querying
  // `dispatch_messages` (and `dispatch_units` on some) which don't
  // exist. The radio + WebSocket dispatch_update channel is what's
  // actually used in production — this legacy mount appears to be from
  // a never-shipped feature. GET-only stubs; POST stays 404.
  {
    match: /^\/api\/dispatch-messages(\/.*)?(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no dispatch_messages table; namespace appears to be never-shipped legacy feature',
  },
  // ── Statutes top-charged analytics (page opens on stats tab) ────────
  {
    match: /^\/api\/statutes\/analytics\/top-charged(\?.*)?$/,
    methods: ['GET'],
    body: { top: [], total: 0 },
    reason: 'no entity_statutes table (use utah_statutes for lookup, not analytics)',
  },
  // WebAuthn stubs REMOVED 2026-06-10 — the rewrite now implements the full
  // surface (status/credentials/register/authenticate) backed by the
  // webauthn_credentials table (mig 0090, created on live D1). Routed via the
  // /api/auth/webauthn prefix in API_ROUTES below.
  // ── ServeManager job linked-records (typo in legacy handler) ────────
  // Legacy queries `FROM calls` — that table doesn't exist on live D1;
  // the actual dispatch table is `calls_for_service`. The fix can't be
  // applied in source (legacy worker bundle isn't in-repo), so stub
  // empty here. Most ServeManager jobs aren't linked to dispatch calls
  // anyway, so the empty list is a faithful representation.
  {
    match: /^\/api\/servemanager\/jobs\/\d+\/linked-records(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'legacy handler has `FROM calls` typo (should be calls_for_service); empty list is the typical case anyway',
  },

  // ── 2026-05-27 batch 4 — second prod console pass ────────────────────
  // After deploy #686, fresh console revealed more uncovered paths beyond
  // the subagent's static scan (these are runtime-only surfaces — admin
  // tiles, page-specific reports, dispatch GPS analytics).
  //
  // ── Reports comparison (ReportsPage period-over-period card) ────────
  // Body MUST match the ComparisonData shape ReportsPage.tsx:790 reads:
  // { period, calls/incidents/citations:{current,previous,change},
  //   responseTime:{current,previous,change} }. The old {current,previous,
  //   deltas} shape lacked `responseTime`, so ReportsPage's
  //   `comparisonData.responseTime.current` threw and the ErrorBoundary took
  //   down the ENTIRE Reports page in prod (2026-05-29).
  {
    match: /^\/api\/reports\/comparison(\?.*)?$/,
    methods: ['GET'],
    body: {
      period: 'week',
      calls: { current: 0, previous: 0, change: 0 },
      incidents: { current: 0, previous: 0, change: 0 },
      citations: { current: 0, previous: 0, change: 0 },
      responseTime: { current: null, previous: null, change: null },
    },
    reason: 'no comparison handler in src/; shape matches ReportsPage ComparisonData so the card renders empty instead of crashing the page',
  },
  // ── Arrests status (AdminPage tile, separate from /arrests/recent) ──
  {
    match: /^\/api\/arrests\/status(\?.*)?$/,
    methods: ['GET'],
    body: { total: 0, this_week: 0, pending_charges: 0, last_arrest_at: null },
    reason: 'AdminPage Arrests tile — separate from /arrests/recent; new worker has /recent only',
  },
  // IPED /download/info stub REMOVED 2026-06-07: covered by /api/iped/ prefix route.
  // ── Admin → Database utilities (POST integrity-check + vacuum) ──────
  // These are admin-only db maintenance buttons. The legacy worker
  // doesn't implement them and the new worker has no admin/database
  // mount. POSTs are user-clicks (no background polling), so returning
  // a structured "not implemented" body is honest: the button reports
  // success status from the response shape but no actual operation runs.
  // True implementation would require D1 metadata APIs which Workers
  // doesn't expose. Leaving the buttons visible is intentional — admins
  // can request these in writing if they need them.
  {
    match: /^\/api\/admin\/database\/integrity-check$/,
    methods: ['POST'],
    body: { status: 'not_implemented', message: 'D1 integrity check not exposed by Cloudflare Workers runtime' },
    reason: 'no D1 admin API for integrity-check; honest "not implemented" body',
  },
  {
    match: /^\/api\/admin\/database\/vacuum$/,
    methods: ['POST'],
    body: { status: 'not_implemented', message: 'D1 VACUUM is managed by Cloudflare, not exposed to Workers' },
    reason: 'no user VACUUM on D1; honest "not implemented" body',
  },
  // login-history stub REMOVED 2026-06-10: auth.ts now has a real
  // GET /security/login-history against the live `login_attempts` table,
  // returning the union shape both consumers need (LoginHistoryTable reads
  // entries+total; SecurityDashboardPage reads data). The pre-existing
  // API_ROUTES rule for this path now reaches a real handler.
  // ── Skiptracer v2 (different mount from v1) ─────────────────────────
  // The v1 stubs above cover /api/skiptracer/{status,stats}. v2 is a
  // separate legacy mount at /api/skiptracer-v2/* that queries `people_index`,
  // `dossiers` (singular, not skiptracer_dossiers), and `skip_tracer_searches_v`
  // — none of which exist on live D1. Stub GETs only; POST /search stays
  // on legacy because v2 search is the active third-party round-trip path.
  {
    match: /^\/api\/skiptracer-v2\/(status|stats)(\?.*)?$/,
    methods: ['GET'],
    body: { enabled: false, total_searches: 0, recent_dossiers: [] },
    reason: 'v2 mount queries people_index/dossiers/skip_tracer_searches_v — none exist on live D1',
  },
  // ── Dispatch GPS zone-speed-stats (MapPage analytics) ───────────────
  // Different path from /speed-zones (which was stubbed above). This one
  // is the analytics aggregation — likely 500s because the underlying
  // table reference is broken. Stub empty stats; MapPage tolerates this.
  {
    match: /^\/api\/dispatch\/gps\/zone-speed-stats(\?.*)?$/,
    methods: ['GET'],
    body: { zones: [], total_violations: 0, period_hours: 8 },
    reason: 'no zone speed analytics handler; MapPage tolerates empty zones array',
  },

  // ── 2026-06-02 live-sweep batch — endpoints with NO backing table ─────
  // Found by a logged-in page-by-page Network sweep. Each path below has no
  // table on live D1 and no rewrite handler, so it 404/500'd from legacy.
  // Shapes match exactly what the consuming page reads (verified against the
  // component source) so the page renders its empty state instead of
  // crashing/erroring. Remove a stub when its real backend lands.
  //
  // DashcamAiPage: reads evRes.events (array) + fleetRes.units (array) — set
  // straight into state with no `?? []`, so the keys MUST be arrays.
  {
    match: /^\/api\/driving-events(\?.*)?$/,
    methods: ['GET'],
    body: { events: [], total: 0, limit: 200, offset: 0 },
    reason: 'no driving_events table; DashcamAiPage tolerates empty events',
  },
  {
    match: /^\/api\/driving-events\/fleet-health(\?.*)?$/,
    methods: ['GET'],
    body: { units: [] },
    reason: 'no driving_events table; DashcamAiPage fleet-health tolerates empty units',
  },
  // WebResearchPage: reads data?.connected (coerced).
  {
    match: /^\/api\/web-research\/status(\?.*)?$/,
    methods: ['GET'],
    body: { connected: false },
    reason: 'no web-research integration backend; page shows disconnected',
  },
  // ArrestRecordsPage: reads stats?.per_county (array) + population_summary.
  {
    match: /^\/api\/jail-roster\/statistics(\?.*)?$/,
    methods: ['GET'],
    body: { per_county: [], population_summary: { total_records: 0, total_active: 0, total_released: 0 } },
    reason: 'no jail-roster aggregation backend; ArrestRecordsPage tolerates empty per_county',
  },
  // NationalWarrantSearchPage: every access optional-chained — {} is safe.
  {
    match: /^\/api\/warrants\/national-coverage(\?.*)?$/,
    methods: ['GET'],
    body: { sources: 0, states_covered: 0, active_warrants: 0, state_status: {}, state_sources: {}, state_warrants: {} },
    reason: 'no national coverage data source; NationalWarrantSearchPage tolerates zeros',
  },
  // TrainingDocsPage: company-documents now ported to rewrite (PR #1038).
  // Stub removed — requests route to env.API via API_ROUTES below.

  //
  // ── 2026-06-07 post-deploy sweep — pages still polling 404'd paths ───
  // After the 2026-06-06 deploy that restored the proxy as the dispatcher
  // for rmpgutah.us/api/*, a fresh logged-in sweep showed the SPA still
  // polling 23 paths the proxy hadn't been told how to route. Neither
  // the rewrite nor legacy has handlers for any of these today, so they
  // fall through to the default 404. Empty-shape stubs let the consuming
  // page render its "no data" state instead of the prior session's
  // repeated 404/500 noise. Each shape matches what the consuming
  // component reads (verified by reading the page source) so the page
  // renders cleanly.
  //
  // DashboardPage sub-tab cards (ReportsPage + DashboardPage). All
  // optional-chained on the page side, so a small object / null is safe.
  // officer-activity stub REMOVED 2026-06-10: reports.ts:330 has a real,
  // defensive handler returning the bare array BOTH consumers expect
  // (ReportsPage OfficerActivityData[], DashboardPage any[]) — the stub's
  // {data:[]} object shape matched neither. Routed to env.API below.
  {
    match: /^\/api\/reports\/shift-comparison(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, periods: [] },
    reason: 'no shift-comparison backend; DashboardPage tolerates null',
  },
  {
    match: /^\/api\/reports\/clearance-rate(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, rate: null, by_type: [] },
    reason: 'no clearance-rate backend; DashboardPage tolerates null',
  },
  {
    match: /^\/api\/reports\/patrol-coverage(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, beats: [], hours: [] },
    reason: 'no patrol-coverage backend; DashboardPage tolerates null',
  },
  {
    match: /^\/api\/reports\/evidence-pending(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, total: 0, items: [] },
    reason: 'no evidence-pending backend; DashboardPage tolerates null',
  },
  {
    match: /^\/api\/reports\/upcoming-court(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, items: [] },
    reason: 'no upcoming-court backend; DashboardPage tolerates null',
  },
  {
    match: /^\/api\/reports\/overdue-reports(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, items: [], total: 0 },
    reason: 'no overdue-reports backend; DashboardPage tolerates null',
  },
  // ReportsPage tabs
  {
    match: /^\/api\/reports\/daily-briefing(\?.*)?$/,
    methods: ['GET'],
    body: null,
    reason: 'no daily-briefing backend; ReportsPage "Today" tab tolerates null',
  },
  {
    match: /^\/api\/reports\/weekly-digest(\?.*)?$/,
    methods: ['GET'],
    body: null,
    reason: 'no weekly-digest backend; ReportsPage "Week" tab tolerates null',
  },
  {
    match: /^\/api\/reports\/patrol-tracking(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], total: 0, breadcrumbs: [] },
    reason: 'no patrol-tracking backend; ReportsPage + MapPage tolerates empty',
  },
  {
    match: /^\/api\/reports\/command-staff(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, period: null, generated_at: null },
    reason: 'no command-staff backend; useShiftBriefing tolerates null data',
  },
  {
    match: /^\/api\/reports\/shift-scorecard(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, officer_id: null, shift_date: null, score: 0, items: [] },
    reason: 'no shift-scorecard backend; ShiftScorecard tolerates null data',
  },
  // Custom Report Builder POST. Returns success so the Save button
  // doesn't 404; the real save handler can land later.
  {
    match: /^\/api\/reports\/custom(\?.*)?$/,
    methods: ['POST'],
    body: { success: true, id: null, message: 'Custom report save is stubbed' },
    reason: 'no custom-report persistence; CustomReportBuilder tolerates success',
  },
  {
    match: /^\/api\/reports\/shift-notes(\?.*)?$/,
    methods: ['POST'],
    body: { success: true, id: null, message: 'Shift notes save is stubbed' },
    reason: 'no shift-notes persistence; RadialMenu/ShiftHandoff tolerates success',
  },
  // Dispatch geo/heatmap surfaces — no aggregation table or rewrite handler.
  {
    match: /^\/api\/dispatch\/heatmap(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], points: [], total: 0, generated_at: null },
    reason: 'no dispatch heatmap aggregation; DispatchPage tolerates empty',
  },
  // heatmap/types stub REMOVED 2026-06-10: aggregates.ts has a real handler
  // returning the bare {incident_type,count}[] array BOTH consumers expect
  // (useMapHeatmap.ts:48, MapPage.tsx:1231) — the stub's {data,types} object
  // shape matched neither. Routed to env.API below.
  // /api/dispatch/gps/trails stub REMOVED 2026-06-09 — real per-unit trail
  // aggregation now lives in the rewrite (gps.ts GET /trails). The stub's
  // empty {trails:[]} shape is why the Map's Breadcrumbs layer rendered
  // nothing despite 60k+ live breadcrumb rows. Routed in API_ROUTES below.
  // Weather stub REMOVED 2026-06-10: it was SHADOWING the real, already-routed
  // weather handler (src/routes/weather.ts, open-meteo + KV cache, /api/weather
  // prefix rule below) — the route was added but this stub fired first.
  //
  // Auth signature stub REMOVED 2026-06-10: it was the cause of "my saved
  // signature disappeared" — PUT /api/auth/signature fell through to a worker
  // that persisted it, but this stubbed GET always returned {signature:null},
  // so the saved image never came back (UserProfileModal, PrintRecordButton,
  // IncidentsPage all read it). auth.ts has real GET+PUT handlers against
  // users.digital_signature (exists on live D1); routed to env.API below.
  // Comms messaging — the broadcast channel is the live surface; this
  // sub-path is a polling endpoint the rewrite doesn't implement.
  {
    match: /^\/api\/comms\/messages(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], messages: [], total: 0 },
    reason: 'no /comms/messages sub-path in rewrite; CommsPage tolerates empty',
  },
  // Admin surface stubs. Empty objects / arrays so the Settings tab
  // renders its empty state instead of 404'ing on every keystroke.
  {
    match: /^\/api\/admin\/shift-plans(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], plans: [], total: 0 },
    reason: 'no admin shift-plans sub-handler; AdminPage tolerates empty',
  },
  // map-config stub REMOVED 2026-06-10: admin.ts has real GET+PUT handlers
  // (system_config key 'map_config', defensive defaults) and the clients
  // (AdminMapSettingsTab, useMapConfig) read the returned object directly —
  // the stub's null shape kept map settings from ever loading/persisting.
  // PUT fixed for the live composite unique index. Routed below.
  {
    match: /^\/api\/admin\/mapbox-config(\?.*)?$/,
    methods: ['GET'],
    body: { token: null, style: null, default_center: null, default_zoom: null },
    reason: 'no mapbox-config surface; Settings tab tolerates empty object',
  },
  // ── 2026-06-07 round 3 — admin sub-paths that 4xx in browser ──
  // Verified by greping src/routes/<file>.ts for each path string. None
  // matched. Both legacy and rewrite return 4xx; stub so admin pages
  // render empty state.
  {
    match: /^\/api\/admin\/audit\/export(\?.*)?$/,
    methods: ['GET', 'POST'],
    body: { url: null, count: 0, message: 'audit export stubbed' },
    reason: 'no /admin/audit/export; AdminPage tolerates null url',
  },
  {
    match: /^\/api\/admin\/export\/full(\?.*)?$/,
    methods: ['GET', 'POST'],
    body: { url: null, count: 0, message: 'full export stubbed' },
    reason: 'no /admin/export/full; AdminPage tolerates null url',
  },
  // client-error stub REMOVED 2026-06-10: it was SWALLOWING ErrorBoundary's
  // crash telemetry (every client-side crash report POSTed here and got a
  // fake 200). admin.ts now has a real POST (persists to client_errors,
  // created on live D1 + migration 0088) and GET (recent errors). Routed below.
  {
    match: /^\/api\/admin\/shift-plans\/export\/csv(\?.*)?$/,
    methods: ['GET'],
    body: { url: null, count: 0, message: 'shift-plans export stubbed' },
    reason: 'no /admin/shift-plans/export; AdminPage tolerates null url',
  },
  // system-settings stub REMOVED 2026-06-10: admin.ts has real GET (flat
  // key→value map from system_config — what pdfGenerator's branding fetch
  // reads) + PUT (fixed for the live composite unique index — the old
  // ON CONFLICT(config_key) threw because the only unique index is
  // (config_key, config_value)). Routed below.
  // ── 2026-06-07 round 3 — auth sub-paths (2FA, forgot, reset, webauthn, sign-urls) ──
  // Verified: auth.ts has /login, /me, /logout, /refresh, /password, /change-password,
  // /login/change-password, /2fa/status, /security/*, /profile, /profile-image,
  // /sessions, /totp/status. NO /2fa/setup, /forgot-password/*, /reset-password/*,
  // /sign-urls, /webauthn/*, /login/verify-{2fa,backup-code}. Stub the unhandled
  // ones. Most are 404s only when the user actively clicks the feature
  // (forgot-password link, 2FA setup, etc.) — the page still loads.
  // 2fa/setup + 2fa/setup/verify stubs REMOVED 2026-06-09 — real TOTP
  // enrollment now lives in the rewrite (src/routes/auth.ts; RFC 6238 via
  // WebCrypto, AES-GCM secret at rest, hashed single-use backup codes).
  // Routed to env.API in API_ROUTES below.
  {
    match: /^\/api\/auth\/forgot-password(\?.*)?$/,
    methods: ['POST'],
    body: { success: true, message: 'If that email exists, a reset link has been sent' },
    reason: 'no /auth/forgot-password in rewrite; form is a no-op',
  },
  {
    match: /^\/api\/auth\/forgot-password\/reset(\?.*)?$/,
    methods: ['POST'],
    body: { success: false, error: 'password reset is not yet ported' },
    reason: 'no /auth/forgot-password/reset in rewrite',
  },
  {
    match: /^\/api\/auth\/forgot-password\/verify(\?.*)?$/,
    methods: ['POST'],
    body: { success: false, error: 'password reset is not yet ported' },
    reason: 'no /auth/forgot-password/verify in rewrite',
  },
  // login/verify-2fa + login/verify-backup-code stubs REMOVED 2026-06-09 —
  // the rewrite implements the full pending-2FA login exchange (tempToken →
  // tokens). Routed to env.API with the /api/auth/login prefix below.
  {
    match: /^\/api\/auth\/reset-password(\?.*)?$/,
    methods: ['POST'],
    body: { success: false, error: 'password reset is not yet ported' },
    reason: 'no /auth/reset-password in rewrite',
  },
  {
    match: /^\/api\/auth\/reset-password\/validate(\?.*)?$/,
    methods: ['GET', 'POST'],
    body: { valid: false, error: 'password reset is not yet ported' },
    reason: 'no /auth/reset-password/validate in rewrite',
  },
  // sign-urls stub REMOVED 2026-06-10: the rewrite now implements
  // POST /api/auth/sign-urls (per-resource HMAC media signatures) —
  // routed to env.API via the prefix rule below.
  // WebAuthn — proxy already stubs /credentials + /status. Add the OPTIONS
  // + verify endpoints. These are no-op stubs since the rewrite doesn't
  // implement WebAuthn; the user's security settings page renders empty.
  {
    match: /^\/api\/auth\/webauthn\/(authenticate-options|authenticate-verify|register-options|register-verify)(\?.*)?$/,
    methods: ['POST', 'GET'],
    body: { success: false, error: 'WebAuthn is not yet ported', options: null, credential: null },
    reason: 'no /auth/webauthn/* in rewrite; security settings show disabled',
  },
  // ── 2026-06-07 round 3 — personnel sub-paths not in rewrite ──
  // personnel.ts has /training, /training-requirements, /training-completion,
  // /training-alerts, /training-materials, /duty-hours, /schedules, /time,
  // /deployments, /coverage-gaps, /equipment. NO /cert-expiration-warnings,
  // /export/csv, /time-entries (legacy /personnel/time-entries is a different
  // route, was on rmpg-flex-api not legacy).
  {
    match: /^\/api\/personnel\/cert-expiration-warnings(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], warnings: [], total: 0 },
    reason: 'no /personnel/cert-expiration-warnings; PersonnelPage tolerates empty',
  },
  {
    match: /^\/api\/personnel\/export\/csv(\?.*)?$/,
    methods: ['GET'],
    body: { url: null, count: 0, message: 'personnel export stubbed' },
    reason: 'no /personnel/export/csv; ExportButton tolerates null url',
  },
  {
    match: /^\/api\/personnel\/time-entries(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], entries: [], total: 0 },
    reason: 'no /personnel/time-entries; PayrollTab tolerates empty',
  },
  // ── 2026-06-07 round 3 — exports & CSV endpoints ──
  // Each shape matches what ExportButton + ReportsPage read. Verified no
  // handler in the corresponding src/routes/<area>.ts.
  // (code-enforcement export stub removed 2026-06-09 — real handler now in
  // src/routes/codeEnforcement.ts; /api/code-enforcement routes to env.API.)
  {
    match: /^\/api\/comms\/export\/csv(\?.*)?$/,
    methods: ['GET'],
    body: { url: null, count: 0, message: 'comms export stubbed' },
    reason: 'no /comms/export/csv; CommsPage tolerates null url',
  },
  // dar/export stub REMOVED 2026-06-10: /api/dar is routed to env.API and
  // stubs.ts serves /export/csv as an actual (empty) CSV attachment — better
  // for ExportButton than this stub's {url:null} JSON.
  // forensic-lab/export stub REMOVED 2026-06-10: it was SHADOWING the real
  // CSV export in forensics.ts (/api/forensic-lab is routed to env.API below;
  // forensic_cases/exhibits/analyses exist on live D1).
  // (offender-registry export stub removed 2026-06-09 — real handler now in
  // src/routes/offenderRegistry.ts; /api/offender-registry routes to env.API.)
  // sex-offender-registry export stub REMOVED 2026-06-10: offenderRegistry.ts
  // is dual-mounted on /api/sex-offender-registry (now routed below) and has
  // a real /export/csv.
  {
    match: /^\/api\/skiptracer\/export\/csv(\?.*)?$/,
    methods: ['GET'],
    body: { url: null, count: 0, message: 'skiptracer export stubbed' },
    reason: 'no /skiptracer/export/csv in rewrite; tolerates null url',
  },
  {
    match: /^\/api\/skiptracer-v2\/dossiers\/\d+\/pdf(\?.*)?$/,
    methods: ['GET'],
    body: { url: null, message: 'dossier PDF generation stubbed' },
    reason: 'no /skiptracer-v2/dossiers/:id/pdf; SkiptracerPage tolerates null',
  },
  // ── 2026-06-07 round 3 — feature surfaces with no rewrite handler ──
  // diagnostics/ui-trap stub REMOVED 2026-06-10: redundant — /api/diagnostics
  // is routed to env.API and stubs.ts serves POST /ui-trap equivalently.
  // dl-records/ocr-scan stub REMOVED 2026-06-11: real Workers-AI vision
  // handler now in src/routes/dlRecords.ts; routed to env.API below.
  // /downloads/info stub REMOVED 2026-06-07: downloads.ts has real handler.
  {
    match: /^\/api\/evidence$/,
    methods: ['GET'],
    body: { data: [], items: [], total: 0 },
    reason: 'no evidence router; EvidencePage tolerates empty',
  },
  // Firecrawl — no file in src/routes/; everything is a stub.
  {
    match: /^\/api\/firecrawl-tools\/[^/]+\/upload(\?.*)?$/,
    methods: ['POST'],
    body: { success: false, error: 'firecrawl-tools is not yet ported', job_id: null },
    reason: 'no firecrawl-tools in rewrite; UploadButton tolerates error',
  },
  // Email — Phase 1 (admin connection) handlers live on env.API at
  // /api/email/* (see src/routes/email.ts). Stubs kept ONLY for Phase 2+
  // endpoints (messages, attachments, image proxy, rules). /status,
  // /admin/*, and /oauth/* are real handlers — do NOT re-stub them.
  // Phase 2 LIVE — image-proxy and attachment binary proxy now have real
  // handlers in src/routes/email.ts. Stubs removed.
  // Phase 3 LIVE — rules CRUD + test-match now have real handlers in
  // src/routes/email.ts. Stubs removed.
  // Mobile / CFS — no file in src/routes/.
  {
    match: /^\/api\/mobile\/cfs\/\d+\/(auth|challenge|narrative|pso|status)(\?.*)?$/,
    methods: ['GET', 'POST'],
    body: { data: null, items: [], message: 'mobile endpoint stubbed' },
    reason: 'no /mobile/cfs/*; MobilePage tolerates empty',
  },
  // PDF — pdfTools.ts has /encrypt only; pdf-artifacts + pdf-engine/email
  // aren't implemented.
  {
    match: /^\/api\/pdf-artifacts(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], artifacts: [], total: 0 },
    reason: 'no /pdf-artifacts; tolerates empty',
  },
  {
    match: /^\/api\/pdf-engine\/email(\?.*)?$/,
    methods: ['POST'],
    body: { success: false, error: 'pdf-engine email is not yet ported' },
    reason: 'no /pdf-engine/email; tolerates error',
  },
  // Sex offender registry — only /stats in rewrite. The :id list endpoint
  // is on legacy (rmpg-flex). Stub the export + :id so the page doesn't
  // spam the console on every navigation.
  {
    match: /^\/api\/sex-offender-registry\/\d+(\?.*)?$/,
    methods: ['GET'],
    body: { data: null, registry: null, items: [] },
    reason: 'no /sex-offender-registry/:id; tolerates null',
  },
  // updates/check stub REMOVED 2026-06-10: redundant AND wrong-shaped —
  // /api/updates is routed to env.API where stubs.ts GET /check returns the
  // camelCase keys AndroidUpdateChecker actually reads (this stub's
  // snake_case update_available matched nothing).
  // voice-persona stub REMOVED 2026-06-10: redundant — /api/voice-persona is
  // routed to env.API; stubs.ts serves GET / equivalently.
  // Warrants — warrants.ts has /utah-search, /scraped/*, /national-coverage
  // (stubbed), but not /national-search.
  {
    match: /^\/api\/warrants\/national-search(\?.*)?$/,
    methods: ['GET', 'POST'],
    body: { data: [], results: [], total: 0, message: 'national-search stubbed' },
    reason: 'no /warrants/national-search; WarrantsPage tolerates empty',
  },

  //
  // History:
  //   2026-05-24: Added stub for /api/statutes/search after live D1
  //   was found missing the utah_statutes table. Removed the same day
  //   after schema was applied (PR #637) AND 1387 sections were seeded
  //   from le.utah.gov XML downloads. See scripts/seed/utah_statutes.sql.
  //   2026-05-26: Added stubs above for /warrants/utah-search/auto-poll-status
  //   and /personnel/equipment to silence dashboard polling 404s.
  //   2026-05-27: Bulk stub addition (this batch) — fleet, howen, personnel
  //   sub-tabs, hr, crm, offender stats, admin/shift-swaps. Sourced from a
  //   single prod console log export. Remove each subsystem's block when
  //   its real handler lands in /src/.
];

const API_ROUTES: RouteRule[] = [
  // ── Crime layers (new in rewrite) ──
  // /api/crime/slc (cached SLCPD public-crime proxy) + /api/crime/local (our
  // own recent CFS). Only the rewrite has these handlers; legacy 404s.
  { kind: 'prefix', value: '/api/crime' },

  // ── DL records CRUD (new in rewrite) ──
  // /api/dl-records (bare) + /api/dl-records/:id (numeric) → env.API.
  // The legacy port of POST /dl-records 500s on live D1 (manual saves
  // never persisted — live dl_records had 0 rows), so the rewrite owns
  // the data layer. CRITICAL: the /\d+/ anchor means /dl-records/verify
  // (external RapidAPI round-trip) does NOT match and correctly falls
  // through to env.LEGACY. ocr-scan moved to the rewrite 2026-06-11
  // (Workers-AI vision in src/routes/dlRecords.ts) — explicit rule below.
  { kind: 'regex', value: /^\/api\/dl-records(\/\d+)?(\?.*)?$/ },
  { kind: 'regex', value: /^\/api\/dl-records\/ocr-scan(\?.*)?$/ },

  // ── MicroBilt DL search (new in rewrite 2026-06-11) ──
  // POST /api/microbilt/dl/search + GET dl/stats + GET status. Neither
  // worker had these (legacy CF port never included the VPS microbilt
  // router) — the DL SEARCH page 404'd on every search. Local
  // dl_records/persons search + live MicroBilt API when creds configured.
  { kind: 'regex', value: /^\/api\/microbilt\/(dl\/(search|stats)|status)(\?.*)?$/ },

  // ── More specific dispatch sub-paths (new in rewrite) ──
  // /api/dispatch/calls/:id/{recommended-units, closest-unit, auto-assign,
  // timeline, warnings, audit-trail, generate-incident, promote-to-incident}
  // all live on env.API. generate-incident/promote-to-incident: the rewrite's
  // shared generateIncidentFromCall() is schema-verified vs live incidents +
  // audit_log; legacy lacked promote-to-incident entirely (CAD "PI" was 404).
  // Listed BEFORE the bare /api/dispatch/calls/:id rule so they win the match.
  //
  // redispatch / undo-redispatch: re-dispatch ("return visit") chain. Legacy's
  // handler 500s on live D1 — it INSERTs calls_for_service.parent_call_id (+
  // gang_related/fire_requested/hazmat/tags), none of which exist on the live
  // 100-column base table, and snapshots into a call_visit_history schema live
  // repurposed for premise visits. The rewrite stores the chain link on
  // calls_for_service_ext.parent_call_id (migration 0044) and reconstructs
  // visit history from the chain. MUST route here, not fall through to legacy.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(recommended-units|closest-unit|auto-assign|timeline|warnings|audit-trail|generate-incident|promote-to-incident|send-to-serve|serve-link|pin|redispatch|undo-redispatch)(\/.*)?$/ },

  // /api/dispatch/calls/:id/{persons,vehicles}[/...] — rewrite implements
  // POST/DELETE/PATCH plus the quick-add fast-path; legacy implements ONLY
  // GET on these (no POST handler) so the dispatch panel's "Link Person"
  // / "Link Vehicle" pickers were silently 404'ing on submit. The client's
  // catch only console.errors, so the user saw no toast and an empty list
  // after refetch — exactly the "I pick + submit, no error, link doesn't
  // appear" symptom reported 2026-05-24. Routing ALL methods on the entire
  // sub-tree to the rewrite makes the round-trip self-consistent.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(persons|vehicles)(\/.*)?$/ },

  // /api/dispatch/calls/:id/property (PUT/DELETE) — single-property attach/clear
  // for a call. The rewrite (callLinks.ts) owns it and inherits the property's
  // address onto the call; legacy never implemented the write, so the call
  // property panel's attach/clear silently fell through to env.LEGACY and the
  // change never persisted ("save then vanish"). Sibling of persons|vehicles
  // above — same router, just left out of that alternation. GET stays with the
  // dispatchCalls detail payload.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/property$/, methods: ['PUT', 'DELETE'] },

  // /api/dispatch/request-backup — officer backup request (RadialMenu).
  // New rewrite handler (panic.ts); legacy never implemented it → 404.
  { kind: 'prefix', value: '/api/dispatch/request-backup' },

  // /api/dispatch/panic[/*] — OFFICER-SAFETY. The whole panic lifecycle
  // (create, list, acknowledge, resolve, cancel, false-alarm, audio) lives
  // on the rewrite (panic.ts, same router as request-backup above). Its
  // INSERT was written for the LIVE panic_alerts schema (officer_id NOT NULL,
  // trigger_method col, no unit_id). The proxy never routed the namespace, so
  // POST /panic fell through to env.LEGACY whose handler 500'd on every press
  // — the panic button was dead in prod. Route the entire namespace to
  // env.API so the working, schema-matched handler runs.
  { kind: 'prefix', value: '/api/dispatch/panic' },

  // /api/dispatch/anomaly-alerts[/*] — AnomalyAlertBanner read + ack.
  // New rewrite feature (anomalies.ts + anomaly_alerts table + cron
  // detection); legacy never implemented it → the banner silently
  // showed nothing.
  { kind: 'prefix', value: '/api/dispatch/anomaly-alerts' },

  // /api/dispatch/welfare/* — ENTIRE namespace lives on the rewrite. It
  // implements ack/help/snooze/start/activity/active AND holds the
  // WELFARE_WATCH durable-object binding (legacy has neither the handlers
  // nor the DO, so the MDT welfare-check modal's ack/help/snooze all 404'd
  // — an officer-safety break). Durable Objects can't be shared across
  // Workers, so welfare can ONLY work on env.API.
  { kind: 'prefix', value: '/api/dispatch/welfare' },

  // /api/dispatch/geography/* — ENTIRE namespace lives on the rewrite
  // (src/routes/dispatch/geography.ts): /tree, /codes, /districts, and
  // /districts/identify (server-side point-in-polygon over the dispatch_*
  // tables + beat.geojson). Legacy never ported these, so without this rule
  // they fell through to env.LEGACY and 404'd — breaking BOTH the district
  // dropdowns (useDistrictOptions → /districts) AND the address autofill
  // (useDistrictIdentify → /districts/identify), which the New Call form and
  // the dispatch edit panel both depend on for section/zone/beat. Confirmed
  // live: the rewrite handlers are deployed and back the same identifyBeat
  // that already geocodes geography on POST /api/dispatch/calls.
  { kind: 'prefix', value: '/api/dispatch/geography' },
  // /api/dispatch/trips[/*] — Navigation trip logging. ENTIRE namespace on the
  // rewrite (new feature; no legacy handler). Without this it falls through to
  // the legacy worker and 404s.
  { kind: 'prefix', value: '/api/dispatch/trips' },
  // /api/dispatch/address-occupants — New Call modal officer-safety cross-ref
  // (persons on file at the address + warrant/gang/caution flags). New rewrite
  // handler in src/routes/dispatch/premiseHistory.ts; legacy never had it.
  { kind: 'regex', value: /^\/api\/dispatch\/address-occupants(\?|$)/, methods: ['GET'] },
  // /api/dispatch/premise-history — New Call modal premise-history panel
  // (PremiseHistory.tsx → {hasWarnings,total,entries}). Sibling of
  // address-occupants above; the rewrite handler (premiseHistory.ts) was left
  // out of that routing fix, so it fell through to env.LEGACY. Officer-safety
  // (premise warnings) — route to the rewrite so the panel actually loads.
  { kind: 'regex', value: /^\/api\/dispatch\/premise-history(\?|$)/, methods: ['GET'] },
  // /api/geocode/reverse — reverse-geocode a unit's live GPS to a street label
  // for the dispatch unit board. New rewrite handler (src/routes/geocode.ts,
  // KV-cached Nominatim); legacy never had it, so route it explicitly to
  // env.API. /api/geocode/search stays on its existing path.
  { kind: 'regex', value: /^\/api\/geocode\/reverse(\?|$)/, methods: ['GET'] },

  // ── Dispatch GPS breadcrumb write + reads (src/routes/dispatch/gps.ts) ──
  // POST /api/dispatch/gps was NEVER routed here, so the unit-GPS ping fell
  // through to env.LEGACY. The legacy handler (a) stamps units.gps_updated_at
  // as Denver wall-clock mislabeled "+00:00" — i.e. ~6h in the past, so the
  // dispatch board flags EVERY live unit as "GPS LOST" — and (b) never writes
  // units.gps_heading / units.gps_speed (columns added in migration 0065), so
  // the map nav-cursor arrow is stuck pointing north with no speed. The rewrite
  // handler writes datetime('now') (UTC) AND mirrors heading/speed onto the
  // unit row, fixing both. Route ONLY the three paths the rewrite implements:
  //   POST /api/dispatch/gps           (breadcrumb write — the bug)
  //   GET  /api/dispatch/gps/current   (latest position per unit)
  //   GET  /api/dispatch/gps/my-unit   (caller's own unit row)
  // The bare path is POST-only (the rewrite has no GET '/' handler) and the
  // GET sub-paths are anchored to (current|my-unit). This deliberately does
  // speed-zones and zone-speed-stats now have real handlers in gps.ts.
  { kind: 'regex', value: /^\/api\/dispatch\/gps\/?(\?.*)?$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/gps\/(current|my-unit|speed-zones|zone-speed-stats)(\?.*)?$/, methods: ['GET'] },
  // Breadcrumb trail UI (2026-06-09): /trails was a proxy stub and /history
  // 404'd on BOTH workers — the Map breadcrumbs layer + replay panel never
  // had a backend. units-with-trails moves here too: the legacy copy returns
  // { id } where the panel reads { unit_id, officer_name, earliest, ... },
  // so its picker queried unit_id=undefined.
  { kind: 'regex', value: /^\/api\/dispatch\/gps\/(trails|history|units-with-trails)(\?.*)?$/, methods: ['GET'] },
  // The OTHER gps.ts GET reads (my-vehicle, dwell-times, units-with-trails,
  // speed-violations[/:id/acknowledge], pursuit-segments, speed-heatmap) are
  // deliberately NOT routed here and DELIBERATELY fall to env.LEGACY. Verified
  // 2026-06-09 by reading the deployed `rmpg-flex` bundle: legacy carries
  // BYTE-IDENTICAL handlers for all of them (same SQL, same defensive catch→[],
  // same live D1), so the fall-through serves correct data. They were only
  // routed to env.API for the POST write + the two time-sensitive reads (current/
  // my-unit) above, where the legacy bug (Denver-as-UTC gps_updated_at, no
  // heading/speed) actually mattered. Do NOT "fix" the unrouted reads — that is a
  // no-op cutover with added risk. (history-map handled by the next rule.)

  // /api/dispatch/history-map — historical CALL locations for the Map overlay
  // (useMapboxHistoryCalls / useMapCallHistory). The client calls this bare
  // path, but legacy mounts its only `history-map` handler under /dispatch/gps
  // (a per-UNIT breadcrumb trail, a DIFFERENT feature), so the bare path fell
  // through and 404'd — the historical-call overlay was always empty. The
  // rewrite now serves the real calls-history aggregate (aggregates.ts), fully
  // defensive (degrades to []). Route the bare path to env.API. The gps trail
  // path (/dispatch/gps/history-map) deliberately stays on legacy above.
  { kind: 'regex', value: /^\/api\/dispatch\/history-map(\?.*)?$/, methods: ['GET'] },

  // /api/dispatch/heatmap/enforcement — enforcement-activity clusters for the
  // Map "Enforcement" overlay (src/routes/dispatch/aggregates.ts). Legacy has
  // NO handler for it, so it fell through to env.LEGACY and 404'd (console
  // spam on the Map page). The rewrite clusters citations through their call's
  // coordinates, fully defensive (degrades to [] on any schema drift). Scoped
  // to /enforcement ONLY — sibling /api/dispatch/heatmap/timelapse stays on
  // env.LEGACY (which DOES serve it; the rewrite has no timelapse handler).
  { kind: 'prefix', value: '/api/dispatch/heatmap/enforcement' },
  // /api/dispatch/heatmap/types — incident-type counts for the Map heatmap
  // legend (useMapHeatmap + MapPage). Real handler in aggregates.ts returns
  // the bare {incident_type,count}[] array the clients read; its wrong-shaped
  // proxy stub was removed 2026-06-10.
  { kind: 'prefix', value: '/api/dispatch/heatmap/types', methods: ['GET'] },
  // /api/dispatch/heatmap/predictions — predicted-hotspots overlay (MapPage
  // useMapPredictions). Sibling of /enforcement; the rewrite handler
  // (aggregates.ts) is fully defensive (degrades to {hotspots:[]}). Route to
  // env.API so the overlay reflects the intended 90-day model rather than the
  // legacy fallback. (/heatmap/timelapse still stays on legacy — no rewrite handler.)
  { kind: 'prefix', value: '/api/dispatch/heatmap/predictions', methods: ['GET'] },
  // /api/dispatch/disposition-stats — DispatchPage "DISPS:" strip. The rewrite
  // handler (aggregates.ts) normalizes sentinel dispositions and is all-time
  // (the client is written/labeled for all-time); the legacy fallback windows to
  // 12h and mislabels it. Route to env.API for the correct, defensive version.
  { kind: 'regex', value: /^\/api\/dispatch\/disposition-stats(\?.*)?$/, methods: ['GET'] },
  // /api/dispatch/analysis/summary — MapPage Analysis overlay (useAnalysisSummary).
  // The rewrite handler (aggregates.ts) is fully defensive (every sub-query
  // .catch-degrades); legacy is the dead-code fallback. Route to env.API.
  { kind: 'regex', value: /^\/api\/dispatch\/analysis\/summary(\?.*)?$/, methods: ['GET'] },

  // /api/dispatch/calls/check-duplicate — rewrite has correct route ordering
  // (literal /check-duplicate registered before parametric /:id). Legacy
  // hits the /:id handler first and 500s on NaN cast.
  { kind: 'prefix', value: '/api/dispatch/calls/check-duplicate' },
  // GET /api/dispatch/calls/export — DispatchPage CSV export (ExportButton).
  // The rewrite handler (calls.ts) emits MT-localized CSV with a 50k-row cap and
  // the LIST_VIEW projection that dodges the D1 100-column cap the legacy
  // `SELECT *` export hits. Literal path — placed before /calls/:id and the bare
  // list rules so it can't be swallowed by either.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/export(\?.*)?$/, methods: ['GET'] },

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
  // POST /api/dispatch/calls/:id/{hold,resume} — "call hold" is a rewrite-only
  // feature: hold is an orthogonal flag in calls_for_service_ext.held_at
  // (migration 0041), preserving status while held. The legacy worker never
  // implemented either route, so without this rule both fell through to
  // env.LEGACY and 404'd — the DispatchPage hold button silently failed.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(hold|resume)$/, methods: ['POST'] },
  // POST /api/dispatch/calls/:id/status — MUST route to the rewrite. The legacy
  // handler writes status_changed_at + dispatched_at/enroute_at/onscene_at via
  // localNow(), which stamps Denver-local wall-clock as +00:00 — so every
  // transition rendered ~6h off (e.g. an 11:35 MDT dispatch stored as
  // "11:35+00:00" → displayed 05:35). The rewrite uses datetime('now') (UTC)
  // and sets status_changed_at/archived_at/notes for parity. Without this rule
  // the path fell through to env.LEGACY and the timezone bug persisted.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/status$/, methods: ['POST'] },

  // ── Dispatch call-action endpoints (PR #711) ──
  // revert-status / le-notification / transfer / broadcast-note /
  // generate-incident, notes edit/delete, the /status disposition fix
  // (writes cleared_at in UTC + persists disposition), and /archive-bulk.
  // Without these the paths fall through to env.LEGACY, which loses the
  // disposition and writes status timestamps as local MST mislabeled +00:00.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(revert-status|le-notification|transfer|broadcast-note|generate-incident|notes)$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/notes\/[^/]+$/, methods: ['PUT', 'DELETE'] },
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/status$/, methods: ['POST'] },
  // Single-call archive — rewrite writes archived_at in UTC; legacy mislabels MST.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/archive$/, methods: ['POST'] },
  // POST /api/dispatch/calls/:id/unarchive — restore an archived call (the
  // archived-list "unarchive" action, useDispatchCallActions). Rewrite handler
  // (calls.ts) sets status back to closed; the /archive rule above is anchored
  // /archive$ so it does NOT match unarchive, which fell through to env.LEGACY.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/unarchive$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/archive-bulk$/, methods: ['POST'] },

  // /api/dispatch/run-cards[/*] — Spillman-style canned dispatch templates
  // (RunCardPreview on the New Call form + the run-card admin editor). The whole
  // runCards router (GET list/by-type/:id + POST/PUT/DELETE) lives ONLY on the
  // rewrite (src/routes/runCards.ts over dispatch_run_cards); legacy never had
  // it, so every run-card read/write fell through to env.LEGACY.
  { kind: 'prefix', value: '/api/dispatch/run-cards' },

  // /api/dispatch/stats — top-level dispatch stats rollup. Rewrite handler
  // in src/routes/stubs.ts (bare-mount GET '/' — polled every 30s by the
  // dispatch layout). Was stubbed in proxy 2026-06-07 round 2; that stub
  // was removed once the real handler landed.
  { kind: 'prefix', value: '/api/dispatch/stats', methods: ['GET'] },

  // ── Records search (rewrite has all three; legacy is missing /search
  // and /vehicles/search and returns empty `[]` instead) ──
  { kind: 'prefix', value: '/api/records/persons/search' },
  { kind: 'prefix', value: '/api/records/vehicles/search' },
  // /api/records/persons (bare, GET) + /api/records/vehicles (bare, GET) —
  // bulk record lists for the SYNC layer (RecordsPage tab loads, PinRecord
  // autocompletes). Rewrite handlers in src/routes/records.ts. Were falling
  // through to env.LEGACY (no handler) → 404. Regex anchored to bare path
  // with optional query string so it can't shadow /persons/:id, /persons/search,
  // /vehicles/:id, /vehicles/search, or /vehicles/stolen-check.
  { kind: 'regex', value: /^\/api\/records\/persons(\?.*)?$/, methods: ['GET'] },
  { kind: 'regex', value: /^\/api\/records\/vehicles(\?.*)?$/, methods: ['GET'] },
  // POST /api/records/vehicles/stolen-check — NCIC-style stolen-vehicle check.
  // The handler exists in src/routes/records.ts but was never routed, so the
  // path fell through to env.LEGACY which has no handler → 404 (VehiclesTab +
  // DlSearchPage both call it, live 2026-06-02). Anchored exact-match so it
  // can't be shadowed by the /vehicles/:id DELETE or /vehicles/:id/history rules.
  { kind: 'regex', value: /^\/api\/records\/vehicles\/stolen-check$/, methods: ['POST'] },
  // /api/records/ncic-query?type=person|warrant|vehicle|phone|address — the
  // NCIC/NLETS terminal (QH/QV/QW/QT/QA + the QX cross-reference fan-out).
  // Ported to the rewrite (src/routes/records.ts) which fixes the legacy
  // warrants.subject_person_id SQL error (live column is person_id) and
  // soft-fails missing tables so PERSON/WARRANT queries stop 500ing. Regex so
  // we don't swallow an adjacent /api/records/ncic-* path later.
  { kind: 'regex', value: /^\/api\/records\/ncic-query(\?|$)/ },
  // /api/records/search?q=...&type=person|vehicle|business — used by
  // client/src/components/LinkRecordModal.tsx. Regex (not prefix) so
  // we don't accidentally swallow /api/records/searchfoo if someone
  // adds an adjacent endpoint later.
  { kind: 'regex', value: /^\/api\/records\/search(\?|$)/ },
  // /api/records/links (+ /links/:id) — manual cross-entity linkage
  // (LinkRecordModal + LinkedRecordsSection). The legacy handler never
  // persisted a single row in production (record_links stayed empty, no
  // record_linked audit) — its created_by bind relied on a `userId` claim
  // that isn't guaranteed, so every INSERT threw and the link "vanished"
  // on refresh. The rewrite handler (src/routes/records.ts) sources
  // created_by from the DB-verified user.id and writes UTC timestamps.
  // Regex covers GET/POST /links and DELETE /links/:id; matched on
  // pathname (no query), so no `\?` branch needed.
  { kind: 'regex', value: /^\/api\/records\/links(\/\d+)?$/ },
  // DELETE /api/records/persons/:id and /api/records/vehicles/:id — hard-delete
  // a record. The legacy handler issues a bare `DELETE FROM persons|vehicles_records`
  // that 500s on D1 foreign-key children: call_persons / call_vehicles are
  // RESTRICT (no ON DELETE), so any person on a call (12 live) or that vehicle
  // (1 live) can never be deleted. The rewrite handler (src/routes/records.ts)
  // clears the RESTRICT junctions, detaches owned-vehicle ownership (nullable),
  // sweeps the orphan polymorphic record_links, then deletes — CASCADE children
  // (incident_*, serve_queue_*, case_*_links) clean themselves. Anchored to the
  // bare numeric id + DELETE only, so /archive, /unarchive, /history and the
  // GET/POST/PUT person+vehicle endpoints stay on legacy.
  { kind: 'regex', value: /^\/api\/records\/persons\/\d+$/, methods: ['DELETE'] },
  { kind: 'regex', value: /^\/api\/records\/vehicles\/\d+$/, methods: ['DELETE'] },

  // ── Warrants watch (rewrite has /watch/runs, /watch/scan) ──
  { kind: 'prefix', value: '/api/warrants/watch' },
  // Utah warrant pull — display + status + person profile, all on the rewrite
  // (src/routes/warrants.ts over utah_warrants + warrant_watch_runs).
  // /api/warrants/utah (prefix) also matches /api/warrants/utah-search/* by
  // startsWith — intended, both go to the rewrite now.
  { kind: 'prefix', value: '/api/warrants/utah' },
  { kind: 'prefix', value: '/api/warrants/scraped/status' },
  // /api/warrants/search-all — unified cross-source warrant search (WarrantsPage
  // "SEARCH ALL" tab). New handler in src/routes/warrants.ts; legacy never had
  // it, so the POST 404'd and the tab threw an unhandled rejection.
  { kind: 'prefix', value: '/api/warrants/search-all' },
  { kind: 'regex', value: /^\/api\/warrants\/person\/\d+\/profile$/, methods: ['GET'] },
  // /api/warrants/dashboard/* (stats, feed, priority) + /api/warrants/expiring
  // — the DASHBOARD tab widgets. Legacy served these against the empty manual
  // `warrants` table, so every card read 0 while the Watch List showed real
  // Utah hits. Ported to src/routes/warrants.ts where they aggregate
  // utah_warrants (confirmed vs unverified by linked-person DOB) + manual
  // warrants + warrant_scraper_config. Route to env.API.
  { kind: 'prefix', value: '/api/warrants/dashboard' },
  { kind: 'regex', value: /^\/api\/warrants\/expiring$/, methods: ['GET'] },
  // /api/warrants/scrapers* — Sources tab + Layout header badge + per-source
  // trigger/reset-circuit buttons. Legacy `rmpg-flex` had /scrapers handlers
  // but they queried columns that don't exist on live D1 (`source_key`,
  // `enabled`, `circuit_broken`, `consecutive_errors`, `last_scrape_at`) and
  // joined a non-existent `scraped_warrants` table — falling through to
  // legacy returned silently-empty data (the "F-grade Utah scraper showing
  // stale error" / "Sources tab was 404-empty" symptoms). The rewrite
  // synthesizes the ScraperSource shape from warrant_scraper_config +
  // warrant_watch_runs + utah_warrants (see src/routes/warrants.ts) with
  // a SOURCE_REGISTRY for display metadata. Prefix covers /scrapers,
  // /scrapers/health, /scrapers/:source_key/trigger,
  // /scrapers/:source_key/reset-circuit. NOTE: /scrapers/bulk (admin
  // batch toggle, Phase 4) has no rewrite handler yet; will 404 from
  // env.API the same way it 404s from legacy today.
  { kind: 'prefix', value: '/api/warrants/scrapers' },

  // ── Warrant CRUD — ported from legacy to src/routes/warrants.ts ──
  // GET /api/warrants                — list with filters + pagination
  // POST /api/warrants               — create (auto-generates WRN-YYYY-NNNNN)
  // GET/PUT/DELETE /api/warrants/:id — detail/update/delete
  // PUT /api/warrants/:id/serve      — mark served
  // POST /api/warrants/:id/archive   — soft delete
  // POST /api/warrants/:id/unarchive — restore
  // POST /api/warrants/ingest-utah   — bulk Utah API import
  // These were all 404 / on env.LEGACY before. Routing them to env.API
  // closes the strangler-fig seam for the manual-entry write path
  // (the proximate cause of "N/A walls" — see PR #808 / migration 0046).
  // NOTE: unported sibling endpoints (/dashboard/*, /expiring, /export,
  // /summary-report, /check/:id, /batch-update, /bulk-archive, /bulk-review,
  // /person-intel, /utah-search) are deliberately NOT matched here — they
  // continue to fall through to env.LEGACY until their own ports land.
  // /api/warrants/check/:personId — advisory active-warrant lookup used by
  // the incident LinkPersonModal. Ported to src/routes/warrants.ts (legacy
  // 404'd). Two segments after /warrants so it never collides with the
  // single-segment /warrants/:id CRUD regex below.
  { kind: 'regex', value: /^\/api\/warrants\/check\/\d+$/, methods: ['GET'] },
  { kind: 'regex', value: /^\/api\/warrants\/ingest-utah$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/warrants\/\d+\/serve$/, methods: ['PUT'] },
  { kind: 'regex', value: /^\/api\/warrants\/\d+\/archive$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/warrants\/\d+\/unarchive$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/warrants\/\d+$/, methods: ['GET', 'PUT', 'DELETE'] },
  { kind: 'regex', value: /^\/api\/warrants\/?$/, methods: ['GET', 'POST'] },

  // ── Incident NIBRS sub-resources — ported to src/routes/incidentSubresources.ts ──
  // The IncidentsPage detail panels (Offenses / Responding Officers /
  // Cross-References / Supplements) POST+GET these. Legacy 404'd (officers)
  // or 500'd against a MINIMAL live schema (incident_offenses lacked
  // ucr_code/nibrs_code/counts/...; incident_links omitted the NOT-NULL
  // added_by; supplemental_reports lacked subject/status). Migration 0064
  // widened the tables and these routes go to the rewrite's real handlers.
  // ONLY the sub-resource paths are routed — base /api/incidents CRUD stays
  // on legacy (deliberately, per its working-page note). The supplement
  // regex also covers the dv/pursuit string suffixes served by
  // incidentSupplements.ts so those reach env.API too.
  { kind: 'regex', value: /^\/api\/incidents\/\d+\/(offenses|officers|links)(\/\d+)?$/ },
  { kind: 'regex', value: /^\/api\/incidents\/\d+\/supplements(\/(dv|pursuit|\d+))?$/ },

  // ── TTS + PDF signing (rewrite ports of legacy/server-vps endpoints) ──
  // /api/tts now synthesizes real audio via Workers AI (@cf/myshell-ai/melotts,
  // src/routes/tts.ts) and returns audio/mpeg the client decodes directly; on
  // any synth failure it returns 503 so the client falls back to browser
  // SpeechSynthesis. /pdf-tools/sign-payload now returns a real Ed25519
  // signature from the rewrite (key derived from PDF_SIGNING_KEY or JWT_SECRET).
  // Routing both to env.API.
  { kind: 'prefix', value: '/api/tts' },
  { kind: 'prefix', value: '/api/pdf-tools/sign-payload' },

  // ── Existing routes (preserved from prior proxy deployment) ──
  // Records — Businesses tab, approval queue.
  // /api/records/evidence intentionally NOT routed here: the rewrite has no
  // /evidence handler in src/routes/records.ts, so the prefix sent every
  // GET to a 404. Removed 2026-05-26 so it falls through to legacy, which
  // has the full handler and a populated evidence table on live D1.
  { kind: 'prefix', value: '/api/records/client-persons' },
  { kind: 'prefix', value: '/api/records/businesses' },
  { kind: 'prefix', value: '/api/records/reports/approval-queue' },
  // Audit — entire namespace lives in src/routes/audit.ts (logs, stats,
  // index-stats, compliance-report). Legacy never had any of these so
  // requests were 404ing on the AuditLogPage. Mounted in routesConfig.ts
  // at /api/audit; this rule routes the prefix to env.API.
  { kind: 'prefix', value: '/api/audit' },
  // Admin extras the legacy worker doesn't implement
  // Console/System Settings — entire CRUD lives in src/routes/adminSettings.ts
  // (mounted at /api/admin/settings in routesConfig.ts) backed by the
  // system_settings table on live D1 (seeded via migrations 0049/0050).
  // Legacy never had this surface, so requests were falling through and
  // 500ing on the AdminSettingsTab "Failed to load settings" screen.
  { kind: 'prefix', value: '/api/admin/settings' },
  { kind: 'prefix', value: '/api/admin/retention' },
  { kind: 'prefix', value: '/api/admin/departments' },
  { kind: 'prefix', value: '/api/admin/notification-rules' },
  // /api/admin/third-party-keys[/...] — admin key vault (GET list, GET :key,
  // PUT, DELETE). Rewrite handlers in src/routes/admin.ts over the
  // system_config allowlist (~60 keys). Was never routed, so the Admin
  // Integrations tab's bulk GET 404'd and the page fell back to per-key
  // fetch (N+1). Prefix covers /third-party-keys and /third-party-keys/:key.
  { kind: 'prefix', value: '/api/admin/third-party-keys' },
  // /api/admin/users[/...] — officer list (GET /users, /users/presence)
  // for the PatrolPage assignment picker. Rewrite handler in
  // src/routes/admin.ts. Was stubbed in proxy 2026-06-07; that stub was
  // removed once the real handler landed. Prefix covers /users and
  // /users/presence. Sibling /api/admin/users-activity-summary already has
  // its own explicit rule; /api/admin/users- would not match /users$
  // here so there's no overlap.
  { kind: 'prefix', value: '/api/admin/users' },
  // Officer-facing announcements reader (src/routes/announcements.ts).
  // Legacy has no /api/announcements surface, so route to env.API.
  { kind: 'prefix', value: '/api/announcements' },
  // Console Settings — real handler lives in src/routes/adminSettings.ts
  // (mounted at /api/admin/settings in routesConfig.ts) backed by the
  // system_settings table on live D1 (428 rows, rich schema). Legacy never
  // had this surface, so without this rule requests fall through to
  // env.LEGACY and 500, producing the "Failed to load settings" screen on
  // /api/admin/settings duplicate removed — already listed above (~line 1352).
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
  // AdminPage tiles added 2026-05-27 (stubbed in src/routes/admin.ts).
  { kind: 'prefix', value: '/api/admin/api-stats' },
  { kind: 'prefix', value: '/api/admin/user-activity-heatmap' },
  { kind: 'prefix', value: '/api/admin/backup-status' },
  { kind: 'prefix', value: '/api/admin/maintenance-mode' },
  // ── 2026-06-10 un-stub batch — real handlers in src/routes/admin.ts ──
  // system-settings: GET (flat config map — pdfGenerator branding) + PUT
  // (save, fixed for the live composite (config_key,config_value) unique
  // index). map-config: GET/PUT map defaults (AdminMapSettingsTab +
  // useMapConfig). health/client-error: POST = ErrorBoundary crash telemetry
  // (was swallowed by a stub), GET = recent errors for the admin console.
  { kind: 'prefix', value: '/api/admin/system-settings' },
  { kind: 'prefix', value: '/api/admin/map-config' },
  { kind: 'prefix', value: '/api/admin/health/client-error' },
  // /api/admin/notification-rules duplicate removed — already listed above (~line 1355).
  // Auth security history
  { kind: 'prefix', value: '/api/auth/security/login-history' },
  // Auth: profile photo + active sessions + MFA status — handlers in
  // src/routes/auth.ts. Legacy serves login/refresh/me/signature, but these four
  // newer paths have no legacy handler (404, live sweep 2026-06-02). They read
  // only live-schema columns (users.profile_image/.totp_enabled/.totp_backup_codes,
  // sessions.is_active/expires_at), so they run correctly on the rewrite — unlike
  // login/refresh, whose handlers reference columns absent from live sessions.
  // The /sessions prefix also carries DELETE /sessions/:id (the "Revoke" button).
  { kind: 'prefix', value: '/api/auth/profile-image' },
  { kind: 'prefix', value: '/api/auth/sessions' },
  // ── Login + two-factor subtree → rewrite (2026-06-09) ──────
  // /api/auth/login prefix covers /login, /login/verify-2fa,
  // /login/verify-backup-code, and /login/change-password — ALL of which
  // exist in the rewrite (src/routes/auth.ts). The rewrite's login is the
  // SAME code lineage as the deployed legacy login (token claims, session
  // row contract, bcrypt compare verified identical via
  // workers_get_worker_code), so tokens/sessions stay interchangeable —
  // and it adds the TOTP gate (requires2FA + tempToken) that legacy lacks.
  { kind: 'prefix', value: '/api/auth/login' },
  { kind: 'prefix', value: '/api/auth/totp/setup' },
  { kind: 'prefix', value: '/api/auth/totp/verify-setup' },
  { kind: 'prefix', value: '/api/auth/totp/disable' },
  { kind: 'prefix', value: '/api/auth/2fa/setup' },
  { kind: 'prefix', value: '/api/auth/2fa/backup-codes' },
  { kind: 'prefix', value: '/api/auth/totp/status' },
  { kind: 'prefix', value: '/api/auth/sign-urls' },
  { kind: 'prefix', value: '/api/auth/webauthn' },
  { kind: 'prefix', value: '/api/auth/2fa/status' },
  // /api/auth/signature GET+PUT (UserProfileModal, PrintRecordButton,
  // IncidentsPage) — auth.ts persists/reads users.digital_signature. The GET
  // was stubbed null in this proxy for months while PUT fell through to a
  // worker that saved it: signatures were being stored but never displayed.
  { kind: 'prefix', value: '/api/auth/signature' },
  // Signed media URLs (sig/exp/nonce for <video>/<audio> tags) — rewrite-only
  // endpoint (src/routes/auth.ts POST /sign-urls); legacy never had it.
  { kind: 'prefix', value: '/api/auth/sign-urls' },
  // Offline-cache sync engine (browser IndexedDB) — entire namespace
  // lives on the new Worker: /sync/pull, /sync/push, /secrets,
  // /my-secret, /secrets/generate. Legacy never implemented any of
  // these, so route everything under /api/offline to env.API.
  { kind: 'prefix', value: '/api/offline' },
  // AI namespace (all)
  { kind: 'prefix', value: '/api/ai/' },
  // Skip tracer v1 — /status, /stats, /dossiers, /dossiers/:id are real
  // handlers in /src/routes/skiptracer.ts (replaced the PR #667 stubs).
  // Legacy still owns POST /search (the Microbilt round-trip), so route
  // only the read paths here and let /search fall through to legacy.
  { kind: 'prefix', value: '/api/skiptracer/status' },
  { kind: 'prefix', value: '/api/skiptracer/stats' },
  { kind: 'prefix', value: '/api/skiptracer/dossiers' },
  // IPED — real handlers in /src/routes/iped.ts: /status, /hash-sets[/:id],
  // /downloads (read-only over forensic_hash_sets + iped_imports). The
  // broad prefix is preserved — any other /api/iped/* path still hits
  // env.API (and 404s there), matching prior behavior. The legacy worker
  // never implemented /api/iped/* so falling through wouldn't help.
  { kind: 'prefix', value: '/api/iped/' },
  // Personnel sub-paths — roster/time/deployment/schedules.
  // The rewrite now has full CRUD for schedules (shift_plans) and time entries
  // INCLUDING clock-in/out and break endpoints (POST /time/clock-in, /clock-out,
  // /start-break, /end-break). Route ALL /schedules and /time traffic to rewrite.
  { kind: 'prefix', value: '/api/personnel/schedules' },
  // ALL /api/personnel/time/* → rewrite (clock-in, clock-out, start-break,
  // end-break, GET list, POST create, PUT edit, DELETE).
  { kind: 'prefix', value: '/api/personnel/time' },
  { kind: 'prefix', value: '/api/personnel/deployments', methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/coverage-gaps', methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/body-cameras' },
  { kind: 'prefix', value: '/api/personnel/bodycam-videos' },
  // training reads + duty-hours: GET handlers live in src/routes/personnel.ts.
  // The rewrite implements ONLY GET /training, /training-requirements,
  // /training-completion — NOT the writes (POST/PUT/DELETE /training,
  // /training-bulk-assign) nor /training/{academy,compliance,lesson-plans}. The
  // old broad `prefix /api/personnel/training` (all methods) routed those to the
  // rewrite too, where they 404'd — the Training page's create/edit/delete +
  // academy/compliance/lesson-plans tabs broke. Route ONLY the three real GETs
  // to env.API; everything else under /training* falls through to the legacy
  // app's full Training backend (strictly not-worse than a guaranteed rewrite 404).
  { kind: 'regex', value: /^\/api\/personnel\/training(-requirements|-completion)?(\?.*)?$/, methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/duty-hours' },
  // activity / fitness / commendations — handlers in src/routes/personnel.ts
  // (audit_log+activity_log union; personnel_fitness; personnel_commendations).
  // Legacy never implemented these → 404 before this route. GET + POST.
  { kind: 'prefix', value: '/api/personnel/activity' },
  { kind: 'prefix', value: '/api/personnel/fitness' },
  { kind: 'prefix', value: '/api/personnel/commendations' },
  // Credentials (certs/licenses) — GET/POST /credentials + PUT/DELETE
  // /credentials/:id, all in src/routes/personnel.ts over officer_credentials
  // (migration 0076). Previously GET returned a hardcoded [] and the writes had
  // no route → fell to legacy (missing table) or premise-stub fake-200.
  { kind: 'regex', value: /^\/api\/personnel\/credentials\/?(\?.*)?$/, methods: ['GET', 'POST'] },
  { kind: 'regex', value: /^\/api\/personnel\/credentials\/\d+$/, methods: ['PUT', 'DELETE'] },
  // Officer equipment (issue / return / checkout-log) — handlers in
  // src/routes/personnel.ts over officer_equipment + equipment_checkout_log.
  // The bare GET /equipment stub above is removed so these reach the rewrite.
  { kind: 'prefix', value: '/api/personnel/equipment-log' },
  { kind: 'regex', value: /^\/api\/personnel\/equipment(\/.*)?$/ },
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/equipment$/, methods: ['POST'] },
  // Howen — handlers in src/routes/howen.ts (status, devices[/:id], events).
  { kind: 'prefix', value: '/api/howen/' },
  // Admin shift-swaps alias — handler in src/routes/shiftPlans.ts.
  { kind: 'prefix', value: '/api/admin/shift-swaps' },
  // HR leave — handler in src/routes/hr.ts (balances + list + CRUD).
  { kind: 'prefix', value: '/api/hr/leave' },
  // Offender registry — full CRUD + risk-score + contacts + export in
  // src/routes/offenderRegistry.ts (widened from /stats-only, 2026-06-09
  // 404 sweep: root list/POST, /:id/clear, /:id/risk-score, /:id/contacts).
  { kind: 'prefix', value: '/api/offender-registry' },
  // routesConfig.ts dual-mounts the SAME offenderRegistry router at
  // /api/sex-offender-registry (root list, /stats, /export/csv, all backed by
  // offender_alerts on live D1). Stubs for this namespace removed 2026-06-10;
  // only /expiring-registrations (no handler) and /:id (legacy-only) remain
  // stubbed above — STUBS are checked before this prefix rule.
  { kind: 'prefix', value: '/api/sex-offender-registry' },
  // Arrests — handlers in src/routes/arrests.ts (manual booking subset,
  // /recent, /search, /export/csv, /:id/cross-links). Legacy doesn't
  // implement /recent so the page 500'd on first paint.
  { kind: 'prefix', value: '/api/arrests' },
  // PUT + DELETE /api/personnel/:id — rewrite implements edit handler
  // (manager-tier roles can edit anyone, self-edit allowed on a narrow
  // contact/prefs subset) and soft-delete (manager-only, can't delete
  // self, sets status='terminated'). Legacy 404s on both. Scoped to
  // PUT/DELETE only so GET keeps flowing to legacy until the rewrite
  // has a read handler.
  { kind: 'regex', value: /^\/api\/personnel\/\d+$/, methods: ['PUT', 'DELETE'] },
  // GET + POST /api/personnel — both on the rewrite now. POST is the create
  // handler (manager-only, case-insensitive username dedup, must_change_password
  // defaults). GET is the officer list: the rewrite handler returns the FULL
  // record set (contact/HR/DL + unit_call_sign) the detail panel reads, and
  // honors ?status= so the PersonnelPage Archives view (status=inactive) and
  // active view (status=active) populate server-side instead of the dead
  // ?archived= param legacy ignored.
  { kind: 'regex', value: /^\/api\/personnel\/?$/, methods: ['GET', 'POST'] },
  // Dedicated audited surfaces for role/password/status changes — rewrite-only.
  // Each is locked to a tighter role tier than the general PUT (admin-only
  // for role and password; manager-tier for status). See src/routes/personnel.ts.
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/role$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/reset-password$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/personnel\/\d+\/status$/, methods: ['POST'] },
  // ── Connections (analyst graph) ──
  // Entire namespace is rewrite-only: /search, /graph, /path, and
  // /investigations CRUD all live in src/routes/connections.ts (backed by
  // connection_investigations on live D1). The legacy `rmpg-flex` Worker
  // never ported the VPS connections feature, so the page's /connections/*
  // calls had NO backend and the graph rendered empty. No STUB matches
  // this prefix, so routing here can't be shadowed.
  { kind: 'prefix', value: '/api/connections' },
  // Fleet — entire namespace
  { kind: 'prefix', value: '/api/fleet' },
  // Clients + CRM — the rewrite (src/routes/clients.ts, src/routes/crm.ts)
  // owns these; legacy 404s on /api/clients and 500s on the un-stubbed
  // /api/crm/* paths (proposals, proposal-templates, leads?…). Route the
  // whole namespaces to env.API. NOTE: the fake-data CRM stubs earlier in
  // this file (dashboard/tasks/etc.) are still checked FIRST, so they keep
  // shadowing those specific paths until the real handlers replace them —
  // when CRM gets real tables, delete those stubs so live data flows
  // (see [[feedback-proxy-stub-shadows-handler]]).
  { kind: 'prefix', value: '/api/clients' },
  { kind: 'prefix', value: '/api/crm' },
  // Risk / Jail / QA / Victim-services — routers exist in the rewrite
  // (src/routes/{risk,jail,qa,victimServices}.ts) and their backing tables
  // (risk_assessments, inmates, qa_reviews, victim_services_records) all exist
  // on live D1. Legacy 404s on these, so the RiskPage/JailPage/QAPage/
  // VictimServicesPage mounts errored. risk/jail/qa self-guard with a
  // sqlite_master table-existence check; victim_services_records confirmed
  // present. Route the whole namespaces to env.API.
  { kind: 'prefix', value: '/api/risk' },
  { kind: 'prefix', value: '/api/jail' },
  // System-wide unified search (rewrite-only handler).
  { kind: 'prefix', value: '/api/knowledge-base' },
  { kind: 'prefix', value: '/api/qa' },
  { kind: 'prefix', value: '/api/victim-services' },
  // ── Rewrite-only feature namespaces (2026-06-01 audit) ──────────
  // Each of these has a REAL handler in src/routes/* that queries the
  // shared live D1 (NOT a pure stub), and legacy 404s on them — the
  // corresponding pages (Accreditation, Internal Affairs, Alarms,
  // Assets, Billing, Cases, Citations, Community, Court, Crisis, Field
  // Interviews, Forensics, Gang Intel, Incidents, Interagency,
  // Narcotics, NIBRS, Patrol, Recruitment, Special Ops, Tasks,
  // Training) errored on mount. Because both legacy and the rewrite hit
  // the SAME D1, a real-handler route returns the same rows legacy
  // would — so routing can't hide data (the regression vector is only
  // pure-stub routers, which were excluded from this batch). Verified:
  // none of these had a prior proxy mention, so no nuanced regex route
  // is being clobbered. Excluded from the batch (deliberately left on
  // legacy / handled elsewhere): user, notifications, email, weather,
  // integrations (stubs.ts — would shadow real legacy data), health +
  // map-data (public, work on legacy), voice (realtime), dl-records
  // (careful regex), documents/document-intake/business-*/trespass-
  // orders/presence (stub or no clean handler).
  { kind: 'prefix', value: '/api/accreditation' },
  { kind: 'prefix', value: '/api/affairs' },
  { kind: 'prefix', value: '/api/alarms' },
  { kind: 'prefix', value: '/api/alerts' },
  { kind: 'prefix', value: '/api/assets' },
  { kind: 'prefix', value: '/api/billing' },
  { kind: 'prefix', value: '/api/community' },
  { kind: 'prefix', value: '/api/crisis' },
  { kind: 'prefix', value: '/api/field-interviews' },
  // Field photos — mobile camera portal uploads (src/routes/fieldPhotos.ts).
  // New rewrite surface; legacy never had it.
  { kind: 'prefix', value: '/api/field-photos' },
  { kind: 'prefix', value: '/api/downloads' },
  { kind: 'prefix', value: '/api/forensics' },
  { kind: 'prefix', value: '/api/gang-intel' },
  { kind: 'prefix', value: '/api/interagency' },
  // NOTE: /api/{incidents,citations,cases,court} deliberately NOT routed —
  // core RMS/judicial namespaces the legacy worker likely already serves with
  // working handlers (never observed 404ing). Routing a possibly-less-complete
  // rewrite handler could regress a working page even on the shared DB. Route
  // them only after confirming those pages actually error on legacy.
  { kind: 'prefix', value: '/api/narcotics' },
  // /api/nav[/*] — Navigation trip logging + take-home vehicle check
  // (src/routes/nav.ts). The entire /api/nav/* namespace is on the rewrite;
  // legacy never had it, so requests fall through to env.LEGACY and 404
  // (NavPage "No current trip" / 404 toast on /nav/trip/current + /nav/trip/history
  // + /nav/vehicle-take-home). The rewrite mounts at /api/nav in routesConfig.ts
  // with full GET/POST/PUT handlers for trip lifecycle. Note this is distinct
  // from /api/dispatch/trips (a sibling that lives under /api/dispatch and
  // routes dispatch-side trip stats); both namespaces reach the same DB but
  // the proxy rule is per-prefix so each gets its own line.
  { kind: 'prefix', value: '/api/nav' },
  { kind: 'prefix', value: '/api/nibrs' },
  { kind: 'prefix', value: '/api/patrol' },
  { kind: 'prefix', value: '/api/recruitment' },
  { kind: 'prefix', value: '/api/special-ops' },
  { kind: 'prefix', value: '/api/tasks' },
  { kind: 'prefix', value: '/api/training' },
  // /api/integrations/* — the real integrations router (src/routes/integrations.ts)
  // owns the rmpgutahps service config pair + the integration_api_keys table CRUD
  // + the request log query. Legacy never had this surface — requests fell through
  // to env.LEGACY and 404'd, so the Admin Integrations tab could not read or write
  // keys. Note: /api/integrations/mapbox/client-token is served by the geocode
  // router (mounted at /api/geocode with a cross-mount note) — both reach the
  // same Worker, so this prefix captures it too.
  { kind: 'prefix', value: '/api/integrations' },
  // /api/voice/* HTTP endpoints (POST /dialogue, POST /read-aloud) are NEW
  // rewrite handlers in src/routes/voice.ts — legacy 404s on them. The TRAILING
  // SLASH is load-bearing: it routes /api/voice/dialogue + /api/voice/read-aloud
  // to env.API while NOT matching /api/voice-ws (the realtime VoiceHubDO socket,
  // which the client connects to directly and is handled ahead of this).
  { kind: 'prefix', value: '/api/voice/' },
  // Comms BOLOs + message priority stats (legacy has /comms/messages
  // and /comms/bolos/active via stubs; the specific stats paths are new)
  { kind: 'prefix', value: '/api/comms/bolos' },
  { kind: 'prefix', value: '/api/comms/messages/priority-stats' },
  // Reports — analytics endpoints
  { kind: 'prefix', value: '/api/reports/incidents-summary' },
  { kind: 'prefix', value: '/api/reports/response-times' },
  // officer-activity: real handler in reports.ts returns the bare array both
  // ReportsPage and DashboardPage expect (its proxy stub returned a wrong
  // {data:[]} object for months — removed 2026-06-10).
  { kind: 'prefix', value: '/api/reports/officer-activity' },
  { kind: 'prefix', value: '/api/reports/crime-trends' },
  { kind: 'prefix', value: '/api/reports/beat-activity' },
  { kind: 'prefix', value: '/api/reports/citation-revenue' },
  { kind: 'prefix', value: '/api/reports/schedules' },
  { kind: 'prefix', value: '/api/reports/templates' },
  { kind: 'prefix', value: '/api/reports/statute-analytics' },
  // /api/reports/crime-analysis (+ /export) — real ILP handler in the rewrite
  // (reports.ts) as of 2026-06-09; the old proxy stub is gone.
  { kind: 'prefix', value: '/api/reports/crime-analysis' },
  // /api/reports/dashboard — 8-tile rollup. Rewrite handler in
  // src/routes/reports.ts (GET /dashboard, whitelisted from the
  // requireRole(analytics) middleware). Was stubbed in proxy 2026-06-07;
  // that stub was removed once the real handler landed.
  { kind: 'prefix', value: '/api/reports/dashboard', methods: ['GET'] },
  // /api/reports/shift-activity/:officerId → env.API (rewrite reports.ts).
  // Officer end-of-shift report (MDT). Use [^/]+ for the id segment — the
  // client sends localStorage rmpg_user_id, which may be non-numeric.
  { kind: 'regex', value: /^\/api\/reports\/shift-activity\/[^/]+(\?.*)?$/, methods: ['GET'] },
  // Officer shift lifecycle → env.API (rewrite dispatch/duty.ts). The
  // integrated "Start/End Shift" clocks the officer in/out, flips units.status
  // in-service↔off-duty, and assigns/releases the fleet vehicle in one atomic
  // action — it lives on the rewrite because that's where fleet management is.
  { kind: 'prefix', value: '/api/dispatch/duty' },
  // Vehicle inspection (QR-token-authed). /api/inspections/by-token/:token/...
  // resolves the shift via time_entries.qr_token and writes inspection rows +
  // R2 photos. PUBLIC — token IS the credential. Rewrite-only.
  { kind: 'prefix', value: '/api/inspections' },
  // /api/dispatch/shift-handoff — shift handoff notes. Rewrite-only handler
  // (shiftHandoff.ts) backed by a real table (migration 0077). Previously a
  // stub that acknowledged writes but never persisted.
  { kind: 'prefix', value: '/api/dispatch/shift-handoff' },
  // MDT page calls this on first render
  { kind: 'prefix', value: '/api/dispatch/units/mine/audio-mode' },
  // /api/dispatch/units/:id/{audio-mode,mileage} — rewrite implements both
  // (audioMode router). Legacy implemented NEITHER, so the MDT audio toggle
  // and the CAD "MI" mileage command 404'd. Route the numeric-id sub-paths
  // to the rewrite. (unit status stays on legacy — its transition-guard
  // handler is solid and already working.)
  { kind: 'regex', value: /^\/api\/dispatch\/units\/\d+\/(audio-mode|mileage)$/ },
  // Unit management → env.API (the rewrite's hardened units.ts):
  //   POST   /units               create (honors status + setup fields:
  //                               vehicle_id/capabilities/assigned_beat/audio_mode,
  //                               which legacy dropped),
  //   PUT    /units/:id           update (column-allowlisted),
  //   DELETE /units/:id           delete (admin/manager; 409 if still on a call),
  //   POST   /units/:id/dispose   admin disposal — force-clears a stuck call
  //                               assignment then deletes (mode:'delete') or
  //                               retires/out-of-services (mode:'retire').
  // Legacy (the ~30-40% port) had no working DELETE, so admins could never
  // remove units. GET /units and PUT /units/:id/status intentionally stay on
  // legacy (its status transition-guard handler is solid + broadcasts on the
  // legacy /api/ws socket the client listens on).
  // GET is included so the board reads the rewrite's full `SELECT u.*` (all
  // unit columns incl capabilities/assigned_beat/audio_mode) — the edit modal
  // pre-fills from it, so a partial legacy row would otherwise blank those
  // fields on save. Same live D1, so status-on-legacy stays consistent.
  { kind: 'regex', value: /^\/api\/dispatch\/units$/, methods: ['GET', 'POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/units\/\d+\/dispose$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/units\/\d+$/, methods: ['PUT', 'DELETE'] },

  // ── Audit subsystem ──
  // Live D1 `audit_log` had only id+created_at columns (an unused stump)
  // until the audit-rewrite PR added user_id/action/entity_type/entity_id/
  // /api/audit duplicate removed — already listed above (~line 1345).

  // ── Radio subsystem (PR #661) ──
  // The new worker is the only handler. Legacy has no /api/radio/*
  // routes at all, so requests to this prefix have no fallback —
  // they MUST route to the new worker or 404. Without this entry
  // the radio console was effectively broken in production despite
  // /src/routes/radio.ts existing on main.
  { kind: 'prefix', value: '/api/radio' },

  // ── Dispatch AI (Workers AI) ──
  // /api/ai/{suggest-units,analyze,config,status,health,...} now have real
  // GPS-aware handlers on the new Worker (src/routes/ai.ts + utils/dispatchAi.ts
  // using env.AI). Without this rule they fall through to env.LEGACY (AI was
  // never configured there) and return "unconfigured".
  { kind: 'prefix', value: '/api/ai' },

  // ── Settings sync (per-user + org defaults) ──
  // GET/PUT /api/settings* live ONLY on the new Worker (src/routes/settings.ts,
  // tables from migration 0045). Without this rule the path falls through to
  // env.LEGACY and 404s, so cross-device sync + org defaults silently no-op.
  { kind: 'prefix', value: '/api/settings' },

  // ── Utah law book (statutes + admin rules) ──
  // Cutover of /api/statutes/* from legacy to the new Worker (src/routes/
  // statutes.ts over utah_statutes, rebuilt by migration 0073 + seeded from
  // le.utah.gov). search/toc/chapter/section all live on env.API now; the
  // richer rows (full text, offense level, source links, licensing law) the
  // legacy /statutes/search never returned. The more-specific
  // /api/statutes/analytics/top-charged STUB above is checked first, so it
  // stays stubbed.
  { kind: 'prefix', value: '/api/statutes' },

  // ── Serve Intake (upload + OCR + LLM extraction) ──
  // The new Worker owns /scan-document, /upload, /intake, /:id/documents,
  // and /documents/:docId/file (R2-backed). The legacy `rmpg-flex`
  // Worker had its own serve-intake handlers but they predated the
  // Tesseract container + Workers-AI extraction wired up in PR for
  // this session — route the whole namespace to env.API so the new
  // pipeline is what runs in prod. Legacy serve-intake is dead code
  // after this entry lands.
  { kind: 'prefix', value: '/api/serve-intake' },
  // /api/process-server/{deadlines,success-rates} — the ServePage Deadlines
  // panel + Success Rates view. Both 404'd on legacy because serve.ts declares
  // them AFTER `/:id`, so Express matched `/deadlines` against `/:id` and never
  // reached them. Ported to src/routes/processServer.ts (qualified columns,
  // async D1) and routed here on their exact paths so they resolve. The rest of
  // /api/process-server (list, attempts, affidavit, …) stays on legacy.
  { kind: 'regex', value: /^\/api\/process-server\/deadlines$/, methods: ['GET'] },
  { kind: 'regex', value: /^\/api\/process-server\/success-rates(\?|$)/, methods: ['GET'] },
  // /api/process-server/* — ServePage + ServeSkipTracePanel. The rewrite
  // mounts both the full `serve` router (officer-facing workflow) and the
  // `processServer` subset (deadlines + success-rates) at this prefix
  // (see src/routesConfig.ts:330-347), so all GETs + POSTs for jobs, stats,
  // routes, attempts, skip-trace, CSV export, and CRUD reach the rewrite
  // instead of falling through to env.LEGACY. The two more-specific
  // /deadlines + /success-rates regex rules above still win on those exact
  // paths. Stubs that were short-circuiting these paths (added 2026-06-07
  // round 2) are now removed; the real handlers run.
  { kind: 'prefix', value: '/api/process-server' },
  // /api/ocr/scan-document is the alias URL the ServeIntakePage client
  // already calls for its in-page image preview path. The handler is
  // src/routes/ocr.ts (delegates to the same extraction utility as
  // /api/serve-intake/scan-document). Bare /api/ocr is the full prefix
  // so future OCR sub-paths come along automatically.
  { kind: 'prefix', value: '/api/ocr' },
  // ── Document Intake (classify + anchor-extract LE documents) ──
  // /api/document-intake/extract: the rewrite (src/routes/documentIntake.ts +
  // documentIntakeExtract.ts) classifies a document and pulls structured
  // fields deterministically from client-extracted pdfjs text — NO container,
  // NO AI. Previously this whole namespace fell to legacy (which 404s: every
  // /api/document-intake/* call returned "API endpoint not found"), so the
  // DocumentIntakePage was dead in prod. The router was already registered in
  // routesConfig.ts; it just had no proxy route. Route the prefix to env.API.
  // (The container-backed /extract-text + /health on this prefix are unused by
  // any client — only /extract is called.)
  { kind: 'prefix', value: '/api/document-intake' },

  // ── Geo address service (statewide UGRC address points) ──
  // src/routes/geo.ts, backed by the dedicated rmpg-geo D1 (GEO_DB binding).
  // Powers map address search + snap-to-address. Public, read-only.
  { kind: 'prefix', value: '/api/geo' },

  // ── Vector tiles (PMTiles statewide overlays) ──
  // New isolated namespace served by src/routes/tiles.ts from R2 with
  // HTTP Range support (mandatory for PMTiles). Kept separate from
  // /api/map-data (which intentionally stays on legacy). Range/206 pass
  // through this proxy transparently via env.API.fetch(request).
  { kind: 'prefix', value: '/api/tiles' },

  // ── HR module ──
  // New Worker owns the four ported sub-paths (/leave, /disciplinary,
  // /reviews, /benefits). Un-ported HR sub-paths under /api/hr/*
  // (payroll, grievances, attendance, documents, pips, exit
  // interviews, workers' comp, handbook acks, etc.) will 404 from
  // the new Worker — that's intentional. The legacy handlers for
  // those depended on tables the live D1 doesn't have, so they
  // were silently returning empty data anyway. A 404 is a more
  // honest signal until those tabs get real ports.
  { kind: 'prefix', value: '/api/hr' },

  // ── 2026-06-02 live-sweep routing fixes ──────────────────────────────
  // Each rewrite handler below ALREADY EXISTS (verified in src/routes/*) and
  // its table exists on live D1, but the proxy never routed the namespace to
  // env.API — so the request fell through to the legacy worker, which lacks
  // the handler and 404/500'd. Found by a logged-in page-by-page Network
  // sweep. Routing closes the strangler-fig seam.
  //
  // Shift planning — shiftPlans.ts (mounted at bare /api) serves ALL of these;
  // legacy 404'd every one. The client calls the bare /api/shift-* paths.
  { kind: 'prefix', value: '/api/shift-plans' },
  { kind: 'prefix', value: '/api/shift-swaps' },
  { kind: 'prefix', value: '/api/shift-overtime' },
  { kind: 'prefix', value: '/api/staffing-levels' },
  { kind: 'prefix', value: '/api/shift-notifications' },
  // Personal notification inbox — notificationsInbox.ts over the notifications
  // table (list/stats/categories/preferences/unread-count + read/delete/etc).
  // Legacy served only /unread-count; the inbox paths 404'd.
  { kind: 'prefix', value: '/api/notifications' },
  // Use-of-force reports (useOfForce.ts) — new rewrite handler; legacy 500'd.
  { kind: 'prefix', value: '/api/use-of-force' },
  // /api/invoices — full prefix to rewrite (legacy 404s on list + stats).
  { kind: 'prefix', value: '/api/invoices' },
  // Document folders — documentFolders.ts serves /folders; legacy 404'd.
  // Scoped to /folders only so the rest of /api/documents stays on legacy
  // (the rewrite has no document file-list handler).
  { kind: 'prefix', value: '/api/documents/folders' },
  // Command center KPIs — reports.ts now has /command-center; legacy 404'd.
  { kind: 'prefix', value: '/api/reports/command-center' },
  // Security dashboard — auth.ts /security/* over login_attempts + sessions.
  // login-history keeps its STUB (checked first); the rest reach env.API.
  { kind: 'prefix', value: '/api/auth/security' },
  // Evidence stats + locations — records.ts implements both; legacy lacks them
  // (the base /evidence list + writes deliberately stay on legacy, since the
  // rewrite's evidence POST/PUT reference columns absent from the live table).
  { kind: 'regex', value: /^\/api\/records\/evidence\/(stats|locations)(\?.*)?$/, methods: ['GET'] },
  // ── File uploads (PR #1038) ──
  // Entire /api/uploads namespace ported from legacy Express (multer + disk)
  // to R2-backed Hono handler. All methods (GET/POST/PUT/DELETE) now live
  // on the rewrite. Legacy had disk-based storage; rewrite uses UPLOADS R2.
  { kind: 'prefix', value: '/api/uploads' },
  // ── Company documents (PR #1038) ──
  // TrainingDocsPage CRUD + CSV export. Migration 0078 creates the
  // company_documents table. Replaces the empty-array stub that was here.
  { kind: 'prefix', value: '/api/company-documents' },
  // ── ClearPathGPS integration stubs ──
  { kind: 'prefix', value: '/api/clearpathgps' },
  // ── Forensic lab (alias for /api/forensics) ──
  { kind: 'prefix', value: '/api/forensic-lab' },

  // ── 2026-06-08 404 elimination sweep ──────────────────────────────
  // Client-called prefixes with no handler on either backend. Routed to
  // env.API where the stubs router returns safe empty shapes. Without
  // these, requests fall through to env.LEGACY which also has no handler.
  { kind: 'prefix', value: '/api/cfs' },
  { kind: 'prefix', value: '/api/code-enforcement' },
  { kind: 'prefix', value: '/api/dar' },
  { kind: 'prefix', value: '/api/diagnostics' },
  { kind: 'prefix', value: '/api/firecrawl-tools' },
  { kind: 'prefix', value: '/api/mobile' },
  { kind: 'prefix', value: '/api/pdf-artifacts' },
  { kind: 'prefix', value: '/api/pdf-engine' },
  { kind: 'prefix', value: '/api/updates' },
  { kind: 'prefix', value: '/api/voice-persona' },

  // ── Prefixes with rewrite handlers but no proxy route ─────────────
  // These have real handlers in routesConfig.ts but were falling through
  // to legacy because the proxy never routed them.
  { kind: 'prefix', value: '/api/cases' },
  { kind: 'prefix', value: '/api/citations' },
  { kind: 'prefix', value: '/api/court' },
  { kind: 'prefix', value: '/api/trespass-orders' },
  { kind: 'prefix', value: '/api/weather' },
  { kind: 'prefix', value: '/api/email' },
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

// ============================================================
// Durable Object stub classes — DO NOT DELETE without a delete-class migration
// ============================================================
// These empty classes exist ONLY to keep the `rmpg-api-proxy` Worker
// deployable. They are NOT used by this router (no `durable_objects.bindings`
// in proxy/wrangler.toml, and nothing here ever instantiates them).
//
// Why they're here — the 2026-06-02 name-collision incident:
//   PR #937 (a cloudflare-workers-and-pages[bot] dashboard commit) renamed the
//   ROOT wrangler.toml `name` rmpg-flex-api → rmpg-api-proxy. deploy.yml's
//   "Deploy Worker" step then published the REWRITE (src/index.ts, which DOES
//   declare WelfareWatchDO/VoiceHubDO/AlertHubDO/PdfToolsContainer via its DO
//   migrations) ONTO the `rmpg-api-proxy` worker. That registered four DO
//   namespaces on this worker. PR #945 reverted the name, but the namespaces
//   remain. Cloudflare now rejects any new `rmpg-api-proxy` version that does
//   not EXPORT those four classes with error 10064 ("does not export class
//   'WelfareWatchDO' which is depended on by existing Durable Objects").
//
// Re-exporting the classes (even as empty stubs) satisfies 10064 WITHOUT a
// migration — per Cloudflare docs, "updating the code for an existing DO class
// does not require a migration." This is the deliberately NON-DESTRUCTIVE fix:
// it preserves whatever DO instances may have been created on this worker
// during the #937 window (e.g. an in-flight officer welfare-check escalation),
// rather than wiping them with a `deleted_classes` migration. The canonical,
// live instances of these DOs live on `rmpg-flex-api` (where welfare/voice/
// alert traffic is actually routed) and are untouched by any of this.
//
// Cleanup path (later, once the rmpg-api-proxy namespaces are confirmed empty
// in the dashboard): add a `deleted_classes` migration to proxy/wrangler.toml
// for all four classes, deploy, then delete this block. See LEGACY.md +
// memory project-auth-outage-name-collision.
class InertDurableObject {
  constructor(_state: unknown, _env: unknown) {}
  async fetch(): Promise<Response> {
    // Should never be reached — the proxy has no DO bindings and never
    // routes to these. If it ever is, fail loud rather than silent.
    return new Response('rmpg-api-proxy is a router and does not implement Durable Objects', { status: 410 });
  }
}
export class WelfareWatchDO extends InertDurableObject {}
export class VoiceHubDO extends InertDurableObject {}
export class AlertHubDO extends InertDurableObject {}
export class PdfToolsContainer extends InertDurableObject {}

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
