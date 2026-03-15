// Set timezone BEFORE any Date operations — uses system setting or env var
// This ensures all new Date() calls and SQLite datetime('now','localtime') use local time
process.env.TZ = process.env.SERVER_TIMEZONE || 'America/Denver';

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import config from './config';
import { initDatabase } from './models/database';
import { initWebSocket, getConnectedUsers, getConnectedClientCount } from './utils/websocket';
import { authenticateToken, requireRole } from './middleware/auth';
import { securityHeaders } from './middleware/securityHeaders';
import { sanitizeInput } from './middleware/sanitize';
import { apiRateLimit, webhookRateLimit } from './middleware/rateLimiter';
import { liveBroadcast } from './middleware/liveBroadcast';
import { startPatrolMonitor, stopPatrolMonitor } from './utils/patrolMonitor';
import { startDailyReportScheduler, stopDailyReportScheduler } from './utils/dailyReportGenerator';
import { startClearPathGpsPoller, stopClearPathGpsPoller } from './utils/clearPathGpsPoller';
import { startClearPathGpsMediaPoller, stopClearPathGpsMediaPoller } from './utils/clearPathGpsMediaPoller';
import { startEmailPoller, stopEmailPoller } from './utils/emailPoller';
import { scheduleOfacSync, searchOfacLocal, stopOfacSync } from './utils/ofacScraper';
import { scheduleUtahWarrantSync, stopUtahWarrantSync } from './utils/utahWarrantScraper';
import { scheduleWarrantScraper, stopWarrantScraper } from './utils/multiStateWarrantScraper';
import { scheduleCourtRecordsScan, stopCourtRecordsScan } from './utils/courtRecordsScraper';
import { scheduleArrestSync, stopArrestSync } from './utils/arrestScraper';
import { scheduleJailRosterSync, stopJailRosterSync } from './utils/jailRosterScraper';
import { startServeManagerPoller, stopServeManagerPoller } from './utils/serveManagerPoller';
import { startPsoMonitor, stopPsoMonitor } from './utils/psoMonitor';
import { startCallAgingMonitor, stopCallAgingMonitor } from './utils/callAgingMonitor';
import { getDb } from './models/database';

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
import securityDashboardRoutes from './routes/securityDashboard';
import webauthnRoutes from './routes/webauthn';
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
import arrestRoutes from './routes/arrests';
import jailRosterRoutes from './routes/jailRoster';
import clearPathGpsRoutes from './routes/clearpathgps';
import dlRecordRoutes from './routes/dlRecords';
import fieldInterviewRoutes from './routes/fieldInterviews';
import trespassOrderRoutes from './routes/trespassOrders';
import caseRoutes from './routes/cases';
import codeEnforcementRoutes from './routes/codeEnforcement';
import courtRoutes from './routes/court';
import darRoutes from './routes/dar';
import offenderRegistryRoutes from './routes/offenderRegistry';
import offlineRoutes from './routes/offline';
import companyDocumentsRoutes from './routes/companyDocuments';
import connectionsRoutes from './routes/connections';
import skiptracerRoutes from './routes/skiptracer';
import dashcamVideoRoutes from './routes/dashcamVideos';
import coloradoDocRoutes from './routes/coloradoDoc';
import sexOffenderRegistryRoutes from './routes/sexOffenderRegistry';
import emailRoutes from './routes/email';
import crmRoutes from './routes/crm';
import crmLeadsRoutes from './routes/crmLeads';
import crmProposalsRoutes from './routes/crmProposals';
import userPreferencesRoutes from './routes/userPreferences';
import serveRoutes from './routes/serve';
import { scheduleLeadScrapers, stopLeadScrapers } from './utils/leadScraperBase';

const app = express();

// Trust first proxy (nginx) so req.ip reflects the real client IP
// Critical for rate limiting, session binding, and audit logging
if (config.isProduction) {
  app.set('trust proxy', 1);
}

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

