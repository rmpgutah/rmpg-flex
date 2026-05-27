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
  //
  // History:
  //   2026-05-24: Added stub for /api/statutes/search after live D1
  //   was found missing the utah_statutes table. Removed the same day
  //   after schema was applied (PR #637) AND 1387 sections were seeded
  //   from le.utah.gov XML downloads. See scripts/seed/utah_statutes.sql.
  //   2026-05-26: Added stubs above for /warrants/utah-search/auto-poll-status
  //   and /personnel/equipment to silence dashboard polling 404s.
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
