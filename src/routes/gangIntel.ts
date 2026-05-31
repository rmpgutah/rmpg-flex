import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const gangIntel = new Hono<Env>();

gangIntel.get('/', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_members ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
});

gangIntel.get('/gangs', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_intel_gangs ORDER BY name');
  return c.json(rows || []);
});

gangIntel.get('/graffiti', async (c) => {
  const db = getDb(c.env);
  const rows = await query(db, 'SELECT * FROM gang_graffiti_records ORDER BY created_at DESC LIMIT 200');
  return c.json(rows || []);
});

gangIntel.get('/stats', async (c) => {
  const db = getDb(c.env);
  const total = await queryFirst<{cnt:number}>(db, 'SELECT COUNT(*) as cnt FROM gang_intel_members');
  const active = await queryFirst<{cnt:number}>(db, "SELECT COUNT(*) as cnt FROM gang_intel_members WHERE status = 'active'");
  return c.json({ totalMembers: total?.cnt || 0, activeMembers: active?.cnt || 0 });
});

export default gangIntel;
