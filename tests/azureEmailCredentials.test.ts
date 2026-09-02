import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAzureEmailCredentials,
  getAzureEmailIdentity,
  isAzureEmailConfigured,
} from '../src/utils/azureEmailCredentials';
import type { Bindings } from '../src/types';

const JWT_SECRET = 'test-jwt-secret-for-email-credentials';

function fakeDb(rows: Record<string, string> = {}) {
  return {
    prepare(sql: string) {
      return {
        bind(key: string) {
          return {
            async first<T>() {
              const val = rows[key];
              if (!val) return null;
              return { config_value: val } as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function asEnv(partial: Partial<Bindings> & { JWT_SECRET: string; DB: D1Database }): Bindings {
  return partial as Bindings;
}

describe('azureEmailCredentials', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('prefers env bindings over D1 rows', async () => {
    const env = asEnv({
      JWT_SECRET,
      MS_EMAIL_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
      MS_EMAIL_CLIENT_SECRET: 'env-secret-value-long-enough',
      MS_EMAIL_TENANT_ID: '22222222-2222-2222-2222-222222222222',
      DB: fakeDb({
        ms_email_client_id: 'db-client',
        ms_email_client_secret: 'db-secret',
        ms_email_tenant_id: 'db-tenant',
      }),
    });
    const creds = await getAzureEmailCredentials(env);
    expect(creds?.source).toBe('env');
    expect(creds?.clientId).toBe('11111111-1111-1111-1111-111111111111');
    expect(await isAzureEmailConfigured(env)).toBe(true);
  });

  it('returns null when neither env nor DB has all three values', async () => {
    const env = asEnv({
      JWT_SECRET,
      MS_EMAIL_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
      DB: fakeDb(),
    });
    expect(await getAzureEmailCredentials(env)).toBeNull();
    expect(await getAzureEmailIdentity(env)).toBeNull();
    expect(await isAzureEmailConfigured(env)).toBe(false);
  });

  it('getAzureEmailIdentity works with only client id + tenant from env', async () => {
    const env = asEnv({
      JWT_SECRET,
      MS_EMAIL_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
      MS_EMAIL_TENANT_ID: '22222222-2222-2222-2222-222222222222',
      DB: fakeDb(),
    });
    const identity = await getAzureEmailIdentity(env);
    expect(identity).toEqual({
      clientId: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
    });
  });
});
