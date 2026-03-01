import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();
router.use(authenticateToken);

// ─── DASHBOARD ────────────────────────────────────────

router.get('/dashboard', (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const permits = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended
      FROM alarm_permits
    `).get() as any;

    const responses30d = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN is_false_alarm = 1 THEN 1 ELSE 0 END) as false_alarms,
        SUM(CASE WHEN is_false_alarm = 0 THEN 1 ELSE 0 END) as legitimate
      FROM alarm_responses
      WHERE response_date >= date('now', 'localtime', '-30 days')
    `).get() as any;

    const topFalseAlarms = db.prepare(`
      SELECT ap.permit_number, ap.property_name, ap.alarm_company,
        COUNT(ar.id) as false_alarm_count
      FROM alarm_responses ar
      JOIN alarm_permits ap ON ar.permit_id = ap.id
      WHERE ar.is_false_alarm = 1
        AND ar.response_date >= date('now', 'localtime', '-90 days')
      GROUP BY ar.permit_id
      ORDER BY false_alarm_count DESC
      LIMIT 10
    `).all() as any[];

    const feesAssessed = db.prepare(`
      SELECT COUNT(*) as total_fees,
        SUM(fee_amount) as total_amount,
        SUM(CASE WHEN status = 'paid' THEN fee_amount ELSE 0 END) as paid_amount,
        SUM(CASE WHEN status = 'unpaid' THEN fee_amount ELSE 0 END) as unpaid_amount
      FROM alarm_fees
      WHERE assessed_date >= date('now', 'localtime', '-90 days')
    `).get() as any;

    res.json({
      permits: permits || { total: 0, active: 0, expired: 0, suspended: 0 },
      responses_30d: responses30d || { total: 0, false_alarms: 0, legitimate: 0 },
      top_false_alarms: topFalseAlarms,
      fees: feesAssessed || { total_fees: 0, total_amount: 0, paid_amount: 0, unpaid_amount: 0 },
    });
  } catch (error: any) {
    console.error('Alarm dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── ALARM PERMITS ────────────────────────────────────

router.get('/permits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, search, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE archived_at IS NULL';
    const params: any[] = [];

    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search) {
      where += ' AND (permit_number LIKE ? OR property_name LIKE ? OR alarm_company LIKE ? OR property_address LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM alarm_permits ${where}`).get(...params) as any).c;
    const data = db.prepare(`SELECT * FROM alarm_permits ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limitNum, offset);

    res.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get alarm permits error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/permits/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const permit = db.prepare('SELECT * FROM alarm_permits WHERE id = ?').get(req.params.id);
    if (!permit) return res.status(404).json({ error: 'Permit not found' });

    // Get response history for this permit
    const responses = db.prepare(`
      SELECT ar.*, u.full_name as officer_name
      FROM alarm_responses ar
      LEFT JOIN users u ON ar.officer_id = u.id
      WHERE ar.permit_id = ?
      ORDER BY ar.response_date DESC LIMIT 50
    `).all(req.params.id);

    // Get fees
    const fees = db.prepare('SELECT * FROM alarm_fees WHERE permit_id = ? ORDER BY assessed_date DESC').all(req.params.id);

    // False alarm count (rolling 12 months)
    const falseCount = (db.prepare(`
      SELECT COUNT(*) as c FROM alarm_responses
      WHERE permit_id = ? AND is_false_alarm = 1
        AND response_date >= date('now', 'localtime', '-12 months')
    `).get(req.params.id) as any).c;

    res.json({ permit, responses, fees, false_alarm_count_12m: falseCount });
  } catch (error: any) {
    console.error('Get alarm permit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/permits', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      property_id, property_name, property_address, alarm_company, alarm_company_phone,
      alarm_type, zones, permit_holder_name, permit_holder_phone, permit_holder_email,
      monitoring_account, passcode, notes,
    } = req.body;

    // Auto-generate permit number
    const year = new Date().getFullYear();
    const count = (db.prepare(`SELECT COUNT(*) as c FROM alarm_permits WHERE permit_number LIKE ?`).get(`ALP-${year}-%`) as any).c;
    const permit_number = `ALP-${year}-${String(count + 1).padStart(4, '0')}`;

    const result = db.prepare(`
      INSERT INTO alarm_permits (permit_number, property_id, property_name, property_address,
        alarm_company, alarm_company_phone, alarm_type, zones, permit_holder_name,
        permit_holder_phone, permit_holder_email, monitoring_account, passcode,
        status, notes, issued_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, date('now','localtime'), ?)
    `).run(
      permit_number, property_id || null, property_name, property_address,
      alarm_company, alarm_company_phone, alarm_type || 'burglar',
      zones || null, permit_holder_name, permit_holder_phone,
      permit_holder_email, monitoring_account, passcode, notes,
      (req as any).user?.userId
    );

    res.status(201).json({ id: result.lastInsertRowid, permit_number });
  } catch (error: any) {
    console.error('Create alarm permit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/permits/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const fields = req.body;
    const sets: string[] = [];
    const params: any[] = [];

    const allowed = [
      'property_name', 'property_address', 'alarm_company', 'alarm_company_phone',
      'alarm_type', 'zones', 'permit_holder_name', 'permit_holder_phone',
      'permit_holder_email', 'monitoring_account', 'passcode', 'status',
      'expiry_date', 'notes',
    ];

    for (const key of allowed) {
      if (key in fields) { sets.push(`${key} = ?`); params.push(fields[key]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    sets.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);

    db.prepare(`UPDATE alarm_permits SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM alarm_permits WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update alarm permit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── ALARM RESPONSES ──────────────────────────────────

router.get('/responses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { permit_id, is_false_alarm, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (permit_id) { where += ' AND ar.permit_id = ?'; params.push(permit_id); }
    if (is_false_alarm !== undefined) { where += ' AND ar.is_false_alarm = ?'; params.push(is_false_alarm === 'true' ? 1 : 0); }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM alarm_responses ar ${where}`).get(...params) as any).c;
    const data = db.prepare(`
      SELECT ar.*, ap.permit_number, ap.property_name, ap.property_address,
        u.full_name as officer_name
      FROM alarm_responses ar
      LEFT JOIN alarm_permits ap ON ar.permit_id = ap.id
      LEFT JOIN users u ON ar.officer_id = u.id
      ${where}
      ORDER BY ar.response_date DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get alarm responses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/responses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      permit_id, call_id, alarm_type, zone_triggered, response_date,
      arrival_time, clear_time, is_false_alarm, disposition, cause,
      action_taken, notes, officer_id,
    } = req.body;

    // Auto-generate response number
    const year = new Date().getFullYear();
    const count = (db.prepare(`SELECT COUNT(*) as c FROM alarm_responses WHERE response_number LIKE ?`).get(`ALR-${year}-%`) as any).c;
    const response_number = `ALR-${year}-${String(count + 1).padStart(5, '0')}`;

    const result = db.prepare(`
      INSERT INTO alarm_responses (response_number, permit_id, call_id, alarm_type,
        zone_triggered, response_date, arrival_time, clear_time, is_false_alarm,
        disposition, cause, action_taken, notes, officer_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      response_number, permit_id, call_id || null, alarm_type || 'burglar',
      zone_triggered, response_date || localNow(), arrival_time, clear_time,
      is_false_alarm ? 1 : 0, disposition, cause, action_taken, notes,
      officer_id || (req as any).user?.userId
    );

    // Auto-assess fee if false alarm count exceeds threshold
    if (is_false_alarm && permit_id) {
      const falseCount = (db.prepare(`
        SELECT COUNT(*) as c FROM alarm_responses
        WHERE permit_id = ? AND is_false_alarm = 1
          AND response_date >= date('now', 'localtime', '-12 months')
      `).get(permit_id) as any).c;

      // Fee schedule: 1-2 free, 3rd=$50, 4th=$100, 5+=$200
      let feeAmount = 0;
      if (falseCount === 3) feeAmount = 50;
      else if (falseCount === 4) feeAmount = 100;
      else if (falseCount >= 5) feeAmount = 200;

      if (feeAmount > 0) {
        const feeNum = `ALF-${year}-${String(Date.now()).slice(-6)}`;
        db.prepare(`
          INSERT INTO alarm_fees (fee_number, permit_id, response_id, fee_amount,
            reason, false_alarm_number, status, assessed_date)
          VALUES (?, ?, ?, ?, ?, ?, 'unpaid', date('now','localtime'))
        `).run(feeNum, permit_id, result.lastInsertRowid, feeAmount,
          `False alarm #${falseCount} in 12-month period`, falseCount);
      }
    }

    res.status(201).json({ id: result.lastInsertRowid, response_number });
  } catch (error: any) {
    console.error('Create alarm response error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── ALARM FEES ───────────────────────────────────────

router.get('/fees', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { permit_id, status, page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    let where = 'WHERE 1=1';
    const params: any[] = [];

    if (permit_id) { where += ' AND af.permit_id = ?'; params.push(permit_id); }
    if (status) { where += ' AND af.status = ?'; params.push(status); }

    const total = (db.prepare(`SELECT COUNT(*) as c FROM alarm_fees af ${where}`).get(...params) as any).c;
    const data = db.prepare(`
      SELECT af.*, ap.permit_number, ap.property_name, ap.permit_holder_name
      FROM alarm_fees af
      LEFT JOIN alarm_permits ap ON af.permit_id = ap.id
      ${where}
      ORDER BY af.assessed_date DESC LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    console.error('Get alarm fees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/fees/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, paid_date, payment_method, payment_reference, notes } = req.body;
    db.prepare(`
      UPDATE alarm_fees
      SET status = ?, paid_date = ?, payment_method = ?, payment_reference = ?, notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(status, paid_date, payment_method, payment_reference, notes, localNow(), req.params.id);

    const updated = db.prepare('SELECT * FROM alarm_fees WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update alarm fee error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


export default router;
