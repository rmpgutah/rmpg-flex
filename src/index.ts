import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './middleware/auth';
import { handleWebSocket, sendToUser, broadcastAll } from './routes/ws';
import { WelfareWatchDO } from './durable-objects/WelfareWatchDO';
import { PdfToolsContainer } from './containers/pdfToolsContainer';

// Export so wrangler can find the DO classes at build time. The Container
// subclass extends DurableObject and is configured by [[containers]] +
// [[durable_objects.bindings]] in wrangler.toml.
export { WelfareWatchDO, PdfToolsContainer };

import auth from './routes/auth';
import health from './routes/health';
import dispatchCalls from './routes/dispatch/calls';
import dispatchUnits from './routes/dispatch/units';
import dispatchGps from './routes/dispatch/gps';
import dispatchGeography from './routes/dispatch/geography';
import dispatchAggregates from './routes/dispatch/aggregates';
import dispatchPremiseHistory from './routes/dispatch/premiseHistory';
import geocode from './routes/geocode';
import trespassOrders from './routes/trespassOrders';
import dispatchPanic from './routes/dispatch/panic';
import dispatchCallLinks from './routes/dispatch/callLinks';
import admin from './routes/admin';
import personnel from './routes/personnel';
import presence from './routes/presence';
import properties from './routes/properties';
import records from './routes/records';
import subjects from './routes/records/subjects';
import mapData from './routes/mapData';
import stubs from './routes/stubs';
import runCards from './routes/runCards';
import nibrs from './routes/nibrs';
import welfare from './routes/welfare';
import incidentSupplements from './routes/incidentSupplements';
import incidentsRouter from './routes/incidents';
import warrants from './routes/warrants';
import pdfTools from './routes/pdfTools';
import documentIntake from './routes/documentIntake';
import documentFolders from './routes/documents/folders';
import audit from './routes/audit';
import arrests from './routes/arrests';
import fieldInterviews from './routes/fieldInterviews';
import businessVehicles from './routes/business/vehicles';
import businessVisits from './routes/business/visits';
import businessPhotos from './routes/business/photos';
import { runUtahWarrantScan } from './utils/utahWarrantPoller';
import {
  recommendedUnits,
  audioMode,
  premiseAlerts,
  callWarnings,
  unitStatus,
  bolos as bolosRouter,
  welfareActive,
} from './routes/dispatch/extensions';

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  MAP_DATA: R2Bucket;
  UPLOADS: R2Bucket;
  JWT_SECRET: string;
  CORS_ORIGINS?: string;
  PRIMARY_DOMAIN?: string;
  // Mirrors src/types.ts Bindings — kept here so the local Hono<{ Bindings }>
  // type matches what wrangler exposes at runtime.
  WELFARE_WATCH?: DurableObjectNamespace;
  PDF_TOOLS: DurableObjectNamespace<PdfToolsContainer>;
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

// Global error handler — surfaces the route + raw message for any
// uncaught throw inside a route handler. Without this, Hono's default
// just returns a 500 with the text "Internal Server Error" and we
// lose the actual D1 / SQL message. Several dispatch routes (the
// callLinks attach handlers in particular) INSERT without try/catch,
// so any FK violation there used to surface as a generic 500 with no
// detail. Now the client sees:
//   { error: "Internal server error",
//     code: "UNHANDLED",
//     route: "POST /api/dispatch/calls/:id/persons",
//     detail: "D1_ERROR: FOREIGN KEY constraint failed ..." }
// and the dispatcher can read the FK breakdown directly from the
// toast (apiFetch concatenates error + detail with ": ").
app.onError((err, c) => {
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const route = `${method} ${path}`;
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`Unhandled in ${route}:`, err);
  return c.json({
    error: 'Internal server error',
    code: 'UNHANDLED',
    route,
    detail,
  }, 500);
});

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
app.use('/api/dispatch/run-cards', authMiddleware);
app.use('/api/dispatch/run-cards/*', authMiddleware);
app.use('/api/dispatch/welfare', authMiddleware);
app.use('/api/dispatch/welfare/*', authMiddleware);
app.use('/api/dispatch/premise-alerts', authMiddleware);
app.use('/api/dispatch/premise-alerts/*', authMiddleware);
app.use('/api/dispatch/bolos', authMiddleware);
app.use('/api/dispatch/bolos/*', authMiddleware);
app.use('/api/dispatch/panic', authMiddleware);
app.use('/api/dispatch/panic/*', authMiddleware);
app.use('/api/dispatch/premise-history', authMiddleware);
app.use('/api/dispatch/premise-history/*', authMiddleware);
app.use('/api/nibrs', authMiddleware);
app.use('/api/nibrs/*', authMiddleware);
app.use('/api/incidents', authMiddleware);
app.use('/api/incidents/*', authMiddleware);
app.use('/api/admin', authMiddleware);
app.use('/api/admin/*', authMiddleware);
app.use('/api/personnel', authMiddleware);
app.use('/api/personnel/*', authMiddleware);
app.use('/api/presence', authMiddleware);
app.use('/api/presence/*', authMiddleware);
app.use('/api/records', authMiddleware);
app.use('/api/records/*', authMiddleware);

