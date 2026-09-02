// Minimal test worker for the Workers (Miniflare) vitest pool. Mounts routers
// with an injected operational user — real auth is applied per-prefix in
// src/index.ts (not inside the router), so routers are testable in isolation
// without booting the full app + its Durable Objects.
import { Hono } from 'hono';
import alpr from '../src/routes/alpr';
import redactions from '../src/routes/redactions';
import fieldPhotos from '../src/routes/fieldPhotos';
import radio from '../src/routes/radio';
import intel from '../src/routes/intel';
import citations from '../src/routes/citations';
import { bodycamVideosRouter } from '../src/routes/personnel/bodyCameras';
import '../src/routes/personnel/bodyCameraUploads'; // attaches handlers to bodycamVideosRouter
import uploads from '../src/routes/uploads';
import inspections from '../src/routes/inspections';
import businessPhotos from '../src/routes/business/photos';
import propertyPhotos from '../src/routes/property/photos';
import workOrders from '../src/routes/workOrders';
import serveIntake from '../src/routes/serveIntake';
import evidence from '../src/routes/evidence';
import records from '../src/routes/records';
import reports from '../src/routes/reports';
import dailyEmailAdmin from '../src/routes/dailyEmailAdmin';
import { authMiddleware } from '../src/middleware/auth';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  // Mirror authMiddleware: requireRole reads c.var.user.role; handlers read c.var.userId.
  c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
// Mirror src/index.ts: convert uncaught handler throws into 500 responses so
// workerd/vitest does not treat them as process-killing unhandled rejections.
app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: message }, 500);
});
app.route('/api/alpr', alpr);
app.route('/api/redactions', redactions);
app.route('/api/field-photos', fieldPhotos);
app.route('/api/radio', radio);
app.route('/api/intel', intel);
app.route('/api/citations', citations);
app.route('/api/personnel/bodycam-videos', bodycamVideosRouter);
app.route('/api/uploads', uploads);
app.route('/api/inspections', inspections);
app.route('/api/business-photos', businessPhotos);
app.route('/api/property-photos', propertyPhotos);
app.route('/api/work-orders', workOrders);
app.route('/api/serve-intake', serveIntake);
app.route('/api/evidence', evidence);
app.route('/api/records', records);

// /api/reports is mounted with the REAL authMiddleware (not the fake-user
// stub above) so dailyReports.test.ts can exercise real JWT + role-based
// gating end-to-end via SELF.fetch, matching how src/index.ts mounts it
// in production. The stub middleware above still runs first (registered
// earlier) but authMiddleware overwrites c.var.user/userId with the real,
// DB-backed identity once a valid token is presented.
app.use('/api/reports/*', authMiddleware);
app.route('/api/reports', reports);

// Daily email admin — mounted with real authMiddleware for role-based gating.
app.use('/api/admin/daily-email/*', authMiddleware);
app.route('/api/admin/daily-email', dailyEmailAdmin);

export default app;
