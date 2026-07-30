import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Treat encrypt/decrypt as identity so system_config rows can carry plain
// strings in this test's fake D1 — the real AES-GCM path is exercised
// separately in emailCrypto's own tests.
vi.mock('../src/utils/emailCrypto', () => ({
  encryptSecret: async (_env: unknown, v: string) => v,
  decryptSecret: async (_env: unknown, v: string) => v,
}));

import { drainEmailOutbox } from '../src/routes/email';

// Minimal in-memory D1 stand-in covering exactly the statements
// drainEmailOutbox (+ its config/audit helpers) issues.
function fakeDb(opts: {
  outboxRows: Array<{ id: number; payload: string; attempts: number; owner_user_id: number }>;
  configRows: Record<string, string>;
  username?: string | null;
  // Per-user Graph tokens (Phase 3: user_graph_tokens replaces the singleton
  // system_config access/refresh-token keys). Keyed by user_id.
  userTokens?: Record<number, { accessToken: string; refreshToken: string; expiresAt: string; mailbox?: string | null }>;
}) {
  const auditInserts: unknown[][] = [];
  const outboxUpdates: Array<{ sql: string; params: unknown[] }> = [];

  const makeStatement = (sql: string, params: unknown[]) => ({
    all: async () => {
      if (sql.includes('FROM email_outbox')) {
        return { results: opts.outboxRows };
      }
      return { results: [] };
    },
    first: async () => {
      if (sql.includes('FROM system_config')) {
        const key = params[0] as string;
        const v = opts.configRows[key];
        return v ? { config_value: v } : null;
      }
      if (sql.includes('FROM users')) {
        return opts.username !== undefined ? { username: opts.username } : null;
      }
      if (sql.includes('FROM user_graph_tokens')) {
        const userId = params[0] as number;
        const t = opts.userTokens?.[userId];
        if (!t) return null;
        return {
          access_token_enc: t.accessToken,
          refresh_token_enc: t.refreshToken,
          expires_at: t.expiresAt,
          mailbox: t.mailbox ?? null,
        };
      }
      return null;
    },
    run: async () => {
      if (sql.includes('UPDATE email_outbox')) outboxUpdates.push({ sql, params });
      if (sql.includes('INSERT INTO email_audit_log')) auditInserts.push(params);
      return { success: true, meta: { last_row_id: 1 } };
    },
  });

  const db = {
    prepare: (sql: string) => ({
      ...makeStatement(sql, []),
      bind: (...params: unknown[]) => makeStatement(sql, params),
    }),
  } as unknown as D1Database;

  return { db, auditInserts, outboxUpdates };
}

// Far-future expiry so ensureValidToken short-circuits on the cached
// access token instead of exercising the refresh-token exchange.
const FAR_FUTURE = String(Date.now() + 60 * 60 * 1000);

const BASE_CONFIG = {
  ms_email_access_token: 'cached-access-token',
  ms_email_token_expires_at: FAR_FUTURE,
  ms_email_refresh_token: 'refresh-token',
};

describe('drainEmailOutbox — queued-then-resolved audit write', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const payload = JSON.stringify({
    message: {
      subject: 'Retry me',
      toRecipients: [{ emailAddress: { address: 'a@x.com' } }],
      ccRecipients: [],
    },
  });

  it('writes a final "sent" audit row when a previously-queued send succeeds on retry', async () => {
    const { db, auditInserts } = fakeDb({
      outboxRows: [{ id: 42, payload, attempts: 1, owner_user_id: 7 }],
      configRows: BASE_CONFIG,
      username: 'jdoe',
      userTokens: { 7: { accessToken: 'cached-access-token', refreshToken: 'refresh-token', expiresAt: FAR_FUTURE } },
    });
    fetchSpy.mockResolvedValue(new Response(null, { status: 202 }));

    const result = await drainEmailOutbox({ DB: db } as any);

    expect(result.sent).toBe(1);
    expect(auditInserts).toHaveLength(1);
    const params = auditInserts[0];
    expect(params).toContain(7);
    expect(params).toContain('jdoe');
    expect(params).toContain('sent');
    expect(params).toContain('Retry me');
  });

  it('writes a final "failed" audit row once retries are exhausted', async () => {
    const { db, auditInserts } = fakeDb({
      // attempts=4 → this attempt becomes 5, which is >= BACKOFFS.length (5), so it's terminal.
      outboxRows: [{ id: 43, payload, attempts: 4, owner_user_id: 9 }],
      configRows: BASE_CONFIG,
      username: 'asmith',
      userTokens: { 9: { accessToken: 'cached-access-token', refreshToken: 'refresh-token', expiresAt: FAR_FUTURE } },
    });
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));

    const result = await drainEmailOutbox({ DB: db } as any);

    expect(result.failed).toBe(1);
    expect(auditInserts).toHaveLength(1);
    const params = auditInserts[0];
    expect(params).toContain(9);
    expect(params).toContain('asmith');
    expect(params).toContain('failed');
  });

  it('does NOT write a resolution audit row when a send is merely deferred for another retry', async () => {
    const { db, auditInserts } = fakeDb({
      outboxRows: [{ id: 44, payload, attempts: 0, owner_user_id: 3 }],
      configRows: BASE_CONFIG,
      userTokens: { 3: { accessToken: 'cached-access-token', refreshToken: 'refresh-token', expiresAt: FAR_FUTURE } },
    });
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));

    const result = await drainEmailOutbox({ DB: db } as any);

    expect(result.deferred).toBe(1);
    expect(auditInserts).toHaveLength(0);
  });
});
