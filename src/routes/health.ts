import { Hono } from 'hono';
import { getDb, queryFirst } from '../utils/db';

const health = new Hono<{ Bindings: { DB: D1Database } }>();

health.get('/', async (c) => {
  const db = getDb(c.env);

  try {
    // db_version is best-effort metadata — it must never decide health. Live
    // system_config uses config_key/config_value (not key/value), so the old
    // `WHERE key = ?` threw "no such column" and the catch reported the DB as
    // DOWN (503) when it was actually fine. Keep it isolated so a lookup miss
    // degrades to 'unknown' instead of failing the probe.
    let dbVersion = 'unknown';
    try {
      const result = await db.prepare('SELECT config_value AS value FROM system_config WHERE config_key = ?').bind('db_version').first<{ value: string }>();
      dbVersion = result?.value ?? 'unknown';
    } catch { /* version is non-essential; connectivity is proven below */ }

    // Connectivity probe — a trivial query that proves the DB is reachable.
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
