import { describe, it, expect } from 'vitest';
import { auditEmailAction } from '../src/utils/emailAudit';

function fakeDb(runFn: (sql: string, params: unknown[]) => void) {
  return {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        run: async () => { runFn(sql, params); return { success: true }; },
      }),
    }),
  } as unknown as D1Database;
}

describe('auditEmailAction', () => {
  it('writes a row to email_audit_log with the expected fields', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const db = fakeDb((sql, params) => { capturedSql = sql; capturedParams = params; });
    const env = { DB: db } as any;

    await auditEmailAction(env, {
      userId: 7,
      username: 'jdoe',
      action: 'send',
      toAddresses: ['a@x.com', 'b@y.com'],
      ccAddresses: [],
      subject: 'Case update',
      graphMessageId: 'AAMk123',
      status: 'sent',
    });

    expect(capturedSql).toContain('INSERT INTO email_audit_log');
    expect(capturedParams).toContain(7);
    expect(capturedParams).toContain('jdoe');
    expect(capturedParams).toContain(JSON.stringify(['a@x.com', 'b@y.com']));
    expect(capturedParams).toContain('Case update');
    expect(capturedParams).toContain('AAMk123');
    expect(capturedParams).toContain('sent');
  });

  it('records a failed send with the error message', async () => {
    let capturedParams: unknown[] = [];
    const db = fakeDb((_sql, params) => { capturedParams = params; });
    const env = { DB: db } as any;

    await auditEmailAction(env, {
      userId: 7,
      action: 'send',
      toAddresses: ['a@x.com'],
      subject: 'Case update',
      status: 'failed',
      error: 'Graph 429: throttled',
    });

    expect(capturedParams).toContain('failed');
    expect(capturedParams).toContain('Graph 429: throttled');
  });

  it('records a "queued" status for a send that failed synchronously but was durably enqueued for retry', async () => {
    let capturedParams: unknown[] = [];
    const db = fakeDb((_sql, params) => { capturedParams = params; });
    const env = { DB: db } as any;

    await auditEmailAction(env, {
      userId: 7,
      action: 'send',
      toAddresses: ['a@x.com'],
      subject: 'Case update',
      status: 'queued',
      error: 'Graph 503: temporarily unavailable',
    });

    expect(capturedParams).toContain('queued');
    expect(capturedParams).toContain('Graph 503: temporarily unavailable');
  });

  it('never throws even if the DB write fails', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1 down'); } }) }),
    } as unknown as D1Database;
    const env = { DB: db } as any;

    await expect(auditEmailAction(env, {
      userId: 7, action: 'send', toAddresses: ['a@x.com'], subject: 'x', status: 'sent',
    })).resolves.toBeUndefined();
  });
});
