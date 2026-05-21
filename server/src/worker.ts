// ============================================================
// RMPG Flex — Cloudflare Worker Entry Point
// ============================================================
// Bridges Express.js routes to Cloudflare Workers runtime.
// Uses Hono as the Workers-compatible router (Express cannot run
// natively in Workers due to Node.js API dependencies).
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
// import { handleWebSocketUpgrade, getConnectedUserCount } from './worker-middleware/websocket';
import type { D1Database, KVNamespace, R2Bucket, ExecutionContext } from '@cloudflare/workers-types';

// ─── Environment Bindings ────────────────────────────────
export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  RATE_LIMITS: KVNamespace;
  UPLOADS: R2Bucket;
  DOWNLOADS: R2Bucket;
  JWT_SECRET: string;
  NODE_ENV: string;
  PRIMARY_DOMAIN: string;
  CORS_ORIGINS: string;
  WEBAUTHN_RP_ID: string;
  WEBAUTHN_RP_NAME: string;
  TOTP_ISSUER: string;
  JWT_ACCESS_EXPIRY: string;
  JWT_REFRESH_EXPIRY: string;
  MAX_LOGIN_ATTEMPTS: string;
  LOCKOUT_DURATION_MINUTES: string;
  PASSWORD_MIN_LENGTH: string;
  SERVER_TIMEZONE: string;
  TOTP_ENCRYPTION_KEY?: string;
  SERVEMANAGER_API_KEY?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  AZURE_TENANT_ID?: string;
  TOTP_REQUIRED_ROLES?: string;
  OLLAMA_URL?: string;
  AI_MODEL?: string;
  GOOGLE_VISION_API_KEY?: string;
  VITE_MAPBOX_ACCESS_TOKEN?: string;
  MAPBOX_ACCESS_TOKEN?: string;
}

// ─── Hono App ────────────────────────────────────────────
import type { JwtPayload } from './worker-middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

// ─── Timezone ────────────────────────────────────────────
// Set timezone for all Date operations
process.env.TZ = 'America/Denver';

// ─── CORS ────────────────────────────────────────────────
app.use('/api/*', cors({
  origin: (origin: string, c) => {
    const allowed = c.env.CORS_ORIGINS?.split(',').map((s: string) => s.trim()) || ['http://localhost:5173'];
    return allowed.includes(origin) ? origin : allowed[0];
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-Request-Id'],
  maxAge: 86400,
}));

// ─── Request ID Middleware ───────────────────────────────
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  await next();
});

// ─── Domain Redirect (www → apex) ────────────────────────
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === `www.${c.env.PRIMARY_DOMAIN}`) {
    return c.redirect(`${url.protocol}//${c.env.PRIMARY_DOMAIN}${url.pathname}${url.search}`, 301);
  }
  await next();
});

// ─── Security Headers ────────────────────────────────────
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '0');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=*');
});

// ─── Health Check ────────────────────────────────────────
app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').run();
    return c.json({
      status: 'ok',
      name: 'RMPG Flex CAD/RMS Server',
      version: '5.8.0',
      environment: c.env.NODE_ENV || 'production',
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
        sslEncryption: true,
        wsAuthentication: true,
        liveSync: true,
      },
    });
  } catch {
    return c.json({
      status: 'degraded',
      name: 'RMPG Flex CAD/RMS Server',
      version: '5.8.0',
      environment: c.env.NODE_ENV || 'production',
      timestamp: new Date().toISOString(),
      features: {},
    }, 503);
  }
});

