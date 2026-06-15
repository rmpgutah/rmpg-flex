// ============================================================
// RMPG Flex — Worker entry
// ============================================================
// Almost-static after the route-registry refactor (PR introducing
// src/routesConfig.ts). All HTTP route mounts live in ROUTE_REGISTRY;
// this file owns:
//   - Hono app construction + global middleware (logger, secureHeaders, cors)
//   - Global error handler (with userId visibility for auth-gap diagnostics)
//   - Auth middleware application (iterates ROUTE_REGISTRY)
//   - Route mounting (iterates ROUTE_REGISTRY)
//   - The /__welfare-fire internal callback for WelfareWatchDO
//   - Default export: fetch + scheduled handlers + WebSocket dispatch
//
// Adding a new route: edit src/routesConfig.ts (one append to the
// array + one import). Do NOT add new app.use/app.route here.
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware, readOnlyRoleGuard } from './middleware/auth';
import { handleWebSocket } from './routes/ws';
import { emitAlert } from './utils/alertHub';
import { WelfareWatchDO } from './durable-objects/WelfareWatchDO';
import { doCallbackToken, timingSafeEqual } from './utils/signedAccess';
import { VoiceHubDO } from './durable-objects/VoiceHubDO';
import { AlertHubDO } from './durable-objects/AlertHubDO';
import { PdfToolsContainer } from './containers/pdfToolsContainer';
import { runAllSourceScans } from './utils/warrantSources/runScan';
import { runUtahSorPoll } from './utils/utahSorPoller';
import { runScreeningScans } from './utils/screening/runScreeningScans';
import { detectDispatchAnomalies } from './routes/dispatch/anomalies';
import { getRadioSettings, purgeOldRecordings } from './utils/radioSettings';
import { syncAllVehicleGpsMileage } from './routes/fleet';
import { processScheduledEmails, applyRulesToRecent } from './utils/emailProcessor';
import { sweepTrips } from './utils/tripStore';
import { runEmailPoll, drainEmailOutbox, drainScheduledEmails, resurfaceSnoozedEmails } from './routes/email';
import type { Bindings, Variables } from './types';
import { ROUTE_REGISTRY } from './routesConfig';

// Export Durable Object classes so wrangler can find them at build time.
// The Container subclass extends DurableObject and is configured by
// [[containers]] + [[durable_objects.bindings]] in wrangler.toml.
export { WelfareWatchDO, VoiceHubDO, AlertHubDO, PdfToolsContainer };

// Exported so sub-routers that need to dispatch internal subrequests
// (e.g. src/routes/offline.ts replaying queued offline writes through
// the canonical handlers) can call `app.fetch(...)` without
// duplicating route logic. Sub-routers must lazy-import this to avoid
// the module-load cycle index.ts → routesConfig.ts → <subrouter> →
// index.ts; at request time the cycle is fully resolved.
export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Non-API paths served directly from the DOWNLOADS R2 bucket:
// /download, /downloads/:filename, /updates/:filename,
// /updates/latest.yml, /updates/latest-mac.yml, /rmpg-seal.png
// These live outside the route registry because they don't carry
// the /api/ prefix — they're meant to be linked from the public
// download page and from electron-updater.
import { serveDownloadFile, serveDownloadPage, serveRmpgSeal, serveUpdatesYaml } from './routes/downloads';

const ALLOWED_DOWNLOAD_EXT = ['.dmg', '.exe', '.blockmap', '.yml', '.yaml', '.zip', '.apk'];

app.get('/downloads/:filename', async (c) => {
  const filename = c.req.param('filename');
  const ext = filename.includes('.') ? '.' + filename.split('.').pop()?.toLowerCase() : '';
  if (!ALLOWED_DOWNLOAD_EXT.includes(ext)) return c.json({ error: 'Forbidden file type' }, 403);
  return serveDownloadFile(c.env.DOWNLOADS, filename, c);
});

app.get('/updates/:filename', async (c) => {
  const filename = c.req.param('filename');
  const ext = filename.includes('.') ? '.' + filename.split('.').pop()?.toLowerCase() : '';
  if (!ALLOWED_DOWNLOAD_EXT.includes(ext)) return c.json({ error: 'Forbidden file type' }, 403);
  return serveDownloadFile(c.env.DOWNLOADS, filename, c);
});