// callLinks + panic mount at /api/dispatch with /calls/:id/persons,
// /vehicles, /property, and /panic routes. MUST mount BEFORE
// dispatchCalls so longer-prefix routes match first — same trie
// collision rule the extensions block below documents.
app.route('/api/dispatch', dispatchCallLinks);
app.route('/api/dispatch', dispatchPanic);
app.route('/api/dispatch', dispatchPremiseHistory);
app.route('/api/dispatch/calls', dispatchCalls);
app.route('/api/dispatch/units', dispatchUnits);
app.route('/api/dispatch/gps', dispatchGps);
app.route('/api/dispatch/geography', dispatchGeography);
app.route('/api/dispatch', dispatchAggregates);
app.route('/api/admin', admin);
app.route('/api/personnel', personnel);
app.route('/api/presence', presence);
app.route('/api/records/properties', properties);
// subjects MUST mount BEFORE records so /api/records/subjects/search
// matches this router, not the records catch-all. Same pattern as
// /api/records/properties above.
app.route('/api/records/subjects', subjects);
app.route('/api/records', records);
app.route('/api/dispatch/run-cards', runCards);
app.route('/api/dispatch/welfare', welfare);
// Dispatch extensions — Spillman-parity gaps filled in DEV-1..7:
//   recommendedUnits  → GET /api/dispatch/calls/:id/recommended-units
//   audioMode         → GET /api/dispatch/units/mine/audio-mode
//                       PUT /api/dispatch/units/:id/audio-mode
//   premiseAlerts     → GET/POST/PUT/DELETE /api/dispatch/premise-alerts
//                       GET /api/dispatch/premise-alerts/near/scan
//   callWarnings      → GET /api/dispatch/calls/:id/warnings
//   unitStatus        → PUT /api/dispatch/units/:id/status
//   bolosRouter       → GET/POST/PUT/DELETE /api/dispatch/bolos
//   welfareActive     → GET /api/dispatch/welfare/active
// IMPORTANT: extensions mount BEFORE the existing calls/units routers
// so the more-specific paths (/calls/:id/recommended-units,
// /units/:id/status, /units/:id/audio-mode) match first.
app.route('/api/dispatch/calls', recommendedUnits);
app.route('/api/dispatch/calls', callWarnings);
app.route('/api/dispatch/units', audioMode);
app.route('/api/dispatch/units', unitStatus);
app.route('/api/dispatch/premise-alerts', premiseAlerts);
app.route('/api/dispatch/bolos', bolosRouter);
app.route('/api/dispatch/welfare', welfareActive);
app.route('/api/nibrs', nibrs);
// IMPORTANT: incidentsRouter MUST mount BEFORE incidentSupplements.
// Both share the /api/incidents prefix; supplements catches paths like
// /:id/supplements/{dv,pursuit}, while incidentsRouter handles /:id and
// /:id/{submit,approve,return}. Hono dispatches in registration order,
// so the more-specific supplements router has to come second to let
// incidentsRouter's exact patterns match first.
app.route('/api/incidents', incidentsRouter);
app.route('/api/incidents', incidentSupplements);

