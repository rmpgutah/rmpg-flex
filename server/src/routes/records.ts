import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';
import { localNow, localToday } from '../utils/timeUtils';
import { searchOfacLocal } from '../utils/ofacScraper';
import { config } from '../config';
import { paramStr } from '../utils/reqHelpers';

const router = Router();

// ── Encryption helper for API key decryption ──
function decryptApiKey(stored: string): string {
  const key = crypto.createHash('sha256').update(config.jwt.secret).digest();
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

/**
 * Screen a person against the OFAC consolidated sanctions list.
 * Updates watchlist_match and watchlist_checked_at on the person record.
 * Non-blocking — does not throw on failure.
 */
function screenPersonOfac(personId: number, firstName: string, lastName: string): void {
  try {
    const db = getDb();
    const now = localNow();
    const hits = searchOfacLocal(`${lastName}, ${firstName}`, {
      type: 'person',
      firstName,
      lastName,
      limit: 3,
    });

    const matchInfo = hits.length > 0
      ? JSON.stringify(hits.map(h => ({ name: h.sdn_name, program: h.program, list: h.source_list })))
      : null;

    db.prepare(
      'UPDATE persons SET watchlist_match = ?, watchlist_checked_at = ? WHERE id = ?'
    ).run(matchInfo, now, personId);

    // Create notification if there's a hit
    if (hits.length > 0) {
      try {
        db.prepare(`
          INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, created_at)
          VALUES ('system', 'high', ?, ?, 'person', ?, ?)
        `).run(
          `OFAC WATCHLIST MATCH: ${firstName} ${lastName}`,
          `Person record #${personId} matches ${hits.length} OFAC entry(ies): ${hits.map(h => h.sdn_name).join(', ')}`,
          personId,
          now,
        );
      } catch { /* notifications table may not exist */ }
    }
  } catch (err) {
    console.warn('OFAC screening failed for person', personId, err);
  }
}

router.use(authenticateToken);

// ─── PERSONS ──────────────────────────────────────────

// GET /api/records/persons - List persons
router.get('/persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page = '1', limit = '100000', flags, archived } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit as string, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (flags) {
      whereClause += ' AND flags LIKE ?';
      params.push(`%"${flags}"%`);
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND archived_at IS NULL';
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM persons ${whereClause}`).get(...params) as any;

    const persons = db.prepare(`
      SELECT * FROM persons ${whereClause}
      ORDER BY last_name, first_name
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: persons,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get persons error:', error);
    res.status(500).json({ error: 'Failed to get persons', code: 'GET_PERSONS_ERROR' });
  }
});

// GET /api/records/persons/search - Search persons
router.get('/persons/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters', code: 'SEARCH_QUERY_MUST_BE' });
      return;
    }

    const searchTerm = `%${q}%`;

    const persons = db.prepare(`
      SELECT * FROM persons
      WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
        OR address LIKE ? OR (first_name || ' ' || last_name) LIKE ?
      ORDER BY last_name, first_name
      LIMIT 50
    `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);

    res.json(persons);
  } catch (error: any) {
    console.error('Search persons error:', error);
    res.status(500).json({ error: 'Failed to search persons', code: 'SEARCH_PERSONS_ERROR' });
  }
});

// GET /api/records/persons/export - Export persons as CSV
router.get('/persons/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { flags } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (flags) {
      whereClause += ' AND flags LIKE ?';
      params.push(`%"${flags}"%`);
    }

    const rows = db.prepare(`
      SELECT last_name, first_name, dob, gender, address, phone, email, flags, created_at
      FROM persons
      ${whereClause}
      ORDER BY last_name, first_name
    
      LIMIT 1000
    `).all(...params);

    sendCsv(res, 'persons_export.csv', [
      { key: 'last_name', header: 'Last Name' },
      { key: 'first_name', header: 'First Name' },
      { key: 'dob', header: 'Date of Birth' },
      { key: 'gender', header: 'Gender' },
      { key: 'address', header: 'Address' },
      { key: 'phone', header: 'Phone' },
      { key: 'email', header: 'Email' },
      { key: 'flags', header: 'Flags' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    console.error('Export persons error:', error);
    res.status(500).json({ error: 'Failed to export persons', code: 'EXPORT_PERSONS_ERROR' });
  }
});

// GET /api/records/persons/:id - Get person details
router.get('/persons/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const personId = parseInt(paramStr(req.params.id), 10);
    if (isNaN(personId)) { res.status(400).json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }); return; }
    let person = db.prepare('SELECT * FROM persons WHERE id = ?').get(personId) as any;

    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    // Auto-screen against OFAC if this person was never checked
    if (!person.watchlist_checked_at && person.first_name && person.last_name) {
      screenPersonOfac(person.id, person.first_name, person.last_name);
      // Re-fetch to include updated watchlist_match
      person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    }

    // Get owned vehicles
    const vehicles = db.prepare('SELECT * FROM vehicles_records WHERE owner_person_id = ?').all(person.id);

    // Get linked clients
    let linked_clients: any[] = [];
    try {
      linked_clients = db.prepare(`
        SELECT cp.*, c.name as client_name, c.status as client_status, c.contact_phone as client_phone
        FROM client_persons cp
        JOIN clients c ON cp.client_id = c.id
        WHERE cp.person_id = ?
        ORDER BY cp.is_primary DESC, c.name
      
        LIMIT 1000
      `).all(person.id);
    } catch (e) {
      console.warn('Get person linked_clients query failed:', (e as Error).message);
    }

    res.json({ ...person, vehicles, linked_clients });
  } catch (error: any) {
    console.error('Get person error:', error);
    res.status(500).json({ error: 'Failed to get person', code: 'GET_PERSON_ERROR' });
  }
});

// GET /api/records/persons/:id/history - Get person's incident history
router.get('/persons/:id/history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    // Search activity log for mentions of this person
    const fullName = `${person.first_name} ${person.last_name}`;
    const activity = db.prepare(`
      SELECT al.*, u.full_name as user_name
      FROM activity_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.details LIKE ? OR al.details LIKE ? OR al.details LIKE ?
      ORDER BY al.created_at DESC
      LIMIT 50
    `).all(`%${person.first_name}%`, `%${person.last_name}%`, `%${fullName}%`);

    // Get BOLOs that mention this person
    const bolos = db.prepare(`
      SELECT * FROM bolos
      WHERE subject_description LIKE ? OR description LIKE ?
      ORDER BY created_at DESC
    
      LIMIT 1000
    `).all(`%${person.last_name}%`, `%${person.last_name}%`);

    res.json({
      person,
      activity,
      bolos,
    });
  } catch (error: any) {
    console.error('Get person history error:', error);
    res.status(500).json({ error: 'Failed to get person history', code: 'GET_PERSON_HISTORY_ERROR' });
  }
});

// GET /api/records/persons/:id/system-history - Aggregated system history
router.get('/persons/:id/system-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    // ── Warrants ──────────────────────────────────────
    let warrants: any[] = [];
    try {
      warrants = db.prepare(`
        SELECT id, warrant_number, type, status, charge_description,
          offense_level, statute_citation, created_at as date_issued, expires_at
        FROM warrants
        WHERE subject_person_id = ?
        ORDER BY
          CASE WHEN status = 'active' THEN 0 ELSE 1 END,
          created_at DESC
      
        LIMIT 1000
      `).all(person.id);
    } catch (e) {
      // warrants table might not exist
      console.warn('system-history: warrants query failed', (e as Error).message);
    }

    // ── Linked Incidents ─────────────────────────────
    let incidents: any[] = [];
    try {
      incidents = db.prepare(`
        SELECT i.id, i.incident_number, i.incident_type, i.status, i.priority,
          i.narrative as description, i.created_at, ip.role
        FROM incident_persons ip
        JOIN incidents i ON ip.incident_id = i.id
        WHERE ip.person_id = ?
        ORDER BY i.created_at DESC
      
        LIMIT 1000
      `).all(person.id);
    } catch (e) {
      console.warn('system-history: incidents query failed', (e as Error).message);
    }

    // ── Linked Dispatch Calls ────────────────────────
    let calls: any[] = [];
    try {
      // Get calls that are linked to incidents this person is involved in
      const callRows = db.prepare(`
        SELECT DISTINCT c.id, c.call_number, c.incident_type, c.priority,
          c.status, c.location_address as location, c.created_at
        FROM incident_persons ip
        JOIN incidents i ON ip.incident_id = i.id
        JOIN calls_for_service c ON i.call_id = c.id
        WHERE ip.person_id = ? AND i.call_id IS NOT NULL
        ORDER BY c.created_at DESC
      
        LIMIT 1000
      `).all(person.id);
      calls = callRows;
    } catch (e) {
      console.warn('system-history: calls query failed', (e as Error).message);
    }

    // ── Citations ──────────────────────────────────────
    let citations: any[] = [];
    try {
      citations = db.prepare(`
        SELECT id, citation_number, type, status, statute_citation,
          violation_description, offense_level, fine_amount,
          violation_date, violation_time, location,
          issuing_officer_name, court_date, court_name
        FROM citations
        WHERE person_id = ?
        ORDER BY
          CASE WHEN status = 'issued' THEN 0 WHEN status = 'contested' THEN 1 ELSE 2 END,
          violation_date DESC
      
        LIMIT 1000
      `).all(person.id);
    } catch (e) {
      console.warn('system-history: citations query failed', (e as Error).message);
    }

    // ── BOLO Status ──────────────────────────────────
    let bolo_active = false;
    try {
      const flags = person.flags ? JSON.parse(person.flags) : [];
      bolo_active = Array.isArray(flags) && flags.some(
        (f: string) => typeof f === 'string' && f.toLowerCase() === 'bolo'
      );
    } catch {
      bolo_active = false;
    }

    // ── Summary ──────────────────────────────────────
    const active_warrants = warrants.filter(w => w.status === 'active').length;
    const active_citations = citations.filter(c => c.status === 'issued' || c.status === 'contested').length;

    res.json({
      warrants,
      incidents,
      calls,
      citations,
      bolo_active,
      summary: {
        total_warrants: warrants.length,
        active_warrants,
        total_incidents: incidents.length,
        total_calls: calls.length,
        total_citations: citations.length,
        active_citations,
      },
    });
  } catch (error: any) {
    console.error('Get person system-history error:', error);
    res.status(500).json({ error: 'Failed to get person system-history', code: 'GET_PERSON_SYSTEMHISTORY_ERROR' });
  }
});

// POST /api/records/persons - Create person
router.post('/persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      first_name, last_name, middle_name, alias_nickname, dob, gender, race,
      height, height_feet, height_inches, weight, build, complexion, hair_color, eye_color, scars_marks_tattoos,
      clothing_description, address, city, state, zip, phone, email,
      dl_number, dl_state, dl_expiry, dl_class, ssn_last4,
      ssn_full, id_image_url, id_type, id_number, id_state, id_expiry,
      employer, occupation, emergency_contact_name, emergency_contact_phone,
      gang_affiliation, is_sex_offender, is_veteran, language,
      place_of_birth, citizenship, marital_status,
      hair_length, hair_style, facial_hair, glasses, shoe_size, blood_type,
      phone_secondary, social_media,
      probation_parole, probation_parole_officer, known_associates,
      emergency_contact_relationship, caution_flags,
      photo_url, flags, notes,
      // Extended identification, medical, military, LE fields — these
      // correspond to inputs in PersonFormModal.tsx that were previously
      // being silently dropped by this route.
      ncic_number, sor_number, fbi_number, state_id_number,
      passport_number, passport_country, immigration_status,
      disability_flags, mental_health_flags, substance_abuse, medication_notes,
      education_level, military_branch, military_status, tribal_affiliation,
      identifying_marks_location, tattoo_description, scar_description,
      piercing_description, distinguishing_features,
      email_secondary, date_last_seen, location_last_seen, alias_dob,
      home_phone, work_phone,
    } = req.body;

    if (!first_name || !last_name) {
      res.status(400).json({ error: 'first_name and last_name are required', code: 'FIRSTNAME_AND_LASTNAME_ARE' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO persons (first_name, last_name, middle_name, alias_nickname, dob, gender, race,
        height, height_feet, height_inches, weight, build, complexion, hair_color, eye_color, scars_marks_tattoos,
        clothing_description, address, city, state, zip, phone, email,
        dl_number, dl_state, dl_expiry, dl_class, ssn_last4,
        ssn_full, id_image_url, id_type, id_number, id_state, id_expiry,
        employer, occupation, emergency_contact_name, emergency_contact_phone,
        gang_affiliation, is_sex_offender, is_veteran, language,
        place_of_birth, citizenship, marital_status,
        hair_length, hair_style, facial_hair, glasses, shoe_size, blood_type,
        phone_secondary, social_media,
        probation_parole, probation_parole_officer, known_associates,
        emergency_contact_relationship, caution_flags,
        photo_url, flags, notes,
        ncic_number, sor_number, fbi_number, state_id_number,
        passport_number, passport_country, immigration_status,
        disability_flags, mental_health_flags, substance_abuse, medication_notes,
        education_level, military_branch, military_status, tribal_affiliation,
        identifying_marks_location, tattoo_description, scar_description,
        piercing_description, distinguishing_features,
        email_secondary, date_last_seen, location_last_seen, alias_dob,
        home_phone, work_phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?)
    `).run(
      first_name, last_name, middle_name || null, alias_nickname || null,
      dob || null, gender || null, race || null,
      height || null, height_feet != null && height_feet !== '' ? parseInt(height_feet, 10) : null, height_inches != null && height_inches !== '' ? parseInt(height_inches, 10) : null,
      weight || null, build || null, complexion || null,
      hair_color || null, eye_color || null, scars_marks_tattoos || null,
      clothing_description || null, address || null, city || null, state || null, zip || null,
      phone || null, email || null,
      dl_number || null, dl_state || null, dl_expiry || null, dl_class || null, ssn_last4 || null,
      ssn_full || null, id_image_url || null, id_type || null, id_number || null, id_state || null, id_expiry || null,
      employer || null, occupation || null, emergency_contact_name || null, emergency_contact_phone || null,
      gang_affiliation || null, is_sex_offender ? 1 : 0, is_veteran ? 1 : 0, language || null,
      place_of_birth || null, citizenship || null, marital_status || null,
      hair_length || null, hair_style || null, facial_hair || null, glasses || null, shoe_size || null, blood_type || null,
      phone_secondary || null, social_media || null,
      probation_parole || null, probation_parole_officer || null, known_associates || null,
      emergency_contact_relationship || null, caution_flags || null,
      photo_url || null, JSON.stringify(flags || []), notes || null,
      ncic_number || null, sor_number || null, fbi_number || null, state_id_number || null,
      passport_number || null, passport_country || null, immigration_status || null,
      disability_flags || null, mental_health_flags || null, substance_abuse || null, medication_notes || null,
      education_level || null, military_branch || null, military_status || null, tribal_affiliation || null,
      identifying_marks_location || null, tattoo_description || null, scar_description || null,
      piercing_description || null, distinguishing_features || null,
      email_secondary || null, date_last_seen || null, location_last_seen || null, alias_dob || null,
      home_phone || null, work_phone || null,
    );

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_created', 'person', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created person record: ${first_name} ${last_name}`, req.ip || 'unknown');

    // Auto-screen against OFAC sanctions BEFORE returning response
    screenPersonOfac(Number(result.lastInsertRowid), first_name, last_name);

    // SELECT after screening so watchlist_match is included in response
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(result.lastInsertRowid);
    broadcastRecordUpdate({ action: 'person_created', id: result.lastInsertRowid, entity: 'person' });
    res.status(201).json(person);
  } catch (error: any) {
    console.error('Create person error:', error);
    res.status(500).json({ error: 'Failed to create person', code: 'CREATE_PERSON_ERROR' });
  }
});

