// Route-level smoke test (Miniflare/workerd) for GET /api/health.
// Verifies the enhanced multi-service health probe returns valid
// JSON for all bound services (D1, KV, R2, DOs).
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Build a standalone health app — the test entry.ts doesn't mount health
import health from '../src/routes/health';

// Re-use the same auth pattern from entry.ts
import { Hono } from 'hono';
const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-officer' });
  c.set('userId', 1);
  await next();
});
app.route('/api/health', health);

describe('GET /api/health — multi-service health probe', () => {
  it('returns 200 with service status', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      version: string;
      services: Record<string, { connected: boolean }>;
    };
    // In Miniflare, D1 and KV are always connected; R2 depends on mock setup
    expect(body.version).toBe('1.0.0');
    expect(body.services.d1).toBeDefined();
    expect(body.services.kv).toBeDefined();
    expect(body.services.map_data).toBeDefined();
    expect(body.services.uploads).toBeDefined();
    expect(body.services.downloads).toBeDefined();
  });

  it('reports D1 user count', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { services: { d1: { users: number } } };
    expect(typeof body.services.d1.users).toBe('number');
  });

  it('reports D1 latency', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { services: { d1: { latencyMs?: number } } };
    expect(body.services.d1.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports KV latency', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { services: { kv: { latencyMs?: number } } };
    expect(body.services.kv.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns timestamp in ISO 8601 format', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { timestamp: string };
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes Durable Object status', async () => {
    const res = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
    const body = await res.json() as { services: { durable_objects: Record<string, { connected: boolean }> } };
    expect(body.services.durable_objects).toBeDefined();
    expect(body.services.durable_objects.welfare_watch).toBeDefined();
    expect(body.services.durable_objects.voice_hub).toBeDefined();
    expect(body.services.durable_objects.alert_hub).toBeDefined();
    expect(body.services.durable_objects.deep_research).toBeDefined();
    expect(body.services.durable_objects.person_intel).toBeDefined();
    expect(body.services.durable_objects.flexcam_remux).toBeDefined();
  });
});
