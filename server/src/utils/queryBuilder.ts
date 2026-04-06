// ============================================================
// RMPG Flex — Query Builder Utility
// ============================================================
// Type-safe SQL query builder for dynamic WHERE clauses.
// Prevents SQL injection by always using parameterized queries.
// Replaces the ad-hoc condition-building patterns used
// throughout route handlers.
// ============================================================

export interface WhereCondition {
  column: string;
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';
  value?: any;
  /** Second value for BETWEEN operator */
  value2?: any;
}

export interface QueryResult {
  whereClause: string;
  params: any[];
}

/**
 * Build a WHERE clause from an array of conditions.
 * Returns { whereClause, params } for use in prepared statements.
 *
 * @example
 * const { whereClause, params } = buildWhere([
 *   { column: 'status', operator: '=', value: 'active' },
 *   { column: 'created_at', operator: '>=', value: '2025-01-01' },
 *   { column: 'type', operator: 'IN', value: ['felony', 'misdemeanor'] },
 *   { column: 'notes', operator: 'LIKE', value: '%armed%' },
 *   { column: 'served_date', operator: 'IS NULL' },
 * ]);
 *
 * db.prepare(`SELECT * FROM warrants ${whereClause} ORDER BY created_at DESC`).all(...params);
 */
export function buildWhere(conditions: WhereCondition[]): QueryResult {
  if (conditions.length === 0) return { whereClause: '', params: [] };

  const parts: string[] = [];
  const params: any[] = [];

  for (const cond of conditions) {
    switch (cond.operator) {
      case 'IS NULL':
      case 'IS NOT NULL':
        parts.push(`${cond.column} ${cond.operator}`);
        break;

      case 'IN':
      case 'NOT IN': {
        const values = Array.isArray(cond.value) ? cond.value : [cond.value];
        if (values.length === 0) {
          // Empty IN clause: always false / NOT IN: always true
          parts.push(cond.operator === 'IN' ? '0 = 1' : '1 = 1');
        } else {
          const placeholders = values.map(() => '?').join(', ');
          parts.push(`${cond.column} ${cond.operator} (${placeholders})`);
          params.push(...values);
        }
        break;
      }

      case 'BETWEEN': {
        parts.push(`${cond.column} BETWEEN ? AND ?`);
        params.push(cond.value, cond.value2);
        break;
      }

      default:
        parts.push(`${cond.column} ${cond.operator} ?`);
        params.push(cond.value);
        break;
    }
  }

  return {
    whereClause: `WHERE ${parts.join(' AND ')}`,
    params,
  };
}

/**
 * Build WHERE conditions from Express query parameters.
 * Automatically maps query params to SQL conditions, ignoring
 * pagination/sort params and empty values.
 *
 * @example
 * // GET /api/warrants?status=active&type=felony&search=smith&page=1&limit=25
 * const conditions = buildWhereFromQuery(req.query, {
 *   status: { column: 'w.status', operator: '=' },
 *   type: { column: 'w.warrant_type', operator: '=' },
 *   search: { column: 'w.subject_name', operator: 'LIKE', wrap: '%' },
 *   startDate: { column: 'w.created_at', operator: '>=' },
 *   endDate: { column: 'w.created_at', operator: '<=' },
 * });
 *
 * const { whereClause, params } = buildWhere(conditions);
 */
export function buildWhereFromQuery(
  query: Record<string, any>,
  mapping: Record<string, {
    column: string;
    operator: WhereCondition['operator'];
    /** Wrap value with prefix/suffix (e.g., '%' for LIKE) */
    wrap?: string;
  }>,
): WhereCondition[] {
  const conditions: WhereCondition[] = [];

  for (const [param, config] of Object.entries(mapping)) {
    const rawValue = query[param];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    let value: any = rawValue;

    if (config.wrap) {
      value = `${config.wrap}${rawValue}${config.wrap}`;
    }

    conditions.push({
      column: config.column,
      operator: config.operator,
      value,
    });
  }

  return conditions;
}

/**
 * Build an ORDER BY clause from a sort parameter.
 * Validates the column name against an allowlist to prevent injection.
 *
 * @example
 * const orderBy = buildOrderBy(req.query.sort as string, req.query.order as string, {
 *   allowed: ['created_at', 'status', 'subject_name', 'warrant_number'],
 *   default: 'created_at',
 *   defaultOrder: 'DESC',
 * });
 *
 * db.prepare(`SELECT * FROM warrants ${whereClause} ${orderBy}`).all(...params);
 */
export function buildOrderBy(
  sort: string | undefined,
  order: string | undefined,
  options: {
    allowed: string[];
    default: string;
    defaultOrder?: 'ASC' | 'DESC';
    prefix?: string;
  },
): string {
  const column = sort && options.allowed.includes(sort) ? sort : options.default;
  const direction = order?.toUpperCase() === 'ASC' ? 'ASC' : (order?.toUpperCase() === 'DESC' ? 'DESC' : (options.defaultOrder ?? 'DESC'));
  const prefix = options.prefix ? `${options.prefix}.` : '';
  return `ORDER BY ${prefix}${column} ${direction}`;
}
