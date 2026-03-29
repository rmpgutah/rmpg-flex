// ============================================================
// DL Records — Manual Entry Endpoint
// Officers can input DL/person data from physical license
// examinations during field contacts. Stores via storeDlRecord()
// which UPSERTs on (dl_number, dl_state).
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { storeDlRecord } from '../utils/dlRecordStore';
import { getDb } from '../models/database';
import type { DlRecordSubject } from '../utils/dlRecordStore';

const router = Router();
router.use(authenticateToken);

// POST /api/dl-records — manually create/update a DL record
router.post('/', requireRole('admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (!body.dl_number || !body.dl_state) {
      res.status(400).json({ error: 'DL number and state are required', code: 'DL_NUMBER_AND_STATE' });
      return;
    }
    if (!body.last_name || !body.first_name) {
      res.status(400).json({ error: 'First and last name are required', code: 'FIRST_AND_LAST_NAME' });
      return;
    }

    const subject: DlRecordSubject = {
      source: 'MANUAL_ENTRY',
      first_name: body.first_name || '',
      middle_name: body.middle_name || '',
      last_name: body.last_name || '',
      full_name: `${body.first_name || ''} ${body.middle_name || ''} ${body.last_name || ''}`.replace(/\s+/g, ' ').trim(),
      suffix: body.suffix || '',
      date_of_birth: body.date_of_birth || '',
      gender: body.gender || '',
      height: body.height || '',
      weight: body.weight || '',
      eye_color: body.eye_color || '',
      hair_color: body.hair_color || '',
      race: body.race || '',
      dl_number: body.dl_number,
      dl_state: body.dl_state,
      dl_class: body.dl_class || '',
      dl_status: body.dl_status || '',
      dl_expiration: body.dl_expiration || '',
      dl_issue_date: body.dl_issue_date || '',
      dl_restrictions: body.dl_restrictions || '',
      dl_endorsements: body.dl_endorsements || '',
      addresses: [],
    };

    // Build address if provided
    if (body.address || body.city) {
      subject.addresses.push({
        address: body.address || '',
        address2: body.address2 || '',
        city: body.city || '',
        state: body.address_state || body.dl_state || '',
        postal_code: body.postal_code || '',
        country: 'US',
      });
    }

    const recordId = storeDlRecord(subject);

    // Audit log
    const db = getDb();
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_record_manual_entry', 'dl_record', ?, ?, ?)"
    ).run(
      req.user!.userId,
      recordId,
      `Manual DL entry: ${body.dl_number} (${body.dl_state}) — ${body.last_name}, ${body.first_name}`,
      req.ip || 'unknown'
    );

    res.json({ success: true, recordId, message: 'DL record saved' });
  } catch (error: any) {
    console.error('[DL Records] Manual entry error:', error);
    res.status(500).json({ error: 'Failed to save DL record', code: 'FAILED_TO_SAVE_DL' });
  }
});

// GET /api/dl-records — list DL records with pagination & search
router.get('/', requireRole('admin', 'manager', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 25));
    const search = (req.query.search as string || '').trim();

    let where = '1=1';
    const params: any[] = [];

    if (search) {
      where += ' AND (full_name LIKE ? OR dl_number LIKE ? OR last_name LIKE ? OR first_name LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM dl_records WHERE ${where}`).get(...params) as any)?.cnt || 0;
    const rows = db.prepare(`
      SELECT * FROM dl_records WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, perPage, (page - 1) * perPage);

    res.json({ data: rows, total, page, per_page: perPage });
  } catch (error: any) {
    console.error('[DL Records] List error:', error);
    res.status(500).json({ error: 'Failed to list DL records', code: 'FAILED_TO_LIST_DL' });
  }
});

// GET /api/dl-records/:id — get single DL record
router.get('/:id', requireRole('admin', 'manager', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM dl_records WHERE id = ?').get(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'DL record not found', code: 'DL_NOT_FOUND' });
      return;
    }
    res.json(record);
  } catch (error: any) {
    console.error('[DL Records] Get error:', error);
    res.status(500).json({ error: 'Failed to get DL record', code: 'FAILED_TO_GET_DL' });
  }
});

// PUT /api/dl-records/:id — update a DL record
router.put('/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dl_records WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'DL record not found', code: 'DL_NOT_FOUND' });
      return;
    }

    const allowed = [
      'first_name', 'middle_name', 'last_name', 'suffix', 'full_name',
      'date_of_birth', 'gender', 'height', 'weight', 'eye_color', 'hair_color', 'race',
      'dl_number', 'dl_state', 'dl_class', 'dl_status', 'dl_expiration',
      'dl_issue_date', 'dl_restrictions', 'dl_endorsements'
    ];
    const setClauses: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }
    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'DL_NO_FIELDS' });
      return;
    }
    setClauses.push("updated_at = datetime('now','localtime')");
    values.push(req.params.id);

    db.prepare(`UPDATE dl_records SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM dl_records WHERE id = ?').get(req.params.id);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_record_update', 'dl_record', ?, ?, ?)"
    ).run(req.user!.userId, req.params.id, `Updated DL record #${req.params.id}`, req.ip || 'unknown');

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('[DL Records] Update error:', error);
    res.status(500).json({ error: 'Failed to update DL record', code: 'FAILED_TO_UPDATE_DL' });
  }
});

// DELETE /api/dl-records/:id — delete a DL record (admin only)
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM dl_records WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'DL record not found', code: 'DL_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM dl_records WHERE id = ?').run(req.params.id);

    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_record_delete', 'dl_record', ?, ?, ?)"
    ).run(req.user!.userId, req.params.id, `Deleted DL record: ${existing.dl_number} (${existing.dl_state}) — ${existing.last_name}, ${existing.first_name}`, req.ip || 'unknown');

    res.json({ success: true });
  } catch (error: any) {
    console.error('[DL Records] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete DL record', code: 'FAILED_TO_DELETE_DL' });
  }
});

export default router;