app.get('/download', async (c) => serveDownloadPage(c.env.DOWNLOADS, c));
app.get('/rmpg-seal.png', async (c) => serveRmpgSeal(c.env.DOWNLOADS, c));
app.get('/updates/latest.yml', async (c) => serveUpdatesYaml(c.env.DOWNLOADS, 'win', c));
app.get('/updates/latest-mac.yml', async (c) => serveUpdatesYaml(c.env.DOWNLOADS, 'mac', c));

// ─── Global middleware ───────────────────────────────────────
app.use('*', logger());
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'https://api.mapbox.com', 'https://js.arcgis.com', 'https://*.arcgis.com', 'https://static.cloudflareinsights.com', 'https://esm.sh', 'https://cdn.esm.sh', 'https://unpkg.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://api.mapbox.com', 'https://js.arcgis.com', 'https://*.arcgis.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
    fontSrc: ["'self'", 'data:', 'https://*.gstatic.com', 'https://js.arcgis.com', 'https://*.arcgis.com'],
    connectSrc: ["'self'", 'ws:', 'wss:', 'https://api.rmpgutah.us', 'https://*.rmpgutah.us', 'https://api.mapbox.com', 'https://events.mapbox.com', 'https://*.arcgis.com', 'https://*.arcgisonline.com', 'https://api.open-meteo.com', 'https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com', 'https://*.cartocdn.com', 'https://nominatim.openstreetmap.org', 'https://api.fbi.gov', 'https://photon.komoot.io', 'https://static.cloudflareinsights.com', 'https://esm.sh', 'https://cdn.esm.sh', 'https://storage.googleapis.com', 'https://unpkg.com'],
    frameSrc: ["'self'", 'blob:', 'https://*.arcgis.com'],
    mediaSrc: ["'self'", 'blob:', 'data:'],
    workerSrc: ["'self'", 'blob:'],
    childSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    frameAncestors: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
  },
}));
app.use('*', cors({
  origin: (origin: string, c: any) => {
    const allowedOrigins = (c.env.CORS_ORIGINS || 'https://rmpgutah.us').split(',').map((s: string) => s.trim());
    // No wildcard support: '*' combined with credentials:true would let any
    // site make authenticated cross-origin calls. Origins must be explicit.
    if (!origin || allowedOrigins.includes(origin)) return origin;
    return allowedOrigins[0];
  },
  credentials: true,
}));

// ─── Live-sync broadcast ─────────────────────────────────────
// useLiveSync() on the client subscribes to a 'data_changed' WS event to
// auto-refresh any open page when ANY device mutates data. The original VPS
// stack emitted that event from a middleware that was never ported to the
// Worker, so cross-device live refresh silently did nothing across ~38 pages.
// This restores it: after any SUCCESSFUL mutating /api request, fan out a
// single { module, entity } notification. The client debounces (500ms) and
// only refetches if it is watching that module, so the cost is one small WS
// frame per write. GETs and failed writes (status >= 400) broadcast nothing.
//
// Excluded modules (deliberate):
//   - gps / presence: high-frequency pings (every ~1s) → refresh churn.
//   - dispatch: already has surgical 'dispatch_update' realtime on the
//     dispatch/map pages; a full-page refetch here would be redundant and
//     heavier than the existing path.
//   - auth / health / ws / voice-ws / map-data / tts: non-data or streaming.
const LIVE_SYNC_SKIP = new Set([
  'auth', 'health', 'ws', 'voice-ws', 'map-data', 'tts', 'gps', 'presence', 'dispatch',
]);
app.use('/api/*', async (c, next) => {
  await next();
  try {
    const method = c.req.method;
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return;
    if (c.res.status >= 400) return;
    const segs = new URL(c.req.url).pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const module = segs[0];
    if (!module || LIVE_SYNC_SKIP.has(module)) return;
    // second segment is the entity type unless it's a numeric id
    const entity = segs[1] && !/^\d+$/.test(segs[1]) ? segs[1] : undefined;
    // Fan the cache-invalidation nudge to clients via the live AlertHubDO bus
    // (both the /api/ws and /api/alerts-ws client sockets fan-in to the same
    // subscribe() bus, and /api/alerts-ws is already served by this worker).
    // The rewrite's old per-isolate broadcastAll() was dead. Phase 4 (cutover):
    // revive cross-device live refresh without flipping /api/ws.
    await emitAlert(c.env, 'data_changed', { module, entity });
  } catch { /* live-sync must never break a real response */ }
});

