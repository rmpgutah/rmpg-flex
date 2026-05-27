// ============================================================
// RMPG Flex — Route Registry
// ============================================================
// SINGLE source of truth for every HTTP route mount. `src/index.ts`
// iterates this array twice (auth middleware first, then routers)
// instead of scattering ~150 lines of `app.use(...)` / `app.route(...)`
// across 4-5 separate code locations.
//
// Why this exists (the bug pattern this kills):
//   Before: adding a new route required THREE edits to src/index.ts —
//     1. import line at the top (around line 45)
//     2. `app.use(prefix, authMiddleware) + app.use(prefix/*, ...)`
//        somewhere in the middle
//     3. `app.route(prefix, router)` somewhere near the bottom
//   When two PRs added routes in parallel, EACH of those three lines
//   collided with the other PR's three lines. We accumulated 4+
//   rounds of merge conflicts per port — and each merge moved main
//   forward, re-conflicting any still-open PR. Real outage: PR #605
//   auto-merge silently dropped an import, deploy failed (TS2304),
//   then competing hotfixes #606 + #607 BOTH added it back, deploy
//   failed again (TS2300 duplicate).
//
//   After: adding a route is a 1-line append to ROUTE_REGISTRY plus
//   an import in this file. Two PRs adding entries CAN still collide
//   if both insert at the same line — the "tail-append auto-merges"
//   hope didn't survive contact with reality. PRs #625/626/628/629
//   (2026-05-24) all wanted the same slot between forensics and
//   audit, and all conflicted. The fix is the alphabetical convention
//   in the RMS section below: each new prefix lands at a unique line
//   based on its name, so two concurrent PRs end up modifying
//   different lines and git auto-merges cleanly.
//
// Ordering invariants (Hono dispatches in registration order):
//   - Public routes (no auth) first — declared with auth: 'public'
//   - Longer-prefix routers BEFORE shorter ones that share trie paths
//     (e.g. dispatchCallLinks at /api/dispatch BEFORE dispatchCalls
//      at /api/dispatch/calls — Hono matches greedy)
//   - More-specific subroutes BEFORE catch-alls (subjects/properties
//     BEFORE records; recommendedUnits/audioMode BEFORE units;
//     incidentsRouter BEFORE incidentSupplements)
//   - RMS Phase-1 ports section: ALPHABETICAL by prefix (see section
//     header below for rationale)
//   - Stubs always last
//
// Auth applies to BOTH bare prefix and /:* glob — Hono's `/path/*`
// doesn't match the bare `/path` itself. Skipping the bare-path use()
// was the bug that made dispatcher_id NULL on POST /api/dispatch/calls
// (fixed 2026-05-24 in PR #620 — see the auth-coverage block in
// applyRouteRegistry below).
// ============================================================

import type { Hono } from 'hono';

import auth from './routes/auth';
import health from './routes/health';
import mapData from './routes/mapData';
import admin from './routes/admin';
import ai from './routes/ai';
import offline from './routes/offline';
import personnel from './routes/personnel';
import presence from './routes/presence';
import records from './routes/records';
import subjects from './routes/records/subjects';
import properties from './routes/properties';
import geocode from './routes/geocode';
import warrants from './routes/warrants';
import nibrs from './routes/nibrs';
import incidentSupplements from './routes/incidentSupplements';
import incidentsRouter from './routes/incidents';
import audit from './routes/audit';
import arrests from './routes/arrests';
import cases from './routes/cases';
import citations from './routes/citations';
import fieldInterviews from './routes/fieldInterviews';
import fleet from './routes/fleet';
import documentFolders from './routes/documents/folders';
import documentIntake from './routes/documentIntake';
import pdfTools from './routes/pdfTools';
import tts from './routes/tts';
import trespassOrders from './routes/trespassOrders';
import forensics from './routes/forensics';
import hr from './routes/hr';
import patrol from './routes/patrol';
import radio from './routes/radio';
import serveIntake from './routes/serveIntake';
import ocr from './routes/ocr';
import skiptracer from './routes/skiptracer';
import shiftPlans from './routes/shiftPlans';
import court from './routes/court';
import serve from './routes/serve';
import reports from './routes/reports';
import stubs from './routes/stubs';
// Dispatch domain
import dispatchCalls from './routes/dispatch/calls';
import dispatchUnits from './routes/dispatch/units';
import dispatchGps from './routes/dispatch/gps';
import dispatchGeography from './routes/dispatch/geography';
import dispatchAggregates from './routes/dispatch/aggregates';
import dispatchPremiseHistory from './routes/dispatch/premiseHistory';
import dispatchPanic from './routes/dispatch/panic';
import dispatchCallLinks from './routes/dispatch/callLinks';
import runCards from './routes/runCards';
import welfare from './routes/welfare';
import {
  recommendedUnits, audioMode, premiseAlerts, callWarnings,
  unitStatus, bolos as bolosRouter, welfareActive,
  closestUnit, autoAssign, callTimeline,
} from './routes/dispatch/extensions';
// Business records
import businessVehicles from './routes/business/vehicles';
import businessVisits from './routes/business/visits';
import businessPhotos from './routes/business/photos';
// Howen dashcam integration
import howen from './routes/howen';
// Offender registry (stats only)
import offenderRegistry from './routes/offenderRegistry';
// Permissive Router alias — `Hono<any>` accepts every router shape
// the existing route files happen to declare. Some routes use the
// full `Hono<Env>` while others narrowed to just what they need
// (e.g. `Hono<{ Bindings: { DB } }>`). The registry doesn't need
// to enforce strictness; Hono's .route() is forgiving at runtime
// and binding narrowing is a compile-time concern handled inside
// each route file.
type Router = Hono<any, any, any>;

