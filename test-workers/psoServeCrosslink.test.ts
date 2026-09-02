import { describe, it, expect } from 'vitest';
import {
  findServeJobForCall,
  relinkServeJobForRedispatch,
  restoreServeJobAfterUndoRedispatch,
} from '../src/utils/psoServeCrosslink';

function createMockDb(tables: Record<string, any[]>) {
  const runSql = (sql: string, params: any[], mode: 'first' | 'all') => {
    const inList = (ids: any[]) => params.some((p) => ids.includes(p) || ids.includes(Number(p)));
    if (sql.includes('FROM serve_queue WHERE call_id IN')) {
      const rows = (tables.serve_queue || []).filter((r) => inList([r.call_id]));
      rows.sort((a, b) => a.id - b.id);
      return mode === 'first' ? (rows[0] ?? null) : rows;
    }
    if (sql.includes('FROM serve_queue WHERE call_id = ?')) {
      const rows = (tables.serve_queue || []).filter((r) => r.call_id === params[0]);
      rows.sort((a, b) => a.id - b.id);
      return mode === 'first' ? (rows[0] ?? null) : rows;
    }
    if (sql.includes('FROM calls_for_service_ext WHERE parent_call_id IN')) {
      const rows = (tables.calls_for_service_ext || [])
        .filter((r) => inList([r.parent_call_id]))
        .map((r) => ({ id: r.id }));
      return mode === 'first' ? (rows[0] ?? null) : rows;
    }
    if (sql.includes('FROM calls_for_service_ext WHERE id = ?')) {
      const found = (tables.calls_for_service_ext || []).find((r) => r.id === params[0]);
      return mode === 'first' ? (found ?? null) : (found ? [found] : []);
    }
    return mode === 'first' ? null : [];
  };

  return {
    prepare: (sql: string) => {
      let params: any[] = [];
      const stmt = {
        bind: (...args: any[]) => { params = args; return stmt; },
        first: async <T>() => runSql(sql, params, 'first') as T,
        all: async <T>() => ({ results: runSql(sql, params, 'all') as T[] }),
        run: async () => {
          if (sql.includes('UPDATE serve_queue SET') && sql.includes('call_id = ?')) {
            const jobId = params[params.length - 1];
            const row = tables.serve_queue?.find((r) => r.id === jobId);
            if (row) {
              row.call_id = params[0];
              if (params.length >= 4) {
                row.status = params[1];
                row.notes = params[2];
              }
            }
            return { meta: { changes: row ? 1 : 0, last_row_id: jobId } };
          }
          if (sql.includes('DELETE FROM serve_queue WHERE id = ?')) {
            const idx = tables.serve_queue?.findIndex((r) => r.id === params[0]) ?? -1;
            if (idx >= 0) tables.serve_queue.splice(idx, 1);
            return { meta: { changes: idx >= 0 ? 1 : 0, last_row_id: 0 } };
          }
          return { meta: { changes: 0, last_row_id: 0 } };
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
    expect(result?.id).toBe(101);
  });

  it('traces parent_call_id for re-dispatched calls to link to the SAME Job ID', async () => {
    const db = createMockDb({
      serve_queue: [{ id: 25126457, call_id: 100, recipient_name: 'Jamalee Jacobsen' }],
      calls_for_service_ext: [
        { id: 101, parent_call_id: 100 },
        { id: 102, parent_call_id: 101 },
      ],
    });
    expect((await findServeJobForCall(db, 100))?.id).toBe(25126457);
    expect((await findServeJobForCall(db, 101))?.id).toBe(25126457);
    expect((await findServeJobForCall(db, 102))?.id).toBe(25126457);
  });

  it('returns null when no job exists in the call chain', async () => {
    const db = createMockDb({
      serve_queue: [],
      calls_for_service_ext: [{ id: 200, parent_call_id: null }],
    });
    expect(await findServeJobForCall(db, 200)).toBeNull();
  });
});

describe('psoServeCrosslink — relink / restore', () => {
  it('relinks instead of creating a second job', async () => {
    const tables = {
      serve_queue: [{ id: 9, call_id: 100, status: 'failed', attempt_count: 1, notes: '' }],
      calls_for_service_ext: [{ id: 100, parent_call_id: null }],
    };
    const result = await relinkServeJobForRedispatch(createMockDb(tables), 100, 101, 'CFS26-00101');
    expect(result.queueId).toBe(9);
    expect(tables.serve_queue).toHaveLength(1);
    expect(tables.serve_queue[0].call_id).toBe(101);
  });

  it('restores rather than deleting the original job', async () => {
    const tables = {
      serve_queue: [{ id: 9, call_id: 101, status: 'pending' }],
      calls_for_service_ext: [],
    };
    const result = await restoreServeJobAfterUndoRedispatch(createMockDb(tables), 101, 100);
    expect(result.restored).toBe(true);
    expect(tables.serve_queue[0].id).toBe(9);
    expect(tables.serve_queue[0].call_id).toBe(100);
  });
});
