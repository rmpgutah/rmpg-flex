// ── MANDATORY TIMEZONE: America/Denver (Mountain Time) ─────────────────────
// Must be set BEFORE any Date operations. Locks all new Date(), SQLite
// datetime('now','localtime'), and Intl formatting to Mountain Standard/Daylight
// Time regardless of the VPS OS timezone setting.
process.env.TZ = 'America/Denver';

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
import { apiRateLimit, webhookRateLimit, rateLimit } from './middleware/rateLimiter';
import { liveBroadcast } from './middleware/liveBroadcast';
import { startPatrolMonitor, stopPatrolMonitor } from './utils/patrolMonitor';
import { startDailyReportScheduler, stopDailyReportScheduler } from './utils/dailyReportGenerator';
import { startClearPathGpsPoller, stopClearPathGpsPoller } from './utils/clearPathGpsPoller';
import { startClearPathGpsMediaPoller, stopClearPathGpsMediaPoller } from './utils/clearPathGpsMediaPoller';
import { startEmailPoller, stopEmailPoller } from './utils/emailPoller';
import { scheduleGeocodeSweep } from './utils/geocode';
import { scheduleOfacSync, searchOfacLocal, stopOfacSync } from './utils/ofacScraper';
import { scheduleUtahWarrantSync, stopUtahWarrantSync } from './utils/utahWarrantScraper';
import { runUniversalWarrantScan } from './utils/universalWarrantScanner';
// multiStateWarrantScraper removed — Utah only
import { scheduleCourtRecordsScan, stopCourtRecordsScan } from './utils/courtRecordsScraper';
import { scheduleArrestSync, stopArrestSync } from './utils/arrestScraper';
import { scheduleJailRosterSync, stopJailRosterSync } from './utils/jailRosterScraper';
import { startServeManagerPoller, stopServeManagerPoller } from './utils/serveManagerPoller';
import { startPsoMonitor, stopPsoMonitor } from './utils/psoMonitor';
import { startCallAgingMonitor, stopCallAgingMonitor } from './utils/callAgingMonitor';
import { getDb } from './models/database';
import { localNow } from './utils/timeUtils';

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
import ipedRoutes from './routes/iped';
import forensicsRoutes from './routes/forensics';
import { scheduleLeadScrapers, stopLeadScrapers } from './utils/leadScraperBase';

const app = express();

// Suppress Express version fingerprinting — defense-in-depth (also removed per-request in securityHeaders)
app.disable('x-powered-by');

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
      // Prevent open redirect: reject protocol-relative URLs (//evil.com) and non-path URLs
      // Also strip CRLF chars to prevent HTTP response splitting attacks
      const rawPath = req.originalUrl.replace(/[\r\n\0]/g, '');
      const safePath = (rawPath.startsWith('/') && !rawPath.startsWith('//'))
        ? rawPath : '/';
      return res.redirect(301, `${protocol}://${config.primaryDomain}${port}${safePath}`);
    }
    next();
  });
}

// ─── DNS Rebinding Protection ────────────────────────
// Validate Host header to prevent DNS rebinding attacks that could bypass same-origin policy
if (config.isProduction) {
  const allowedHosts = new Set([
    config.primaryDomain,
    `www.${config.primaryDomain}`,
    `crm.${config.primaryDomain}`,
  ]);
  app.use((req, res, next) => {
    const host = (req.hostname || req.headers.host?.split(':')[0] || '').toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(421).json({ error: 'Misdirected request' });
      return;
    }
    next();
  });
}

// ─── Request Size Guards ─────────────────────────────
// Reject requests with excessively long URLs or query strings — prevents buffer overflow
// attacks and URL-based DoS. 8KB is the common server limit (Apache, nginx defaults).
app.use((req, res, next) => {
  if (req.originalUrl.length > 8192) {
    res.status(414).json({ error: 'URI too long' });
    return;
  }
  next();
});

