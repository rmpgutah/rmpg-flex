/**
 * Diagnostic capture endpoint — records client-side UI trap reports.
 *
 * Triggered by the user pressing Ctrl+Alt+D when the desktop app's UI
 * is frozen. The payload contains every fixed-positioned overlay on
 * the page so we can identify which modal is trapping input.
 *
 * Stored in a dedicated SQLite table for forensics + logged via pino
 * so the deploy log surfaces the issue without grep-by-hand.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticateToken);

router.post('/ui-trap', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const username = req.user!.username;
  const payload = req.body ?? {};
  const captured_at = String(payload.capturedAt ?? new Date().toISOString());
  const url = String(payload.url ?? '');
  const userAgent = String(payload.userAgent ?? '');

  const top = Array.isArray(payload.fixedOverlays) && payload.fixedOverlays[0]
    ? `${payload.fixedOverlays[0].tag}.${(payload.fixedOverlays[0].className ?? '').slice(0, 80)} z=${payload.fixedOverlays[0].zIndex}`
    : '<none>';

  // Pino-structured log so the trap surfaces in journalctl with grep-able shape
  logger.warn(
    {
      ui_trap: {
        user_id: userId,
        username,
        captured_at,
        url,
        top_overlay: top,
        body_overflow: payload.bodyOverflow,
        active_element: payload.activeElement,
        overlay_count: Array.isArray(payload.fixedOverlays) ? payload.fixedOverlays.length : 0,
        recent_errors: payload.recentErrors,
        notes: payload.notes,
      },
    },
    `UI_TRAP_CAPTURED user=${username} top=${top}`,
  );

  // Persist full payload to SQLite for later analysis
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO ui_trap_reports (user_id, username, captured_at, url, user_agent, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(userId, username, captured_at, url, userAgent, JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err }, 'ui-trap: failed to persist to DB; logged only');
  }

  res.json({ ok: true });
});

// GET /ui-trap/recent — admin-readable view of the last N reports
router.get('/ui-trap/recent', (req: Request, res: Response) => {
  if (!['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = getDb();
  const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);
  const rows = db.prepare(`
    SELECT id, user_id, username, captured_at, url, created_at
    FROM ui_trap_reports
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  res.json({ rows });
});

router.get('/ui-trap/:id', (req: Request, res: Response) => {
  if (!['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM ui_trap_reports WHERE id = ?').get(parseInt(String(req.params.id), 10));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

export default router;
