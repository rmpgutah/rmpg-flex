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
import compression from 'compression';
import { sanitizeInput } from './middleware/sanitize';
import { apiRateLimit } from './middleware/rateLimiter';
import { liveBroadcast } from './middleware/liveBroadcast';
import { startPatrolMonitor } from './utils/patrolMonitor';
import { startDailyReportScheduler } from './utils/dailyReportGenerator';
import { startTraccarPoller } from './utils/traccarPoller';
import { startClearPathGpsPoller } from './utils/clearPathGpsPoller';
import { startAnomalyDetector } from './utils/anomalyDetector';

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
import microbiltRoutes from './routes/microbilt';
import traccarRoutes from './routes/traccar';
import clearPathGpsRoutes from './routes/clearpathgps';
import dashcamVideoRoutes from './routes/dashcamVideos';
import fieldInterviewRoutes from './routes/fieldInterviews';
import trespassOrderRoutes from './routes/trespassOrders';
import caseRoutes from './routes/cases';
import codeEnforcementRoutes from './routes/codeEnforcement';
import courtRoutes from './routes/court';
import darRoutes from './routes/dar';
import offenderRegistryRoutes from './routes/offenderRegistry';
import offlineRoutes from './routes/offline';
import companyDocumentsRoutes from './routes/companyDocuments';

const app = express();

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
app.use(compression({ level: 6, threshold: 1024 })); // gzip responses > 1KB
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(sanitizeInput);

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

// ─── Presence Endpoint ───────────────────────────────
app.get('/api/presence', (_req, res) => {
  const users = getConnectedUsers();
  res.json({ users, count: users.length, connections: getConnectedClientCount() });
});

// ─── Live Broadcast Middleware ────────────────────────
// Auto-broadcasts WebSocket events on all successful data mutations
// so every connected device sees changes in real-time
app.use(liveBroadcast);

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
app.use('/api/microbilt', microbiltRoutes);
app.use('/api/traccar', traccarRoutes);
app.use('/api/clearpathgps', clearPathGpsRoutes);
app.use('/api', dashcamVideoRoutes);
app.use('/api/field-interviews', fieldInterviewRoutes);
app.use('/api/trespass-orders', trespassOrderRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/code-enforcement', codeEnforcementRoutes);
app.use('/api/court', courtRoutes);
app.use('/api/dar', darRoutes);
app.use('/api/offender-registry', offenderRegistryRoutes);
app.use('/api/offline', offlineRoutes);
app.use('/api/company-documents', companyDocumentsRoutes);

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

// SPA fallback: serve index.html for non-API, non-download routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'API endpoint not found' });
  } else if (req.path.startsWith('/downloads/') || req.path === '/download') {
    // Already handled by download routes — if we get here, 404
    res.status(404).json({ error: 'Not found' });
  } else {
    res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  }
});

// ─── Global Error Handler ────────────────────────────
// Catches unhandled middleware errors (multer, body-parser, etc.)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled Express error:', err?.message || err, err?.stack || '');
  if (!res.headersSent) {
    res.status(500).json({ error: err?.message || 'Internal server error' });
  }
});

// ─── Initialize and Start ─────────────────────────────
try {
  // Initialize database
  initDatabase();
  console.log('Database initialized');

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
        console.log(`HTTP→HTTPS redirect active on port ${config.ssl.httpRedirectPort}`);
      });
    }
  } else {
    // ─── HTTP Mode (development / no certs) ────────
    primaryServer = http.createServer(app);
  }

  // Initialize WebSocket on the primary server
  initWebSocket(primaryServer);
  console.log('WebSocket server initialized');

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
    startPatrolMonitor(5 * 60 * 1000); // Check every 5 minutes

    // Start midnight daily patrol report scheduler
    startDailyReportScheduler();

    // Start Traccar fleet GPS position poller (if enabled)
    startTraccarPoller();

    // Start ClearPathGPS fleet poller (if enabled — runs alongside Traccar during transition)
    startClearPathGpsPoller();

    // Start anomaly detector for dispatch intelligence
    startAnomalyDetector(60000); // Check every 60 seconds
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}

// ─── Process-level crash protection ──────────────────────────
// Log unhandled errors instead of dying silently.
process.on('uncaughtException', (err) => {
  console.error('═══ UNCAUGHT EXCEPTION ═══');
  console.error(err);
  console.error('Server will continue running. Please investigate the above error.');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('═══ UNHANDLED PROMISE REJECTION ═══');
  console.error('Reason:', reason);
  console.error('Server will continue running. Please investigate the above error.');
});

export default app;
