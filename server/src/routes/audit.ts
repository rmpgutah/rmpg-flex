import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { sendCsv } from '../utils/csvExport';
import { localNow } from '../utils/timeUtils';
import { escapeLike } from '../middleware/sanitize';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin', 'manager'));

// GET /api/audit/logs - List audit log entries with filtering
router.get('/logs', (req: Request, res: Response) => {
  try {
    const {
      action,
      entityType,
      userId,
      startDate,
      endDate,
      search,
      page = '1',
      limit = '100'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string, 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    const db = getDb();

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: any[] = [];

    if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }

    if (entityType) {
      conditions.push('al.entity_type = ?');
      params.push(entityType);
    }

    if (userId) {
      conditions.push('al.user_id = ?');
      params.push(userId);
    }

    if (startDate) {
      conditions.push('al.created_at >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('al.created_at <= ?');
      params.push(endDate);
    }

    if (search) {
      conditions.push("al.details LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(search as string)}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM activity_log al
      ${whereClause}
    `).get(...params) as any;
    const total = countRow?.total || 0;
    const totalPages = Math.ceil(total / limitNum);

    // Get paginated data with user information
    const data = db.prepare(`
      SELECT
        al.id,
        al.user_id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.details,
        al.ip_address,
        al.created_at,
        u.full_name as user_name,
        u.badge_number,
        u.role as user_role
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/audit/stats - Audit statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();

    // Total entries
    const totalRow = db.prepare('SELECT COUNT(*) as total FROM activity_log').get() as any;
    const totalEntries = totalRow?.total || 0;

    // Entries today
    const todayRow = db.prepare(`
      SELECT COUNT(*) as total
      FROM activity_log
      WHERE date(created_at) = date('now')
    `).get() as any;
    const entriesToday = todayRow?.total || 0;

    // Compute 30-day cutoff once for reuse
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`;

    // Top actions (last 30 days)
    const topActions = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE created_at >= ?
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `).all(thirtyDaysAgo);

    // Top users (last 30 days)
    const topUsers = db.prepare(`
      SELECT
        u.full_name as user_name,
        u.badge_number,
        COUNT(*) as count
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
        AND u.full_name IS NOT NULL
      GROUP BY u.full_name, u.badge_number
      ORDER BY count DESC
      LIMIT 10
    `).all(thirtyDaysAgo);

    res.json({
      totalEntries,
      entriesToday,
      topActions,
      topUsers
    });
  } catch (error) {
    console.error('Error fetching audit stats:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

// GET /api/audit/export - Export audit log as CSV
router.get('/export', (req: Request, res: Response) => {
  try {
    const {
      action,
      entityType,
      userId,
      startDate,
      endDate,
      search,
    } = req.query;

    const db = getDb();

    const conditions: string[] = [];
    const params: any[] = [];

    if (action) {
      conditions.push('al.action = ?');
      params.push(action);
    }
    if (entityType) {
      conditions.push('al.entity_type = ?');
      params.push(entityType);
    }
    if (userId) {
      conditions.push('al.user_id = ?');
      params.push(userId);
    }
    if (startDate) {
      conditions.push('al.created_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('al.created_at <= ?');
      params.push(endDate);
    }
    if (search) {
      conditions.push("al.details LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(search as string)}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT al.action, al.entity_type, al.entity_id, al.details,
        u.full_name as user_name, al.ip_address, al.created_at
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT 50000
    `).all(...params);

    sendCsv(res, 'audit_log_export.csv', [
      { key: 'action', header: 'Action' },
      { key: 'entity_type', header: 'Entity Type' },
      { key: 'entity_id', header: 'Entity ID' },
      { key: 'details', header: 'Details' },
      { key: 'user_name', header: 'User Name' },
      { key: 'ip_address', header: 'IP Address' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    console.error('Export audit log error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
