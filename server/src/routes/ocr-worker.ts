import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, safeStr } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';
import {
  callGoogleVision, getVisionKey,
  parseIdDocument, parseServeDocument, parseCourtDocument,
  normalizeDate,
} from '../utils/ocrEngine';
import type { OcrResult } from '../utils/ocrEngine';

export function mountOcrRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // POST /api/ocr/scan-document — Upload image for OCR + ID/document parsing
  api.post('/scan-document', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();

      const formData = await c.req.parseBody();
      const imageFile = formData['image'] || formData['file'] || formData['document'];
      if (!imageFile || typeof imageFile === 'string') {
        return c.json({ error: 'No image file uploaded', code: 'NO_IMAGE' }, 400);
      }

      const file = imageFile as File;
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      if (isPdf) {
        return c.json({
          error: 'PDF upload detected. Use /api/serve-intake/extract-text for PDF text extraction.',
          code: 'PDF_NOT_SUPPORTED',
        }, 400);
      }

      const base64Image = btoa(String.fromCharCode(...bytes));
      const apiKey = c.env.GOOGLE_VISION_API_KEY || await getVisionKey(db);
      if (!apiKey) {
        return c.json({ error: 'OCR API key not configured. Set GOOGLE_VISION_API_KEY.', code: 'OCR_NOT_CONFIGURED' }, 503);
      }

      const rawText = await callGoogleVision(base64Image, apiKey);
      if (!rawText || rawText.length < 10) {
        return c.json({ error: 'OCR extracted insufficient text. Try a clearer image.', code: 'OCR_INSUFFICIENT_TEXT' }, 422);
      }

      const parsed = parseIdDocument(rawText);

      await db.prepare(`
        INSERT INTO dl_ocr_scans (user_id, image_filename, ocr_text, ocr_data, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.userId, file.name || 'ocr_scan', rawText, JSON.stringify(parsed), now);

      return c.json({
        success: true,
        documentType: parsed.documentType,
        confidence: parsed.confidence,
        fields: parsed.fields,
        rawText: rawText.substring(0, 5000),
        allDates: parsed.allDates,
      });
    } catch (err: any) {
      return c.json({ error: 'OCR scan failed', code: 'OCR_SCAN_FAILED', details: err?.message }, 500);
    }
  });

  // POST /api/ocr/scan-court — OCR + court document parsing
  api.post('/scan-court', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();

      const formData = await c.req.parseBody();
      const imageFile = formData['image'] || formData['file'] || formData['document'];
      if (!imageFile || typeof imageFile === 'string') {
        return c.json({ error: 'No image file uploaded', code: 'NO_IMAGE' }, 400);
      }

      const file = imageFile as File;
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      if (isPdf) {
        return c.json({
          error: 'PDF upload detected. Use /api/serve-intake/extract-text for PDF text extraction.',
          code: 'PDF_NOT_SUPPORTED',
        }, 400);
      }

      const base64Image = btoa(String.fromCharCode(...bytes));
      const apiKey = c.env.GOOGLE_VISION_API_KEY || await getVisionKey(db);
      if (!apiKey) {
        return c.json({ error: 'OCR API key not configured', code: 'OCR_NOT_CONFIGURED' }, 503);
      }

      const rawText = await callGoogleVision(base64Image, apiKey);
      if (!rawText || rawText.length < 50) {
        return c.json({ error: 'OCR extracted insufficient text', code: 'OCR_INSUFFICIENT_TEXT' }, 422);
      }

      const parsed = parseCourtDocument(rawText);

      return c.json({
        success: true,
        confidence: parsed.confidence,
        fields: parsed.fields,
        rawText: rawText.substring(0, 5000),
      });
    } catch (err: any) {
      return c.json({ error: 'Court document scan failed', code: 'OCR_SCAN_FAILED', details: err?.message }, 500);
    }
  });

  // POST /api/ocr/intake — Full OCR + Serve Intake pipeline
  api.post('/intake', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();

      const body = await c.req.json();
      const { documents, text, imageBase64 } = body;
      let rawText = text || '';

      if (imageBase64) {
        const apiKey = c.env.GOOGLE_VISION_API_KEY || await getVisionKey(db);
        if (!apiKey) {
          return c.json({ error: 'OCR API key not configured', code: 'OCR_NOT_CONFIGURED' }, 503);
        }
        rawText = await callGoogleVision(imageBase64, apiKey);
      }

      if (documents && Array.isArray(documents)) {
        rawText = documents.map((d: any) => d.text || '').join('\n');
      }

      if (!rawText || rawText.length < 50) {
        return c.json({ error: 'Insufficient document text. Upload clearer scans or paste text directly.', code: 'INSUFFICIENT_TEXT' }, 400);
      }

      const parsed = parseServeDocument(rawText);

      const fields = parsed.fields;
      const firstName = fields['first_name']?.value || '';
      const lastName = fields['last_name']?.value || fields['recipient_name']?.value?.split(/\s+/).slice(-1)[0] || '';
      const middleName = fields['middle_name']?.value || '';
      const fullName = fields['recipient_name']?.value || `${firstName} ${middleName} ${lastName}`.trim();
      const address = fields['address']?.value || '';
      const city = fields['city']?.value || '';
      const state = fields['state']?.value || 'UT';
      const zip = fields['zip_code']?.value || '';
      const caseNumber = fields['case_number']?.value || '';
      const plaintiffName = fields['plaintiff']?.value || '';
      const defendantName = fields['defendant']?.value || fullName;
      const court = fields['court']?.value || '';
      const instructions = fields['instructions']?.value || '';
      const jobNumber = fields['job_number']?.value || '';
      const dueDate = fields['due_date']?.value || '';
      const dob = fields['dob']?.value || '';
      const attorneyName = fields['attorney_for_plaintiff']?.value || '';
      const attorneyEmail = fields['attorney_email']?.value || '';
      const attorneyPhone = fields['attorney_phone']?.value || '';
      const barNumber = fields['attorney_bar_number']?.value || '';
      const fee = fields['fee']?.value || '';

      const personName = firstName || lastName ? { first: firstName, middle: middleName, last: lastName } : null;
      if (!personName?.last && !defendantName) {
        return c.json({ error: 'Could not extract name from document text', code: 'NO_NAME_EXTRACTED' }, 400);
      }

      const persons: any[] = [];

      if (defendantName) {
        const nameParts = defendantName.split(/\s+/);
        const defFirst = personName?.first || nameParts[0] || '';
        const defLast = personName?.last || nameParts.slice(-1)[0] || '';
        const defMiddle = personName?.middle || (nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '');
        const existing = await db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1').get(defFirst, defLast) as any;
        if (existing) {
          persons.push({ id: existing.id, role: 'defendant' });
          if (dob) {
            await db.prepare('UPDATE persons SET dob = COALESCE(NULLIF(dob, \'\'), ?) WHERE id = ?').run(normalizeDate(dob), existing.id);
          }
          if (address) {
            await db.prepare('UPDATE persons SET address = COALESCE(NULLIF(address, \'\'), ?) WHERE id = ?').run(address, existing.id);
          }
        } else {
          const defFullName = `${defFirst} ${defMiddle ? defMiddle + ' ' : ''}${defLast}`.trim();
          const res = await db.prepare(
            `INSERT INTO persons (first_name, last_name, middle_name, full_name, dob, address, phone, email, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(defFirst, defLast, defMiddle || null, defFullName, normalizeDate(dob) || null, address || null,
            null, null, now, now);
          persons.push({ id: Number(res.meta.last_row_id), role: 'defendant' });
        }
      }

      if (plaintiffName) {
        const pParts = plaintiffName.split(/\s+/);
        const pFirst = pParts[0] || '';
        const pLast = pParts.slice(-1)[0] || '';
        const pMiddle = pParts.length > 2 ? pParts.slice(1, -1).join(' ') : '';
        const existing = await db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1').get(pFirst, pLast) as any;
        if (existing) {
          persons.push({ id: existing.id, role: 'plaintiff' });
        } else {
          const pFullName = `${pFirst} ${pMiddle ? pMiddle + ' ' : ''}${pLast}`.trim();
          const res = await db.prepare(
            'INSERT INTO persons (first_name, last_name, middle_name, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(pFirst, pLast, pMiddle || null, pFullName, now, now);
          persons.push({ id: Number(res.meta.last_row_id), role: 'plaintiff' });
        }
      }

      const clientName = attorneyName || plaintiffName || 'Process Service Client';
      const documentType = fields['document_type_court']?.value?.toLowerCase() || 'summons';

      const serveResult = await db.prepare(`
        INSERT INTO serve_queue (
          client_id, case_number, defendant_name, plaintiff_name,
          defendant_address, defendant_city, defendant_state, defendant_zip,
          instructions, document_text, parsed_data, status, assigned_officer_id,
          created_by, created_at, updated_at,
          attorney_name, attorney_phone, attorney_email, sm_job_id, deadline, court_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        null, caseNumber, defendantName, plaintiffName,
        address || null, city || null, state || null, zip || null,
        instructions || null, rawText.substring(0, 10000), JSON.stringify(parsed),
        null, user.userId, now, now,
        attorneyName || null, attorneyPhone || null, attorneyEmail || null,
        jobNumber || null, dueDate || null, court || null,
      );
      const serveId = Number(serveResult.meta.last_row_id);

      for (const p of persons) {
        await db.prepare(
          'INSERT INTO serve_queue_persons (serve_queue_id, person_id, role, created_at) VALUES (?, ?, ?, ?)'
        ).run(serveId, p.id, p.role, now);
      }

      return c.json({
        success: true,
        id: serveId,
        documentType: parsed.documentType,
        confidence: parsed.confidence,
        persons: persons.map(p => ({ id: p.id, role: p.role })),
        fields: Object.fromEntries(
          Object.entries(parsed.fields).map(([k, f]) => [k, { value: f.value, confidence: f.confidence }])
        ),
      }, 201);
    } catch (err: any) {
      return c.json({ error: 'OCR intake failed', code: 'OCR_INTAKE_FAILED', details: err?.message }, 500);
    }
  });

  // POST /api/ocr/create-person — Create person record from OCR data
  api.post('/create-person', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();

      const body = await c.req.json();
      const { first_name, last_name, middle_name, dob, address, city, state, zip_code,
              gender, height, weight, eye_color, hair_color, race,
              dl_number, dl_state, expiration_date, dl_class, endorsements, restrictions } = body;

      if (!first_name || !last_name) {
        return c.json({ error: 'first_name and last_name required', code: 'MISSING_FIELDS' }, 400);
      }

      let personId: number;
      const existing = await db.prepare(
        'SELECT id FROM persons WHERE first_name = ? AND last_name = ? AND (middle_name = ? OR middle_name IS NULL) LIMIT 1'
      ).get(first_name, last_name, middle_name || null) as any;

      if (existing) {
        personId = existing.id;
        await db.prepare(`
          UPDATE persons SET dob = COALESCE(NULLIF(dob, ''), ?), address = COALESCE(NULLIF(address, ''), ?),
          gender = COALESCE(NULLIF(gender, ''), ?), height = COALESCE(NULLIF(height, ''), ?),
          weight = COALESCE(NULLIF(weight, ''), ?), eye_color = COALESCE(NULLIF(eye_color, ''), ?),
          hair_color = COALESCE(NULLIF(hair_color, ''), ?), race = COALESCE(NULLIF(race, ''), ?),
          updated_at = ?
          WHERE id = ?
        `).run(
          normalizeDate(dob) || null, address || null, gender || null,
          height || null, weight || null, eye_color || null,
          hair_color || null, race || null, now, personId
        );
      } else {
        const fullName = `${first_name} ${middle_name ? middle_name + ' ' : ''}${last_name}`.trim();
        const res = await db.prepare(`
          INSERT INTO persons (first_name, last_name, middle_name, full_name, dob, address, city, state,
            gender, height, weight, eye_color, hair_color, race, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          first_name, last_name, middle_name || null, fullName,
          normalizeDate(dob) || null, address || null, city || null, state || null,
          gender || null, height || null, weight || null,
          eye_color || null, hair_color || null, race || null, now, now
        );
        personId = Number(res.meta.last_row_id);
      }

      if (dl_number && dl_state) {
        const dlExisting = await db.prepare(
          'SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?'
        ).get(dl_number, dl_state) as any;
        if (dlExisting) {
          await db.prepare(`
            UPDATE dl_records SET first_name=?, last_name=?, middle_name=?, dob=?,
              address_line1=?, gender=?, height=?, weight=?, eye_color=?, hair_color=?, race=?,
              expiration_date=?, dl_class=?, endorsements=?, restrictions=?, updated_at=?
            WHERE id=?
          `).run(
            first_name, last_name, middle_name || null, normalizeDate(dob) || null,
            address || null, gender || null, height || null, weight || null,
            eye_color || null, hair_color || null, race || null,
            normalizeDate(expiration_date) || null, dl_class || null,
            endorsements || null, restrictions || null, localNow(), dlExisting.id
          );
        } else {
          await db.prepare(`
            INSERT INTO dl_records (dl_number, dl_state, first_name, last_name, middle_name, dob,
              address_line1, gender, height, weight, eye_color, hair_color, race,
              expiration_date, dl_class, endorsements, restrictions, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            dl_number, dl_state, first_name, last_name, middle_name || null,
            normalizeDate(dob) || null, address || null, gender || null,
            height || null, weight || null, eye_color || null, hair_color || null,
            race || null, normalizeDate(expiration_date) || null, dl_class || null,
            endorsements || null, restrictions || null, now, now
          );
        }
      }

      return c.json({ success: true, person_id: personId, updated: !!existing }, existing ? 200 : 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to create person from OCR data', code: 'OCR_PERSON_FAILED', details: err?.message }, 500);
    }
  });

  app.route('/api/ocr', api);
}
