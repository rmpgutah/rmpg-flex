import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { apiRateLimit } from '../middleware/rateLimiter';

const router = Router();
router.use(apiRateLimit);
router.use(authenticateToken);

// GET /api/dashboard/stats — Unified dashboard stats aggregator
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const stats: Record<string, unknown> = {};

    // ── Warrants ──────────────────────────────────────────
    try {
      const activeWarrants = (db.prepare("SELECT COUNT(*) as cnt FROM warrants WHERE status = 'active' AND (archived_at IS NULL)").get() as any)?.cnt || 0;
      const byType = db.prepare("SELECT type, COUNT(*) as count FROM warrants WHERE status = 'active' AND (archived_at IS NULL) GROUP BY type").all() as any[];
      const served30d = (db.prepare("SELECT COUNT(*) as cnt FROM warrants WHERE status = 'served' AND served_at >= datetime('now', '-30 days', 'localtime')").get() as any)?.cnt || 0;
      stats.warrants = {
        active: activeWarrants,
        by_type: Object.fromEntries(byType.map((r: any) => [r.type, r.count])),
        served_30d: served30d,
      };
    } catch { stats.warrants = { active: 0, by_type: {}, served_30d: 0 }; }

    // ── Incidents ─────────────────────────────────────────
    try {
      const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM incidents GROUP BY status").all() as any[];
      const byType = db.prepare("SELECT incident_type, COUNT(*) as count FROM incidents WHERE incident_type IS NOT NULL GROUP BY incident_type ORDER BY count DESC LIMIT 10").all() as any[];
      stats.incidents = {
        by_status: byStatus,
        by_type: byType,
      };
    } catch { stats.incidents = { by_status: [], by_type: [] }; }

    // ── Citations ─────────────────────────────────────────
    try {
      const pending = (db.prepare("SELECT COUNT(*) as cnt FROM citations WHERE status = 'pending'").get() as any)?.cnt || 0;
      const thisMonth = (db.prepare("SELECT COUNT(*) as cnt FROM citations WHERE created_at >= strftime('%Y-%m-01', 'now', 'localtime')").get() as any)?.cnt || 0;
      stats.citations = { pending, this_month: thisMonth };
    } catch { stats.citations = { pending: 0, this_month: 0 }; }

    // ── Trespass Orders ───────────────────────────────────
    try {
      const active = (db.prepare("SELECT COUNT(*) as cnt FROM trespass_orders WHERE status = 'active'").get() as any)?.cnt || 0;
      stats.trespass_orders = { active };
    } catch { stats.trespass_orders = { active: 0 }; }

    // ── Arrests ───────────────────────────────────────────
    try {
      const total = (db.prepare("SELECT COUNT(*) as cnt FROM arrest_records").get() as any)?.cnt || 0;
      const thisMonth = (db.prepare("SELECT COUNT(*) as cnt FROM arrest_records WHERE created_at >= strftime('%Y-%m-01', 'now', 'localtime')").get() as any)?.cnt || 0;
      stats.arrests = { total, this_month: thisMonth };
    } catch { stats.arrests = { total: 0, this_month: 0 }; }

    // ── Cases ─────────────────────────────────────────────
    try {
      const open = (db.prepare("SELECT COUNT(*) as cnt FROM cases WHERE status IN ('open', 'active')").get() as any)?.cnt || 0;
      stats.cases = { open };
    } catch { stats.cases = { open: 0 }; }

    res.set('Cache-Control', 'private, max-age=30');
    res.json(stats);
  } catch (error: any) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard stats', code: 'DASHBOARD_STATS_ERROR' });
  }
});

export default router;