// ─── Header Size Validation ──────────────────────────
// Reject requests with excessively large headers — prevents header-based DoS
// and cookie-bombing attacks where attackers set many large cookies.
app.use((req, res, next) => {
  // Check Authorization header specifically — overly large tokens indicate abuse
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.length > 4096) {
    res.status(431).json({ error: 'Request header too large' });
    return;
  }
  // Check cookie header — cookie-bombing can cause request loop failures
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader && cookieHeader.length > 8192) {
    res.status(431).json({ error: 'Cookie header too large' });
    return;
  }
  next();
});

// ─── HTTP Method Override Prevention ─────────────────
// Block X-HTTP-Method-Override / X-Method-Override headers that some frameworks use
// to convert a POST into a DELETE/PUT. This could bypass CSRF protections or
// route-level access controls if an attacker smuggles a method override past a proxy.
app.use((req, res, next) => {
  if (req.headers['x-http-method-override'] || req.headers['x-method-override'] || req.headers['x-http-method']) {
    res.status(400).json({ error: 'Method override not allowed' });
    return;
  }
  next();
});

// ─── Security Middleware ─────────────────────────────
app.use(securityHeaders);

// ─── Secure Cookie Defaults ──────────────────────────
// Override res.cookie to enforce secure attributes on all cookies (defense-in-depth).
// Even though RMPG Flex uses JWT in headers (not cookies), third-party middleware
// or future code might set cookies — this ensures they're always hardened.
if (config.isProduction) {
  app.use((_req, res, next) => {
    const originalCookie = res.cookie.bind(res);
    res.cookie = function(name: string, value: string, options?: any) {
      const secureOptions = {
        ...options,
        httpOnly: options?.httpOnly !== false,  // default true
        secure: true,                           // HTTPS only
        sameSite: options?.sameSite || 'strict', // default strict
      };
      return originalCookie(name, value, secureOptions);
    };
    next();
  });
}
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, Electron desktop)
    if (!origin) return callback(null, true);
    // Validate against configured allowed origins (exact match only)
    if (config.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Log rejected origins in production for security monitoring
    if (config.isProduction) {
      console.warn(`[CORS] Rejected cross-origin request from: ${String(origin).slice(0, 100)}`);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  maxAge: 600, // 10 minutes — browser caches preflight results
}));