// Root probe — useful for "is the Worker even reachable" smoke checks
app.get('/', (c) => c.json({ name: 'RMPG Flex API', version: '1.0.0', status: 'running' }));

// ─── Global error handler ────────────────────────────────────
// Surfaces the route + raw message for any uncaught throw inside a
// route handler. Without this, Hono's default returns "Internal Server
// Error" with no detail and we lose the actual D1 / SQL message.
//
// `userId` visibility flags auth-coverage gaps: if userId is undefined
// here, the request reached the handler without going through auth —
// likely a missing ROUTE_REGISTRY entry or a bug in applyAuthMiddleware
// below. This was the root cause of the dispatcher_id NULL FK bug
// fixed in PR #620.
app.onError((err, c) => {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const route = `${method} ${path}`;
  const detail = err instanceof Error ? err.message : String(err);
  const userId = c.get('userId') as number | undefined;
  console.error(`Unhandled in ${route} (userId=${userId}):`, err);
  return c.json({
    error: 'Internal server error',
    code: 'UNHANDLED',
    route,
    detail,
    auth: userId == null ? 'NO_AUTH' : `userId=${userId}`,
  }, 500);
});

// ─── Apply route registry ────────────────────────────────────
// Two passes so auth is declared exactly once per prefix even if
// multiple routers mount at the same path (e.g. dispatchCallLinks +
// dispatchPanic + dispatchPremiseHistory all at /api/dispatch).
//
// Each `auth: 'required'` prefix gets BOTH `app.use(prefix, ...)` and
// `app.use(prefix/*, ...)`. Hono's path matcher treats `/path/*` as
// matching `/path/X` for any X but NOT the bare `/path` itself — so
// without the bare-prefix line, requests to the exact prefix slip
// past auth entirely (silent — userId comes through as undefined).
const authPrefixes = new Set<string>();
for (const m of ROUTE_REGISTRY) {
  if (m.auth === 'required') authPrefixes.add(m.prefix);
}
for (const prefix of authPrefixes) {
  app.use(prefix, authMiddleware);
  app.use(`${prefix}/*`, authMiddleware);
  // RBAC floor: read-only roles can't mutate anything on auth-required
  // prefixes, regardless of whether the handler has its own requireRole.
  app.use(prefix, readOnlyRoleGuard);
  app.use(`${prefix}/*`, readOnlyRoleGuard);
}

// Mount routers in declared order — Hono dispatches in registration
// order, so the per-PR maintainer's job is to add entries to
// ROUTE_REGISTRY at the right position relative to the ordering
// invariants in that file's header comment.
for (const m of ROUTE_REGISTRY) {
  app.route(m.prefix, m.router);
}