// Business records cluster — PR-E. Migration 0023_business_records
// creates the businesses + business_vehicles + business_visits +
// business_photos + call_businesses tables. Photos route is
// R2-backed (UPLOADS bucket, business-photos/ prefix); the streamer
// at /api/business-photos/file/:key{.+} flows through the Worker
// so premise photos stay auth-gated.
app.use('/api/business-vehicles', authMiddleware);
app.use('/api/business-vehicles/*', authMiddleware);
app.use('/api/business-visits', authMiddleware);
app.use('/api/business-visits/*', authMiddleware);
app.use('/api/business-photos', authMiddleware);
app.use('/api/business-photos/*', authMiddleware);
app.route('/api/business-vehicles', businessVehicles);
app.route('/api/business-visits', businessVisits);
app.route('/api/business-photos', businessPhotos);

// Stub endpoints for dashboard/feature compatibility
app.use('/api/user/*', authMiddleware);
app.use('/api/notifications/*', authMiddleware);
app.use('/api/reports/*', authMiddleware);
app.use('/api/comms/*', authMiddleware);
app.use('/api/warrants/*', authMiddleware);
app.use('/api/weather*', authMiddleware);
app.use('/api/email/*', authMiddleware);
app.use('/api/integrations/*', authMiddleware);
// Audit log viewer + retention. Route module enforces admin OR manager
// at the role level; destructive endpoints (retention/enforce, retention/
// policy PUT, compress, index-stats) further restrict to admin.
app.use('/api/audit', authMiddleware);
app.use('/api/audit/*', authMiddleware);
app.route('/api/audit', audit);
// Arrests — manual booking subset only. JailBase poller endpoints
// (credentials/toggle/poller/sync/etc) deferred to Phase 2 per plan.
// Inline role checks inside the route file (officer+ for most writes,
// admin/manager for delete, supervisor+ for CSV export).
app.use('/api/arrests', authMiddleware);
app.use('/api/arrests/*', authMiddleware);
app.route('/api/arrests', arrests);
// Document folders — hierarchical browser backed by document_folders +
// attachments. Migration 0024_document_folders adds the folders table
// + a folder_id column to attachments (NULL = unfoldered, legacy).
app.use('/api/documents', authMiddleware);
app.use('/api/documents/*', authMiddleware);
app.route('/api/documents', documentFolders);
// Field interviews — officer-initiated contact records with GPS,
// subject details, vehicle, disposition. Migration 0025_field_interviews.
// DELETE + /export/csv enforce role checks inside the route module.
app.use('/api/field-interviews', authMiddleware);
app.use('/api/field-interviews/*', authMiddleware);
app.route('/api/field-interviews', fieldInterviews);
// geocode proxy — must mount BEFORE the /api/integrations stubs
// catch-all so /api/integrations/mapbox/client-token resolves here
// instead of returning a stub. /api/geocode/search is the Nominatim
// fallback used when no Mapbox token is configured.
app.use('/api/geocode', authMiddleware);
app.use('/api/geocode/*', authMiddleware);
app.route('/api', geocode);

// Trespass orders — minimal stub so PremiseHistory's defensive
// fetch returns 200 instead of 500/404. Full implementation TBD.
app.use('/api/trespass-orders', authMiddleware);
app.use('/api/trespass-orders/*', authMiddleware);
app.route('/api/trespass-orders', trespassOrders);
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

// PDF Tools (qpdf) + Document Intake (pdftotext + ocrmypdf) — both proxy
// to the PdfToolsContainer sidecar. Auth required; per-endpoint role gates
// inside the route files (encrypt = admin/manager, extract-text = officer+).
app.use('/api/pdf-tools/*', authMiddleware);
app.use('/api/document-intake/*', authMiddleware);
app.route('/api/pdf-tools', pdfTools);
app.route('/api/document-intake', documentIntake);

// ─── Internal: WelfareWatchDO → Worker callback ──────────
// The DO's alarm() can't call sendToUser/broadcastAll directly
// (those live in the Worker module's per-isolate state). Instead
// it posts to /__welfare-fire authenticated by X-DO-Secret == JWT_SECRET.
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

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/ws') {
      return handleWebSocket(request, env);
    }
    return app.fetch(request, env, ctx);
  },

  // Cron-triggered Utah warrant scan. Schedule defined in wrangler.toml
  // [[triggers]] crons. waitUntil ensures the scan finishes even though
  // the scheduled handler returns immediately. Errors are swallowed inside
  // runUtahWarrantScan so a single bad run can't crash the cron loop.
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runUtahWarrantScan(env.DB).catch((err) => {
        console.error('Utah warrant scheduled scan failed:', err);
      }),
    );
  },
};
