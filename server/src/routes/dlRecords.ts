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
import { config } from '../config';
import type { DlRecordSubject } from '../utils/dlRecordStore';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
router.use(authenticateToken);

// ── Multer for DL image uploads ──
const uploadDir = path.resolve(__dirname, '../../uploads/dl-scans');
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch { /* exists */ }

const dlUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `dl-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are accepted'));
    }
  },
});

// ── Encryption helpers for API key storage ──
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}
function decryptConfig(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length < 3) throw new Error('Malformed encrypted value');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// POST /api/dl-records/ocr-scan — Upload DL image for OCR extraction
router.post('/ocr-scan', requireRole('admin', 'manager', 'officer'), dlUpload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file uploaded', code: 'NO_IMAGE' });
      return;
    }

    // Get RapidAPI key from system_config
    const db = getDb();
    let apiKey: string | null = null;

    // Try DL OCR specific key first, then fall back to general skip tracer key
    const ocrKeyRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'dl_ocr_rapidapi_key' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    if (ocrKeyRow?.config_value) {
      try { apiKey = decryptConfig(ocrKeyRow.config_value); } catch { apiKey = ocrKeyRow.config_value; }
    }

    if (!apiKey) {
      // Fall back to general skip tracer RapidAPI key
      const skipKeyRow = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_key' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | undefined;
      if (skipKeyRow?.config_value) {
        try { apiKey = decryptConfig(skipKeyRow.config_value); } catch { apiKey = skipKeyRow.config_value; }
      }
    }

    if (!apiKey) {
      // Clean up uploaded file
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      res.status(503).json({ error: 'DL OCR API key not configured. Set it in Admin → Integrations.', code: 'OCR_NOT_CONFIGURED' });
      return;
    }

    // Read image file and convert to base64
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

    // Use Google Cloud Vision OCR as primary (free tier: 1000/month)
    // Falls back to basic text extraction if Vision API unavailable
    let ocrText = '';
    let ocrData: any = {};

    // Try Google Vision TEXT_DETECTION first (uses same Maps API key)
    const visionKey = process.env.GOOGLE_MAPS_API_KEY;
    if (visionKey) {
      try {
        const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: base64Image },
              features: [{ type: 'TEXT_DETECTION', maxResults: 1 }, { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
            }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const visionData = await visionRes.json() as any;
        const annotations = visionData?.responses?.[0];
        const fullText = annotations?.fullTextAnnotation?.text || annotations?.textAnnotations?.[0]?.description || '';

        if (fullText.length > 10) {
          console.log('[DL OCR] Google Vision extracted', fullText.length, 'chars');
          ocrText = JSON.stringify({ vision_text: fullText });

          // Parse DL fields from OCR text
          const lines = fullText.split('\n').map((l: string) => l.trim()).filter(Boolean);
          const text = fullText.toUpperCase();

          // Extract common DL fields using regex patterns
          const dlNum = text.match(/(?:DL|LIC|LICENSE|ID)\s*(?:#|NO|NUM|NUMBER)?:?\s*([A-Z0-9]{5,15})/)?.[1] || '';
          const dobMatch = text.match(/(?:DOB|BIRTH|BORN|BD):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/)?.[1] || '';
          const expMatch = text.match(/(?:EXP|EXPIRES?):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/)?.[1] || '';
          const nameLines = lines.filter((l: string) => /^[A-Z][a-z]+\s+[A-Z]/.test(l) && !/\d{4}/.test(l)).slice(0, 2);
          const addrLines = lines.filter((l: string) => /\d+\s+\w+\s+(st|ave|blvd|dr|rd|ln|way|ct|pl|cir)/i.test(l));
          const stateMatch = text.match(/\b(UTAH|CALIFORNIA|NEVADA|ARIZONA|COLORADO|IDAHO|WYOMING|MONTANA|NEW MEXICO|OREGON|WASHINGTON)\b/)?.[1] || '';
          const classMatch = text.match(/(?:CLASS|CL):?\s*([A-D])/)?.[1] || '';
          const sexMatch = text.match(/(?:SEX|GENDER):?\s*(M|F|MALE|FEMALE)/)?.[1] || '';
          const htMatch = text.match(/(?:HT|HEIGHT):?\s*(\d['\-]\d{1,2})/)?.[1] || '';
          const wtMatch = text.match(/(?:WT|WEIGHT):?\s*(\d{2,3})/)?.[1] || '';
          const eyeMatch = text.match(/(?:EYES?):?\s*(BLU|BRN|GRN|HAZ|BLK|GRY)/)?.[1] || '';

          ocrData = {
            result: {
              dl_number: dlNum,
              name: nameLines[0] || '',
              first_name: nameLines[0]?.split(/\s+/)?.[0] || '',
              last_name: nameLines[0]?.split(/\s+/)?.slice(1).join(' ') || '',
              date_of_birth: dobMatch,
              expiry_date: expMatch,
              address: addrLines[0] || '',
              state: stateMatch,
              class_of_vehicle: classMatch,
              sex: sexMatch,
              height: htMatch,
              weight: wtMatch,
              eye_color: eyeMatch,
              raw_text: fullText,
            },
          };
        }
      } catch (visionErr) {
        console.warn('[DL OCR] Google Vision failed:', (visionErr as Error).message);
      }
    }

    // If Vision didn't produce results, return error with guidance
    if (!ocrData.result) {
      ocrText = '{}';
      ocrData = { code: '503', message: 'OCR extraction unavailable. Enable Google Cloud Vision API on your API key for DL scanning.' };
    }

    console.log('[DL OCR] Result keys:', Object.keys(ocrData.result || {}));

    if (!ocrResponse.ok) {
      console.error(`[DL OCR] API error (${ocrResponse.status}):`, ocrText.slice(0, 500));
      if (ocrResponse.status === 403) {
        res.status(503).json({ error: 'DL OCR API subscription expired or access denied.', code: 'OCR_SUBSCRIPTION_EXPIRED' });
      } else if (ocrResponse.status === 429) {
        res.status(429).json({ error: 'DL OCR API rate limit exceeded. Wait and try again.', code: 'OCR_RATE_LIMITED' });
      } else {
        res.status(502).json({ error: `OCR API returned ${ocrResponse.status}`, code: 'OCR_API_ERROR', detail: ocrText.slice(0, 200) });
      }
      return;
    }

    // Parse from the text we already read (body was consumed by .text())
    let ocrData: any;
    try { ocrData = JSON.parse(ocrText); } catch { ocrData = {}; }
    console.log('[DL OCR] Raw response:', ocrText.substring(0, 500));

    // Check for API-level error in 200 response
    if (ocrData.code && ocrData.message && !ocrData.result && !ocrData.data) {
      console.error('[DL OCR] API returned error in 200:', ocrData.message);
      res.status(502).json({ error: ocrData.message || 'OCR API error', code: 'OCR_API_ERROR', detail: ocrText.slice(0, 200) });
      return;
    }

    // Map OCR response to our person/DL record format
    const raw = ocrData.result || ocrData.data || ocrData;

    const extractField = (...keys: string[]): string => {
      for (const key of keys) {
        if (raw[key] && typeof raw[key] === 'string') return raw[key].trim();
        if (ocrData[key] && typeof ocrData[key] === 'string') return ocrData[key].trim();
      }
      return '';
    };

    // Parse name parts
    const fullName = extractField('name', 'full_name', 'fullName', 'Name', 'FN');
    const firstName = extractField('first_name', 'firstName', 'First Name', 'FN', 'fname') || fullName.split(' ')[0] || '';
    const lastName = extractField('last_name', 'lastName', 'Last Name', 'LN', 'lname') || fullName.split(' ').slice(-1)[0] || '';
    const middleName = extractField('middle_name', 'middleName', 'Middle Name', 'MN');

    // Parse address
    const fullAddress = extractField('address', 'Address', 'addr', 'street_address');
    const city = extractField('city', 'City');
    const stateVal = extractField('state', 'State', 'st');
    const zip = extractField('zip', 'zip_code', 'zipCode', 'Zip', 'postal_code', 'ZIP');

    // Parse DL specifics
    const dlNumber = extractField('license_number', 'licenseNumber', 'License Number', 'DL', 'dl_number', 'DLN', 'document_number');
    const dlClass = extractField('class', 'dl_class', 'Class', 'license_class');
    const dlState = extractField('issuing_state', 'issuingState', 'dl_state', 'state_code') || stateVal;
    const dlExpiry = extractField('expiry_date', 'expiryDate', 'expiration_date', 'Expiry Date', 'EXP', 'exp_date', 'expires');
    const dlIssueDate = extractField('issue_date', 'issueDate', 'Issue Date', 'ISS', 'issued', 'iss_date');
    const dlRestrictions = extractField('restrictions', 'Restrictions', 'RSTR');
    const dlEndorsements = extractField('endorsements', 'Endorsements', 'ENDRSMNTS');

    // Parse physical descriptors
    const dob = extractField('date_of_birth', 'dateOfBirth', 'DOB', 'dob', 'Date of Birth', 'birth_date');
    const gender = extractField('sex', 'gender', 'Sex', 'Gender', 'SEX');
    const height = extractField('height', 'Height', 'HGT');
    const weight = extractField('weight', 'Weight', 'WGT');
    const eyeColor = extractField('eyes', 'eye_color', 'eyeColor', 'Eyes', 'EYE');
    const hairColor = extractField('hair', 'hair_color', 'hairColor', 'Hair', 'HAIR');

    const parsed = {
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      full_name: fullName || [firstName, middleName, lastName].filter(Boolean).join(' '),
      date_of_birth: dob,
      gender: gender,
      height: height,
      weight: weight,
      eye_color: eyeColor,
      hair_color: hairColor,
      address: fullAddress,
      city: city,
      state: stateVal,
      zip: zip,
      dl_number: dlNumber,
      dl_state: dlState,
      dl_class: dlClass,
      dl_expiry: dlExpiry,
      dl_issue_date: dlIssueDate,
      dl_restrictions: dlRestrictions,
      dl_endorsements: dlEndorsements,
      source: 'DL_OCR_SCAN',
      raw_ocr: ocrData,
    };

    // Audit log
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_ocr_scan', 'dl_record', 0, ?, ?)"
    ).run(
      req.user!.userId,
      `DL OCR scan: ${parsed.dl_number || 'unknown'} (${parsed.dl_state || '??'}) — ${parsed.last_name || '??'}, ${parsed.first_name || '??'}`,
      req.ip || 'unknown'
    );

    res.json({ success: true, parsed, raw: ocrData });
  } catch (error: any) {
    console.error('[DL OCR] Scan error:', error);
    // Clean up file on error
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
    res.status(500).json({ error: 'DL OCR scan failed', code: 'OCR_SCAN_ERROR', detail: error.message });
  }
});

// POST /api/dl-records/verify — Verify a DL number via RapidAPI
router.post('/verify', requireRole('admin', 'manager', 'officer'), async (req: Request, res: Response) => {
  try {
    const { dl_number, date_of_birth, dl_state } = req.body;

    if (!dl_number || !dl_number.trim()) {
      res.status(400).json({ error: 'DL number is required' }); return;
    }

    const db = getDb();
    let apiKey: string | null = null;

    // Get API key
    const keyRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'dl_verification_rapidapi_key' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    if (keyRow?.config_value) {
      try { apiKey = decryptConfig(keyRow.config_value); } catch { apiKey = keyRow.config_value; }
    }

    if (!apiKey) {
      // Fall back to general RapidAPI key
      const fallback = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_key' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | undefined;
      if (fallback?.config_value) {
        try { apiKey = decryptConfig(fallback.config_value); } catch { apiKey = fallback.config_value; }
      }
    }

    if (!apiKey) {
      res.status(503).json({ error: 'DL Verification API key not configured', code: 'DL_VERIFY_NOT_CONFIGURED' }); return;
    }

    const taskId = crypto.randomUUID();
    const groupId = crypto.randomUUID();

    const apiRes = await fetch('https://driving-license-verification.p.rapidapi.com/v3/tasks/sync/verify_with_source/ind_driving_license', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'driving-license-verification.p.rapidapi.com',
      },
      body: JSON.stringify({
        task_id: taskId,
        group_id: groupId,
        data: {
          id_number: dl_number.trim().toUpperCase(),
          ...(date_of_birth ? { date_of_birth } : {}),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      console.error(`[DL Verify] API error (${apiRes.status}):`, errText.slice(0, 500));
      res.status(502).json({ error: `DL Verification API returned ${apiRes.status}`, detail: errText.slice(0, 200) }); return;
    }

    const data = await apiRes.json() as any;

    // Parse response — extract useful fields
    const result = data?.result || data?.data || data;
    const extraction = result?.extraction_output || result?.source_output || result;

    const parsed = {
      verified: result?.status === 'completed' || result?.verified === true || false,
      dl_number: extraction?.id_number || extraction?.dl_number || extraction?.license_number || dl_number,
      name: extraction?.name || extraction?.full_name || [extraction?.first_name, extraction?.last_name].filter(Boolean).join(' ') || '',
      first_name: extraction?.first_name || '',
      last_name: extraction?.last_name || '',
      father_name: extraction?.fathers_name || extraction?.father_name || '',
      date_of_birth: extraction?.dob || extraction?.date_of_birth || date_of_birth || '',
      address: extraction?.permanent_address || extraction?.address || '',
      dl_class: extraction?.vehicle_class || extraction?.class_of_vehicle || extraction?.cov || '',
      dl_status: extraction?.status || '',
      dl_validity: extraction?.validity || extraction?.valid_upto || extraction?.non_transport_validity || '',
      dl_issue_date: extraction?.date_of_issue || extraction?.issue_date || '',
      dl_expiry: extraction?.non_transport_validity || extraction?.transport_validity || extraction?.expiry_date || '',
      dl_state: extraction?.issuing_state || extraction?.state || dl_state || '',
      blood_group: extraction?.blood_group || '',
      photo_url: extraction?.photo || extraction?.image || '',
      raw: data,
    };

    // Audit
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'dl_verification', 'dl_record', 0, ?, ?)"
    ).run(req.user!.userId, `DL verification: ${dl_number} — ${parsed.verified ? 'VERIFIED' : 'NOT VERIFIED'}`, req.ip || 'unknown');

    res.json({ success: true, parsed, raw: data });
  } catch (err: any) {
    console.error('[DL Verify] Error:', err);
    res.status(500).json({ error: 'DL verification failed', detail: err.message });
  }
});

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
