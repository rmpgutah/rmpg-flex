import { describe, it, expect, vi } from 'vitest';
import {
  saveUserGraphToken, getUserGraphToken, deleteUserGraphToken, listConnectedUserIds,
} from '../src/utils/userGraphTokens';

function fakeDb() {
  const rows = new Map<number, { access_token_enc: string; refresh_token_enc: string; expires_at: string; mailbox: string | null }>();
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        run: async () => {
          if (sql.includes('INSERT OR REPLACE INTO user_graph_tokens') || sql.includes('INSERT INTO user_graph_tokens')) {
            const [userId, accessEnc, refreshEnc, expiresAt, mailbox] = params as [number, string, string, string, string | null];
            rows.set(userId, { access_token_enc: accessEnc, refresh_token_enc: refreshEnc, expires_at: expiresAt, mailbox });
          } else if (sql.includes('DELETE FROM user_graph_tokens')) {
            rows.delete(params[0] as number);
          }
          return { success: true, meta: {} };
        },
        first: async () => {
          const userId = params[0] as number;
          const row = rows.get(userId);
          return row ? { ...row } : null;
        },
        all: async () => ({ results: [...rows.keys()].map((user_id) => ({ user_id })) }),
      }),
    }),
  } as unknown as D1Database;
}

const env = { JWT_SECRET: 'test-secret-at-least-32-bytes-long-for-testing' };

describe('userGraphTokens', () => {
  it('saves and retrieves a token round-trip (encrypted at rest)', async () => {
    const db = fakeDb();
    await saveUserGraphToken(db, env, 42, {
      accessToken: 'access-abc', refreshToken: 'refresh-xyz', expiresAt: 1234567890, mailbox: 'officer@rmpgutah.us',
    });
    const result = await getUserGraphToken(db, env, 42);
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('access-abc');
    expect(result!.refreshToken).toBe('refresh-xyz');
    expect(result!.mailbox).toBe('officer@rmpgutah.us');
  });

  it('returns null for a user with no connected mailbox', async () => {
    const db = fakeDb();
    const result = await getUserGraphToken(db, env, 999);
    expect(result).toBeNull();
  });

  it('deletes a token', async () => {
    const db = fakeDb();
    await saveUserGraphToken(db, env, 7, { accessToken: 'a', refreshToken: 'b', expiresAt: 1, mailbox: null });
    await deleteUserGraphToken(db, 7);
    expect(await getUserGraphToken(db, env, 7)).toBeNull();
  });

  it('lists connected user ids', async () => {
    const db = fakeDb();
    await saveUserGraphToken(db, env, 1, { accessToken: 'a', refreshToken: 'b', expiresAt: 1, mailbox: null });
    await saveUserGraphToken(db, env, 2, { accessToken: 'c', refreshToken: 'd', expiresAt: 1, mailbox: null });
    const ids = await listConnectedUserIds(db);
    expect(ids.sort()).toEqual([1, 2]);
  });
});
