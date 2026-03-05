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
    res.status(500).json({ error: 'Failed to save DL record' });
  }
});

export default router;
