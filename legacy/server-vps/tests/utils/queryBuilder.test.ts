import { describe, it, expect } from 'vitest';
import { buildWhere, buildWhereFromQuery, buildOrderBy } from '../../src/utils/queryBuilder';
import type { WhereCondition } from '../../src/utils/queryBuilder';

// ────────────────────────────────────────────────────────
// buildWhere
// ────────────────────────────────────────────────────────
describe('buildWhere', () => {
  it('returns empty clause for no conditions', () => {
    const result = buildWhere([]);
    expect(result.whereClause).toBe('');
    expect(result.params).toEqual([]);
  });

  it('handles a single equality condition', () => {
    const result = buildWhere([
      { column: 'status', operator: '=', value: 'active' },
    ]);
    expect(result.whereClause).toBe('WHERE status = ?');
    expect(result.params).toEqual(['active']);
  });

  it('joins multiple conditions with AND', () => {
    const result = buildWhere([
      { column: 'status', operator: '=', value: 'active' },
      { column: 'priority', operator: '>=', value: 1 },
    ]);
    expect(result.whereClause).toBe('WHERE status = ? AND priority >= ?');
    expect(result.params).toEqual(['active', 1]);
  });

  it('handles != operator', () => {
    const result = buildWhere([
      { column: 'status', operator: '!=', value: 'closed' },
    ]);
    expect(result.whereClause).toBe('WHERE status != ?');
    expect(result.params).toEqual(['closed']);
  });

  it('handles comparison operators', () => {
    const operators: Array<WhereCondition['operator']> = ['<', '>', '<=', '>='];
    for (const op of operators) {
      const result = buildWhere([{ column: 'count', operator: op, value: 10 }]);
      expect(result.whereClause).toBe(`WHERE count ${op} ?`);
      expect(result.params).toEqual([10]);
    }
  });

  it('handles LIKE operator', () => {
    const result = buildWhere([
      { column: 'name', operator: 'LIKE', value: '%smith%' },
    ]);
    expect(result.whereClause).toBe('WHERE name LIKE ?');
    expect(result.params).toEqual(['%smith%']);
  });

  it('handles NOT LIKE operator', () => {
    const result = buildWhere([
      { column: 'name', operator: 'NOT LIKE', value: '%test%' },
    ]);
    expect(result.whereClause).toBe('WHERE name NOT LIKE ?');
    expect(result.params).toEqual(['%test%']);
  });

  it('handles IN operator with array', () => {
    const result = buildWhere([
      { column: 'type', operator: 'IN', value: ['felony', 'misdemeanor'] },
    ]);
    expect(result.whereClause).toBe('WHERE type IN (?, ?)');
    expect(result.params).toEqual(['felony', 'misdemeanor']);
  });

  it('handles IN operator with single value (non-array)', () => {
    const result = buildWhere([
      { column: 'type', operator: 'IN', value: 'felony' },
    ]);
    expect(result.whereClause).toBe('WHERE type IN (?)');
    expect(result.params).toEqual(['felony']);
  });

  it('handles IN operator with empty array (always false)', () => {
    const result = buildWhere([
      { column: 'type', operator: 'IN', value: [] },
    ]);
    expect(result.whereClause).toBe('WHERE 0 = 1');
    expect(result.params).toEqual([]);
  });

  it('handles NOT IN operator with empty array (always true)', () => {
    const result = buildWhere([
      { column: 'type', operator: 'NOT IN', value: [] },
    ]);
    expect(result.whereClause).toBe('WHERE 1 = 1');
    expect(result.params).toEqual([]);
  });

  it('handles NOT IN operator with values', () => {
    const result = buildWhere([
      { column: 'status', operator: 'NOT IN', value: ['cancelled', 'deleted'] },
    ]);
    expect(result.whereClause).toBe('WHERE status NOT IN (?, ?)');
    expect(result.params).toEqual(['cancelled', 'deleted']);
  });

  it('handles IS NULL operator', () => {
    const result = buildWhere([
      { column: 'served_date', operator: 'IS NULL' },
    ]);
    expect(result.whereClause).toBe('WHERE served_date IS NULL');
    expect(result.params).toEqual([]);
  });

  it('handles IS NOT NULL operator', () => {
    const result = buildWhere([
      { column: 'served_date', operator: 'IS NOT NULL' },
    ]);
    expect(result.whereClause).toBe('WHERE served_date IS NOT NULL');
    expect(result.params).toEqual([]);
  });

  it('handles BETWEEN operator', () => {
    const result = buildWhere([
      { column: 'created_at', operator: 'BETWEEN', value: '2025-01-01', value2: '2025-12-31' },
    ]);
    expect(result.whereClause).toBe('WHERE created_at BETWEEN ? AND ?');
    expect(result.params).toEqual(['2025-01-01', '2025-12-31']);
  });

  it('handles complex multi-condition query', () => {
    const result = buildWhere([
      { column: 'status', operator: '=', value: 'active' },
      { column: 'type', operator: 'IN', value: ['felony', 'misdemeanor'] },
      { column: 'name', operator: 'LIKE', value: '%smith%' },
      { column: 'deleted_at', operator: 'IS NULL' },
      { column: 'created_at', operator: 'BETWEEN', value: '2025-01-01', value2: '2025-12-31' },
    ]);
    expect(result.whereClause).toContain('WHERE');
    // 5 conditions joined by AND (BETWEEN has an extra AND inside)
    expect(result.whereClause).toContain('status = ?');
    expect(result.whereClause).toContain('type IN (?, ?)');
    expect(result.whereClause).toContain('name LIKE ?');
    expect(result.whereClause).toContain('deleted_at IS NULL');
    expect(result.whereClause).toContain('created_at BETWEEN ? AND ?');
    expect(result.params).toEqual(['active', 'felony', 'misdemeanor', '%smith%', '2025-01-01', '2025-12-31']);
  });

  it('always uses parameterized values (no injection)', () => {
    const malicious = "'; DROP TABLE warrants; --";
    const result = buildWhere([
      { column: 'name', operator: '=', value: malicious },
    ]);
    expect(result.whereClause).toBe('WHERE name = ?');
    expect(result.params).toEqual([malicious]);
    // The value goes into params, never interpolated into the SQL string
    expect(result.whereClause).not.toContain(malicious);
  });
});

