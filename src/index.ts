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
import { jsonBodyGuard } from './middleware/jsonBodyGuard';
import { apiRateLimit } from './middleware/rateLimit';
import { handleWebSocket, sendToUser, broadcastAll } from './routes/ws';
import { WelfareWatchDO } from './durable-objects/WelfareWatchDO';
import { VoiceHubDO } from './durable-objects/VoiceHubDO';
import { AlertHubDO } from './durable-objects/AlertHubDO';
import { DeepResearchDO } from './durable-objects/DeepResearchDO';
import { PersonIntelDO } from './durable-objects/PersonIntelDO';
import { FlexCamRemuxDO } from './durable-objects/FlexCamRemuxDO';
import { WebBrowserSessionDO } from './durable-objects/WebBrowserSessionDO';
import { PdfToolsContainer } from './containers/pdfToolsContainer';
import { TesseractOcrContainer } from './containers/tesseractOcrContainer';
import { detectDispatchAnomalies } from './routes/dispatch/anomalies';
import type { Bindings, Variables } from './types';
import { ROUTE_REGISTRY } from './routesConfig';
import { log, logErrorToDb } from './utils/logger';

// Export Durable Object classes so wrangler can find them at build time.
// The Container subclass extends DurableObject and is configured by
// [[containers]] + [[durable_objects.bindings]] in wrangler.toml.
export { WelfareWatchDO, VoiceHubDO, AlertHubDO, DeepResearchDO, PersonIntelDO, FlexCamRemuxDO, PdfToolsContainer, WebBrowserSessionDO, TesseractOcrContainer };

// Exported so sub-routers that need to dispatch internal subrequests
// (e.g. src/routes/offline.ts replaying queued offline writes through
// the canonical handlers) can call `app.fetch(...)` without
// duplicating route logic. Sub-routers must lazy-import this to avoid
// the module-load cycle index.ts → routesConfig.ts → <subrouter> →
// index.ts; at request time the cycle is fully resolved.
export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── Global middleware ───────────────────────────────────────
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin: string, c: any) => {
    const allowedOrigins = (c.env.CORS_ORIGINS || 'https://rmpgutah.us').split(',').map((s: string) => s.trim());
    if (allowedOrigins.includes('*')) return origin;
    if (!origin || allowedOrigins.includes(origin)) return origin;
    return allowedOrigins[0];
  },
  credentials: true,
}));

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
  const isCorrupt = detail.includes('SQLITE_CORRUPT') || detail.includes('malformed');
  const statusCode = isCorrupt ? 503 : 500;

  log.error('Unhandled route error', { route, userId, isCorrupt }, err);

  if (isCorrupt) {
    log.warn('[corrupt] Database corruption detected', { route, table: detail.includes('VTAB') ? 'FTS_virtual_table' : 'unknown' });
  }

  return c.json({
    error: isCorrupt ? 'Database error — try again or contact admin' : 'Internal server error',
    code: isCorrupt ? 'DATABASE_CORRUPT' : 'UNHANDLED',
    route,
    auth: userId == null ? 'NO_AUTH' : `userId=${userId}`,
  }, statusCode);
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
  app.use(prefix, apiRateLimit);
  app.use(`${prefix}/*`, apiRateLimit);
  app.use(prefix, readOnlyRoleGuard);
  app.use(`${prefix}/*`, readOnlyRoleGuard);
}

