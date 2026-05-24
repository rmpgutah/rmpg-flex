import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const personnel = new Hono<Env>();

// GET /personnel
personnel.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { status, role } = c.req.query();
    let sql = 'SELECT id, username, full_name, role, badge_number, phone, email, status FROM users WHERE 1=1';
    const params: unknown[] = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (role) { sql += ' AND role = ?'; params.push(role); }
    sql += ' ORDER BY full_name';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) {
    console.error('GET /personnel failed:', err);
    return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500);
  }
});

export default personnel;

// GET /personnel/credentials
personnel.get('/credentials', async (c) => {
  return c.json([]);
});