// ─── GitHub Webhook (must come BEFORE express.json() for raw body HMAC) ──
app.post('/api/webhook/github', webhookRateLimit, express.raw({ type: 'application/json', limit: '256kb' }), (req, res) => {
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
  let payload: any;
  try {
    payload = JSON.parse(body.toString());
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // Only deploy on push to main
  if (event !== 'push' || payload.ref !== 'refs/heads/main') {
    console.log(`[Webhook] Ignored — event=${event}, ref=${payload.ref || 'n/a'}`);
    res.json({ status: 'ignored', reason: `event=${event}` });
    return;
  }

  const commitSha = (payload.after || '').slice(0, 8).replace(/[^a-f0-9]/gi, '');
  const pusher = (payload.pusher?.name || 'unknown').slice(0, 50).replace(/[\x00-\x1f\x7f]/g, '');
  console.log(`[Webhook] DEPLOY TRIGGERED — commit=${commitSha}, by=${pusher}`);

  // Prevent concurrent deploys — reject if one is already running
  if ((global as any).__deployInProgress) {
    console.warn('[Webhook] Deploy rejected — another deploy is already in progress');
    res.status(429).json({ status: 'busy', reason: 'Deploy already in progress' });
    return;
  }
  (global as any).__deployInProgress = true;

  // Respond immediately, deploy runs async
  res.json({ status: 'deploying', commit: commitSha });

  // Run deploy in background — uses hardcoded APP_DIR and sanitized PATH to prevent
  // environment manipulation attacks. The deploy script path is validated to exist.
  const APP_DIR = '/opt/rmpg-flex';
  const DEPLOY_SCRIPT = path.join(APP_DIR, 'deploy', 'deploy.sh');
  const safeEnv = {
    HOME: '/root',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    NODE_ENV: 'production',
    // Preserve database-related env vars
    ...(process.env.JWT_SECRET ? { JWT_SECRET: process.env.JWT_SECRET } : {}),
    ...(process.env.TOTP_ENCRYPTION_KEY ? { TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY } : {}),
  };
  const script = `cd ${APP_DIR} && git pull origin main && cd server && npm install --production 2>&1 | tail -2 && cd ../client && npm install 2>&1 | tail -2 && npx vite build 2>&1 | tail -3 && cd .. && systemctl restart rmpg-flex`;
  const child = execFile('/bin/bash', ['-c', script], {
    cwd: APP_DIR,
    timeout: 300000,
    env: safeEnv,
  }, (error, stdout, stderr) => {
    (global as any).__deployInProgress = false;
    if (error) {
      console.error(`[Webhook] DEPLOY FAILED — ${error.message}`);
      if (stderr) console.error(`[Webhook] STDERR: ${stderr.slice(0, 500)}`);
    } else {
      console.log(`[Webhook] DEPLOY SUCCESS — ${(stdout || '').slice(0, 300)}`);
    }
  });
  child.unref();
});

// JSON body parser with prototype pollution protection at parse level
// The reviver rejects __proto__ keys before they reach application code
app.use(express.json({
  limit: '2mb',
  reviver: (key: string, value: unknown) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  },
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(sanitizeInput);

// ─── API Response Hardening ──────────────────────────
// Prevent reflected file download (RFD) attacks by ensuring API responses
// are treated as inline JSON, never as downloadable files.
app.use('/api', (_req, res, next) => {
  // Override res.json to always set strict Content-Type and Content-Disposition
  const originalJson = res.json.bind(res);
  res.json = function(body: any) {
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', 'inline');
    return originalJson(body);
  };
  next();
});

// ─── CSRF Protection ─────────────────────────────────
// Require a custom header on all state-changing requests to prevent CSRF.
// Browsers block cross-origin requests from setting custom headers without preflight,
// so the presence of this header proves the request originated from our SPA.
if (config.isProduction) {
  app.use('/api', (req, res, next) => {
    // Skip safe methods (GET, HEAD, OPTIONS) and auth routes (login needs to work without header)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Only exempt login/register/refresh (pre-auth routes) and webhooks — NOT change-password, verify-2fa, etc.
    const csrfExemptPaths = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/password-policy'];
    if (csrfExemptPaths.some(p => req.path.startsWith(p))
        || req.path.startsWith('/webhook/')) return next();

    const csrfHeader = req.headers['x-requested-with'];
    if (csrfHeader !== 'XMLHttpRequest' && csrfHeader !== 'RMPG-Flex') {
      res.status(403).json({ error: 'Missing CSRF header' });
      return;
    }
    next();
  });
}

// ─── Per-route body size limits ──────────────────────
// Auth endpoints should have tiny payloads — prevent abuse with oversized bodies
app.use('/api/auth', express.json({ limit: '16kb' }));
// Offline sync — limit to 256kb to prevent data exfiltration abuse via oversized pushes
app.use('/api/offline', express.json({ limit: '256kb' }));

// Request timeout — 30s default, skip for upload routes (large files)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/uploads') || req.path.startsWith('/api/downloads')) return next();
  req.setTimeout(30_000, () => {
    if (!res.headersSent) res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// ─── Content-Type Validation ─────────────────────────
// Reject POST/PUT/PATCH requests with unexpected Content-Type to prevent
// type-confusion attacks where binary data is sent as JSON or vice versa.
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0') {
    const ct = req.headers['content-type'] || '';
    // Allow JSON, form-urlencoded, multipart (file upload), CSP reports, and raw (webhooks)
    const validTypes = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/csp-report', 'application/octet-stream'];
    if (ct && !validTypes.some(t => ct.startsWith(t))) {
      // Skip for webhook routes (may send custom content types)
      if (!req.path.startsWith('/webhook/') && !req.path.startsWith('/uploads')) {
        res.status(415).json({ error: 'Unsupported media type' });
        return;
      }
    }
  }
  next();
});

// ─── Slow Request Logging ────────────────────────────
// Log requests that take longer than 10 seconds — potential DoS or performance issues
if (config.isProduction) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (duration > 10_000) {
        const userId = (req as any).user?.userId || 'anon';
        console.warn(`[SLOW REQUEST] ${req.method} ${req.path} — ${duration}ms — user:${userId} ip:${req.ip}`);
      }
    });
    next();
  });
}

