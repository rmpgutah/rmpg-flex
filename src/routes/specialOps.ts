import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const specialOps = new Hono<Env>();

specialOps.get('/callouts', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM special_ops_callouts ORDER BY date DESC LIMIT 100');
  return c.json(rows.results || []);
});

specialOps.get('/equipment', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM special_ops_equipment ORDER BY equipment_type');
  return c.json(rows.results || []);
});

specialOps.get('/stats', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM special_ops_callouts');
  return c.json({ totalCallouts: total?.cnt || 0 });
});

export default specialOps;
