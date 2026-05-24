import { Hono } from 'hono';
import { getDb, queryFirst } from '../utils/db';

const health = new Hono<{ Bindings: { DB: D1Database } }>();

health.get('/', async (c) => {
  const db = getDb(c.env);

  try {
    const result = await db.prepare('SELECT value FROM system_config WHERE key = ?').bind('db_version').first<{ value: string }>();
    const dbVersion = result?.value ?? 'unknown';

    const userCount = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();

    return c.json({
      status: 'ok',
      version: '1.0.0',
      db: {
        connected: true,
        version: dbVersion,
        users: userCount?.count ?? 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({
      status: 'error',
      db: { connected: false },
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, 503);
  }
});

export default health;
