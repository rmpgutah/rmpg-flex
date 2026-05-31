import { Hono } from 'hono';
import type { Env } from '../types';

const recruitment = new Hono<Env>();

recruitment.get('/stats', async (c) => {
  return c.json({});
});

export default recruitment;