// PUT /api/records/persons/:id - Update person
router.put('/persons/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    const {
      first_name, last_name, middle_name, alias_nickname, dob, gender, race,
      height, height_feet, height_inches, weight, build, complexion, hair_color, eye_color, scars_marks_tattoos,
      clothing_description, address, city, state, zip, phone, email,
      dl_number, dl_state, dl_expiry, dl_class, ssn_last4,
      ssn_full, id_image_url, id_type, id_number, id_state, id_expiry,
      employer, occupation, emergency_contact_name, emergency_contact_phone,
      gang_affiliation, is_sex_offender, is_veteran, language,
      place_of_birth, citizenship, marital_status,
      hair_length, hair_style, facial_hair, glasses, shoe_size, blood_type,
      phone_secondary, social_media,
      probation_parole, probation_parole_officer, known_associates,
      emergency_contact_relationship, caution_flags,
      photo_url, flags, notes,
    } = req.body;

    // Build dynamic SET clause — only update fields explicitly provided in the request body
    const fields: string[] = [];
    const values: any[] = [];
    const bodyKeys = Object.keys(req.body);

    const fieldMap: Record<string, (v: any) => any> = {
      first_name: v => v || null, last_name: v => v || null, middle_name: v => v ?? null,
      alias_nickname: v => v ?? null, dob: v => v ?? null, gender: v => v ?? null,
      race: v => v ?? null, height: v => v ?? null,
      height_feet: v => v != null && v !== '' ? parseInt(v, 10) : null,
      height_inches: v => v != null && v !== '' ? parseInt(v, 10) : null,
      weight: v => v ?? null,
      build: v => v ?? null, complexion: v => v ?? null, hair_color: v => v ?? null,
      eye_color: v => v ?? null, scars_marks_tattoos: v => v ?? null,
      clothing_description: v => v ?? null, address: v => v ?? null,
      city: v => v ?? null, state: v => v ?? null, zip: v => v ?? null,
      phone: v => v ?? null, email: v => v ?? null,
      dl_number: v => v ?? null, dl_state: v => v ?? null, dl_expiry: v => v ?? null,
      dl_class: v => v ?? null, ssn_last4: v => v ?? null,
      ssn_full: v => v ?? null, id_image_url: v => v ?? null,
      id_type: v => v ?? null, id_number: v => v ?? null,
      id_state: v => v ?? null, id_expiry: v => v ?? null,
      employer: v => v ?? null, occupation: v => v ?? null,
      emergency_contact_name: v => v ?? null, emergency_contact_phone: v => v ?? null,
      gang_affiliation: v => v ?? null,
      is_sex_offender: v => v ? 1 : 0, is_veteran: v => v ? 1 : 0,
      language: v => v ?? null, place_of_birth: v => v ?? null,
      citizenship: v => v ?? null, marital_status: v => v ?? null,
      hair_length: v => v ?? null, hair_style: v => v ?? null,
      facial_hair: v => v ?? null, glasses: v => v ?? null,
      shoe_size: v => v ?? null, blood_type: v => v ?? null,
      phone_secondary: v => v ?? null, social_media: v => v ?? null,
      probation_parole: v => v ?? null, probation_parole_officer: v => v ?? null,
      known_associates: v => v ?? null,
      emergency_contact_relationship: v => v ?? null, caution_flags: v => v ?? null,
      photo_url: v => v ?? null, notes: v => v ?? null,
      // Extended identification, medical, military, LE fields — added
      // to match the full PersonFormModal input set so edits no longer
      // silently drop values the user typed.
      ncic_number: v => v ?? null,
      sor_number: v => v ?? null,
      fbi_number: v => v ?? null,
      state_id_number: v => v ?? null,
      passport_number: v => v ?? null,
      passport_country: v => v ?? null,
      immigration_status: v => v ?? null,
      disability_flags: v => v ?? null,
      mental_health_flags: v => v ?? null,
      substance_abuse: v => v ?? null,
      medication_notes: v => v ?? null,
      education_level: v => v ?? null,
      military_branch: v => v ?? null,
      military_status: v => v ?? null,
      tribal_affiliation: v => v ?? null,
      identifying_marks_location: v => v ?? null,
      tattoo_description: v => v ?? null,
      scar_description: v => v ?? null,
      piercing_description: v => v ?? null,
      distinguishing_features: v => v ?? null,
      email_secondary: v => v ?? null,
      date_last_seen: v => v ?? null,
      location_last_seen: v => v ?? null,
      alias_dob: v => v ?? null,
      home_phone: v => v ?? null,
      work_phone: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(fieldMap)) {
      if (bodyKeys.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }
    // flags is special — always JSON-stringify
    if (bodyKeys.includes('flags')) {
      fields.push('flags = ?');
      values.push(JSON.stringify(flags ?? []));
    }

    if (fields.length > 0) {
      fields.push("updated_at = ?");
      values.push(localNow());
      values.push(req.params.id);
      db.prepare(`UPDATE persons SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_updated', 'person', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated person record: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');

    // Re-screen against OFAC if name changed (non-blocking)
    const newFirst = req.body.first_name || person.first_name;
    const newLast = req.body.last_name || person.last_name;
    if (newFirst !== person.first_name || newLast !== person.last_name) {
      screenPersonOfac(Number(req.params.id), newFirst, newLast);
    }

    const updated = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
    broadcastRecordUpdate({ action: 'person_updated', id: Number(req.params.id), entity: 'person' });
    res.json(updated);
  } catch (error: any) {
    console.error('Update person error:', error);
    res.status(500).json({ error: 'Failed to update person', code: 'UPDATE_PERSON_ERROR' });
  }
});

// DELETE /api/records/persons/:id - Delete person
router.delete('/persons/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM incident_persons WHERE person_id = ?').run(person.id);
      db.prepare('UPDATE vehicles_records SET owner_person_id = NULL WHERE owner_person_id = ?').run(person.id);
      db.prepare('DELETE FROM persons WHERE id = ?').run(person.id);
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'person_deleted', 'person', ?, ?, ?)
      `).run(req.user!.userId, person.id, `Deleted person: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');
    });
    deleteTx();

    res.json({ message: 'Person deleted' });
  } catch (error: any) {
    console.error('Delete person error:', error);
    res.status(500).json({ error: 'Failed to delete person', code: 'DELETE_PERSON_ERROR' });
  }
});

// POST /api/records/persons/screen-all-ofac - Bulk OFAC screening for all unscreened persons
router.post('/persons/screen-all-ofac', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const unchecked = db.prepare(
      'SELECT id, first_name, last_name FROM persons WHERE watchlist_checked_at IS NULL AND first_name IS NOT NULL AND last_name IS NOT NULL'
    ).all() as { id: number; first_name: string; last_name: string }[];

    let screened = 0;
    let matches = 0;
    for (const p of unchecked) {
      screenPersonOfac(p.id, p.first_name, p.last_name);
      screened++;
      // Check if a match was found
      const updated = db.prepare('SELECT watchlist_match FROM persons WHERE id = ?').get(p.id) as any;
      if (updated && updated.watchlist_match) matches++;
    }

    res.json({ screened, matches, message: `Screened ${screened} person(s), found ${matches} OFAC match(es)` });
  } catch (error: any) {
    console.error('Bulk OFAC screening error:', error);
    res.status(500).json({ error: 'Bulk OFAC screening failed', code: 'BULK_OFAC_SCREENING_FAILED' });
  }
});

// POST /api/records/persons/:id/screen-ofac - Force re-screen a single person
router.post('/persons/:id/screen-ofac', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }

    // Force re-screen regardless of previous check
    screenPersonOfac(person.id, person.first_name, person.last_name);

    const updated = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('OFAC re-screen error:', error);
    res.status(500).json({ error: 'OFAC re-screen failed', code: 'OFAC_RESCREEN_FAILED' });
  }
});

// POST /api/records/persons/:id/archive
router.post('/persons/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    if (person.archived_at) { res.status(400).json({ error: 'Person is already archived', code: 'PERSON_IS_ALREADY_ARCHIVED' }); return; }
    const now = localNow();
    db.prepare('UPDATE persons SET archived_at = ? WHERE id = ?').run(now, person.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_archived', 'person', ?, ?, ?)`).run(req.user!.userId, person.id, `Archived person: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');
    res.json(db.prepare('SELECT * FROM persons WHERE id = ?').get(person.id));
  } catch (error: any) { console.error('Archive person error:', error); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// POST /api/records/persons/:id/unarchive
router.post('/persons/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    if (!person.archived_at) { res.status(400).json({ error: 'Person is not archived', code: 'PERSON_IS_NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE persons SET archived_at = NULL WHERE id = ?').run(person.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_unarchived', 'person', ?, ?, ?)`).run(req.user!.userId, person.id, `Restored person: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');
    res.json(db.prepare('SELECT * FROM persons WHERE id = ?').get(person.id));
  } catch (error: any) { console.error('Unarchive person error:', error); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ─── VEHICLES ─────────────────────────────────────────

// GET /api/records/vehicles - List vehicles
router.get('/vehicles', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page = '1', limit = '100000', archived } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit as string, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    if (archived === 'true') {
      whereClause += ' AND v.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND v.archived_at IS NULL';
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM vehicles_records v ${whereClause}`).get() as any;

    const vehicles = db.prepare(`
      SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
      FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      ${whereClause}
      ORDER BY v.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limitNum, offset);

    res.json({
      data: vehicles,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ error: 'Failed to get vehicles', code: 'GET_VEHICLES_ERROR' });
  }
});

// GET /api/records/vehicles/search - Search vehicles
router.get('/vehicles/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters', code: 'SEARCH_QUERY_MUST_BE' });
      return;
    }

    const searchTerm = `%${q}%`;

    const vehicles = db.prepare(`
      SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
      FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      WHERE v.plate_number LIKE ? OR v.vin LIKE ? OR v.make LIKE ? OR v.model LIKE ?
        OR v.color LIKE ? OR v.notes LIKE ?
      ORDER BY v.created_at DESC
      LIMIT 50
    `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);

    res.json(vehicles);
  } catch (error: any) {
    console.error('Search vehicles error:', error);
    res.status(500).json({ error: 'Failed to search vehicles', code: 'SEARCH_VEHICLES_ERROR' });
  }
});

// GET /api/records/vehicles/export - Export vehicles as CSV
router.get('/vehicles/export', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const rows = db.prepare(`
      SELECT v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
        COALESCE(p.first_name || ' ' || p.last_name, '') as owner_name, v.created_at
      FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      ORDER BY v.created_at DESC
    
      LIMIT 1000
    `).all();

    sendCsv(res, 'vehicles_export.csv', [
      { key: 'plate_number', header: 'Plate Number' },
      { key: 'state', header: 'State' },
      { key: 'make', header: 'Make' },
      { key: 'model', header: 'Model' },
      { key: 'year', header: 'Year' },
      { key: 'color', header: 'Color' },
      { key: 'vin', header: 'VIN' },
      { key: 'owner_name', header: 'Owner Name' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    console.error('Export vehicles error:', error);
    res.status(500).json({ error: 'Failed to export vehicles', code: 'EXPORT_VEHICLES_ERROR' });
  }
});

// GET /api/records/vehicles/:id - Get vehicle
router.get('/vehicles/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare(`
      SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
      FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      WHERE v.id = ?
    `).get(req.params.id) as any;

    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });
      return;
    }

    res.json(vehicle);
  } catch (error: any) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ error: 'Failed to get vehicle', code: 'GET_VEHICLE_ERROR' });
  }
});

// POST /api/records/vehicles - Create vehicle
// Shared fieldMap for vehicles_records — used by BOTH POST and PUT so adding
// a new writable field only requires editing ONE place. Previously this route
// had a hand-written INSERT with positional args, which silently dropped any
// body field not in the destructure list. 17 fields that the client form
// renders were being lost on every save.
const VEHICLE_FIELD_MAP: Record<string, (v: any) => any> = {
  plate_number: v => v ?? null,
  state: v => v ?? null,
  make: v => v ?? null,
  model: v => v ?? null,
  year: v => v ?? null,
  color: v => v ?? null,
  secondary_color: v => v ?? null,
  body_style: v => v ?? null,
  doors: v => v ?? null,
  vin: v => v ?? null,
  owner_person_id: v => v ?? null,
  insurance_company: v => v ?? null,
  insurance_policy: v => v ?? null,
  insurance_expiry: v => v ?? null,
  registration_expiry: v => v ?? null,
  registration_state: v => v ?? null,
  damage_description: v => v ?? null,
  distinguishing_features: v => v ?? null,
  trim: v => v ?? null,
  engine_type: v => v ?? null,
  fuel_type: v => v ?? null,
  transmission: v => v ?? null,
  drive_type: v => v ?? null,
  tow_status: v => v ?? null,
  tow_company: v => v ?? null,
  tow_date: v => v ?? null,
  tow_location: v => v ?? null,
  plate_type: v => v ?? null,
  commercial_vehicle: v => v ? 1 : 0,
  hazmat: v => v ? 1 : 0,
  odometer: v => v ?? null,
  owner_address: v => v ?? null,
  owner_phone: v => v ?? null,
  owner_name: v => v ?? null,
  owner_dl_number: v => v ?? null,
  owner_dob: v => v ?? null,
  primary_driver_name: v => v ?? null,
  registered_owner: v => v ?? null,
  lien_holder: v => v ?? null,
  stolen_status: v => v ?? null,
  stolen_date: v => v ?? null,
  recovery_date: v => v ?? null,
  title_status: v => v ?? null,
  exterior_condition: v => v ?? null,
  interior_condition: v => v ?? null,
  estimated_value: v => v ?? null,
  window_tint: v => v ?? null,
  modifications: v => v ?? null,
  equipment_notes: v => v ?? null,
  vehicle_use: v => v ?? null,
  ncic_entry_number: v => v ?? null,
  notes: v => v ?? null,
};

router.post('/vehicles', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const bodyKeys = Object.keys(req.body || {});

    // Dynamic INSERT driven by VEHICLE_FIELD_MAP — includes every key from
    // the body that matches an allowlisted field, plus the always-present
    // flags column (JSON-stringified) and timestamps.
    const columns: string[] = [];
    const placeholders: string[] = [];
    const values: any[] = [];

    for (const [key, transform] of Object.entries(VEHICLE_FIELD_MAP)) {
      if (bodyKeys.includes(key)) {
        columns.push(key);
        placeholders.push('?');
        values.push(transform(req.body[key]));
      }
    }

    // flags is always set (defaults to empty array)
    columns.push('flags');
    placeholders.push('?');
    values.push(JSON.stringify(req.body.flags || []));

    columns.push('created_at');
    placeholders.push('?');
    values.push(localNow());
    columns.push('updated_at');
    placeholders.push('?');
    values.push(localNow());

    const result = db.prepare(
      `INSERT INTO vehicles_records (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
    ).run(...values);

    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(result.lastInsertRowid) as any;

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_created', 'vehicle', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created vehicle: ${vehicle?.plate_number || 'No plate'} ${vehicle?.make || ''} ${vehicle?.model || ''}`, req.ip || 'unknown');

    res.status(201).json(vehicle);
  } catch (error: any) {
    console.error('Create vehicle error:', error);
    res.status(500).json({ error: 'Failed to create vehicle', code: 'CREATE_VEHICLE_ERROR' });
  }
});

// PUT /api/records/vehicles/:id - Update vehicle
router.put('/vehicles/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });
      return;
    }

    // Build dynamic SET clause — only update fields explicitly provided.
    // Uses the shared VEHICLE_FIELD_MAP so POST and PUT always accept the
    // same field set; previously they diverged and PUT dropped 17 fields.
    const fields: string[] = [];
    const values: any[] = [];
    const bodyKeys = Object.keys(req.body);

    for (const [key, transform] of Object.entries(VEHICLE_FIELD_MAP)) {
      if (bodyKeys.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }
    if (bodyKeys.includes('flags')) {
      fields.push('flags = ?');
      values.push(JSON.stringify(req.body.flags ?? []));
    }

    if (fields.length > 0) {
      fields.push("updated_at = ?");
      values.push(localNow());
      values.push(req.params.id);
      db.prepare(`UPDATE vehicles_records SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_updated', 'vehicle', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated vehicle: ${vehicle.plate_number || 'No plate'} ${vehicle.make || ''} ${vehicle.model || ''}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'Failed to update vehicle', code: 'UPDATE_VEHICLE_ERROR' });
  }
});

// DELETE /api/records/vehicles/:id - Delete vehicle
router.delete('/vehicles/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });
      return;
    }

    const deleteTx = db.transaction(() => {
      db.prepare('DELETE FROM incident_vehicles WHERE vehicle_id = ?').run(vehicle.id);
      db.prepare('DELETE FROM vehicles_records WHERE id = ?').run(vehicle.id);
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'vehicle_deleted', 'vehicle', ?, ?, ?)
      `).run(req.user!.userId, vehicle.id, `Deleted vehicle: ${vehicle.plate_number || 'No plate'} ${vehicle.make || ''} ${vehicle.model || ''}`, req.ip || 'unknown');
    });
    deleteTx();
    broadcastRecordUpdate({ action: 'vehicle_deleted', id: vehicle.id, entity: 'vehicle' });
    res.json({ message: 'Vehicle deleted' });
  } catch (error: any) {
    console.error('Delete vehicle error:', error);
    res.status(500).json({ error: 'Failed to delete vehicle', code: 'DELETE_VEHICLE_ERROR' });
  }
});

