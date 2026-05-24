import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';

const presence = new Hono<Env>();

// GET /presence
presence.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT u.id, u.username, u.full_name, u.role, u.badge_number,
        s.created_at as last_seen
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.expires_at > datetime('now')
      GROUP BY s.user_id
      ORDER BY u.full_name
    `);
    return c.json(rows);
  } catch (err) {
    return c.json([]);
  }
});

export default presence;