// ─── GitHub Webhook (must come BEFORE express.json() for raw body HMAC) ──
app.post('/api/webhook/github', webhookRateLimit, express.raw({ type: 'application/json', limit: '5mb' }), (req, res) => {
  const WEBHOOK_SECRET_FILE = path.resolve(__dirname, '../../.webhook-secret');
  let secret = '';
  try { secret = fs.readFileSync(WEBHOOK_SECRET_FILE, 'utf8').trim(); } catch { /* no secret file */ }

  if (!secret) {
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  // Validate HMAC signature
  const signature = req.headers['x-hub-signature-256'] as string;
  const body = req.body as Buffer;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      console.log('[Webhook] REJECTED — Invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = req.headers['x-github-event'] as string;
  const payload = JSON.parse(body.toString());

  // Only deploy on push to main
  if (event !== 'push' || payload.ref !== 'refs/heads/main') {
    console.log(`[Webhook] Ignored — event=${event}, ref=${payload.ref || 'n/a'}`);
    res.json({ status: 'ignored', reason: `event=${event}` });
    return;
  }

  const commitSha = (payload.after || '').slice(0, 8);
  const pusher = payload.pusher?.name || 'unknown';
  console.log(`[Webhook] DEPLOY TRIGGERED — commit=${commitSha}, by=${pusher}`);

  // Respond immediately, deploy runs async
  res.json({ status: 'deploying', commit: commitSha });

  // Run deploy in background
  const APP_DIR = '/opt/rmpg-flex';
  const script = `cd ${APP_DIR} && git pull origin main && cd server && npm install --production 2>&1 | tail -2 && cd ../client && npm install 2>&1 | tail -2 && npx vite build 2>&1 | tail -3 && cd .. && systemctl restart rmpg-flex`;
  const child = execFile('/bin/bash', ['-c', script], {
    cwd: APP_DIR,
    timeout: 300000,
    env: { ...process.env, HOME: '/root' },
  }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Webhook] DEPLOY FAILED — ${error.message}`);
      if (stderr) console.error(`[Webhook] STDERR: ${stderr.slice(0, 500)}`);
    } else {
      console.log(`[Webhook] DEPLOY SUCCESS — ${(stdout || '').slice(0, 300)}`);
    }
  });
  child.unref();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(sanitizeInput);

// Request timeout — 30s default, skip for upload routes (large files)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/uploads') || req.path.startsWith('/api/downloads')) return next();
  req.setTimeout(30_000, () => {
    if (!res.headersSent) res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// Prevent caching of API responses (sensitive data)
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Apply rate limiting to API routes
app.use('/api', apiRateLimit);

// ─── Health Check ─────────────────────────────────────
app.get('/api/health', (_req, res) => {
  // Verify database connectivity with a test query
  let dbStatus: 'ok' | 'error' = 'ok';
  let dbError: string | undefined;
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
  } catch (err: any) {
    dbStatus = 'error';
    dbError = err?.message || 'Database unreachable';
  }

  const overall = dbStatus === 'ok' ? 'ok' : 'degraded';
  const statusCode = overall === 'ok' ? 200 : 503;

  if (config.isProduction) {
    // Production: minimal info — no version, environment, features, or connection counts
    res.status(statusCode).json({
      status: overall,
      timestamp: new Date().toISOString(),
      database: { status: dbStatus },
    });
  } else {
    res.status(statusCode).json({
      status: overall,
      name: 'RMPG Flex CAD/RMS Server',
      version: SERVER_VERSION,
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      database: { status: dbStatus, ...(dbError && { error: dbError }) },
      connections: { websocket: getConnectedClientCount() },
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
  }
});

// ─── Presence Endpoint ───────────────────────────────
// Restricted to supervisory+ roles — exposes online officer usernames/roles
app.get('/api/presence', authenticateToken, requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (_req, res) => {
  const users = getConnectedUsers();
  res.json({ users, count: users.length, connections: getConnectedClientCount() });
});

// ─── Live Broadcast Middleware ────────────────────────
// Auto-broadcasts WebSocket events on all successful data mutations
// so every connected device sees changes in real-time
app.use(liveBroadcast);

// ─── Redispatch (top-level to bypass nested router issues) ──
app.post('/api/dispatch/calls/:id/redispatch', authenticateToken, (req, res) => {
  // Top-level route — bypasses nested dispatch router matching issue
  try {
    const db = getDb();
    const role = req.user?.role;
    if (!role || !['admin', 'manager', 'supervisor', 'dispatcher'].includes(role)) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    if (call.incident_type !== 'pso_client_request') { res.status(400).json({ error: 'Not a PSO call' }); return; }
    if (!['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(call.status)) {
      res.status(400).json({ error: 'Call must be completed to re-dispatch' }); return;
    }
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];
    const currentAttempt = call.pso_attempt_number || 1;
    const newAttempt = currentAttempt + 1;
    const ordinal = (n: number) => { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10]||s[v]||s[0]); };

    // Snapshot visit history
    let assignedCallSigns: string[] = [];
    try {
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      if (Array.isArray(unitIds) && unitIds.length) {
        const units = db.prepare(`SELECT call_sign FROM units WHERE id IN (${unitIds.map(()=>'?').join(',')})`).all(...unitIds) as any[];
        assignedCallSigns = units.map((u:any) => u.call_sign).filter(Boolean);
      }
    } catch {}

    db.prepare(`INSERT INTO call_visit_history (call_id, visit_number, status, dispatched_at, enroute_at, onscene_at, cleared_at, closed_at, assigned_units, responding_vehicle_id, starting_mileage, ending_mileage, disposition, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.params.id, currentAttempt, call.status, call.dispatched_at, call.enroute_at, call.onscene_at, call.cleared_at, call.closed_at, JSON.stringify(assignedCallSigns), call.responding_vehicle_id||null, call.starting_mileage??null, call.ending_mileage??null, call.disposition||null, null, req.user?.fullName||'Dispatch', now);

    let notes: any[] = [];
    if (call.notes) { try { notes = JSON.parse(call.notes); } catch { notes = []; } }
    const { scheduled_note } = req.body || {};
    const noteText = scheduled_note ? `Re-dispatched — ${ordinal(newAttempt)} visit. Note: ${scheduled_note}` : `Re-dispatched — ${ordinal(newAttempt)} visit`;
    notes.push({ id: String(Date.now()), author: req.user?.fullName||'Dispatch', text: noteText, timestamp: now, created_at: now });

    db.prepare(`UPDATE calls_for_service SET status='pending', dispatched_at=NULL, enroute_at=NULL, onscene_at=NULL, cleared_at=NULL, closed_at=NULL, starting_mileage=NULL, ending_mileage=NULL, responding_vehicle_id=NULL, pso_attempt_number=?, pso_72hr_notified=NULL, notes=?, updated_at=? WHERE id=?`)
      .run(newAttempt, JSON.stringify(notes), now, req.params.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'call_redispatched', 'call', ?, ?, ?)`)
      .run(req.user!.userId, req.params.id, `Re-dispatched PSO call ${call.call_number} — ${ordinal(newAttempt)} visit`, req.ip||'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    const visitHistory = db.prepare('SELECT * FROM call_visit_history WHERE call_id = ? ORDER BY visit_number ASC').all(req.params.id);
    res.json({ ...updated, visit_history: visitHistory });
  } catch (error: any) {
    console.error('[REDISPATCH-TOPLEVEL] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── API Routes ───────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/auth/security', securityDashboardRoutes);
app.use('/api/auth/webauthn', webauthnRoutes);
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
app.use('/api/fleet/dashcam-videos', dashcamVideoRoutes);
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
app.use('/api/arrests', arrestRoutes);
app.use('/api/jail-roster', jailRosterRoutes);
app.use('/api/clearpathgps', clearPathGpsRoutes);
app.use('/api/dl-records', dlRecordRoutes);
app.use('/api/field-interviews', fieldInterviewRoutes);
app.use('/api/trespass-orders', trespassOrderRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/code-enforcement', codeEnforcementRoutes);
app.use('/api/court', courtRoutes);
app.use('/api/dar', darRoutes);
app.use('/api/offender-registry', offenderRegistryRoutes);
app.use('/api/offline', offlineRoutes);
app.use('/api/company-documents', companyDocumentsRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/skiptracer', skiptracerRoutes);
app.use('/api/colorado-doc', coloradoDocRoutes);
app.use('/api/sex-offender-registry', sexOffenderRegistryRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/crm', crmLeadsRoutes);
app.use('/api/crm', crmProposalsRoutes);
app.use('/api/user/preferences', authenticateToken, userPreferencesRoutes);
app.use('/api/process-server', serveRoutes);

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

// Everything else — short cache, but NEVER cache index.html via this route
app.use(express.static(clientDistPath, {
  maxAge: '5m',
  setHeaders(res, filePath) {
    // HTML files must always revalidate — the SW + Vite hashed imports
    // ensure the browser loads the correct JS/CSS after a deploy.
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback: serve index.html for non-API, non-download routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'API endpoint not found' });
  } else if (req.path.startsWith('/downloads/') || req.path === '/download') {
    // Already handled by download routes — if we get here, 404
    res.status(404).json({ error: 'Not found' });
  } else {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Initialize and Start ─────────────────────────────
// Declared outside try block so gracefulShutdown() can access it
let primaryServer: http.Server | https.Server | null = null;

try {
  // Initialize database
  initDatabase();
  console.log('Database initialized');

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
    console.log('║    /api/arrests    - Arrest Records (JailBase)   ║');
    console.log('║    /api/jail-roster - Jail Roster Scraper         ║');
    console.log('║    /api/connections - Connection Analysis         ║');
    console.log('║    /api/email      - Microsoft Email             ║');
    console.log('║    /api/skiptracer - Skip Tracer (RapidAPI)      ║');
    console.log('║    /api/health     - Health Check                ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    // Daily WAL checkpoint + ANALYZE for SQLite health
    setInterval(() => {
      try {
        const db = getDb();
        db.pragma('wal_checkpoint(PASSIVE)');
        db.exec('ANALYZE');  // Update query planner statistics
        console.log('[DB Maintenance] WAL checkpoint + ANALYZE completed');
      } catch (e) { console.error('[DB Maintenance] Failed:', e); }
    }, 24 * 60 * 60 * 1000).unref();

    // Hourly expired session cleanup — remove inactive sessions and
    // sessions not used for 30+ days to prevent unbounded table growth
    setInterval(() => {
      try {
        const db = getDb();
        const result = db.prepare(`
          DELETE FROM sessions
          WHERE is_active = 0
             OR last_used_at < datetime('now', 'localtime', '-30 days')
        `).run();
        if (result.changes > 0) {
          console.log(`[Session Cleanup] Removed ${result.changes} expired sessions`);
        }
      } catch (e) { console.error('[Session Cleanup] Failed:', e); }
    }, 60 * 60 * 1000).unref();

    // Start patrol monitor for missed scan alerts
    startPatrolMonitor(5 * 60 * 1000); // Check every 5 minutes

    // Start midnight daily patrol report scheduler
    startDailyReportScheduler();

    // Start ClearPathGPS fleet tracking poller
    startClearPathGpsPoller();

    // Start ClearPathGPS media sync poller (dashcam video auto-download)
    startClearPathGpsMediaPoller();

    // Start Microsoft Email inbox sync poller
    startEmailPoller();

    // Start ServeManager auto-poller (syncs jobs → creates dispatch calls)
    startServeManagerPoller();

    // Start PSO 72-hour re-dispatch monitor (checks every 30 minutes)
    startPsoMonitor();

    // Start general call aging monitor — 72-hour overdue enforcement (checks every 30 minutes)
    startCallAgingMonitor();

    // Schedule jail roster sync
    scheduleJailRosterSync();

    // Start OFAC SDN data sync (downloads from U.S. Treasury, syncs daily)
    scheduleOfacSync();

    // Start Utah state warrant scraper (syncs daily at midnight from warrants.utah.gov)
    scheduleUtahWarrantSync();

    // Start multi-state warrant scraper (county sheriff warrant pages + arrest record extraction)
    scheduleWarrantScraper();

    // Start court records scraper (Utah XChange + surrounding states, every 2 hours)
    scheduleCourtRecordsScan();

    // Start JailBase arrest record sync (hourly from RapidAPI)
    scheduleArrestSync();

    // Start CRM lead scrapers (Overwatch)
    scheduleLeadScrapers();

    // Auto-backfill OFAC screening for existing person records (runs 60s after boot
    // to allow OFAC data sync to complete first)
    setTimeout(() => {
      try {
        const db = getDb();
        const unchecked = db.prepare(
          'SELECT id, first_name, last_name FROM persons WHERE watchlist_checked_at IS NULL AND first_name IS NOT NULL AND last_name IS NOT NULL'
        ).all() as { id: number; first_name: string; last_name: string }[];

        if (unchecked.length > 0) {
          console.log(`[OFAC Backfill] Screening ${unchecked.length} person record(s) that were never checked...`);
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
                try {
                  db.prepare(`INSERT INTO notifications (user_id, type, priority, title, body, entity_type, entity_id, created_at) VALUES (0, 'system', 'high', ?, ?, 'person', ?, ?)`)
                    .run(`OFAC WATCHLIST MATCH: ${p.first_name} ${p.last_name}`, `Person #${p.id} matches OFAC sanctions list`, p.id, now);
                } catch { /* notifications table may not exist */ }
              }
            } catch { /* skip individual failures */ }
          }
          console.log(`[OFAC Backfill] Complete — ${unchecked.length} screened, ${matches} match(es) found`);
        } else {
          console.log('[OFAC Backfill] All person records already screened');
        }
      } catch (err) {
        console.warn('[OFAC Backfill] Failed:', (err as Error).message);
      }
    }, 60_000); // 60s delay — after OFAC sync (15s) has time to complete
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}

