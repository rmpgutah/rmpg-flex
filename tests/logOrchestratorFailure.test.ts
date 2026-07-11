import { describe, it, expect, vi } from 'vitest';
import { logOrchestratorFailure } from '../src/utils/warrantSources/logScanResult';

function fakeDb() {
  const inserts: unknown[][] = [];
  const db: any = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) { inserts.push(args); return this; },
        async run() { return {}; },
      };
    },
  };
  return { db, inserts };
}

describe('logOrchestratorFailure', () => {
  it('inserts a __scan_orchestrator__ row with success=0, errors=1', async () => {
    const { db, inserts } = fakeDb();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await logOrchestratorFailure(db, 'cron', new Error('boom'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toBe('__scan_orchestrator__');
    expect(inserts[0][3]).toBe(0);  // success
    expect(inserts[0][7]).toBe(1);  // errors
    expect(errSpy).toHaveBeenCalledWith('Warrant source scheduled scan failed:', expect.any(Error));
    errSpy.mockRestore();
  });

  it('logs but does not throw if the insert itself fails', async () => {
    const throwingDb: any = { prepare() { return { bind() { throw new Error('insert failed'); } }; } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(logOrchestratorFailure(throwingDb, 'cron', new Error('boom'))).resolves.not.toThrow();
    errSpy.mockRestore();
  });
});
