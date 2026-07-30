import { describe, it, expect, vi } from 'vitest';
import { migrateSharedTokenToUserGraphTokens } from '../src/routes/email';

function fakeDb(configRows: Record<string, string> = {}, existingUserToken = false) {
  const config = new Map(Object.entries(configRows));
  let migrated = false;
  let savedUserId: number | null = null;
  return {
    _wasCalled: () => savedUserId,
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => {
          if (sql.includes('system_config') && sql.includes('config_key = ?')) {
            const key = params[params.length - 1] as string;
            return config.has(key) ? { config_value: config.get(key) } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT') && sql.includes('user_graph_tokens')) savedUserId = params[0] as number;
          return { success: true, meta: {} };
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('migrateSharedTokenToUserGraphTokens', () => {
  it('is a no-op when there is no recorded oauthInitiator', async () => {
    const db = fakeDb({});
    const env = { DB: db, JWT_SECRET: 'test-secret-at-least-32-bytes-long' } as any;
    await expect(migrateSharedTokenToUserGraphTokens(env)).resolves.not.toThrow();
  });

  it('does not throw when the shared token config is present but incomplete', async () => {
    const db = fakeDb({ ms_email_oauth_initiator: '5' });
    const env = { DB: db, JWT_SECRET: 'test-secret-at-least-32-bytes-long' } as any;
    await expect(migrateSharedTokenToUserGraphTokens(env)).resolves.not.toThrow();
  });
});
