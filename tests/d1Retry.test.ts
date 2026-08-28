import { describe, it, expect, vi } from 'vitest';
import { isRetryableD1Error, withD1Retry } from '../src/utils/db';

describe('isRetryableD1Error', () => {
  it('retries busy / D1 platform errors', () => {
    expect(isRetryableD1Error(new Error('D1_ERROR: SQLITE_BUSY'))).toBe(true);
    expect(isRetryableD1Error(new Error('database is locked'))).toBe(true);
    expect(isRetryableD1Error(new Error('network timeout'))).toBe(true);
  });

  it('does not retry schema / constraint errors', () => {
    expect(isRetryableD1Error(new Error('no such table: users'))).toBe(false);
    expect(isRetryableD1Error(new Error('UNIQUE constraint failed: users.username'))).toBe(false);
  });
});

describe('withD1Retry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue(7);
    await expect(withD1Retry(fn)).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a busy error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
      .mockResolvedValueOnce({ id: 1 });
    await expect(withD1Retry(fn)).resolves.toEqual({ id: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a missing-table error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('no such table: users'));
    await expect(withD1Retry(fn)).rejects.toThrow('no such table');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
