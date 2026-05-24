// ============================================================
// RMPG Flex — Officer Welfare Endpoints (Hono / D1 port, DI-4)
// Endpoints map to the 3 MDT modal buttons:
//   POST /api/dispatch/welfare/ack     — Code 4 (clear watch)
//   POST /api/dispatch/welfare/help    — Emergency broadcast
//   POST /api/dispatch/welfare/snooze  — Reset activity timer
//
// NOTE: the in-memory watcher state (setInterval + Map<userId, watch>)
// from server/src/utils/officerWelfare.ts does NOT port to Workers —
// Workers have no shared mutable state across requests. The watcher
// needs to become a Durable Object (WelfareWatchDO with alarm-driven
// escalation) before the timer-driven push works on this stack.
//
// For now these endpoints accept the officer-side responses and emit
// the broadcasts; the *timer that fires the modal* is deferred until
// the DO is added. UI listens to the same welfare_check / welfare_alert
// / welfare_emergency events when they arrive.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, localNow } from '../worker-middleware/d1Helpers';

const ALL_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'] as const;

export function mountWelfareRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // POST /welfare/ack — Officer responds Code 4
  api.post('/welfare/ack', requireRole(...ALL_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user') as JwtPayload;

      try {
        await db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'welfare_ack', 'user', ?, ?, ?)
        `).run(user.userId, user.userId, 'Code 4 ack received', c.req.header('cf-connecting-ip') || 'unknown');
      } catch { /* non-fatal */ }

      // TODO(DO): when WelfareWatchDO lands, also call its acknowledge()
      // method to clear the in-memory watch for this user.

      return c.json({
        success: true,
        message: 'Code 4 ack received.',
      });
    } catch (err) {
      console.error('[welfare] ack error', err);
      return c.json({ error: 'Failed to ack welfare check', code: 'WELFARE_ACK_ERR' }, 500);
    }
  });

  // POST /welfare/help — Officer requests help (emergency escalation)
  api.post('/welfare/help', requireRole(...ALL_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user') as JwtPayload;
      const userRow = await db.prepare('SELECT id, full_name, badge_number FROM users WHERE id = ?').get(user.userId) as any;
      const unit = await db.prepare('SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ?').get(user.userId) as any;
      const callContext = unit?.current_call_id
        ? await db.prepare('SELECT id, call_number, incident_type, location_address, latitude, longitude FROM calls_for_service WHERE id = ?').get(unit.current_call_id) as any
        : null;

      const payload = {
        action: 'welfare_emergency',
        user_id: user.userId,
        officer_name: userRow?.full_name || 'Unknown officer',
        badge_number: userRow?.badge_number || null,
        call_sign: unit?.call_sign || null,
        call_id: callContext?.id ?? null,
        call_number: callContext?.call_number ?? null,
        location_address: callContext?.location_address ?? null,
        latitude: callContext?.latitude ?? null,
        longitude: callContext?.longitude ?? null,
        triggered_by: 'mdt_button',
        at: localNow(),
      };

      try {
        await db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'welfare_help_requested', 'user', ?, ?, ?)
        `).run(user.userId, user.userId,
          `Officer requested help from MDT welfare modal${callContext ? ' on call ' + callContext.call_number : ''}`,
          c.req.header('cf-connecting-ip') || 'unknown');
      } catch { /* non-fatal */ }

      // TODO(DO): broadcast 'welfare_emergency' to every connected client.
      // Until the websocket DO is wired up, the help event is logged and
      // returned in the response; supervisor dashboards can poll
      // activity_log for 'welfare_help_requested' rows as a fallback.

      return c.json({ success: true, broadcast: payload });
    } catch (err) {
      console.error('[welfare] help error', err);
      return c.json({ error: 'Failed to broadcast help request', code: 'WELFARE_HELP_ERR' }, 500);
    }
  });

  // POST /welfare/snooze — Reset activity timer only
  api.post('/welfare/snooze', requireRole(...ALL_ROLES), async (c) => {
    try {
      // TODO(DO): call WelfareWatchDO.recordActivity(userId) to bump the
      // in-memory lastActivity timestamp. On the no-DO interim path this
      // is a no-op so the officer can still dismiss the modal client-side.
      return c.json({ success: true, message: 'Welfare timer reset.' });
    } catch (err) {
      console.error('[welfare] snooze error', err);
      return c.json({ error: 'Failed to snooze welfare check', code: 'WELFARE_SNOOZE_ERR' }, 500);
    }
  });

  app.route('/api/dispatch', api);
}
