import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import osUpdates from '../src/routes/osUpdates';

/**
 * The promote gate is the highest-consequence code in the OS update path: a
 * mistake here reboots every terminal in the fleet into an untested image. These
 * tests pin the guards that make that impossible by accident.
 *
 * These tests drive the REAL authMiddleware — a signed JWT plus a users-table
 * lookup — rather than injecting `c.get('user')` directly. That distinction is
 * the whole point: the earlier version of this file set `user` from its own
 * middleware, which no longer resembled production once the router was mounted
 * `auth: 'public'`. Nothing populated `user` there, so /os/promote answered 403
 * to admins and officers alike, and all twelve tests still passed — a green
 * suite certifying a gate that could never be opened. Fabricating a precondition
 * production cannot produce does not merely miss a bug; it endorses it.
 */

function bucket(objects: Record<string, string>) {
  return {
    get: async (key: string) =>
      key in objects
        ? { text: async () => objects[key], uploaded: new Date('2026-07-25T00:00:00Z') }
        : null,
    put: async (key: string, value: string) => {
      objects[key] = value;
    },
  } as any;
}

const MANIFEST = [
  'version=1.3.0',
  'kernel_url=https://api.rmpgutah.us/downloads/kiosk-os-1.3.0-bzImage',
  'kernel_sha256=aaaa',
  'rootfs_url=https://api.rmpgutah.us/downloads/kiosk-os-1.3.0-rootfs.cpio.gz',
  'rootfs_sha256=bbbb',
].join('\n');


const JWT_SECRET = 'test-secret-for-os-updates';

