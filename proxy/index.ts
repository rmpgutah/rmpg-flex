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
  // (2026-05-29 stub-shadowing audit) Removed arrests/recent, body-camera,
  // audit (logs/stats/compliance-report/index-stats), and fleet
  // (bare/analytics/dashcam-videos) stubs — each now has a real handler in
  // the rewrite (arrests.ts, personnel.ts, audit.ts, fleet.ts) whose tables
  // exist on live D1 (verified column-by-column). STUBS run BEFORE
  // API_ROUTES, so leaving them shadowed the real handlers and the pages
  // showed empty data instead of real rows (e.g. Audit's login-failure rate).
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
  // (2026-05-29 audit) skiptracer /status + /stats stubs removed — real
  // handlers in src/routes/skiptracer.ts (microbilt_searches + skiptracer_dossiers).
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
  // (2026-05-29 audit) Removed shadowing stubs for personnel /schedules,
  // /time, /deployments, /coverage-gaps (real handlers in personnel.ts over
  // shift_plans/time_entries/deployments/system_config) and reports
  // /incidents-summary, /crime-trends, /beat-activity, /citation-revenue
  // (real handlers in reports.ts; columns verified on live D1).
  // /reports/schedules, /templates, /statute-analytics stubs KEPT below
  // (schedules/templates return [] from a placeholder; statute-analytics'
  // handler fix ships via deploy.yml — un-stub only after it lands).
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
  // (2026-05-29 audit) Removed shadowing stubs for personnel /training,
  // /training-requirements, /training-completion, /duty-hours — real handlers
  // in personnel.ts over training_records + training_requirements (present on
  // live D1; each wraps queries in try/catch → [] so a schema gap degrades
  // to the same empty the stub returned). /training-alerts + /training-materials
  // stubs stay (no handler / no backing table).
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
  // ── Fleet sub-tabs that aren't ported yet ─────────────────────────────
  // Bare /api/fleet, /api/fleet/:id, /api/fleet/map, /api/fleet/analytics,
  // and /api/fleet/dashcam-videos[/:id[/neighbors]] are now real handlers
  // in src/routes/fleet.ts. The list below is sub-paths the rewrite still
  // doesn't implement; they 404 from the rewrite without a stub.
  {
    match: /^\/api\/fleet\/(fuel-cards|fuel|fuel\/.*|recalls|health-scores|maintenance-schedule|driver-performance|service-alerts|cost-trends|vehicle-lifecycle|fleet-cost-analytics|inspection-stats|notifications|overdue-inspections|dash-cameras|pretrip)(\/.*)?$/,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    body: { data: [], total: 0 },
    reason: 'fleet sub-tab handler not ported; tab renders empty until implemented',
  },
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
  // ── CRM module (entire namespace 500s on legacy) ──
  {
    match: /^\/api\/crm\/(dashboard|pipeline-summary|revenue-forecast|leads\/source-analytics)/,
    methods: ['GET'],
    body: {},
    reason: 'legacy CRM stat handlers 500; CrmPage tolerates empty object',
  },
  {
    match: /^\/api\/crm\/(recent-activity|leads\/follow-ups|tasks|expiring-contracts)/,
    methods: ['GET'],
    body: [],
    reason: 'legacy CRM list handlers 500; CrmPage tolerates empty arrays',
  },
  // /api/offender-registry/stats now has a real handler in
  // src/routes/offenderRegistry.ts. /api/sex-offender-registry/stats stays
  // stubbed — no dedicated sex-offender table on live D1 yet (use the
  // alert_type filter on offender_alerts when that page is rewritten).
  {
    match: /^\/api\/sex-offender-registry\/stats$/,
    methods: ['GET'],
    body: { data: {} },
    reason: 'no sex-offender-specific table; SexOffenderRegistryPage tolerates empty',
  },
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
  // ── Sex-offender registry (CRUD subset) ─────────────────────────────
  // `/stats` is stubbed above. Root list + /expiring-registrations also
  // queried on page mount. Other paths (POST /, PUT /:id, /import,
  // /export/csv) stay 404 — those are user-triggered writes that should
  // fail loudly until the schema lands.
  {
    match: /^\/api\/sex-offender-registry\/?(\?.*)?$/,
    methods: ['GET'],
    body: { data: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 50 } },
    reason: 'no sex_offender_registry table; root list tolerates empty data',
  },
  {
    match: /^\/api\/(sex-)?offender-registry\/expiring-registrations(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no sex_offender_registry table; expiring-registrations tolerates empty list',
  },
  // ── Dispatch GPS speed zones (Map page may poll) ────────────────────
  {
    match: /^\/api\/dispatch\/gps\/speed-zones(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no speed_zones table on live D1; map page tolerates empty array',
  },
  // ── Trespass orders → violations sub-tab ────────────────────────────
  // TrespassPage detail view opens this when a card is clicked. Empty
  // list = "no violations on file" — a valid UX state.
  {
    match: /^\/api\/trespass-orders\/\d+\/violations(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no trespass_violations table; trespass detail tolerates empty list',
  },
  // ── Dashcam video link records (DashCamera detail) ──────────────────
  {
    match: /^\/api\/dashcam-videos\/[^/]+\/links(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no dashcam_video_links table; detail page tolerates empty link list',
  },
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
  // ── WebAuthn / TOTP MFA setup (security tab on profile page) ────────
  // Profile page hits these on every open. Stub the read shape so the
  // security tab renders an "MFA not enrolled" state. Enrollment POSTs
  // (register-options, register-verify, etc.) stay 404 — enabling MFA
  // would need real `webauthn_credentials` + `user_totp_secrets` tables.
  {
    match: /^\/api\/auth\/webauthn\/(credentials|status)(\?.*)?$/,
    methods: ['GET'],
    body: { credentials: [], enrolled: false },
    reason: 'no webauthn_credentials table; security tab shows un-enrolled state',
  },
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
  // ── IPED download/info (admin tile, separate from /iped/status) ─────
  {
    match: /^\/api\/iped\/download\/info(\?.*)?$/,
    methods: ['GET'],
    body: { available: false, version: null, size_bytes: 0, last_updated: null },
    reason: 'IPED download metadata endpoint; admin tile tolerates "not available"',
  },
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
  // ── Auth security login-history (ProfilePage Security tab) ──────────
  // The proxy already routes /api/auth/security/login-history to env.API
  // (API_ROUTES rule above), but the new worker has no handler for it,
  // so it 404s. Stub needs to satisfy TWO consumers with different shapes:
  //   - LoginHistoryTable.tsx reads `data.entries` + `data.total`
  //   - SecurityDashboardPage.tsx reads `data.data` (typed as `{ data: LoginEntry[] }`)
  // The previous stub returned only `{ data, pagination }` which crashed
  // LoginHistoryTable with `undefined.length` on `entries.length === 0`
  // (observed in prod 2026-05-27 ~16:00 UTC, AdminPage ErrorBoundary).
  // Union shape below satisfies both readers — empty everywhere.
  // The route registry will need a real handler against the `login_attempts`
  // table (which DOES exist on live D1) in a follow-up PR.
  {
    match: /^\/api\/auth\/security\/login-history(\?.*)?$/,
    methods: ['GET'],
    body: {
      entries: [],          // LoginHistoryTable.tsx:54
      total: 0,             // LoginHistoryTable.tsx:55
      data: [],             // SecurityDashboardPage.tsx:48
      pagination: { total: 0, totalPages: 0, page: 1, limit: 15 },
    },
    reason: 'no handler in src/routes/auth.ts; union shape satisfies LoginHistoryTable + SecurityDashboardPage',
  },
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
  // ── More specific dispatch sub-paths (new in rewrite) ──
  // /api/dispatch/calls/:id/{recommended-units, closest-unit, auto-assign,
  // timeline, warnings, audit-trail, generate-incident, promote-to-incident}
  // all live on env.API. generate-incident/promote-to-incident: the rewrite's
  // shared generateIncidentFromCall() is schema-verified vs live incidents +
  // audit_log; legacy lacked promote-to-incident entirely (CAD "PI" was 404).
  // Listed BEFORE the bare /api/dispatch/calls/:id rule so they win the match.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(recommended-units|closest-unit|auto-assign|timeline|warnings|audit-trail|generate-incident|promote-to-incident|send-to-serve|pin)(\/.*)?$/ },

  // /api/dispatch/calls/:id/{persons,vehicles}[/...] — rewrite implements
  // POST/DELETE/PATCH plus the quick-add fast-path; legacy implements ONLY
  // GET on these (no POST handler) so the dispatch panel's "Link Person"
  // / "Link Vehicle" pickers were silently 404'ing on submit. The client's
  // catch only console.errors, so the user saw no toast and an empty list
  // after refetch — exactly the "I pick + submit, no error, link doesn't
  // appear" symptom reported 2026-05-24. Routing ALL methods on the entire
  // sub-tree to the rewrite makes the round-trip self-consistent.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(persons|vehicles)(\/.*)?$/ },

  // /api/dispatch/request-backup — officer backup request (RadialMenu).
  // New rewrite handler (panic.ts); legacy never implemented it → 404.
  { kind: 'prefix', value: '/api/dispatch/request-backup' },

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
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(revert-status|le-notification|transfer|broadcast-note|generate-incident)$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/notes\/[^/]+$/, methods: ['PUT', 'DELETE'] },
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/status$/, methods: ['POST'] },
  // Single-call archive — rewrite writes archived_at in UTC; legacy mislabels MST.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/archive$/, methods: ['POST'] },
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/archive-bulk$/, methods: ['POST'] },

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
  // Utah warrant pull — display + status + person profile, all on the rewrite
  // (src/routes/warrants.ts over utah_warrants + warrant_watch_runs).
  // /api/warrants/utah (prefix) also matches /api/warrants/utah-search/* by
  // startsWith — intended, both go to the rewrite now.
  { kind: 'prefix', value: '/api/warrants/utah' },
  { kind: 'prefix', value: '/api/warrants/scraped/status' },
  { kind: 'regex', value: /^\/api\/warrants\/person\/\d+\/profile$/, methods: ['GET'] },
  // /api/warrants/scrapers — Sources/Scrapers tab + Layout health badge.
  // Legacy implemented NONE of these, so the tab was 404-empty. The rewrite
  // reads warrant_scraper_config + derives metrics from warrant_watch_runs.
  // Prefix covers list, /health, /:source_key/{trigger,reset-circuit},
  // and the admin /bulk path (which falls back to 404 in the rewrite for
  // unknown sources — kept on this prefix so all scrapers traffic stays
  // server-consistent).
  { kind: 'prefix', value: '/api/warrants/scrapers' },

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
  // Audit — entire namespace lives in src/routes/audit.ts (logs, stats,
  // index-stats, compliance-report). Legacy never had any of these so
  // requests were 404ing on the AuditLogPage. Mounted in routesConfig.ts
  // at /api/audit; this rule routes the prefix to env.API.
  { kind: 'prefix', value: '/api/audit' },
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
  // AdminPage tiles added 2026-05-27 (stubbed in src/routes/admin.ts).
  { kind: 'prefix', value: '/api/admin/api-stats' },
  { kind: 'prefix', value: '/api/admin/user-activity-heatmap' },
  { kind: 'prefix', value: '/api/admin/backup-status' },
  { kind: 'prefix', value: '/api/admin/maintenance-mode' },
  { kind: 'prefix', value: '/api/admin/notification-rules' },
  // Auth security history
  { kind: 'prefix', value: '/api/auth/security/login-history' },
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
  // Personnel sub-paths — GET ports of the four roster/time/deployment
  // surfaces (PR replacing the PR #667 stubs). Scoped to GET so the
  // existing POST/PUT/DELETE on /schedules, /time, /deployments still
  // fall through to legacy until the rewrite has matching write
  // handlers. /coverage-gaps is read-only by nature but listed under
  // the same GET filter for consistency.
  { kind: 'prefix', value: '/api/personnel/schedules', methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/time', methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/deployments', methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/coverage-gaps', methods: ['GET'] },
  { kind: 'prefix', value: '/api/personnel/body-cameras' },
  { kind: 'prefix', value: '/api/personnel/bodycam-videos' },
  // training* and duty-hours: handlers now live in src/routes/personnel.ts;
  // legacy 404s / 500s on these. Route to env.API so the new handlers win.
  { kind: 'prefix', value: '/api/personnel/training' },
  { kind: 'prefix', value: '/api/personnel/duty-hours' },
  // Howen — handlers in src/routes/howen.ts (status, devices[/:id], events).
  { kind: 'prefix', value: '/api/howen/' },
  // Admin shift-swaps alias — handler in src/routes/shiftPlans.ts.
  { kind: 'prefix', value: '/api/admin/shift-swaps' },
  // HR leave — handler in src/routes/hr.ts (balances + list + CRUD).
  { kind: 'prefix', value: '/api/hr/leave' },
  // Offender registry stats — handler in src/routes/offenderRegistry.ts.
  { kind: 'prefix', value: '/api/offender-registry/stats' },
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
  // /api/dispatch/units/:id/{audio-mode,mileage} — rewrite implements both
  // (audioMode router). Legacy implemented NEITHER, so the MDT audio toggle
  // and the CAD "MI" mileage command 404'd. Route the numeric-id sub-paths
  // to the rewrite. (unit status stays on legacy — its transition-guard
  // handler is solid and already working.)
  { kind: 'regex', value: /^\/api\/dispatch\/units\/\d+\/(audio-mode|mileage)$/ },

  // ── Audit subsystem ──
  // Live D1 `audit_log` had only id+created_at columns (an unused stump)
  // until the audit-rewrite PR added user_id/action/entity_type/entity_id/
  // details/ip_address and pointed /src/ writes at the consolidated table.
  // Legacy never had a working audit handler — its routes return empties
  // against the stump schema. Routing the whole namespace at env.API is
  // the only path that lets AuditLogPage render real data.
  { kind: 'prefix', value: '/api/audit' },

  // ── Radio subsystem (PR #661) ──
  // The new worker is the only handler. Legacy has no /api/radio/*
  // routes at all, so requests to this prefix have no fallback —
  // they MUST route to the new worker or 404. Without this entry
  // the radio console was effectively broken in production despite
  // /src/routes/radio.ts existing on main.
  { kind: 'prefix', value: '/api/radio' },

  // ── Serve Intake (upload + OCR + LLM extraction) ──
  // The new Worker owns /scan-document, /upload, /intake, /:id/documents,
  // and /documents/:docId/file (R2-backed). The legacy `rmpg-flex`
  // Worker had its own serve-intake handlers but they predated the
  // Tesseract container + Workers-AI extraction wired up in PR for
  // this session — route the whole namespace to env.API so the new
  // pipeline is what runs in prod. Legacy serve-intake is dead code
  // after this entry lands.
  { kind: 'prefix', value: '/api/serve-intake' },
  // /api/ocr/scan-document is the alias URL the ServeIntakePage client
  // already calls for its in-page image preview path. The handler is
  // src/routes/ocr.ts (delegates to the same extraction utility as
  // /api/serve-intake/scan-document). Bare /api/ocr is the full prefix
  // so future OCR sub-paths come along automatically.
  { kind: 'prefix', value: '/api/ocr' },

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
