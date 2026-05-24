// ============================================================
// Test App Factory
// Builds a minimal Express app that mirrors production routing
// but skips the HTTP listener, WebSocket server, and background
// schedulers. Each test file imports this to drive requests via
// supertest.
// ============================================================

import express from 'express';
import cors from 'cors';
import type { Application } from 'express';

/** Build a test Express app with the essential middleware + all routes. */
export async function createTestApp(): Promise<Application> {
  // Lazy-import route modules AFTER the test DB has been initialized.
  // Routes call getDb() at request time, not import time, so the order
  // matters: tests MUST call initDatabase() before hitting any route.
  const app = express();

  app.set('trust proxy', false);

  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request ID shim (some routes read this)
  app.use((req, _res, next) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || 'test';
    next();
  });

  // Import route modules — these call getDb() at request time, not import time
  const authRoutes = (await import('../../src/routes/auth')).default;
  const dispatchRoutes = (await import('../../src/routes/dispatch/index')).default;
  const incidentRoutes = (await import('../../src/routes/incidents')).default;
  const recordsRoutes = (await import('../../src/routes/records')).default;
  const businessVehiclesRoutes = (await import('../../src/routes/businessVehicles')).default;
  const subjectSearchRoutes = (await import('../../src/routes/subjectSearch')).default;
  const businessVisitsRoutes = (await import('../../src/routes/businessVisits')).default;
  const businessPhotosRoutes = (await import('../../src/routes/businessPhotos')).default;
  const citationRoutes = (await import('../../src/routes/citations')).default;
  const personnelRoutes = (await import('../../src/routes/personnel')).default;
  const mapGeofenceRoutes = (await import('../../src/routes/mapGeofences')).default;
  const warrantRoutes = (await import('../../src/routes/warrants')).default;
  const fleetRoutes = (await import('../../src/routes/fleet')).default;
  const hrRoutes = (await import('../../src/routes/hr')).default;
  const courtRoutes = (await import('../../src/routes/court')).default;
  const crmRoutes = (await import('../../src/routes/crm')).default;
  const crmLeadsRoutes = (await import('../../src/routes/crmLeads')).default;
  const voicePersonaRoutes = (await import('../../src/routes/voicePersona')).default;
  const connectionsRoutes = (await import('../../src/routes/connections')).default;
  const casesRoutes = (await import('../../src/routes/cases')).default;
  const serveIntakeRoutes = (await import('../../src/routes/serveIntake')).default;
  const documentIntakeRoutes = (await import('../../src/routes/documentIntake')).default;
  const fieldInterviewsRoutes = (await import('../../src/routes/fieldInterviews')).default;

  app.use('/api/auth', authRoutes);
  app.use('/api/dispatch', dispatchRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/records/subjects', subjectSearchRoutes);
  app.use('/api/records', recordsRoutes);
  app.use('/api/business-vehicles', businessVehiclesRoutes);
  app.use('/api/business-visits', businessVisitsRoutes);
  app.use('/api/business-photos', businessPhotosRoutes);
  app.use('/api/citations', citationRoutes);
  app.use('/api/personnel', personnelRoutes);
  app.use('/api/map-geofences', mapGeofenceRoutes);
  app.use('/api/warrants', warrantRoutes);
  app.use('/api/fleet', fleetRoutes);
  app.use('/api/hr', hrRoutes);
  app.use('/api/court', courtRoutes);
  app.use('/api/crm', crmRoutes);
  app.use('/api/crm-leads', crmLeadsRoutes);
  app.use('/api/voice-persona', voicePersonaRoutes);
  app.use('/api/connections', connectionsRoutes);
  app.use('/api/cases', casesRoutes);
  app.use('/api/serve-intake', serveIntakeRoutes);
  app.use('/api/document-intake', documentIntakeRoutes);
  app.use('/api/field-interviews', fieldInterviewsRoutes);

  // Error handler (multer-aware, mirrors production)
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.headersSent) {
      const status = err?.status || err?.statusCode || 500;
      res.status(status).json({ error: err?.message || 'Internal server error' });
    }
  });

  return app;
}
