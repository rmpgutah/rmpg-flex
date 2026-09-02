// ============================================================
// RMPG Flex — API Routing Proxy (rmpg-api-proxy)
// ============================================================
// Inert Durable Object stubs — the rmgp-api-proxy previously had orphan
// DO namespaces (AlertHubDO, WelfareWatchDO, VoiceHubDO, PdfToolsContainer)
// left by a name-collision incident (deploy.yml:119-129). These stubs keep
// the deploy from failing with "New version of script does not export class
// 'X' which is depended on by existing Durable Objects" [code 10064].
// The proxy uses NONE of these — they exist purely to satisfy Cloudflare's
// DO-class-consistency check at deploy time.
import { DurableObject } from 'cloudflare:workers';
export class AlertHubDO extends DurableObject {}
export class WelfareWatchDO extends DurableObject {}
export class VoiceHubDO extends DurableObject {}
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
  // the rewrite now serves a real status handler (src/routes/warrants.ts).
  // Routed to env.API below.
  // (removed 2026-07-12) /api/personnel/equipment, /api/hr/benefits,
  // /api/arrests/recent stubs — real handlers exist (personnel.ts
  // .get('/equipment'), hr.ts .get('/benefits'), arrests.ts .get('/recent'))
  // and were being shadowed. Routed to env.API below.
  // (removed 2026-07-14) /api/personnel/body-cameras, /api/personnel/bodycam-videos,
  // /bodycam-videos/reviews/pending, /bodycam-videos/redaction-requests,
  // /bodycam-videos/retention/report stubs — real handlers exist
  // (src/routes/personnel/bodyCameras.ts, bodyCameraUploads.ts) with real
  // body_cameras/bodycam_videos tables and were being shadowed, causing the
  // Body Cameras page to always render empty regardless of actual data.
  // Routed to env.API below (already unconditional, no GET-only restriction
  // needed since real POST/PUT/DELETE/:id handlers exist too).
  // (removed 2026-08-28) /api/audit/{logs,stats,compliance-report,index-stats}
  // stubs — src/routes/audit.ts implements all four; the stubs ran BEFORE
  // API_ROUTES and served empty 200s, so AuditLogPage had to opt into
  // cross-origin api.rmpgutah.us (which now dies at the managed challenge).
  // ── Fleet surfaces ────────────────────────────────────────────
  // Bare /api/fleet, /api/fleet/analytics, and /api/fleet/dashcam-videos
  // are now real handlers in src/routes/fleet.ts (fleet.get('/'),
  // fleet.get('/analytics'), fleet.get('/dashcam-videos')). These stubs
  // used to shadow them with empty payloads (200 OK, so the SPA never
  // saw an error) before the rewrite grew handlers — removed 2026-07-12
  // after they were found still shadowing the live /analytics handler,
  // silently serving stale zeroed data on rmpgutah.us while
  // api.rmpgutah.us (which bypasses this proxy) returned the real
  // payload. See the "── Fleet sub-tabs that aren't ported yet ──"
  // block further down for the sub-paths that still need stubs.
  // (removed 2026-07-12) /api/reports/crime-analysis, /api/records/vehicles/:id/history
  // stubs — real handlers exist (reports.ts .get('/crime-analysis'),
  // records.ts .get('/vehicles/:id/history')) and were being shadowed.
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
  // (removed 2026-07-12) /api/skiptracer/status, /api/skiptracer/stats,
  // /api/iped/status, /api/iped/hash-sets, /api/personnel/schedules,
  // /api/personnel/time, /api/personnel/deployments,
  // /api/personnel/coverage-gaps, /api/reports/incidents-summary,
  // /api/reports/crime-trends, /api/reports/beat-activity,
  // /api/reports/citation-revenue stubs — real handlers exist for all of
  // these (skiptracer.ts, iped.ts, personnel.ts, reports.ts) and were
  // being shadowed. Routed to env.API below.
  //
  // /api/reports/schedules and /api/reports/templates — real handlers in
  // src/routes/reports.ts (currently `c.json([])`). Stub removed 2026-08-28
  // so a later real implementation is not shadowed.
  // (removed 2026-07-12) /api/reports/statute-analytics, /api/personnel/training,
  // /api/personnel/training-requirements, /api/personnel/training-completion,
  // /api/personnel/duty-hours, and ALL /api/crm/* stubs (dashboard,
  // recent-activity, tasks, expiring-contracts, leads/source-analytics,
  // leads/follow-ups, leads/pipeline-summary, pipeline-summary,
  // revenue-forecast) — real handlers exist for all of these
  // (reports.ts, personnel.ts, crm.ts — CRM is fully backed by live
  // crm_leads/crm_tasks/crm_lead_activity/crm_proposals tables now) and
  // were being shadowed, most notably CrmPage silently showing fake
  // empty data on rmpgutah.us. Routed to env.API below.
  // (removed 2026-08-28) /api/records/reports/approval-queue stub —
  // records.ts .get('/reports/approval-queue') is the live handler.
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
  // (removed 2026-08-01) The single /api/fleet/(fuel-cards|fuel|fuel/*|recalls|
  // health-scores|maintenance-schedule|driver-performance|service-alerts|
  // cost-trends|vehicle-lifecycle|fleet-cost-analytics|inspection-stats|
  // notifications|overdue-inspections|dash-cameras|pretrip) stub — its
  // "handler not ported" reason was STALE. Every one of those 15 paths has a
  // real handler in src/routes/fleet.ts (verified by grep, 2026-08-01: each
  // resolves to >= 1 fleet.get/post/put/delete registration). Routed to
  // env.API below.
  //
  // Because the rule listed methods GET/POST/PUT/DELETE, it did not merely
  // render tabs empty — it silently swallowed WRITES. `PUT /api/fleet/fuel/:id`
  // and `DELETE /api/fleet/fuel/:id` returned 200 {data:[],total:0} without
  // ever reaching the Worker, so the Fuel tab reported "updated successfully"
  // while the row never changed (confirmed live: a PUT setting notes on row
  // 115 left notes NULL in D1). Every fleet analytics panel reading one of
  // these endpoints likewise rendered stub data no matter what the Worker
  // returned.
  //
  // A stub that answers a mutating method is strictly worse than a 404: a 404
  // surfaces as a visible error, whereas a 200 with an empty body is
  // indistinguishable from success. If a future stub is genuinely needed here,
  // restrict it to ['GET'] so writes fail loudly instead of vanishing.
  // Howen handlers now live in src/routes/howen.ts (devices, events, status,
  // devices/:id). Stub removed; requests reach the rewrite via the API_ROUTES
  // rule below.
  // (removed 2026-07-12) /api/personnel/training-alerts,
  // /api/personnel/training-materials stubs — real handlers exist
  // (personnel.ts .get('/training-alerts'|'/training-materials')) and
  // were being shadowed. Also removed the duplicate
  // /api/skiptracer/(status|stats) stub here — same paths already
  // handled (and routed correctly) above.
  // (removed 2026-05-29) /api/warrants/scraped/status stub — the rewrite
  // now serves a real status handler (src/routes/warrants.ts). Routed to
  // env.API below.
  // (removed 2026-08-28) /api/hr/(payroll|grievances|documents|attendance|pips|benefits)
  // stub — hr.ts implements all of those GETs; the stub was shadowing live
  // payroll/benefits data the same way the audit stubs hid AuditLogPage.
  // (removed 2026-07-12) duplicate /api/crm/* stubs — already removed
  // above; the offenderRegistry router is mounted at BOTH
  // /api/offender-registry and /api/sex-offender-registry
  // (routesConfig.ts), so /api/sex-offender-registry/stats has a real
  // handler too (offenderRegistry.ts .get('/stats')) and was being
  // shadowed. Removed.
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
  // (removed 2026-07-12) /api/admin/expiring-certifications stub — real
  // handler exists (admin.ts .get('/expiring-certifications')) and was
  // being shadowed. /api/admin/training below stays stubbed — its real
  // backing table (officer_credentials) still doesn't exist on live D1.
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
  // (removed 2026-07-12) /api/sex-offender-registry root-list stub — the
  // offenderRegistry router's real .get('/') handler serves this path
  // (mounted at both /api/offender-registry and /api/sex-offender-registry)
  // and was being shadowed.
  {
    match: /^\/api\/(sex-)?offender-registry\/expiring-registrations(\?.*)?$/,
    methods: ['GET'],
    body: [],
    reason: 'no sex_offender_registry table; expiring-registrations tolerates empty list',
  },
  // (removed 2026-07-12) /api/dispatch/gps/speed-zones stub — real
  // handler exists (gps.ts .get('/speed-zones')) and was being shadowed.
  // /api/dispatch/gps/zone-speed-stats below is a DIFFERENT path with no
  // matching handler found — stays stubbed.
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
  // (removed 2026-08-28) /api/dashcam-videos/:id/links stub — the live
  // client calls /api/fleet/dashcam-videos/:id/links (fleet.ts).
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
  // (removed 2026-08-28) /api/statutes/analytics/top-charged stub —
  // statutes.ts .get('/analytics/top-charged') is live.
  // (removed 2026-07-12) /api/auth/webauthn/(credentials|status) stub —
  // real handlers exist (auth.ts .get('/webauthn/status'|'/credentials'),
  // auth-required) and were being shadowed.
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
  // (removed 2026-07-12) /api/reports/comparison stub — real handler
  // exists (reports.ts .get('/comparison')) and was being shadowed.
  // (removed 2026-08-28) /api/arrests/status stub — wrong shape vs
  // AdminArrestsTab (configured/enabled/recordsCount). Real handler is
  // arrests.get('/status').
  // (removed 2026-07-12) /api/iped/download/info stub — real handler
  // exists (iped.ts .get('/download/info')) and was being shadowed.
  // (removed 2026-07-20, PR #2905) /api/admin/database/integrity-check
  // (POST) stub — admin.ts now registers the handler on both GET and
  // POST (admin.on(['GET','POST'], ...)), so the method mismatch this
  // stub worked around no longer exists. Was shadowing real results.
  // (removed 2026-07-12) /api/admin/database/vacuum (POST) stub — real
  // handler exists (admin.ts .post('/database/vacuum')) and the client
  // does call it via POST, so this was being shadowed.
  // (removed 2026-07-12) /api/auth/security/login-history stub — real
  // handler exists (auth.ts .get('/security/login-history')) and was
  // being shadowed.
  // (removed 2026-08-28) skiptracer-v2 status/stats stub — real handler in
  // src/routes/skiptracerV2.ts; proxy now routes /api/skiptracer-v2/* to env.API.
  // (removed 2026-08-28) /api/dispatch/gps/zone-speed-stats stub —
  // gps.ts .get('/zone-speed-stats') is live.
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

  // ── Records search (rewrite has all three; legacy is missing /search
  // and /vehicles/search and returns empty `[]` instead) ──
  { kind: 'prefix', value: '/api/records/persons/search' },
  { kind: 'prefix', value: '/api/records/vehicles/search' },
  // /api/records/search?q=...&type=person|vehicle|business — used by
  // client/src/components/LinkRecordModal.tsx. Regex (not prefix) so
  // we don't accidentally swallow /api/records/searchfoo if someone
  // adds an adjacent endpoint later.
  { kind: 'regex', value: /^\/api\/records\/search(\?|$)/ },

  // ── Utah warrant pull — full surface on the rewrite ──
  // /watch/{runs,scan}, /utah (scraped-warrant list + ?person_id filter),
  // /utah/sync-status, /utah-search/auto-poll-status, /scraped/status all
  // live in src/routes/warrants.ts and read utah_warrants + warrant_watch_runs
  // (populated by the cron poller). Legacy uses /warrants/scrapers/* against a
  // different table — those stay on legacy.
  //   NOTE ordering: `/api/warrants/utah` (prefix) also matches
  //   `/api/warrants/utah-search/...` via startsWith, which is intended —
  //   both go to the rewrite now.
  { kind: 'prefix', value: '/api/warrants/watch' },
  { kind: 'prefix', value: '/api/warrants/utah' },
  { kind: 'prefix', value: '/api/warrants/scraped/status' },
  // /api/warrants/person/:id/profile — WarrantsPage person drawer, surfaces
  // a person's Utah warrants. Regex (not /person prefix) so other /person/*
  // paths (person-intel, check) stay on legacy.
  { kind: 'regex', value: /^\/api\/warrants\/person\/\d+\/profile$/ },

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
  // ── Auth login family ──────────────────────────────────────────
  // The rewrite's auth.ts matches live D1 (must_change_password /
  // totp_enabled / sessions.session_id + refresh_token_hash). Legacy
  // login still INSERTs token/refresh_token columns and SELECTs
  // force_password_change — those columns are not on live D1, so
  // POST /api/auth/login 500'd in the field. Route the whole login
  // contract here. /api/auth/reset-password (email-token page) is
  // NOT listed — that path is still legacy-only.
  { kind: 'prefix', value: '/api/auth/login' },
  { kind: 'prefix', value: '/api/auth/refresh' },
  { kind: 'prefix', value: '/api/auth/logout' },
  { kind: 'prefix', value: '/api/auth/me' },
  { kind: 'prefix', value: '/api/auth/forgot-password' },
  { kind: 'prefix', value: '/api/auth/2fa' },
  { kind: 'prefix', value: '/api/auth/totp' },
  { kind: 'prefix', value: '/api/auth/webauthn' },
  { kind: 'prefix', value: '/api/auth/session' },
  { kind: 'prefix', value: '/api/auth/sessions' },
  { kind: 'prefix', value: '/api/auth/security' },
  { kind: 'prefix', value: '/api/auth/profile' },
  { kind: 'prefix', value: '/api/auth/password' },
  { kind: 'prefix', value: '/api/auth/change-password' },
  { kind: 'prefix', value: '/api/auth/sign-urls' },
  { kind: 'prefix', value: '/api/auth/security-questions' },
  // OIDC / SSO — entire namespace lives on the rewrite
  // (ssoAuth.ts + oidc.ts, mounted in routesConfig.ts). Legacy never
  // implemented any of these, so requests were 404ing from the legacy
  // Worker fallback.
  { kind: 'prefix', value: '/api/oidc' },
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
  // Skip Tracker 3.5 — full namespace on the rewrite (replaced stubs mount).
  { kind: 'prefix', value: '/api/skiptracer-v2' },
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
  // Recipient-facing QR acknowledgement form (public, no auth) and the
  // officer-side admin surface (auth-required). Both live in
  // src/routes/serveReceipt.ts — route both prefixes so neither falls
  // through to the legacy worker (which has no handler for them).
  { kind: 'prefix', value: '/api/serve-receipt' },
  { kind: 'prefix', value: '/api/serve-receipts' },
  { kind: 'prefix', value: '/api/serve-intake' },
  // Serve queue + attempt file folders. Do NOT use a bare `/api/serve`
  // prefix: pathname.startsWith('/api/serve') also matches
  // `/api/servemanager`. Trailing-slash + exact `/api/serve` plus the
  // `/api/process-server` alias the SPA actually calls.
  { kind: 'prefix', value: '/api/process-server' },
  { kind: 'prefix', value: '/api/serve/' },
  { kind: 'regex', value: /^\/api\/serve$/ },
  { kind: 'prefix', value: '/api/serve-dashboard' },
  { kind: 'prefix', value: '/api/serve-queue' },
  // /api/ocr/scan-document is the alias URL the ServeIntakePage client
  // already calls for its in-page image preview path. The handler is
  // src/routes/ocr.ts (delegates to the same extraction utility as
  // /api/serve-intake/scan-document). Bare /api/ocr is the full prefix
  // so future OCR sub-paths come along automatically.
  { kind: 'prefix', value: '/api/ocr' },

  // ── File attachments (Dispatch Files tab, documents, ID photos) ──
  // The SPA used to POST these cross-origin to api.rmpgutah.us to dodge a
  // Pages 200-rewrite that produced ERR_HTTP2_PROTOCOL_ERROR. That workaround
  // now dies at the zone WAF: only /api/health skips the managed challenge, so
  // a browser POST to the API hostname comes back as challenge HTML (or is
  // discarded by CORP same-origin) and FileAttachments shows "Upload failed".
  // Same-origin /api/uploads on rmpgutah.us hits THIS proxy (zone route
  // rmpgutah.us/api/*) and service-binds to the rewrite — no CORS, no extra
  // challenge host. Must be on env.API; the rewrite owns putEncrypted().
  { kind: 'prefix', value: '/api/uploads' },

  // Same-origin WebSocket upgrades (CAD hub, AlertHubDO, VoiceHubDO,
  // WebBrowserSessionDO). Explicit so they never depend on fallthrough.
  { kind: 'prefix', value: '/api/ws' },
  { kind: 'prefix', value: '/api/alerts-ws' },
  { kind: 'prefix', value: '/api/voice-ws' },
  { kind: 'prefix', value: '/api/web-browser-ws' },

  { kind: 'prefix', value: '/api/assessor' },
  { kind: 'prefix', value: '/api/evidence' },
  { kind: 'prefix', value: '/api/field-photos' },
  { kind: 'prefix', value: '/api/property-photos' },
  { kind: 'prefix', value: '/api/business-photos' },
  { kind: 'prefix', value: '/api/redactions' },
  { kind: 'prefix', value: '/api/tesseract-training' },
  { kind: 'prefix', value: '/api/tesseract-ocr' },
  { kind: 'prefix', value: '/api/mapbox' },
  { kind: 'prefix', value: '/api/user' },
  { kind: 'prefix', value: '/api/web-browser' },
  { kind: 'prefix', value: '/api/browser-search' },
  { kind: 'prefix', value: '/api/statutes' },
  { kind: 'prefix', value: '/api/dispatch/gps' },

  // Integrations that the SPA talks to same-origin (Mapbox token, Graph
  // mailbox connect, jail roster, GPS vendors, ServeManager).
  { kind: 'prefix', value: '/api/integrations' },
  { kind: 'prefix', value: '/api/geocode' },
  { kind: 'prefix', value: '/api/email' },
  { kind: 'prefix', value: '/api/email-oauth' },
  { kind: 'prefix', value: '/api/jail-roster' },
  { kind: 'prefix', value: '/api/microbilt' },
  { kind: 'prefix', value: '/api/clearpathgps' },
  { kind: 'prefix', value: '/api/traccar' },
  { kind: 'prefix', value: '/api/servemanager' },
  { kind: 'prefix', value: '/api/howen' },

  // ── HR module ──
  // Whole namespace on the rewrite (leave, disciplinary, reviews, benefits,
  // payroll, grievances, attendance, documents, PIPs).
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
