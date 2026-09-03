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
import ssoAuth from './routes/ssoAuth';
import health from './routes/health';
import mapData from './routes/mapData';
import iosOta from './routes/iosOta';
import tiles from './routes/tiles';
import osmOverrides from './routes/osmOverrides';
import geo from './routes/geo';
import admin from './routes/admin';
import animalControl from './routes/animalControl';
import impounds from './routes/impounds';
import pawn from './routes/pawn';
import tips from './routes/tips';
import crashReports from './routes/crashReports';
import adminDev from './routes/adminDev';
import adminMapData from './routes/adminMapData';
import dailyEmailAdmin from './routes/dailyEmailAdmin';
import emailRoute from './routes/email';
import emailOauthCallback from './routes/emailOauthCallback';
import oidc from './routes/oidc';
import announcements from './routes/announcements';
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
import { intelReports, intelSources } from './routes/intel/development';
import interagency from './routes/interagency';
import jail from './routes/jail';
import kioskLinux from './routes/kioskLinux';
import offline from './routes/offline';
import qa from './routes/qa';
import risk from './routes/risk';
import tasks from './routes/tasks';
import training from './routes/training';
import personnel from './routes/personnel';
import presence from './routes/presence';
import mdt from './routes/mdt';
import push from './routes/push';
import records from './routes/records';
import subjects from './routes/records/subjects';
import properties from './routes/properties';
import geocode from './routes/geocode';
import crime from './routes/crime';
import warrants from './routes/warrants';
import scrapers from './routes/scrapers';
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
import accreditations from './routes/accreditations';
import alarms from './routes/alarms';
import alpr from './routes/alpr';
import analytics from './routes/analytics';
import automationRules from './routes/automationRules';
import carxe from './routes/carxe';
import vehicleEnrichment from './routes/vehicleEnrichment';
import redactionsRouter from './routes/redactions';
import citations from './routes/citations';
import clearpathgps from './routes/clearpathgps';
import traccar from './routes/traccar';
import clients from './routes/clients';
import cloudflare from './routes/cloudflare';
import connections from './routes/connections';
import crm from './routes/crm';
import deepResearch from './routes/deepResearch';
import deepsearch from './routes/deepsearch';
import gofps from './routes/gofps';
import gosearch from './routes/gosearch';
import crisisResponse from './routes/crisisResponse';
import featureFlags from './routes/featureFlags';
import fieldInterviews from './routes/fieldInterviews';
import fleet from './routes/fleet';
import fleetio from './routes/fleetio';
import driverPerformance from './routes/driverPerformance';
import legalDataHunter from './routes/legalDataHunter';
import webBrowser from './routes/webBrowser';
import documentFolders from './routes/documents/folders';
import documentsLibrary from './routes/documents/library';
import documentIntake from './routes/documentIntake';
import pdfTools from './routes/pdfTools';
import tesseractOcr from './routes/tesseractOcr';
import tesseractTraining from './routes/tesseractTraining';
import tts from './routes/tts';
import trespassOrders from './routes/trespassOrders';
import voiceRoute from './routes/voice';
import forensics from './routes/forensics';
import geofences from './routes/geofences';
import gangIntel from './routes/gangIntel';
import hr from './routes/hr';
import corporateOps from './routes/corporateOps';
import patrol from './routes/patrol';
import patrolMileage from './routes/patrolMileage';
import radio from './routes/radio';
import iped from './routes/iped';
import scheduling from './routes/scheduling';
import scheduler from './routes/scheduler';
import shiftBriefings from './routes/shiftBriefings';
import serve from './routes/serve';
import sync from './routes/sync';
import serveDashboard from './routes/serveDashboard';
import serveQueueEnhanced from './routes/serveQueueEnhanced';
import serveIntake from './routes/serveIntake';
import ocr from './routes/ocr';
import skiptracer from './routes/skiptracer';
import skiptracerV2 from './routes/skiptracerV2';
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
import radar360 from './routes/radar360';
import recruitment from './routes/recruitment';
import refData from './routes/refData';
import reports from './routes/reports';
import statutes from './routes/statutes';
import specialOps from './routes/specialOps';
import victimServices from './routes/victimServices';
import integrations from './routes/integrations';
import serveManagerRoutes, { serveManagerWebhookRouter } from './routes/serveManagerRoutes';
import { serveReceipt, serveReceiptAdmin } from './routes/serveReceipt';
import { serveQrScan } from './routes/serveQrScan';
import stubs from './routes/stubs';
import voicePersona from './routes/voicePersona';
import mobileCfs, { cfsQr } from './routes/mobileCfs';
import firecrawlTools from './routes/firecrawlTools';
import webResearch from './routes/webResearch';
import pdfEngine from './routes/pdfEngine';
import dar from './routes/dar';
import dialerConnect, { dialerConnectIngest } from './routes/dialerConnect';
import formDrafts from './routes/formDrafts';
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
import dispatchRouting from './routes/dispatch/routing';
import dispatchGeography from './routes/dispatch/geography';
import dispatchAggregates from './routes/dispatch/aggregates';
import dispatchPremiseHistory from './routes/dispatch/premiseHistory';
import dispatchPanic from './routes/dispatch/panic';
import dispatchAnomalies from './routes/dispatch/anomalies';
import dispatchCallLinks from './routes/dispatch/callLinks';
import { linkOptions as linkOptionsRead, linkOptionsAdmin } from './routes/linkOptions';
import dispatchShiftHandoff from './routes/dispatch/shiftHandoff';
import dispatchActivityFeed from './routes/dispatch/activityFeed';
import dispatchShiftStats from './routes/dispatch/shiftStats';
import dispatchCallTemplates from './routes/dispatch/callTemplates';
import dispatchDataCapture from './routes/dispatch/dataCapture';
import notificationSubscriptions from './routes/dispatch/notificationSubscriptions';
import dispatchWeather from './routes/dispatch/dispatchWeather';
import shiftSchedule from './routes/dispatch/shiftSchedule';
import unitMessages from './routes/dispatch/unitMessages';
import analyticsDispatch from './routes/dispatch/analyticsDispatch';
import callExtras from './routes/dispatch/callExtras';
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
import propertyPhotos from './routes/property/photos';
import fieldPhotos from './routes/fieldPhotos';
// Howen dashcam integration
import howen from './routes/howen';
// Downloads + auto-updates
import downloads, { updates, downloadFiles } from './routes/downloads';
import osUpdates from './routes/osUpdates';
// Offender registry (stats only)
import narcotics from './routes/narcotics';
import nav from './routes/nav';
import navFavorites from './routes/navFavorites';
import offenderRegistry from './routes/offenderRegistry';
import uploads from './routes/uploads';
import companyDocuments from './routes/companyDocuments';
import wallet from './routes/wallet';
import systemRoutes from './routes/system';
import jailRoster from './routes/jailRoster';
// Full-trip dashcam footage (FlexCamPage). Handler existed but the mount was
// dropped in a squash merge, 404ing the entire page. NOTE: this comment
// previously claimed the mount was restored, but the ROUTE_REGISTRY entry
// was never actually added — see the /api/flexcam entry below (fixed
// 2026-07-02, the fix this comment describes never landed the first time).
import flexcam from './routes/flexcam';
// Colorado DOC offender search (cache-backed; live source is CAPTCHA-gated).
import coloradoDoc from './routes/coloradoDoc';
// Server-side Mapbox proxy backing client/src/utils/mapboxServices.ts.
import mapbox from './routes/mapbox';
import optimizationV2 from './routes/mapboxOptimizationV2';
// Mapbox telemetry sink — Mapbox SDK posts usage events to events.mapbox.com,
// which some operator networks block; redirect those POSTs to a same-origin
// 204 to kill the console spam without affecting map functionality.
// Driving events — powers the Dashcam AI Console. Was never mounted, causing
// every /api/driving-events/* call to 404 (ForensicDashcamPlayer, etc.).
import drivingEvents from './routes/drivingEvents';
// Admin database repair — rebuild corrupt FTS tables (persons_fts, cases_fts)
// that trigger SQLITE_CORRUPT_VTAB on every person/case write.
import adminRepair from './routes/admin/repair';
import crypto from './routes/crypto';
import browserSearch from './routes/browserSearch';
import enrichment from './routes/enrichment';

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
  { prefix: '/api/oidc/dialer', router: ssoAuth, auth: 'public',
    note: 'Dial Connect SSO (OIDC relying party). Distinct top-level prefix from /api/auth — no trie overlap, so ordering relative to it doesn\'t matter.' },
  { prefix: '/api/auth', router: auth, auth: 'public' },
  { prefix: '/api/oidc', router: oidc, auth: 'public',
    note: 'Sign in with Dialer (dialer.rmpgutah.us OIDC): /dialer/check (identifier-first SSO probe, IP-rate-limited boolean), /dialer/login, /dialer/callback. Public — the browser redirects here mid-flow with no JWT/cookie, same reasoning as /api/email-oauth.' },
  { prefix: '/api/map-data', router: mapData, auth: 'public' },
  { prefix: '/api/tiles', router: tiles, auth: 'public' },
  { prefix: '/api/osm-overrides', router: osmOverrides, auth: 'required',
    note: "RMPG's internal edit layer over the OSM overlays, keyed by OSM element id. Auth REQUIRED — unlike /api/tiles (public reference data), these are internal corrections attributable to a named user." },
  { prefix: '/api/geo', router: geo, auth: 'public' },
  { prefix: '/api/ios-ota', router: iosOta, auth: 'public',
    note: 'Wireless install package (manifest.plist/ipa/icons) for ios2/RMPGFlexConnect, served from R2 DOWNLOADS under ios-ota/. Public — itms-services on the device fetches these unauthenticated. Needs the same WAF managed-challenge skip as /api/health or the install link 403s (see docs/superpowers/specs/2026-08-22-ios-ota-wireless-install-design.md).' },

  // Per-shift QR-token-authed vehicle inspection page (/m/shift/<token>). The
  // token IS the credential — no JWT required because the page is meant for
  // a personal phone scanning a QR shown on the desktop/MDT ShiftCard.
  { prefix: '/api/inspections', router: inspections, auth: 'public',
    note: 'Token-authed: resolves the open time_entry whose qr_token matches' },

  // Recipient-facing Receipt of Service + Court Document Release
  // (/m/serve-receipt/<token>). MUST be public: the signer is a member of
  // the public — usually the defendant — and will never have a session.
  // The single-use token from serve_receipt_tokens IS the credential and
  // is verified inside the route, same posture as /api/inspections and
  // /api/mobile. Safe alongside the auth-required '/api/serve' mount:
  // index.ts applies auth to the exact prefix and `${prefix}/*` only, and
  // '/api/serve-receipt' matches neither.
  { prefix: '/api/serve-receipt', router: serveReceipt, auth: 'public',
    note: 'Token-authed recipient signature capture; token burned on signature. Migration 0207.' },
  { prefix: '/api/verify', router: serveQrScan, auth: 'public',
    note: 'QR code scan handler — subject-facing; logs scan, notifies assigned officer, no auth required. Migration 0247.' },

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
  // callExtras: BEFORE dispatchCalls — handles /:id/suggest-unit and /:id/notes/export
  { prefix: '/api/dispatch/calls', router: callExtras, auth: 'required' },
  { prefix: '/api/dispatch/units', router: audioMode, auth: 'required' },
  { prefix: '/api/dispatch/units', router: unitStatus, auth: 'required' },
  // unitMessages: BEFORE dispatchUnits — handles /:id/messages
  { prefix: '/api/dispatch/units', router: unitMessages, auth: 'required' },
  { prefix: '/api/dispatch/premise-alerts', router: premiseAlerts, auth: 'required' },
  { prefix: '/api/dispatch/bolos', router: bolosRouter, auth: 'required' },
  { prefix: '/api/dispatch/welfare', router: welfareActive, auth: 'required' },

  // Canonical dispatch resources
  { prefix: '/api/dispatch/calls', router: dispatchCalls, auth: 'required' },
  { prefix: '/api/dispatch/units', router: dispatchUnits, auth: 'required' },
  { prefix: '/api/dispatch/gps', router: dispatchGps, auth: 'required' },
  { prefix: '/api/dispatch/trips', router: dispatchTrips, auth: 'required' },
  { prefix: '/api/dispatch/routing', router: dispatchRouting, auth: 'required',
    note: 'CFS Route Builder backend (optimize/save/unit/:id/complete-stop) — the /route-builder page 404d on all four since it shipped; never mounted before.' },
  { prefix: '/api/dispatch/geography', router: dispatchGeography, auth: 'required' },
  { prefix: '/api/dispatch/analytics', router: analyticsDispatch, auth: 'required',
    note: 'Dispatch analytics: availability timeline (hourly staffing breakdown) + incident-type breakdown' },
  { prefix: '/api/dispatch/activity', router: dispatchActivityFeed, auth: 'required',
    note: 'Dispatch activity feed: recent call/unit/panic events from audit_log, polled every 10s by dispatch board sidebar' },
  // NOTE: dispatchAggregates' internal routes are bare ('/call-volume',
  // '/by-zone', '/integration-dashboard', no '/aggregates' segment) — the
  // client was fixed to match this mount (2026-07-02, PR #2530) rather than
  // the mount being moved to match the client. Do NOT change this prefix to
  // '/api/dispatch/aggregates' without also reverting that client fix.
  { prefix: '/api/dispatch', router: dispatchAggregates, auth: 'required' },
  { prefix: '/api/dispatch/run-cards', router: runCards, auth: 'required' },
  { prefix: '/api/dispatch/welfare', router: welfare, auth: 'required' },

  // ── Driving events (dashcam AI console) ────────────────────
  // Mounted but never registered — ForensicDashcamPlayer and DashcamAiPage
  // had been 404ing on every /api/driving-events/* call since the VPS teardown.
  // See src/routes/drivingEvents.ts for the full handler implementation.
  { prefix: '/api/driving-events', router: drivingEvents, auth: 'required',
    note: 'Dashcam AI console: events list, fleet-health, plate-history, audit-log, detail + media + stream. Ported from legacy; unblocks the live dashcam page.' },

  // ── Admin / personnel / presence ───────────────────────────
  { prefix: '/api/admin/database', router: adminRepair, auth: 'required',
    note: 'Database repair: POST /repair-fts rebuilds corrupt persons_fts/cases_fts tables. Admin/manager only.' },
  { prefix: '/api/admin/reanalysis', router: reanalysis, auth: 'required',
    note: 'Footage backfill, ALPR confidence correction, analytics replay. All endpoints require admin role (enforced per-route).' },
  { prefix: '/api/admin/dev', router: adminDev, auth: 'required',
    note: 'Dev panel: feature flags (KV-backed GET/PUT), mock GPS injection + call seed. Admin role enforced per-route; GET /feature-flags is readable by any authed user.' },
  { prefix: '/api/admin', router: admin, auth: 'required' },
  { prefix: '/api/admin/settings', router: adminSettings, auth: 'required' },
  { prefix: '/api/admin/map-data', router: adminMapData, auth: 'required' },
  { prefix: '/api/daily-email', router: dailyEmailAdmin, auth: 'public',
    note: 'Daily email report recipient management: GET/PUT /recipients, POST /test-send, GET /test-open (public). Admin-only (auth handled per-route).' },
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
  { prefix: '/api/push', router: push, auth: 'required' },
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
  { prefix: '/api/animal-control', router: animalControl, auth: 'required',
    note: 'AnimalControlPage was a fully-built client page with zero matching route (404 sweep 2026-07-02). Migration 0167.' },
  { prefix: '/api/cases', router: cases, auth: 'required',
    note: 'MVP core; entity-junction tables in a follow-up PR' },
  { prefix: '/api/citations', router: citations, auth: 'required' },
  { prefix: '/api/crash-reports', router: crashReports, auth: 'required',
    note: 'CrashReportsPage was a fully-built client page with zero matching route (404 sweep 2026-07-02). Migration 0167.' },
  { prefix: '/api/clients', router: clients, auth: 'required',
    note: 'Client stub — returns [] for GET, accepts POST/PUT/DELETE. Full CRUD lives under /api/admin/clients today.' },
  { prefix: '/api/connections', router: connections, auth: 'required',
    note: 'Connection-graph analyst tool: /search, /graph, /path, /investigations CRUD. Node types incl. call (CFS) + report (supplemental_reports). Backed by connection_investigations (live D1, migration 0043).' },
  { prefix: '/api/corporate-ops', router: corporateOps, auth: 'required',
    note: 'Corporate linkage: clock/fleet/HR/dispatch/map/serve snapshot, mileage reconcile, automatic workflow runs.' },
  { prefix: '/api/court', router: court, auth: 'required',
    note: 'Court events + subpoenas (single-table); reminder fan-out deferred' },
  { prefix: '/api/crisis', router: crisisResponse, auth: 'required',
    note: 'Crisis response: CIT deployments, mental health holds, mobile crisis team coordination' },
  { prefix: '/api/crm', router: crm, auth: 'required',
    note: 'CRM stub — dashboard, leads, proposals, reports, firecrawl, scraper admin, competitor monitor. All GETs return empty/null-safe shapes; mutations 201-OK as no-ops. Full CRM backend is Phase 2.' },
  { prefix: '/api/deep-research', router: deepResearch, auth: 'required' },
  { prefix: '/api/deepsearch', router: deepsearch, auth: 'required',
    note: 'DeepSearch OSINT search powered by Gemini 2.5 Flash with osint_cache backing' },
  { prefix: '/api/dl-records', router: dlRecords, auth: 'required',
    note: 'Local DL store CRUD over dl_records + dl_addresses. /verify + /ocr-scan (external APIs) stay on legacy — proxy routes only the bare path + numeric :id here.' },
  { prefix: '/api/cloudflare', router: cloudflare, auth: 'required',
    note: 'Admin Cloudflare platform integration — account telemetry (D1/R2/KV/Workers) + cache purge via an ADMIN-CONFIGURED least-privilege token in system_config (cf_api_token, never hardcoded).' },
  { prefix: '/api/feature-flags', router: featureFlags, auth: 'required' },
  { prefix: '/api/field-interviews', router: fieldInterviews, auth: 'required' },
  { prefix: '/api/flexcam', router: flexcam, auth: 'required',
    note: 'Full-trip dashcam footage backing FlexCamPage/FlexCamFootagePage — the mount was described as fixed in a comment above the import but never actually landed in this array until now (2026-07-02).' },
  { prefix: '/api/fleet', router: fleet, auth: 'required',
    note: 'Full fleet management: vehicles, fuel, maintenance, inspections, assignments, personnel, insurance, registration, tires, damage, recalls, parts, warranties, depreciation, accidents, keys, service providers, fuel cards, budgets, replacement plan, pretrip checklists, cost-per-mile, CSV export, analytics, map overlay, dashcam, utilization, emissions, lifecycle, scorecard. All sub-resource CRUD ported from legacy (May 2026).' },
  { prefix: '/api/driver-performance', router: driverPerformance, auth: 'required',
    note: 'Supervisor-only driver performance: ranked roster, officer detail, PDF export, admin recompute. Scores from driver_performance_daily snapshots. Distinct from /api/fleet/scorecard, which is vehicle-fleet health.' },
  { prefix: '/api/fleetio', router: fleetio, auth: 'required',
    note: 'Fleet.io integration: /test-connection (any authed user), /sync-status (admin), /seed (admin). 503 when FLEETIO_API_KEY is unset.' },
  { prefix: '/api/carxe', router: carxe, auth: 'required',
    note: 'CarsXE vehicle-data lookups: plate decode, VIN specs, lien/theft, history. Manual/officer-triggered only, cached in carxe_lookups (24h TTL). 200 {ok:false,code:\'not_configured\'} when CARXE_API_KEY is unset.' },
  { prefix: '/api/vehicle-enrichment', router: vehicleEnrichment, auth: 'required',
    note: 'Vehicle enrichment chain: plate→VIN→specs via PLATE_TO_VIN / VIN_DECODER / PLATE_DECODER APIs. POST /enrich/:vehicleId (client_viewer excluded), GET /cache/:plate, GET /health. 200 {ok:false,code:\'not_configured\'} when all three keys are unset.' },
  { prefix: '/api/legal-data-hunter', router: legalDataHunter, auth: 'required',
    note: 'Legal Data Hunter integration: manual, officer-initiated warrant-charge validation only. POST /validate (any authed non-client_viewer user), GET /usage (admin/manager). 200 {ok:false,code:\'not_configured\'} when LEGAL_DATA_HUNTER_API_KEY is unset.' },
  { prefix: '/api/forensics', router: forensics, auth: 'required',
    note: 'MVP: cases + exhibits + analyses + activity log; hash sets / reports / cross-links deferred' },
  { prefix: '/api/forensic-lab', router: forensics, auth: 'required',
    note: 'Alias for /api/forensics — client ForensicLabPage uses this path' },
  { prefix: '/api/geofences', router: geofences, auth: 'required',
    note: 'Geofence zone CRUD — writes to geofence_zones. All authenticated roles.' },
  { prefix: '/api/gofps', router: gofps, auth: 'required',
    note: 'GoFPS FastPeopleSearch people search with osint_cache backing' },
  { prefix: '/api/gosearch', router: gosearch, auth: 'required',
    note: 'GoSearch username OSINT (300+ platforms) + breach DB checks with osint_cache backing' },
  { prefix: '/api/gang-intel', router: gangIntel, auth: 'required',
    note: 'Gang intelligence: members, gangs, graffiti records, injunctions, activity mapping' },
  { prefix: '/api/hr', router: hr, auth: 'required',
    note: 'Full HR module: dashboard, leave/PTO, disciplinary, reviews, payroll (periods/rates/entries/overtime), grievances, documents/acknowledgments, attendance, PIPs. /benefits returns [] (table deferred).' },
  { prefix: '/api/impounds', router: impounds, auth: 'required',
    note: 'ImpoundPage was a fully-built client page with zero matching route (404 sweep 2026-07-02). Migration 0167.' },
  { prefix: '/api/iped', router: iped, auth: 'required',
    note: 'Read-only surface over forensic_hash_sets + forensic_hash_entries + iped_imports tables. GET /status, /hash-sets, /hash-sets/:id, /downloads.' },
  { prefix: '/api/map/annotations', router: mapAnnotations, auth: 'required',
    note: 'Shared map annotation pins (map_annotations table). All authenticated roles.' },
  { prefix: '/api/narcotics', router: narcotics, auth: 'required',
    note: 'Narcotics & vice: investigations, CI management, buy/bust ops, drug trend analysis' },
  { prefix: '/api/nav', router: nav, auth: 'required',
    note: 'Nav trip logging: auto-detect vehicle movement, breadcrumb trails, take-home vehicle support' },
  { prefix: '/api/nav/favorites', router: navFavorites, auth: 'required',
    note: 'Saved/favorite navigation destinations (nav_favorites table, mig 0181). CRUD scoped to owning user.' },
  { prefix: '/api/offline', router: offline, auth: 'required',
    note: 'Offline sync (push/pull + secrets). /sync/push dispatches allowlisted writes through the root app; see src/routes/offline.ts.' },
  { prefix: '/api/pawn', router: pawn, auth: 'required',
    note: 'PawnTrackingPage was a fully-built client page with zero matching route (404 sweep 2026-07-02). Migration 0167.' },
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
  { prefix: '/api/radar360', router: radar360, auth: 'required',
    note: 'Radar 360º situational awareness scan: nearby calls, flagged persons, stolen vehicles, active units, incidents within a configurable radius.' },
  { prefix: '/api/redactions', router: redactionsRouter, auth: 'required',
    note: 'Imported but never mounted (dead code since import) — dashcam video redaction upload/list/download.' },
  { prefix: '/api/recruitment', router: recruitment, auth: 'required',
    note: 'Recruitment & hiring: applicant pipeline, testing, oral boards, onboarding workflow' },
  { prefix: '/api/ref-data', router: refData, auth: 'required',
    note: 'Fleet.io PR 2: cross-reference lookups (vehicle makes/models/types, fuel, VMRS, colors, vendors, ...) + NHTSA vPIC /decode-vin/:vin with D1 cache. Read-only — admin CRUD lands with the admin UI in PR 2b.' },
  { prefix: '/api/scheduling', router: scheduling, auth: 'required',
    note: 'Scheduling engine: coverage gaps, shift swaps, overtime, auto-schedule, handoff briefings' },
  { prefix: '/api/scheduler', router: scheduler, auth: 'required',
    note: 'Unified scheduler: cross-source agenda (serve attempts + shift plans + court events + custom events), event CRUD with cron reminders. Migration 0165.' },
  { prefix: '/api/shift-briefings', router: shiftBriefings, auth: 'required',
    note: 'Shift briefings: persisted briefings + live /generate + officer-safety alerts (backend for ShiftBriefingsPage; endpoints 404d before 2026-07-02). Migration 0165.' },
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
  { prefix: '/api/serve-receipts', router: serveReceiptAdmin, auth: 'required',
    note: 'Officer side of the recipient receipt: mint/reuse the printed QR token, read signed receipts, supervisor void. Public signing surface is /api/serve-receipt (singular).' },
  { prefix: '/api/serve-dashboard', router: serveDashboard, auth: 'required',
    note: 'Admin/manager/supervisor analytics & bulk-ops for the process-service queue' },
  { prefix: '/api/serve-queue', router: serveQueueEnhanced, auth: 'required',
    note: 'Enhanced serve queue: advanced filtering, route optimization, duplicate detection, batch ops, intake scan' },
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
  { prefix: '/api/enrichment', router: enrichment, auth: 'required',
    note: 'Open-source skip-trace enrichment: NSOPW, SL Assessor, OpenSanctions, USPS, OpenCorporates, Numverify. Hard-lock DOB±1yr + secondary anchor. Results cached 24h in enrichment_cache.' },
  { prefix: '/api/tips', router: tips, auth: 'required',
    note: 'Detective-facing investigative tip queue (distinct from the anonymous /api/community tips table). TipsPage was a fully-built client page with zero matching route (404 sweep 2026-07-02). Migration 0167.' },
  { prefix: '/api/trespass-orders', router: trespassOrders, auth: 'required' },
  { prefix: '/api/victim-services', router: victimServices, auth: 'required',
    note: 'Victim services: notification, advocates, restitution, protective orders, safety planning' },
  { prefix: '/api/affairs', router: affairs, auth: 'required',
    note: 'Internal Affairs module: complaints, investigations, early intervention flags' },
  { prefix: '/api/alarms', router: alarms, auth: 'required',
    note: 'Alarm management: permit tracking, false alarm reduction, billing, verification' },
  { prefix: '/api/accreditation', router: accreditation, auth: 'required',
    note: 'Accreditation & compliance: standard tracking, proof of compliance, assessor coordination' },
  { prefix: '/api/accreditations', router: accreditations, auth: 'required',
    note: 'AccreditationsPage.tsx backend (officer certification tracking, distinct from /api/accreditation standards and /api/training certs) — the page 404d on every call since it shipped; never mounted before.' },
  { prefix: '/api/alerts', router: alerts, auth: 'required',
    note: 'Mass notification / Rave Alert parity: templates, batches, recipients' },
  { prefix: '/api/alpr', router: alpr, auth: 'required',
    note: 'ALPR plate read on Cloudflare Workers AI (free, no external key) → intel plate log' },
  { prefix: '/api/analytics', router: analytics, auth: 'required',
    note: 'Imported but never mounted (dead code since import) — AnalyticsPage 404d on every /analytics/{health,query,events,alpr/*} call.' },
  { prefix: '/api/automation-rules', router: automationRules, auth: 'required',
    note: 'Smart automation rules CRUD: list/create/update/delete rules + GET /firings (admin/supervisor). Officers restricted to notify_officer action with safe triggers; admins manage global rules.' },
  { prefix: '/api/arrests', router: arrests, auth: 'required',
    note: 'Manual booking subset only; JailBase poller endpoints in a Phase 2 PR' },
  { prefix: '/api/assessor', router: assessor, auth: 'required',
    note: 'Salt Lake County Assessor lookup + apply: /parcels?address, /parcel/:no, POST /apply. KV-cached 30d; 503 when FIRECRAWL_API_KEY is unset.' },
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
  { prefix: '/api/intel/reports', router: intelReports, auth: 'required',
    note: 'Intel Reports workflow (draft/evaluate/analyze/disseminate/recall/reject) - src/routes/intel/development.ts. Was fully built but never mounted; IntelReportsPage/NewIntelReportPage/IntelReportDetailPage 404d until this. Mounted BEFORE /api/intel so the more-specific prefix wins.' },
  { prefix: '/api/intel/sources', router: intelSources, auth: 'required',
    note: 'Intel Sources + reliability scoring - src/routes/intel/development.ts. Same as intelReports above: built, never mounted. Mounted BEFORE /api/intel so the more-specific prefix wins.' },
  { prefix: '/api/intel', router: intel, auth: 'required',
    note: 'Intel Search: federated FTS5 search across record types (/search, /health, /reindex) + person entity-resolution suggestions. Migration 0098; index synced by the 4-hourly cron.' },
  { prefix: '/api/interagency', router: interagency, auth: 'required',
    note: 'Multi-jurisdiction data sharing: partners, agreements, exchange logs' },
  { prefix: '/api/jail', router: jail, auth: 'required',
    note: 'Jail management: inmates, charges, visitors, property, medical, disciplinary, transports' },
  { prefix: '/api/knowledge-base', router: knowledgeBase, auth: 'required',
    note: 'System-wide unified search across all record types by visible identifier/name' },
  { prefix: '/api/kiosk-linux', router: kioskLinux, auth: 'public',
    note: 'Kiosk Linux device registry (sub-project 4): registration + fleet tracking only, no OTA delivery. auth:"public" at the registry level because /devices/:id/checkin and /devices/:id/upload use a per-device bearer token, not a JWT — admin routes (/devices GET/POST, /devices/:id DELETE) apply authMiddleware+requireRole per-route inside the file instead. 200 {ok:false,code:"not_configured"} when KIOSK_DB/KIOSK_DEVICES are unset.' },
  { prefix: '/api/qa', router: qa, auth: 'required',
    note: 'Quality Assurance: reviews, criteria, scores, satisfaction surveys' },
  { prefix: '/api/risk', router: risk, auth: 'required',
    note: 'Risk management: assessments, safety inspections, insurance claims' },
  { prefix: '/api/sync', router: sync, auth: 'required',
    note: 'FZ-55 secondary server sync: GET /queue (pending/failed/delivered counts), GET /conflicts (paginated audit log, ?table= ?page= ?limit=), POST /replay (trigger queue replay), POST /enqueue (record missed cloud write). Admin/manager only — enforced per-route inside sync.ts.' },
  { prefix: '/api/tasks', router: tasks, auth: 'required',
    note: 'Task/work management: assignments, comments, linked-entity tasks' },
  { prefix: '/api/training', router: training, auth: 'required',
    note: 'Training management: courses, enrollments, certifications, firearms qualifications' },

  // ── Documents ──────────────────────────────────────────────
  { prefix: '/api/docs', router: documentsLibrary, auth: 'required',
    note: 'Authored documents (Phase 2): rich-body, revisions, finalize-lock, call/incident links. Distinct from /api/documents (file folders).' },
  { prefix: '/api/documents', router: documentFolders, auth: 'required' },
  { prefix: '/api/pdf-tools', router: pdfTools, auth: 'required' },
  { prefix: '/api/tesseract-ocr', router: tesseractOcr, auth: 'required' },
  { prefix: '/api/tesseract-training', router: tesseractTraining, auth: 'required' },
  { prefix: '/api/document-intake', router: documentIntake, auth: 'required' },
  { prefix: '/api/tts', router: tts, auth: 'required' },

  // ── Business records ───────────────────────────────────────
  { prefix: '/api/business-vehicles', router: businessVehicles, auth: 'required' },
  { prefix: '/api/business-visits', router: businessVisits, auth: 'required' },
  { prefix: '/api/business-photos', router: businessPhotos, auth: 'required' },
  { prefix: '/api/property-photos', router: propertyPhotos, auth: 'required' },

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

  // ── Mapbox server-side proxy ───────────────────────────────
  // Backs client/src/utils/mapboxServices.ts (geocode/directions/isochrone/
  // matrix/optimization/map-matching/tilequery/static-map/token-status). The
  // /api/mapbox prefix was never mounted, so every helper 404'd. 503s gracefully
  // when MAPBOX_ACCESS_TOKEN is unset. Mounted before the bare /api routers.
  { prefix: '/api/mapbox/optimization-v2', router: optimizationV2, auth: 'required',
    note: 'Mapbox Optimization V2 async engine. POST /submit builds + submits a V2 problem; GET /:jobId polls + writes back to serve_routes on completion; GET / lists jobs. Supervisor+ to submit; any authed role to poll. 200 {skipped:true} when token unset.' },
  { prefix: '/api/mapbox', router: mapbox, auth: 'required',
    note: 'Server-side Mapbox proxy; 503 when MAPBOX_ACCESS_TOKEN secret is unset' },

  // ── Bare /api mounts (router owns sub-paths) ───────────────
  // Each entry here mounts at the bare /api prefix so the router can
  // own multiple disjoint sub-paths under one mount (a Hono.route()
  // limitation workaround). MUST be `auth: 'public'` at the registry
  // level — `required` would make the auth loop register
  // `app.use('/api/*', authMiddleware)`, blanket-blocking every
  // /api/* path including /api/auth/login. Auth is enforced INSIDE
  // each router, scoped to the literal sub-paths it owns (e.g.
  // `router.use('/geocode/*', authMiddleware)`) — NOT `router.use('*',
  // ...)`. A bare `'*'` here merges through `.route()` into a genuinely
  // global `/api/*` pattern on the PARENT app (same blanket-block this
  // comment warns about, just from a different call site), which
  // 401'd every OTHER public bare-/api router registered after it
  // (mobileCfs, downloads, stubs' diagnostics/updates) until fixed
  // 2026-07-18 — see the in-router comments in geocode.ts/shiftPlans.ts.
  { prefix: '/api', router: geocode, auth: 'public',
    note: 'Serves /api/geocode/* and /api/integrations/mapbox/client-token. See src/routes/geocode.ts for the in-router auth setup.' },
  { prefix: '/api', router: shiftPlans, auth: 'public',
    note: 'Serves /api/shift-plans/*, /api/shift-swaps/*, /api/shift-overtime, /api/staffing-levels, /api/shift-notifications. See src/routes/shiftPlans.ts for the in-router auth setup.' },
  { prefix: '/api', router: downloads, auth: 'public',
    note: 'Serves /api/downloads/info + /api/downloads/check for the public download page (no auth of its own — genuinely open).' },
  // OS update feed. /os/manifest must be PUBLIC: a terminal polls it before any
  // user has signed in, and often with no user at all. See src/routes/osUpdates.ts
  // for the in-router auth setup — /os/promote is gated there, because gating it
  // here would blanket-block every /api/* route (incident #627).
  { prefix: '/api', router: osUpdates, auth: 'public',
    note: 'GET /api/os/manifest?channel=stable|staging returns a flat key=value manifest the on-device rmpg-update agent parses with BusyBox grep/cut (no JSON parser in the image). GET /api/os/channels reports what is published where. POST /api/os/promote copies staging->stable and is the deliberate gate before the fleet installs anything — it requires the exact version to be named, so publishing a build never auto-deploys it. Promote applies authMiddleware inside the router (mounted public here); before 2026-07-25 nothing populated c.get(\'user\'), so its admin/manager check rejected EVERY caller and the gate could never be opened.' },
  { prefix: '/downloads', router: downloadFiles, auth: 'public',
    note: 'Bare (no /api prefix) — serves the actual installer/OS files out of the DOWNLOADS R2 bucket at /downloads/<filename>, which is what every button on the public download page links to. Was NEVER mounted before 2026-07-25, so every download returned the SPA index.html (HTTP 200, 11,630 bytes of HTML) under the artifact filename; client/public/_redirects tried to proxy it with a status-200 rule, which Cloudflare Pages does not support (redirects only, no external rewrites).' },
  { prefix: '/updates', router: updates, auth: 'public',
    note: 'Bare (no /api prefix) — electron-updater\'s generic provider (desktop/updater.js) hits <feedUrl>/latest.yml, /latest-mac.yml, and the installer filename the manifest references, all relative to https://api.rmpgutah.us/updates/. Was never mounted anywhere before 2026-07-22, so the whole desktop auto-update feed 404\'d despite R2 uploads succeeding.' },

  // ── Warrants — real implementation ─────────────────────────
  { prefix: '/api/warrants/scrapers', router: scrapers, auth: 'required',
    note: 'Warrant scraper ops: list/health (both warrant_scraper_config + national_warrant_sources frameworks), on-demand trigger, circuit reset, bulk enable/disable/reset/set_priority. Backs ScrapersTab.tsx + AdminWarrantScrapersTab.tsx, both previously unbacked (2026-07-04).' },
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
  // active/check/stats, plus :id/archive, :id/unarchive, auto-archive, and
  // expire-check). Mount the full bolos router here BEFORE the broad
  // /api/comms stubs mount so it owns the whole /bolos subtree (Hono runs the
  // first-registered matching handler). bolosRouter defines /active, /check,
  // and /stats (see dispatch/extensions.ts) — the stubs.ts copies of those
  // were dead code and have been removed. :id/archive, :id/unarchive,
  // auto-archive, and expire-check are all implemented in
  // dispatch/extensions.ts (archived_at column, migration 0177) — this
  // comment previously said they 404'd; that gap has since been closed.
  { prefix: '/api/comms/bolos', router: bolosRouter, auth: 'required' },
  { prefix: '/api/comms', router: stubs, auth: 'required' },
  { prefix: '/api/stats', router: stubs, auth: 'required' },
  { prefix: '/api/weather', router: weather, auth: 'required' },
  { prefix: '/api/web-browser', router: webBrowser, auth: 'required',
    note: 'Web Company Browser: POST /session issues a session id (blocked for client_viewer/contract_manager) before a WebBrowserSessionDO + Browser Rendering instance is created. The /api/web-browser-ws WebSocket upgrade is handled outside Hono in the top-level fetch() in src/index.ts (mirrors /api/voice-ws).' },
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
  { prefix: '/api/dispatch/shift-stats', router: dispatchShiftStats, auth: 'required' },
  { prefix: '/api/dispatch/call-templates', router: dispatchCallTemplates, auth: 'required' },
  { prefix: '/api/dispatch/capture', router: dispatchDataCapture, auth: 'required' },
  // Backend-C additions
  { prefix: '/api/dispatch/notifications', router: notificationSubscriptions, auth: 'required' },
  { prefix: '/api/dispatch', router: dispatchWeather, auth: 'required' },
  { prefix: '/api/dispatch', router: shiftSchedule, auth: 'required' },
  { prefix: '/api/clearpathgps', router: clearpathgps, auth: 'required' },
  { prefix: '/api/traccar', router: traccar, auth: 'required' },
  { prefix: '/api/microbilt', router: microbilt, auth: 'required',
    note: 'DL search (local dl_records/persons + live MicroBilt API when creds configured) + dl/stats + status. Was a stub mount — the DL SEARCH page 404d.' },
  // Public webhook receiver must be declared BEFORE the auth-required router so
  // SM's unsigned POST reaches it without a JWT. The HMAC signature is the guard.
  { prefix: '/api/servemanager-webhook', router: serveManagerWebhookRouter, auth: 'public' },
  { prefix: '/api/servemanager', router: serveManagerRoutes, auth: 'required' },
  { prefix: '/api/skiptracer-v2', router: skiptracerV2, auth: 'required',
    note: 'Skip Tracker 3.5 — local RMS + MicroBilt cache + optional RapidAPI + enrichment adapters. Replaces stubs mount that returned empty sources/search.' },

  // ── Additional stub mounts (404 elimination sweep 2026-06-08) ──────
  // Each of these is called by the client SPA but has no real handler on
  // either the rewrite or legacy worker. Mounting stubs so pages render
  // their empty/error state instead of 404ing.
  { prefix: '/api/cfs', router: cfsQr, auth: 'required' },
  // Code enforcement graduated from stubs to a real D1-backed router
  // (code_violations + vehicle_tows tables) — 2026-06-09 404 sweep.
  { prefix: '/api/code-enforcement', router: codeEnforcement, auth: 'required' },
  { prefix: '/api/dar', router: dar, auth: 'required' },
  // Longer ingest prefix FIRST so Hono does not let the parent router steal POST /ingest.
  { prefix: '/api/dialer-connect/ingest', router: dialerConnectIngest, auth: 'public',
    note: 'Dial Connect server-to-server ingest. HMAC via DIAL_CONNECT_WEBHOOK_SECRET (Authorization or X-Dial-Connect-Secret).' },
  { prefix: '/api/dialer-connect', router: dialerConnect, auth: 'required',
    note: 'Dial Connect recordings, transcripts, voicemail, call history, speed dials, presence. Operational roles only.' },
  { prefix: '/api/form-drafts', router: formDrafts, auth: 'required' },
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

  // FlexOS system routes: remote lock (KV-backed), active-call polling,
  // unit status read/write. Used by the FlexOS desktop system context.
  { prefix: '/api/system', router: systemRoutes, auth: 'required' },

  // Post-quantum crypto admin — key material & sealing/signing (admin/manager
  // gated inside the route). Was never wired into routesConfig despite its
  // header comment claiming so; all /api/crypto/* requests were silently 404ing.
  { prefix: '/api/crypto', router: crypto, auth: 'required' },

  // Branded browser search proxy — DuckDuckGo Instant Answer proxied server-side
  // so no third-party domain appears in headless Chrome navigations. Public: no
  // auth header on the browser's fetch. Same 404 drop as crypto above.
  { prefix: '/api/browser-search', router: browserSearch, auth: 'public' },
];