// POST /api/records/vehicles/:id/archive
router.post('/vehicles/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const v = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!v) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }
    if (v.archived_at) { res.status(400).json({ error: 'Vehicle is already archived', code: 'VEHICLE_IS_ALREADY_ARCHIVED' }); return; }
    const now = localNow();
    db.prepare('UPDATE vehicles_records SET archived_at = ? WHERE id = ?').run(now, v.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_archived', 'vehicle', ?, ?, ?)`).run(req.user!.userId, v.id, `Archived vehicle: ${v.plate_number || v.vin || v.id}`, req.ip || 'unknown');
    res.json(db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(v.id));
  } catch (error: any) { console.error('Archive vehicle error:', error); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// POST /api/records/vehicles/:id/unarchive
router.post('/vehicles/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const v = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!v) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }
    if (!v.archived_at) { res.status(400).json({ error: 'Vehicle is not archived', code: 'VEHICLE_IS_NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE vehicles_records SET archived_at = NULL WHERE id = ?').run(v.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_unarchived', 'vehicle', ?, ?, ?)`).run(req.user!.userId, v.id, `Restored vehicle: ${v.plate_number || v.vin || v.id}`, req.ip || 'unknown');
    res.json(db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(v.id));
  } catch (error: any) { console.error('Unarchive vehicle error:', error); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ─── PROPERTIES ───────────────────────────────────────

// GET /api/records/properties - List properties
router.get('/properties', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { clientId, archived } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];

    if (clientId) {
      conditions.push('p.client_id = ?');
      params.push(clientId);
    }

    // Archive filter
    if (archived === 'true') {
      conditions.push('p.archived_at IS NOT NULL');
    } else if (archived !== 'all') {
      conditions.push('p.archived_at IS NULL');
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const properties = db.prepare(`
      SELECT p.*, c.name as client_name
      FROM properties p
      LEFT JOIN clients c ON p.client_id = c.id
      ${whereClause}
      ORDER BY c.name, p.name
    
      LIMIT 1000
    `).all(...params);

    res.json(properties);
  } catch (error: any) {
    console.error('Get properties error:', error);
    res.status(500).json({ error: 'Failed to get properties', code: 'GET_PROPERTIES_ERROR' });
  }
});

// GET /api/records/properties/:id - Get property details
router.get('/properties/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const property = db.prepare(`
      SELECT p.*, c.name as client_name, c.contact_name as client_contact,
        c.contact_phone as client_phone, c.sla_response_minutes
      FROM properties p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `).get(req.params.id) as any;

    if (!property) {
      res.status(404).json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' });
      return;
    }

    // Get recent calls at this property
    const recentCalls = db.prepare(`
      SELECT * FROM calls_for_service WHERE property_id = ?
      ORDER BY created_at DESC LIMIT 10
    `).all(property.id);

    // Get checkpoints
    const checkpoints = db.prepare(`
      SELECT * FROM patrol_checkpoints WHERE property_id = ?
      ORDER BY sequence_order
    
      LIMIT 1000
    `).all(property.id);

    // Get today's schedule
    const today = localToday();
    const schedules = db.prepare(`
      SELECT s.*, u.full_name as officer_name
      FROM schedules s
      LEFT JOIN users u ON s.officer_id = u.id
      WHERE s.property_id = ? AND s.shift_date = ?
    
      LIMIT 1000
    `).all(property.id, today);

    res.json({
      ...property,
      recentCalls,
      checkpoints,
      todaySchedules: schedules,
    });
  } catch (error: any) {
    console.error('Get property error:', error);
    res.status(500).json({ error: 'Failed to get property', code: 'GET_PROPERTY_ERROR' });
  }
});

// POST /api/records/properties - Create property
// Shared allowlist for property POST + PUT so both accept the exact same
// field set. Previously POST and PUT each handled a tiny subset (17 of 44
// fields from PropertyFormModal) and silently dropped everything else,
// including key holder info, alarm/camera details, building metadata,
// security features, patrol settings, and after-hours contacts.
// Audit 2026-04-11.
const PROPERTY_FIELD_MAP: Record<string, (v: any) => any> = {
  // Identity + location
  client_id: v => v || null,
  name: v => v ?? null,
  address: v => v ?? null,
  city: v => v ?? null,
  state: v => v ?? null,
  zip: v => v ?? null,
  latitude: v => v === '' || v == null ? null : v,
  longitude: v => v === '' || v == null ? null : v,
  property_type: v => v ?? null,
  is_active: v => v ? 1 : 0,
  notes: v => v ?? null,
  // Access + dispatch alerts
  gate_code: v => v ?? null,
  alarm_code: v => v ?? null,
  emergency_contact: v => v ?? null,
  post_orders: v => v ?? null,
  hazard_notes: v => v ?? null,
  access_instructions: v => v ?? null,
  // Building metadata
  business_type: v => v ?? null,
  structure_type: v => v ?? null,
  occupancy_status: v => v ?? null,
  year_built: v => v === '' || v == null ? null : parseInt(v, 10) || null,
  square_footage: v => v ?? null,
  number_of_stories: v => v ?? null,
  // Security features
  security_features: v => v ?? null,
  alarm_company: v => v ?? null,
  alarm_account: v => v ?? null,
  camera_system: v => v ?? null,
  // Key holder
  key_holder_name: v => v ?? null,
  key_holder_phone: v => v ?? null,
  key_holder_relationship: v => v ?? null,
  owner_name: v => v ?? null,
  owner_phone: v => v ?? null,
  // Inspection
  last_inspection_date: v => v ?? null,
  inspection_status: v => v ?? null,
  // Access routes + hazards
  parking_info: v => v ?? null,
  roof_access: v => v ?? null,
  utility_shutoffs: v => v ?? null,
  known_hazards: v => v ?? null,
  // Contacts + schedule
  contact_email: v => v ?? null,
  secondary_contact_name: v => v ?? null,
  secondary_contact_phone: v => v ?? null,
  patrol_frequency: v => v ?? null,
  opening_hours: v => v ?? null,
  closing_hours: v => v ?? null,
};

router.post('/properties', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      client_id, name, address, city, state, zip, latitude, longitude, property_type,
      gate_code, alarm_code, emergency_contact, post_orders, hazard_notes,
      access_instructions, is_active, notes,
      business_type, structure_type, occupancy_status, year_built, square_footage,
      number_of_stories, security_features, key_holder_name, key_holder_phone,
      key_holder_relationship, owner_name, owner_phone, last_inspection_date,
    } = req.body;

    if (!req.body.client_id) {
      res.status(400).json({ error: 'client_id is required', code: 'CLIENTID_IS_REQUIRED' });
      return;
    }
    if (!req.body.name || !req.body.address) {
      res.status(400).json({ error: 'name and address are required', code: 'NAME_AND_ADDRESS_ARE' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO properties (client_id, name, address, city, state, zip, latitude, longitude, property_type,
        gate_code, alarm_code, emergency_contact, post_orders, hazard_notes, access_instructions, is_active, notes,
        business_type, structure_type, occupancy_status, year_built, square_footage,
        number_of_stories, security_features, key_holder_name, key_holder_phone,
        key_holder_relationship, owner_name, owner_phone, last_inspection_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      client_id, name, address, city || null, state || null, zip || null,
      latitude || null, longitude || null,
      property_type || null, gate_code || null, alarm_code || null,
      emergency_contact || null, post_orders || null, hazard_notes || null,
      access_instructions || null, is_active !== undefined ? (is_active ? 1 : 0) : 1, notes || null,
      business_type || null, structure_type || null, occupancy_status || null,
      year_built || null, square_footage || null, number_of_stories || null,
      security_features || null, key_holder_name || null, key_holder_phone || null,
      key_holder_relationship || null, owner_name || null, owner_phone || null,
      last_inspection_date || null,
    );

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'property_created', 'property', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created property: ${req.body.name}`, req.ip || 'unknown');

    const property = db.prepare(`
      SELECT p.*, c.name as client_name
      FROM properties p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(property);
  } catch (error: any) {
    console.error('Create property error:', error);
    res.status(500).json({ error: 'Failed to create property', code: 'CREATE_PROPERTY_ERROR' });
  }
});

// ─── INCIDENT CROSS-REFERENCES ───────────────────────

// GET /api/records/persons/:id/incidents - All incidents linked to a person
router.get('/persons/:id/incidents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });
      return;
    }

    const incidents = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.location_address, i.created_at, ip.role, ip.notes as link_notes,
        o.full_name as officer_name
      FROM incident_persons ip
      LEFT JOIN incidents i ON ip.incident_id = i.id
      LEFT JOIN users o ON i.officer_id = o.id
      WHERE ip.person_id = ?
      ORDER BY i.created_at DESC
    
      LIMIT 1000
    `).all(person.id);

    res.json(incidents);
  } catch (error: any) {
    console.error('Get person incidents error:', error);
    res.status(500).json({ error: 'Failed to get person incidents', code: 'GET_PERSON_INCIDENTS_ERROR' });
  }
});

// GET /api/records/vehicles/:id/incidents - All incidents linked to a vehicle
router.get('/vehicles/:id/incidents', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });
      return;
    }

    const incidents = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.location_address, i.created_at, iv.role, iv.notes as link_notes,
        o.full_name as officer_name
      FROM incident_vehicles iv
      LEFT JOIN incidents i ON iv.incident_id = i.id
      LEFT JOIN users o ON i.officer_id = o.id
      WHERE iv.vehicle_id = ?
      ORDER BY i.created_at DESC
    
      LIMIT 1000
    `).all(vehicle.id);

    res.json(incidents);
  } catch (error: any) {
    console.error('Get vehicle incidents error:', error);
    res.status(500).json({ error: 'Failed to get vehicle incidents', code: 'GET_VEHICLE_INCIDENTS_ERROR' });
  }
});

// GET /api/records/evidence - List all evidence with incident info
router.get('/evidence', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page = '1', limit = '100000', archived } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit as string, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND e.archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND e.archived_at IS NULL';
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM evidence e ${whereClause}`).get() as any;

    const evidence = db.prepare(`
      SELECT e.*, i.incident_number, u.full_name as collected_by_name
      FROM evidence e
      LEFT JOIN incidents i ON e.incident_id = i.id
      LEFT JOIN users u ON e.collected_by = u.id
      ${whereClause}
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limitNum, offset);

    res.json({
      data: evidence,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow.total,
        totalPages: Math.ceil(countRow.total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Get evidence error:', error);
    res.status(500).json({ error: 'Failed to get evidence', code: 'GET_EVIDENCE_ERROR' });
  }
});

// PUT /api/records/evidence/:id - Update evidence
// Shared allowlist for evidence POST + PUT. Previously POST handled 20
// fields and PUT handled 20 — but EvidenceFormModal collects 27, so
// location_found, condition, quantity, is_biological, narcotics_flag,
// and temperature_sensitive were silently dropped on both create and
// update. Audit 2026-04-11.
const EVIDENCE_FIELD_MAP: Record<string, (v: any) => any> = {
  incident_id: v => v || null,
  description: v => v ?? null,
  evidence_type: v => v ?? null,
  category: v => v ?? null,
  storage_location: v => v ?? null,
  collected_date: v => v ?? null,
  packaging_type: v => v ?? null,
  serial_number: v => v ?? null,
  brand: v => v ?? null,
  model: v => v ?? null,
  estimated_value: v => v ?? null,
  dimensions: v => v ?? null,
  weight: v => v ?? null,
  photo_taken: v => v ? 1 : 0,
  lab_submitted: v => v ? 1 : 0,
  lab_case_number: v => v ?? null,
  lab_name: v => v ?? null,
  disposal_method: v => v ?? null,
  disposal_date: v => v ?? null,
  disposal_authorized_by: v => v ?? null,
  notes: v => v ?? null,
  // Previously silent-dropped (audit 2026-04-11)
  location_found: v => v ?? null,
  condition: v => v ?? null,
  quantity: v => v === '' || v == null ? null : parseInt(v, 10) || null,
  is_biological: v => v ? 1 : 0,
  narcotics_flag: v => v ? 1 : 0,
  temperature_sensitive: v => v ? 1 : 0,
};

router.put('/evidence/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });
      return;
    }

    // Build dynamic SET clause — uses shared EVIDENCE_FIELD_MAP so POST
    // and PUT always accept the same field set.
    const eFields: string[] = [];
    const eValues: any[] = [];
    const eBodyKeys = Object.keys(req.body);

    for (const [key, transform] of Object.entries(EVIDENCE_FIELD_MAP)) {
      if (eBodyKeys.includes(key)) {
        eFields.push(`${key} = ?`);
        eValues.push(transform(req.body[key]));
      }
    }

    if (eFields.length > 0) {
      eFields.push("updated_at = ?");
      eValues.push(localNow());
      eValues.push(req.params.id);
      db.prepare(`UPDATE evidence SET ${eFields.join(', ')} WHERE id = ?`).run(...eValues);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'evidence_updated', 'evidence', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated evidence: ${evidence.description || 'ID ' + evidence.id}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT e.*, i.incident_number, u.full_name as collected_by_name
      FROM evidence e
      LEFT JOIN incidents i ON e.incident_id = i.id
      LEFT JOIN users u ON e.collected_by = u.id
      WHERE e.id = ?
    `).get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update evidence error:', error);
    res.status(500).json({ error: 'Failed to update evidence', code: 'UPDATE_EVIDENCE_ERROR' });
  }
});

// DELETE /api/records/evidence/:id - Delete evidence
router.delete('/evidence/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });
      return;
    }

    const delEvTx = db.transaction(() => {
      db.prepare('DELETE FROM evidence WHERE id = ?').run(req.params.id);
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'evidence_deleted', 'evidence', ?, ?, ?)
      `).run(req.user!.userId, evidence.id, `Deleted evidence: ${evidence.description || 'ID ' + evidence.id}`, req.ip || 'unknown');
    });
    delEvTx();
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete evidence error:', error);
    res.status(500).json({ error: 'Failed to delete evidence', code: 'DELETE_EVIDENCE_ERROR' });
  }
});

// POST /api/records/evidence/:id/archive
router.post('/evidence/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) { res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }); return; }
    if (evidence.archived_at) { res.status(400).json({ error: 'Evidence is already archived', code: 'EVIDENCE_IS_ALREADY_ARCHIVED' }); return; }

    const now = localNow();
    db.prepare('UPDATE evidence SET archived_at = ? WHERE id = ?').run(now, evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'evidence_archived', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, `Archived evidence: ${evidence.description || 'ID ' + evidence.id}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidence.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive evidence error:', error);
    res.status(500).json({ error: 'Failed to archive evidence', code: 'ARCHIVE_EVIDENCE_ERROR' });
  }
});

// POST /api/records/evidence/:id/unarchive
router.post('/evidence/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) { res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }); return; }
    if (!evidence.archived_at) { res.status(400).json({ error: 'Evidence is not archived', code: 'EVIDENCE_IS_NOT_ARCHIVED' }); return; }

    db.prepare('UPDATE evidence SET archived_at = NULL WHERE id = ?').run(evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'evidence_unarchived', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, `Unarchived evidence: ${evidence.description || 'ID ' + evidence.id}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidence.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive evidence error:', error);
    res.status(500).json({ error: 'Failed to unarchive evidence', code: 'UNARCHIVE_EVIDENCE_ERROR' });
  }
});

// POST /api/records/evidence/:id/custody - Add chain of custody entry
router.post('/evidence/:id/custody', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });
      return;
    }

    const { action, to_person, from_person, reason } = req.body;
    if (!action || !to_person) {
      res.status(400).json({ error: 'action and to_person are required', code: 'ACTION_AND_TOPERSON_ARE' });
      return;
    }

    let chain: any[] = [];
    try {
      chain = JSON.parse(evidence.chain_of_custody || '[]');
    } catch { /* ignore */ }

    chain.push({
      id: `COC-${Date.now()}`,
      action,
      from_person: from_person || null,
      to_person,
      reason: reason || '',
      timestamp: localNow(),
      user_id: req.user!.userId,
    });

    db.prepare('UPDATE evidence SET chain_of_custody = ? WHERE id = ?').run(
      JSON.stringify(chain), evidence.id
    );

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'custody_entry', 'evidence', ?, ?, ?)
    `).run(
      req.user!.userId, evidence.id,
      `Chain of custody: ${action} - ${to_person}`,
      req.ip || 'unknown'
    );

    const updated = db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidence.id);
    res.status(201).json(updated);
  } catch (error: any) {
    console.error('Add custody entry error:', error);
    res.status(500).json({ error: 'Failed to add custody entry', code: 'ADD_CUSTODY_ENTRY_ERROR' });
  }
});

// GET /api/records/evidence/stats — Property room aggregate stats
router.get('/evidence/stats', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const statusCounts = db.prepare(`
      SELECT status, COUNT(*) as count FROM evidence WHERE archived_at IS NULL GROUP BY status
    `).all() as any[];
    const typeCounts = db.prepare(`
      SELECT evidence_type, COUNT(*) as count FROM evidence
      WHERE archived_at IS NULL AND evidence_type IS NOT NULL GROUP BY evidence_type
    `).all() as any[];
    const locationCounts = db.prepare(`
      SELECT storage_location, COUNT(*) as count FROM evidence
      WHERE archived_at IS NULL AND storage_location IS NOT NULL GROUP BY storage_location
    `).all() as any[];
    const pendingDisposition = db.prepare(`
      SELECT COUNT(*) as count FROM evidence WHERE status IN ('received', 'in_storage') AND archived_at IS NULL
    `).get() as any;

    res.json({
      data: {
        by_status: Object.fromEntries(statusCounts.map((r: any) => [r.status, r.count])),
        by_type: Object.fromEntries(typeCounts.map((r: any) => [r.evidence_type, r.count])),
        by_location: Object.fromEntries(locationCounts.map((r: any) => [r.storage_location, r.count])),
        total: statusCounts.reduce((a: number, b: any) => a + b.count, 0),
        pending_disposition: pendingDisposition?.count || 0,
      },
    });
  } catch (error: any) {
    console.error('Evidence stats error:', error);
    res.status(500).json({ error: 'Failed to evidence stats', code: 'EVIDENCE_STATS_ERROR' });
  }
});

// GET /api/records/evidence/locations — Distinct storage locations from system_config
router.get('/evidence/locations', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const locations = db.prepare(`
      SELECT config_key as name, config_value as details
      FROM system_config WHERE category = 'evidence_location' AND is_active = 1
      ORDER BY sort_order
    
      LIMIT 1000
    `).all();
    res.json({ data: locations });
  } catch (error: any) {
    console.error('Get evidence storage locations error:', error);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// POST /api/records/evidence/:id/chain-action — Enhanced chain-of-custody action
router.post('/evidence/:id/chain-action', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    const { action, from_location, to_location, notes } = req.body;
    const validActions = ['check_in', 'check_out', 'transfer', 'lab_submit', 'release', 'dispose'];
    if (!action || !validActions.includes(action)) return res.status(400).json({ error: 'Valid action required', code: 'VALID_ACTION_REQUIRED' });

    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    let chain: any[] = [];
    try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }

    chain.push({
      action,
      timestamp: localNow(),
      user_id: req.user!.userId,
      user_name: user?.full_name || '',
      from_location: from_location || evidence.storage_location || null,
      to_location: to_location || null,
      notes: notes || null,
    });

    // Update status based on action
    const statusMap: Record<string, string> = {
      check_in: 'in_storage', check_out: 'received', transfer: 'in_storage',
      lab_submit: 'submitted_to_le', release: 'released', dispose: 'disposed',
    };
    const newStatus = statusMap[action] || evidence.status;
    const storageLocation = to_location || evidence.storage_location;

    db.prepare(`UPDATE evidence SET chain_of_custody = ?, status = ?, storage_location = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(chain), newStatus, storageLocation, localNow(), evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, 'evidence', ?, ?, ?)`).run(
      req.user!.userId, `evidence_${action}`, evidence.id, JSON.stringify({ action, to_location }), localNow());

    res.json({ data: { id: evidence.id, status: newStatus, chain_of_custody: chain } });
  } catch (error: any) {
    console.error('Evidence chain-action error:', error);
    res.status(500).json({ error: 'Failed to evidence chain-action', code: 'EVIDENCE_CHAINACTION_ERROR' });
  }
});

