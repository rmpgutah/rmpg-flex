import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { getDb, execute } from '../src/utils/db';

// Create the system_config table needed for daily email config.
beforeAll(async () => {
  const db = getDb(env as unknown as { DB: D1Database });
  await execute(db, `CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL,
    config_value TEXT,
    category TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  // Create a test admin user for auth.
  await execute(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'officer',
    status TEXT NOT NULL DEFAULT 'active'
  )`);
  await execute(db, `INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, status)
    VALUES (1, 'admin', 'hash', 'Test Admin', 'admin', 'active')`);
  await execute(db, `INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, status)
    VALUES (2, 'officer', 'hash', 'Test Officer', 'officer', 'active')`);
});

// Mirror the token helper used by other test-workers tests.
async function authHeaders(role: 'admin' | 'officer'): Promise<Record<string, string>> {
  const { SignJWT } = await import('jose');
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const token = await new SignJWT({ userId: role === 'admin' ? 1 : 2, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/admin/daily-email/recipients', () => {
  it('returns default config when nothing is set', async () => {
    const res = await SELF.fetch('https://x/api/admin/daily-email/recipients', {
      headers: await authHeaders('admin'),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; enabled: boolean; recipients: string[] };
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.recipients).toEqual([]);
  });

  it('is admin-only', async () => {
    const res = await SELF.fetch('https://x/api/admin/daily-email/recipients', {
      headers: await authHeaders('officer'),
    });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/daily-email/recipients', () => {
  it('updates recipients list', async () => {
    const res = await SELF.fetch('https://x/api/admin/daily-email/recipients', {
      method: 'PUT',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        recipients: ['admin@test.com', 'manager@test.com'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; enabled: boolean; recipients: string[] };
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.recipients).toEqual(['admin@test.com', 'manager@test.com']);
  });

  it('rejects invalid email addresses', async () => {
    const res = await SELF.fetch('https://x/api/admin/daily-email/recipients', {
      method: 'PUT',
      headers: { ...(await authHeaders('admin')), 'content-type': 'application/json' },
      body: JSON.stringify({ recipients: ['notanemail'] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid email');
  });

  it('is admin-only', async () => {
    const res = await SELF.fetch('https://x/api/admin/daily-email/recipients', {
      method: 'PUT',
      headers: { ...(await authHeaders('officer')), 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(403);
  });
});
