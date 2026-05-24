import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const properties = new Hono<Env>();

// GET /records/properties
properties.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, client_id } = c.req.query();
    let sql = 'SELECT p.*, c.name as client_name FROM properties p LEFT JOIN clients c ON p.client_id = c.id';
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (search) { wheres.push('(p.name LIKE ? OR p.address LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (client_id) { wheres.push('p.client_id = ?'); params.push(client_id); }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY p.name LIMIT 500';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

export default properties;