export interface RouteMount {
  /** API path prefix the router mounts at (e.g. '/api/cases') */
  prefix: string;
  /** Hono router for this mount */
  router: Router;
  /**
   * Auth gate:
   *   'public'   — no auth middleware applied (open endpoint)
   *   'required' — authMiddleware on both bare prefix AND /:* glob
   *                (the duplicate is intentional — Hono's /path/* glob
   *                doesn't match the bare /path)
   */
  auth: 'public' | 'required';
  /** Optional inline note shown by the index.ts iterator's console.log
   *  on first request (debug only — strip in prod build if noisy) */
  note?: string;
}

// Ordered list — Hono dispatches in registration order, so put
// longer-prefix and more-specific mounts BEFORE the ones they share
// trie paths with. See "Ordering invariants" in the file header.
export const ROUTE_REGISTRY: RouteMount[] = [
  // ── Public ─────────────────────────────────────────────────
  { prefix: '/api/health', router: health, auth: 'public' },
  { prefix: '/api/auth', router: auth, auth: 'public' },
  { prefix: '/api/map-data', router: mapData, auth: 'public' },

  // ── Dispatch (longer-prefix routers first) ─────────────────
  // callLinks + panic + premiseHistory mount at /api/dispatch and
  // own paths like /calls/:id/persons, /panic, /premise-history.
  // MUST come before dispatchCalls so the longer-prefix patterns win.
  { prefix: '/api/dispatch', router: dispatchCallLinks, auth: 'required',
    note: 'BEFORE dispatchCalls — handles /calls/:id/{persons,vehicles,property}' },
  { prefix: '/api/dispatch', router: dispatchPanic, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchPremiseHistory, auth: 'required' },

  // Dispatch extensions BEFORE canonical resources — more-specific
  // paths (/calls/:id/recommended-units, /units/:id/status, etc) must
  // match before the catch-all /:id handler in dispatchCalls/dispatchUnits.
  { prefix: '/api/dispatch/calls', router: recommendedUnits, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: closestUnit, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: autoAssign, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: callTimeline, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: callWarnings, auth: 'required' },
  { prefix: '/api/dispatch/units', router: audioMode, auth: 'required' },
  { prefix: '/api/dispatch/units', router: unitStatus, auth: 'required' },
  { prefix: '/api/dispatch/premise-alerts', router: premiseAlerts, auth: 'required' },
  { prefix: '/api/dispatch/bolos', router: bolosRouter, auth: 'required' },
  { prefix: '/api/dispatch/welfare', router: welfareActive, auth: 'required' },

  // Canonical dispatch resources
  { prefix: '/api/dispatch/calls', router: dispatchCalls, auth: 'required' },
  { prefix: '/api/dispatch/units', router: dispatchUnits, auth: 'required' },
  { prefix: '/api/dispatch/gps', router: dispatchGps, auth: 'required' },
  { prefix: '/api/dispatch/geography', router: dispatchGeography, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchAggregates, auth: 'required' },
  { prefix: '/api/dispatch/run-cards', router: runCards, auth: 'required' },
  { prefix: '/api/dispatch/welfare', router: welfare, auth: 'required' },

  // ── Admin / personnel / presence ───────────────────────────
  { prefix: '/api/admin', router: admin, auth: 'required' },
  { prefix: '/api/ai', router: ai, auth: 'required',
    note: 'AI dashboard stubs (config/stats/status/health/activity). Real provider wiring is Phase 2.' },
  { prefix: '/api/personnel', router: personnel, auth: 'required' },
  { prefix: '/api/presence', router: presence, auth: 'required' },
  // /api/offline mounts further down in the alphabetical RMS section
  // (PR #638). Hono dispatches in registration order so a second mount
  // here would be dead. Cleanup of an earlier dup-mount that the
  // import-dedupe in 0ea59c11 didn't catch.

  // ── Records (subroutes BEFORE catch-all) ───────────────────
  { prefix: '/api/records/properties', router: properties, auth: 'required' },
  { prefix: '/api/records/subjects', router: subjects, auth: 'required',
    note: 'BEFORE /api/records — /search must hit subjects router, not records catch-all' },
  { prefix: '/api/records', router: records, auth: 'required' },

  // ── NIBRS + Incidents (incidents BEFORE supplements) ───────
  { prefix: '/api/nibrs', router: nibrs, auth: 'required' },
  { prefix: '/api/incidents', router: incidentsRouter, auth: 'required',
    note: 'BEFORE incidentSupplements — exact patterns /:id/{submit,approve,return} must match first' },
  { prefix: '/api/incidents', router: incidentSupplements, auth: 'required' },

  // ── RMS routes (Phase 1 ports) ─────────────────────────────
  // KEEP ALPHABETICAL BY PREFIX. New ports must be inserted at the
  // alphabetical position of their prefix — NOT appended at the end
  // of the section. Why: two PRs both "appending at the end" both
  // modify the same line (just before /api/audit) and git can't
  // auto-merge them. Two PRs inserting at different alphabetical
  // positions (e.g. /api/court vs /api/serve) modify different
  // lines and auto-merge cleanly. PRs #625/626/628/629 (2026-05-24)
  // all conflicted on this exact slot — that's how this rule got
  // codified. None of the prefixes here have ordering invariants
  // with each other (no shared trie roots), so alphabetical is safe.
  { prefix: '/api/arrests', router: arrests, auth: 'required',
    note: 'Manual booking subset only; JailBase poller endpoints in a Phase 2 PR' },
  { prefix: '/api/cases', router: cases, auth: 'required',
    note: 'MVP core; entity-junction tables in a follow-up PR' },
  { prefix: '/api/citations', router: citations, auth: 'required' },
  { prefix: '/api/court', router: court, auth: 'required',
    note: 'Court events + subpoenas (single-table); reminder fan-out deferred' },
  { prefix: '/api/field-interviews', router: fieldInterviews, auth: 'required' },
  { prefix: '/api/fleet', router: fleet, auth: 'required',
    note: 'List/analytics/detail + create/update/soft-delete. Other fleet sub-paths (fuel/maintenance/inspections/personnel-notes/archive/assign) still live on legacy.' },
  { prefix: '/api/forensics', router: forensics, auth: 'required',
    note: 'MVP: cases + exhibits + analyses + activity log; hash sets / reports / cross-links deferred' },
  { prefix: '/api/hr', router: hr, auth: 'required',
    note: 'Leave + disciplinary + performance reviews; /benefits returns [] (table deferred). Payroll/exit/grievances/PIPs stay on legacy.' },
  { prefix: '/api/offline', router: offline, auth: 'required',
    note: 'Offline sync (push/pull + secrets). /sync/push dispatches allowlisted writes through the root app; see src/routes/offline.ts.' },
  { prefix: '/api/patrol', router: patrol, auth: 'required',
    note: 'MVP: checkpoints + scans + breaks + tour verifications; analytics endpoints deferred' },
  { prefix: '/api/radio', router: radio, auth: 'required',
    note: 'Channels + transmissions (append-only) + per-user recordings + stats' },
  { prefix: '/api/serve', router: serve, auth: 'required',
    note: 'Officer-facing serve workflow (shares tables with /api/serve-intake)' },
  { prefix: '/api/serve-intake', router: serveIntake, auth: 'required',
    note: 'Upload + OCR (Tesseract container) + Workers-AI field extraction; commits to serve_queue + serve_intake_documents' },
  { prefix: '/api/ocr', router: ocr, auth: 'required',
    note: 'Alias of /api/serve-intake/scan-document — the client URL the OCR preview path already calls' },
  { prefix: '/api/skiptracer', router: skiptracer, auth: 'required',
    note: 'Read-only over skiptracer_dossiers + microbilt_searches; legacy still owns POST /search' },
  { prefix: '/api/trespass-orders', router: trespassOrders, auth: 'required' },
  { prefix: '/api/audit', router: audit, auth: 'required' },

  // ── Documents ──────────────────────────────────────────────
  { prefix: '/api/documents', router: documentFolders, auth: 'required' },
  { prefix: '/api/pdf-tools', router: pdfTools, auth: 'required' },
  { prefix: '/api/document-intake', router: documentIntake, auth: 'required' },
  { prefix: '/api/tts', router: tts, auth: 'required' },

  // ── Business records ───────────────────────────────────────
  { prefix: '/api/business-vehicles', router: businessVehicles, auth: 'required' },
  { prefix: '/api/business-visits', router: businessVisits, auth: 'required' },
  { prefix: '/api/business-photos', router: businessPhotos, auth: 'required' },

  // ── Fleet ──────────────────────────────────────────────────
  // Vehicles + dashcam videos. See src/routes/fleet.ts for the implemented
  // subset; unimplemented sub-tabs (fuel-cards, recalls, health-scores,
  // maintenance-schedule, driver-performance, service-alerts, cost-trends,
  // vehicle-lifecycle, pretrip) continue to fall through to the proxy stubs
  // in proxy/index.ts until their handlers land.
  { prefix: '/api/fleet', router: fleet, auth: 'required' },

  // ── Howen dashcam integration ──────────────────────────────
  // Device fleet + recent events. See src/routes/howen.ts.
  { prefix: '/api/howen', router: howen, auth: 'required' },

  // ── HR (leave module only — see src/routes/hr.ts) ──────────
  // Other HR sub-modules (payroll, grievances, documents, attendance,
  // pips, benefits) continue to fall through to the proxy stubs in
  // proxy/index.ts until their backing tables land on live D1.
  { prefix: '/api/hr', router: hr, auth: 'required' },

  // ── Offender registry (stats only) ─────────────────────────
  // /search + per-person detail is a follow-up; only the dashboard
  // tile-count endpoint is implemented today.
  { prefix: '/api/offender-registry', router: offenderRegistry, auth: 'required' },

  // ── Bare /api mounts (router owns sub-paths) ───────────────
  // Each entry here mounts at the bare /api prefix so the router can
  // own multiple disjoint sub-paths under one mount (a Hono.route()
  // limitation workaround). MUST be `auth: 'public'` at the registry
  // level — `required` would make the auth loop register
  // `app.use('/api/*', authMiddleware)`, blanket-blocking every
  // /api/* path including /api/auth/login. Auth is enforced INSIDE
  // each router via `router.use('*', authMiddleware)`.
  { prefix: '/api', router: geocode, auth: 'public',
    note: 'Serves /api/geocode/* and /api/integrations/mapbox/client-token. See src/routes/geocode.ts for the in-router auth setup.' },
  { prefix: '/api', router: shiftPlans, auth: 'public',
    note: 'Serves /api/shift-plans/*, /api/shift-swaps/*, /api/shift-overtime, /api/staffing-levels, /api/shift-notifications. See src/routes/shiftPlans.ts for the in-router auth setup.' },

  // ── Warrants — real implementation ─────────────────────────
  { prefix: '/api/warrants', router: warrants, auth: 'required' },

  // ── Stub endpoints (dashboard/feature compatibility) ──────
  // All point at the same stubs router which fans out to its internal
  // paths (/, /preferences, /unread-count, /dashboard, etc).
  { prefix: '/api/user', router: stubs, auth: 'required' },
  { prefix: '/api/notifications', router: stubs, auth: 'required' },
  // Reports: real aggregations live in src/routes/reports.ts. Two stubs that
  // shared the same shape (/response-times) were moved into the reports
  // router so the stubs router doesn't also claim the prefix. /crime-analysis
  // still falls through to legacy via the proxy — separate concern.
  { prefix: '/api/reports', router: reports, auth: 'required' },
  { prefix: '/api/comms', router: stubs, auth: 'required' },
  { prefix: '/api/weather', router: stubs, auth: 'required' },
  { prefix: '/api/email', router: stubs, auth: 'required' },
  { prefix: '/api/integrations', router: stubs, auth: 'required' },
  { prefix: '/api/dispatch/stats', router: stubs, auth: 'required' },
  { prefix: '/api/dispatch/shift-handoff', router: stubs, auth: 'required' },
];
