import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

export function mountDlRecordsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // POST /api/dl-records/ocr-scan — Upload DL image for OCR extraction
  api.post('/ocr-scan', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      let apiKey: string | null = null;
      const ocrKeyRow = await db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'dl_ocr_rapidapi_key' AND is_active = 1 LIMIT 1"
      ).get() as any;
      if (ocrKeyRow?.config_value) {
        apiKey = ocrKeyRow.config_value;
      }
      if (!apiKey) {
        const skipKeyRow = await db.prepare(
          "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_key' AND is_active = 1 LIMIT 1"
        ).get() as any;
        if (skipKeyRow?.config_value) {
          apiKey = skipKeyRow.config_value;
        }
      }
      if (!apiKey) {
        return c.json({ error: 'DL OCR API key not configured. Set it in Admin → Integrations.', code: 'OCR_NOT_CONFIGURED' }, 503);
      }

      const formData = await c.req.parseBody();
      const imageFile = formData['image'];
      if (!imageFile || typeof imageFile === 'string') {
        return c.json({ error: 'No image file uploaded', code: 'NO_IMAGE' }, 400);
      }

      const imageArrayBuffer = await (imageFile as File).arrayBuffer();
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageArrayBuffer)));

      let ocrText = '';
      let ocrData: any = {};
      const visionKey = c.env.GOOGLE_VISION_API_KEY || null;
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
            ocrText = JSON.stringify({ vision_text: fullText });
            const lines = fullText.split('\n').map((l: string) => l.trim()).filter(Boolean);
            const text = fullText.toUpperCase();
            const afterLabel = (patterns: RegExp[], fallback = ''): string => {
              for (const p of patterns) {
                const m = text.match(p);
                if (m?.[1]) return m[1].trim();
              }
              return fallback;
            };
            const lastName = afterLabel([
              /(?:LN|LAST\s*NAME|SURNAME|FAMILY\s*NAME)[:\s]+([A-Z][A-Z'-]+)/,
              /(?:^|\n)\s*1\s+([A-Z][A-Z'-]{2,})\s*(?:\n|$)/m,
            ]);
            const firstName = afterLabel([
              /(?:FN|FIRST\s*NAME|GIVEN\s*NAME)[:\s]+([A-Z][A-Z'-]+)/,
              /(?:^|\n)\s*2\s+([A-Z][A-Z'-]{2,})\s*(?:\n|$)/m,
            ]);
            const middleName = afterLabel([/(?:MN|MIDDLE\s*NAME|MIDDLE)[:\s]+([A-Z][A-Z'-]+)/]);
            let finalFirst = firstName;
            let finalLast = lastName;
            let finalMiddle = middleName;
            if (!finalFirst && !finalLast) {
              const nameCandidate = lines.find((l: string) =>
                /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(l) && !/\d/.test(l) && l.length < 40
              );
              if (nameCandidate) {
                const parts = nameCandidate.split(/\s+/);
                finalFirst = parts[0] || '';
                finalLast = parts.length > 2 ? parts[parts.length - 1] : parts[1] || '';
                finalMiddle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
              }
              const commaName = lines.find((l: string) => /^[A-Z][A-Z'-]+,\s*[A-Z]/.test(l.toUpperCase()));
              if (commaName && !finalFirst) {
                const [last, rest] = commaName.split(',').map((s: string) => s.trim());
                finalLast = last;
                const restParts = (rest || '').split(/\s+/);
                finalFirst = restParts[0] || '';
                finalMiddle = restParts.slice(1).join(' ') || '';
              }
            }
            const dlNumber = afterLabel([
              /(?:DLN|DL\s*#|DL\s*NO|DRIVERS\s*LIC\s*#|LICENSE\s*#)[:\s]+([A-Z0-9][A-Z0-9-]+)/,
              /(?:^|\n)\s*([A-Z]\d{3,8})\s*(?:\n|$)/m,
            ]);
            const dob = afterLabel([
              /(?:DOB|DATE\s*OF\s*BIRTH|BIRTH\s*DATE|BIRTH)[:\s]+(\d{2}[/-]\d{2}[/-]\d{4})/,
            ]);
            const expiry = afterLabel([
              /(?:EXP|EXPIRES|EXPIRATION|EXP\s*DATE)[:\s]+(\d{2}[/-]\d{2}[/-]\d{4})/,
            ]);
            const addressFull = afterLabel([
              /(?:ADDRESS|ADDR|RESIDENCE|MAILING)[:\s]+([A-Z0-9].{5,})/,
            ]);
            let addrLine1 = '', addrCity = '', addrState = '', addrZip = '';
            if (addressFull) {
              const addrParts = addressFull.split(/\s+/);
              const zipMatch = addressFull.match(/\b(\d{5}(?:-\d{4})?)\b/);
              if (zipMatch) addrZip = zipMatch[1];
              const stateMatch = addressFull.match(/\b([A-Z]{2})\b/);
              if (stateMatch) addrState = stateMatch[1];
            }
            const gender = afterLabel([
              /(?:SEX|GENDER)[:\s]+([MF])/,
            ]);
            const height = afterLabel([
              /(?:HGT|HEIGHT)[:\s]+(\d['-]\d{1,2}")?/,
            ]);
            const weight = afterLabel([
              /(?:WGT|WEIGHT)[:\s]+(\d{2,3})/,
            ]);
            const issuingState = afterLabel([
              /(?:ISS\s*STATE|STATE|ISSUING\s*STATE)[:\s]+([A-Z]{2})/,
            ]);
            const idClass = afterLabel([
              /(?:CLASS|TYPE)[:\s]+([A-Z]{1,3})/,
            ]);
            const endorsementsText = afterLabel([
              /(?:END|ENDORSEMENTS)[:\s]+([A-Z ]+)/,
            ]);
            const restrictionsText = afterLabel([
              /(?:RSTR|REST|RESTRICTIONS)[:\s]+([A-Z ]+)/,
            ]);
            const race = afterLabel([
              /(?:RACE|ETHNICITY)[:\s]+([A-Z]+)/,
            ]);
            const organDonor = afterLabel([
              /(?:ORGAN\s*DONOR|DONOR)[:\s]+(YES|NO)?/,
            ]);
            ocrData = {
              first_name: finalFirst, last_name: finalLast, middle_name: finalMiddle,
              dl_number: dlNumber, dob, expiration_date: expiry, address_line1: addrLine1,
              city: addrCity, state: addrState, zip_code: addrZip, gender,
              height, weight, issuing_state: issuingState, id_class: idClass,
              endorsements: endorsementsText, restrictions: restrictionsText,
              race, organ_donor: organDonor === 'YES',
            };
          }
        } catch { /* Vision API failed, continue with RapidAPI fallback */ }
      }
      if (!ocrText && apiKey) {
        try {
          const rapidRes = await fetch('https://driver-license-ocr.p.rapidapi.com/process-image', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-rapidapi-key': apiKey,
              'x-rapidapi-host': 'driver-license-ocr.p.rapidapi.com',
            },
            body: JSON.stringify({ image: base64Image }),
            signal: AbortSignal.timeout(30_000),
          });
          if (rapidRes.ok) {
            const rapidData = await rapidRes.json();
            ocrText = JSON.stringify({ rapidapi: rapidData });
            if (rapidData?.fields) {
              ocrData = { ...ocrData, ...rapidData.fields };
            }
          }
        } catch { /* RapidAPI failed */ }
      }
      const user = c.get('user');
      await db.prepare(
        `INSERT INTO dl_ocr_scans (user_id, image_filename, ocr_text, ocr_data, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(user.userId, (imageFile as File).name || 'upload', ocrText, JSON.stringify(ocrData), localNow());
      return c.json({ success: true, data: ocrData, raw_text: ocrText });
    } catch (error: any) {
      return c.json({ error: 'OCR scan failed', code: 'OCR_SCAN_FAILED' }, 500);
    }
  });

  // POST /api/dl-records — Create or update DL record
  api.post('/', requireRole('admin', 'manager', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { dl_number, dl_state, first_name, last_name, middle_name, dob, address_line1, address_line2, city, state, zip_code, gender, height, weight, eye_color, hair_color, expiration_date, id_class, endorsements, restrictions, issuing_state, race, organ_donor } = body;
      if (!dl_number || !dl_state || !first_name || !last_name) {
        return c.json({ error: 'dl_number, dl_state, first_name, and last_name required', code: 'MISSING_FIELDS' }, 400);
      }
      const existing = await db.prepare('SELECT id FROM dl_records WHERE dl_number = ? AND dl_state = ?').get(dl_number, dl_state) as any;
      if (existing) {
        await db.prepare(`UPDATE dl_records SET first_name=?, last_name=?, middle_name=?, dob=?, address_line1=?, address_line2=?, city=?, state=?, zip_code=?, gender=?, height=?, weight=?, eye_color=?, hair_color=?, expiration_date=?, id_class=?, endorsements=?, restrictions=?, issuing_state=?, race=?, organ_donor=?, updated_at=? WHERE id=?`)
          .run(first_name, last_name, middle_name || null, dob || null, address_line1 || null, address_line2 || null, city || null, state || null, zip_code || null, gender || null, height || null, weight || null, eye_color || null, hair_color || null, expiration_date || null, id_class || null, endorsements || null, restrictions || null, issuing_state || null, race || null, organ_donor != null ? (organ_donor ? 1 : 0) : null, localNow(), existing.id);
        return c.json({ success: true, id: existing.id, updated: true });
      }
      const result = await db.prepare(`INSERT INTO dl_records (dl_number, dl_state, first_name, last_name, middle_name, dob, address_line1, address_line2, city, state, zip_code, gender, height, weight, eye_color, hair_color, expiration_date, id_class, endorsements, restrictions, issuing_state, race, organ_donor, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(dl_number, dl_state, first_name, last_name, middle_name || null, dob || null, address_line1 || null, address_line2 || null, city || null, state || null, zip_code || null, gender || null, height || null, weight || null, eye_color || null, hair_color || null, expiration_date || null, id_class || null, endorsements || null, restrictions || null, issuing_state || null, race || null, organ_donor != null ? (organ_donor ? 1 : 0) : null, localNow(), localNow());
      return c.json({ success: true, id: Number(result.meta.last_row_id), updated: false }, 201);
    } catch (error: any) {
      return c.json({ error: 'Failed to save DL record', code: 'DL_SAVE_ERROR' }, 500);
    }
  });

  // GET /api/dl-records — List DL records
  api.get('/', requireRole('admin', 'manager', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { search, limit = '50', offset = '0' } = c.req.query();
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
      const offsetNum = parseInt(offset as string, 10) || 0;
      let sql = 'SELECT * FROM dl_records';
      const params: any[] = [];
      if (search) {
        sql += ' WHERE dl_number LIKE ? OR last_name LIKE ? OR first_name LIKE ?';
        const q = `%${search}%`;
        params.push(q, q, q);
      }
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limitNum, offsetNum);
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch (error: any) {
      return c.json({ error: 'Failed to load DL records', code: 'DL_LOAD_ERROR' }, 500);
    }
  });

  // GET /api/dl-records/:id
  api.get('/:id', requireRole('admin', 'manager', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const row = await db.prepare('SELECT * FROM dl_records WHERE id = ?').get(id);
      if (!row) return c.json({ error: 'DL record not found' }, 404);
      return c.json(row);
    } catch (error: any) {
      return c.json({ error: 'Failed to load DL record', code: 'DL_LOAD_ERROR' }, 500);
    }
  });

  // PUT /api/dl-records/:id
  api.put('/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const fields = ['first_name', 'last_name', 'middle_name', 'dob', 'address_line1', 'address_line2', 'city', 'state', 'zip_code', 'gender', 'height', 'weight', 'eye_color', 'hair_color', 'expiration_date', 'id_class', 'endorsements', 'restrictions', 'issuing_state', 'race', 'organ_donor'];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (body[f] !== undefined) {
          sets.push(`${f} = ?`);
          vals.push(f === 'organ_donor' ? (body[f] ? 1 : 0) : body[f]);
        }
      }
      if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
      sets.push('updated_at = ?');
      vals.push(localNow());
      vals.push(id);
      await db.prepare(`UPDATE dl_records SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to update DL record', code: 'DL_UPDATE_ERROR' }, 500);
    }
  });

  // DELETE /api/dl-records/:id
  api.delete('/:id', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      await db.prepare('DELETE FROM dl_records WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: 'Failed to delete DL record', code: 'DL_DELETE_ERROR' }, 500);
    }
  });

  app.route('/api/dl-records', api);
}
