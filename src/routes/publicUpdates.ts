import { Hono } from 'hono';
import type { Env } from '../types';

// Android update discovery runs before login, so this endpoint is public.
const publicUpdates = new Hono<Env>();

publicUpdates.get('/check', (c) => c.json({
  updateAvailable: false,
  currentVersion: c.req.query('currentVersion') || '0.0.0',
}));

export default publicUpdates;
