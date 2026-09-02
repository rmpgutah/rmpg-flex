import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendDailyEmails } from '../src/utils/dailyEmail/sendDailyEmails';

// Mock Resend
vi.mock('../src/utils/resendEmail', () => ({
  sendViaResend: vi.fn().mockResolvedValue({ id: 'test-id', status: 'sent' }),
}));

// Mock the daily report modules
vi.mock('../src/utils/dailyReport/collect', () => ({
  collectDailyReport: vi.fn().mockResolvedValue({
    date: '2026-07-18',
    generatedAt: '2026-08-01T12:00:00.000Z',
    operations: { calls: [{ call_number: 'C-1' }], citations: [] },
    fleet: { trips: [], fuel: [], checks: [], workOrders: [] },
  }),
  isEmpty: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/utils/dailyReport/render', () => ({
  renderDailyReport: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), // %PDF
}));

vi.mock('../src/utils/dailyEmail/collectExtended', () => ({
  collectExtendedActivity: vi.fn().mockResolvedValue({
    warrants: { newToday: [], servedToday: [], totalCount: 0, newCount: 0, servedCount: 0 },
    incidents: { rows: [], totalCount: 0, byStatus: {} },
    alpr: { rows: [], totalCount: 0, alertedCount: 0 },
    patrolScans: { rows: [], totalCount: 0, onTime: 0, late: 0, missed: 0 },
    persons: { rows: [], totalCount: 0 },
  }),
}));

vi.mock('../src/utils/dailyEmail/renderHtml', () => ({
  renderDailyEmailHtml: vi.fn().mockReturnValue('<html>test</html>'),
}));

/** Stub D1 that returns canned config rows. */
function makeDb(configRows: Record<string, string>) {
  const db = {
    prepare(sql: string) {
      const ctx = { bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async first<T>(): Promise<T | null> {
          const key = ctx.bindings[0] as string;
          const val = configRows[key];
          return (val !== undefined ? { config_value: val } : null) as T;
        },
        async all<T>(): Promise<{ results: T[] }> { return { results: [] as T[] }; },
        async run(): Promise<{ success: boolean }> { return { success: true }; },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof sendDailyEmails>[0];
  return db;
}

describe('sendDailyEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when daily email is disabled', async () => {
    const db = makeDb({
      daily_email_enabled: '0',
      daily_email_recipients: 'test@test.com',
    });
    const result = await sendDailyEmails(db, 'test-key', '2026-07-18');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('daily_email_disabled');
  });

  it('skips when no recipients configured', async () => {
    const db = makeDb({
      daily_email_enabled: '1',
      daily_email_recipients: '',
    });
    const result = await sendDailyEmails(db, 'test-key', '2026-07-18');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_recipients');
  });

  it('sends to configured recipients', async () => {
    const db = makeDb({
      daily_email_enabled: '1',
      daily_email_recipients: 'admin@test.com, manager@test.com',
      daily_email_include_pdf: '1',
    });
    const result = await sendDailyEmails(db, 'test-key', '2026-07-18');
    expect(result.skipped).toBe(false);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('counts failures separately', async () => {
    const { sendViaResend } = await import('../src/utils/resendEmail');
    vi.mocked(sendViaResend)
      .mockResolvedValueOnce({ id: 'ok', status: 'sent' })
      .mockResolvedValueOnce({ id: null, status: 'failed', error: 'rate limited' });

    const db = makeDb({
      daily_email_enabled: '1',
      daily_email_recipients: 'ok@test.com, fail@test.com',
      daily_email_include_pdf: '0',
    });
    const result = await sendDailyEmails(db, 'test-key', '2026-07-18');
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('skips when no activity for the day', async () => {
    const { isEmpty } = await import('../src/utils/dailyReport/collect');
    vi.mocked(isEmpty).mockReturnValueOnce(true);

    const db = makeDb({
      daily_email_enabled: '1',
      daily_email_recipients: 'test@test.com',
    });
    const result = await sendDailyEmails(db, 'test-key', '2026-07-18');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_activity');
  });
});
