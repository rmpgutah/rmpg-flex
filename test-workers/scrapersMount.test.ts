// Genuine "is this route reachable through the REAL app" test — unlike the
// other test-workers/*.test.ts files (and tests/scrapers.test.ts), this does
// NOT build a standalone Hono app around the router in isolation. It imports
// `app` straight from src/index.ts, which is constructed from the real
// ROUTE_REGISTRY (src/routesConfig.ts) via the same iterator that runs in
// production. That's the only way to catch "router exists but was never
// mounted" — the exact bug this task fixes (scrapers.ts had 49 passing
// isolated-harness tests while being completely unreachable in prod).
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

describe('GET /api/warrants/scrapers — mounted via real ROUTE_REGISTRY', () => {
  it('is reached as a distinct route (401, not 404) with no auth token', async () => {
    const res = await app.request(
      '/api/warrants/scrapers',
      {},
      env as unknown as Record<string, unknown>,
    );
    // 401 proves the request reached authMiddleware for THIS specific mount
    // (registered via ROUTE_REGISTRY, auth: 'required'). A 404 would mean
    // the entry is missing/misordered and Hono's global 404 handler caught
    // it instead — that was the pre-fix behavior.
    expect(res.status).toBe(401);
  });

  it('/api/warrants/scrapers/health is also reached as a distinct route (401, not 404)', async () => {
    const res = await app.request(
      '/api/warrants/scrapers/health',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
  });

  it('the broader /api/warrants mount still works independently (401, not 404)', async () => {
    const res = await app.request(
      '/api/warrants',
      {},
      env as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
  });
});
