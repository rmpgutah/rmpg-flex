/**
 * Welfare check endpoints — officer responses to welfare prompts.
 *
 * POST /api/dispatch/welfare/ack    — officer is code 4, clear timer
 * POST /api/dispatch/welfare/help   — officer needs help, escalate now
 * POST /api/dispatch/welfare/snooze — push timer forward by N min (max 30)
 */
import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth';
import { acknowledgeWelfareCheck, requestHelp, snoozeWelfareWatch, getActiveWatchCount } from '../../utils/officerWelfare';
import { logger } from '../../utils/logger';

const router = Router();

router.post('/welfare/ack', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authenticated user required', code: 'AUTH_REQUIRED' });
      return;
    }
    const msg = acknowledgeWelfareCheck(userId);
    if (!msg) {
      res.status(404).json({ error: 'No active welfare watch for this user', code: 'NO_ACTIVE_WATCH' });
      return;
    }
    res.json({ success: true, message: msg });
  } catch (err: any) {
    logger.error({ err }, 'welfare ack failed');
    res.status(500).json({ error: 'Failed to acknowledge welfare check', code: 'WELFARE_ACK_ERROR' });
  }
});

router.post('/welfare/help', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authenticated user required', code: 'AUTH_REQUIRED' });
      return;
    }
    const info = requestHelp(userId);
    if (!info) {
      res.status(404).json({ error: 'No active welfare watch for this user', code: 'NO_ACTIVE_WATCH' });
      return;
    }
    res.json({ success: true, ...info, message: 'Help broadcast sent to all units' });
  } catch (err: any) {
    logger.error({ err }, 'welfare help failed');
    res.status(500).json({ error: 'Failed to request help', code: 'WELFARE_HELP_ERROR' });
  }
});

router.post('/welfare/snooze', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authenticated user required', code: 'AUTH_REQUIRED' });
      return;
    }
    const minutes = Number(req.body?.minutes ?? 10);
    const nextCheckAt = snoozeWelfareWatch(userId, minutes);
    if (nextCheckAt == null) {
      res.status(404).json({ error: 'No active welfare watch for this user', code: 'NO_ACTIVE_WATCH' });
      return;
    }
    res.json({ success: true, nextCheckAt: new Date(nextCheckAt).toISOString(), snoozedFor: Math.max(1, Math.min(minutes, 30)) });
  } catch (err: any) {
    logger.error({ err }, 'welfare snooze failed');
    res.status(500).json({ error: 'Failed to snooze welfare check', code: 'WELFARE_SNOOZE_ERROR' });
  }
});

router.get('/welfare/active', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (_req: Request, res: Response) => {
  res.json({ activeCount: getActiveWatchCount() });
});

export default router;
