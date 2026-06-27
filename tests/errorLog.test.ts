// Unit tests for the D1 error persistence helper (src/utils/logger.ts).
// Runs in Node environment; mocks the D1 binding to avoid needing Miniflare.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logErrorToDb } from '../src/utils/logger';

describe('logErrorToDb', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockDb = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    // Default: .prepare() returns an object with .bind().bind()...
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true }),
      }),
    });
  });

  it('inserts a row with minimal fields', async () => {
    logErrorToDb(mockDb, {
      severity: 'error',
      category: 'route',
      message: 'test error',
    });

    // Wait for the async work to complete
    await vi.waitFor(() => {
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    // Check the SQL contains the right values
    const sql = mockDb.prepare.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO error_log');
    expect(sql).toContain('severity');
    expect(sql).toContain('category');
    expect(sql).toContain('message');
  });

  it('inserts a row with all optional fields', async () => {
    logErrorToDb(mockDb, {
      severity: 'critical',
      category: 'integration',
      message: 'Fleet.io connection failed',
      details: { endpoint: '/api/v1/vehicles', statusCode: 503 },
      traceId: 'abc123',
      userId: 42,
      source: 'POST /api/fleetio/seed',
      statusCode: 502,
    });

    await vi.waitFor(() => {
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    const calls = mockDb.prepare.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });

  it('truncates long messages to 2000 chars', async () => {
    const longMsg = 'x'.repeat(5000);

    logErrorToDb(mockDb, {
      severity: 'error',
      category: 'route',
      message: longMsg,
    });

    await vi.waitFor(() => {
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    // Verify bind was called with truncated message
    const binds = mockDb.prepare.mock.results[0]?.value?.bind?.mock?.calls;
    // The message is the 4th positional param (index 3)
    if (binds) {
      const messageArg = binds[0]?.find((arg: any) => typeof arg === 'string' && arg.length === 2000);
      expect(messageArg).toBeDefined();
    }
  });

  it('silently fails when error_log table does not exist', async () => {
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockRejectedValue(new Error('no such table: error_log')),
      }),
    });

    expect(() => {
      logErrorToDb(mockDb, {
        severity: 'error',
        category: 'route',
        message: 'table missing',
      });
      // Should not throw — the error is caught internally
    }).not.toThrow();
  });

  it('accepts severity "warning"', async () => {
    logErrorToDb(mockDb, {
      severity: 'warning',
      category: 'db',
      message: 'slow query detected',
    });

    await vi.waitFor(() => {
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  it('logs to the correct D1 table', async () => {
    logErrorToDb(mockDb, {
      severity: 'error',
      category: 'auth',
      message: 'JWT verification failed',
      details: { tokenHint: 'expired' },
      source: '/api/auth/refresh',
    });

    await vi.waitFor(() => {
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    const sql = mockDb.prepare.mock.calls[0][0] as string;
    expect(sql).toContain('error_log');
    // Verify no SQL injection vector in the column names
    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('DELETE');
  });
});
