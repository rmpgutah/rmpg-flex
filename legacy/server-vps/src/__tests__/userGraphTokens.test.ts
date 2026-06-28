import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../models/database', () => {
  const _db = new Database(':memory:');
  _db.prepare(`CREATE TABLE user_graph_tokens (
    user_id INTEGER PRIMARY KEY, access_token_enc TEXT NOT NULL, refresh_token_enc TEXT,
    token_expires_at INTEGER NOT NULL, mailbox TEXT, scopes TEXT, enrolled_at TEXT NOT NULL, last_sync_at TEXT
  )`).run();
  return { getDb: () => _db };
});
vi.mock('../utils/timeUtils', () => ({ localNow: () => '2026-04-17 10:00:00' }));
vi.mock('../utils/msGraphClient', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}));

import { setUserTokens, getUserTokens, deleteUserTokens, isUserEnrolled, listEnrolledUserIds } from '../utils/userGraphTokens';

describe('userGraphTokens', () => {
  it('round-trips access + refresh tokens (encrypted at rest)', () => {
    setUserTokens(1, { accessToken: 'AAA', refreshToken: 'RRR', expiresAt: 9999, mailbox: 'a@b.c', scopes: 'Mail.Send' });
    const t = getUserTokens(1);
    expect(t).toEqual(expect.objectContaining({ accessToken: 'AAA', refreshToken: 'RRR', mailbox: 'a@b.c' }));
  });
  it('returns null for unenrolled user', () => {
    expect(getUserTokens(99)).toBeNull();
  });
  it('isUserEnrolled mirrors token presence', () => {
    expect(isUserEnrolled(1)).toBe(true);
    expect(isUserEnrolled(99)).toBe(false);
  });
  it('deleteUserTokens removes the row', () => {
    deleteUserTokens(1);
    expect(getUserTokens(1)).toBeNull();
  });
  it('listEnrolledUserIds returns all enrolled', () => {
    setUserTokens(1, { accessToken: 'A', refreshToken: 'R', expiresAt: 1, mailbox: '', scopes: '' });
    setUserTokens(2, { accessToken: 'A', refreshToken: 'R', expiresAt: 1, mailbox: '', scopes: '' });
    expect(listEnrolledUserIds().sort()).toEqual([1, 2]);
  });
});