// POST /api/records/evidence/:id/request-release — Request evidence release (needs supervisor approval)
router.post('/evidence/:id/request-release', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    const { release_to, reason } = req.body;
    const now = localNow();

    db.prepare(`UPDATE evidence SET release_status = 'release_requested', release_requested_by = ?, release_requested_at = ?,
      release_to = ?, release_reason = ?, updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, now, release_to || null, reason || null, now, req.params.id);

    // Notify supervisors
    try {
      const supervisors = db.prepare(`SELECT id FROM users WHERE role IN ('admin','manager','supervisor') AND status = 'active'`).all() as any[];
      for (const sup of supervisors) {
        db.prepare(`INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, created_at)
          VALUES ('system', 'normal', ?, ?, 'evidence', ?, ?, ?)`).run(
          `Evidence Release Request: ${evidence.evidence_number || 'EV-' + evidence.id}`,
          `Release requested by ${req.user!.fullName || 'officer'} for: ${reason || 'No reason specified'}`,
          evidence.id, sup.id, now
        );
      }
    } catch { /* notifications table may not exist */ }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'evidence_release_request', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, JSON.stringify({ release_to, reason }), now);

    res.json({ data: { id: evidence.id, release_status: 'release_requested' } });
  } catch (error: any) {
    console.error('Evidence release request error:', error);
    res.status(500).json({ error: 'Failed to evidence release request', code: 'EVIDENCE_RELEASE_REQUEST_ERROR' });
  }
});

// PUT /api/records/evidence/:id/approve-release — Supervisor approves evidence release
router.put('/evidence/:id/approve-release', (req: Request, res: Response) => {
  try {
    const db = getDb();
    if (!['admin', 'manager', 'supervisor'].includes(req.user!.role)) {
      return res.status(403).json({ error: 'Only supervisors can approve evidence release', code: 'ONLY_SUPERVISORS_CAN_APPROVE' });
    }

    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    const { action } = req.body; // 'approve' or 'deny'
    const now = localNow();

    if (action === 'approve') {
      // Approve and update chain of custody
      const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
      let chain: any[] = [];
      try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }
      chain.push({
        action: 'release',
        timestamp: now,
        user_id: req.user!.userId,
        user_name: user?.full_name || '',
        notes: `Release approved by ${user?.full_name || 'supervisor'}. Released to: ${evidence.release_to || 'owner'}`,
      });

      db.prepare(`UPDATE evidence SET status = 'released', release_status = 'released',
        release_approved_by = ?, release_approved_at = ?, chain_of_custody = ?, updated_at = ? WHERE id = ?`)
        .run(req.user!.userId, now, JSON.stringify(chain), now, req.params.id);
    } else {
      db.prepare(`UPDATE evidence SET release_status = NULL, updated_at = ? WHERE id = ?`)
        .run(now, req.params.id);
    }

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, ?, 'evidence', ?, ?, ?)`).run(
      req.user!.userId, action === 'approve' ? 'evidence_release_approved' : 'evidence_release_denied',
      evidence.id, JSON.stringify({ action }), now);

    res.json({ data: { id: evidence.id, release_status: action === 'approve' ? 'released' : null } });
  } catch (error: any) {
    console.error('Approve evidence release error:', error);
    res.status(500).json({ error: 'Failed to approve evidence release', code: 'APPROVE_EVIDENCE_RELEASE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EVIDENCE UPGRADE: Chain of Custody Gap Validation
// ════════════════════════════════════════════════════════════

router.get('/evidence/:id/custody-validation', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    let chain: any[] = [];
    try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }

    const gaps: { index: number; gap_hours: number; from_action: string; to_action: string; from_time: string; to_time: string }[] = [];
    const warnings: string[] = [];

    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const curr = chain[i];
      if (prev.timestamp && curr.timestamp) {
        const gapMs = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
        const gapHours = gapMs / (1000 * 60 * 60);
        if (gapHours > 24) {
          gaps.push({
            index: i,
            gap_hours: Math.round(gapHours * 10) / 10,
            from_action: prev.action || 'unknown',
            to_action: curr.action || 'unknown',
            from_time: prev.timestamp,
            to_time: curr.timestamp,
          });
        }
      }
    }

    // Check for missing fields
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (!entry.user_id && !entry.by) warnings.push(`Entry ${i + 1}: Missing responsible party`);
      if (!entry.timestamp && !entry.at) warnings.push(`Entry ${i + 1}: Missing timestamp`);
      if (!entry.action) warnings.push(`Entry ${i + 1}: Missing action type`);
    }

    // Check for check-out without check-in
    const checkOuts = chain.filter((e: any) => e.action === 'check_out');
    const checkIns = chain.filter((e: any) => e.action === 'check_in');
    if (checkOuts.length > checkIns.length) {
      warnings.push('Evidence is currently checked out — not returned to storage');
    }

    const isValid = gaps.length === 0 && warnings.length === 0;
    res.json({
      data: {
        evidence_id: evidence.id,
        chain_length: chain.length,
        is_valid: isValid,
        gaps,
        warnings,
        current_status: evidence.status,
        current_location: evidence.storage_location,
      },
    });
  } catch (error: any) {
    console.error('Evidence custody validation error:', error);
    res.status(500).json({ error: 'Failed to validate custody chain', code: 'CUSTODY_VALIDATION_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EVIDENCE UPGRADE: Location Tracking (Room/Shelf/Bin)
// ════════════════════════════════════════════════════════════

router.put('/evidence/:id/location', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    const { room, shelf, bin, storage_location, temp_required, notes } = req.body;
    if (!storage_location && !room) return res.status(400).json({ error: 'storage_location or room required', code: 'LOCATION_REQUIRED' });

    const now = localNow();
    const locationDetail = JSON.stringify({
      room: room || null,
      shelf: shelf || null,
      bin: bin || null,
      temp_required: temp_required || null,
      moved_by: req.user!.userId,
      moved_at: now,
      notes: notes || null,
    });

    const fullLocation = storage_location || [room, shelf, bin].filter(Boolean).join(' / ');

    // Update chain of custody with transfer
    let chain: any[] = [];
    try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    chain.push({
      action: 'location_update',
      timestamp: now,
      user_id: req.user!.userId,
      user_name: user?.full_name || '',
      from_location: evidence.storage_location || null,
      to_location: fullLocation,
      notes: notes || null,
    });

    db.prepare(`UPDATE evidence SET storage_location = ?, location_detail = ?, chain_of_custody = ?, updated_at = ? WHERE id = ?`)
      .run(fullLocation, locationDetail, JSON.stringify(chain), now, evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'evidence_location_update', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, JSON.stringify({ from: evidence.storage_location, to: fullLocation }), now);

    res.json({ data: { id: evidence.id, storage_location: fullLocation, location_detail: JSON.parse(locationDetail) } });
  } catch (error: any) {
    console.error('Evidence location update error:', error);
    res.status(500).json({ error: 'Failed to update evidence location', code: 'EVIDENCE_LOCATION_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EVIDENCE UPGRADE: Check-Out / Check-In Workflow
// ════════════════════════════════════════════════════════════

router.post('/evidence/:id/checkout', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });
    if (evidence.checked_out_by) return res.status(400).json({ error: 'Evidence is already checked out', code: 'ALREADY_CHECKED_OUT' });

    const { reason, expected_return_date } = req.body;
    if (!reason) return res.status(400).json({ error: 'Checkout reason is required', code: 'CHECKOUT_REASON_REQUIRED' });

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    let chain: any[] = [];
    try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }
    chain.push({
      action: 'check_out',
      timestamp: now,
      user_id: req.user!.userId,
      user_name: user?.full_name || '',
      reason,
      expected_return: expected_return_date || null,
    });

    db.prepare(`UPDATE evidence SET checked_out_by = ?, checked_out_at = ?, checkout_reason = ?,
      expected_return_date = ?, chain_of_custody = ?, status = 'checked_out', updated_at = ? WHERE id = ?`)
      .run(req.user!.userId, now, reason, expected_return_date || null, JSON.stringify(chain), now, evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'evidence_checkout', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, JSON.stringify({ reason, expected_return_date }), now);

    broadcastRecordUpdate({ type: 'evidence_checked_out', id: evidence.id });
    res.json({ data: { id: evidence.id, status: 'checked_out', checked_out_by: req.user!.userId } });
  } catch (error: any) {
    console.error('Evidence checkout error:', error);
    res.status(500).json({ error: 'Failed to check out evidence', code: 'EVIDENCE_CHECKOUT_ERROR' });
  }
});

router.post('/evidence/:id/checkin', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });
    if (!evidence.checked_out_by) return res.status(400).json({ error: 'Evidence is not checked out', code: 'NOT_CHECKED_OUT' });

    const { condition_on_return, storage_location, notes } = req.body;
    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    let chain: any[] = [];
    try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }
    chain.push({
      action: 'check_in',
      timestamp: now,
      user_id: req.user!.userId,
      user_name: user?.full_name || '',
      condition_on_return: condition_on_return || null,
      notes: notes || null,
    });

    db.prepare(`UPDATE evidence SET checked_out_by = NULL, checked_out_at = NULL, checkout_reason = NULL,
      expected_return_date = NULL, condition_on_return = ?, storage_location = COALESCE(?, storage_location),
      chain_of_custody = ?, status = 'in_storage', updated_at = ? WHERE id = ?`)
      .run(condition_on_return || null, storage_location || null, JSON.stringify(chain), now, evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'evidence_checkin', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, JSON.stringify({ condition_on_return }), now);

    broadcastRecordUpdate({ type: 'evidence_checked_in', id: evidence.id });
    res.json({ data: { id: evidence.id, status: 'in_storage' } });
  } catch (error: any) {
    console.error('Evidence checkin error:', error);
    res.status(500).json({ error: 'Failed to check in evidence', code: 'EVIDENCE_CHECKIN_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EVIDENCE UPGRADE: Disposition Tracking
// ════════════════════════════════════════════════════════════

router.put('/evidence/:id/disposition', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    const { disposition, disposition_method, disposition_authorized_by, disposition_notes } = req.body;
    const validDispositions = ['pending', 'return_to_owner', 'destroy', 'auction', 'forfeit', 'retain', 'transfer_to_agency'];
    if (!disposition || !validDispositions.includes(disposition))
      return res.status(400).json({ error: 'Valid disposition required', code: 'INVALID_DISPOSITION' });

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

    let chain: any[] = [];
    try { chain = JSON.parse(evidence.chain_of_custody || '[]'); } catch { /* ignore */ }
    chain.push({
      action: 'disposition',
      timestamp: now,
      user_id: req.user!.userId,
      user_name: user?.full_name || '',
      disposition,
      disposition_method: disposition_method || null,
      notes: disposition_notes || null,
    });

    db.prepare(`UPDATE evidence SET disposal_method = ?, disposal_date = ?, disposal_authorized_by = ?,
      notes = COALESCE(?, notes), chain_of_custody = ?, status = 'disposed', updated_at = ? WHERE id = ?`)
      .run(disposition_method || disposition, now, disposition_authorized_by || user?.full_name || '',
        disposition_notes || null, JSON.stringify(chain), now, evidence.id);

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'evidence_disposition', 'evidence', ?, ?, ?)`).run(
      req.user!.userId, evidence.id, JSON.stringify({ disposition, disposition_method }), now);

    broadcastRecordUpdate({ type: 'evidence_disposed', id: evidence.id });
    res.json({ data: { id: evidence.id, status: 'disposed', disposition } });
  } catch (error: any) {
    console.error('Evidence disposition error:', error);
    res.status(500).json({ error: 'Failed to update evidence disposition', code: 'EVIDENCE_DISPOSITION_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EVIDENCE UPGRADE: Aging Report
// ════════════════════════════════════════════════════════════

router.get('/evidence/aging-report', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = new Date();

    const aging = db.prepare(`
      SELECT
        CASE
          WHEN JULIANDAY('now') - JULIANDAY(e.created_at) <= 30 THEN '0-30 days'
          WHEN JULIANDAY('now') - JULIANDAY(e.created_at) <= 90 THEN '31-90 days'
          WHEN JULIANDAY('now') - JULIANDAY(e.created_at) <= 180 THEN '91-180 days'
          WHEN JULIANDAY('now') - JULIANDAY(e.created_at) <= 365 THEN '181-365 days'
          ELSE '365+ days'
        END as age_range,
        COUNT(*) as count,
        SUM(CASE WHEN e.status = 'in_storage' THEN 1 ELSE 0 END) as in_storage,
        SUM(CASE WHEN e.status = 'checked_out' THEN 1 ELSE 0 END) as checked_out
      FROM evidence e
      WHERE e.archived_at IS NULL AND e.status NOT IN ('released', 'disposed')
      GROUP BY age_range
    `).all();

    const overdueCheckouts = db.prepare(`
      SELECT e.id, e.description, e.evidence_type, e.checked_out_by, e.checked_out_at,
        e.expected_return_date, u.full_name as checked_out_by_name,
        CAST(JULIANDAY('now') - JULIANDAY(e.expected_return_date) AS INTEGER) as days_overdue
      FROM evidence e
      LEFT JOIN users u ON e.checked_out_by = u.id
      WHERE e.expected_return_date IS NOT NULL AND e.expected_return_date < DATE('now')
        AND e.checked_out_by IS NOT NULL
      ORDER BY days_overdue DESC
      LIMIT 50
    `).all();

    const pendingDispositions = db.prepare(`
      SELECT COUNT(*) as count FROM evidence
      WHERE status IN ('received', 'in_storage') AND archived_at IS NULL
        AND created_at < datetime('now', '-365 days')
    `).get() as any;

    res.json({
      data: {
        aging_breakdown: aging,
        overdue_checkouts: overdueCheckouts,
        items_needing_disposition: pendingDispositions?.count || 0,
      },
    });
  } catch (error: any) {
    console.error('Evidence aging report error:', error);
    res.status(500).json({ error: 'Failed to generate evidence aging report', code: 'EVIDENCE_AGING_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// EVIDENCE UPGRADE: Cross-Link Evidence to Cases/Incidents
// ════════════════════════════════════════════════════════════

router.get('/evidence/:id/linked-records', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' });

    const links: any = { incident: null, cases: [], citations: [], forensic_cases: [] };

    if (evidence.incident_id) {
      links.incident = db.prepare('SELECT id, incident_number, incident_type, status FROM incidents WHERE id = ?').get(evidence.incident_id);
    }

    // Find forensic cases linked to this evidence
    const forensicLinks = db.prepare(`
      SELECT fc.id, fc.lab_number, fc.title, fc.status, fc.case_type
      FROM forensic_cases fc
      WHERE fc.linked_incident_id = ? OR fc.linked_case_id IN (
        SELECT id FROM cases WHERE linked_incidents LIKE ?
      )
      LIMIT 20
    `).all(evidence.incident_id || 0, `%${evidence.incident_id || 0}%`);
    links.forensic_cases = forensicLinks;

    // Find cases linked to same incident (cases use linked_incidents JSON, not incident_id)
    if (evidence.incident_id) {
      try {
        const cases = db.prepare(`
          SELECT id, case_number, case_type, status FROM cases
          WHERE linked_incidents LIKE ? LIMIT 20
        `).all(`%${evidence.incident_id}%`);
        links.cases = cases;
      } catch (e) { console.error('[Evidence] Cases link query error:', e instanceof Error ? e.message : e); }
    }

    res.json({ data: links });
  } catch (error: any) {
    console.error('Evidence linked records error:', error);
    res.status(500).json({ error: 'Failed to get linked records', code: 'EVIDENCE_LINKS_ERROR' });
  }
});

// PUT /api/records/properties/:id - Update property
router.put('/properties/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!property) {
      res.status(404).json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' });
      return;
    }

    // Build dynamic SET clause — uses the shared PROPERTY_FIELD_MAP so POST
    // and PUT always accept the exact same field set. Previously this PUT
    // only handled 17 of the 44 fields PropertyFormModal collects, so
    // ~27 fields (key holder, alarm company, camera system, building
    // metadata, patrol frequency, etc.) were silently dropped on edit.
    const pFields: string[] = [];
    const pValues: any[] = [];
    const pBodyKeys = Object.keys(req.body);

    const pFieldMap: Record<string, (v: any) => any> = {
      name: v => v ?? null, address: v => v ?? null,
      city: v => v ?? null, state: v => v ?? null, zip: v => v ?? null,
      latitude: v => v ?? null, longitude: v => v ?? null,
      property_type: v => v ?? null, gate_code: v => v ?? null,
      alarm_code: v => v ?? null, emergency_contact: v => v ?? null,
      post_orders: v => v ?? null, hazard_notes: v => v ?? null,
      access_instructions: v => v ?? null, notes: v => v ?? null,
      is_active: v => v ? 1 : 0,
      client_id: v => v || null,
      business_type: v => v ?? null, structure_type: v => v ?? null,
      occupancy_status: v => v ?? null, year_built: v => v ?? null,
      square_footage: v => v ?? null, number_of_stories: v => v ?? null,
      security_features: v => v ?? null, key_holder_name: v => v ?? null,
      key_holder_phone: v => v ?? null, key_holder_relationship: v => v ?? null,
      owner_name: v => v ?? null, owner_phone: v => v ?? null,
      last_inspection_date: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(pFieldMap)) {
      if (pBodyKeys.includes(key)) {
        pFields.push(`${key} = ?`);
        pValues.push(transform(req.body[key]));
      }
    }

    if (pFields.length > 0) {
      pFields.push("updated_at = ?");
      pValues.push(localNow());
      pValues.push(req.params.id);
      db.prepare(`UPDATE properties SET ${pFields.join(', ')} WHERE id = ?`).run(...pValues);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'property_updated', 'property', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated property: ${property.name}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT p.*, c.name as client_name
      FROM properties p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `).get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update property error:', error);
    res.status(500).json({ error: 'Failed to update property', code: 'UPDATE_PROPERTY_ERROR' });
  }
});

// DELETE /api/records/properties/:id - Delete property
router.delete('/properties/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!property) {
      res.status(404).json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' });
      return;
    }

    const delTx = db.transaction(() => {
      // Remove any record links involving this property
      db.prepare("DELETE FROM record_links WHERE (source_type = 'property' AND source_id = ?) OR (target_type = 'property' AND target_id = ?)").run(req.params.id, req.params.id);
      // Nullify FK references in related tables
      db.prepare('UPDATE calls_for_service SET property_id = NULL WHERE property_id = ?').run(req.params.id);
      db.prepare('UPDATE incidents SET property_id = NULL WHERE property_id = ?').run(req.params.id);
      db.prepare('UPDATE schedules SET property_id = NULL WHERE property_id = ?').run(req.params.id);
      db.prepare('DELETE FROM patrol_checkpoints WHERE property_id = ?').run(req.params.id);
      // Remove attachments referencing this property
      db.prepare("DELETE FROM attachments WHERE entity_type = 'property' AND entity_id = ?").run(req.params.id);
      db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'property_deleted', 'property', ?, ?, ?)
      `).run(req.user!.userId, property.id, `Deleted property: ${property.name}`, req.ip || 'unknown');
    });
    delTx();
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('Delete property error:', error);
    res.status(500).json({ error: 'Failed to delete property', code: 'DELETE_PROPERTY_ERROR' });
  }
});

// POST /api/records/properties/:id/archive
router.post('/properties/:id/archive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!prop) { res.status(404).json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }); return; }
    if (prop.archived_at) { res.status(400).json({ error: 'Property is already archived', code: 'PROPERTY_IS_ALREADY_ARCHIVED' }); return; }
    const now = localNow();
    db.prepare('UPDATE properties SET archived_at = ? WHERE id = ?').run(now, prop.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'property_archived', 'property', ?, ?, ?)`).run(req.user!.userId, prop.id, `Archived property: ${prop.name}`, req.ip || 'unknown');
    res.json(db.prepare('SELECT * FROM properties WHERE id = ?').get(prop.id));
  } catch (error: any) { console.error('Archive property error:', error); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// POST /api/records/properties/:id/unarchive
router.post('/properties/:id/unarchive', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!prop) { res.status(404).json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }); return; }
    if (!prop.archived_at) { res.status(400).json({ error: 'Property is not archived', code: 'PROPERTY_IS_NOT_ARCHIVED' }); return; }
    db.prepare('UPDATE properties SET archived_at = NULL WHERE id = ?').run(prop.id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'property_unarchived', 'property', ?, ?, ?)`).run(req.user!.userId, prop.id, `Restored property: ${prop.name}`, req.ip || 'unknown');
    res.json(db.prepare('SELECT * FROM properties WHERE id = ?').get(prop.id));
  } catch (error: any) { console.error('Unarchive property error:', error); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ─── STANDALONE EVIDENCE CREATION ────────────────────

// POST /api/records/evidence - Create standalone evidence (no incident required)
router.post('/evidence', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      incident_id, description, evidence_type, storage_location,
      collected_date, packaging_type, dimensions, weight,
      photo_taken, lab_submitted, lab_case_number, lab_name,
      disposal_method, disposal_date, disposal_authorized_by,
      serial_number, brand, model, estimated_value, category, notes,
      location_found, condition, quantity, is_biological,
    } = req.body;

    if (!req.body.description || !req.body.evidence_type) {
      res.status(400).json({ error: 'description and evidence_type are required', code: 'DESCRIPTION_AND_EVIDENCETYPE_ARE' });
      return;
    }

    // Generate evidence number
    const currentYear = new Date().getFullYear();
    const lastEvidence = db.prepare(
      `SELECT evidence_number FROM evidence WHERE evidence_number LIKE ? ORDER BY id DESC LIMIT 1`
    ).get(`EV-${currentYear}-%`) as any;

    let nextNum = 1;
    if (lastEvidence) {
      const parts = lastEvidence.evidence_number.split('-');
      nextNum = parseInt(parts[2], 10) + 1;
    }
    const evidenceNumber = `EV-${currentYear}-${String(nextNum).padStart(5, '0')}`;

    const result = db.prepare(`
      INSERT INTO evidence (
        evidence_number, incident_id, description, evidence_type, storage_location, collected_by,
        collected_date, packaging_type, dimensions, weight,
        photo_taken, lab_submitted, lab_case_number, lab_name,
        disposal_method, disposal_date, disposal_authorized_by,
        serial_number, brand, model, estimated_value, category, notes,
        location_found, condition, quantity, is_biological
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidenceNumber, incident_id || null, description, evidence_type,
      storage_location || null, req.user!.userId,
      collected_date || null, packaging_type || null, dimensions || null, weight || null,
      photo_taken ? 1 : 0, lab_submitted ? 1 : 0, lab_case_number || null, lab_name || null,
      disposal_method || null, disposal_date || null, disposal_authorized_by || null,
      serial_number || null, brand || null, model || null, estimated_value || null, category || null,
      notes || null,
      location_found || null, condition || null, quantity ?? 1, is_biological ? 1 : 0
    );

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'evidence_created', 'evidence', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created evidence: ${evidenceNumber} - ${req.body.description}`, req.ip || 'unknown');

    const created = db.prepare(`
      SELECT e.*, i.incident_number, u.full_name as collected_by_name
      FROM evidence e
      LEFT JOIN incidents i ON e.incident_id = i.id
      LEFT JOIN users u ON e.collected_by = u.id
      WHERE e.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create evidence error:', error);
    res.status(500).json({ error: 'Failed to create evidence', code: 'CREATE_EVIDENCE_ERROR' });
  }
});

// ─── RECORD LINKS ────────────────────────────────────

// Helper to get a display label for a record
function getRecordLabel(db: any, type: string, id: number): string {
  try {
    switch (type) {
      case 'person': {
        const p = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(id) as any;
        return p ? `${p.first_name} ${p.last_name}` : `Person #${id}`;
      }
      case 'vehicle': {
        const v = db.prepare('SELECT make, model, plate_number FROM vehicles_records WHERE id = ?').get(id) as any;
        return v ? `${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() : `Vehicle #${id}`;
      }
      case 'property': {
        const pr = db.prepare('SELECT name FROM properties WHERE id = ?').get(id) as any;
        return pr ? pr.name : `Property #${id}`;
      }
      case 'evidence': {
        const e = db.prepare('SELECT evidence_number, description FROM evidence WHERE id = ?').get(id) as any;
        return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() : `Evidence #${id}`;
      }
      default:
        return `${type} #${id}`;
    }
  } catch {
    return `${type} #${id}`;
  }
}

// GET /api/records/links - Get all links for an entity (both directions)
router.get('/links', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, id } = req.query;

    if (!type || !id) {
      res.status(400).json({ error: 'type and id query parameters are required', code: 'TYPE_AND_ID_QUERY' });
      return;
    }

    const links = db.prepare(`
      SELECT rl.*, u.full_name as created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE (rl.source_type = ? AND rl.source_id = ?)
         OR (rl.target_type = ? AND rl.target_id = ?)
      ORDER BY rl.created_at DESC
    
      LIMIT 1000
    `).all(type, id, type, id) as any[];

    // Resolve display labels and normalize direction
    const enriched = links.map(link => {
      const isSource = link.source_type === type && String(link.source_id) === String(id);
      const linkedType = isSource ? link.target_type : link.source_type;
      const linkedId = isSource ? link.target_id : link.source_id;
      return {
        ...link,
        linked_type: linkedType,
        linked_id: linkedId,
        linked_label: getRecordLabel(db, linkedType, linkedId),
      };
    });

    res.json(enriched);
  } catch (error: any) {
    console.error('Get record links error:', error);
    res.status(500).json({ error: 'Failed to get record links', code: 'GET_RECORD_LINKS_ERROR' });
  }
});

