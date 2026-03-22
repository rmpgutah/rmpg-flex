// ============================================================
// DL Records — Manual Entry + Full CRUD
// Officers can input DL/person data from physical license
// examinations during field contacts. Stores via storeDlRecord()
// which UPSERTs on (dl_number, dl_state).
// ============================================================

import { Router, Request, Response } from 'express';
import { authenticateToken, requireRole } from '../middleware/auth';
import { validateParamId, escapeLike } from '../middleware/sanitize';
import { storeDlRecord } from '../utils/dlRecordStore';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate } from '../utils/websocket';
import type { DlRecordSubject } from '../utils/dlRecordStore';
import { sendCsv } from '../utils/csvExport';

const router = Router();
router.use(authenticateToken);

// GET /api/dl-records — list recent DL records with pagination
router.get('/', requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const offset = (page - 1) * limit;
    const search = (req.query.search as string || '').trim();

    let where = '';
    const params: any[] = [];

    if (search) {
      where = "WHERE full_name LIKE ? ESCAPE '\\' OR dl_number LIKE ? ESCAPE '\\' OR dl_state LIKE ? ESCAPE '\\'";
      const term = `%${escapeLike(String(search))}%`;
      params.push(term, term, term);
    }

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM dl_records ${where}`
    ).get(...params) as any)?.c || 0;

    params.push(limit, offset);
    const records = db.prepare(`
      SELECT * FROM dl_records ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params);

    res.json({ records, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error('[DL Records] List error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to list DL records' });
  }
});

// GET /api/dl-records/:id — get single DL record detail
router.get('/:id', validateParamId, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

    const record = db.prepare('SELECT * FROM dl_records WHERE id = ?').get(id);
    if (!record) { res.status(404).json({ error: 'DL record not found' }); return; }

    res.json(record);
  } catch (error: any) {
    console.error('[DL Records] Get error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get DL record' });
  }
});

// POST /api/dl-records — manually create/update a DL record
router.post('/', requireRole('admin', 'manager', 'officer'), (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (!body.dl_number || !body.dl_state) {
      res.status(400).json({ error: 'DL number and state are required' });
      return;
    }
    if (!body.last_name || !body.first_name) {
      res.status(400).json({ error: 'First and last name are required' });
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

    auditLog(req, 'dl_record_created', 'dl_record', recordId,
      `Manual DL entry: ${body.dl_number} (${body.dl_state}) — ${body.last_name}, ${body.first_name}`);

    broadcastRecordUpdate({ type: 'dl_record_created', id: recordId });

    res.json({ success: true, recordId, message: 'DL record saved' });
  } catch (error: any) {
    console.error('[DL Records] Manual entry error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to save DL record' });
  }
});

// DELETE /api/dl-records/:id — delete a DL record (admin only)
router.delete('/:id', validateParamId, requireRole('admin'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return; }

    const existing = db.prepare('SELECT id, dl_number, dl_state, full_name FROM dl_records WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'DL record not found' }); return; }

    db.prepare('DELETE FROM dl_records WHERE id = ?').run(id);

    auditLog(req, 'dl_record_deleted', 'dl_record', id,
      `Deleted DL record: ${existing.dl_number} (${existing.dl_state}) — ${existing.full_name}`);

    broadcastRecordUpdate({ type: 'dl_record_deleted', id });

    res.json({ success: true, message: 'DL record deleted' });
  } catch (error: any) {
    console.error('[DL Records] Delete error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete DL record' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /api/dl-records/export/csv — Export DL records
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, source, full_name, first_name, last_name, middle_name,
        date_of_birth, gender, height, weight, eye_color, hair_color, race,
        dl_number, dl_state, dl_class, dl_status, dl_expiration, dl_issue_date,
        dl_restrictions, dl_endorsements, created_at, updated_at
      FROM dl_records
      ORDER BY updated_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'dl_records_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'full_name', header: 'Full Name' },
      { key: 'first_name', header: 'First Name' },
      { key: 'last_name', header: 'Last Name' },
      { key: 'date_of_birth', header: 'DOB' },
      { key: 'gender', header: 'Gender' },
      { key: 'race', header: 'Race' },
      { key: 'height', header: 'Height' },
      { key: 'weight', header: 'Weight' },
      { key: 'eye_color', header: 'Eye Color' },
      { key: 'hair_color', header: 'Hair Color' },
      { key: 'dl_number', header: 'DL Number' },
      { key: 'dl_state', header: 'DL State' },
      { key: 'dl_class', header: 'DL Class' },
      { key: 'dl_status', header: 'DL Status' },
      { key: 'dl_expiration', header: 'DL Expiration' },
      { key: 'dl_issue_date', header: 'DL Issue Date' },
      { key: 'dl_restrictions', header: 'Restrictions' },
      { key: 'dl_endorsements', header: 'Endorsements' },
      { key: 'source', header: 'Source' },
      { key: 'created_at', header: 'Created At' },
      { key: 'updated_at', header: 'Updated At' },
    ], rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
