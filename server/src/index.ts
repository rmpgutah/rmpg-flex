// Set timezone BEFORE any Date operations — uses system setting or env var
// This ensures all new Date() calls and SQLite datetime('now','localtime') use local time
process.env.TZ = process.env.SERVER_TIMEZONE || 'America/Denver';

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import config from './config';
import { initDatabase } from './models/database';
import { initWebSocket, getConnectedUsers, getConnectedClientCount } from './utils/websocket';
import { securityHeaders } from './middleware/securityHeaders';
import { sanitizeInput } from './middleware/sanitize';
import { apiRateLimit } from './middleware/rateLimiter';
import { liveBroadcast } from './middleware/liveBroadcast';
import { startPatrolMonitor } from './utils/patrolMonitor';
import { startDailyReportScheduler } from './utils/dailyReportGenerator';
import { scheduleOfacSync, searchOfacLocal } from './utils/ofacScraper';
import { startHealthChecker } from './utils/integrationHealthChecker';
import { scheduleUtahWarrantSync } from './utils/utahWarrantScraper';
import { scheduleArrestSync } from './utils/arrestScraper';
import { scheduleWarrantScraper } from './utils/multiStateWarrantScraper';
import { runScraperNightly } from './utils/scraperNightlyJob';
import { getDb } from './models/database';
import { logger, httpLogger } from './utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version — prefer CHANGELOG.json (canonical), fall back to package.json
let SERVER_VERSION = '0.0.0';
try {
  const changelog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../CHANGELOG.json'), 'utf-8'));
  SERVER_VERSION = changelog.version || '0.0.0';
} catch {
  try {
    const serverPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
    SERVER_VERSION = serverPkg.version || '0.0.0';
  } catch { /* use default */ }
}

// Import routes
import authRoutes from './routes/auth';
import dispatchRoutes from './routes/dispatch';
import incidentRoutes from './routes/incidents';
import recordsRoutes from './routes/records';
import personnelRoutes, { mountScheduleRoutes } from './routes/personnel';
import commsRoutes from './routes/comms';
import reportsRoutes from './routes/reports';
import adminRoutes from './routes/admin';
import uploadRoutes from './routes/uploads';
import systemConfigRoutes from './routes/systemConfig';
import auditRoutes from './routes/audit';
import patrolRoutes from './routes/patrol';
import warrantRoutes from './routes/warrants';
import fleetRoutes from './routes/fleet';
import notificationRoutes from './routes/notifications';
import statuteRoutes from './routes/statutes';
import citationRoutes from './routes/citations';
import invoiceRoutes from './routes/invoices';
import adminSystemsRoutes from './routes/adminSystems';
import shiftPlanRoutes from './routes/shiftPlans';
import downloadsRoutes, { mountDownloadFileRoute } from './routes/downloads';
import serveManagerRoutes from './routes/servemanager';
import serveIntakeRoutes from './routes/serveIntake';
import microbiltRoutes from './routes/microbilt';
import dlRecordRoutes from './routes/dlRecords';
import fieldInterviewRoutes from './routes/fieldInterviews';
import trespassOrderRoutes from './routes/trespassOrders';
import mobileCfsRoutes from './routes/mobileCfs';
import caseRoutes from './routes/cases';
import codeEnforcementRoutes from './routes/codeEnforcement';
import courtRoutes from './routes/court';
import darRoutes from './routes/dar';
import offenderRegistryRoutes from './routes/offenderRegistry';
import offlineRoutes from './routes/offline';
import companyDocumentsRoutes from './routes/companyDocuments';
import documentFoldersRoutes from './routes/documentFolders';
import forensicsRoutes from './routes/forensics';
import ipedRoutes from './routes/iped';
import clearpathgpsRoutes from './routes/clearpathgps';
import integrationsRoutes from './routes/integrations';
import intakeRoutes from './routes/intake';
import emailRoutes from './routes/email';
import emailRulesRoutes from './routes/emailRules';
import skiptracerRoutes from './routes/skiptracer';
import arrestRoutes from './routes/arrests';
import connectionsRoutes from './routes/connections';
import dashcamVideoRoutes from './routes/dashcamVideos';
import coloradoDocRoutes from './routes/coloradoDoc';
import sexOffenderRegistryRoutes from './routes/sexOffenderRegistry';
import crmRoutes from './routes/crm';
import crmLeadsRoutes from './routes/crmLeads';
import crmProposalsRoutes from './routes/crmProposals';
import crmFirecrawlRoutes from './routes/crmFirecrawl';
import userPreferencesRoutes from './routes/userPreferences';
import serveRoutes from './routes/serve';
import hrRoutes from './routes/hr';
import securityDashboardRoutes from './routes/securityDashboard';
import webauthnRoutes from './routes/webauthn';
import jailRosterRoutes from './routes/jailRoster';
import mapSafetyRoutes from './routes/mapSafety';
import mapGeofenceRoutes from './routes/mapGeofences';
import webResearchRoutes from './routes/webResearch';
import skiptracerV2Routes from './routes/skiptracer-v2';
import ttsRoutes from './routes/tts';
import voiceRoutes from './routes/voice';
import voicePersonaRoutes from './routes/voicePersona';
import aiRoutes from './routes/ai';
import aiDevChatRoutes from './routes/aiDevChat';
import firecrawlToolsRoutes from './routes/firecrawlTools';
import geocodeRoutes from './routes/geocode';
import { authenticateToken } from './middleware/auth';
import { checkWelfareWatches } from './utils/officerWelfare';
import { generatePursuitUpdates } from './utils/pursuitTracker';

