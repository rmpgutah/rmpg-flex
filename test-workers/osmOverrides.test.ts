// Route-level tests (Miniflare/workerd) for RMPG's internal edit layer over
// the OSM overlays.
//
// The OSM overlays are served from immutable PMTiles archives in R2, so a
// feature cannot be edited in place — and anything written into an archive
// would be destroyed by the next extract rebuild. Overrides are stored
// separately, keyed by the OpenStreetMap element id the pipeline stamps onto
// every feature, which is stable across rebuilds.
//
// Mounts the router directly (the repo's convention for these tests) so the
// route's own validation and role guard are exercised. Path-prefix auth lives
// in routesConfig, not in the router, so 401 is not testable from here.
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import osmOverrides from '../src/routes/osmOverrides';

interface Row { [k: string]: unknown }

/** Minimal D1 stand-in backed by a Map keyed on osm_id, so the UNIQUE-index
 *  upsert semantics the route depends on are actually represented. A stub that
 *  quietly appended rows would hide a duplicate-row bug. */
function fakeDb(store: Map<string, Row>, opts: { throwOn?: RegExp } = {}) {
  return {
    prepare(sql: string) {
      const bindings: unknown[] = [];
      const api = {
        bind(...args: unknown[]) { bindings.push(...args); return api; },
        async first<T>() {
          if (opts.throwOn?.test(sql)) throw new Error('simulated D1 failure');
          const id = String(bindings[0] ?? '');
          return (store.get(id) as T) ?? null;
        },
        async all<T>() {
          if (opts.throwOn?.test(sql)) throw new Error('simulated D1 failure');
          return { results: [...store.values()] as T[] };
        },
        async run() {
          if (opts.throwOn?.test(sql)) throw new Error('simulated D1 failure');
          if (/^\s*DELETE/i.test(sql)) {
            const id = String(bindings[0] ?? '');
            const had = store.delete(id);
            return { meta: { changes: had ? 1 : 0 } };
          }
          // INSERT ... ON CONFLICT(osm_id) DO UPDATE — upsert by key.
          const [osm_id, osm_group, osm_cat, note, field_overrides, hidden, verified] = bindings;
          store.set(String(osm_id), {
            osm_id, osm_group, osm_cat, note, field_overrides,
            hidden, verified,
            verified_at: verified === 1 ? '2026-08-02 00:00:00' : null,
            verified_by: verified === 1 ? 42 : null,
            updated_at: '2026-08-02 00:00:00',
          });
          return { meta: { changes: 1 } };
        },
      };
      return api;
    },
  };
}

function makeApp(store: Map<string, Row>, user: Record<string, unknown>, dbOpts = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('user' as never, user as never);
    await next();
  });
  app.route('/api/osm-overrides', osmOverrides as never);
  // Hono takes the env as the THIRD argument to request(); assigning to c.env
  // inside middleware throws because it is undefined until one is supplied.
  const env = { DB: fakeDb(store, dbOpts) };
  return {
    request: (path: string, init?: RequestInit) => app.request(path, init, env as never),
  };
}

const OFFICER = { id: 42, username: 'officer', role: 'officer' };
const VIEWER = { id: 43, username: 'viewer', role: 'client_viewer' };

let store: Map<string, Row>;
beforeEach(() => { store = new Map(); });

describe('osm_id validation', () => {
  it('rejects anything that is not an OSM element id', async () => {
    const app = makeApp(store, OFFICER);
    for (const bad of ['abc', '123', 'x123', 'n', 'n12a', 'n' + '9'.repeat(25)]) {
      const res = await app.request(`/api/osm-overrides/${encodeURIComponent(bad)}`);
      expect(res.status, `should reject "${bad}"`).toBe(400);
    }
  });

  it('accepts node, way and relation ids', async () => {
    const app = makeApp(store, OFFICER);
    for (const ok of ['n83099358', 'w1234', 'r99']) {
      const res = await app.request(`/api/osm-overrides/${ok}`);
      expect(res.status, ok).toBe(200);
    }
  });
});