// ─── Graceful shutdown ──────────────────────────────────────
// Stop background pollers and schedulers before exit so resources are cleaned up.
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Shutdown] ${signal} received — stopping background services...`);

  // Force-exit after 10 seconds if graceful shutdown stalls
  const forceTimer = setTimeout(() => {
    console.error('[Shutdown] Timeout — forcing exit');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  // Stop all background pollers/schedulers
  try { stopPatrolMonitor(); } catch (e) { console.error('[Shutdown] stopPatrolMonitor:', e); }
  try { stopClearPathGpsPoller(); } catch (e) { console.error('[Shutdown] stopClearPathGpsPoller:', e); }
  try { stopClearPathGpsMediaPoller(); } catch (e) { console.error('[Shutdown] stopClearPathGpsMediaPoller:', e); }
  try { stopEmailPoller(); } catch (e) { console.error('[Shutdown] stopEmailPoller:', e); }
  try { stopServeManagerPoller(); } catch (e) { console.error('[Shutdown] stopServeManagerPoller:', e); }
  try { stopPsoMonitor(); } catch (e) { console.error('[Shutdown] stopPsoMonitor:', e); }
  try { stopCallAgingMonitor(); } catch (e) { console.error('[Shutdown] stopCallAgingMonitor:', e); }
  try { stopOfacSync(); } catch (e) { console.error('[Shutdown] stopOfacSync:', e); }
  try { stopUtahWarrantSync(); } catch (e) { console.error('[Shutdown] stopUtahWarrantSync:', e); }
  try { stopWarrantScraper(); } catch (e) { console.error('[Shutdown] stopWarrantScraper:', e); }
  try { stopCourtRecordsScan(); } catch (e) { console.error('[Shutdown] stopCourtRecordsScan:', e); }
  try { stopArrestSync(); } catch (e) { console.error('[Shutdown] stopArrestSync:', e); }
  try { stopJailRosterSync(); } catch (e) { console.error('[Shutdown] stopJailRosterSync:', e); }
  try { stopLeadScrapers(); } catch (e) { console.error('[Shutdown] stopLeadScrapers:', e); }
  try { stopDailyReportScheduler(); } catch (e) { console.error('[Shutdown] stopDailyReportScheduler:', e); }

  // Final WAL checkpoint to flush pending writes
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('[Shutdown] WAL checkpoint completed');
  } catch (e) { console.error('[Shutdown] WAL checkpoint failed:', e); }

  // Close HTTP server to stop accepting new connections
  if (primaryServer) {
    primaryServer.close(() => {
      console.log('[Shutdown] HTTP server closed. Exiting.');
      process.exit(0);
    });
  } else {
    console.log('[Shutdown] Background services stopped. Exiting.');
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Process-level crash protection ──────────────────────────
// Log unhandled errors instead of dying silently.
process.on('uncaughtException', (err) => {
  console.error('═══ UNCAUGHT EXCEPTION ═══');
  console.error(err.message || err);
  console.error('Server will continue running. Please investigate the above error.');
});

process.on('unhandledRejection', (reason, _promise) => {
  console.error('═══ UNHANDLED PROMISE REJECTION ═══');
  console.error('Reason:', reason instanceof Error ? reason.message : reason);
  console.error('Server will continue running. Please investigate the above error.');
});

export default app;