const app = express();

// ─── Reverse-proxy trust ─────────────────────────────
// In production we sit behind nginx (which sets X-Forwarded-For). Without
// `trust proxy = 1`, express-rate-limit raises ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// and req.ip resolves to 127.0.0.1, defeating per-IP rate-limiting.
// Value `1` trusts EXACTLY one proxy hop — clients cannot spoof their IP
// by stuffing X-Forwarded-For (which `true` would allow).
app.set('trust proxy', 1);

// ─── Domain Redirect (www → apex) ────────────────────
// In production, redirect www.rmpgutah.us → rmpgutah.us for canonical URLs
if (config.isProduction || config.ssl.enabled) {
  app.use((req, res, next) => {
    const host = req.hostname || req.headers.host?.split(':')[0] || '';
    if (host === `www.${config.primaryDomain}`) {
      const protocol = config.ssl.enabled ? 'https' : req.protocol;
      const port = config.ssl.enabled && config.httpsPort !== 443 ? `:${config.httpsPort}` : '';
      return res.redirect(301, `${protocol}://${config.primaryDomain}${port}${req.originalUrl}`);
    }
    next();
  });
}

// ─── Security Middleware ─────────────────────────────
app.use(securityHeaders);
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInput);

// Structured logging + per-request X-Request-Id tracing via pino-http.
// Replaces the prior timestamp+random-suffix scheme with crypto.randomUUID().
// Attaches req.log (child logger carrying request ID) for downstream handlers.
app.use(httpLogger);

// Fix 72: Add response compression for large GeoJSON payloads
// Using built-in compression by setting headers — actual compression handled by reverse proxy in production
app.use((req, res, next) => {
  // Fix 71: Add CORS headers for map tile requests
  if (req.path.startsWith('/tiles/')) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache tiles for 24h
  }
  next();
});

// ─── Request Timeout Middleware ────────────────────────
// Protect against hung requests — 30s for API, 600s for uploads
app.use((req, res, next) => {
  const isUpload = req.path.startsWith('/api/uploads') || req.path.startsWith('/api/fleet/dashcam-videos');
  const timeout = isUpload ? 600000 : 30000; // 10min for uploads, 30s for API
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
});

