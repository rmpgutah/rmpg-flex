import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute, query, queryFirst } from '../src/utils/db';
import { setTursoClient } from '../src/utils/tursoClient';
import type { D1Database, D1Result } from '@cloudflare/workers-types';

const D1_SUCCESS = {
  success: true,
  results: [],
  meta: { last_row_id: 1, changes: 1, duration: 0, rows_read: 0, rows_written: 1 },
} as unknown as D1Result;

function makeD1(opts?: {
  run?: () => Promise<D1Result>;
  all?: () => Promise<{ results: unknown[] }>;
  first?: () => Promise<unknown>;
}): D1Database {
  const run = opts?.run ?? vi.fn().mockResolvedValue(D1_SUCCESS);
  const all = opts?.all ?? vi.fn().mockResolvedValue({ results: [{ id: 1 }] });
  const first = opts?.first ?? vi.fn().mockResolvedValue({ id: 1 });
  const bound = { run, all, first };
  const stmt = { run, all, first, bind: vi.fn().mockReturnValue(bound) };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function makeTurso(opts?: { execute?: () => Promise<unknown> }) {
  return {
    execute: opts?.execute ?? vi.fn().mockResolvedValue({ rows: [{ id: 99 }] }),
  };
}

describe('execute — dual-write', () => {
  beforeEach(() => setTursoClient(null));

  it('writes to D1 when no Turso client', async () => {
    const db = makeD1();
    await execute(db, 'INSERT INTO t(v) VALUES (?)', 'x');
    expect(db.prepare).toHaveBeenCalledWith('INSERT INTO t(v) VALUES (?)');
  });

  it('writes to both D1 and Turso when Turso is set', async () => {
    const db = makeD1();
    const turso = makeTurso();
    setTursoClient(turso as any);
    await execute(db, 'INSERT INTO t(v) VALUES (?)', 'x');
    expect(turso.execute).toHaveBeenCalledWith({
      sql: 'INSERT INTO t(v) VALUES (?)',
      args: ['x'],
    });
  });

  it('returns D1 result on success', async () => {
    const db = makeD1();
    const result = await execute(db, 'INSERT INTO t(v) VALUES (?)', 'x');
    expect(result).toMatchObject({ success: true });
  });

  it('throws D1 error and still calls Turso when D1 fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ run });
    const turso = makeTurso();
    setTursoClient(turso as any);
    await expect(execute(db, 'INSERT INTO t(v) VALUES (?)', 'x')).rejects.toThrow('D1 down');
    expect(turso.execute).toHaveBeenCalled();
  });

  it('succeeds when Turso fails but D1 succeeds', async () => {
    const db = makeD1();
    const turso = makeTurso({
      execute: vi.fn().mockRejectedValue(new Error('Turso down')),
    });
    setTursoClient(turso as any);
    await expect(execute(db, 'INSERT INTO t(v) VALUES (?)', 'x')).resolves.toMatchObject({ success: true });
  });
});

describe('query — read fallback', () => {
  beforeEach(() => setTursoClient(null));

  it('returns D1 results normally', async () => {
    const db = makeD1();
    const rows = await query(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(rows).toEqual([{ id: 1 }]);
  });

  it('falls back to Turso when D1 read throws', async () => {
    const all = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ all });
    const turso = makeTurso({
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 99 }] }),
    });
    setTursoClient(turso as any);
    const rows = await query(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(rows).toEqual([{ id: 99 }]);
  });

  it('throws when D1 fails and no Turso client', async () => {
    const all = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ all });
    await expect(query(db, 'SELECT * FROM t')).rejects.toThrow('D1 down');
  });
});

describe('queryFirst — read fallback', () => {
  beforeEach(() => setTursoClient(null));

  it('returns D1 result normally', async () => {
    const db = makeD1();
    const row = await queryFirst(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(row).toEqual({ id: 1 });
  });

  it('falls back to Turso when D1 throws', async () => {
    const first = vi.fn().mockRejectedValue(new Error('D1 down'));
    const db = makeD1({ first });
    const turso = makeTurso({
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 99 }] }),
    });
    setTursoClient(turso as any);
    const row = await queryFirst(db, 'SELECT * FROM t WHERE id = ?', 1);
    expect(row).toEqual({ id: 99 });
  });
});