// ─── Internal: WelfareWatchDO → Worker callback ──────────────
// The DO's alarm() can't call sendToUser/broadcastAll directly
// (those live in the Worker module's per-isolate state). Instead
// it posts to /__welfare-fire authenticated by X-DO-Secret, a value
// DERIVED from JWT_SECRET (doCallbackToken) — never the signing key
// itself — compared constant-time. Lives outside ROUTE_REGISTRY because
// it's an internal callback, not an API endpoint.
app.post('/__welfare-fire', async (c) => {
  const provided = c.req.header('X-DO-Secret') || '';
  const expected = await doCallbackToken(c.env.JWT_SECRET);
  if (!timingSafeEqual(provided, expected)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const { stage, watch } = await c.req.json<{ stage: 'prompt' | 'alert' | 'emergency'; watch: any }>();
  if (stage === 'prompt') {
    // Targeted to ONE officer's MDT — deliver via AlertHubDO with a
    // target_user_id (WelfareCheckModal + the voice hook filter on it). The old
    // sendToUser was per-isolate-dead, so the welfare-check prompt reached the
    // officer never; a naive broadcast would pop the takeover on every console.
    await emitAlert(c.env, 'welfare_check', {
      action: 'welfare_prompt',
      target_user_id: watch.user_id,
      callSign: watch.call_sign,
      callId: watch.call_id,
      callNumber: watch.call_number,
      message: `Welfare check: ${watch.call_sign || 'unit'}, are you code 4${watch.call_number ? ` on call ${watch.call_number}` : ''}?`,
    });
  } else if (stage === 'alert') {
    // Deliver via AlertHubDO under the DISCRETE 'welfare_alert' type the client's
    // voice-alert hook subscribes to. The old broadcastAll('dispatch_update',…)
    // was double-dead: wrong type (client subscribes to 'welfare_alert', not a
    // dispatch_update action) AND per-isolate (the live /api/ws is on legacy).
    await emitAlert(c.env, 'welfare_alert', {
      user_id: watch.user_id, call_sign: watch.call_sign,
      message: `Officer welfare alert — ${watch.call_sign || 'unit'} has not acknowledged a welfare check.`,
      at: new Date().toISOString(),
    });
  } else if (stage === 'emergency') {
    // CRITICAL officer-safety: the auto-escalation when an officer goes
    // unresponsive to welfare checks. Same double-dead bug — route via
    // AlertHubDO under 'welfare_emergency' so it reaches every dispatcher.
    await emitAlert(c.env, 'welfare_emergency', {
      user_id: watch.user_id, call_sign: watch.call_sign,
      call_id: watch.call_id, call_number: watch.call_number,
      triggered_by: 'automated_escalation',
      message: `WELFARE EMERGENCY — ${watch.call_sign || 'unit'} unresponsive${watch.call_number ? ' on ' + watch.call_number : ''}. All units respond.`,
      at: new Date().toISOString(),
    });
  }
  return c.json({ success: true });
});

// Throttled email poll. Per-minute cron, but only actually pulls when
// (now - lastSync) >= pollInterval. Default pollInterval is 300s so the
// default cadence is every 5 minutes — same as the admin tab's UI default.
async function maybeRunEmailPoll(env: Bindings, ctx: ExecutionContext): Promise<void> {
  const db = env.DB;
  const [enabled, lastSyncStr, pollIntervalStr] = await Promise.all([
    db.prepare("SELECT config_value FROM system_config WHERE config_key = 'ms_email_enabled' AND category = 'integrations' AND is_active = 1").first<{ config_value: string }>(),
    db.prepare("SELECT config_value FROM system_config WHERE config_key = 'ms_email_last_sync' AND category = 'integrations' AND is_active = 1").first<{ config_value: string }>(),
    db.prepare("SELECT config_value FROM system_config WHERE config_key = 'ms_email_poll_interval' AND category = 'integrations' AND is_active = 1").first<{ config_value: string }>(),
  ]);
  if (enabled?.config_value !== 'true') return;
  const pollInterval = pollIntervalStr ? parseInt(pollIntervalStr.config_value, 10) : 300;
  if (lastSyncStr?.config_value) {
    const last = Date.parse(lastSyncStr.config_value);
    if (Number.isFinite(last) && Date.now() - last < pollInterval * 1000) return;
  }
  const r = await runEmailPoll(env, ctx);
  if (r.error) console.error(`[email-poll] ${r.error}`);
  else if (!r.skipped) console.log(`[email-poll] scanned=${r.scanned} upserted=${r.upserted} ruleHits=${r.ruleHits} linked=${r.linked}`);
}

// ─── Worker export ───────────────────────────────────────────
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ws') {
      return handleWebSocket(request, env);
    }
    // Dedicated voice socket → VoiceHubDO. This is a SEPARATE channel
    // from /api/ws (which lives on the legacy worker and carries
    // alerts/GPS/dispatch). Voice gets its own DO-backed hub here so
    // real-time fan-out across units actually works. The client opens
    // this straight at api.rmpgutah.us, bypassing the proxy. Room is in
    // ?room=radio-<id> / panic-<id>; JWT auth happens inside the DO.
    if (url.pathname === '/api/voice-ws') {
      const room = url.searchParams.get('room') || '';
      if (!/^(radio|panic)-\d+$/.test(room)) {
        return new Response('Bad or missing room', { status: 400 });
      }
      const id = env.VOICE_HUB.idFromName(room);
      return env.VOICE_HUB.get(id).fetch(request);
    }
    // Agency-wide officer-safety alert socket → the single global AlertHubDO.
    // Every client holds one of these (connected straight at api.rmpgutah.us,
    // bypassing the proxy, same as voice). It's how rewrite-originated panic
    // broadcasts actually reach dispatchers — see src/durable-objects/AlertHubDO.ts.
    if (url.pathname === '/api/alerts-ws') {
      const id = env.ALERT_HUB.idFromName('global');
      return env.ALERT_HUB.get(id).fetch(request);
    }
    return app.fetch(request, env, ctx);
  },

  // Cron-triggered Utah warrant scan. Schedule defined in
  // wrangler.toml [[triggers]] crons. waitUntil ensures the scan
  // finishes even though the scheduled handler returns immediately.
  // Errors are swallowed inside runUtahWarrantScan so one bad run
  // can't crash the cron loop.
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '* * * * *') {
      // Per-minute trip idle/stale sweep — backstop for units that go dark while
      // stationary (lazy-on-gps-write handles the common case).
      ctx.waitUntil(
        sweepTrips(env.DB, env).then((n) => { if (n) console.log(`[trips] sweep closed ${n}`); })
          .catch((err) => console.error('[trips] sweep failed:', err)),
      );
      // Intel watchlist sweep — alerts when a watched person/vehicle
      // appears in new activity (notifications inbox, HIGH priority).
      // No-ops cheaply when intel_watchlist is empty or missing.
      ctx.waitUntil(
        import('./utils/intelWatchlist')
          .then(({ sweepWatchlist }) => sweepWatchlist(env.DB))
          .then((n) => { if (n) console.log(`[watchlist] ${n} alert(s) raised`); })
          .catch((err) => console.error('[watchlist] sweep failed:', err)),
      );
      // Intel cross-hit coverage sweep — screens persons/vehicles
      // created in the last 2 minutes regardless of entry path; critical
      // hits raise anomaly_alerts (dispatch banner). Cheap when idle.
      ctx.waitUntil(
        import('./utils/intelScreen')
          .then(({ sweepNewEntities }) => sweepNewEntities(env.DB))
          .then((n) => { if (n) console.log(`[intel-screen] ${n} alert(s) raised`); })
          .catch((err) => console.error('[intel-screen] sweep failed:', err)),
      );
      // Officer-safety: on-foot overdue sweep — alerts dispatch when a
      // unit has been on foot past the threshold. Cheap when none are.
      ctx.waitUntil(
        import('./utils/onFootSweep')
          .then(({ sweepOnFootOverdue }) => sweepOnFootOverdue(env.DB, env))
          .then((n) => { if (n) console.log(`[on-foot] ${n} overdue alert(s)`); })
          .catch((err) => console.error('[on-foot] sweep failed:', err)),
      );
      // Email poll — throttled internally by ms_email_last_sync vs
      // ms_email_poll_interval. No-op when not configured.
      ctx.waitUntil(
        maybeRunEmailPoll(env, ctx)
          .catch((err) => console.error('[email-poll] failed:', err)),
      );
      // Email outbox drain — retries Graph /me/sendMail for queued sends
      // whose backoff window has elapsed. Self-throttled by next_attempt_at.
      ctx.waitUntil(
        drainEmailOutbox(env)
          .then((r) => { if (r.sent || r.failed) console.log(`[email-outbox] sent=${r.sent} failed=${r.failed} deferred=${r.deferred}`); })
          .catch((err) => console.error('[email-outbox] failed:', err)),
      );
      // Schedule-send queue → enqueues due rows into the durable outbox,
      // which the drain above then actually sends (uniform retry/backoff).
      ctx.waitUntil(
        drainScheduledEmails(env)
          .then((n) => { if (n) console.log(`[email-scheduled] queued ${n}`); })
          .catch((err) => console.error('[email-scheduled] failed:', err)),
      );
      // Expired snoozes → move back to inbox + mark unread.
      ctx.waitUntil(
        resurfaceSnoozedEmails(env)
          .then((n) => { if (n) console.log(`[email-snooze] resurfaced ${n}`); })
          .catch((err) => console.error('[email-snooze] failed:', err)),
      );
      // ClearPath dashcam media sync (Phase B) + per-clip ALPR (Phase C).
      // Self-throttled by clearpathgps_last_media_sync vs the configured
      // interval; no-ops cheaply when the integration or media sync is off.
      ctx.waitUntil(
        import('./utils/clearpathSync')
          .then(({ maybeRunClearpathMediaSync }) => maybeRunClearpathMediaSync(env))
          .catch((err) => console.error('[cpg-media] cron failed:', err)),
      );
      // FlexCam footage poll — downloads ready R2 chunks; no-op when disabled.
      ctx.waitUntil(
        import('./utils/footage/captureOrchestrator')
          .then(({ maybeRunFootagePoll }) => maybeRunFootagePoll(env))
          .catch((err) => console.error('[flexcam] poll error:', (err as Error)?.message)),
      );
      return;
    }
    ctx.waitUntil(
      runAllSourceScans(env.DB).catch((err) => {
        console.error('Multi-source warrant scheduled scan failed:', err);
      }),
    );
    // Utah Sex Offender Registry poll — pulls from an agency-authorized
    // feed (system_config sor_feed_url/key) into utah_sex_offenders.
    // No-op until a feed is provisioned; never scrapes the public site.
    ctx.waitUntil(
      runUtahSorPoll(env.DB)
        .then((r) => { if (r.configured) console.log(`[sor] seen=${r.seen} upserted=${r.upserted}${r.error ? ` err=${r.error}` : ''}`); })
        .catch((err) => console.error('[sor] poll failed:', err)),
    );
    // Person-screening framework (INTERPOL / OFAC / Utah SOR). Watch-listed
    // persons only; OFAC dataset is bulk-refreshed inside the orchestrator.
    ctx.waitUntil(
      runScreeningScans(env).catch((err) => console.error('[screening] scan failed:', err)),
    );
    // Intel Search index sync + person-resolution pass (migration 0098).
    // Full re-sync is cheap at the current dataset size; failures are
    // contained so they can't abort the other 4-hourly scans.
    ctx.waitUntil(
      import('./utils/intelIndexer')
        .then(async ({ rebuildIntelIndex, computeResolutionSuggestions }) => {
          const counts = await rebuildIntelIndex(env.DB);
          const suggestions = await computeResolutionSuggestions(env.DB);
          console.log(`[intel-index] synced ${JSON.stringify(counts)}, ${suggestions} resolution suggestions`);
        })
        .catch((err) => console.error('[intel-index] cron failed:', err)),
    );
    // Narrative entity extraction — mines recent call/incident text for
    // known persons/plates/phones and queues link suggestions for /intel.
    ctx.waitUntil(
      import('./utils/intelExtract')
        .then(({ runExtraction }) => runExtraction(env.DB, 6))
        .then((n) => { if (n) console.log(`[intel-extract] ${n} suggestion(s) queued`); })
        .catch((err) => console.error('[intel-extract] cron failed:', err)),
    );
    // Intel pattern detection + subject escalation (Wave 2) — repeat
    // locations, near-repeat clusters, escalating subjects → anomaly_alerts.
    ctx.waitUntil(
      import('./utils/intelPatterns')
        .then(async ({ detectRepeatLocations, detectNearRepeat, sweepEscalation }) => {
          const a = await detectRepeatLocations(env.DB);
          const b = await detectNearRepeat(env.DB);
          const c2 = await sweepEscalation(env.DB);
          if (a + b + c2) console.log(`[intel-pattern] alerts: repeat=${a} nearRepeat=${b} escalation=${c2}`);
        })
        .catch((err) => console.error('[intel-pattern] cron failed:', err)),
    );
    // Jail/booking roster scan (Wave 3a) — seeds the registry, pulls
    // active sources, cross-hits bookings against known/flagged subjects.
    ctx.waitUntil(
      import('./utils/jailSources/runScan')
        .then(({ runJailScan }) => runJailScan(env as any))
        .then((s) => { const n = s.reduce((a, x) => a + x.ingested, 0); if (n) console.log(`[jail-scan] ingested ${n}`); })
        .catch((err) => console.error('[jail-scan] cron failed:', err)),
    );
    // Dispatch anomaly detection — populates anomaly_alerts for the
    // AnomalyAlertBanner. Independent of the warrant scan; its own
    // catch so a failure here can't abort the warrant scan or crash
    // the cron loop.
    ctx.waitUntil(
      detectDispatchAnomalies(env.DB)
        .then((r) => console.log(`[anomaly] raised/updated ${r.raised}, auto-resolved ${r.resolved}`))
        .catch((err) => console.error('Dispatch anomaly detection failed:', err)),
    );
    // Radio recording retention — purge transmissions/audio older than the
    // operator-set window (radio settings; 0 = keep forever). Own catch so a
    // failure can't abort the other scans or crash the cron loop.
    ctx.waitUntil(
      getRadioSettings(env.DB)
        .then((s) => purgeOldRecordings(env.DB, env.UPLOADS, s.recording_retention_days))
        .then((r) => { if (r.deleted) console.log(`[radio] purged ${r.deleted} expired recording(s)`); })
        .catch((err) => console.error('Radio retention purge failed:', err)),
    );
    // Fleet GPS mileage sync — derives odometer from dispatch breadcrumbs
    // for every assigned vehicle. Own catch so a failure here can't abort
    // the other scans or crash the cron loop.
    ctx.waitUntil(
      syncAllVehicleGpsMileage(env.DB)
        .then((r) => console.log(`[fleet-gps] checked ${r.checked}, ${r.with_gps} with GPS, ${r.total_gps_miles.toFixed(1)} mi available`))
        .catch((err) => console.error('Fleet GPS mileage scan failed:', err)),
    );
    // Sessions hygiene — purge rows that can never authenticate again
    // (expired > 1 day ago, or revoked > 7 days ago). Live D1 had 617 rows
    // with only ~44 usable; dead rows inflated the Security page's session
    // analytics and slow every sessions scan a little more each week.
    ctx.waitUntil(
      env.DB.prepare(
        "DELETE FROM sessions WHERE expires_at <= datetime('now','-1 day') OR (is_active = 0 AND created_at <= datetime('now','-7 days'))"
      ).run()
        .then((r) => { const n = r?.meta?.changes ?? 0; if (n) console.log(`[sessions] purged ${n} dead session row(s)`); })
        .catch((err) => console.error('Sessions purge failed:', err)),
    );
    // Process-serve needs-attention sweep — raises notifications + supervisor
    // email digest for overdue/approaching/diligence-gap/unassigned jobs.
    // Deduped by serve_nudges (per-job per-condition renotify window).
    ctx.waitUntil(
      import('./utils/serveNudgeSweep')
        .then(({ sweepServeNudges }) => sweepServeNudges(env.DB, env))
        .then((n) => { if (n) console.log(`[serve-nudge] ${n} nudge(s) raised`); })
        .catch((err) => console.error('[serve-nudge] sweep failed:', err)),
    );
    // Case-task due-date nudges — overdue/due-soon active tasks notify the
    // assignee + supervisors. Runs on the 4-hourly cron (this block is after
    // the per-minute `return` above, alongside serveNudgeSweep); deduped per
    // recipient via the notifications table (≤ 1 nudge / 20h).
    ctx.waitUntil(
      import('./utils/caseTaskNudges')
        .then(({ sweepCaseTaskNudges }) => sweepCaseTaskNudges(env.DB, env))
        .then((n) => { if (n) console.log(`[case-task-nudge] ${n} nudge(s) raised`); })
        .catch((err) => console.error('[case-task-nudge] sweep failed:', err)),
    );
  },
};
