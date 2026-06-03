// Trespass orders — minimal stub. DispatchPage's PremiseHistory
// component fires GET /api/trespass-orders/check on every address
// change. Until the real trespass orders module is ported, we return
// an empty list so the premise panel doesn't 500 on every keystroke.
// The component's catch handler already treats this defensively as
// `{ orders: [], count: 0 }`, but giving it a clean 200 response
// avoids the console noise and matches the legacy contract.

import { Hono } from 'hono';
import type { Env } from '../types';

const trespass = new Hono<Env>();

trespass.get('/check', (c) => {
  // Real impl would JOIN trespass_orders against persons + premises
  // and return active orders matching the address/property_id. For
  // now: empty so the PremiseHistory panel renders without errors.
  return c.json({ orders: [], count: 0 });
});

trespass.get('/', (c) => c.json([]));

export default trespass;
