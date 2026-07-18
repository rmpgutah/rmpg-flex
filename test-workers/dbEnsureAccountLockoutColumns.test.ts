import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureAccountLockoutColumns, columnExists } from '../src/utils/db';

describe('ensureAccountLockoutColumns', () => {
  it('adds failed_login_count and locked_until to users', async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL
    )`).run();
    await ensureAccountLockoutColumns(env.DB);
    expect(await columnExists(env.DB, 'users', 'failed_login_count')).toBe(true);
    expect(await columnExists(env.DB, 'users', 'locked_until')).toBe(true);
  });
});