// POST /api/records/links - Create a record link
router.post('/links', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source_type, source_id, target_type, target_id, relationship, notes } = req.body;

    if (!source_type || !source_id || !target_type || !target_id) {
      res.status(400).json({ error: 'source_type, source_id, target_type, and target_id are required', code: 'SOURCETYPE_SOURCEID_TARGETTYPE_AND' });
      return;
    }

    // Prevent self-linking
    if (source_type === target_type && String(source_id) === String(target_id)) {
      res.status(400).json({ error: 'Cannot link a record to itself', code: 'CANNOT_LINK_A_RECORD' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO record_links (source_type, source_id, target_type, target_id, relationship, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(source_type, source_id, target_type, target_id, relationship || 'associated', notes || null, req.user!.userId);

    // Activity log
    const sourceLabel = getRecordLabel(db, source_type, source_id);
    const targetLabel = getRecordLabel(db, target_type, target_id);
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'record_linked', 'record_link', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Linked ${source_type} "${sourceLabel}" to ${target_type} "${targetLabel}"`, req.ip || 'unknown');

    const created = db.prepare(`
      SELECT rl.*, u.full_name as created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE rl.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'This link already exists', code: 'THIS_LINK_ALREADY_EXISTS' });
      return;
    }
    console.error('Create record link error:', error);
    res.status(500).json({ error: 'Failed to create record link', code: 'CREATE_RECORD_LINK_ERROR' });
  }
});

// DELETE /api/records/links/:id - Remove a record link
router.delete('/links/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM record_links WHERE id = ?').get(req.params.id) as any;
    if (!link) {
      res.status(404).json({ error: 'Link not found', code: 'LINK_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM record_links WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'record_unlinked', 'record_link', ?, ?, ?)
    `).run(req.user!.userId, link.id, `Removed link between ${link.source_type} #${link.source_id} and ${link.target_type} #${link.target_id}`, req.ip || 'unknown');

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete record link error:', error);
    res.status(500).json({ error: 'Failed to delete record link', code: 'DELETE_RECORD_LINK_ERROR' });
  }
});

// ─── CLIENTS LIST (for property form) ────────────────

// GET /api/records/clients - Lightweight clients list for dropdowns
router.get('/clients', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clients = db.prepare(`
      SELECT id, name, status FROM clients ORDER BY name
    
      LIMIT 1000
    `).all();
    res.json(clients);
  } catch (error: any) {
    console.error('Get clients list error:', error);
    res.status(500).json({ error: 'Failed to get clients list', code: 'GET_CLIENTS_LIST_ERROR' });
  }
});

// ─── RECORD SEARCH (for linking modal) ──────────────

// GET /api/records/search - Search across record types
router.get('/search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, type } = req.query;

    if (!q || String(q).trim().length < 2) {
      res.json([]);
      return;
    }

    const term = `%${String(q).trim()}%`;
    const results: any[] = [];

    if (!type || type === 'person') {
      const persons = db.prepare(`
        SELECT id, first_name, last_name, 'person' as record_type
        FROM persons
        WHERE first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?
        LIMIT 10
      `).all(term, term, term) as any[];
      results.push(...persons.map(p => ({
        id: p.id, record_type: 'person',
        label: `${p.first_name} ${p.last_name}`,
      })));
    }

    if (!type || type === 'vehicle') {
      const vehicles = db.prepare(`
        SELECT id, make, model, plate_number, color, 'vehicle' as record_type
        FROM vehicles_records
        WHERE make LIKE ? OR model LIKE ? OR plate_number LIKE ? OR vin LIKE ?
        LIMIT 10
      `).all(term, term, term, term) as any[];
      results.push(...vehicles.map(v => ({
        id: v.id, record_type: 'vehicle',
        label: `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim(),
      })));
    }

    if (!type || type === 'property') {
      const properties = db.prepare(`
        SELECT id, name, address, 'property' as record_type
        FROM properties
        WHERE name LIKE ? OR address LIKE ?
        LIMIT 10
      `).all(term, term) as any[];
      results.push(...properties.map(p => ({
        id: p.id, record_type: 'property',
        label: `${p.name} — ${p.address}`,
      })));
    }

    if (!type || type === 'evidence') {
      const evidence = db.prepare(`
        SELECT id, evidence_number, description, 'evidence' as record_type
        FROM evidence
        WHERE evidence_number LIKE ? OR description LIKE ? OR serial_number LIKE ?
        LIMIT 10
      `).all(term, term, term) as any[];
      results.push(...evidence.map(e => ({
        id: e.id, record_type: 'evidence',
        label: `${e.evidence_number || ''} — ${e.description || ''}`.trim(),
      })));
    }

    res.json(results);
  } catch (error: any) {
    console.error('Record search error:', error);
    res.status(500).json({ error: 'Failed to record search', code: 'RECORD_SEARCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════
// CRIMINAL HISTORY
// ═══════════════════════════════════════════════════

// GET /api/records/persons/:id/criminal-history
router.get('/persons/:id/criminal-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ch.*, u.first_name || ' ' || u.last_name as created_by_name
      FROM criminal_history ch
      LEFT JOIN users u ON ch.created_by = u.id
      WHERE ch.person_id = ?
      ORDER BY ch.offense_date DESC, ch.created_at DESC
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get criminal history error:', error);
    res.status(500).json({ error: 'Failed to get criminal history', code: 'GET_CRIMINAL_HISTORY_ERROR' });
  }
});

// POST /api/records/persons/:id/criminal-history
router.post('/persons/:id/criminal-history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const personId = req.params.id;
    const {
      record_type, offense, offense_level, statute, case_number,
      agency, jurisdiction, offense_date, disposition, disposition_date,
      sentence, source, notes,
    } = req.body;

    if (!offense) {
      res.status(400).json({ error: 'Offense is required', code: 'OFFENSE_IS_REQUIRED' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO criminal_history
        (person_id, record_type, offense, offense_level, statute, case_number,
         agency, jurisdiction, offense_date, disposition, disposition_date,
         sentence, source, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      personId, record_type || 'other', offense, offense_level || null,
      statute || null, case_number || null, agency || null,
      jurisdiction || null, offense_date || null, disposition || null,
      disposition_date || null, sentence || null, source || null,
      notes || null, user.userId,
    );

    const newRecord = db.prepare('SELECT * FROM criminal_history WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newRecord);
  } catch (error: any) {
    console.error('Create criminal history error:', error);
    res.status(500).json({ error: 'Failed to create criminal history', code: 'CREATE_CRIMINAL_HISTORY_ERROR' });
  }
});

// PUT /api/records/criminal-history/:id
router.put('/criminal-history/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Audit 2026-04-11: previous handler hard-overwrote every column with
    // its current request value, including any field the form omitted —
    // so editing one field would null out all the others. Switched to a
    // dynamic SET clause that only updates keys actually present in the
    // request body.
    const fieldMap: Record<string, (v: any) => any> = {
      record_type: v => v ?? null,
      offense: v => v ?? null,
      offense_level: v => v ?? null,
      statute: v => v ?? null,
      case_number: v => v ?? null,
      agency: v => v ?? null,
      jurisdiction: v => v ?? null,
      offense_date: v => v ?? null,
      disposition: v => v ?? null,
      disposition_date: v => v ?? null,
      sentence: v => v ?? null,
      source: v => v ?? null,
      notes: v => v ?? null,
    };
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, transform] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        sets.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }
    if (sets.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }
    sets.push("updated_at = datetime('now','localtime')");
    values.push(req.params.id);
    db.prepare(`UPDATE criminal_history SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM criminal_history WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update criminal history error:', error);
    res.status(500).json({ error: 'Failed to update criminal history', code: 'UPDATE_CRIMINAL_HISTORY_ERROR' });
  }
});

// DELETE /api/records/criminal-history/:id
router.delete('/criminal-history/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM criminal_history WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete criminal history error:', error);
    res.status(500).json({ error: 'Failed to delete criminal history', code: 'DELETE_CRIMINAL_HISTORY_ERROR' });
  }
});

// ═══════════════════════════════════════════════════
// CLIENT-PERSON LINKS
// ═══════════════════════════════════════════════════

// GET /api/records/persons/:id/clients - Get all clients linked to a person
router.get('/persons/:id/clients', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT cp.*, c.name as client_name, c.contact_name, c.contact_phone,
             c.status as client_status, c.address as client_address,
             u.full_name as created_by_name
      FROM client_persons cp
      JOIN clients c ON cp.client_id = c.id
      LEFT JOIN users u ON cp.created_by = u.id
      WHERE cp.person_id = ?
      ORDER BY cp.is_primary DESC, c.name
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get person clients error:', error);
    res.status(500).json({ error: 'Failed to get person clients', code: 'GET_PERSON_CLIENTS_ERROR' });
  }
});

// GET /api/records/clients/:id/persons - Get all persons linked to a client
router.get('/clients/:id/persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT cp.*, p.first_name, p.last_name, p.phone, p.email,
             p.address, p.employer, p.occupation,
             u.full_name as created_by_name
      FROM client_persons cp
      JOIN persons p ON cp.person_id = p.id
      LEFT JOIN users u ON cp.created_by = u.id
      WHERE cp.client_id = ?
      ORDER BY cp.is_primary DESC, p.last_name, p.first_name
    
      LIMIT 1000
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get client persons error:', error);
    res.status(500).json({ error: 'Failed to get client persons', code: 'GET_CLIENT_PERSONS_ERROR' });
  }
});

// POST /api/records/client-persons - Link a person to a client
router.post('/client-persons', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { client_id, person_id, relationship, title, notes, is_primary } = req.body;

    if (!client_id || !person_id) {
      return res.status(400).json({ error: 'client_id and person_id are required', code: 'CLIENTID_AND_PERSONID_ARE' });
    }

    // Verify both exist
    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(client_id) as any;
    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!client) return res.status(404).json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' });
    if (!person) return res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });

    // If setting as primary, unset any existing primary for this client+relationship
    if (is_primary) {
      db.prepare(
        'UPDATE client_persons SET is_primary = 0 WHERE client_id = ? AND relationship = ?'
      ).run(client_id, relationship || 'contact');
    }

    const result = db.prepare(`
      INSERT INTO client_persons (client_id, person_id, relationship, title, notes, is_primary, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      client_id, person_id,
      relationship || 'contact',
      title || null,
      notes || null,
      is_primary ? 1 : 0,
      user.userId
    );

    // Activity log
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      user.userId, 'client_person_linked', 'person', person_id,
      `Linked person ${person.first_name} ${person.last_name} to client ${client.name} as ${relationship || 'contact'}`,
      req.ip || 'unknown', localNow()
    );

    const link = db.prepare('SELECT * FROM client_persons WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(link);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE'))) {
      return res.status(409).json({ error: 'This person is already linked to this client', code: 'THIS_PERSON_IS_ALREADY' });
    }
    console.error('Link client-person error:', error);
    res.status(500).json({ error: 'Failed to link client-person', code: 'LINK_CLIENTPERSON_ERROR' });
  }
});

// PUT /api/records/client-persons/:id - Update link details
router.put('/client-persons/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM client_persons WHERE id = ?').get(req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Link not found', code: 'LINK_NOT_FOUND' });

    const { relationship, title, notes, is_primary } = req.body;

    // If setting as primary, unset any existing primary for this client+relationship
    if (is_primary) {
      db.prepare(
        'UPDATE client_persons SET is_primary = 0 WHERE client_id = ? AND relationship = ? AND id != ?'
      ).run(link.client_id, relationship || link.relationship, link.id);
    }

    db.prepare(`
      UPDATE client_persons
      SET relationship = COALESCE(?, relationship),
          title = COALESCE(?, title),
          notes = COALESCE(?, notes),
          is_primary = ?
      WHERE id = ?
    `).run(
      relationship || null,
      title !== undefined ? title : null,
      notes !== undefined ? notes : null,
      is_primary ? 1 : 0,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM client_persons WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update client-person link error:', error);
    res.status(500).json({ error: 'Failed to update client-person link', code: 'UPDATE_CLIENTPERSON_LINK_ERROR' });
  }
});

// DELETE /api/records/client-persons/:id - Remove link
router.delete('/client-persons/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare(`
      SELECT cp.*, p.first_name, p.last_name, c.name as client_name
      FROM client_persons cp
      JOIN persons p ON cp.person_id = p.id
      JOIN clients c ON cp.client_id = c.id
      WHERE cp.id = ?
    `).get(req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Link not found', code: 'LINK_NOT_FOUND' });

    db.prepare('DELETE FROM client_persons WHERE id = ?').run(req.params.id);

    // Activity log
    const user = (req as any).user;
    db.prepare(
      'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      user.userId, 'client_person_unlinked', 'person', link.person_id,
      `Unlinked person ${link.first_name} ${link.last_name} from client ${link.client_name}`,
      req.ip || 'unknown', localNow()
    );

    res.json({ message: 'Link removed' });
  } catch (error: any) {
    console.error('Delete client-person link error:', error);
    res.status(500).json({ error: 'Failed to delete client-person link', code: 'DELETE_CLIENTPERSON_LINK_ERROR' });
  }
});

// GET /api/records/persons/:id/invoice-summary - Get billable summary for a person
// Shows all clients they're linked to, incidents for those clients, and invoice history
router.get('/persons/:id/invoice-summary', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });

    // Get linked clients
    const linkedClients = db.prepare(`
      SELECT cp.client_id, cp.relationship, c.name as client_name, c.status as client_status
      FROM client_persons cp
      JOIN clients c ON cp.client_id = c.id
      WHERE cp.person_id = ?
    
      LIMIT 1000
    `).all(person.id) as any[];

    // Get incidents this person is involved in
    const incidents = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.status, i.client_id,
             i.created_at, ip.role,
             c.name as client_name
      FROM incident_persons ip
      JOIN incidents i ON ip.incident_id = i.id
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE ip.person_id = ?
      ORDER BY i.created_at DESC
    
      LIMIT 1000
    `).all(person.id) as any[];

    // Get invoices that reference incidents this person was involved in
    const invoiceItems = db.prepare(`
      SELECT DISTINCT inv.id, inv.invoice_number, inv.status, inv.total, inv.balance_due,
             inv.period_start, inv.period_end, c.name as client_name,
             ili.description as line_description, ili.amount as line_amount
      FROM incident_persons ip
      JOIN incidents i ON ip.incident_id = i.id
      JOIN invoice_line_items ili ON ili.linked_entity_type = 'incident' AND ili.linked_entity_id = i.id
      JOIN invoices inv ON ili.invoice_id = inv.id
      LEFT JOIN clients c ON inv.client_id = c.id
      WHERE ip.person_id = ?
      ORDER BY inv.created_at DESC
    
      LIMIT 1000
    `).all(person.id) as any[];

    res.json({
      person: { id: person.id, name: `${person.first_name} ${person.last_name}` },
      linked_clients: linkedClients,
      incidents,
      invoiced_items: invoiceItems,
      summary: {
        total_linked_clients: linkedClients.length,
        total_incidents: incidents.length,
        total_invoiced_items: invoiceItems.length,
      },
    });
  } catch (error: any) {
    console.error('Person invoice summary error:', error);
    res.status(500).json({ error: 'Failed to person invoice summary', code: 'PERSON_INVOICE_SUMMARY_ERROR' });
  }
});

