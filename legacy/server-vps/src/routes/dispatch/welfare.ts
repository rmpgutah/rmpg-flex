// ============================================================
// RMPG Flex — Officer Welfare Check Endpoints
// Backs the MDT welfare-check modal (DI-4). The officerWelfare
// in-memory engine already drives the timers and the WebSocket
// push of `welfare_check` events; these endpoints expose the
// three officer responses: Code 4 (ack), Need Help (panic-equiv
// escalation), and Snooze (just resets the activity timer).
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { broadcastDispatchUpdate } from '../../utils/websocket';
import { acknowledgeWelfareCheck, recordOfficerActivity } from '../../utils/officerWelfare';
import { localNow } from '../../utils/timeUtils';
import { logger } from '../../utils/logger';

const router = Router();

// POST /api/dispatch/welfare/ack  —  Officer responds Code 4
router.post(
  '/welfare/ack',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const msg = acknowledgeWelfareCheck(userId);
      recordOfficerActivity(userId);

      try {
        const db = getDb();
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'welfare_ack', 'user', ?, ?, ?)
        `).run(userId, userId, msg || 'Code 4 ack (no active watch)', req.ip || 'unknown');
      } catch { /* non-fatal */ }

      broadcastDispatchUpdate({
        action: 'welfare_cleared',
        user_id: userId,
        message: msg || 'Code 4 ack received (no active watch).',
        at: localNow(),
      });

      res.json({ success: true, message: msg || 'Code 4 ack received (no active watch).' });
    } catch (err) {
      logger.error({ err }, '[welfare] ack error');
      res.status(500).json({ error: 'Failed to ack welfare check', code: 'WELFARE_ACK_ERR' });
    }
  },
);

// POST /api/dispatch/welfare/help  —  Officer explicitly requests help
// Escalates straight to welfare_emergency: blasts every connected client.
// The dispatcher screen treats this exactly like a manual panic activation;
// the officerWelfare in-memory state is NOT auto-cleared — supervisor must
// resolve.
router.post(
  '/welfare/help',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const db = getDb();
      const user = db.prepare('SELECT id, full_name, badge_number FROM users WHERE id = ?').get(userId) as any;
      const unit = db.prepare('SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ?').get(userId) as any;

      const callContext = unit?.current_call_id
        ? db.prepare('SELECT id, call_number, incident_type, location_address, latitude, longitude FROM calls_for_service WHERE id = ?').get(unit.current_call_id) as any
        : null;

      const payload = {
        action: 'welfare_emergency',
        user_id: userId,
        officer_name: user?.full_name || 'Unknown officer',
        badge_number: user?.badge_number || null,
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
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'welfare_help_requested', 'user', ?, ?, ?)
        `).run(userId, userId,
          `Officer requested help from MDT welfare modal${callContext ? ' on call ' + callContext.call_number : ''}`,
          req.ip || 'unknown');
      } catch { /* non-fatal */ }

      broadcastDispatchUpdate(payload);
      res.json({ success: true, broadcast: payload });
    } catch (err) {
      logger.error({ err }, '[welfare] help error');
      res.status(500).json({ error: 'Failed to broadcast help request', code: 'WELFARE_HELP_ERR' });
    }
  },
);

// POST /api/dispatch/welfare/snooze  —  Resets the activity timer only.
// Doesn't clear the modal on other officers; just delays the next prompt
// by the standard INITIAL_CHECK_MS window.
router.post(
  '/welfare/snooze',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      recordOfficerActivity(userId);
      res.json({ success: true, message: 'Welfare timer reset.' });
    } catch (err) {
      logger.error({ err }, '[welfare] snooze error');
      res.status(500).json({ error: 'Failed to snooze welfare check', code: 'WELFARE_SNOOZE_ERR' });
    }
  },
);

export default router;
