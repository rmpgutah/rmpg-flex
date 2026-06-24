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
import tiles from './routes/tiles';
import geo from './routes/geo';
import admin from './routes/admin';
import adminDev from './routes/adminDev';
import emailRoute from './routes/email';
import emailOauthCallback from './routes/emailOauthCallback';
import announcements from './routes/announcements';
import automation from './routes/automation';
import affairs from './routes/affairs';
import ai from './routes/ai';
import alerts from './routes/notifications';
import assets from './routes/assets';
import billing from './routes/billing';
import serveBilling from './routes/serveBilling';
import invoices from './routes/invoices';
import useOfForce from './routes/useOfForce';
import notificationsInbox from './routes/notificationsInbox';
import community from './routes/community';
import intel from './routes/intel';
import intelAi from './routes/intelAi';
import interagency from './routes/interagency';
import jail from './routes/jail';
import offline from './routes/offline';
import qa from './routes/qa';
import risk from './routes/risk';
import tasks from './routes/tasks';
import training from './routes/training';
import personnel from './routes/personnel';
import presence from './routes/presence';
import mdt from './routes/mdt';
import records from './routes/records';
import subjects from './routes/records/subjects';
import properties from './routes/properties';
import geocode from './routes/geocode';
import crime from './routes/crime';
import warrants from './routes/warrants';
import workOrders from './routes/workOrders';
import inspectionTemplates from './routes/inspectionTemplates';
import fleetViz from './routes/fleetViz';
import nibrs from './routes/nibrs';
import incidentSupplements from './routes/incidentSupplements';
import incidentSubresources from './routes/incidentSubresources';
import incidentsRouter from './routes/incidents';
import audit from './routes/audit';
import auditEmit from './routes/auditEmit';
import auditByEntity from './routes/auditByEntity';
import arrests from './routes/arrests';
import assessor from './routes/assessor';
import cases from './routes/cases';
import accreditation from './routes/accreditation';
import alarms from './routes/alarms';
import alpr from './routes/alpr';
import analytics from './routes/analytics';
import redactionsRouter from './routes/redactions';
import citations from './routes/citations';
import clearpathgps from './routes/clearpathgps';
import drivingEvents from './routes/drivingEvents';
import clients from './routes/clients';
import cloudflare from './routes/cloudflare';
import connections from './routes/connections';
import crm from './routes/crm';
import deepResearch from './routes/deepResearch';
import crisisResponse from './routes/crisisResponse';
import fieldInterviews from './routes/fieldInterviews';
import fleet from './routes/fleet';
import fleetio from './routes/fleetio';
import documentFolders from './routes/documents/folders';
import documentsLibrary from './routes/documents/library';
import documentIntake from './routes/documentIntake';
import pdfTools from './routes/pdfTools';
import tts from './routes/tts';
import trespassOrders from './routes/trespassOrders';
import voiceRoute from './routes/voice';
import forensics from './routes/forensics';
import geofences from './routes/geofences';
import gangIntel from './routes/gangIntel';
import hr from './routes/hr';
import patrol from './routes/patrol';
import patrolMileage from './routes/patrolMileage';
import radio from './routes/radio';
import iped from './routes/iped';
import serve from './routes/serve';
import serveIntake from './routes/serveIntake';
import ocr from './routes/ocr';
import skiptracer from './routes/skiptracer';
import shiftPlans from './routes/shiftPlans';
import court from './routes/court';
import dlRecords from './routes/dlRecords';
import microbilt from './routes/microbilt';
import screening from './routes/screening';
import sorSources from './routes/sorSources';
import nsopw from './routes/nsopw';
import mapAnnotations from './routes/mapAnnotations';
import personIntel from './routes/personIntel';
import investigation from './routes/investigation';

