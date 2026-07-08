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
import { authMiddleware } from './middleware/auth';
import { handleWebSocket, sendToUser, broadcastAll } from './routes/ws';
import { WelfareWatchDO } from './durable-objects/WelfareWatchDO';
import { VoiceHubDO } from './durable-objects/VoiceHubDO';
import { AlertHubDO } from './durable-objects/AlertHubDO';
import { DeepResearchDO } from './durable-objects/DeepResearchDO';
import { PersonIntelDO } from './durable-objects/PersonIntelDO';
import { FlexCamRemuxDO } from './durable-objects/FlexCamRemuxDO';
import { PdfToolsContainer } from './containers/pdfToolsContainer';
import { detectDispatchAnomalies } from './routes/dispatch/anomalies';
import type { Bindings, Variables } from './types';
import { ROUTE_REGISTRY } from './routesConfig';
import { log } from './utils/logger';

// Export Durable Object classes so wrangler can find them at build time.
// The Container subclass extends DurableObject and is configured by
// [[containers]] + [[durable_objects.bindings]] in wrangler.toml.
export { WelfareWatchDO, VoiceHubDO, AlertHubDO, DeepResearchDO, PersonIntelDO, FlexCamRemuxDO, PdfToolsContainer };

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
  //   "*/30 * * * *"  every 30 min              → ServeManager job poller
  //   "0 3 1 * *"     1st of month 03:00 UTC    → NHTSA vPIC refresh
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    // ── Every 4 hours (UTC 00:00, 04:00, 08:00, 12:00, 16:00, 20:00) ──
    if (event.cron === '0 */4 * * *') {
      ctx.waitUntil(
        import('./utils/warrantSources/runScan').then((m) =>
          m.runAllSourceScans(env.DB).then((result) =>
            import('./utils/warrantSources/logScanResult').then((log) =>
              log.logScanResult(env.DB, result, 'cron').catch((err) =>
                console.error('scraper_runs logging failed:', err),
              ),
            ),
          ).catch((err) =>
            import('./utils/warrantSources/logScanResult').then((log) =>
              log.logOrchestratorFailure(env.DB, 'cron', err),
            ),
          ),
        ).catch(() => {}),
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
    }

    // ── Every 30 minutes ──
    if (event.cron === '*/30 * * * *') {
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
    }

    // ── Every minute ──
    if (event.cron === '* * * * *') {
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
      const denverHour = parseInt(denverNow.find((p) => p.type === 'hour')?.value ?? '-1', 10);
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
  },
};
