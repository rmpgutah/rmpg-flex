// ============================================================
// RMPG Flex — Workers Audit Logger
// ============================================================
// Mirrors server/src/utils/auditLogger.ts for Hono/Workers.
// ============================================================

import { Context } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from './auth';
import { D1Db } from './d1Helpers';

export async function auditLog(
  db: D1Db,
  c: Context<{ Bindings: Env; Variables: { user: JwtPayload } }>,
  action: string,
  entityType: string,
  entityId: number,
  details: string,
): Promise<void> {
  try {
    const user = c.get('user');
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';

    await db.prepare(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      user?.userId ?? 0,
      action,
      entityType,
      entityId,
      details.slice(0, 2000),
      ip,
    );
  } catch {
    // Audit log failures are non-fatal
  }
}
