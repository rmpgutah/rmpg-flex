// ============================================================
// RMPG Flex — Cloudflare Worker Entry Point
// ============================================================
// Bridges Express.js routes to Cloudflare Workers runtime.
// Uses Hono as the Workers-compatible router (Express cannot run
// natively in Workers due to Node.js API dependencies).
// ============================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';

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
  // In Workers, presence is tracked via Durable Objects or KV
  // For now, return empty — WebSocket presence requires Durable Objects
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

// ─── Auth Routes ─────────────────────────────────────────
import { mountAuthRoutes } from './routes/auth-worker';
import { mountDispatchRoutes } from './routes/dispatch-worker';
import { mountAdminRoutes } from './routes/admin-worker';
import { mountPersonnelRoutes } from './routes/personnel-worker';
import { mountWarrantRoutes } from './routes/warrants-worker';
import { mountIncidentRoutes } from './routes/incidents-worker';
import { mountRecordsRoutes } from './routes/records-worker';

mountAuthRoutes(app);
mountDispatchRoutes(app);
mountAdminRoutes(app);
mountPersonnelRoutes(app);
mountWarrantRoutes(app);
mountIncidentRoutes(app);
mountRecordsRoutes(app);

// ─── SPA Fallback ────────────────────────────────────────
// In production, the client is built and served via Pages or R2
// For now, return 404 for unmatched API routes
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
export default app;