describe('read-only role guard', () => {
  it('refuses a write', async () => {
    const app = makeApp(store, VIEWER);
    const res = await app.request('/api/osm-overrides/n83099358', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'safety', note: 'should not persist' }),
    });
    expect(res.status).toBe(403);
    expect(store.size, 'nothing may be written').toBe(0);
  });

  it('refuses a delete', async () => {
    store.set('n83099358', { osm_id: 'n83099358' });
    const app = makeApp(store, VIEWER);
    const res = await app.request('/api/osm-overrides/n83099358', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(store.has('n83099358'), 'nothing may be deleted').toBe(true);
  });
});

describe('PUT validation', () => {
  const put = (body: unknown, user = OFFICER) =>
    makeApp(store, user).request('/api/osm-overrides/n83099358', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('requires a group', async () => {
    expect((await put({ note: 'no group' })).status).toBe(400);
  });

  it('rejects a malformed JSON body rather than 500ing', async () => {
    expect((await put('{not json')).status).toBe(400);
  });

  it('rejects non-scalar field overrides', async () => {
    // The display-time merge is a flat key/value overlay; a nested value could
    // not be rendered and would silently do nothing.
    expect((await put({ group: 'safety', fields: { colour: { n: 1 } } })).status).toBe(400);
  });

  it('rejects fields sent as an array', async () => {
    expect((await put({ group: 'safety', fields: ['colour', 'red'] })).status).toBe(400);
  });

  it('rejects an oversized note instead of truncating it silently', async () => {
    expect((await put({ group: 'safety', note: 'x'.repeat(4001) })).status).toBe(400);
  });

  it('rejects an absurd number of field overrides', async () => {
    const fields = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`k${i}`, 'v']));
    expect((await put({ group: 'safety', fields })).status).toBe(400);
  });
});

describe('upsert behaviour', () => {
  it('stores an override and returns it parsed', async () => {
    const app = makeApp(store, OFFICER);
    const res = await app.request('/api/osm-overrides/n83099358', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group: 'safety', cat: 'hydrant', note: 'Capped — out of service',
        fields: { colour: 'red' }, verified: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { override: Record<string, unknown> };
    expect(body.override.osm_id).toBe('n83099358');
    expect(body.override.note).toBe('Capped — out of service');
    // fields must arrive parsed — the client should never JSON.parse a column.
    expect(body.override.fields).toEqual({ colour: 'red' });
    expect(body.override.verified).toBe(true);
  });

  it('is idempotent on osm_id — a second edit updates, never duplicates', async () => {
    const app = makeApp(store, OFFICER);
    const send = (note: string) => app.request('/api/osm-overrides/n83099358', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'safety', note }),
    });
    await send('first');
    await send('second');
    expect(store.size, 'one row per feature').toBe(1);
    expect((store.get('n83099358') as Row).note).toBe('second');
  });

  it('coerces scalar field values to strings so the overlay stays flat', async () => {
    const app = makeApp(store, OFFICER);
    await app.request('/api/osm-overrides/n1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: 'safety', fields: { couplings: 2, ok: true } }),
    });
    const stored = JSON.parse(String((store.get('n1') as Row).field_overrides));
    expect(stored).toEqual({ couplings: '2', ok: 'true' });
  });
});

describe('resilience', () => {
  it('degrades to an empty object when a stored override is corrupt', async () => {
    // A malformed row must not break the map render path.
    store.set('n1', {
      osm_id: 'n1', osm_group: 'safety', osm_cat: null, note: null,
      field_overrides: '{not json', hidden: 0, verified: 0,
      verified_at: null, verified_by: null, updated_at: '2026-08-02 00:00:00',
    });
    const res = await makeApp(store, OFFICER).request('/api/osm-overrides/n1');
    expect(res.status).toBe(200);
    const body = await res.json() as { override: { fields: unknown } };
    expect(body.override.fields).toEqual({});
  });

  it('returns 500 with a message rather than throwing out of the route', async () => {
    const app = makeApp(store, OFFICER, { throwOn: /SELECT/ });
    const res = await app.request('/api/osm-overrides/n83099358');
    expect(res.status).toBe(500);
  });

  it('reports null for a feature with no override', async () => {
    const res = await makeApp(store, OFFICER).request('/api/osm-overrides/n404');
    expect(res.status).toBe(200);
    expect((await res.json() as { override: unknown }).override).toBeNull();
  });
});