/** A signed session token of the shape authMiddleware actually accepts. */
async function bearer(userId = 1): Promise<Record<string, string>> {
  const token = await new SignJWT({ user_id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return { Authorization: `Bearer ${token}` };
}

/**
 * Stands in for the `users` row authMiddleware looks up after verifying the JWT.
 * Returns null when no user is configured, which is how an inactive/absent
 * account behaves.
 */
function usersDb(user?: { role: string }) {
  const row = user
    ? { id: 1, username: 'tester', role: user.role, full_name: 'Tester', status: 'active' }
    : null;
  return {
    prepare: () => ({
      bind: () => ({ first: async () => row, all: async () => ({ results: row ? [row] : [] }) }),
      first: async () => row,
      all: async () => ({ results: row ? [row] : [] }),
    }),
  } as any;
}

function mount(objects: Record<string, string>, user?: { role: string }) {
  const app = new Hono();
  // Mirror routesConfig for real: mounted at /api as a PUBLIC entry, with no
  // ambient middleware setting `user`. Anything that needs a role has to earn it
  // through authMiddleware inside the router, exactly as it does in production.
  app.use('*', async (c, next) => {
    c.env = { DOWNLOADS: bucket(objects), DB: usersDb(user), JWT_SECRET } as never;
    await next();
  });
  app.route('/api', osUpdates);
  return app;
}

describe('GET /api/os/manifest', () => {
  it('serves the stable manifest verbatim so BusyBox grep/cut can parse it', async () => {
    const app = mount({ 'os/stable/manifest.txt': MANIFEST });
    const res = await app.request('/api/os/manifest?channel=stable');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('version=1.3.0');
    expect(body).toContain('rootfs_sha256=bbbb');
  });

  it('returns 200 with a comment when nothing is published, not 404', async () => {
    // A 404 is indistinguishable from a network failure to BusyBox wget, which
    // would make a fully up-to-date fleet log errors forever.
    const app = mount({});
    const res = await app.request('/api/os/manifest?channel=stable');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('no release published');
  });

  it('never caches — a promote or rollback must be seen promptly', async () => {
    const app = mount({ 'os/stable/manifest.txt': MANIFEST });
    const res = await app.request('/api/os/manifest?channel=stable');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('defaults to stable, so a terminal with no channel set never gets staging', async () => {
    const app = mount({
      'os/stable/manifest.txt': 'version=1.2.0',
      'os/staging/manifest.txt': 'version=9.9.9',
    });
    const body = await (await app.request('/api/os/manifest')).text();
    expect(body).toContain('1.2.0');
    expect(body).not.toContain('9.9.9');
  });

  it('rejects an unknown channel rather than falling back to stable', async () => {
    const app = mount({ 'os/stable/manifest.txt': MANIFEST });
    const res = await app.request('/api/os/manifest?channel=experimental');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/os/promote — the gate before the fleet installs anything', () => {
  it('rejects an unauthenticated caller at the middleware, not the handler', async () => {
    // The router is mounted PUBLIC so terminals can poll the manifest, so the
    // gate depends entirely on authMiddleware being registered on this one path.
    // 401 (not 403) proves the middleware ran: the handler's own role check
    // answers 403, so a 403 here would mean auth was skipped and the request
    // reached the handler with no user.
    const app = mount({ 'os/staging/manifest.txt': MANIFEST }, { role: 'admin' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      body: JSON.stringify({ version: '1.3.0' }),
    });
    expect(res.status).toBe(401);
  });

  it('requires admin or manager', async () => {
    const app = mount({ 'os/staging/manifest.txt': MANIFEST }, { role: 'officer' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      headers: await bearer(),
      body: JSON.stringify({ version: '1.3.0' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses when the named version does not match staging', async () => {
    // Guards against a stale admin tab promoting a version nobody looked at.
    const app = mount({ 'os/staging/manifest.txt': MANIFEST }, { role: 'admin' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      headers: await bearer(),
      body: JSON.stringify({ version: '1.2.0' }),
    });
    expect(res.status).toBe(409);
    const json = await res.json() as { staging: string };
    expect(json.staging).toBe('1.3.0');
  });

  it('requires the version to be named at all', async () => {
    const app = mount({ 'os/staging/manifest.txt': MANIFEST }, { role: 'admin' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      headers: await bearer(),
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('copies staging to stable when the version matches', async () => {
    // The case that was unreachable in production: a real admin, with a real
    // token, actually getting through the gate.
    const objects: Record<string, string> = { 'os/staging/manifest.txt': MANIFEST };
    const app = mount(objects, { role: 'admin' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      headers: await bearer(),
      body: JSON.stringify({ version: '1.3.0' }),
    });
    expect(res.status).toBe(200);
    expect(objects['os/stable/manifest.txt']).toBe(MANIFEST);
  });

  it('lets a manager promote too, not just an admin', async () => {
    const objects: Record<string, string> = { 'os/staging/manifest.txt': MANIFEST };
    const app = mount(objects, { role: 'manager' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      headers: await bearer(),
      body: JSON.stringify({ version: '1.3.0' }),
    });
    expect(res.status).toBe(200);
  });

  it('404s when staging is empty', async () => {
    const app = mount({}, { role: 'admin' });
    const res = await app.request('/api/os/promote', {
      method: 'POST',
      headers: await bearer(),
      body: JSON.stringify({ version: '1.3.0' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('the public endpoints stay public', () => {
  // The counterweight to the promote gate: scoping auth to /os/promote must not
  // leak onto the polling endpoints. A terminal boots with no user at all, so a
  // 401 here would silently strand the entire fleet on its current image.
  it('serves the manifest with no credentials', async () => {
    const app = mount({ 'os/stable/manifest.txt': MANIFEST });
    expect((await app.request('/api/os/manifest')).status).toBe(200);
  });

  it('serves the channel report with no credentials', async () => {
    const app = mount({ 'os/stable/manifest.txt': MANIFEST });
    expect((await app.request('/api/os/channels')).status).toBe(200);
  });
});

describe('GET /api/os/channels', () => {
  it('reports what is published on each channel', async () => {
    const app = mount({
      'os/stable/manifest.txt': 'version=1.2.0',
      'os/staging/manifest.txt': 'version=1.3.0',
    });
    const json = await (await app.request('/api/os/channels')).json() as Record<string, { version: string | null }>;
    expect(json.stable.version).toBe('1.2.0');
    expect(json.staging.version).toBe('1.3.0');
  });

  it('reports null for a channel with nothing published', async () => {
    const app = mount({});
    const json = await (await app.request('/api/os/channels')).json() as Record<string, { version: string | null }>;
    expect(json.stable.version).toBeNull();
  });
});
