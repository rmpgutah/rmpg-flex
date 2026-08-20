import { describe, it, expect, beforeEach } from 'vitest';
import { findServeJobForCall } from '../psoServeCrosslink';

// Mock D1 database for unit testing
function createMockDb(tables: Record<string, any[]>) {
  return {
    prepare: (sql: string) => {
      let params: any[] = [];
      const stmt = {
        bind: (...args: any[]) => {
          params = args;
          return stmt;
        },
        first: async <T>() => {
          if (sql.includes('FROM serve_queue WHERE call_id = ?')) {
            const callId = params[0];
            const found = tables.serve_queue?.find((r) => r.call_id === callId);
            return (found as T) ?? null;
          }
          if (sql.includes('FROM calls_for_service_ext WHERE id = ?')) {
            const id = params[0];
            const found = tables.calls_for_service_ext?.find((r) => r.id === id);
            return (found as T) ?? null;
          }
          return null;
        },
      };
      return stmt;
    },
  } as any;
}

describe('psoServeCrosslink — findServeJobForCall', () => {
  it('returns direct match when serve_queue has matching call_id', async () => {
    const db = createMockDb({
      serve_queue: [{ id: 101, call_id: 50, recipient_name: 'Jamalee Jacobsen' }],
      calls_for_service_ext: [],
    });

    const result = await findServeJobForCall(db, 50);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(101);
    expect(result?.recipient_name).toBe('Jamalee Jacobsen');
  });

  it('traces parent_call_id for re-dispatched calls to link to the SAME Job ID', async () => {
    const db = createMockDb({
      serve_queue: [{ id: 25126457, call_id: 100, recipient_name: 'Jamalee Jacobsen' }],
      calls_for_service_ext: [
        { id: 101, parent_call_id: 100 }, // 1st re-dispatch child call
        { id: 102, parent_call_id: 101 }, // 2nd re-dispatch child call
      ],
    });

    // Parent call (100) -> Job ID 25126457
    const parentJob = await findServeJobForCall(db, 100);
    expect(parentJob?.id).toBe(25126457);

    // 1st reattempt child call (101) -> SAME Job ID 25126457
    const child1Job = await findServeJobForCall(db, 101);
    expect(child1Job?.id).toBe(25126457);

    // 2nd reattempt child call (102) -> SAME Job ID 25126457
    const child2Job = await findServeJobForCall(db, 102);
    expect(child2Job?.id).toBe(25126457);
  });

  it('returns null when no job exists in the call chain', async () => {
    const db = createMockDb({
      serve_queue: [],
      calls_for_service_ext: [{ id: 200, parent_call_id: null }],
    });

    const result = await findServeJobForCall(db, 200);
    expect(result).toBeNull();
  });
});