// Reject a malformed JSON body with 400 instead of letting the SyntaxError
// become a 500 (see src/middleware/jsonBodyGuard.ts). Registered in its OWN
// pass, AFTER the auth loop above, so ordering stays correct on both counts:
// an unauthenticated caller sending garbage still gets 401 rather than a 400
// that would confirm the endpoint exists, and the guard still runs before any
// handler because Hono dispatches middleware in registration order and the
// routers are mounted below.
const bodyGuardPrefixes = new Set<string>(ROUTE_REGISTRY.map((m) => m.prefix));
for (const prefix of bodyGuardPrefixes) {
  app.use(prefix, jsonBodyGuard);
  app.use(`${prefix}/*`, jsonBodyGuard);
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
// it posts to /__welfare-fire authenticated by X-DO-Secret == JWT_SECRET.
// Lives outside ROUTE_REGISTRY because it's an internal callback,
// not an API endpoint.
app.post('/__welfare-fire', async (c) => {
  if (c.req.header('X-DO-Secret') !== c.env.JWT_SECRET) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const { stage, watch } = await c.req.json<{ stage: 'prompt' | 'alert' | 'emergency'; watch: any }>();
  if (stage === 'prompt') {
    sendToUser(watch.user_id, 'welfare_check', {
      action: 'welfare_prompt',
      callSign: watch.call_sign,
      callId: watch.call_id,
      callNumber: watch.call_number,
      message: `Welfare check: ${watch.call_sign || 'unit'}, are you code 4${watch.call_number ? ` on call ${watch.call_number}` : ''}?`,
    });
  } else if (stage === 'alert') {
    broadcastAll('dispatch_update', { action: 'welfare_alert', user_id: watch.user_id, call_sign: watch.call_sign, at: new Date().toISOString() });
  } else if (stage === 'emergency') {
    broadcastAll('dispatch_update', { action: 'welfare_emergency', user_id: watch.user_id, call_sign: watch.call_sign, call_id: watch.call_id, call_number: watch.call_number, triggered_by: 'automated_escalation', at: new Date().toISOString() });
  }
  return c.json({ success: true });
});

// ─── Worker export ───────────────────────────────────────────
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ws') {
      return handleWebSocket(request, env);
    }
    // Alert + voice hubs: upgrades forward straight to the DO. HTTP-level
    // auth is intentionally absent — clients connect bare (no JWT in URLs,
    // 2026-04-15 policy) and the DO verifies the first `authenticate` frame
    // itself, dropping sockets that never authenticate. These handlers were
    // lost in a squash (restored 2026-07-01; without them the paths fell
    // into the Hono auth middleware and every upgrade 401'd).
    if (url.pathname === '/api/alerts-ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const id = env.ALERT_HUB.idFromName('global');
      return env.ALERT_HUB.get(id).fetch(request);
    }
    if (url.pathname === '/api/voice-ws') {
      const room = url.searchParams.get('room') || '';
      if (!room) return new Response('Missing room query parameter', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const id = env.VOICE_HUB.idFromName(room);
      return env.VOICE_HUB.get(id).fetch(request);
    }
    if (url.pathname === '/api/web-browser-ws') {
      const sessionId = url.searchParams.get('sessionId') || '';
      if (!sessionId) return new Response('Missing sessionId query parameter', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const id = env.WEB_BROWSER_SESSION.idFromName(sessionId);
      return env.WEB_BROWSER_SESSION.get(id).fetch(request);
    }
    return app.fetch(request, env, ctx);
  },

  // Cron-triggered tasks. Schedules defined in wrangler.toml [[triggers]] crons.
  // Workers cron uses UTC; handlers requiring Denver-local hour boundaries
  // must convert via Intl.DateTimeFormat (America/Denver). waitUntil ensures
  // async work completes; each task catches its own errors so one failure
  // cannot abort the cron loop.
  //
  // Cron schedule (UTC):
  //   "0 */4 * * *"   every 4 h at :00         → warrant scan, dispatch anomalies, nudge sweep
  //   "* * * * *"     every minute              → serve attempt notifications, daily rebalance
  //   "*/30 * * * *"  every 30 min              → ServeManager job poller, email outbox drain + inbox poll
  //   "0 3 1 * *"     1st of month 03:00 UTC    → NHTSA vPIC refresh
  //   "0 9 * * *"     nightly 09:00 UTC         → driver-performance rollup (trailing 3 days)
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    // ── Every 4 hours (UTC 00:00, 04:00, 08:00, 12:00, 16:00, 20:00) ──
    if (event.cron === '0 */4 * * *') {
      // Acknowledgement email deliveries that never got a confirmation.
      // Cheap, indexed, and it stops a receipt claiming a delivery is in
      // flight months after the signing page closed.
      ctx.waitUntil(
        import('./routes/serveReceipt')
          .then((m) => m.sweepStaleReceiptEmails(env))
          .catch((err) => log.error('Stale receipt email sweep failed', {}, err as Error)),
      );
      ctx.waitUntil(
        import('./utils/warrantSources/runScan').then((m) =>
          m.runAllSourceScans(env.DB).then((result) =>
            import('./utils/warrantSources/logScanResult').then((log) =>
              log.logScanResult(env.DB, result, 'cron').catch((err) => {
                console.error('scraper_runs logging failed:', err);
                logErrorToDb(env.DB, {
                  severity: 'error',
                  category: 'cron',
                  message: `warrant scan logScanResult failed: ${err instanceof Error ? err.message : String(err)}`,
                  source: 'scheduled:warrant-scan',
                }, ctx);
              }),
            ),
          ).catch((err) => {
            // runAllSourceScans itself rejected — this is the failure mode this
            // logging was added to catch (2026-07-22: the cron warrant scan had
            // silently produced zero scraper_runs rows for 2+ weeks with nothing
            // in error_log, because console.error/console.warn calls in
            // background cron code never reach error_log — only explicit
            // logErrorToDb calls do).
            logErrorToDb(env.DB, {
              severity: 'error',
              category: 'cron',
              message: `runAllSourceScans failed: ${err instanceof Error ? err.message : String(err)}`,
              details: { stack: err instanceof Error ? err.stack : undefined },
              source: 'scheduled:warrant-scan',
            }, ctx);
            return import('./utils/warrantSources/logScanResult').then((log) =>
              log.logOrchestratorFailure(env.DB, 'cron', err),
            );
          }),
        ).catch((err) => {
          // The dynamic import()s themselves failed (module load/eval error) —
          // this path previously swallowed the error entirely with no trace.
          console.error('[cron] warrant scan module import failed:', err);
          logErrorToDb(env.DB, {
            severity: 'error',
            category: 'cron',
            message: `warrant scan module import failed: ${err instanceof Error ? err.message : String(err)}`,
            details: { stack: err instanceof Error ? err.stack : undefined },
            source: 'scheduled:warrant-scan',
          }, ctx);
        }),
      );
      ctx.waitUntil(
        detectDispatchAnomalies(env.DB)
          .then((r) => console.log(`[anomaly] raised/updated ${r.raised}, auto-resolved ${r.resolved}`))
          .catch((err) => console.error('Dispatch anomaly detection failed:', err)),
      );
      // Serve nudge sweep — 4-hourly supervisor digest + officer notifications
      ctx.waitUntil(
        import('./utils/serveNudgeSweep').then((m) =>
          m.sweepServeNudges(env.DB, env).catch((err) =>
            console.error('Serve nudge sweep failed:', err),
          ),
        ).catch(() => {}),
      );
      // Case task due-date nudge sweep — was written (2026-06-xx, "v3 Phase
      // 2") but never actually wired to cron; case-task overdue/due-soon
      // notifications have never fired in production. Logs failures to
      // error_log from day one (see the 2026-07-22 UTC/DST audit that found
      // the sibling warrant-scan task's console-only errors were invisible
      // for 2+ weeks).
      ctx.waitUntil(
        import('./utils/caseTaskNudges').then((m) =>
          m.sweepCaseTaskNudges(env.DB, env)
            .then((n) => console.log(`[case-task-nudges] inserted ${n} notification(s)`))
            .catch((err) => {
              console.error('Case task nudge sweep failed:', err);
              logErrorToDb(env.DB, {
                severity: 'error',
                category: 'cron',
                message: `sweepCaseTaskNudges failed: ${err instanceof Error ? err.message : String(err)}`,
                details: { stack: err instanceof Error ? err.stack : undefined },
                source: 'scheduled:case-task-nudges',
              }, ctx);
            }),
        ).catch((err) => {
          console.error('[cron] case task nudges module import failed:', err);
          logErrorToDb(env.DB, {
            severity: 'error',
            category: 'cron',
            message: `case task nudges module import failed: ${err instanceof Error ? err.message : String(err)}`,
            details: { stack: err instanceof Error ? err.stack : undefined },
            source: 'scheduled:case-task-nudges',
          }, ctx);
        }),
      );
      // Warrant auto-expiry sweep — flips any 'active' warrant past its
      // expires_at to 'expired'. Backstops the lazy GET-time check in
      // src/routes/warrants.ts for warrants nobody has read since expiring.
      ctx.waitUntil(
        import('./utils/warrantStatus').then((m) =>
          m.expireOverdueWarrants(env.DB)
            .then((n) => console.log(`[warrant-expiry] flipped ${n} overdue warrant(s) to expired`))
            .catch((err) => console.error('Warrant auto-expiry sweep failed:', err)),
        ).catch(() => {}),
      );
    }

    // ── Every 30 minutes ──
    if (event.cron === '*/30 * * * *') {
      // Stale warrant-watch-run reaper. A Cron Trigger is capped at 15 min of
      // wall time and a waitUntil() at 30s, so a scan whose isolate is evicted
      // mid-loop never writes its own completion row and sits at 'running'
      // forever. Those rows are not cosmetic: the Warrants-tab poll banner reads
      // them as a live scan and, being injected above the tab strip, overlays and
      // swallows every tab click; Watch List reports "LAST SCAN: Never". This
      // sweep closes out anything past the stale timeout so the UI tells the
      // truth. (Live D1 had 20/20 rows stuck this way on 2026-07-30.)
      ctx.waitUntil(
        import('./utils/utahWarrantPoller').then((m) =>
          m.reapStaleWatchRuns(env.DB)
            .then((n) => { if (n > 0) console.log(`[warrant-watch-reaper] closed out ${n} stale run(s)`); })
            .catch((err) => console.error('Stale warrant-watch-run reaper failed:', err)),
        ).catch((err) => console.error('Stale warrant-watch-run reaper import failed:', err)),
      );
      // ServeManager job poller — syncs jobs from ServeManager into CFS dispatch
      ctx.waitUntil(
        import('./utils/serveManagerPoller').then((m) =>
          m.pollServeManagerJobs(env).then((r) => {
            if (r.synced > 0 || r.callsCreated > 0) {
              console.log(`[sm-poller] synced ${r.synced} jobs, created ${r.callsCreated} calls`);
            }
            if (r.error) console.error('[sm-poller]', r.error);
          }).catch((err) => console.error('[sm-poller] failed:', err)),
        ).catch(() => {}),
      );
      // SOR per-state detail-page enrichment — backfills offense/risk_level
      // for national_sex_offenders rows in the 6 supported states.
      ctx.waitUntil(
        import('./utils/sorEnrichment/runner').then((m) =>
          m.enrichPendingOffenders(env.DB).then((r) => {
            if (r.attempted > 0) {
              console.log(`[sor-enrich] attempted ${r.attempted}, succeeded ${r.succeeded}, failed ${r.failed}`);
            }
          }).catch((err) => console.error('[sor-enrich] failed:', err)),
        ).catch(() => {}),
      );
      // Fleet.io outbound reconciliation — drains `fleetio_events` rows
      // queued by events.ts. Previously this had ZERO call sites anywhere
      // in the Worker, so every queued outbound event (vehicle/fuel/work
      // order/vendor/part writes) sat in status='pending' forever. Skips
      // silently (FleetioConfigError) when the two secrets aren't set.
      ctx.waitUntil(
        Promise.all([
          import('./utils/fleetio/sync'),
          import('./utils/fleetio/client'),
        ]).then(([syncMod, clientMod]) => {
          const config = clientMod.configFromEnv(env as unknown as Record<string, unknown>);
          const adapter = {
            createVehicle: (args: { payload: Record<string, unknown> }) => clientMod.createVehicle({ config, payload: args.payload as never }),
            updateVehicle: (args: { fleetioId: number; payload: Record<string, unknown> }) => clientMod.updateVehicle({ config, ...args }),
            archiveVehicle: (args: { fleetioId: number; archivedAtIso: string }) => clientMod.archiveVehicle({ config, ...args }),
            createFuelEntry: (args: { payload: Record<string, unknown> }) => clientMod.createFuelEntry({ config, ...args }),
            updateFuelEntry: (args: { fleetioId: number; payload: Record<string, unknown> }) => clientMod.updateFuelEntry({ config, ...args }),
            deleteFuelEntry: (args: { fleetioId: number }) => clientMod.deleteFuelEntry({ config, ...args }),
            createWorkOrder: (args: { payload: Record<string, unknown> }) => clientMod.createWorkOrder({ config, ...args }),
            updateWorkOrder: (args: { fleetioId: number; payload: Record<string, unknown> }) => clientMod.updateWorkOrder({ config, ...args }),
            createVendor: (args: { payload: Record<string, unknown> }) => clientMod.createVendor({ config, ...args }),
            updateVendor: (args: { fleetioId: number; payload: Record<string, unknown> }) => clientMod.updateVendor({ config, ...args }),
            archiveVendor: (args: { fleetioId: number }) => clientMod.archiveVendor({ config, ...args }),
            createPart: (args: { payload: Record<string, unknown> }) => clientMod.createPart({ config, ...args }),
            updatePart: (args: { fleetioId: number; payload: Record<string, unknown> }) => clientMod.updatePart({ config, ...args }),
            deletePart: (args: { fleetioId: number }) => clientMod.deletePart({ config, ...args }),
          };
          return syncMod.applyOutbound({ db: env.DB, adapter, config }).then((r) => {
            if (r.attempted > 0) {
              console.log(`[fleetio-sync] attempted=${r.attempted} completed=${r.completed} failed=${r.failed} skipped=${r.skipped}`);
            }
          });
        }).catch((err) => {
          // FleetioConfigError (secrets unset) is expected until the
          // operator provisions FLEETIO_API_KEY/FLEETIO_ACCOUNT_TOKEN.
          if (err?.name !== 'FleetioConfigError') console.error('[fleetio-sync] applyOutbound failed:', err);
        }),
      );
      // Fleet.io health sweep — dead-letter + stuck-queue notifications.
      // Independent of the reconciliation waitUntil above: it reads
      // whatever fleetio_events state exists at sweep time, so it doesn't
      // need to wait for that pass to finish first.
      ctx.waitUntil(
        import('./utils/fleetio/healthSweep').then((m) =>
          m.sweepFleetioHealth(env.DB, env).then((r) => {
            if (r.deadLetterNotified > 0 || r.queueAlertFired) {
              console.log(`[fleetio-health-sweep] deadLetterNotified=${r.deadLetterNotified} queueUnhealthy=${r.queueUnhealthy} queueAlertFired=${r.queueAlertFired} failedTotal=${r.failedTotal}`);
            }
          }),
        ).catch((err) => console.error('[fleetio-health-sweep] failed:', err)),
      );
      // Email outbox drain — pops pending `email_outbox` rows (Graph send
      // failed inline, e.g. because the owning user hadn't connected their
      // mailbox yet) and retries with backoff. Previously this had ZERO
      // call sites anywhere in the Worker, so a Phase 3 per-user send that
      // failed inline (ensureValidToken throws for any user with no
      // user_graph_tokens row) sat in status='pending' forever — silent
      // permanent loss of legally-significant email (e.g. signed
      // Acknowledgement-of-Service receipts sent via serveReceipt.ts).
      ctx.waitUntil(
        import('./routes/email').then((m) =>
          m.drainEmailOutbox(env).then((r) => {
            if (r.sent > 0 || r.failed > 0 || r.deferred > 0) {
              console.log(`[email-outbox-drain] sent=${r.sent} failed=${r.failed} deferred=${r.deferred}`);
            }
          }),
        ).catch((err) => console.error('[email-outbox-drain] failed:', err)),
      );
      // Per-user mailbox inbox poll — syncs each connected user's inbox
      // (rules engine, autolinker). Skips cleanly when no user has
      // connected a mailbox yet.
      ctx.waitUntil(
        import('./routes/email').then((m) =>
          m.runEmailPoll(env, ctx).then((r) => {
            if (!r.skipped) {
              console.log(`[email-poll] scanned=${r.scanned} upserted=${r.upserted} ruleHits=${r.ruleHits} linked=${r.linked}`);
            }
            if (r.error) console.error('[email-poll]', r.error);
          }),
        ).catch((err) => console.error('[email-poll] failed:', err)),
      );
    }

    // ── Every minute ──
    if (event.cron === '* * * * *') {
      // Continue a warrant-roster pass that the 15-minute cron wall cap
      // truncated, instead of leaving the remainder unchecked for up to 4 hours
      // until the next scheduled tick. Observed live 2026-07-31: consecutive
      // passes stopped at 59 and 60 of 83 people, so the tail of the roster was
      // going unchecked for most of the day.
      //
      // No-ops unless the LAST run was budget-truncated AND the resume cursor is
      // mid-roster, and skips entirely while any run is still 'running' — so this
      // per-minute cadence cannot start overlapping scans or turn into a 24/7
      // crawler against warrants.utah.gov (whose WAF the 8s pacing exists to
      // stay under). See resumePartialWatchRun for the full reasoning.
      ctx.waitUntil(
        import('./utils/utahWarrantPoller').then((m) =>
          m.resumePartialWatchRun(env.DB)
            .then((r) => { if (r) console.log(`[warrant-resume] continued pass: ${r.persons_checked} checked, ${r.new_warrants_found} found`); })
            .catch((err) => console.error('Warrant partial-pass resume failed:', err)),
        ).catch((err) => console.error('Warrant partial-pass resume import failed:', err)),
      );
      // Unified scheduler reminders (scheduler_events.notify_at) — mirrors
      // the serve-attempt sweep below; fires scheduler_reminder alerts.
      ctx.waitUntil(
        import('./utils/schedulerReminders').then((m) =>
          m.sweepSchedulerReminders(env.DB, env).catch((err) =>
            console.error('Scheduler reminder sweep failed:', err),
          ),
        ).catch(() => {}),
      );
      // Serve attempt notifications: fires pre-event dispatch reminders
      ctx.waitUntil(
        import('./utils/serveAttemptScheduler').then((m) =>
          m.sweepAttemptNotifications(env.DB, env).catch((err) =>
            console.error('Serve attempt notification sweep failed:', err),
          ),
        ).catch(() => {}),
      );
      // Panic alert escalation — src/routes/dispatch/panic.ts's own header
      // comment flags this as a known gap: escalation_level existed but
      // nothing ever advanced it or re-broadcast an unacknowledged alert.
      ctx.waitUntil(
        import('./utils/panicEscalationSweep').then((m) =>
          m.sweepPanicEscalation(env.DB).then((r) => {
            if (r.escalated > 0) console.log(`[panic-escalation] escalated ${r.escalated}`);
          }).catch((err) => console.error('Panic escalation sweep failed:', err)),
        ).catch(() => {}),
      );
      // Intel watchlist sweep (person/vehicle/warrant) — alerts a watcher
      // when new activity, a status change, or an approaching expiration
      // hits one of their watched entities. This has existed since Phase 4
      // but was never actually wired into the cron until now.
      ctx.waitUntil(
        import('./utils/intelWatchlist').then((m) =>
          m.sweepWatchlist(env.DB).then((count) => {
            if (count > 0) console.log(`[intel-watchlist] fired ${count} alert(s)`);
          }).catch((err) => console.error('Intel watchlist sweep failed:', err)),
        ).catch(() => {}),
      );
      // Daily tasks at 04:00 America/Denver. The cron fires every minute, so
      // gate on BOTH Denver hour == 4 AND minute == 0 — an hour-only gate
      // (the original approach) still fires ~60x during that hour. Harmless
      // for the idempotent runDailyRebalance, but the notification sweeps
      // below are NOT idempotent (fireRule inserts a fresh notifications row
      // every call, no dedup) — an hour-only gate spammed ~60 duplicate
      // notifications per matching record per targeted user per day.
      const denverNow = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
      // hour12:false yields '24' at midnight in some ICU builds (see
      // src/utils/dailyReport/dates.ts's tzOffsetMs for the same guard) —
      // without % 24, denverHour would be 24 at midnight and the blotter's
      // `denverHour === 0` gate below would silently never fire, forever.
      const denverHour = parseInt(denverNow.find((p) => p.type === 'hour')?.value ?? '-1', 10) % 24;
      const denverMinute = parseInt(denverNow.find((p) => p.type === 'minute')?.value ?? '-1', 10);
      if (denverHour === 4 && denverMinute === 0) {
        ctx.waitUntil(
          import('./utils/serveRebalance').then((m) => {
            const nowIso = new Date().toISOString();
            return m.runDailyRebalance(env.DB, nowIso).then((r) =>
              console.log(`[rebalance] tiers=${r.tiers_recomputed} critical=${r.tiers_promoted_critical} escalated=${r.priority_escalated}`),
            ).catch((err) => console.error('Daily rebalance failed:', err));
          }).catch(() => {}),
        );
        // Fleet maintenance reminders — nobody has to remember to check the
        // maintenance schedule dashboard; fires via the notification-rule
        // engine (no-op until a rule with trigger_event='fleet_maintenance_due'
        // is configured in the admin notification-rules UI).
        ctx.waitUntil(
          import('./utils/fleetMaintenanceSweep').then((m) =>
            m.sweepFleetMaintenanceReminders(env.DB, env).then((r) =>
              console.log(`[fleet-maintenance] overdue=${r.overdue} critical=${r.critical} notified=${r.notified}`),
            ).catch((err) => console.error('Fleet maintenance sweep failed:', err)),
          ).catch(() => {}),
        );
        // Officer certification expiration reminders — same on-demand-
        // dashboard-only gap fleet maintenance had; no-ops until a rule
        // with trigger_event='certification_expiring' is configured.
        ctx.waitUntil(
          import('./utils/certExpirationSweep').then((m) =>
            m.sweepCertExpirations(env.DB, env).then((r) =>
              console.log(`[cert-expiration] expired=${r.expired} expiringSoon=${r.expiringSoon} notified=${r.notified}`),
            ).catch((err) => console.error('Certification expiration sweep failed:', err)),
          ).catch(() => {}),
        );
        // Serve queue stale auto-close — src/routes/serveQueueEnhanced.ts's
        // POST /auto-close-stale has existed as an admin tool with zero
        // client callers anywhere; nothing ever invoked it. Reuses its exact
        // logic (30-day stale window, same activity_log entry) as a real
        // daily automation (not just a reminder, since a status flip to
        // 'failed' is fully reversible and the route's own design already
        // represents "just close these out") plus a notification via the
        // existing engine so staff see it happened.
        ctx.waitUntil(
          import('./utils/serveStaleAutoCloseSweep').then((m) =>
            m.sweepStaleServeJobs(env.DB, env).then((r) => {
              if (r.closed > 0) console.log(`[serve-auto-close] closed=${r.closed}`);
            }).catch((err) => console.error('Serve stale auto-close sweep failed:', err)),
          ).catch(() => {}),
        );
        // Shift Plans understaffed/no-plan reminders — same on-demand-
        // dashboard-only gap fleet maintenance and cert expirations had;
        // fires via the notification-rule engine (2026-08-08 comms
        // integration spec). Rules shift_understaffed/shift_no_active_plan
        // are seeded active by default (migration 0228).
        ctx.waitUntil(
          import('./utils/shiftPlanNotifySweep').then((m) =>
            m.sweepShiftPlanNotifications(env.DB, env).then((r) =>
              console.log(`[shift-plan-notify] understaffed=${r.understaffed} noPlan=${r.noPlan} notified=${r.notified}`),
            ).catch((err) => console.error('Shift plan notification sweep failed:', err)),
          ).catch(() => {}),
        );
        // Shift swap escalation reminders — a swap stuck awaiting target
        // response or supervisor approval for 24+ hours notifies
        // admin/manager (2026-08-08 approval-workflow spec). Rule
        // shift_swap_escalated is seeded active by default (migration 0229).
        ctx.waitUntil(
          import('./utils/shiftSwapEscalationSweep').then((m) =>
            m.sweepShiftSwapEscalations(env.DB, env).then((r) =>
              console.log(`[shift-swap-escalation] escalated=${r.escalated} notified=${r.notified}`),
            ).catch((err) => console.error('Shift swap escalation sweep failed:', err)),
          ).catch(() => {}),
        );
      }

      // Daily blotter at 00:05 America/Denver. Same hour+minute gate as the
      // 04:00 tasks above — an hour-only gate would fire ~60x. Self-contained
      // try/catch so a blotter failure cannot abort the rest of the cron.
      if (denverHour === 0 && denverMinute === 5) {
        ctx.waitUntil(
          (async () => {
            if (!env.DOWNLOADS) {
              console.warn('[blotter] DOWNLOADS bucket unbound; skipping nightly run');
              return;
            }
            const { runNightlyBlotter } = await import('./utils/dailyReport/nightly');
            const res = await runNightlyBlotter(env.DB, env.DOWNLOADS, Date.now());
            console.log(`[blotter] generated=${res.generated.join(',') || 'none'} skipped=${res.skipped.length}`);
          })().catch((err) => {
            console.error('[blotter] nightly run failed:', err);
            logErrorToDb(env.DB, {
              severity: 'error',
              category: 'cron',
              message: err instanceof Error ? err.message : String(err),
              source: 'scheduled:daily-blotter',
            }, ctx);
          }),
        );
      }
    }

    // ── 1st of month, 03:00 UTC ──
    // NOTE: the schedule comment above has long documented this slot as
    // "NHTSA vPIC refresh," but no such logic was ever implemented here —
    // this cron fired every month and did nothing. Using it now for the
    // records-retention reminder (a monthly cadence fits a 10-99 year
    // retention window far better than the per-minute/4-hourly slots).
    // The NHTSA vPIC refresh itself remains unbuilt — flagging separately
    // rather than guessing at that integration's shape.
    if (event.cron === '0 3 1 * *') {
      ctx.waitUntil(
        import('./utils/retentionReminderSweep').then((m) =>
          m.sweepRetentionReminders(env.DB, env).then((r) =>
            console.log(`[retention-reminder] eligible=${JSON.stringify(r.eligible)} notified=${r.notified}`),
          ).catch((err) => console.error('Retention reminder sweep failed:', err)),
        ).catch(() => {}),
      );
    }

    // ── Nightly, 09:00 UTC (02:00/03:00 Denver, after the day is fully closed) ──
    // Driver Performance nightly rollup. Recomputes the TRAILING 3 DAYS,
    // not just yesterday: late-arriving ClearPath events and assignment
    // corrections are routine, and a 3-day window absorbs them without a
    // manual recompute. Upserts are idempotent, so re-running is safe.
    if (event.cron === '0 9 * * *') {
      ctx.waitUntil(
        import('./utils/driverPerformance/rollup').then(async (m) => {
          for (let back = 1; back <= 3; back++) {
            const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
            try {
              const r = await m.rollupDay(env.DB, day);
              log.info('driver-performance rollup complete', {
                day, officersProcessed: r.officersProcessed, failures: r.failures,
              });
            } catch (err) {
              // One bad day must not abort the other two. Greppable so an
              // operator can find exactly which perf_date needs a manual
              // POST /api/driver-performance/recompute — perf_date is
              // unambiguous in the context object (single ISO date, no
              // other date-shaped keys nearby).
              log.error(
                `driver-performance rollup failed for perf_date=${day} — manual recompute required via POST /api/driver-performance/recompute`,
                { perf_date: day },
                err as Error,
              );
            }
          }
        }).catch((err) => log.error('driver-performance rollup import failed', {}, err as Error)),
      );

      // serve_routes revision retention. POST /api/process-server/routes is
      // append-only so a re-planned day keeps its full revision history; this
      // collapses the superseded revisions once they age past the window,
      // while keeping the newest row per (officer, date) forever. Separate
      // waitUntil so a failure here can't take the rollup down with it.
      ctx.waitUntil(
        import('./utils/serveRouteRetention').then((m) =>
          m.sweepServeRouteRevisions(env.DB).then((r) =>
            log.info('serve-routes revision sweep complete', { deleted: r.deleted, cutoff: r.cutoff }),
          ),
        ).catch((err) => log.error('serve-routes revision sweep failed', {}, err as Error)),
      );
    }
  },
};
