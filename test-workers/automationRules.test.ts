// Miniflare smoke test for the automation-rules CRUD API.
// Verifies that unauthenticated requests are rejected (401).
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

import { Hono } from 'hono';
import automationRules from '../src/routes/automationRules';
import { authMiddleware } from '../src/middleware/auth';

const app = new Hono<{ Bindings: typeof env }>();
app.use('/api/automation-rules', authMiddleware);
app.use('/api/automation-rules/*', authMiddleware);
app.route('/api/automation-rules', automationRules);

describe('automation-rules API', () => {
  it('GET /api/automation-rules returns 401 without auth', async () => {
    const req = new Request('http://localhost/api/automation-rules');
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });
});