// ─── GET /api/records/ncic-query ─────────────────────────────
// NCIC/NLETS query simulation — searches local database and returns
// raw record data for client-side NCIC formatting.
router.get('/ncic-query', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, query: q } = req.query;

    if (!type || !q || (q as string).length < 2) {
      res.status(400).json({ error: 'type and query (min 2 chars) are required', code: 'TYPE_AND_QUERY_MIN' });
      return;
    }

    const searchTerm = `%${q}%`;

    switch (type) {
      case 'person': {
        // Search persons by name
        const persons = db.prepare(`
          SELECT * FROM persons
          WHERE first_name LIKE ? OR last_name LIKE ?
            OR (first_name || ' ' || last_name) LIKE ?
            OR (last_name || ', ' || first_name) LIKE ?
          ORDER BY last_name, first_name
          LIMIT 5
        `).all(searchTerm, searchTerm, searchTerm, searchTerm) as any[];

        if (persons.length === 0) {
          res.json({ type: 'person', results: [], query: q });
          return;
        }

        // For each person, get criminal history and warrants
        const results = persons.map(p => {
          const criminalHistory = db.prepare(`
            SELECT * FROM criminal_history WHERE person_id = ?
            ORDER BY offense_date DESC
          
            LIMIT 1000
          `).all(p.id);

          let warrants: any[] = [];
          try {
            warrants = db.prepare(`
              SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active'
              ORDER BY created_at DESC
            
              LIMIT 1000
            `).all(p.id);
          } catch { /* warrants table may not exist */ }

          return { person: p, criminalHistory, warrants };
        });

        res.json({ type: 'person', results, query: q });
        break;
      }

      case 'vehicle': {
        // Search vehicles by plate, VIN, or make/model
        const vehicles = db.prepare(`
          SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
          FROM vehicles_records v
          LEFT JOIN persons p ON v.owner_person_id = p.id
          WHERE v.plate_number LIKE ? OR v.vin LIKE ?
            OR v.make LIKE ? OR v.model LIKE ?
          ORDER BY v.created_at DESC
          LIMIT 5
        `).all(searchTerm, searchTerm, searchTerm, searchTerm);

        res.json({ type: 'vehicle', results: vehicles, query: q });
        break;
      }

      case 'phone': {
        // Search persons by phone number — normalise both sides to digits-only
        const rawDigits = (q as string).replace(/\D/g, '');
        const phoneTerm = `%${rawDigits.length >= 4 ? rawDigits : q}%`;

        // Strip common formatting chars from stored phone values for comparison
        const stripSql = (col: string) =>
          `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${col},''), '-', ''), '(', ''), ')', ''), ' ', '')`;

        const persons = db.prepare(`
          SELECT * FROM persons
          WHERE ${stripSql('phone')} LIKE ?
            OR ${stripSql('phone_secondary')} LIKE ?
          ORDER BY last_name, first_name
          LIMIT 5
        `).all(phoneTerm, phoneTerm) as any[];

        const results = persons.map(p => {
          const criminalHistory = db.prepare(`
            SELECT * FROM criminal_history WHERE person_id = ?
            ORDER BY offense_date DESC
          
            LIMIT 1000
          `).all(p.id);

          let warrants: any[] = [];
          try {
            warrants = db.prepare(`
              SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active'
              ORDER BY created_at DESC
            
              LIMIT 1000
            `).all(p.id);
          } catch { /* warrants table may not exist */ }

          return { person: p, criminalHistory, warrants };
        });

        res.json({ type: 'phone', results, query: q });
        break;
      }

      case 'warrant': {
        // Search warrants by subject name or warrant number
        const warrants = db.prepare(`
          SELECT w.*, p.first_name as subject_first_name, p.last_name as subject_last_name,
            p.dob as subject_dob
          FROM warrants w
          LEFT JOIN persons p ON w.subject_person_id = p.id
          WHERE w.status = 'active'
            AND (w.warrant_number LIKE ?
              OR p.first_name LIKE ? OR p.last_name LIKE ?
              OR (p.first_name || ' ' || p.last_name) LIKE ?
              OR w.charge_description LIKE ?)
          ORDER BY w.created_at DESC
          LIMIT 10
        `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);

        res.json({ type: 'warrant', results: warrants, query: q });
        break;
      }

      case 'address': {
        // Search by address across persons, calls_for_service, properties, dl_addresses
        const addrTerm = searchTerm; // already %query%

        // Persons at this address
        const addrPersons = db.prepare(`
          SELECT * FROM persons
          WHERE address LIKE ? OR (city || ' ' || state || ' ' || zip) LIKE ?
          ORDER BY last_name, first_name LIMIT 10
        `).all(addrTerm, addrTerm) as any[];

        // Enrich persons with warrants
        const addrPersonResults = addrPersons.map(p => {
          let warrants: any[] = [];
          try {
            warrants = db.prepare(
              "SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active'"
            ).all(p.id);
          } catch { /* warrants table may not exist */ }
          return { ...p, active_warrants: warrants.length };
        });

        // Prior calls at this address
        let priorCalls: any[] = [];
        try {
          priorCalls = db.prepare(`
            SELECT id, call_number, incident_type, priority, status, disposition,
              location_address, created_at, weapons_involved, domestic_violence
            FROM calls_for_service
            WHERE location_address LIKE ?
            ORDER BY created_at DESC LIMIT 10
          `).all(addrTerm);
        } catch { /* table may not exist */ }

        // Properties matching this address
        let properties: any[] = [];
        try {
          properties = db.prepare(`
            SELECT id, name, address, gate_code, alarm_code, post_orders, hazard_notes
            FROM properties WHERE address LIKE ? LIMIT 5
          `).all(addrTerm);
        } catch { /* table may not exist */ }

        // Trespass orders at this address
        let trespassOrders: any[] = [];
        try {
          trespassOrders = db.prepare(`
            SELECT t.id, t.order_number, t.status, t.subject_name, t.expiration_date
            FROM trespass_orders t
            WHERE t.location_address LIKE ? AND t.status = 'active'
            LIMIT 5
          `).all(addrTerm);
        } catch { /* table may not exist */ }

        res.json({
          type: 'address',
          persons: addrPersonResults,
          calls: priorCalls,
          properties,
          trespassOrders,
          query: q,
        });
        break;
      }

      default:
        res.status(400).json({ error: 'Invalid type. Use: person, vehicle, warrant, phone, address', code: 'INVALID_TYPE_USE_PERSON' });
    }
  } catch (error: any) {
    console.error('NCIC query error:', error);
    res.status(500).json({ error: 'Failed to ncic query', code: 'NCIC_QUERY_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 21: Person Merge Tool — Detect and merge duplicate persons
// ═══════════════════════════════════════════════════════════════════

// GET /api/records/persons/duplicates - Find potential duplicate persons
router.get('/persons/duplicates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Find persons who share the same last_name+first_name or last_name+dob
    const duplicates = db.prepare(`
      SELECT a.id as id1, a.first_name as first_name1, a.last_name as last_name1, a.dob as dob1,
             b.id as id2, b.first_name as first_name2, b.last_name as last_name2, b.dob as dob2
      FROM persons a
      JOIN persons b ON a.id < b.id
        AND LOWER(a.last_name) = LOWER(b.last_name)
        AND (LOWER(a.first_name) = LOWER(b.first_name) OR a.dob = b.dob)
      WHERE a.archived_at IS NULL AND b.archived_at IS NULL
      ORDER BY a.last_name, a.first_name
      LIMIT 100
    `).all();
    res.json(duplicates);
  } catch (error: any) {
    console.error('Get duplicates error:', error);
    res.status(500).json({ error: 'Failed to get duplicates', code: 'GET_DUPLICATES_ERROR' });
  }
});

// POST /api/records/persons/merge - Merge two person records
router.post('/persons/merge', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { keep_id, merge_id } = req.body;
    if (!keep_id || !merge_id || keep_id === merge_id) {
      res.status(400).json({ error: 'keep_id and merge_id are required and must be different', code: 'KEEPID_AND_MERGEID_ARE' });
      return;
    }
    const keepPerson = db.prepare('SELECT * FROM persons WHERE id = ?').get(keep_id) as any;
    const mergePerson = db.prepare('SELECT * FROM persons WHERE id = ?').get(merge_id) as any;
    if (!keepPerson || !mergePerson) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }

    const now = localNow();
    const mergeTx = db.transaction(() => {
      // Re-link all records from merge_id to keep_id
      try { db.prepare('UPDATE call_persons SET person_id = ? WHERE person_id = ?').run(keep_id, merge_id); } catch { /* table may not exist */ }
      try { db.prepare('UPDATE incident_persons SET person_id = ? WHERE person_id = ?').run(keep_id, merge_id); } catch { /* table may not exist */ }
      try { db.prepare('UPDATE record_links SET source_id = ? WHERE source_type = ? AND source_id = ?').run(String(keep_id), 'person', String(merge_id)); } catch { /* ignore */ }
      try { db.prepare('UPDATE record_links SET target_id = ? WHERE target_type = ? AND target_id = ?').run(String(keep_id), 'person', String(merge_id)); } catch { /* ignore */ }

      // Merge aliases — combine into kept record
      const keepAliases = keepPerson.aliases ? String(keepPerson.aliases) : '';
      const mergeAliases = mergePerson.aliases ? String(mergePerson.aliases) : '';
      const mergeName = `${mergePerson.first_name || ''} ${mergePerson.last_name || ''}`.trim();
      const combinedAliases = [keepAliases, mergeAliases, mergeName].filter(Boolean).join('; ');
      db.prepare('UPDATE persons SET aliases = ?, updated_at = ? WHERE id = ?').run(combinedAliases, now, keep_id);

      // Soft-delete the merged person
      db.prepare('UPDATE persons SET archived_at = ?, notes = COALESCE(notes, \'\') || ? WHERE id = ?').run(
        now, `\n[MERGED into person #${keep_id} on ${now}]`, merge_id
      );

      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'person_merged', 'person', ?, ?, ?)`).run(
        req.user!.userId, keep_id, `Merged person #${merge_id} (${mergeName}) into #${keep_id}`, req.ip || 'unknown');
    });
    mergeTx();

    const result = db.prepare('SELECT * FROM persons WHERE id = ?').get(keep_id);
    res.json(result);
  } catch (error: any) {
    console.error('Merge persons error:', error);
    res.status(500).json({ error: 'Failed to merge persons', code: 'MERGE_PERSONS_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 22: Vehicle Registration Lookup
// ═══════════════════════════════════════════════════════════════════
router.get('/vehicles/plate-lookup', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { plate, state } = req.query;
    if (!plate || typeof plate !== 'string' || plate.trim().length < 2) {
      res.status(400).json({ error: 'plate parameter required (min 2 chars)', code: 'PLATE_PARAMETER_REQUIRED_MIN' });
      return;
    }
    let query = `SELECT * FROM vehicles WHERE LOWER(plate_number) LIKE LOWER(?)`;
    const params: any[] = [`%${plate.trim()}%`];
    if (state && typeof state === 'string') {
      query += ` AND LOWER(state) = LOWER(?)`;
      params.push(state.trim());
    }
    query += ` ORDER BY updated_at DESC LIMIT 20`;
    const vehicles = db.prepare(query).all(...params);
    res.json(vehicles);
  } catch (error: any) {
    console.error('Plate lookup error:', error);
    res.status(500).json({ error: 'Failed to plate lookup', code: 'PLATE_LOOKUP_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 27: Report Approval Queue
// ═══════════════════════════════════════════════════════════════════
router.get('/reports/approval-queue', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const reports = db.prepare(`
      SELECT i.id, i.incident_number, i.incident_type, i.status, i.priority, i.created_at,
        i.location_address, i.narrative, i.officer_id,
        u.full_name as officer_name, u.badge_number
      FROM incidents i
      LEFT JOIN users u ON i.officer_id = u.id
      WHERE i.status = 'pending_review' AND i.archived_at IS NULL
      ORDER BY i.created_at ASC
    
      LIMIT 1000
    `).all();
    res.json(reports);
  } catch (error: any) {
    console.error('Approval queue error:', error);
    res.status(500).json({ error: 'Failed to approval queue', code: 'APPROVAL_QUEUE_ERROR' });
  }
});

// POST /api/records/reports/:id/approve - Approve a report
router.post('/reports/:id/approve', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const now = localNow();
    db.prepare(`UPDATE incidents SET status = 'approved', supervisor_id = ?, approved_at = ?, updated_at = ? WHERE id = ?`).run(
      req.user!.userId, now, now, id
    );
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'report_approved', 'incident', ?, ?, ?)`).run(
      req.user!.userId, id, `Report approved by supervisor`, req.ip || 'unknown');

    // Notify the officer
    const incident = db.prepare('SELECT officer_id, incident_number FROM incidents WHERE id = ?').get(id) as any;
    if (incident?.officer_id) {
      try {
        db.prepare(`INSERT INTO notifications (user_id, type, priority, title, message, entity_type, entity_id, created_at)
          VALUES (?, 'system', 'normal', ?, ?, 'incident', ?, ?)`).run(
          incident.officer_id, `Report ${incident.incident_number} Approved`, 'Your report has been approved by a supervisor.', id, now);
      } catch { /* notifications table may not exist */ }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Approve report error:', error);
    res.status(500).json({ error: 'Failed to approve report', code: 'APPROVE_REPORT_ERROR' });
  }
});

// POST /api/records/reports/:id/return - Return report for revision
router.post('/reports/:id/return', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const { reason } = req.body;
    const now = localNow();
    db.prepare(`UPDATE incidents SET status = 'returned', supervisor_id = ?, updated_at = ? WHERE id = ?`).run(
      req.user!.userId, now, id
    );
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'report_returned', 'incident', ?, ?, ?)`).run(
      req.user!.userId, id, `Report returned: ${reason || 'No reason given'}`, req.ip || 'unknown');

    const incident = db.prepare('SELECT officer_id, incident_number FROM incidents WHERE id = ?').get(id) as any;
    if (incident?.officer_id) {
      try {
        db.prepare(`INSERT INTO notifications (user_id, type, priority, title, message, entity_type, entity_id, created_at)
          VALUES (?, 'system', 'high', ?, ?, 'incident', ?, ?)`).run(
          incident.officer_id, `Report ${incident.incident_number} Returned`, reason || 'Report returned for revision by supervisor.', id, now);
      } catch { /* notifications table may not exist */ }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Return report error:', error);
    res.status(500).json({ error: 'Failed to return report', code: 'RETURN_REPORT_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 29: Case Solvability Score
// ═══════════════════════════════════════════════════════════════════
router.get('/cases/:id/solvability', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
    if (!incident) { res.status(404).json({ error: 'Case not found', code: 'CASE_NOT_FOUND' }); return; }

    let score = 0;
    const factors: string[] = [];

    // Evidence exists
    let evidenceCount = 0;
    try { evidenceCount = (db.prepare('SELECT COUNT(*) as c FROM evidence WHERE incident_id = ?').get(id) as any)?.c || 0; } catch { /* ignore */ }
    if (evidenceCount > 0) { score += 20; factors.push(`Physical evidence (${evidenceCount} items)`); }

    // Witnesses
    let witnessCount = 0;
    try { witnessCount = (db.prepare("SELECT COUNT(*) as c FROM incident_persons WHERE incident_id = ? AND role = 'witness'").get(id) as any)?.c || 0; } catch { /* ignore */ }
    if (witnessCount > 0) { score += 15; factors.push(`Witnesses (${witnessCount})`); }

    // Suspect identified
    let suspectCount = 0;
    try { suspectCount = (db.prepare("SELECT COUNT(*) as c FROM incident_persons WHERE incident_id = ? AND role = 'suspect'").get(id) as any)?.c || 0; } catch { /* ignore */ }
    if (suspectCount > 0) { score += 25; factors.push('Suspect identified'); }

    // Narrative quality
    const narrative = incident.narrative || '';
    if (narrative.length > 500) { score += 10; factors.push('Detailed narrative'); }
    if (narrative.length > 200) { score += 5; factors.push('Narrative present'); }

    // Vehicle description
    if (incident.vehicle_description) { score += 10; factors.push('Vehicle description'); }

    // Location data
    if (incident.latitude && incident.longitude) { score += 5; factors.push('GPS coordinates'); }

    // Linked records
    let linkCount = 0;
    try { linkCount = (db.prepare("SELECT COUNT(*) as c FROM record_links WHERE (source_type = 'incident' AND source_id = ?) OR (target_type = 'incident' AND target_id = ?)").get(String(id), String(id)) as any)?.c || 0; } catch { /* ignore */ }
    if (linkCount > 0) { score += 10; factors.push(`Linked records (${linkCount})`); }

    score = Math.min(100, score);

    res.json({
      score,
      rating: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
      factors,
      evidence_count: evidenceCount,
      witness_count: witnessCount,
      suspect_identified: suspectCount > 0,
    });
  } catch (error: any) {
    console.error('Solvability score error:', error);
    res.status(500).json({ error: 'Failed to solvability score', code: 'SOLVABILITY_SCORE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 31: Person Alias Tracking — search aliases
// ═══════════════════════════════════════════════════════════════════
router.get('/persons/alias-search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      res.json([]);
      return;
    }
    const term = `%${q.trim()}%`;
    const results = db.prepare(`
      SELECT id, first_name, last_name, dob, aliases, notes
      FROM persons
      WHERE aliases LIKE ? AND archived_at IS NULL
      ORDER BY last_name, first_name LIMIT 20
    `).all(term);
    res.json(results);
  } catch (error: any) {
    console.error('Alias search error:', error);
    res.status(500).json({ error: 'Failed to alias search', code: 'ALIAS_SEARCH_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 32: Vehicle BOLO Check
// ═══════════════════════════════════════════════════════════════════
router.get('/vehicles/bolo-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { plate, make, model, color } = req.query;
    if (!plate && !make) {
      res.json({ matches: [] });
      return;
    }
    // Check warrants/BOLOs for vehicle matches
    let query = `SELECT id, bolo_number, suspect_name, vehicle_description, priority, status, created_at
      FROM bolos WHERE status = 'active' AND (1=0`;
    const params: any[] = [];
    if (plate) {
      query += ` OR LOWER(vehicle_description) LIKE LOWER(?)`;
      params.push(`%${plate}%`);
    }
    if (make) {
      query += ` OR LOWER(vehicle_description) LIKE LOWER(?)`;
      params.push(`%${make}%`);
    }
    if (model) {
      query += ` OR LOWER(vehicle_description) LIKE LOWER(?)`;
      params.push(`%${model}%`);
    }
    if (color) {
      query += ` OR LOWER(vehicle_description) LIKE LOWER(?)`;
      params.push(`%${color}%`);
    }
    query += `) LIMIT 10`;

    let matches: any[] = [];
    try { matches = db.prepare(query).all(...params); } catch { /* bolos table may not exist */ }
    res.json({ matches });
  } catch (error: any) {
    console.error('BOLO check error:', error);
    res.status(500).json({ error: 'Failed to bolo check', code: 'BOLO_CHECK_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 35: Person Photo Upload
// ═══════════════════════════════════════════════════════════════════
router.post('/persons/:id/photo', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const { photo } = req.body; // Base64 data URL
    if (!photo || typeof photo !== 'string') {
      res.status(400).json({ error: 'photo (base64 data URL) is required', code: 'PHOTO_BASE64_DATA_URL' });
      return;
    }

    const now = localNow();
    // Write to photo_url (the column the rest of the app reads). The
    // legacy `photo` column existed but nothing reads it, so prior writes
    // were silently invisible. Audit 2026-04-11.
    db.prepare('UPDATE persons SET photo_url = ?, updated_at = ? WHERE id = ?').run(photo, now, id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'photo_uploaded', 'person', ?, ?, ?)`).run(
      req.user!.userId, id, 'Person photo uploaded', req.ip || 'unknown');

    res.json({ success: true, photo_url: photo });
  } catch (error: any) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: 'Failed to photo upload', code: 'PHOTO_UPLOAD_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 36: Incident Location Autocomplete — addresses from prior calls
// ═══════════════════════════════════════════════════════════════════
router.get('/location-suggest', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 3) {
      res.json([]);
      return;
    }
    const term = `%${q.trim()}%`;
    const locations = db.prepare(`
      SELECT DISTINCT location_address as address, latitude, longitude, COUNT(*) as call_count
      FROM calls_for_service
      WHERE location_address LIKE ? AND location_address IS NOT NULL AND location_address != ''
      GROUP BY LOWER(location_address)
      ORDER BY call_count DESC
      LIMIT 10
    `).all(term);
    res.json(locations);
  } catch (error: any) {
    console.error('Location suggest error:', error);
    res.status(500).json({ error: 'Failed to location suggest', code: 'LOCATION_SUGGEST_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 37: Case Assignment Notification
// ═══════════════════════════════════════════════════════════════════
router.post('/cases/:id/assign', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(paramStr(req.params.id), 10);
    if (isNaN(id) || id < 1) { res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' }); return; }

    const { detective_id } = req.body;
    if (!detective_id) { res.status(400).json({ error: 'detective_id is required', code: 'DETECTIVEID_IS_REQUIRED' }); return; }

    const now = localNow();
    db.prepare('UPDATE incidents SET assigned_detective_id = ?, updated_at = ? WHERE id = ?').run(detective_id, now, id);
    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'case_assigned', 'incident', ?, ?, ?)`).run(
      req.user!.userId, id, `Case assigned to detective #${detective_id}`, req.ip || 'unknown');

    // Notify the detective
    const incident = db.prepare('SELECT incident_number, incident_type FROM incidents WHERE id = ?').get(id) as any;
    try {
      db.prepare(`INSERT INTO notifications (user_id, type, priority, title, message, entity_type, entity_id, created_at)
        VALUES (?, 'system', 'high', ?, ?, 'incident', ?, ?)`).run(
        detective_id, `Case Assigned: ${incident?.incident_number || ''}`,
        `You have been assigned to investigate ${incident?.incident_type || 'case'} #${incident?.incident_number || id}`, id, now);
    } catch { /* notifications table may not exist */ }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Assign case error:', error);
    res.status(500).json({ error: 'Failed to assign case', code: 'ASSIGN_CASE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Feature 38: Evidence Disposition Reminder
// ═══════════════════════════════════════════════════════════════════
router.get('/evidence/overdue', (req: Request, res: Response) => {
  try {
    const db = getDb();
    let overdue: any[] = [];
    try {
      overdue = db.prepare(`
        SELECT e.id, e.evidence_number, e.description, e.category, e.retention_until, e.incident_id,
          i.incident_number
        FROM evidence e
        LEFT JOIN incidents i ON e.incident_id = i.id
        WHERE e.retention_until IS NOT NULL AND e.retention_until < ? AND e.disposition IS NULL
        ORDER BY e.retention_until ASC
        LIMIT 50
      `).all(localNow());
    } catch { /* evidence table may not have retention_until */ }
    res.json(overdue);
  } catch (error: any) {
    console.error('Evidence overdue error:', error);
    res.status(500).json({ error: 'Failed to evidence overdue', code: 'EVIDENCE_OVERDUE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 41: Vehicle History Report
// ════════════════════════════════════════════════════════════

router.get('/vehicles/:id/history', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    // Incidents mentioning this vehicle
    let incidents: any[] = [];
    try {
      incidents = db.prepare(`
        SELECT id, incident_number, incident_type, status, description, occurred_at, location
        FROM incidents
        WHERE description LIKE ? OR description LIKE ? OR description LIKE ?
        ORDER BY occurred_at DESC LIMIT 50
      `).all(`%${vehicle.plate_number}%`, `%${vehicle.vin || 'NOMATCH'}%`, `%${vehicle.make} ${vehicle.model}%`);
    } catch { /* table may not exist */ }

    // Citations for this vehicle
    let citations: any[] = [];
    try {
      citations = db.prepare(`
        SELECT id, citation_number, violation_description, violation_date, fine_amount, status
        FROM citations
        WHERE vehicle_plate LIKE ? OR vehicle_vin LIKE ?
        ORDER BY violation_date DESC LIMIT 50
      `).all(`%${vehicle.plate_number}%`, `%${vehicle.vin || 'NOMATCH'}%`);
    } catch { /* table may not exist */ }

    // BOLOs
    let bolos: any[] = [];
    try {
      bolos = db.prepare(`
        SELECT id, bolo_number, description, status, created_at
        FROM bolos
        WHERE description LIKE ? OR description LIKE ?
        ORDER BY created_at DESC LIMIT 20
      `).all(`%${vehicle.plate_number}%`, `%${vehicle.vin || 'NOMATCH'}%`);
    } catch { /* bolos table may not exist */ }

    // Tows
    let tows: any[] = [];
    try {
      tows = db.prepare(`
        SELECT id, tow_number, tow_reason, status, tow_from, created_at
        FROM vehicle_tows
        WHERE vehicle_plate = ? OR vehicle_vin = ?
        ORDER BY created_at DESC LIMIT 20
      `).all(vehicle.plate_number, vehicle.vin || '');
    } catch { /* table may not exist */ }

    res.json({
      data: {
        vehicle,
        incidents,
        citations,
        bolos,
        tows,
        total_records: incidents.length + citations.length + bolos.length + tows.length,
      },
    });
  } catch (error: any) {
    console.error('Vehicle history error:', error);
    res.status(500).json({ error: 'Failed to vehicle history', code: 'VEHICLE_HISTORY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 42: Registration Expiration Alerts
// ════════════════════════════════════════════════════════════

router.get('/vehicles/alerts/expired-registration', (_req: Request, _res: Response) => {
  try {
    const db = getDb();
    const now = localNow().split('T')[0];

    // Vehicles with expired registration
    let expired: any[] = [];
    try {
      expired = db.prepare(`
        SELECT v.id, v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
               v.registration_expiry, v.owner_person_id,
               p.first_name || ' ' || p.last_name as owner_name,
               JULIANDAY(?) - JULIANDAY(v.registration_expiry) as days_expired
        FROM vehicles_records v
        LEFT JOIN persons p ON v.owner_person_id = p.id
        WHERE v.registration_expiry IS NOT NULL AND v.registration_expiry < ?
        ORDER BY v.registration_expiry ASC
        LIMIT 100
      `).all(now, now);
    } catch { /* column may not exist */ }

    // Vehicles expiring within 30 days
    let expiringSoon: any[] = [];
    try {
      const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      expiringSoon = db.prepare(`
        SELECT v.id, v.plate_number, v.state, v.make, v.model, v.year, v.color,
               v.registration_expiry,
               p.first_name || ' ' || p.last_name as owner_name,
               JULIANDAY(v.registration_expiry) - JULIANDAY(?) as days_remaining
        FROM vehicles_records v
        LEFT JOIN persons p ON v.owner_person_id = p.id
        WHERE v.registration_expiry IS NOT NULL
          AND v.registration_expiry >= ? AND v.registration_expiry <= ?
        ORDER BY v.registration_expiry ASC
        LIMIT 100
      `).all(now, now, thirtyDays);
    } catch { /* column may not exist */ }

    _res.json({ data: { expired, expiring_soon: expiringSoon, total_expired: expired.length, total_expiring: expiringSoon.length } });
  } catch (error: any) {
    console.error('Registration alerts error:', error);
    _res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 43: Insurance Verification
// ════════════════════════════════════════════════════════════

router.post('/vehicles/:id/insurance', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    const { insurance_company, policy_number, insurance_status, expiration_date, verified_by_document, notes } = req.body;

    const now = localNow();

    // Update vehicle with insurance info
    try {
      db.prepare(`
        UPDATE vehicles_records SET
          insurance_company = COALESCE(?, insurance_company),
          insurance_policy = COALESCE(?, insurance_policy),
          insurance_status = COALESCE(?, insurance_status),
          insurance_expiry = COALESCE(?, insurance_expiry),
          insurance_verified_at = ?,
          insurance_verified_by = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        insurance_company || null, policy_number || null,
        insurance_status || 'verified', expiration_date || null,
        now, req.user!.userId, now, req.params.id
      );
    } catch {
      // If columns don't exist, store in notes
      const insData = JSON.stringify({ insurance_company, policy_number, insurance_status, expiration_date, verified_by_document });
      db.prepare('UPDATE vehicles_records SET notes = COALESCE(notes, \'\') || ?, updated_at = ? WHERE id = ?')
        .run(`\n[INSURANCE] ${insData}`, now, req.params.id);
    }

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'insurance_verified', 'vehicle', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, JSON.stringify({
      plate: vehicle.plate_number, insurance_company, policy_number, insurance_status, expiration_date,
    }), now);

    res.json({ success: true, message: 'Insurance information updated' });
  } catch (error: any) {
    console.error('Insurance verification error:', error);
    res.status(500).json({ error: 'Failed to insurance verification', code: 'INSURANCE_VERIFICATION_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 44: Stolen Vehicle Check
// ════════════════════════════════════════════════════════════

router.post('/vehicles/stolen-check', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { plate_number, vin, state } = req.body;

    if (!plate_number && !vin) return res.status(400).json({ error: 'plate_number or vin required', code: 'PLATENUMBER_OR_VIN_REQUIRED' });

    // Check local stolen vehicle database
    let stolenMatch: any = null;
    let localMatches: any[] = [];

    // Check against local BOLO/stolen entries
    try {
      if (plate_number) {
        localMatches = db.prepare(`
          SELECT * FROM vehicles_records
          WHERE plate_number = ? AND (flags LIKE '%stolen%' OR flags LIKE '%BOLO%' OR is_stolen = 1)
        
          LIMIT 1000
        `).all(plate_number) as any[];
      }
      if (vin && localMatches.length === 0) {
        localMatches = db.prepare(`
          SELECT * FROM vehicles_records
          WHERE vin = ? AND (flags LIKE '%stolen%' OR flags LIKE '%BOLO%' OR is_stolen = 1)
        
          LIMIT 1000
        `).all(vin) as any[];
      }
    } catch {
      // Fallback without is_stolen column
      if (plate_number) {
        localMatches = db.prepare(`
          SELECT * FROM vehicles_records
          WHERE plate_number = ? AND notes LIKE '%stolen%'
        
          LIMIT 1000
        `).all(plate_number) as any[];
      }
    }

    if (localMatches.length > 0) {
      stolenMatch = localMatches[0];
    }

    // Also check BOLOs table
    let boloMatches: any[] = [];
    try {
      const searchTerm = plate_number || vin;
      boloMatches = db.prepare(`
        SELECT * FROM bolos
        WHERE status = 'active' AND (description LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC LIMIT 5
      `).all(`%${plate_number || 'NOMATCH'}%`, `%${vin || 'NOMATCH'}%`) as any[];
    } catch { /* bolos table may not exist */ }

    // Log the check
    const now = localNow();
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'stolen_vehicle_check', 'vehicle', 0, ?, ?)
    `).run(req.user!.userId, JSON.stringify({ plate_number, vin, state, match: stolenMatch ? 'HIT' : 'CLEAR' }), now);

    res.json({
      data: {
        status: stolenMatch || boloMatches.length > 0 ? 'HIT' : 'CLEAR',
        is_stolen: !!stolenMatch,
        has_bolo: boloMatches.length > 0,
        stolen_match: stolenMatch,
        bolo_matches: boloMatches,
        checked_at: now,
        message: stolenMatch ? 'ALERT: Vehicle matches stolen vehicle records!' : boloMatches.length > 0 ? 'ALERT: Vehicle matches active BOLO!' : 'No stolen vehicle match found.',
      },
    });
  } catch (error: any) {
    console.error('Stolen vehicle check error:', error);
    res.status(500).json({ error: 'Failed to stolen vehicle check', code: 'STOLEN_VEHICLE_CHECK_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// FEATURE 45: Fleet-to-person Linking
// ════════════════════════════════════════════════════════════

router.post('/vehicles/:id/link-person', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' });

    const { person_id, relationship } = req.body;
    if (!person_id) return res.status(400).json({ error: 'person_id required', code: 'PERSONID_REQUIRED' });

    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });

    const now = localNow();

    // Set owner
    db.prepare('UPDATE vehicles_records SET owner_person_id = ?, updated_at = ? WHERE id = ?')
      .run(person_id, now, req.params.id);

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
      VALUES (?, 'vehicle_person_linked', 'vehicle', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, JSON.stringify({
      vehicle_id: vehicle.id, plate: vehicle.plate_number,
      person_id, person_name: `${person.first_name} ${person.last_name}`,
      relationship: relationship || 'owner',
    }), now);

    res.json({ success: true, vehicle_id: vehicle.id, person_id, person_name: `${person.first_name} ${person.last_name}` });
  } catch (error: any) {
    console.error('Vehicle-person link error:', error);
    res.status(500).json({ error: 'Failed to vehicle-person link', code: 'VEHICLEPERSON_LINK_ERROR' });
  }
});

router.get('/vehicles/auto-link-suggestions', (_req: Request, res: Response) => {
  try {
    const db = getDb();

    // Find vehicles without owners that appear in incidents/citations with known persons
    const suggestions: any[] = [];

    // Vehicles without owners
    const unlinked = db.prepare(`
      SELECT id, plate_number, make, model, year, color, vin
      FROM vehicles_records
      WHERE owner_person_id IS NULL
      ORDER BY updated_at DESC LIMIT 50
    `).all() as any[];

    for (const v of unlinked) {
      // Check citations for matching plate
      try {
        const citMatch = db.prepare(`
          SELECT DISTINCT violator_name, person_id
          FROM citations
          WHERE vehicle_plate = ? AND person_id IS NOT NULL
          LIMIT 3
        `).all(v.plate_number) as any[];

        for (const m of citMatch) {
          if (m.person_id) {
            const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(m.person_id) as any;
            if (person) {
              suggestions.push({
                vehicle: v,
                person: { id: person.id, name: `${person.first_name} ${person.last_name}` },
                source: 'citation',
                confidence: 'high',
              });
            }
          }
        }
      } catch { /* table may not exist */ }
    }

    res.json({ data: suggestions, total: suggestions.length });
  } catch (error: any) {
    console.error('Auto-link suggestions error:', error);
    res.status(500).json({ error: 'Failed to auto-link suggestions', code: 'AUTOLINK_SUGGESTIONS_ERROR' });
  }
});

// ── Feature 6: Person known associates ─────────────────────────────
// GET /api/records/persons/:id/associates - Get known associates
router.get('/persons/:id/associates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const associates = db.prepare(`
      SELECT pa.id as link_id, pa.relationship_type, pa.notes, pa.created_at,
        p.id, p.first_name, p.last_name, p.dob, p.photo_url, p.flags,
        u.full_name as added_by_name
      FROM person_associates pa
      JOIN persons p ON pa.associate_id = p.id
      LEFT JOIN users u ON pa.created_by = u.id
      WHERE pa.person_id = ?
      UNION
      SELECT pa.id as link_id, pa.relationship_type, pa.notes, pa.created_at,
        p.id, p.first_name, p.last_name, p.dob, p.photo_url, p.flags,
        u.full_name as added_by_name
      FROM person_associates pa
      JOIN persons p ON pa.person_id = p.id
      LEFT JOIN users u ON pa.created_by = u.id
      WHERE pa.associate_id = ?
      ORDER BY created_at DESC
    
      LIMIT 1000
    `).all(req.params.id, req.params.id);
    res.json(associates);
  } catch (error: any) {
    console.error('Get associates error:', error);
    res.status(500).json({ error: 'Failed to get associates', code: 'GET_ASSOCIATES_ERROR' });
  }
});

// POST /api/records/persons/:id/associates - Link known associate
router.post('/persons/:id/associates', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { associate_id, relationship_type, notes } = req.body;
    if (!associate_id) { res.status(400).json({ error: 'associate_id is required', code: 'ASSOCIATEID_IS_REQUIRED' }); return; }
    if (String(associate_id) === String(req.params.id)) { res.status(400).json({ error: 'Cannot associate a person with themselves', code: 'CANNOT_ASSOCIATE_A_PERSON' }); return; }

    const validTypes = ['family', 'friend', 'gang', 'associate', 'coworker', 'neighbor', 'romantic', 'other'];
    const relType = validTypes.includes(relationship_type) ? relationship_type : 'associate';

    const result = db.prepare(`
      INSERT OR IGNORE INTO person_associates (person_id, associate_id, relationship_type, notes, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, associate_id, relType, notes || null, req.user!.userId);

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Link associate error:', error);
    res.status(500).json({ error: 'Failed to link associate', code: 'LINK_ASSOCIATE_ERROR' });
  }
});

// DELETE /api/records/persons/:id/associates/:linkId - Remove associate link
router.delete('/persons/:id/associates/:linkId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM person_associates WHERE id = ?').run(req.params.linkId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Remove associate error:', error);
    res.status(500).json({ error: 'Failed to remove associate', code: 'REMOVE_ASSOCIATE_ERROR' });
  }
});

// ── Feature 7: Vehicle tow tracking ───────────────────────────────
// PUT /api/records/vehicles/:id/tow - Update tow info on a vehicle
router.put('/vehicles/:id/tow', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) { res.status(404).json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }); return; }

    const { tow_status, tow_company, tow_lot_location, tow_date, tow_release_date, tow_release_to, tow_reason } = req.body;
    const now = localNow();

    db.prepare(`
      UPDATE vehicles_records SET
        tow_status = COALESCE(?, tow_status),
        tow_company = COALESCE(?, tow_company),
        tow_lot_location = COALESCE(?, tow_lot_location),
        tow_date = COALESCE(?, tow_date),
        tow_release_date = COALESCE(?, tow_release_date),
        tow_release_to = COALESCE(?, tow_release_to),
        tow_reason = COALESCE(?, tow_reason)
      WHERE id = ?
    `).run(tow_status, tow_company, tow_lot_location, tow_date, tow_release_date, tow_release_to, tow_reason, req.params.id);

    const updated = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update tow info error:', error);
    res.status(500).json({ error: 'Failed to update tow info', code: 'UPDATE_TOW_INFO_ERROR' });
  }
});

// ── Feature 8: Evidence temperature tracking ──────────────────────
// POST /api/records/evidence/:id/temperature - Log temperature reading
router.post('/evidence/:id/temperature', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) { res.status(404).json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }); return; }

    const { temperature } = req.body;
    if (temperature == null || isNaN(Number(temperature))) { res.status(400).json({ error: 'temperature is required (numeric)', code: 'TEMPERATURE_IS_REQUIRED_NUMERIC' }); return; }

    const result = db.prepare(`
      INSERT INTO evidence_temperature_logs (evidence_id, temperature, recorded_by)
      VALUES (?, ?, ?)
    `).run(req.params.id, temperature, req.user!.userId);

    // Update current temp on evidence record
    db.prepare('UPDATE evidence SET storage_temperature = ? WHERE id = ?').run(temperature, req.params.id);

    res.status(201).json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Log temperature error:', error);
    res.status(500).json({ error: 'Failed to log temperature', code: 'LOG_TEMPERATURE_ERROR' });
  }
});

// GET /api/records/evidence/:id/temperature - Get temperature history
router.get('/evidence/:id/temperature', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const logs = db.prepare(`
      SELECT etl.*, u.full_name as recorded_by_name
      FROM evidence_temperature_logs etl
      LEFT JOIN users u ON etl.recorded_by = u.id
      WHERE etl.evidence_id = ?
      ORDER BY etl.recorded_at DESC
      LIMIT 100
    `).all(req.params.id);
    res.json(logs);
  } catch (error: any) {
    console.error('Get temperature logs error:', error);
    res.status(500).json({ error: 'Failed to get temperature logs', code: 'GET_TEMPERATURE_LOGS_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 1: Person Alias Tracking
// ════════════════════════════════════════════════════════════
// Audit 2026-04-11: the original module-load `try { getDb(); ... }`
// silently failed because getDb() throws before initDatabase() runs, so
// the table was never created and every alias write threw "no such table:
// person_aliases". Switched to a lazy idempotent creator called from each
// handler.
function ensurePersonAliasesTable(db: any) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS person_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      alias_name TEXT NOT NULL,
      alias_type TEXT DEFAULT 'aka',
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )`
  ).run();
}

router.get('/persons/:id/aliases', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensurePersonAliasesTable(db);
    const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(req.params.id);
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    const aliases = db.prepare('SELECT pa.*, u.full_name as created_by_name FROM person_aliases pa LEFT JOIN users u ON pa.created_by = u.id WHERE pa.person_id = ? ORDER BY pa.created_at DESC').all(req.params.id);
    res.json({ data: aliases });
  } catch (error: any) { console.error('Get aliases error:', error); res.status(500).json({ error: 'Failed to get aliases', code: 'GET_ALIASES_ERROR' }); }
});

router.post('/persons/:id/aliases', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensurePersonAliasesTable(db);
    const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(req.params.id);
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    const { alias_name, alias_type, notes } = req.body;
    if (!alias_name?.trim()) { res.status(400).json({ error: 'alias_name is required', code: 'MISSING_ALIAS_NAME' }); return; }
    const now = localNow();
    const result = db.prepare('INSERT INTO person_aliases (person_id, alias_name, alias_type, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(req.params.id, alias_name.trim(), alias_type || 'aka', notes || null, req.user!.userId, now);
    auditLog(req, 'CREATE', 'person_alias', Number(result.lastInsertRowid), `Added alias "${alias_name}" to person #${req.params.id}`);
    res.status(201).json({ data: { id: result.lastInsertRowid, alias_name, alias_type: alias_type || 'aka' } });
  } catch (error: any) { console.error('Create alias error:', error); res.status(500).json({ error: 'Failed to create alias', code: 'CREATE_ALIAS_ERROR' }); }
});

router.delete('/persons/:id/aliases/:aliasId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensurePersonAliasesTable(db);
    const alias = db.prepare('SELECT * FROM person_aliases WHERE id = ? AND person_id = ?').get(req.params.aliasId, req.params.id) as any;
    if (!alias) { res.status(404).json({ error: 'Alias not found', code: 'ALIAS_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM person_aliases WHERE id = ?').run(req.params.aliasId);
    auditLog(req, 'DELETE', 'person_alias', parseInt(paramStr(req.params.aliasId)), `Removed alias "${alias.alias_name}" from person #${paramStr(req.params.id)}`);
    res.json({ success: true });
  } catch (error: any) { console.error('Delete alias error:', error); res.status(500).json({ error: 'Failed to delete alias', code: 'DELETE_ALIAS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 2: Known Associates
// ════════════════════════════════════════════════════════════
// Audit 2026-04-11: removed dead module-load CREATE TABLE that defined a
// stale schema (associate_person_id/associate_name) different from the
// authoritative one in database.ts (associate_id). The IF NOT EXISTS made
// it a no-op against an already-created table; the only effect was a
// silent error in the try/catch at module load. The real schema lives in
// database.ts and is used by the handlers above.


router.delete('/persons/:id/associates/:assocId', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const assoc = db.prepare('SELECT * FROM person_associates WHERE id = ? AND person_id = ?').get(req.params.assocId, req.params.id) as any;
    if (!assoc) { res.status(404).json({ error: 'Associate not found', code: 'ASSOCIATE_NOT_FOUND' }); return; }
    db.prepare('DELETE FROM person_associates WHERE id = ?').run(req.params.assocId);
    auditLog(req, 'DELETE', 'person_associate', parseInt(paramStr(req.params.assocId)), `Removed associate from person #${paramStr(req.params.id)}`);
    res.json({ success: true });
  } catch (error: any) { console.error('Delete associate error:', error); res.status(500).json({ error: 'Failed to delete associate', code: 'DELETE_ASSOCIATE_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 3: Last Known Address Tracking
// ════════════════════════════════════════════════════════════
// Audit 2026-04-11: same module-load init failure as person_aliases.
// Switched to a lazy idempotent creator.
function ensurePersonAddressHistoryTable(db: any) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS person_address_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      city TEXT,
      state TEXT,
      zip TEXT,
      address_type TEXT DEFAULT 'residential',
      source TEXT DEFAULT 'manual',
      verified INTEGER DEFAULT 0,
      effective_from TEXT,
      effective_to TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL
    )`
  ).run();
}

router.get('/persons/:id/addresses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensurePersonAddressHistoryTable(db);
    const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(req.params.id);
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    const addresses = db.prepare('SELECT pah.*, u.full_name as created_by_name FROM person_address_history pah LEFT JOIN users u ON pah.created_by = u.id WHERE pah.person_id = ? ORDER BY pah.effective_from DESC, pah.created_at DESC').all(req.params.id);
    res.json({ data: addresses });
  } catch (error: any) { console.error('Get address history error:', error); res.status(500).json({ error: 'Failed to get address history', code: 'GET_ADDRESS_HISTORY_ERROR' }); }
});

router.post('/persons/:id/addresses', (req: Request, res: Response) => {
  try {
    const db = getDb();
    ensurePersonAddressHistoryTable(db);
    const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(req.params.id);
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    const { address, city, state, zip, address_type, source, effective_from } = req.body;
    if (!address?.trim()) { res.status(400).json({ error: 'address is required', code: 'MISSING_ADDRESS' }); return; }
    const now = localNow();
    if (!req.body.effective_to) { db.prepare('UPDATE person_address_history SET effective_to = ? WHERE person_id = ? AND effective_to IS NULL').run(now, req.params.id); }
    const result = db.prepare('INSERT INTO person_address_history (person_id, address, city, state, zip, address_type, source, effective_from, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.params.id, address.trim(), city || null, state || null, zip || null, address_type || 'residential', source || 'manual', effective_from || now, req.user!.userId, now);
    db.prepare('UPDATE persons SET address = ?, city = ?, state = ?, zip = ?, updated_at = ? WHERE id = ?').run(address.trim(), city || null, state || null, zip || null, now, req.params.id);
    auditLog(req, 'CREATE', 'person_address', Number(result.lastInsertRowid), `Added address "${address}" to person #${req.params.id}`);
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error: any) { console.error('Create address error:', error); res.status(500).json({ error: 'Failed to add address', code: 'CREATE_ADDRESS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 4: Data Completeness Scoring
// ════════════════════════════════════════════════════════════
router.get('/persons/:id/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }); return; }
    const fieldGroups: Record<string, { fields: string[]; weight: number }> = {
      identity: { fields: ['first_name', 'last_name', 'dob', 'gender', 'race'], weight: 30 },
      physical: { fields: ['height', 'weight', 'hair_color', 'eye_color'], weight: 15 },
      contact: { fields: ['address', 'phone', 'email'], weight: 20 },
      identification: { fields: ['dl_number', 'dl_state'], weight: 15 },
      description: { fields: ['scars_marks_tattoos', 'photo_url'], weight: 10 },
      supplemental: { fields: ['employer', 'emergency_contact_name', 'emergency_contact_phone'], weight: 10 },
    };
    const breakdown: Record<string, { filled: number; total: number; score: number }> = {};
    let totalScore = 0;
    for (const [group, config] of Object.entries(fieldGroups)) {
      const filled = config.fields.filter(f => person[f] != null && String(person[f]).trim() !== '').length;
      const groupScore = Math.round((filled / config.fields.length) * config.weight);
      breakdown[group] = { filled, total: config.fields.length, score: groupScore };
      totalScore += groupScore;
    }
    const missingCritical = ['first_name', 'last_name', 'dob', 'address', 'phone', 'dl_number'].filter(f => !person[f] || String(person[f]).trim() === '');
    res.json({ data: { person_id: person.id, overall_score: totalScore, max_score: 100, grade: totalScore >= 80 ? 'A' : totalScore >= 60 ? 'B' : totalScore >= 40 ? 'C' : totalScore >= 20 ? 'D' : 'F', breakdown, missing_critical: missingCritical } });
  } catch (error: any) { console.error('Get completeness error:', error); res.status(500).json({ error: 'Failed to get completeness', code: 'GET_COMPLETENESS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 5: Cross-Entity Search
// ════════════════════════════════════════════════════════════
router.get('/cross-search', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q, entities } = req.query;
    if (!q || (q as string).length < 2) { res.status(400).json({ error: 'Search query must be at least 2 characters', code: 'SEARCH_QUERY_TOO_SHORT' }); return; }
    const searchTerm = `%${q}%`;
    const entityList = entities ? (entities as string).split(',') : ['persons', 'citations', 'warrants', 'field_interviews', 'trespass_orders'];
    const results: Record<string, any[]> = {};
    if (entityList.includes('persons')) { results.persons = db.prepare(`SELECT id, first_name, last_name, dob, address, phone, photo_url, 'person' as entity_type FROM persons WHERE (first_name || ' ' || last_name) LIKE ? OR address LIKE ? OR phone LIKE ? OR email LIKE ? OR alias_nickname LIKE ? ORDER BY last_name, first_name LIMIT 15`).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm); }
    if (entityList.includes('citations')) { results.citations = db.prepare(`SELECT id, citation_number, person_name, violation_description, status, violation_date, 'citation' as entity_type FROM citations WHERE citation_number LIKE ? OR person_name LIKE ? OR violation_description LIKE ? OR statute_citation LIKE ? ORDER BY created_at DESC LIMIT 15`).all(searchTerm, searchTerm, searchTerm, searchTerm); }
    if (entityList.includes('warrants')) { try { results.warrants = db.prepare(`SELECT w.id, w.warrant_number, w.charge_description, w.status, w.type, (p.first_name || ' ' || p.last_name) as subject_name, 'warrant' as entity_type FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id WHERE w.warrant_number LIKE ? OR w.charge_description LIKE ? OR (p.first_name || ' ' || p.last_name) LIKE ? ORDER BY w.created_at DESC LIMIT 15`).all(searchTerm, searchTerm, searchTerm); } catch { results.warrants = []; } }
    if (entityList.includes('field_interviews')) { try { results.field_interviews = db.prepare(`SELECT id, fi_number, subject_first_name, subject_last_name, location, contact_reason, status, 'field_interview' as entity_type FROM field_interviews WHERE fi_number LIKE ? OR (subject_first_name || ' ' || subject_last_name) LIKE ? OR location LIKE ? OR narrative LIKE ? ORDER BY created_at DESC LIMIT 15`).all(searchTerm, searchTerm, searchTerm, searchTerm); } catch { results.field_interviews = []; } }
    if (entityList.includes('trespass_orders')) { try { results.trespass_orders = db.prepare(`SELECT id, order_number, subject_first_name, subject_last_name, property_name, location, status, 'trespass_order' as entity_type FROM trespass_orders WHERE order_number LIKE ? OR (subject_first_name || ' ' || subject_last_name) LIKE ? OR property_name LIKE ? OR location LIKE ? ORDER BY created_at DESC LIMIT 15`).all(searchTerm, searchTerm, searchTerm, searchTerm); } catch { results.trespass_orders = []; } }
    let aliasHits: any[] = [];
    try { aliasHits = db.prepare(`SELECT pa.person_id, pa.alias_name, p.first_name, p.last_name, 'alias_match' as match_type FROM person_aliases pa JOIN persons p ON pa.person_id = p.id WHERE pa.alias_name LIKE ? LIMIT 10`).all(searchTerm); } catch { /* table may not exist */ }
    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0) + aliasHits.length;
    res.json({ data: results, alias_matches: aliasHits, total_results: totalResults, query: q });
  } catch (error: any) { console.error('Cross-entity search error:', error); res.status(500).json({ error: 'Failed to search', code: 'CROSS_SEARCH_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 6: Recent Searches Tracking
// ════════════════════════════════════════════════════════════
try { const db = getDb(); db.exec(`CREATE TABLE IF NOT EXISTS recent_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, query TEXT NOT NULL, entity_types TEXT, result_count INTEGER DEFAULT 0, created_at TEXT NOT NULL)`); } catch { /* already exists */ }

router.post('/recent-searches', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { query, entity_types, result_count } = req.body;
    if (!query?.trim()) { res.status(400).json({ error: 'query is required', code: 'MISSING_QUERY' }); return; }
    const now = localNow();
    const last = db.prepare('SELECT query FROM recent_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(req.user!.userId) as any;
    if (last?.query === query.trim()) { res.json({ success: true, deduplicated: true }); return; }
    db.prepare('INSERT INTO recent_searches (user_id, query, entity_types, result_count, created_at) VALUES (?, ?, ?, ?, ?)').run(req.user!.userId, query.trim(), entity_types || null, result_count || 0, now);
    db.prepare('DELETE FROM recent_searches WHERE user_id = ? AND id NOT IN (SELECT id FROM recent_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT 50)').run(req.user!.userId, req.user!.userId);
    res.json({ success: true });
  } catch (error: any) { console.error('Save recent search error:', error); res.status(500).json({ error: 'Failed to save search', code: 'SAVE_SEARCH_ERROR' }); }
});

router.get('/recent-searches', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const searches = db.prepare('SELECT * FROM recent_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user!.userId);
    res.json({ data: searches });
  } catch (error: any) { console.error('Get recent searches error:', error); res.status(500).json({ error: 'Failed to get searches', code: 'GET_SEARCHES_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 7: Persons Stats Dashboard
// ════════════════════════════════════════════════════════════
router.get('/persons/stats/overview', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const totalPersons = (db.prepare('SELECT COUNT(*) as count FROM persons WHERE archived_at IS NULL').get() as any).count;
    const totalVehicles = (db.prepare('SELECT COUNT(*) as count FROM vehicles_records WHERE archived_at IS NULL').get() as any).count;
    let withWarrants = 0;
    try { withWarrants = (db.prepare("SELECT COUNT(DISTINCT subject_person_id) as count FROM warrants WHERE status = 'active' AND subject_person_id IS NOT NULL").get() as any).count; } catch { /* warrants may not exist */ }
    let withCitations = 0;
    try { withCitations = (db.prepare("SELECT COUNT(DISTINCT person_id) as count FROM citations WHERE status != 'voided' AND person_id IS NOT NULL").get() as any).count; } catch { /* citations may not exist */ }
    const recentlyAdded = (db.prepare("SELECT COUNT(*) as count FROM persons WHERE created_at >= datetime('now', '-7 days', 'localtime')").get() as any).count;
    const withPhotos = (db.prepare('SELECT COUNT(*) as count FROM persons WHERE photo_url IS NOT NULL AND photo_url != "" AND archived_at IS NULL').get() as any).count;
    let watchlistHits = 0;
    try { watchlistHits = (db.prepare('SELECT COUNT(*) as count FROM persons WHERE watchlist_match IS NOT NULL AND archived_at IS NULL').get() as any).count; } catch { /* column may not exist */ }
    res.json({ data: { total_persons: totalPersons, total_vehicles: totalVehicles, with_active_warrants: withWarrants, with_citations: withCitations, recently_added_7d: recentlyAdded, with_photos: withPhotos, photo_rate: totalPersons > 0 ? Math.round((withPhotos / totalPersons) * 100) : 0, watchlist_hits: watchlistHits } });
  } catch (error: any) { console.error('Get persons stats error:', error); res.status(500).json({ error: 'Failed to get stats', code: 'GET_PERSONS_STATS_ERROR' }); }
});

// ════════════════════════════════════════════════════════════
// UPGRADE 8: Bulk Data Completeness Stats
// ════════════════════════════════════════════════════════════
router.get('/persons/stats/completeness', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const persons = db.prepare(`SELECT id, first_name, last_name, dob, gender, race, height, weight, hair_color, eye_color, address, phone, email, dl_number, dl_state, scars_marks_tattoos, photo_url, employer, emergency_contact_name, emergency_contact_phone FROM persons WHERE archived_at IS NULL LIMIT 5000`).all() as any[];
    const criticalFields = ['first_name', 'last_name', 'dob', 'address', 'phone', 'dl_number'];
    const allFields = ['first_name', 'last_name', 'dob', 'gender', 'race', 'height', 'weight', 'hair_color', 'eye_color', 'address', 'phone', 'email', 'dl_number', 'dl_state', 'scars_marks_tattoos', 'photo_url', 'employer', 'emergency_contact_name', 'emergency_contact_phone'];
    const totalPersons = persons.length;
    let avgScore = 0;
    const incomplete: { id: number; name: string; score: number; missing: string[] }[] = [];
    for (const p of persons) {
      const filled = allFields.filter(f => p[f] != null && String(p[f]).trim() !== '').length;
      const score = Math.round((filled / allFields.length) * 100);
      avgScore += score;
      if (score < 50) { incomplete.push({ id: p.id, name: `${p.first_name} ${p.last_name}`, score, missing: criticalFields.filter(f => !p[f] || String(p[f]).trim() === '') }); }
    }
    incomplete.sort((a, b) => a.score - b.score);
    res.json({ data: { total_persons: totalPersons, avg_completeness: totalPersons > 0 ? Math.round(avgScore / totalPersons) : 0, incomplete_count: incomplete.length, most_incomplete: incomplete.slice(0, 20) } });
  } catch (error: any) { console.error('Get completeness stats error:', error); res.status(500).json({ error: 'Failed to get completeness stats', code: 'GET_COMPLETENESS_STATS_ERROR' }); }
});

// ═════════════════════════════════════════════════════════════
// PLATE CHECK — Multi-Source Vehicle Lookup by License Plate
// ═════════════════════════════════════════════════════════════

// POST /api/records/plate-check — Look up a vehicle by license plate across all sources
router.post('/plate-check', async (req: Request, res: Response) => {
  try {
    const { plate, state } = req.body;

    if (!plate || !plate.trim()) {
      res.status(400).json({ error: 'License plate number is required' }); return;
    }

    const db = getDb();
    const plateClean = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const stateClean = (state || '').trim().toUpperCase();

    // 1. Check local vehicles_records table
    let localResults: any[] = [];
    try {
      const localWhere = stateClean
        ? "UPPER(REPLACE(plate_number, ' ', '')) = ? AND UPPER(state) = ?"
        : "UPPER(REPLACE(plate_number, ' ', '')) = ?";
      const localParams = stateClean ? [plateClean, stateClean] : [plateClean];
      localResults = db.prepare(`SELECT * FROM vehicles_records WHERE ${localWhere}`).all(...localParams) as any[];
    } catch { /* vehicles_records table may not exist */ }

    // 2. Check fleet vehicles
    let fleetResults: any[] = [];
    try {
      const fleetWhere = stateClean
        ? "UPPER(REPLACE(license_plate, ' ', '')) = ? AND UPPER(registration_state) = ?"
        : "UPPER(REPLACE(license_plate, ' ', '')) = ?";
      const fleetParams = stateClean ? [plateClean, stateClean] : [plateClean];
      fleetResults = db.prepare(`SELECT * FROM fleet_vehicles WHERE ${fleetWhere}`).all(...fleetParams) as any[];
    } catch { /* fleet table may not exist */ }

    // 3. Check people_index for vehicles (skip tracker data)
    let indexResults: any[] = [];
    try {
      const rows = db.prepare(
        "SELECT vehicles FROM people_index WHERE vehicles LIKE ? LIMIT 10"
      ).all(`%${plateClean}%`) as any[];
      for (const row of rows) {
        try {
          const vehicles = JSON.parse(row.vehicles || '[]');
          for (const v of vehicles) {
            const vPlate = (v.plate || v.plateNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
            if (vPlate === plateClean) {
              indexResults.push(v);
            }
          }
        } catch { /* bad JSON */ }
      }
    } catch { /* people_index may not exist */ }

    // 4. Call RapidAPI Plate Check for external data
    let apiResults: any[] = [];
    try {
      let apiKey: string | null = null;
      const keyRow = db.prepare(
        "SELECT config_value FROM system_config WHERE config_key = 'plate_check_rapidapi_key' AND is_active = 1 LIMIT 1"
      ).get() as { config_value: string } | undefined;

      if (keyRow?.config_value) {
        try { apiKey = decryptApiKey(keyRow.config_value); } catch { apiKey = keyRow.config_value; }
      }
      if (!apiKey) {
        const fallback = db.prepare(
          "SELECT config_value FROM system_config WHERE config_key = 'skiptracer_api_key' AND is_active = 1 LIMIT 1"
        ).get() as { config_value: string } | undefined;
        if (fallback?.config_value) {
          try { apiKey = decryptApiKey(fallback.config_value); } catch { apiKey = fallback.config_value; }
        }
      }

      if (apiKey) {
        const params = new URLSearchParams({ plate: plateClean });
        if (stateClean) params.set('state', stateClean);

        const apiRes = await fetch(`https://plate-check.p.rapidapi.com/plate-check?${params}`, {
          method: 'GET',
          headers: {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'plate-check.p.rapidapi.com',
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (apiRes.ok) {
          const apiData = await apiRes.json() as any;
          // Map API response to our format
          const vehicle = apiData?.vehicle || apiData?.result || apiData?.data || apiData;
          if (vehicle && (vehicle.vin || vehicle.make || vehicle.model)) {
            apiResults.push({
              vin: vehicle.vin || vehicle.VIN || '',
              plate_number: plateClean,
              plate_state: stateClean || vehicle.state || '',
              year: vehicle.year || vehicle.model_year || '',
              make: vehicle.make || '',
              model: vehicle.model || '',
              trim: vehicle.trim || '',
              color: vehicle.color || vehicle.exterior_color || '',
              body_type: vehicle.body_type || vehicle.style || '',
              drivetrain: vehicle.drivetrain || '',
              engine: vehicle.engine || vehicle.engine_description || '',
              fuel_type: vehicle.fuel_type || '',
              transmission: vehicle.transmission || '',
              doors: vehicle.doors || '',
              registered_owner: vehicle.owner || vehicle.registered_owner || '',
              vehicle_type: vehicle.vehicle_type || vehicle.type || '',
              source: 'rapidapi_plate_check',
            });
          }
        } else {
          console.warn(`[Plate Check] RapidAPI returned ${apiRes.status}`);
        }
      }
    } catch (apiErr) {
      console.warn('[Plate Check] RapidAPI call failed:', apiErr);
    }

    const allResults = [
      ...localResults.map(r => ({ ...r, source: 'local_vehicles' })),
      ...fleetResults.map(r => ({
        vin: r.vin,
        plate_number: r.license_plate,
        plate_state: r.registration_state,
        year: r.year,
        make: r.make,
        model: r.model,
        color: r.color,
        registered_owner: r.assigned_officer_name || null,
        vehicle_type: r.vehicle_type,
        status: r.status,
        source: 'fleet',
      })),
      ...indexResults.map(r => ({
        vin: r.vin,
        plate_number: r.plate || r.plateNumber,
        plate_state: r.plateState,
        year: r.year,
        make: r.make,
        model: r.model,
        color: r.color,
        registered_owner: r.registeredOwner,
        source: 'skip_tracker',
      })),
      ...apiResults,
    ];

    // Audit log
    db.prepare(
      "INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'plate_check', 'vehicle', 0, ?, ?)"
    ).run(req.user!.userId, `Plate check: ${plateClean} ${stateClean || 'ANY'}`, req.ip || 'unknown');

    res.json({
      hit: allResults.length > 0,
      plate: plateClean,
      state: stateClean || null,
      results: allResults,
      resultCount: allResults.length,
      sources: [...new Set(allResults.map(r => r.source))],
    });
  } catch (err: any) {
    console.error('[Plate Check] Error:', err);
    res.status(500).json({ error: 'Plate check failed', code: 'PLATE_CHECK_ERROR' });
  }
});

export default router;