// ────────────────────────────────────────────────────────
// buildWhereFromQuery
// ────────────────────────────────────────────────────────
describe('buildWhereFromQuery', () => {
  it('returns empty array for empty query', () => {
    const result = buildWhereFromQuery({}, {
      status: { column: 'w.status', operator: '=' },
    });
    expect(result).toEqual([]);
  });

  it('ignores params not in mapping', () => {
    const result = buildWhereFromQuery(
      { page: '1', limit: '25', status: 'active' },
      { status: { column: 'w.status', operator: '=' } },
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ column: 'w.status', operator: '=', value: 'active' });
  });

  it('skips empty string values', () => {
    const result = buildWhereFromQuery(
      { status: '' },
      { status: { column: 'w.status', operator: '=' } },
    );
    expect(result).toEqual([]);
  });

  it('skips null and undefined values', () => {
    const result = buildWhereFromQuery(
      { status: null, type: undefined },
      {
        status: { column: 'w.status', operator: '=' },
        type: { column: 'w.type', operator: '=' },
      },
    );
    expect(result).toEqual([]);
  });

  it('wraps values with prefix/suffix for LIKE', () => {
    const result = buildWhereFromQuery(
      { search: 'smith' },
      { search: { column: 'w.name', operator: 'LIKE', wrap: '%' } },
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('%smith%');
  });

  it('maps multiple params', () => {
    const result = buildWhereFromQuery(
      { status: 'active', type: 'felony', startDate: '2025-01-01' },
      {
        status: { column: 'w.status', operator: '=' },
        type: { column: 'w.warrant_type', operator: '=' },
        startDate: { column: 'w.created_at', operator: '>=' },
      },
    );
    expect(result).toHaveLength(3);
  });
});

// ────────────────────────────────────────────────────────
// buildOrderBy
// ────────────────────────────────────────────────────────
describe('buildOrderBy', () => {
  it('uses default column and order when sort is undefined', () => {
    const result = buildOrderBy(undefined, undefined, {
      allowed: ['created_at', 'name'],
      default: 'created_at',
      defaultOrder: 'DESC',
    });
    expect(result).toBe('ORDER BY created_at DESC');
  });

  it('uses provided sort column when in allowed list', () => {
    const result = buildOrderBy('name', 'ASC', {
      allowed: ['created_at', 'name'],
      default: 'created_at',
    });
    expect(result).toBe('ORDER BY name ASC');
  });

  it('falls back to default when sort not in allowed list (prevents injection)', () => {
    const result = buildOrderBy('DROP TABLE warrants', 'ASC', {
      allowed: ['created_at', 'name'],
      default: 'created_at',
    });
    expect(result).toBe('ORDER BY created_at ASC');
  });

  it('normalizes order direction to uppercase', () => {
    const result = buildOrderBy('name', 'asc', {
      allowed: ['name'],
      default: 'name',
    });
    expect(result).toBe('ORDER BY name ASC');
  });

  it('defaults to DESC when order is invalid', () => {
    const result = buildOrderBy('name', 'invalid', {
      allowed: ['name'],
      default: 'name',
      defaultOrder: 'DESC',
    });
    expect(result).toBe('ORDER BY name DESC');
  });

  it('defaults to DESC when defaultOrder not specified and order invalid', () => {
    const result = buildOrderBy('name', undefined, {
      allowed: ['name'],
      default: 'name',
    });
    expect(result).toBe('ORDER BY name DESC');
  });

  it('applies prefix when provided', () => {
    const result = buildOrderBy('created_at', 'DESC', {
      allowed: ['created_at'],
      default: 'created_at',
      prefix: 'w',
    });
    expect(result).toBe('ORDER BY w.created_at DESC');
  });

  it('handles no prefix', () => {
    const result = buildOrderBy('created_at', 'DESC', {
      allowed: ['created_at'],
      default: 'created_at',
    });
    expect(result).toBe('ORDER BY created_at DESC');
  });
});
