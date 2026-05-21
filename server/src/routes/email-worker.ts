// Email routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';

export function mountEmailRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /api/email/status
  api.get('/status', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const config = await db.prepare("SELECT config_value FROM system_config WHERE config_key = 'email_configured'").get() as any;
      return c.json({ configured: config?.config_value === 'true' || false });
    } catch { return c.json({ configured: false }); }
  });

  // GET /api/email/oauth-url
  api.get('/oauth-url', requireRole('admin'), async (c) => {
    return c.json({ url: null, error: 'OAuth not configured' });
  });

  // GET /api/email/rules
  const rulesApi = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  rulesApi.use('/*', authenticateToken);

  rulesApi.get('/', async (c) => {
    const db = new D1Db(c.env.DB);
    try {
      const rows = await db.prepare('SELECT * FROM email_rules ORDER BY created_at DESC').all();
      return c.json(rows);
    } catch { return c.json([]); }
  });

  app.route('/api/email', api);
  app.route('/api/email/rules', rulesApi);
}
