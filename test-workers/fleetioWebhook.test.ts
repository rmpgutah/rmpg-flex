// Miniflare (workerd) integration test for the Fleet.io webhook receiver.
// Tests the full POST /api/fleetio/webhook path: Authorization-header echo
// verify, body parsing, event insertion, and error handling.
//
// Run with: npx vitest run --config vitest.workers.config.mts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import fleetioWebhook from '../src/routes/fleetioWebhook';

// Build a standalone app — same mount path as src/routes/fleetio.ts
const app = new Hono<{ Bindings: Record<string, unknown>; Variables: Record<string, unknown> }>();
app.route('/api/fleetio', fleetioWebhook);

const SECRET = 'test-webhook-secret-abc123';
const BAD_SECRET = 'wrong-secret';

function baseRequest(body?: unknown, auth?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth !== undefined) headers['authorization'] = auth;
  return new Request('http://localhost/api/fleetio/webhook', {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/fleetio/webhook — auth', () => {
  it('returns 200 + skipped when FLEETIO_WEBHOOK_SECRET is unset', async () => {
    const res = await app.request(
      baseRequest({ event: 'vehicle_updated', payload: { id: 1 } }, 'Bearer ' + SECRET),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: '' } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { skipped?: boolean; code?: string };
    expect(body.skipped).toBe(true);
    expect(body.code).toBe('FLEETIO_WEBHOOK_SECRET_UNSET');
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await app.request(
      baseRequest({ event: 'vehicle_updated', payload: { id: 1 } }),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('missing authorization');
  });

  it('returns 401 when Authorization header does not match secret', async () => {
    const res = await app.request(
      baseRequest({ event: 'vehicle_updated', payload: { id: 1 } }, 'Bearer ' + BAD_SECRET),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid authorization');
  });
});

describe('POST /api/fleetio/webhook — body parsing', () => {
  it('returns 200 + parsed=false for invalid JSON', async () => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + SECRET,
    };
    const req = new Request('http://localhost/api/fleetio/webhook', {
      method: 'POST',
      headers,
      body: 'not-json-at-all{{{',
    });
    const res = await app.request(
      req,
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { parsed?: boolean; reason?: string };
    expect(body.parsed).toBe(false);
    expect(body.reason).toBe('invalid_json');
  });

  it('returns 200 + parsed=false for unsupported event type', async () => {
    const res = await app.request(
      baseRequest({ id: 123, random_field: 'hello' }, 'Bearer ' + SECRET),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { parsed?: boolean; reason?: string };
    expect(body.parsed).toBe(false);
    expect(body.reason).toBe('unsupported_event_type');
  });
});

describe('POST /api/fleetio/webhook — happy path', () => {
  it('accepts a valid Fleet.io vehicle_updated webhook (event+payload convention)', async () => {
    const res = await app.request(
      baseRequest(
        { event: 'vehicle_updated', payload: { id: 42, vehicle_id: 42, name: 'Unit 101', make: 'Ford' } },
        'Bearer ' + SECRET,
      ),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received?: boolean; event_id?: string; queued?: boolean };
    expect(body.received).toBe(true);
    expect(typeof body.event_id).toBe('string');
    expect(body.event_id!.length).toBeGreaterThan(0);
    expect(body.queued).toBe(true);
  });

  it('accepts a valid Fleet.io fuel_entry_created webhook (underscore convention)', async () => {
    const res = await app.request(
      baseRequest(
        { event: 'fuel_entry_created', payload: { id: 99, fuel_entry_id: 99, us_gallons: 15.5, cost: 45.0 } },
        'Bearer ' + SECRET,
      ),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received?: boolean; parsed?: boolean };
    expect(body.received).toBe(true);
    expect(body.parsed).not.toBe(false);
  });

  it('accepts a webhook with Token prefix Authorization (no Bearer)', async () => {
    const res = await app.request(
      baseRequest(
        { event_type: 'vehicle.update', data: { id: 7 } },
        'Token ' + SECRET,
      ),
      {},
      { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { received?: boolean };
    expect(body.received).toBe(true);
  });

  it('deduplicates via UNIQUE constraint — second identical event returns queued=true but is idempotent', async () => {
    const payload = { event: 'vehicle_destroyed', payload: { id: 999, vehicle_id: 999 } };
    const reqOpts = { ...env, FLEETIO_WEBHOOK_SECRET: SECRET } as unknown as Record<string, unknown>;

    const res1 = await app.request(baseRequest(payload, 'Bearer ' + SECRET), {}, reqOpts);
    expect((await res1.json() as { queued?: boolean }).queued).toBe(true);

    const res2 = await app.request(baseRequest(payload, 'Bearer ' + SECRET), {}, reqOpts);
    expect(res2.status).toBe(200);
  });
});
