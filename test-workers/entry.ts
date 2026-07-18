// Minimal test worker for the Workers (Miniflare) vitest pool. Mounts routers
// with an injected operational user — real auth is applied per-prefix in
// src/index.ts (not inside the router), so routers are testable in isolation
// without booting the full app + its Durable Objects.
import { Hono } from 'hono';
import alpr from '../src/routes/alpr';
import redactions from '../src/routes/redactions';
import fieldPhotos from '../src/routes/fieldPhotos';
import radio from '../src/routes/radio';
import { bodycamVideosRouter } from '../src/routes/personnel/bodyCameras';
import '../src/routes/personnel/bodyCameraUploads'; // attaches handlers to bodycamVideosRouter

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  // Mirror authMiddleware: requireRole reads c.var.user.role; handlers read c.var.userId.
  c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/alpr', alpr);
app.route('/api/redactions', redactions);
app.route('/api/field-photos', fieldPhotos);
app.route('/api/radio', radio);
app.route('/api/personnel/bodycam-videos', bodycamVideosRouter);

export default app;
