import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulate a missing/bad EMAIL_FIELD_ENCRYPTION_KEK secret: decryptFieldIfEncrypted
// throws EmailFieldEncryptionError, exactly as the real implementation does when
// the KEK is unset or malformed (src/utils/emailFieldCrypto.ts).
vi.mock('../src/utils/emailFieldCrypto', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/emailFieldCrypto')>(
    '../src/utils/emailFieldCrypto',
  );
  return {
    ...actual,
    decryptFieldIfEncrypted: vi.fn(async () => {
      throw new actual.EmailFieldEncryptionError('EMAIL_FIELD_ENCRYPTION_KEK is not set');
    }),
  };
});

import { drainScheduledEmails } from '../src/routes/email';

// Minimal in-memory D1 stand-in covering exactly the statements
// drainScheduledEmails issues.
function fakeDb(row: {
  id: number; owner_user_id: number; to_addresses: string; cc_addresses: string | null;
  bcc_addresses: string | null; subject: string; body: string; is_html: number;
  importance: string; attachments: string | null; status: string;
}) {
  const state = { status: row.status };
  const updates: Array<{ sql: string; params: unknown[] }> = [];

  const makeStatement = (sql: string, params: unknown[]) => ({
    all: async () => {
      if (sql.includes('FROM email_scheduled')) {
        return { results: state.status === 'pending' ? [row] : [] };
      }
      return { results: [] };
    },
    first: async () => null,
    run: async () => {
      if (sql.includes('UPDATE email_scheduled')) {
        updates.push({ sql, params });
        if (sql.includes("status = 'pending'")) state.status = 'pending';
        else if (sql.includes("status = 'failed'")) state.status = 'failed';
        else if (sql.includes("status = 'sent'")) state.status = 'sent';
      }
      return { success: true, meta: { last_row_id: 1 } };
    },
  });

  const db = {
    prepare: (sql: string) => ({
      ...makeStatement(sql, []),
      bind: (...params: unknown[]) => makeStatement(sql, params),
    }),
  } as unknown as D1Database;

  return { db, state, updates };
}

describe('drainScheduledEmails — KEK failure leaves rows retryable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a pending row pending (not failed) when decrypt throws EmailFieldEncryptionError', async () => {
    const { db, state } = fakeDb({
      id: 101,
      owner_user_id: 5,
      to_addresses: 'v2:enc:iv:tag',
      cc_addresses: null,
      bcc_addresses: null,
      subject: 'Court reminder',
      body: 'v2:enc:iv:tag',
      is_html: 0,
      importance: 'normal',
      attachments: null,
      status: 'pending',
    });

    const queued = await drainScheduledEmails({ DB: db } as any);

    expect(queued).toBe(0);
    expect(state.status).toBe('pending');
  });
});
