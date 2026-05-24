import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware/auth';
import { handleWebSocket } from './routes/ws';

import auth from './routes/auth';
import health from './routes/health';
import dispatchCalls from './routes/dispatch/calls';
import dispatchUnits from './routes/dispatch/units';
import dispatchGps from './routes/dispatch/gps';
import dispatchGeography from './routes/dispatch/geography';
import dispatchAggregates from './routes/dispatch/aggregates';
import admin from './routes/admin';
import personnel from './routes/personnel';
import presence from './routes/presence';
import properties from './routes/properties';
import records from './routes/records';
import mapData from './routes/mapData';
import stubs from './routes/stubs';
import warrants from './routes/warrants';
import { runUtahWarrantSmokePoll } from './utils/utahWarrantPoller';

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  MAP_DATA: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  PRIMARY_DOMAIN?: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: { user: { id: number; username: string; role: string; full_name: string }; userId: number } }>();

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

app.get('/', (c) => c.json({ name: 'RMPG Flex API', version: '1.0.0', status: 'running' }));

// Public routes
app.route('/api/health', health);
app.route('/api/auth', auth);
app.route('/api/map-data', mapData);

// Auth middleware for protected routes — must use /{path}/* pattern
// to match sub-paths (Hono glob * doesn't cross / boundaries)
app.use('/api/dispatch', authMiddleware);
app.use('/api/dispatch/calls/*', authMiddleware);
app.use('/api/dispatch/units/*', authMiddleware);
app.use('/api/dispatch/gps/*', authMiddleware);
app.use('/api/dispatch/geography/*', authMiddleware);
app.use('/api/admin', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/personnel', authMiddleware);
app.use('/api/personnel/*', authMiddleware);
app.use('/api/presence', authMiddleware);
app.use('/api/presence/*', authMiddleware);
app.use('/api/records', authMiddleware);
app.use('/api/records/*', authMiddleware);

app.route('/api/dispatch/calls', dispatchCalls);
app.route('/api/dispatch/units', dispatchUnits);
app.route('/api/dispatch/gps', dispatchGps);
app.route('/api/dispatch/geography', dispatchGeography);
app.route('/api/dispatch', dispatchAggregates);
app.route('/api/admin', admin);
app.route('/api/personnel', personnel);
app.route('/api/presence', presence);
app.route('/api/records/properties', properties);
app.route('/api/records', records);

// Stub endpoints for dashboard/feature compatibility
app.use('/api/user/*', authMiddleware);
app.use('/api/notifications/*', authMiddleware);
app.use('/api/reports/*', authMiddleware);
app.use('/api/comms/*', authMiddleware);
app.use('/api/warrants/*', authMiddleware);
app.use('/api/weather*', authMiddleware);
app.use('/api/email/*', authMiddleware);
app.use('/api/integrations/*', authMiddleware);
app.use('/api/dispatch/stats*', authMiddleware);
app.use('/api/dispatch/shift-handoff*', authMiddleware);
app.route('/api/user', stubs);
app.route('/api/notifications', stubs);
app.route('/api/reports', stubs);
app.route('/api/comms', stubs);
// Warrants — real implementation (warrant-watch runs + Utah smoke poll).
// Pulled out of the stubs catch-all 2026-05-24 so the dashboard widget +
// "Warrant Polling Status" admin tab show real data instead of stub 200s.
app.route('/api/warrants', warrants);
app.route('/api/weather', stubs);
app.route('/api/email', stubs);
app.route('/api/integrations', stubs);
app.route('/api/dispatch/stats', stubs);
app.route('/api/dispatch/shift-handoff', stubs);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ws') {
      return handleWebSocket(request, env);
    }
    return app.fetch(request, env, ctx);
  },

  // Cron-triggered Utah warrant smoke poll. Schedule defined in wrangler.toml
  // [[triggers]] crons. waitUntil ensures the poll finishes even though the
  // scheduled handler returns immediately. Errors are swallowed inside
  // runUtahWarrantSmokePoll so a single bad run can't crash the cron loop.
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runUtahWarrantSmokePoll(env.DB).catch((err) => {
        console.error('Utah warrant scheduled poll failed:', err);
      }),
    );
  },
};