// Apply rate limiting to API routes
app.use('/api', apiRateLimit);

// ─── Health Check ─────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'RMPG Flex CAD/RMS Server',
    version: SERVER_VERSION,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
    features: {
      rateLimiting: true,
      securityHeaders: true,
      inputSanitization: true,
      tokenRefresh: true,
      sessionManagement: true,
      accountLockout: true,
      passwordPolicy: true,
      fileUpload: true,
      warrants: true,
      fleetManagement: true,
      notifications: true,
      csvExport: true,
      sslEncryption: config.ssl.enabled,
      wsAuthentication: true,
      liveSync: true,
    },
  });
});

// ─── Weather Proxy ────────────────────────────────────
// Proxies Open-Meteo API to avoid browser CSP/CORS issues
let weatherCache: { data: any; fetchedAt: number } | null = null;
const WEATHER_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

app.get('/api/weather', async (_req, res) => {
  try {
    // Return cached data if fresh
    if (weatherCache && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_TTL) {
      res.json(weatherCache.data);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=40.7608&longitude=-111.891&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Denver',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resp.ok) { res.status(502).json({ error: 'Weather API returned ' + resp.status }); return; }
    const data = await resp.json();
    weatherCache = { data, fetchedAt: Date.now() };
    res.json(data);
  } catch (err: any) {
    // Return stale cache if available
    if (weatherCache) { res.json(weatherCache.data); return; }
    res.status(502).json({ error: 'Weather API unavailable' });
  }
});

// Fix 75: Health check endpoint for map subsystem
app.get('/api/health/map', (_req, res) => {
  try {
    const db = getDb();
    const callCount = db.prepare('SELECT COUNT(*) as cnt FROM calls_for_service WHERE latitude IS NOT NULL').get() as any;
    const unitCount = db.prepare('SELECT COUNT(*) as cnt FROM units WHERE latitude IS NOT NULL').get() as any;
    let geofenceCount = { cnt: 0 };
    try { geofenceCount = db.prepare('SELECT COUNT(*) as cnt FROM geofences WHERE is_active = 1').get() as any; } catch { /* table may not exist */ }
    let breadcrumbCount = { cnt: 0 };
    try { breadcrumbCount = db.prepare('SELECT COUNT(*) as cnt FROM gps_breadcrumbs').get() as any; } catch { /* table may not exist */ }

    res.json({
      status: 'ok',
      subsystem: 'map',
      geocoded_calls: callCount?.cnt || 0,
      positioned_units: unitCount?.cnt || 0,
      active_geofences: geofenceCount?.cnt || 0,
      breadcrumb_records: breadcrumbCount?.cnt || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', subsystem: 'map', error: err?.message || 'Unknown' });
  }
});

// Fix 76: Feature flag support
app.get('/api/features', (_req, res) => {
  try {
    const db = getDb();
    // Load feature flags from system_config if available
    let flags: Record<string, boolean> = {
      heatmap: true,
      gps_tracking: true,
      geofences: true,
      safety_analysis: true,
      corridor_analysis: true,
      predictive_hotspots: true,
      coverage_gaps: true,
      lighting_conditions: true,
    };
    try {
      const configRow = db.prepare("SELECT value FROM system_config WHERE key = 'feature_flags'").get() as any;
      if (configRow?.value) {
        const parsed = JSON.parse(configRow.value);
        flags = { ...flags, ...parsed };
      }
    } catch { /* use defaults */ }
    res.json(flags);
  } catch {
    res.status(500).json({ error: 'Failed to load feature flags' });
  }
});

// ─── Presence Endpoint ───────────────────────────────
app.get('/api/presence', (_req, res) => {
  const users = getConnectedUsers();
  res.json({ users, count: users.length, connections: getConnectedClientCount() });
});

// ── Feature 25: System status page (public) ────────────────────
app.get('/api/system-status', (_req, res) => {
  try {
    const db = getDb();
    const uptime = process.uptime();

    // Check DB
    let dbStatus = 'ok';
    try { db.prepare('SELECT 1').get(); } catch { dbStatus = 'error'; }

    // WebSocket status
    const wsConnections = getConnectedClientCount();

    // Last deploy (from package.json version change or build time)
    const startTime = new Date(Date.now() - uptime * 1000).toISOString();

    res.json({
      status: dbStatus === 'ok' ? 'operational' : 'degraded',
      api: { status: 'ok', response_time_ms: 0 },
      database: { status: dbStatus },
      websocket: { status: wsConnections >= 0 ? 'ok' : 'error', connections: wsConnections },
      server: {
        version: SERVER_VERSION,
        uptime_seconds: Math.round(uptime),
        started_at: startTime,
        environment: config.nodeEnv,
      },
    });
  } catch (error: any) {
    res.json({ status: 'error', error: error.message });
  }
});

// ─── Live Broadcast Middleware ────────────────────────
// Auto-broadcasts WebSocket events on all successful data mutations
// so every connected device sees changes in real-time
app.use(liveBroadcast);

// ─── OwnTracks/Traccar GPS webhook — own auth (shared secret), no JWT ───
// NOTE: Do NOT mount this router at '/api/dispatch/gps' — that prefix shadows
// the authenticated GPS endpoint in dispatchRoutes (POST /api/dispatch/gps),
// causing Express to match the webhook's '/' handler first and reject every
// JWT-authenticated request with 403 "Invalid webhook token".
// The '/owntracks' mount below is the supported path for the OwnTracks app;
// internal subpaths like '/owntracks/:user/:device' remain available there.
import { owntracksWebhookRouter } from './routes/dispatch/gps';
app.use('/owntracks', owntracksWebhookRouter);

// ─── API Routes ───────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/comms', commsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin', systemConfigRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/patrol', patrolRoutes);
app.use('/api/warrants', warrantRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/statutes', statuteRoutes);
app.use('/api/citations', citationRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/admin', adminSystemsRoutes);
app.use('/api/admin', shiftPlanRoutes);
app.use('/api/downloads', downloadsRoutes);
app.use('/api/updates', downloadsRoutes);
app.use('/api/servemanager', serveManagerRoutes);
app.use('/api/serve-intake', serveIntakeRoutes);
app.use('/api/microbilt', microbiltRoutes);
app.use('/api/dl-records', dlRecordRoutes);
app.use('/api/field-interviews', fieldInterviewRoutes);
app.use('/api/trespass-orders', trespassOrderRoutes);
app.use('/api', mobileCfsRoutes); // Mounts /api/cfs/:id/qr-token, /api/mobile/cfs/*
app.use('/api/cases', caseRoutes);
app.use('/api/code-enforcement', codeEnforcementRoutes);
app.use('/api/court', courtRoutes);
app.use('/api/dar', darRoutes);
app.use('/api/offender-registry', offenderRegistryRoutes);
app.use('/api/offline', offlineRoutes);
app.use('/api/company-documents', companyDocumentsRoutes);
app.use('/api/documents', documentFoldersRoutes);
app.use('/api/forensic-lab', forensicsRoutes);
app.use('/api/forensics', forensicsRoutes);
app.use('/api/iped', ipedRoutes);
app.use('/api/clearpathgps', clearpathgpsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/email/rules', emailRulesRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/skiptracer', skiptracerRoutes);
app.use('/api/arrests', arrestRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/fleet/dashcam-videos', dashcamVideoRoutes);
app.use('/api/colorado-doc', coloradoDocRoutes);
app.use('/api/sex-offender-registry', sexOffenderRegistryRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/crm', crmLeadsRoutes);
app.use('/api/crm', crmProposalsRoutes);
app.use('/api/crm', crmFirecrawlRoutes);
app.use('/api/user/preferences', authenticateToken, userPreferencesRoutes);
app.use('/api/process-server', serveRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/auth/security', securityDashboardRoutes);
app.use('/api/auth/webauthn', webauthnRoutes);
app.use('/api/jail-roster', jailRosterRoutes);
app.use('/api/map/safety', mapSafetyRoutes);
app.use('/api/map/geofences', mapGeofenceRoutes);
app.use('/api/web-research', webResearchRoutes);
app.use('/api/skiptracer-v2', skiptracerV2Routes);
app.use('/api/tts', ttsRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/voice-persona', voicePersonaRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai/dev-chat', aiDevChatRoutes);
app.use('/api/firecrawl-tools', firecrawlToolsRoutes);
app.use('/api/geocode', geocodeRoutes);
app.use('/dispatch', intakeRoutes);        // Public dispatch endpoint (called by rmpgutahps.us)
app.use('/intake', intakeRoutes);          // Legacy alias
app.use('/api/intake', intakeRoutes);      // Also available under /api prefix

// Mount download page and file serving routes (outside /api)
// Also mounts /updates/latest.yml, /updates/latest-mac.yml for electron-updater
mountDownloadFileRoute(app);

// Mount schedule/time/credential routes directly on the app
// These are mounted separately to avoid /:id route conflicts in the personnel router
const apiRouter = express.Router();
mountScheduleRoutes(apiRouter);
app.use('/api', apiRouter);

// ─── Serve static files in production ─────────────────
const clientDistPath = path.resolve(__dirname, '../../client/dist');

// No-cache for sw.js and index.html — browser must always check server
app.get('/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(clientDistPath, 'sw.js'));
});
app.get('/index.html', (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Hashed assets (/assets/*) — long cache (immutable, hash changes on content change)
app.use('/assets', express.static(path.join(clientDistPath, 'assets'), {
  maxAge: '1y',
  immutable: true,
}));

// Everything else — short cache
app.use(express.static(clientDistPath, {
  maxAge: '5m',
}));

// Force-refresh page — clears SW cache and reloads the app
app.get('/force-refresh', (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`<!DOCTYPE html><html><head><title>RMPG Flex — Refreshing...</title>
<style>body{background:#0a0a0a;color:#d4a017;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column}
h1{font-size:24px;margin-bottom:12px}p{color:#888;font-size:14px}</style></head><body>
<h1>Clearing cache...</h1><p>Please wait — the app will reload automatically.</p>
<script>
(async()=>{
  if('serviceWorker' in navigator){
    const regs=await navigator.serviceWorker.getRegistrations();
    for(const r of regs) await r.unregister();
  }
  const keys=await caches.keys();
  for(const k of keys) await caches.delete(k);
  setTimeout(()=>{ window.location.href='/'; },1500);
})();
</script></body></html>`);
});

// SPA fallback: serve index.html for non-API, non-download routes (always fresh).
// Express 5 + path-to-regexp v8 require named wildcards — bare '*' throws at boot.
app.get('/*splat', apiRateLimit, (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'API endpoint not found' });
  } else if (req.path.startsWith('/downloads/') || req.path === '/download') {
    // Already handled by download routes — if we get here, 404
    res.status(404).json({ error: 'Not found' });
  } else {
    // Force no-cache on SPA fallback to ensure fresh JS bundle references
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  }
});

// ─── Global Error Handler ────────────────────────────
// Catches unhandled middleware errors (multer, body-parser, etc.)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // req.log is the pino child logger attached by httpLogger; it already
  // carries the request ID, method, and url, so just pass the error.
  (req as any).log?.error({ err }, 'unhandled express error') ?? logger.error({ err, method: req.method, path: req.path }, 'unhandled express error');
  if (!res.headersSent) {
    const status = err?.status || err?.statusCode || 500;
    res.status(status).json({ error: err?.message || 'Internal server error' });
  }
});

// ─── Initialize and Start ─────────────────────────────
try {
  // Initialize database
  initDatabase();
  logger.info('database initialized');

  // Set SQLite query timeout for long-running queries (30 seconds)
  try {
    const db = getDb();
    db.pragma('busy_timeout = 30000');
    logger.info('SQLite busy_timeout set to 30000ms');
  } catch (e: any) {
    logger.warn({ err: e }, 'could not set SQLite busy_timeout');
  }

  // Database migration versioning check on startup
  try {
    const db = getDb();
    // Ensure migration_version table exists
    db.prepare(`CREATE TABLE IF NOT EXISTS migration_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0,
      last_migrated_at TEXT
    )`).run();
    const versionRow = db.prepare('SELECT version FROM migration_version WHERE id = 1').get() as any;
    if (!versionRow) {
      db.prepare("INSERT INTO migration_version (id, version, last_migrated_at) VALUES (1, 1, datetime('now','localtime'))").run();
      logger.info('database migration version initialized: v1');
    } else {
      logger.info({ version: versionRow.version }, 'database migration version loaded');
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'migration version check skipped');
  }

  // Determine server type based on SSL availability
  let primaryServer: http.Server | https.Server;

  if (config.ssl.enabled && config.ssl.cert && config.ssl.key) {
    // ─── HTTPS Mode ─────────────────────────────────
    const sslOptions: https.ServerOptions = {
      cert: config.ssl.cert,
      key: config.ssl.key,
      // Strong TLS configuration
      minVersion: 'TLSv1.2' as any,
    };

    primaryServer = https.createServer(sslOptions, app);

    // HTTP → HTTPS redirect server (also normalises www → apex)
    if (config.ssl.httpRedirect) {
      const redirectApp = express();
      redirectApp.use((req, res) => {
        let host = req.headers.host?.replace(`:${config.ssl.httpRedirectPort}`, '') || config.primaryDomain;
        // Normalise www to apex domain
        if (host.startsWith('www.')) {
          host = host.slice(4);
        }
        const httpsPort = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
        res.redirect(301, `https://${host}${httpsPort}${req.url}`);
      });
      const redirectServer = http.createServer(redirectApp);
      redirectServer.listen(config.ssl.httpRedirectPort, () => {
        logger.info({ port: config.ssl.httpRedirectPort }, 'HTTP→HTTPS redirect active');
      });
    }
  } else {
    // ─── HTTP Mode (development / no certs) ────────
    primaryServer = http.createServer(app);
  }

  // Initialize WebSocket on the primary server
  initWebSocket(primaryServer);
  logger.info('WebSocket server initialized');

  // Start listening
  const listenPort = config.ssl.enabled ? config.httpsPort : config.port;
  const listenHost = process.env.HOST || '0.0.0.0'; // Bind to all interfaces for LAN access
  const protocol = config.ssl.enabled ? 'https' : 'http';
  const wsProtocol = config.ssl.enabled ? 'wss' : 'ws';

  const displayHost = config.isProduction ? config.primaryDomain : 'localhost';

  // Increase timeouts for large file uploads (body cam video — up to 2 GB)
  primaryServer.requestTimeout = 600000;   // 10 min
  primaryServer.headersTimeout = 120000;   // 2 min for headers
  primaryServer.keepAliveTimeout = 120000; // 2 min keepalive

  primaryServer.listen(listenPort, listenHost, () => {
    // Structured one-liner for log aggregation (prod journalctl / search tools).
    logger.info(
      {
        version: SERVER_VERSION,
        env: config.nodeEnv,
        domain: config.primaryDomain,
        protocol,
        port: listenPort,
        ssl: config.ssl.enabled,
      },
      'server listening'
    );
    // Decorative ASCII banner stays on console (human-read, one-shot at boot).
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log(`║         RMPG Flex CAD/RMS Server v${SERVER_VERSION.padEnd(14)}║`);
    console.log('║                                                  ║');
    console.log(`║  Environment: ${config.nodeEnv.padEnd(35)}║`);
    console.log(`║  Domain:      ${config.primaryDomain.padEnd(35)}║`);
    console.log(`║  ${config.ssl.enabled ? 'HTTPS' : 'HTTP'} Server: ${protocol}://${displayHost}:${String(listenPort).padEnd(1)}║`);
    console.log(`║  WebSocket:   ${wsProtocol}://${displayHost}:${String(listenPort).padEnd(1)}║`);
    console.log(`║  TLS/SSL:     ${(config.ssl.enabled ? 'ENABLED (TLSv1.2+)' : 'DISABLED').padEnd(35)}║`);
    console.log('║  API Base:    /api                               ║');
    console.log('║                                                  ║');
    console.log('║  Endpoints:                                      ║');
    console.log('║    /api/auth       - Authentication              ║');
    console.log('║    /api/dispatch   - CAD / Dispatch              ║');
    console.log('║    /api/incidents  - Incident Reports            ║');
    console.log('║    /api/records    - Records Management          ║');
    console.log('║    /api/personnel  - Personnel & Scheduling      ║');
    console.log('║    /api/comms      - Communications & BOLOs      ║');
    console.log('║    /api/reports    - Reports & Analytics         ║');
    console.log('║    /api/audit      - Audit Trail                 ║');
    console.log('║    /api/patrol     - Patrol Checkpoints          ║');
    console.log('║    /api/uploads    - File Attachments            ║');
    console.log('║    /api/admin      - Administration              ║');
    console.log('║    /api/warrants   - Warrants                    ║');
    console.log('║    /api/fleet      - Fleet Management            ║');
    console.log('║    /api/notifications - Notifications            ║');
    console.log('║    /api/citations  - Citations / Summons          ║');
    console.log('║    /api/invoices   - Invoice Management           ║');
    console.log('║    /api/servemanager - ServeManager               ║');
    console.log('║    /api/health     - Health Check                ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    // Start patrol monitor for missed scan alerts
    try {
      startPatrolMonitor(5 * 60 * 1000); // Check every 5 minutes
    } catch (err: any) {
      logger.warn({ err, scheduler: 'patrol-monitor' }, 'failed to start scheduler');
    }

    // Start midnight daily patrol report scheduler
    try {
      startDailyReportScheduler();
    } catch (err: any) {
      logger.warn({ err, scheduler: 'daily-report' }, 'failed to start scheduler');
    }

    // Start OFAC SDN data sync (downloads from U.S. Treasury, syncs daily)
    try {
      scheduleOfacSync();
    } catch (err: any) {
      logger.warn({ err, scheduler: 'ofac-sync' }, 'failed to start scheduler');
    }

    // Start integration health checker (probes every 5 min, alerts on status changes)
    try {
      startHealthChecker();
    } catch (err: any) {
      logger.warn({ err, scheduler: 'health-checker' }, 'failed to start scheduler');
    }

    // Start Utah warrant sync scheduler (live search + automated bulk scan every 4h)
    try {
      scheduleUtahWarrantSync();
    } catch (err: any) {
      logger.warn({ err, scheduler: 'utah-warrants' }, 'failed to start scheduler');
    }

    // Start arrest records auto-sync (JailBase API, hourly with exponential backoff)
    try {
      scheduleArrestSync();
      logger.info({ scheduler: 'arrests' }, 'auto-sync scheduler started');
    } catch (err: any) {
      logger.warn({ err, scheduler: 'arrests' }, 'failed to start sync scheduler');
    }

    // Start multi-state warrant scraper (polls configured sources on schedule)
    try {
      scheduleWarrantScraper();
    } catch (err: any) {
      logger.warn({ err, scheduler: 'warrant-scraper' }, 'failed to start scheduler');
    }

    // Nightly warrant scraper maintenance
    try {
      // First run 6h after boot (lets scheduler settle)
      const nightlyInitial = setTimeout(() => runScraperNightly(), 6 * 60 * 60_000);
      if (nightlyInitial.unref) nightlyInitial.unref();

      // Then every 24h
      const nightlyInterval = setInterval(() => runScraperNightly(), 24 * 60 * 60_000);
      if (nightlyInterval.unref) nightlyInterval.unref();
    } catch (err: any) {
      logger.warn({ err, scheduler: 'scraper-nightly' }, 'failed to schedule');
    }

    // Voice system timers — welfare checks and pursuit updates every 30s
    setInterval(() => {
      try { checkWelfareWatches(); } catch (err: any) {
        logger.error({ err, source: 'welfare-timer' }, 'timer error');
      }
    }, 30_000);

    setInterval(() => {
      try { generatePursuitUpdates(); } catch (err: any) {
        logger.error({ err, source: 'pursuit-timer' }, 'timer error');
      }
    }, 30_000);

    // Auto-backfill OFAC screening for existing person records (runs 60s after boot
    // to allow OFAC data sync to complete first)
    setTimeout(() => {
      try {
        const db = getDb();
        const unchecked = db.prepare(
          'SELECT id, first_name, last_name FROM persons WHERE watchlist_checked_at IS NULL AND first_name IS NOT NULL AND last_name IS NOT NULL'
        ).all() as { id: number; first_name: string; last_name: string }[];

        if (unchecked.length > 0) {
          logger.info({ source: 'ofac-backfill', count: unchecked.length }, 'screening unchecked person records');
          let matches = 0;
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          for (const p of unchecked) {
            try {
              const hits = searchOfacLocal(`${p.last_name}, ${p.first_name}`, { type: 'person' as const, firstName: p.first_name, lastName: p.last_name, limit: 3 });
              const matchInfo = hits.length > 0
                ? JSON.stringify(hits.map((h: any) => ({ name: h.sdn_name, program: h.program, list: h.source_list })))
                : null;
              db.prepare('UPDATE persons SET watchlist_match = ?, watchlist_checked_at = ? WHERE id = ?').run(matchInfo, now, p.id);
              if (hits.length > 0) {
                matches++;
                // Create notification for matches
                try {
                  db.prepare(`INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, created_at) VALUES ('system', 'high', ?, ?, 'person', ?, ?)`)
                    .run(`OFAC WATCHLIST MATCH: ${p.first_name} ${p.last_name}`, `Person #${p.id} matches OFAC sanctions list`, p.id, now);
                } catch { /* notifications table may not exist */ }
              }
            } catch { /* skip individual failures */ }
          }
          logger.info({ source: 'ofac-backfill', screened: unchecked.length, matches }, 'backfill complete');
        } else {
          logger.info({ source: 'ofac-backfill' }, 'all person records already screened');
        }
      } catch (err) {
        logger.warn({ err, source: 'ofac-backfill' }, 'backfill failed');
      }
    }, 60_000); // 60s delay — after OFAC sync (15s) has time to complete
  });
} catch (error) {
  logger.fatal({ err: error }, 'failed to start server');
  process.exit(1);
}

// ─── Process-level crash protection ──────────────────────────
// Log unhandled errors instead of dying silently.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — server continuing, investigate immediately');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection — server continuing, investigate immediately');
});

// ─── Graceful Shutdown ────────────────────────────────
// Close server and database connections cleanly on SIGTERM/SIGINT
function gracefulShutdown(signal: string) {
  logger.info({ signal }, 'graceful shutdown initiated');
  const shutdownTimeout = setTimeout(() => {
    logger.error('shutdown timed out after 15s — forcing exit');
    process.exit(1);
  }, 15000);

  try {
    // Close the HTTP(S) server — stop accepting new connections
    // primaryServer is scoped in the try block above, so we use a module-level ref
    const db = getDb();
    if (db) {
      db.close();
      logger.info('database connection closed');
    }
  } catch (e: any) {
    logger.warn({ err: e }, 'shutdown cleanup error');
  }

  clearTimeout(shutdownTimeout);
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
