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

const API_ROUTES: RouteRule[] = [
  // ── More specific dispatch sub-paths (new in rewrite) ──
  // /api/dispatch/calls/:id/{recommended-units, closest-unit, auto-assign,
  // timeline, warnings} all live on env.API. Listed BEFORE the
  // bare /api/dispatch/calls/:id rule so they win the match.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+\/(recommended-units|closest-unit|auto-assign|timeline|warnings)(\/.*)?$/ },

  // /api/dispatch/calls/check-duplicate — rewrite has correct route ordering
  // (literal /check-duplicate registered before parametric /:id). Legacy
  // hits the /:id handler first and 500s on NaN cast.
  { kind: 'prefix', value: '/api/dispatch/calls/check-duplicate' },

  // GET/PUT/DELETE /api/dispatch/calls/{id} (exact match, no trailing segment)
  // — rewrite avoids the D1 100-column-cap that 500s the legacy GET handler.
  // POST /api/dispatch/calls (create) stays on legacy until the rewrite is
  // validated against the live broadcaster + linked-incident flow.
  { kind: 'regex', value: /^\/api\/dispatch\/calls\/\d+$/, methods: ['GET', 'PUT', 'DELETE'] },

  // ── Records search (rewrite has both; legacy is missing vehicles/search) ──
  { kind: 'prefix', value: '/api/records/persons/search' },
  { kind: 'prefix', value: '/api/records/vehicles/search' },

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
  // Records — Evidence/Property tab, Businesses tab, approval queue
  { kind: 'prefix', value: '/api/records/evidence' },
  { kind: 'prefix', value: '/api/records/businesses' },
  { kind: 'prefix', value: '/api/records/reports/approval-queue' },
  // Admin extras the legacy worker doesn't implement
  { kind: 'prefix', value: '/api/admin/retention' },
  { kind: 'prefix', value: '/api/admin/departments' },
  { kind: 'prefix', value: '/api/admin/notification-rules' },
  { kind: 'prefix', value: '/api/admin/announcements' },
  // Auth security history
  { kind: 'prefix', value: '/api/auth/security/login-history' },
  // Offline app secrets
  { kind: 'prefix', value: '/api/offline/secrets' },
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    for (const rule of API_ROUTES) {
      if (matches(rule, pathname, method)) {
        return env.API.fetch(request);
      }
    }
    return env.LEGACY.fetch(request);
  },
};
