import { Hono } from 'hono';
import type { Env } from '../types';

const alarms = new Hono<Env>();

alarms.get('/stats', async (c) => {
  return c.json({});
});

export default alarms;
