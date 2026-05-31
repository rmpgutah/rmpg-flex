import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb } from '../utils/db';

const crisis = new Hono<Env>();

crisis.get('/stats', async (c) => {
  return c.json({ citCalls: 0, resolvedOnScene: 0, diversionRate: 0, teamsAvailable: 0 });
});

export default crisis;