// Apply rate limiting to API routes
app.use('/api', apiRateLimit);

// ─── CSP Violation Report Endpoint ────────────────────
// Receives Content Security Policy violation reports from browsers.
// Rate-limited to prevent abuse; logs violations for security monitoring.
const cspReportRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  maxRequests: 50,
  keyGenerator: (req: express.Request) => `csp:${req.ip || 'unknown'}`,
  message: 'Too many CSP reports',
});
app.post('/api/csp-report', cspReportRateLimit, express.json({ type: 'application/csp-report', limit: '16kb' }), (req, res) => {
  const report = req.body?.['csp-report'] || req.body;
  if (report) {
    const safeReport = {
      'document-uri': String(report['document-uri'] || '').slice(0, 200),
      'violated-directive': String(report['violated-directive'] || '').slice(0, 100),
      'blocked-uri': String(report['blocked-uri'] || '').slice(0, 200),
      'source-file': String(report['source-file'] || '').slice(0, 200),
    };
    console.warn('[CSP Violation]', JSON.stringify(safeReport));
  }
  res.status(204).end();
});

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

  // Public health check — expose only operational status, no version/env/internals
  res.status(statusCode).json({
    status: overall,
    timestamp: localNow(),
    database: { status: dbStatus },
  });
});

// ─── Detailed Health (Auth Required) ─────────────────
app.get('/api/health/detailed', authenticateToken, requireRole('admin', 'manager'), (_req, res) => {
  let dbStatus: 'ok' | 'error' = 'ok';
  try { const db = getDb(); db.prepare('SELECT 1').get(); } catch { dbStatus = 'error'; }
  res.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    name: 'RMPG Flex CAD/RMS Server',
    version: SERVER_VERSION,
    environment: config.nodeEnv,
    timestamp: localNow(),
    uptime: Math.floor(process.uptime()),
    database: { status: dbStatus },
    connections: { websocket: getConnectedClientCount() },
  });
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
    const now = localNow();
    const currentAttempt = call.pso_attempt_number || 1;
    const newAttempt = currentAttempt + 1;
    const ordinal = (n: number) => { const s = ['th','st','nd','rd']; const v = n % 100; if (v >= 11 && v <= 13) return n + 'th'; return n + (s[n % 10] || s[0]); };

    // Snapshot visit history
    let assignedCallSigns: string[] = [];
    try {
      const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
      if (Array.isArray(unitIds) && unitIds.length) {
        const units = db.prepare(`SELECT call_sign FROM units WHERE id IN (${unitIds.map(()=>'?').join(',')})`).all(...unitIds) as any[];
        assignedCallSigns = units.map((u:any) => u.call_sign).filter(Boolean);
      }
    } catch (e) { console.warn('[dispatch] Failed to snapshot assigned call signs:', e); }

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
    console.error('[REDISPATCH-TOPLEVEL] Error:', error?.message || 'Unknown error');
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
app.use('/api/iped', ipedRoutes);
app.use('/api/forensics', forensicsRoutes);

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
    const requestId = req.headers['x-request-id'] || undefined;
    res.status(404).json({ error: 'API endpoint not found', requestId });
  } else if (req.path.startsWith('/downloads/') || req.path === '/download') {
    res.status(404).json({ error: 'Not found' });
  } else {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  }
});

