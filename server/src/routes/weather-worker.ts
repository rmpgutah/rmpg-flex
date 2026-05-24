// ============================================================
// RMPG Flex — Weather route (cutover-parity stub)
// ============================================================
// The /src/ Worker exposed `GET /api/weather` as a hardcoded stub
// returning `{ temperature: 72, conditions: 'Clear', icon: 'clear-day' }`.
// Preserving the contract on cutover so the client dashboard widget
// doesn't 404. Real implementation (NWS API, etc) is a separate task.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';

export function mountWeatherRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/', async (c) => c.json({
    temperature: 72,
    conditions: 'Clear',
    icon: 'clear-day',
  }));

  app.route('/api/weather', api);
}
