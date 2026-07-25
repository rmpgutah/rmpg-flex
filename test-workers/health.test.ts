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

  // The Miniflare env can NEVER produce status:'ok' — d1, map_data, downloads and
  // all six DO namespaces probe as disconnected here, so every test above only
  // ever exercises the 'degraded' response. Prod serves 'ok'. That asymmetry is
  // how a field added to only one of two duplicated payload literals shipped
  // invisibly (2026-07-24). The payload is now built once and shared, and this
  // fixture pins the 'ok' branch so the two can never silently diverge again.
  const healthyEnv = () => {
    const row = <T,>(v: T) => ({ first: async () => v, bind: () => ({ first: async () => v }) });
    return {
      ...(env as unknown as Record<string, unknown>),
      DB: {
        prepare: (sql: string) => (sql.includes('system_config')
          ? row({ value: '1.2.3' })
          : row({ count: 5 })),
      },
      KV: { get: async () => null },
      MAP_DATA: { head: async () => null },
      UPLOADS: { head: async () => null },
      DOWNLOADS: { head: async () => null },
      KIOSK_DEVICES: { head: async () => null },
      WELFARE_WATCH: { idFromName: () => ({}) },
      VOICE_HUB: { idFromName: () => ({}) },
      ALERT_HUB: { idFromName: () => ({}) },
      DEEP_RESEARCH: { idFromName: () => ({}) },
      PERSON_INTEL_DO: { idFromName: () => ({}) },
      FLEXCAM_REMUX: { idFromName: () => ({}) },
    };
  };

  describe("status:'ok' branch (what prod actually serves)", () => {
    it('reports ok when every service is reachable', async () => {
      const res = await app.request('/api/health', {}, healthyEnv());
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });

    it('includes kiosk_devices in the ok payload, not just the degraded one', async () => {
      const res = await app.request('/api/health', {}, healthyEnv());
      const body = await res.json() as {
        status: string;
        services: { kiosk_devices?: { connected: boolean } };
      };
      expect(body.status).toBe('ok');
      expect(body.services.kiosk_devices).toBeDefined();
      expect(body.services.kiosk_devices!.connected).toBe(true);
    });

    it('emits an identical services key set in both ok and degraded responses', async () => {
      const okRes = await app.request('/api/health', {}, healthyEnv());
      const okBody = await okRes.json() as { status: string; services: Record<string, unknown> };
      const degradedRes = await app.request('/api/health', {}, env as unknown as Record<string, unknown>);
      const degradedBody = await degradedRes.json() as { status: string; services: Record<string, unknown> };

      // guard: the two requests must actually hit different branches
      expect(okBody.status).toBe('ok');
      expect(degradedBody.status).toBe('degraded');

      expect(Object.keys(okBody.services).sort()).toEqual(Object.keys(degradedBody.services).sort());
    });
  });

  // kiosk_devices is an OPTIONAL binding and is deliberately report-only: it
  // appears in `services` but must never move `status` to 'degraded', in any of
  // its three states. See the comment above `allOk` in src/routes/health.ts.
  describe('kiosk_devices — optional binding, report-only', () => {
    const baseStatus = async (overrides?: Record<string, unknown>) => {
      const testEnv = { ...(env as unknown as Record<string, unknown>), ...overrides };
      const res = await app.request('/api/health', {}, testEnv);
      return res.json() as Promise<{
        status: string;
        services: { kiosk_devices: { connected: boolean; bound?: boolean } };
      }>;
    };

    it('reports kiosk_devices in the services payload', async () => {
      const body = await baseStatus();
      expect(body.services.kiosk_devices).toBeDefined();
      expect(typeof body.services.kiosk_devices.connected).toBe('boolean');
    });

    it('marks an unbound bucket bound:false without degrading status', async () => {
      const withStatus = await baseStatus();
      const body = await baseStatus({ KIOSK_DEVICES: undefined });
      expect(body.services.kiosk_devices.connected).toBe(false);
      expect(body.services.kiosk_devices.bound).toBe(false);
      // status must match the unmodified run — the absent binding changed nothing
      expect(body.status).toBe(withStatus.status);
    });

    it('does not degrade status when a bound bucket throws (R2 auth failure)', async () => {
      const withStatus = await baseStatus();
      const throwingBucket = {
        head: () => { throw new Error('Authentication error [code: 10000]'); },
      };
      const body = await baseStatus({ KIOSK_DEVICES: throwingBucket });
      expect(body.services.kiosk_devices.connected).toBe(false);
      // bound:false is reserved for absent bindings — this one exists, it failed
      expect(body.services.kiosk_devices.bound).toBeUndefined();
      expect(body.status).toBe(withStatus.status);
    });
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