// ─── Global Error Handler ────────────────────────────
// Catches unhandled middleware errors (multer, body-parser, etc.)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = req.headers['x-request-id'] || '';
  // Log full error details server-side but never expose to client
  console.error(`[${requestId}] Unhandled Express error:`, err?.message || err);
  if (config.isProduction) {
    // In production, suppress stack traces to prevent information disclosure
    // The request ID allows admins to correlate client errors with server logs
  } else {
    console.error(err?.stack || '');
  }
  if (!res.headersSent) {
    // Ensure error responses have security headers even if middleware chain was interrupted
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    // Map specific middleware errors to appropriate status codes
    const statusCode = err.status || err.statusCode
      || (err.type === 'entity.too.large' ? 413 : 500)
      || (err.message?.includes('not allowed') ? 400 : 500);
    const clientMessage = statusCode === 413 ? 'Request body too large'
      : statusCode === 400 ? 'Bad request'
      : 'Internal server error';
    res.status(statusCode).json({ error: clientMessage, requestId: requestId || undefined });
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
      // Strong TLS configuration — disable weak protocols and ciphers
      minVersion: 'TLSv1.2' as any,
      ciphers: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-CHACHA20-POLY1305',
        'ECDHE-RSA-CHACHA20-POLY1305',
        'ECDHE-ECDSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES128-GCM-SHA256',
      ].join(':'),
      honorCipherOrder: true,
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
        // Validate host against allowed domains to prevent open redirect via Host header manipulation
        const allowedRedirectHosts = [config.primaryDomain, `www.${config.primaryDomain}`, `crm.${config.primaryDomain}`];
        if (!allowedRedirectHosts.includes(host)) {
          host = config.primaryDomain;
        }
        const httpsPort = config.httpsPort === 443 ? '' : `:${config.httpsPort}`;
        // Strip CRLF to prevent response splitting
        const safeUrl = req.url.replace(/[\r\n\0]/g, '');
        res.redirect(301, `https://${host}${httpsPort}${safeUrl}`);
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
        // Also mark idle sessions as inactive based on configured timeout
        const idleMinutes = Math.max(1, Math.floor(config.session?.idleTimeoutMinutes || 480));
        db.prepare(`
          UPDATE sessions SET is_active = 0
          WHERE is_active = 1 AND last_used_at < datetime('now', 'localtime', '-' || ? || ' minutes')
        `).run(idleMinutes);
        const result = db.prepare(`
          DELETE FROM sessions
          WHERE is_active = 0
             OR expires_at < datetime('now', 'localtime')
             OR last_used_at < datetime('now', 'localtime', '-30 days')
        `).run();
        if (result.changes > 0) {
          console.log(`[Session Cleanup] Removed ${result.changes} expired sessions`);
        }
      } catch (e) { console.error('[Session Cleanup] Failed:', e); }

      // Purge old login attempts — keep only 30 days for security forensics
      try {
        const loginDb = getDb();
        const loginResult = loginDb.prepare(`
          DELETE FROM login_attempts
          WHERE created_at < datetime('now', 'localtime', '-30 days')
        `).run();
        if (loginResult.changes > 0) {
          console.log(`[Login Cleanup] Purged ${loginResult.changes} old login attempts`);
        }
      } catch (e) { console.error('[Login Cleanup] Failed:', e); }

      // Purge old activity log entries — keep 90 days for compliance audits
      try {
        const auditDb = getDb();
        const auditResult = auditDb.prepare(`
          DELETE FROM activity_log
          WHERE created_at < datetime('now', 'localtime', '-90 days')
        `).run();
        if (auditResult.changes > 0) {
          console.log(`[Audit Cleanup] Archived ${auditResult.changes} old activity log entries`);
        }
      } catch (e) { console.error('[Audit Cleanup] Failed:', e); }

      // Purge old TOTP used codes — only need to prevent replay within the TOTP window (90s)
      // Keep 24h for safety margin, then delete to prevent unbounded table growth
      try {
        const totpDb = getDb();
        const totpResult = totpDb.prepare(`
          DELETE FROM totp_used_codes
          WHERE used_at < datetime('now', 'localtime', '-1 day')
        `).run();
        if (totpResult.changes > 0) {
          console.log(`[TOTP Cleanup] Purged ${totpResult.changes} old used codes`);
        }
      } catch { /* table may not exist */ }

      // Purge expired trusted devices
      try {
        const deviceDb = getDb();
        const deviceResult = deviceDb.prepare(`
          DELETE FROM trusted_devices
          WHERE trusted_until < datetime('now', 'localtime')
        `).run();
        if (deviceResult.changes > 0) {
          console.log(`[Device Cleanup] Removed ${deviceResult.changes} expired trusted devices`);
        }
      } catch { /* table may not exist */ }

      // Purge old security notifications — keep 90 days
      try {
        const notifDb = getDb();
        const notifResult = notifDb.prepare(`
          DELETE FROM security_notifications
          WHERE created_at < datetime('now', 'localtime', '-90 days')
        `).run();
        if (notifResult.changes > 0) {
          console.log(`[Notification Cleanup] Purged ${notifResult.changes} old security notifications`);
        }
      } catch { /* table may not exist */ }
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

    // Start geocode sweep — batch-geocodes calls missing lat/lng every 30 minutes
    scheduleGeocodeSweep();

    // Start OFAC SDN data sync (downloads from U.S. Treasury, syncs daily)
    scheduleOfacSync();

    // Start Utah state warrant scraper (syncs daily at midnight from warrants.utah.gov)
    // scheduleUtahWarrantSync(); // Replaced by universal warrant scanner below

    // Universal warrant scanner — replaces Utah-only warrant watch
    let universalScanInterval: ReturnType<typeof setInterval> | null = null;
    setTimeout(async () => {
      try { await runUniversalWarrantScan(); } catch (err: any) {
        console.error('[Universal Warrant Scan] Initial scan error:', err.message);
      }
      universalScanInterval = setInterval(async () => {
        try { await runUniversalWarrantScan(); } catch (err: any) {
          console.error('[Universal Warrant Scan] Scheduled error:', err.message);
        }
      }, 4 * 60 * 60 * 1000); // every 4 hours (reduced from 1h to respect Utah API limits)
    }, 2 * 60 * 1000); // 2-minute startup delay

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
          const now = localNow();
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
// ─── Memory Usage Monitoring ────────────────────────────
// Log a warning when heap exceeds 75% of --max-old-space-size (default 2GB).
// V8's heapTotal is the current allocation chunk, NOT the max — compare against the real limit.
const MAX_HEAP_MB = parseInt(process.env.MAX_OLD_SPACE_SIZE || '2048', 10);
setInterval(() => {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1048576);
  const rssMB = Math.round(mem.rss / 1048576);
  const heapPctOfMax = Math.round((heapUsedMB / MAX_HEAP_MB) * 100);
  if (heapPctOfMax > 75) {
    console.warn(`[MEMORY WARNING] Heap: ${heapUsedMB}/${MAX_HEAP_MB}MB (${heapPctOfMax}%) — RSS: ${rssMB}MB`);
  }
  // Critical: if RSS exceeds 1.5GB, log critical and attempt GC
  if (rssMB > 1536) {
    console.error(`[MEMORY CRITICAL] RSS: ${rssMB}MB exceeds 1.5GB — potential memory leak or DoS`);
    try { if (global.gc) global.gc(); } catch { /* GC not exposed */ }
  }
}, 60_000).unref();

process.on('uncaughtException', (err) => {
  console.error('═══ UNCAUGHT EXCEPTION ═══');
  console.error(err.message || err);
  // Log stack trace for forensics but don't expose in production responses
  if (err.stack) console.error(err.stack);
  console.error('Server will continue running. Please investigate the above error.');
});

process.on('unhandledRejection', (reason, _promise) => {
  console.error('═══ UNHANDLED PROMISE REJECTION ═══');
  console.error('Reason:', reason instanceof Error ? reason.message : reason);
  console.error('Server will continue running. Please investigate the above error.');
});

export default app;
