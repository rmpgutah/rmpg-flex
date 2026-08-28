import { describe, it, expect } from 'vitest';
import {
  findServeJobForCall,
  relinkServeJobForRedispatch,
  restoreServeJobAfterUndoRedispatch,
  findRestoreCallIdForUndoRedispatch,
} from '../src/utils/psoServeCrosslink';

function createMockDb(tables: Record<string, any[]>) {
  const runSql = (sql: string, params: any[], mode: 'first' | 'all') => {
    const inList = (ids: any[]) => params.some((p) => ids.includes(p) || ids.includes(Number(p)));

    if (sql.includes('pragma_table_info')) {
      const row = { name: params[1] };
      return mode === 'first' ? row : [row];
    }

    if (sql.includes('FROM serve_queue WHERE call_id IN')) {
      const rows = (tables.serve_queue || []).filter((r) => inList([r.call_id]));
      rows.sort((a, b) => a.id - b.id);
      return mode === 'first' ? (rows[0] ?? null) : rows;
    }
    if (sql.includes('FROM serve_queue WHERE call_id = ?')) {
      const callId = params[0];
      const rows = (tables.serve_queue || []).filter((r) => r.call_id === callId);
      rows.sort((a, b) => a.id - b.id);
      return mode === 'first' ? (rows[0] ?? null) : rows;
    }
    if (sql.includes('FROM serve_queue WHERE id = ?')) {
      const found = (tables.serve_queue || []).find((r) => r.id === params[0]);
      return mode === 'first' ? (found ?? null) : (found ? [found] : []);
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
    if (sql.includes('FROM calls_for_service c') && sql.includes('c.id != ?')) {
      const childId = params[0];
      const rootId = params[1];
      const cfs = tables.calls_for_service || [];
      const ext = tables.calls_for_service_ext || [];
      const rows = cfs.filter((c) => {
        if (c.id === childId) return false;
        if (c.id === rootId) return true;
        const e = ext.find((x) => x.id === c.id);
        return e?.parent_call_id === rootId;
      });
      rows.sort((a, b) => (b.pso_attempt_number || 0) - (a.pso_attempt_number || 0) || b.id - a.id);
      return mode === 'first' ? (rows[0] ?? null) : rows;
    }
    return mode === 'first' ? null : [];
  };

  return {
    prepare: (sql: string) => {
      let params: any[] = [];
      const stmt = {
        bind: (...args: any[]) => {
          params = args;
          return stmt;
        },
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
                row.closed_at = null;
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
    expect(result).not.toBeNull();
    expect(result?.id).toBe(101);
    expect(result?.recipient_name).toBe('Jamalee Jacobsen');
  });

  it('traces parent_call_id for re-dispatched calls to link to the SAME Job ID', async () => {
    const db = createMockDb({
      serve_queue: [{ id: 25126457, call_id: 100, recipient_name: 'Jamalee Jacobsen' }],
      calls_for_service_ext: [
        { id: 101, parent_call_id: 100 },
        { id: 102, parent_call_id: 100 },
      ],
    });

    expect((await findServeJobForCall(db, 100))?.id).toBe(25126457);
    expect((await findServeJobForCall(db, 101))?.id).toBe(25126457);
    expect((await findServeJobForCall(db, 102))?.id).toBe(25126457);
  });

  it('finds the job from the original CFS after it was relinked to a return visit', async () => {
    const db = createMockDb({
      serve_queue: [{ id: 7, call_id: 102, recipient_name: 'Bennett Maxwell' }],
      calls_for_service_ext: [
        { id: 100, parent_call_id: null },
        { id: 101, parent_call_id: 100 },
        { id: 102, parent_call_id: 100 },
      ],
    });

    expect((await findServeJobForCall(db, 100))?.id).toBe(7);
    expect((await findServeJobForCall(db, 102))?.id).toBe(7);
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
  it('moves call_id onto the return visit and reopens a served job', async () => {
    const tables = {
      serve_queue: [{ id: 9, call_id: 100, status: 'served', attempt_count: 2, notes: 'orig', closed_at: '2026-08-01' }],
      calls_for_service_ext: [{ id: 100, parent_call_id: null }],
    };
    const db = createMockDb(tables);

    const result = await relinkServeJobForRedispatch(db, 100, 101, 'CFS26-00101');
    expect(result.relinked).toBe(true);
    expect(result.created).toBe(false);
    expect(result.queueId).toBe(9);
    expect(tables.serve_queue).toHaveLength(1);
    expect(tables.serve_queue[0].call_id).toBe(101);
    expect(tables.serve_queue[0].status).toBe('attempted');
    expect(tables.serve_queue[0].notes).toContain('CFS26-00101');
  });

  it('does not insert when the chain has no job', async () => {
    const db = createMockDb({
      serve_queue: [],
      calls_for_service_ext: [{ id: 1, parent_call_id: null }],
    });
    const result = await relinkServeJobForRedispatch(db, 1, 2, 'CFS26-00002');
    expect(result.relinked).toBe(false);
    expect(result.queueId).toBeNull();
  });

  it('restores the original job to the remaining CFS instead of deleting it', async () => {
    const tables = {
      serve_queue: [{ id: 9, call_id: 101, status: 'pending' }],
      calls_for_service: [
        { id: 100, pso_attempt_number: 1 },
        { id: 101, pso_attempt_number: 2 },
      ],
      calls_for_service_ext: [
        { id: 100, parent_call_id: null },
        { id: 101, parent_call_id: 100 },
      ],
    };
    const db = createMockDb(tables);
    const restoreTo = await findRestoreCallIdForUndoRedispatch(db, 101, 100);
    expect(restoreTo).toBe(100);
    const result = await restoreServeJobAfterUndoRedispatch(db, 101, restoreTo);
    expect(result.restored).toBe(true);
    expect(result.deletedDuplicate).toBe(false);
    expect(tables.serve_queue).toHaveLength(1);
    expect(tables.serve_queue[0].id).toBe(9);
    expect(tables.serve_queue[0].call_id).toBe(100);
  });

  it('drops a legacy duplicate child job when the original still sits on the parent', async () => {
    const tables = {
      serve_queue: [
        { id: 1, call_id: 100, recipient_name: 'Original' },
        { id: 2, call_id: 101, recipient_name: 'Duplicate visit' },
      ],
      calls_for_service_ext: [],
    };
    const db = createMockDb(tables);
    const result = await restoreServeJobAfterUndoRedispatch(db, 101, 100);
    expect(result.deletedDuplicate).toBe(true);
    expect(tables.serve_queue).toHaveLength(1);
    expect(tables.serve_queue[0].id).toBe(1);
  });
});