import settings from './routes/settings';
import adminSettings from './routes/adminSettings';
import knowledgeBase from './routes/knowledgeBase';
import recruitment from './routes/recruitment';
import refData from './routes/refData';
import reports from './routes/reports';
import statutes from './routes/statutes';
import specialOps from './routes/specialOps';
import victimServices from './routes/victimServices';
import integrations from './routes/integrations';
import stubs from './routes/stubs';
import voicePersona from './routes/voicePersona';
import mobileCfs, { cfsQr } from './routes/mobileCfs';
import firecrawlTools from './routes/firecrawlTools';
import webResearch from './routes/webResearch';
import pdfEngine from './routes/pdfEngine';
import dar from './routes/dar';
import reanalysis from './routes/reanalysis';
import evidence from './routes/evidence';
import codeEnforcement from './routes/codeEnforcement';
import weather from './routes/weather';
// Dispatch domain
import dispatchCalls from './routes/dispatch/calls';
import dispatchUnits from './routes/dispatch/units';
import dispatchDuty from './routes/dispatch/duty';
import inspections from './routes/inspections';
import dispatchGps from './routes/dispatch/gps';
import dispatchTrips from './routes/dispatch/trips';
import dispatchGeography from './routes/dispatch/geography';
import dispatchAggregates from './routes/dispatch/aggregates';
import dispatchPremiseHistory from './routes/dispatch/premiseHistory';
import dispatchPanic from './routes/dispatch/panic';
import dispatchAnomalies from './routes/dispatch/anomalies';
import dispatchCallLinks from './routes/dispatch/callLinks';
import { linkOptions as linkOptionsRead, linkOptionsAdmin } from './routes/linkOptions';
import dispatchShiftHandoff from './routes/dispatch/shiftHandoff';
import runCards from './routes/runCards';
import welfare from './routes/welfare';
import {
  recommendedUnits, audioMode, premiseAlerts, callWarnings,
  unitStatus, bolos as bolosRouter, welfareActive,
  closestUnit, autoAssign, callTimeline, callActions,
} from './routes/dispatch/extensions';
// Business records
import businessVehicles from './routes/business/vehicles';
import businessVisits from './routes/business/visits';
import businessPhotos from './routes/business/photos';
import fieldPhotos from './routes/fieldPhotos';
// Howen dashcam integration
import howen from './routes/howen';
// Downloads + auto-updates
import downloads from './routes/downloads';
// Offender registry (stats only)
import narcotics from './routes/narcotics';
import nav from './routes/nav';
import offenderRegistry from './routes/offenderRegistry';
import uploads from './routes/uploads';
import companyDocuments from './routes/companyDocuments';
import wallet from './routes/wallet';
import jailRoster from './routes/jailRoster';
// Full-trip dashcam footage (FlexCamPage). Handler existed but the mount was
// dropped in a squash merge, 404ing the entire page.
import flexcam from './routes/flexcam';
// Colorado DOC offender search (cache-backed; live source is CAPTCHA-gated).
import coloradoDoc from './routes/coloradoDoc';
// Server-side Mapbox proxy backing client/src/utils/mapboxServices.ts.
import mapbox from './routes/mapbox';
// Mapbox telemetry sink — Mapbox SDK posts usage events to events.mapbox.com,
// which some operator networks block; redirect those POSTs to a same-origin
// 204 to kill the console spam without affecting map functionality.
import mapboxTelemetry from './routes/mapboxTelemetry';

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
  { prefix: '/api/tiles', router: tiles, auth: 'public' },
  { prefix: '/api/geo', router: geo, auth: 'public' },

  // Per-shift QR-token-authed vehicle inspection page (/m/shift/<token>). The
  // token IS the credential — no JWT required because the page is meant for
  // a personal phone scanning a QR shown on the desktop/MDT ShiftCard.
  { prefix: '/api/inspections', router: inspections, auth: 'public',
    note: 'Token-authed: resolves the open time_entry whose qr_token matches' },

  // Crime layers for the NAVIGATE tactical map (SLC public data proxy + our
  // own CFS). Auth-gated like the rest of the app; /local reads our DB.
  { prefix: '/api/crime', router: crime, auth: 'required' },

  // ── Dispatch (longer-prefix routers first) ─────────────────
  // callLinks + panic + premiseHistory mount at /api/dispatch and
  // own paths like /calls/:id/persons, /panic, /premise-history.
  // MUST come before dispatchCalls so the longer-prefix patterns win.
  // Officer shift lifecycle (clock-on + on-duty + fleet vehicle, integrated).
  // BEFORE the bare /api/dispatch routers so /duty/* wins its prefix.
  { prefix: '/api/dispatch/duty', router: dispatchDuty, auth: 'required',
    note: 'Start/End Shift — clock-in/out + units.status + fleet assign in one atomic action' },
  { prefix: '/api/dispatch', router: dispatchCallLinks, auth: 'required',
    note: 'BEFORE dispatchCalls — handles /calls/:id/{persons,vehicles,property}' },
  { prefix: '/api/dispatch', router: linkOptionsRead, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchPanic, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchAnomalies, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchPremiseHistory, auth: 'required' },

  // Dispatch extensions BEFORE canonical resources — more-specific
  // paths (/calls/:id/recommended-units, /units/:id/status, etc) must
  // match before the catch-all /:id handler in dispatchCalls/dispatchUnits.
  { prefix: '/api/dispatch/calls', router: recommendedUnits, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: closestUnit, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: autoAssign, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: callTimeline, auth: 'required' },
  { prefix: '/api/dispatch/calls', router: callActions, auth: 'required',
    note: 'BEFORE dispatchCalls — handles /:id/{revert-status,le-notification,transfer,broadcast-note,notes/:noteId,generate-incident}' },
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
  { prefix: '/api/dispatch/trips', router: dispatchTrips, auth: 'required' },
  { prefix: '/api/dispatch/geography', router: dispatchGeography, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchAggregates, auth: 'required' },
  { prefix: '/api/dispatch/run-cards', router: runCards, auth: 'required' },
  { prefix: '/api/dispatch/welfare', router: welfare, auth: 'required' },

  // ── Admin / personnel / presence ───────────────────────────
  { prefix: '/api/admin/reanalysis', router: reanalysis, auth: 'required',
    note: 'Footage backfill, ALPR confidence correction, analytics replay. All endpoints require admin role (enforced per-route).' },
  { prefix: '/api/admin/dev', router: adminDev, auth: 'required',
    note: 'Dev panel: feature flags (KV-backed GET/PUT), mock GPS injection + call seed. Admin role enforced per-route; GET /feature-flags is readable by any authed user.' },
  { prefix: '/api/admin', router: admin, auth: 'required' },
  { prefix: '/api/admin/settings', router: adminSettings, auth: 'required' },
  { prefix: '/api/admin/link-options', router: linkOptionsAdmin, auth: 'required' },
  { prefix: '/api/email', router: emailRoute, auth: 'required',
    note: 'AdminEmailTab credential storage + status. /admin/* writes are role-gated (admin|manager).' },
  { prefix: '/api/email-oauth', router: emailOauthCallback, auth: 'public',
    note: 'MUST be public — Microsoft redirects the browser here with no JWT. Token exchange happens server-side using stored client_secret.' },
  { prefix: '/api/announcements', router: announcements, auth: 'required',
    note: 'Officer-facing reader for active/role-scoped broadcasts. Admin CRUD lives under /api/admin/announcements.' },
  { prefix: '/api/ai', router: ai, auth: 'required',
    note: 'AI dashboard stubs (config/stats/status/health/activity). Real provider wiring is Phase 2.' },
  { prefix: '/api/voice', router: voiceRoute, auth: 'required',
    note: 'Voice dialogue agent (/dialogue) + dispatch read-aloud (/read-aloud) for the AI dispatcher.' },
  { prefix: '/api/personnel', router: personnel, auth: 'required' },
  { prefix: '/api/presence', router: presence, auth: 'required' },
  { prefix: '/api/mdt', router: mdt, auth: 'required' },
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
  { prefix: '/api/incidents', router: incidentSupplements, auth: 'required',
    note: 'BEFORE incidentSubresources — /:id/supplements/{dv,pursuit} string suffixes must match before the numeric /:id/supplements/:sid' },
  { prefix: '/api/incidents', router: incidentSubresources, auth: 'required',
    note: 'offenses/officers/links + generic supplements CRUD (numeric-id constrained)' },

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
  { prefix: '/api/cases', router: cases, auth: 'required',
    note: 'MVP core; entity-junction tables in a follow-up PR' },
  { prefix: '/api/citations', router: citations, auth: 'required' },
  { prefix: '/api/clients', router: clients, auth: 'required',
    note: 'Client stub — returns [] for GET, accepts POST/PUT/DELETE. Full CRUD lives under /api/admin/clients today.' },
  { prefix: '/api/connections', router: connections, auth: 'required',
    note: 'Connection-graph analyst tool: /search, /graph, /path, /investigations CRUD. Node types incl. call (CFS) + report (supplemental_reports). Backed by connection_investigations (live D1, migration 0043).' },
  { prefix: '/api/court', router: court, auth: 'required',
    note: 'Court events + subpoenas (single-table); reminder fan-out deferred' },
  { prefix: '/api/crisis', router: crisisResponse, auth: 'required',
    note: 'Crisis response: CIT deployments, mental health holds, mobile crisis team coordination' },
  { prefix: '/api/crm', router: crm, auth: 'required',
    note: 'CRM stub — dashboard, leads, proposals, reports, firecrawl, scraper admin, competitor monitor. All GETs return empty/null-safe shapes; mutations 201-OK as no-ops. Full CRM backend is Phase 2.' },
  { prefix: '/api/deep-research', router: deepResearch, auth: 'required' },
  { prefix: '/api/dl-records', router: dlRecords, auth: 'required',
    note: 'Local DL store CRUD over dl_records + dl_addresses. /verify + /ocr-scan (external APIs) stay on legacy — proxy routes only the bare path + numeric :id here.' },
  { prefix: '/api/cloudflare', router: cloudflare, auth: 'required',
    note: 'Admin Cloudflare platform integration — account telemetry (D1/R2/KV/Workers) + cache purge via an ADMIN-CONFIGURED least-privilege token in system_config (cf_api_token, never hardcoded).' },
  { prefix: '/api/field-interviews', router: fieldInterviews, auth: 'required' },
  { prefix: '/api/fleet', router: fleet, auth: 'required',
    note: 'Full fleet management: vehicles, fuel, maintenance, inspections, assignments, personnel, insurance, registration, tires, damage, recalls, parts, warranties, depreciation, accidents, keys, service providers, fuel cards, budgets, replacement plan, pretrip checklists, cost-per-mile, CSV export, analytics, map overlay, dashcam, utilization, emissions, lifecycle, scorecard. All sub-resource CRUD ported from legacy (May 2026).' },
  { prefix: '/api/fleetio', router: fleetio, auth: 'required',
    note: 'Fleet.io integration: /test-connection (any authed user), /sync-status (admin), /seed (admin). 503 when FLEETIO_API_KEY is unset.' },
  { prefix: '/api/forensics', router: forensics, auth: 'required',
    note: 'MVP: cases + exhibits + analyses + activity log; hash sets / reports / cross-links deferred' },
  { prefix: '/api/forensic-lab', router: forensics, auth: 'required',
    note: 'Alias for /api/forensics — client ForensicLabPage uses this path' },
  { prefix: '/api/geofences', router: geofences, auth: 'required',
    note: 'Geofence zone CRUD — writes to geofence_zones. All authenticated roles.' },
  { prefix: '/api/gang-intel', router: gangIntel, auth: 'required',
    note: 'Gang intelligence: members, gangs, graffiti records, injunctions, activity mapping' },
  { prefix: '/api/hr', router: hr, auth: 'required',
    note: 'Leave + disciplinary + performance reviews; /benefits returns [] (table deferred). Payroll/exit/grievances/PIPs stay on legacy.' },
  { prefix: '/api/iped', router: iped, auth: 'required',
    note: 'Read-only surface over forensic_hash_sets + forensic_hash_entries + iped_imports tables. GET /status, /hash-sets, /hash-sets/:id, /downloads.' },
  { prefix: '/api/map/annotations', router: mapAnnotations, auth: 'required',
    note: 'Shared map annotation pins (map_annotations table). All authenticated roles.' },
  { prefix: '/api/narcotics', router: narcotics, auth: 'required',
    note: 'Narcotics & vice: investigations, CI management, buy/bust ops, drug trend analysis' },
  { prefix: '/api/nav', router: nav, auth: 'required',
    note: 'Nav trip logging: auto-detect vehicle movement, breadcrumb trails, take-home vehicle support' },
  { prefix: '/api/offline', router: offline, auth: 'required',
    note: 'Offline sync (push/pull + secrets). /sync/push dispatches allowlisted writes through the root app; see src/routes/offline.ts.' },
  { prefix: '/api/patrol', router: patrol, auth: 'required',
    note: 'MVP: checkpoints + scans + breaks + tour verifications; analytics endpoints deferred' },
  { prefix: '/api/patrol', router: patrolMileage, auth: 'required',
    note: 'Mileage anchor (auto-pickup) + admin fix/audit chain rewrite + FORM PS-211 trip-log payload' },
    { prefix: '/api/person-intel', router: personIntel, auth: 'required',
      note: 'Person Intelligence Dossier: create/list/get dossier + officer data-point annotations + delete' },
  { prefix: '/api/investigation', router: investigation, auth: 'required',
    note: 'Case intelligence & cross-reference engine: FTS5 unified search, entity link CRUD, MO pattern matching. See investigation.ts.' },
    { prefix: '/api/radio', router: radio, auth: 'required',
    note: 'Channels + transmissions (append-only) + per-user recordings + stats' },
  { prefix: '/api/recruitment', router: recruitment, auth: 'required',
    note: 'Recruitment & hiring: applicant pipeline, testing, oral boards, onboarding workflow' },
  { prefix: '/api/ref-data', router: refData, auth: 'required',
    note: 'Fleet.io PR 2: cross-reference lookups (vehicle makes/models/types, fuel, VMRS, colors, vendors, ...) + NHTSA vPIC /decode-vin/:vin with D1 cache. Read-only — admin CRUD lands with the admin UI in PR 2b.' },
  { prefix: '/api/screening', router: screening, auth: 'required' },
  { prefix: '/api/sor-sources', router: sorSources, auth: 'required' },
  { prefix: '/api/nsopw', router: nsopw, auth: 'required',
    note: 'NSOPW nationwide SOR cross-reference. Name+DOB search, ' +
      'per-person re-screen, run/cache audit. See migration 0146 + ' +
      'docs/superpowers/specs/2026-06-22-nationwide-sor-nsopw-design.md.' },
  { prefix: '/api/serve', router: serve, auth: 'required',
    note: 'Officer-facing serve workflow (shares tables with /api/serve-intake)' },
  // Alias — ServePage calls /api/process-server/* but the handlers live
  // in src/routes/serve.ts (mounted at /api/serve). Mounting the same
  // router at /api/process-server means a single source of truth for
  // the queue + stats + route + attempt endpoints.
  { prefix: '/api/process-server', router: serve, auth: 'required',
    note: 'Alias of /api/serve for the ServePage URL contract (legacy /api/process-server/* proxy) — same router instance' },
  { prefix: '/api/special-ops', router: specialOps, auth: 'required',
    note: 'Special operations: SWAT callouts, tactical planning, equipment inventory' },
  { prefix: '/api/settings', router: settings, auth: 'required',
    note: 'Per-user + org-wide preference blobs for cross-device sync (migrations/0045)' },
  { prefix: '/api/statutes', router: statutes, auth: 'required',
    note: 'Utah law book (search/toc/chapter/section) over utah_statutes. Cutover from legacy /statutes/search — same {data:[]} contract, richer fields. Needs the matching proxy rule routing /api/statutes/* to env.API.' },
  { prefix: '/api/serve-intake', router: serveIntake, auth: 'required',
    note: 'Upload + OCR (Tesseract container) + Workers-AI field extraction; commits to serve_queue + serve_intake_documents' },
  { prefix: '/api/ocr', router: ocr, auth: 'required',
    note: 'Alias of /api/serve-intake/scan-document — the client URL the OCR preview path already calls' },
  { prefix: '/api/skiptracer', router: skiptracer, auth: 'required',
    note: 'Read-only over skiptracer_dossiers + microbilt_searches; legacy still owns POST /search' },
  { prefix: '/api/trespass-orders', router: trespassOrders, auth: 'required' },
  { prefix: '/api/victim-services', router: victimServices, auth: 'required',
    note: 'Victim services: notification, advocates, restitution, protective orders, safety planning' },
  { prefix: '/api/affairs', router: affairs, auth: 'required',
    note: 'Internal Affairs module: complaints, investigations, early intervention flags' },
  { prefix: '/api/alarms', router: alarms, auth: 'required',
    note: 'Alarm management: permit tracking, false alarm reduction, billing, verification' },
  { prefix: '/api/accreditation', router: accreditation, auth: 'required',
    note: 'Accreditation & compliance: standard tracking, proof of compliance, assessor coordination' },
  { prefix: '/api/alerts', router: alerts, auth: 'required',
    note: 'Mass notification / Rave Alert parity: templates, batches, recipients' },
  { prefix: '/api/alpr', router: alpr, auth: 'required',
    note: 'ALPR plate read on Cloudflare Workers AI (free, no external key) → intel plate log' },
  { prefix: '/api/analytics', router: analytics, auth: 'required',
    note: 'R2 Data Catalog (Iceberg) analytics over R2 SQL: ALPR plate history + summary + raw query. 503s until the ANALYTICS pipeline + R2_ANALYTICS_WAREHOUSE + R2_SQL_TOKEN are provisioned.' },
  { prefix: '/api/redactions', router: redactionsRouter, auth: 'required',
    note: 'In-video redaction custody store: persist client-redacted MP4 to R2 + video_redactions chain-of-custody row' },
  { prefix: '/api/arrests', router: arrests, auth: 'required',
    note: 'Manual booking subset only; JailBase poller endpoints in a Phase 2 PR' },
  { prefix: '/api/assessor', router: assessor, auth: 'required',
    note: 'Salt Lake County Assessor lookup + apply: /parcels?address, /parcel/:no, POST /apply. KV-cached 30d; 503 when FIRECRAWL_API_KEY is unset.' },
  { prefix: '/api/automation', router: automation, auth: 'required',
    note: 'Case management automation rules: CRUD, toggle, execution log. Cron-driven SLA escalation and unassigned-alert rules.' },
  { prefix: '/api/assets', router: assets, auth: 'required',
    note: 'Asset/inventory management: equipment, checkouts, weapons, ammo, K9 records' },
  { prefix: '/api/audit', router: audit, auth: 'required' },
  { prefix: '/api/audit-emit', router: auditEmit, auth: 'required' },
  { prefix: '/api/audit/by-vehicle', router: auditByEntity, auth: 'required' },
  { prefix: '/api/billing', router: billing, auth: 'required',
    note: 'Financial/billing module: contracts, invoices, line items, payments, expenses' },
  { prefix: '/api/billing', router: serveBilling, auth: 'required',
    note: 'Process-service contracts billing: pricing rate card, PS contract terms, serve charges, invoice-from-charges' },
  { prefix: '/api/invoices', router: invoices, auth: 'required',
    note: 'InvoicesPage summary tile (/stats) over the invoices table. Full CRUD lives under /api/billing/invoices.' },
  { prefix: '/api/use-of-force', router: useOfForce, auth: 'required',
    note: 'Use-of-force reports (UseOfForcePage). Defensive over the minimal use_of_force table; legacy 500d on it.' },
  { prefix: '/api/community', router: community, auth: 'required',
    note: 'Community engagement: events, tips, watch groups, alerts' },
  { prefix: '/api/intel/ai', router: intelAi, auth: 'required',
    note: 'Intel AI engine (Claude): POST /ask (NL search w/ citations), /extract (entities+links from narrative), /summarize (dossier). Gated on anthropic_api_key → 503 when unset. Mounted BEFORE /api/intel so the more-specific prefix wins.' },
  { prefix: '/api/intel', router: intel, auth: 'required',
    note: 'Intel Search: federated FTS5 search across record types (/search, /health, /reindex) + person entity-resolution suggestions. Migration 0098; index synced by the 4-hourly cron.' },
  { prefix: '/api/interagency', router: interagency, auth: 'required',
    note: 'Multi-jurisdiction data sharing: partners, agreements, exchange logs' },
  { prefix: '/api/jail', router: jail, auth: 'required',
    note: 'Jail management: inmates, charges, visitors, property, medical, disciplinary, transports' },
  { prefix: '/api/knowledge-base', router: knowledgeBase, auth: 'required',
    note: 'System-wide unified search across all record types by visible identifier/name' },
  { prefix: '/api/qa', router: qa, auth: 'required',
    note: 'Quality Assurance: reviews, criteria, scores, satisfaction surveys' },
  { prefix: '/api/risk', router: risk, auth: 'required',
    note: 'Risk management: assessments, safety inspections, insurance claims' },
  { prefix: '/api/tasks', router: tasks, auth: 'required',
    note: 'Task/work management: assignments, comments, linked-entity tasks' },
  { prefix: '/api/training', router: training, auth: 'required',
    note: 'Training management: courses, enrollments, certifications, firearms qualifications' },

  // ── Documents ──────────────────────────────────────────────
  { prefix: '/api/docs', router: documentsLibrary, auth: 'required',
    note: 'Authored documents (Phase 2): rich-body, revisions, finalize-lock, call/incident links. Distinct from /api/documents (file folders).' },
  { prefix: '/api/documents', router: documentFolders, auth: 'required' },
  { prefix: '/api/pdf-tools', router: pdfTools, auth: 'required' },
  { prefix: '/api/document-intake', router: documentIntake, auth: 'required' },
  { prefix: '/api/tts', router: tts, auth: 'required' },

  // ── Business records ───────────────────────────────────────
  { prefix: '/api/business-vehicles', router: businessVehicles, auth: 'required' },
  { prefix: '/api/business-visits', router: businessVisits, auth: 'required' },
  { prefix: '/api/business-photos', router: businessPhotos, auth: 'required' },

  // ── Field photos (mobile camera portal /field-camera) ───────
  // Stamped evidence photos: overlay burned client-side, R2-backed.
  { prefix: '/api/field-photos', router: fieldPhotos, auth: 'required' },

  // ── Howen dashcam integration ──────────────────────────────
  // Device fleet + recent events. See src/routes/howen.ts.
  { prefix: '/api/howen', router: howen, auth: 'required' },

  // ── Offender registry (stats only) ─────────────────────────
  // /search + per-person detail is a follow-up; only the dashboard
  // tile-count endpoint is implemented today.
  { prefix: '/api/offender-registry', router: offenderRegistry, auth: 'required' },
  // Client calls /api/sex-offender-registry (SexOffenderRegistryPage), but the
  // registry mount is /api/offender-registry. Mount at both so the client SPA
  // doesn't fall through to the legacy proxy (returning 500).
  { prefix: '/api/sex-offender-registry', router: offenderRegistry, auth: 'required' },
  // Colorado DOC offender search — cache-backed (D1 colorado_doc_offenders) +
  // admin import. Live CDOC search is CAPTCHA-gated so the router returns honest
  // live_search_available:false metadata rather than a silent empty result.
  { prefix: '/api/colorado-doc', router: coloradoDoc, auth: 'required',
    note: 'CDOC search/offender/stats from local cache + admin /import; live source is CAPTCHA-gated' },

  // ── File uploads (attachments) ──────────────────────────────
  // General-purpose file upload/download. R2-backed (UPLOADS bucket);
  // replaces legacy disk-based multer handler. Supports HMAC-signed
  // access tokens for session-independent file URLs (img/iframe/a tags).
  { prefix: '/api/uploads', router: uploads, auth: 'public',
    note: 'File attachments: auth is PUBLIC at the middleware level because thumbnail/download routes accept HMAC-signed URLs (no JWT); each handler calls resolveAuth() internally' },

  // ── Company documents (training docs library) ───────────────
  // TrainingDocsPage CRUD + CSV export. Backed by company_documents
  // table (migration 0078). Ported from legacy Express handler.
  { prefix: '/api/company-documents', router: companyDocuments, auth: 'required',
    note: 'Agency document library: list/create/update/delete + CSV export for TrainingDocsPage' },

  // ── Mapbox telemetry sink (public; longer prefix wins) ─────
  // Registered BEFORE /api/mapbox so the trie matches this prefix first.
  // mapboxLoader points mapboxgl.config.EVENTS_URL here so SDK POSTs land
  // on a 204 instead of events.mapbox.com (which some operator networks block).
  { prefix: '/api/mapbox/events', router: mapboxTelemetry, auth: 'public',
    note: 'Mapbox SDK telemetry sink — POST /v2 returns 204, swallows the payload' },

  // ── Mapbox server-side proxy ───────────────────────────────
  // Backs client/src/utils/mapboxServices.ts (geocode/directions/isochrone/
  // matrix/optimization/map-matching/tilequery/static-map/token-status). The
  // /api/mapbox prefix was never mounted, so every helper 404'd. 503s gracefully
  // when MAPBOX_ACCESS_TOKEN is unset. Mounted before the bare /api routers.
  { prefix: '/api/mapbox', router: mapbox, auth: 'required',
    note: 'Server-side Mapbox proxy; 503 when MAPBOX_ACCESS_TOKEN secret is unset' },

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
  { prefix: '/api', router: downloads, auth: 'public',
    note: 'Serves /api/downloads/info + /api/downloads/check for the public download page. Non-API download paths (/downloads/:filename, /download, etc.) are registered directly in src/index.ts.' },

  // ── Warrants — real implementation ─────────────────────────
  { prefix: '/api/warrants', router: warrants, auth: 'required' },
  // ── Work orders — Fleet.io PR 5 subsystem ─────────────────
  { prefix: '/api/work-orders', router: workOrders, auth: 'required',
    note: 'Fleet.io PR 5: work_orders + line_items + attachments + comments. Header CRUD + status-transition guard + close-rollup (line-items.total → work_orders.actual_cost). All mutations emit work_order.* events to fleetio_events.' },
  // ── Inspection templates — Fleet.io PR 6 subsystem ────────
  { prefix: '/api/inspection-templates', router: inspectionTemplates, auth: 'required',
    note: 'Fleet.io PR 6: inspection_templates CRUD (admin/manager). Versioned — editing an in-use template forks a new version + parent_template_id. The submit path at /api/inspections/by-token/:token (in src/routes/inspections.ts) consumes the template + emits inspection.submit + auto-creates fleet_maintenance on failed items.' },
  // ── Fleet visualization — Fleet.io PR 7-9 backend ─────────
  { prefix: '/api/fleet-viz', router: fleetViz, auth: 'required',
    note: 'Fleet.io PR 7-9 backend: 11 read-only aggregate routes feeding the dashboard (F1 KPI / F2 dossier / F3 readiness / V1 fleet-map / V2 pm-timeline / V3 mpg-by-officer / V4 cost-per-mile / V5 work-order-flow / V6 fuel-anomalies / V7 calls-per-gallon / V8 pm-upcoming). React UI lands as PR 7b/8b/9b cluster.' },

  // ── Stub endpoints (dashboard/feature compatibility) ──────
  // All point at the same stubs router which fans out to its internal
  // paths (/, /preferences, /unread-count, /dashboard, etc).
  { prefix: '/api/user', router: stubs, auth: 'required' },
  // Personal notification inbox (NotificationsPage) — real handlers over the
  // notifications table. Replaced the stubs mount that only served
  // /unread-count, leaving list/stats/categories/preferences 404'd.
  { prefix: '/api/notifications', router: notificationsInbox, auth: 'required' },
  // Reports: real aggregations live in src/routes/reports.ts. Two stubs that
  // shared the same shape (/response-times) were moved into the reports
  // router so the stubs router doesn't also claim the prefix. /crime-analysis
  // still falls through to legacy via the proxy — separate concern.
  { prefix: '/api/reports', router: reports, auth: 'required' },
  // BOLOs: the client calls /api/comms/bolos (list/create/update/delete +
  // active/check/stats/archive/expire-check). Mount the full bolos router here
  // BEFORE the broad /api/comms stubs mount so it owns the whole /bolos subtree
  // (Hono runs the first-registered matching handler). bolosRouter is a superset
  // of the stubs' /bolos/{active,check,stats}, so nothing is shadowed.
  { prefix: '/api/comms/bolos', router: bolosRouter, auth: 'required' },
  { prefix: '/api/comms', router: stubs, auth: 'required' },
  { prefix: '/api/stats', router: stubs, auth: 'required' },
  { prefix: '/api/weather', router: weather, auth: 'required' },
  // NB: do NOT re-mount stubs at /api/email here. The full email router
  // (line ~497 below) supersedes everything stubs ever served on this
  // prefix. Mounting stubs first would let the integrations-tab `/status`
  // stub (returns {configured: false}) intercept /api/email/status BEFORE
  // the real handler, falsely showing "Email Not Configured" to every
  // user even when credentials are saved.
  // Real integrations router (rmpgutahps + integration_api_keys CRUD +
  // request log) — must be mounted BEFORE the stubs catch-all below.
  { prefix: '/api/integrations', router: integrations, auth: 'required' },
  { prefix: '/api/dispatch/stats', router: stubs, auth: 'required' },
  { prefix: '/api/dispatch/shift-handoff', router: dispatchShiftHandoff, auth: 'required' },
  { prefix: '/api/clearpathgps', router: clearpathgps, auth: 'required' },
  // Full-trip dashcam footage requests + custody + court-package (FlexCamPage).
  // The router declares its own requireRole gates for privileged ops (unlock).
  { prefix: '/api/flexcam', router: flexcam, auth: 'required',
    note: 'Full-trip dashcam footage: /footage, /footage/:id/custody, /footage/:id/court-package, /request. Mount was dropped in a squash merge — page was fully 404.' },
  { prefix: '/api/driving-events', router: drivingEvents, auth: 'required' },
  { prefix: '/api/microbilt', router: microbilt, auth: 'required',
    note: 'DL search (local dl_records/persons + live MicroBilt API when creds configured) + dl/stats + status. Was a stub mount — the DL SEARCH page 404d.' },
  { prefix: '/api/servemanager', router: stubs, auth: 'required' },
  { prefix: '/api/skiptracer-v2', router: stubs, auth: 'required' },

  // ── Additional stub mounts (404 elimination sweep 2026-06-08) ──────
  // Each of these is called by the client SPA but has no real handler on
  // either the rewrite or legacy worker. Mounting stubs so pages render
  // their empty/error state instead of 404ing.
  { prefix: '/api/cfs', router: cfsQr, auth: 'required' },
  // Code enforcement graduated from stubs to a real D1-backed router
  // (code_violations + vehicle_tows tables) — 2026-06-09 404 sweep.
  { prefix: '/api/code-enforcement', router: codeEnforcement, auth: 'required' },
  { prefix: '/api/dar', router: dar, auth: 'required' },
  { prefix: '/api/jail-roster', router: jailRoster, auth: 'required' },
  { prefix: '/api/evidence', router: evidence, auth: 'required' },
  { prefix: '/api/diagnostics', router: stubs, auth: 'public' },
  // Dedicated empty-state router (not `stubs`) so its catch-all `*`
  // handlers can't leak onto the other prefixes `stubs` is mounted at.
  // Firecrawl is unprovisioned — every list returns [], mutations return
  // a graceful not-configured. Swap for real handlers when a key exists.
  { prefix: '/api/firecrawl-tools', router: firecrawlTools, auth: 'required' },
  { prefix: '/api/web-research', router: webResearch, auth: 'required' },
  { prefix: '/api/mobile', router: mobileCfs, auth: 'public' },
  { prefix: '/api/pdf-artifacts', router: stubs, auth: 'required' },
  { prefix: '/api/pdf-engine', router: pdfEngine, auth: 'required' },
  { prefix: '/api/updates', router: stubs, auth: 'public' },
  { prefix: '/api/voice-persona', router: voicePersona, auth: 'required' },

  // Officer Wallet ID — digital badge / QR-verifiable ID. Auth required on every
  // path (verify is RMPG-only); admin/manager gating is applied per-route inside.
  { prefix: '/api/wallet', router: wallet, auth: 'required' },
];
