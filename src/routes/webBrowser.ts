// ============================================================
// RMPG Flex — Web Company Browser session route
// ============================================================
// Mounted at /api/web-browser (auth: 'required', see routesConfig.ts).
// POST /session creates a fresh session id and enforces the role
// restriction BEFORE a session (and its Browser Rendering instance) is
// ever created. The actual WebSocket upgrade to WebBrowserSessionDO is
// handled at the top-level fetch() in src/index.ts (mirroring
// /api/voice-ws / /api/alerts-ws — bare, no-JWT-in-URL upgrades bypass
// Hono's authMiddleware entirely; the DO itself verifies the first
// `authenticate` frame), keyed by sessionId instead of room.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';

const webBrowser = new Hono<Env>();

// client_viewer: read-only external role, never gets a live browser session.
// contract_manager: external contract-facing role, same exclusion as client_viewer.
const BLOCKED_ROLES = new Set(['client_viewer', 'contract_manager']);

webBrowser.post('/session', async (c) => {
  const user = c.get('user') as { id: number; role: string } | undefined;
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (BLOCKED_ROLES.has(user.role)) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }

  const sessionId = crypto.randomUUID();
  return c.json({ sessionId });
});

export default webBrowser;
