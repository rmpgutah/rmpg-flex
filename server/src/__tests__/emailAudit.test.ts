import { describe, it, expect, vi, beforeEach } from 'vitest';

const runMock = vi.fn();
vi.mock('../models/database', () => ({
  getDb: () => ({ prepare: () => ({ run: runMock }) }),
}));
vi.mock('../utils/timeUtils', () => ({ localNow: () => '2026-04-14 10:00:00' }));

import { auditEmailSend } from '../utils/emailAudit';

describe('auditEmailSend', () => {
  beforeEach(() => runMock.mockClear());

  it('writes a row for SEND action with message id', () => {
    const req: any = { user: { userId: 1 }, ip: '127.0.0.1' };
    auditEmailSend(req, 'SEND', { to: ['a@b.c'], subject: 'Hello', messageId: 'abc123' });
    expect(runMock).toHaveBeenCalledTimes(1);
    const args = runMock.mock.calls[0];
    expect(args.some((a: any) => typeof a === 'string' && a.includes('abc123'))).toBe(true);
  });
});
