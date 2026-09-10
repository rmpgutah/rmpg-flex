import { Hono } from 'hono';
import type { Env } from '../types';

// Keep the deliberately public surface isolated. Reusing a router that also
// owns authenticated handlers would alias every one of those handlers beneath
// this public prefix whenever a new route is added.
const publicDiagnostics = new Hono<Env>();

publicDiagnostics.post('/ui-trap', async (c) => {
  try {
    const raw = await c.req.text();
    if (raw && raw.length <= 60_000) {
      const key = `uitrap:${Date.now()}:${crypto.randomUUID()}`;
      await c.env.KV.put(key, raw, { expirationTtl: 60 * 60 * 24 * 30 });
    }
  } catch {
    // Diagnostics must never make an already-struggling client fail harder.
  }
  return c.json({ received: true });
});

export default publicDiagnostics;
