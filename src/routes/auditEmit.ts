// ============================================================
// Tiny audit-emit route for client-side instrumentation.
//
// PR 7'a opens this route ONLY for the narrow allow-list below
// (FLEET_V2_*). Adding new actions here requires explicit code
// review — the design rule is "audit emits go through specific
// routes per feature", not "one open audit endpoint for everything."
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { recordAudit } from '../utils/auditLog';

const ALLOWED_ACTIONS = new Set([
  'FLEET_V2_VIEW',
  'FLEET_V2_API_ERROR',
]);

const route = new Hono<Env>();

route.post('/', async (c) => {
  let body: { action?: string; entityType?: string; entityId?: number | string | null; details?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  const action = String(body.action ?? '');
  if (!action) {
    return c.json({ error: 'action is required' }, 400);
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return c.json({ error: `action '${action}' not allowed by this endpoint` }, 400);
  }
  await recordAudit(c, {
    action,
    entityType: String(body.entityType ?? 'fleet_ui_page'),
    entityId: body.entityId ?? null,
    details: body.details ?? null,
  });
  return c.json({ ok: true }, 202);
});

export default route;