// ─── Map Health Check ────────────────────────────────────
app.get('/api/health/map', async (c) => {
  try {
    const callCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM calls_for_service WHERE latitude IS NOT NULL').first();
    const unitCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM units WHERE latitude IS NOT NULL').first();
    const geofenceCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM geofences WHERE is_active = 1').first();
    const breadcrumbCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM gps_breadcrumbs').first();

    return c.json({
      status: 'ok',
      subsystem: 'map',
      geocoded_calls: (callCount as any)?.cnt || 0,
      positioned_units: (unitCount as any)?.cnt || 0,
      active_geofences: (geofenceCount as any)?.cnt || 0,
      breadcrumb_records: (breadcrumbCount as any)?.cnt || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({
      status: 'error',
      subsystem: 'map',
      error: err?.message || 'Unknown',
    }, 500);
  }
});

// ─── Feature Flags ───────────────────────────────────────
app.get('/api/features', async (c) => {
  const flags = {
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
    const configRow = await c.env.DB.prepare("SELECT config_value FROM system_config WHERE config_key = 'feature_flags' AND category = 'system_settings' AND is_active = 1").first() as any;
    if (configRow?.config_value) {
      Object.assign(flags, JSON.parse(configRow.config_value));
    }
  } catch { /* use defaults */ }

  return c.json(flags);
});

// ─── Presence Endpoint ─────────────────────────────────
app.get('/api/presence', async (c) => {
  return c.json({ users: [], count: 0, connections: 0 });
});

// ─── System Status ──────────────────────────────────────
app.get('/api/system-status', async (c) => {
  try {
    let dbStatus = 'ok';
    try {
      await c.env.DB.prepare('SELECT 1').run();
    } catch {
      dbStatus = 'error';
    }

    return c.json({
      status: dbStatus === 'ok' ? 'operational' : 'degraded',
      api: { status: 'ok', response_time_ms: 0 },
      database: { status: dbStatus },
      websocket: { status: 'ok', connections: 0 },
      server: {
        version: '5.8.0',
        uptime_seconds: 0,
        started_at: new Date().toISOString(),
        environment: c.env.NODE_ENV || 'production',
      },
    });
  } catch (error: any) {
    return c.json({ status: 'error', error: error.message });
  }
});

// ─── Weather Proxy ──────────────────────────────────────
let weatherCache: { data: any; fetchedAt: number } | null = null;
const WEATHER_CACHE_TTL = 10 * 60 * 1000;

app.get('/api/weather', async (c) => {
  if (weatherCache && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_TTL) {
    return c.json(weatherCache.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=40.7608&longitude=-111.891&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Denver',
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!resp.ok) {
      return c.json({ error: 'Weather API returned ' + resp.status }, 502);
    }

    const data = await resp.json();
    weatherCache = { data, fetchedAt: Date.now() };
    return c.json(data);
  } catch {
    if (weatherCache) return c.json(weatherCache.data);
    return c.json({ error: 'Weather API unavailable' }, 502);
  }
});

// ─── Route Imports ─────────────────────────────────────────
import { mountAuthRoutes } from './routes/auth-worker';
import { mountDispatchRoutes } from './routes/dispatch-worker';
import { mountAdminRoutes } from './routes/admin-worker';
import { mountPersonnelRoutes } from './routes/personnel-worker';
import { mountWarrantRoutes } from './routes/warrants-worker';
import { mountIncidentRoutes } from './routes/incidents-worker';
import { mountRecordsRoutes } from './routes/records-worker';
import { mountNotificationRoutes } from './routes/notifications-worker';
// import { mountCommsRoutes } from './routes/comms-worker';
import { mountReportsRoutes } from './routes/reports-worker';
import { mountEmailRoutes } from './routes/email-worker';
import { mountFleetRoutes } from './routes/fleet-worker';
// import { mountCitationRoutes } from './routes/citations-worker';
// import { mountCodeEnforcementRoutes } from './routes/codeEnforcement-worker';
// import { mountFieldInterviewRoutes } from './routes/fieldInterviews-worker';
// import { mountCourtRoutes } from './routes/court-worker';
// import { mountServeRoutes } from './routes/serve-worker';
// import { mountTrespassOrderRoutes } from './routes/trespassOrders-worker';
// import { mountPatrolRoutes } from './routes/patrol-worker';
// import { mountArrestsRoutes } from './routes/arrests-worker';
// import { mountCasesRoutes } from './routes/cases-worker';
// import { mountDashcamVideoRoutes } from './routes/dashcamVideos-worker';
// import { mountForensicsRoutes } from './routes/forensics-worker';
// import { mountOffenderRegistryRoutes } from './routes/offenderRegistry-worker';
// import { mountShiftPlanRoutes } from './routes/shiftPlans-worker';
// import { mountUploadRoutes } from './routes/uploads-worker';
// import { mountUseOfForceRoutes } from './routes/useOfForce-worker';
// import { mountDlRecordsRoutes } from './routes/dlRecords-worker';
// import { mountVoicePersonaRoutes } from './routes/voicePersona-worker';
// import { mountServeIntakeRoutes } from './routes/serveIntake-worker';
// import { mountAiRoutes } from './routes/ai-worker';
import { mountHrRoutes } from './routes/hr-worker';
// import { mountStatuteRoutes } from './routes/statutes-worker';
// import { mountGeocodeRoutes } from './routes/geocode-worker';
// import { mountDispatchAggregatesRoutes } from './routes/dispatch-aggregates-worker';
// import { mountMapboxRoutes } from './routes/mapbox-worker';
// import { mountOcrRoutes } from './routes/ocr-worker';
// import { mountSystemConfigRoutes } from './routes/systemConfig-worker';
// import { mountDispatchMessagesRoutes } from './routes/dispatchMessages-worker';
// import { mountWebAuthnRoutes } from './routes/webauthn-worker';
// import { mountSkipTracerV2Routes } from './routes/skiptracerV2-worker';
// import { mountMapGeofencesRoutes } from './routes/mapGeofences-worker';
// import { mountMapSafetyRoutes } from './routes/mapSafety-worker';
// import { mountCrmRoutes } from './routes/crm-worker';
// import { mountCrmLeadsRoutes } from './routes/crmLeads-worker';
// import { mountCrmProposalsRoutes } from './routes/crmProposals-worker';
// import { mountUserPreferencesRoutes } from './routes/userPreferences-worker';
// import { mountCompanyDocumentsRoutes } from './routes/companyDocuments-worker';
// import { mountConnectionsRoutes } from './routes/connections-worker';
// import { mountDarRoutes } from './routes/dar-worker';
// import { mountVoiceRoutes } from './routes/voice-worker';
// import { mountPdfEngineRoutes } from './routes/pdfEngine-worker';
// import { mountIntegrationsRoutes } from './routes/integrations-worker';
// import { mountInvoicesRoutes } from './routes/invoices-worker';
// import { mountJailRosterRoutes } from './routes/jailRoster-worker';
// import { mountClearpathgpsRoutes } from './routes/clearpathgps-worker';
// import { mountTraccarRoutes } from './routes/traccar-worker';
// import { mountServemanagerRoutes } from './routes/servemanager-worker';
// import { mountMicrobiltRoutes } from './routes/microbilt-worker';
// import { mountSexOffenderRegistryRoutes } from './routes/sexOffenderRegistry-worker';

mountAuthRoutes(app);
mountDispatchRoutes(app);
mountAdminRoutes(app);
mountPersonnelRoutes(app);
mountWarrantRoutes(app);
mountIncidentRoutes(app);
mountRecordsRoutes(app);
mountNotificationRoutes(app);
mountCommsRoutes(app);
mountReportsRoutes(app);
mountEmailRoutes(app);
mountFleetRoutes(app);
mountCitationRoutes(app);
mountCodeEnforcementRoutes(app);
mountFieldInterviewRoutes(app);
mountCourtRoutes(app);
mountServeRoutes(app);
mountTrespassOrderRoutes(app);
mountPatrolRoutes(app);
mountArrestsRoutes(app);
mountCasesRoutes(app);
mountDashcamVideoRoutes(app);
mountForensicsRoutes(app);
mountOffenderRegistryRoutes(app);
mountShiftPlanRoutes(app);
mountUploadRoutes(app);
mountUseOfForceRoutes(app);
mountDlRecordsRoutes(app);
mountVoicePersonaRoutes(app);
mountServeIntakeRoutes(app);
mountAiRoutes(app);
mountHrRoutes(app);
mountStatuteRoutes(app);
mountGeocodeRoutes(app);
mountOcrRoutes(app);
mountDispatchAggregatesRoutes(app);
mountMapboxRoutes(app);
mountDispatchMessagesRoutes(app);
mountWebAuthnRoutes(app);
mountSystemConfigRoutes(app);
mountSkipTracerV2Routes(app);
mountMapGeofencesRoutes(app);
mountMapSafetyRoutes(app);
mountCrmRoutes(app);
mountCrmLeadsRoutes(app);
mountCrmProposalsRoutes(app);
mountUserPreferencesRoutes(app);
mountCompanyDocumentsRoutes(app);
mountConnectionsRoutes(app);
mountDarRoutes(app);
mountVoiceRoutes(app);
mountPdfEngineRoutes(app);
mountIntegrationsRoutes(app);
mountInvoicesRoutes(app);
mountJailRosterRoutes(app);
mountClearpathgpsRoutes(app);
mountTraccarRoutes(app);
mountServemanagerRoutes(app);
mountMicrobiltRoutes(app);
mountSexOffenderRegistryRoutes(app);

// ─── SPA Fallback ────────────────────────────────────────
app.all('/api/*', (c) => {
  return c.json({ error: 'API endpoint not found' }, 404);
});

// ─── Global Error Handler ────────────────────────────────
app.onError((err, c) => {
  console.error('Unhandled error:', err?.message || err);
  console.error('Stack:', err?.stack);
  return c.json({ error: 'Internal server error', details: err?.message }, 500);
});

// ─── Export Worker ───────────────────────────────────────
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};