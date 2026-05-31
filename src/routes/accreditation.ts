import { Hono } from 'hono';
import type { Env } from '../types';

const accreditation = new Hono<Env>();

accreditation.get('/stats', async (c) => {
  return c.json({});
});

export default accreditation;
