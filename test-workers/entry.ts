// Minimal test worker for the Workers (Miniflare) vitest pool. Mounts ONLY the
// ALPR router with an injected operational user — real auth is applied per-prefix
// in src/index.ts (not inside the router), so the router itself is testable in
// isolation without booting the full app + its Durable Objects.
import { Hono } from 'hono';
import alpr from '../src/routes/alpr';
import redactions from '../src/routes/redactions';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  // Mirror authMiddleware: requireRole reads c.var.user.role; handlers read c.var.userId.
  c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/alpr', alpr);
app.route('/api/redactions', redactions);

export default app;
