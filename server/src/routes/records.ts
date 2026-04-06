import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { sendCsv } from '../utils/csvExport';
import { localNow, localToday } from '../utils/timeUtils';
import { searchUtahWarrants } from '../utils/utahWarrantScraper';
import { searchOfacLocal } from '../utils/ofacScraper';

const router = Router();

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
      ? JSON.stringify(hits.map((h: any) => ({ name: h.sdn_name, program: h.program, list: h.source_list })))
      : null;

    db.prepare(
      'UPDATE persons SET watchlist_match = ?, watchlist_checked_at = ? WHERE id = ?'
    ).run(matchInfo, now, personId);

    // Create notification if there's a hit
    if (hits.length > 0) {
      try {
        db.prepare(`
          INSERT INTO notifications (user_id, type, priority, title, body, entity_type, entity_id, created_at)
          VALUES (0, 'system', 'high', ?, ?, 'person', ?, ?)
        `).run(
          `OFAC WATCHLIST MATCH: ${firstName} ${lastName}`,
          `Person record #${personId} matches ${hits.length} OFAC entry(ies): ${hits.map((h: any) => h.sdn_name).join(', ')}`,
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

// ─── Safe Column Lists (exclude ssn_full from all responses) ────
// ssn_full should NEVER be returned in API responses — only ssn_last4 for display
const PERSON_COLUMNS = `id, first_name, last_name, middle_name, alias_nickname, dob, gender, race,
  height, height_feet, height_inches, weight, build, complexion, hair_color, eye_color, scars_marks_tattoos,
  clothing_description, address, city, state, zip, phone, email,
  dl_number, dl_state, dl_expiry, dl_class, ssn_last4,
  id_image_url, id_type, id_number, id_state, id_expiry,
  employer, occupation, emergency_contact_name, emergency_contact_phone,
  gang_affiliation, is_sex_offender, is_veteran, language,
  place_of_birth, citizenship, marital_status,
  hair_length, hair_style, facial_hair, glasses, shoe_size, blood_type,
  phone_secondary, social_media,
  probation_parole, probation_parole_officer, known_associates,
  emergency_contact_relationship, caution_flags,
  photo_url, flags, notes, created_at, updated_at, archived_at`;

const PERSON_LIST_COLUMNS = `id, first_name, last_name, middle_name, alias_nickname, dob, gender, race,
  address, city, state, zip, phone, email, dl_number, dl_state, ssn_last4,
  photo_url, flags, caution_flags, created_at, updated_at, archived_at`;

// ─── PERSONS ──────────────────────────────────────────

// GET /api/records/persons - List persons
router.get('/persons', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page = '1', limit = '50', flags, archived } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (flags) {
      whereClause += " AND flags LIKE ? ESCAPE '\\'";
      const safeFlags = String(flags).replace(/[%_\\]/g, '\\$&');
      params.push(`%"${safeFlags}"%`);
    }

    // Archive filter
    if (archived === 'true') {
      whereClause += ' AND archived_at IS NOT NULL';
    } else if (archived !== 'all') {
      whereClause += ' AND archived_at IS NULL';
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM persons ${whereClause}`).get(...params) as any;

    const persons = db.prepare(`
      SELECT ${PERSON_LIST_COLUMNS} FROM persons ${whereClause}
      ORDER BY last_name, first_name
      LIMIT ? OFFSET ?
    `).all(...params, limitNum, offset);

    res.json({
      data: persons,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: countRow?.total ?? 0,
        totalPages: limitNum > 0 ? Math.ceil((countRow?.total ?? 0) / limitNum) : 0,
      },
    });
  } catch (error: any) {
    console.error('Get persons error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/persons/search - Search persons
router.get('/persons/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
      return;
    }

    const searchTerm = `%${q}%`;

    const persons = db.prepare(`
      SELECT ${PERSON_LIST_COLUMNS} FROM persons
      WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
        OR address LIKE ? OR (first_name || ' ' || last_name) LIKE ?
      ORDER BY last_name, first_name
      LIMIT 50
    `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);

    res.json(persons);
  } catch (error: any) {
    console.error('Search persons error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
      whereClause += " AND flags LIKE ? ESCAPE '\\'";
      const safeFlags = String(flags).replace(/[%_\\]/g, '\\$&');
      params.push(`%"${safeFlags}"%`);
    }

    const rows = db.prepare(`
      SELECT last_name, first_name, dob, gender, address, phone, email, flags, created_at
      FROM persons
      ${whereClause}
      ORDER BY last_name, first_name
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
    console.error('Export persons error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/persons/:id - Get person details
router.get('/persons/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    let person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;

    if (!person) {
      res.status(404).json({ error: 'Person not found' });
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
      `).all(person.id);
    } catch { /* table might not exist yet */ }

    res.json({ ...person, vehicles, linked_clients });
  } catch (error: any) {
    console.error('Get person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/persons/:id/history - Get person's incident history
router.get('/persons/:id/history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
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
    `).all(`%${person.last_name}%`, `%${person.last_name}%`);

    res.json({
      person,
      activity,
      bolos,
    });
  } catch (error: any) {
    console.error('Get person history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/persons/:id/system-history - Aggregated system history
router.get('/persons/:id/system-history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
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
    console.error('Get person system-history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/persons - Create person
router.post('/persons', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    } = req.body;

    if (!first_name || !last_name) {
      res.status(400).json({ error: 'first_name and last_name are required' });
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
        photo_url, flags, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'person_created', 'person', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created person record: ${first_name} ${last_name}`, req.ip || 'unknown');

    // Auto-screen against OFAC sanctions BEFORE returning response
    screenPersonOfac(Number(result.lastInsertRowid), first_name, last_name);

    // SELECT after screening so watchlist_match is included in response
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(result.lastInsertRowid);
    if (!person) { res.status(500).json({ error: 'Failed to retrieve created person' }); return; }
    res.status(201).json(person);
  } catch (error: any) {
    console.error('Create person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/records/persons/:id - Update person
router.put('/persons/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
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

      const updateTx = db.transaction(() => {
        db.prepare(`UPDATE persons SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        db.prepare(`
          INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (?, 'person_updated', 'person', ?, ?, ?)
        `).run(req.user!.userId, req.params.id, `Updated person record: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');
      });
      updateTx();
    }

    const updated = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/persons/:id - Delete person
router.delete('/persons/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
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
    console.error('Delete person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/persons/screen-all-ofac - Bulk OFAC screening for all unscreened persons
router.post('/persons/screen-all-ofac', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
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
    console.error('Bulk OFAC screening error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Bulk OFAC screening failed' });
  }
});

// POST /api/records/persons/:id/screen-ofac - Force re-screen a single person
router.post('/persons/:id/screen-ofac', requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found' }); return; }

    // Force re-screen regardless of previous check
    screenPersonOfac(person.id, person.first_name, person.last_name);

    const updated = db.prepare('SELECT * FROM persons WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('OFAC re-screen error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'OFAC re-screen failed' });
  }
});

// POST /api/records/persons/:id/archive
router.post('/persons/:id/archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found' }); return; }
    if (person.archived_at) { res.status(400).json({ error: 'Person is already archived' }); return; }
    const now = localNow();
    const archiveTx = db.transaction(() => {
      db.prepare('UPDATE persons SET archived_at = ? WHERE id = ?').run(now, person.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'person_archived', 'person', ?, ?, ?)`).run(req.user!.userId, person.id, `Archived person: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');
    });
    archiveTx();
    res.json(db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(person.id));
  } catch (error: any) { console.error('Archive person error:', error?.message || 'Unknown error'); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/records/persons/:id/unarchive
router.post('/persons/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) { res.status(404).json({ error: 'Person not found' }); return; }
    if (!person.archived_at) { res.status(400).json({ error: 'Person is not archived' }); return; }
    const unarchiveTx = db.transaction(() => {
      db.prepare('UPDATE persons SET archived_at = NULL WHERE id = ?').run(person.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'person_unarchived', 'person', ?, ?, ?)`).run(req.user!.userId, person.id, `Restored person: ${person.first_name} ${person.last_name}`, req.ip || 'unknown');
    });
    unarchiveTx();
    res.json(db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(person.id));
  } catch (error: any) { console.error('Unarchive person error:', error?.message || 'Unknown error'); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── VEHICLES ─────────────────────────────────────────

// GET /api/records/vehicles - List vehicles
router.get('/vehicles', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page = '1', limit = '50', archived } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
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
        total: countRow?.total ?? 0,
        totalPages: limitNum > 0 ? Math.ceil((countRow?.total ?? 0) / limitNum) : 0,
      },
    });
  } catch (error: any) {
    console.error('Get vehicles error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/vehicles/search - Search vehicles
router.get('/vehicles/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      res.status(400).json({ error: 'Search query must be at least 2 characters' });
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
    console.error('Search vehicles error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('Export vehicles error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/vehicles/:id - Get vehicle
router.get('/vehicles/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare(`
      SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
      FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      WHERE v.id = ?
    `).get(req.params.id) as any;

    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }

    res.json(vehicle);
  } catch (error: any) {
    console.error('Get vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/vehicles - Create vehicle
router.post('/vehicles', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      plate_number, state, make, model, year, color, secondary_color,
      body_style, doors, vin, owner_person_id,
      insurance_company, insurance_policy, registration_expiry,
      damage_description, distinguishing_features,
      trim, engine_type, fuel_type, transmission, drive_type,
      tow_status, tow_company, tow_date, plate_type,
      commercial_vehicle, hazmat, odometer,
      owner_address, owner_phone, lien_holder,
      stolen_status, stolen_date, recovery_date,
      flags, notes,
    } = req.body;

    const result = db.prepare(`
      INSERT INTO vehicles_records (plate_number, state, make, model, year, color, secondary_color,
        body_style, doors, vin, owner_person_id,
        insurance_company, insurance_policy, registration_expiry,
        damage_description, distinguishing_features,
        trim, engine_type, fuel_type, transmission, drive_type,
        tow_status, tow_company, tow_date, plate_type,
        commercial_vehicle, hazmat, odometer,
        owner_address, owner_phone, lien_holder,
        stolen_status, stolen_date, recovery_date,
        flags, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plate_number || null, state || null, make || null, model || null,
      year ?? null, color || null, secondary_color || null,
      body_style || null, doors ?? null, vin || null, owner_person_id || null,
      insurance_company || null, insurance_policy || null, registration_expiry || null,
      damage_description || null, distinguishing_features || null,
      trim || null, engine_type || null, fuel_type || null, transmission || null, drive_type || null,
      tow_status || null, tow_company || null, tow_date || null, plate_type || null,
      commercial_vehicle ? 1 : 0, hazmat ? 1 : 0, odometer || null,
      owner_address || null, owner_phone || null, lien_holder || null,
      stolen_status || null, stolen_date || null, recovery_date || null,
      JSON.stringify(flags || []), notes || null,
    );

    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(result.lastInsertRowid);
    if (!vehicle) { res.status(500).json({ error: 'Failed to retrieve created vehicle' }); return; }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'vehicle_created', 'vehicle', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created vehicle: ${plate_number || 'No plate'} ${make || ''} ${model || ''}`, req.ip || 'unknown');

    res.status(201).json(vehicle);
  } catch (error: any) {
    console.error('Create vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/records/vehicles/:id - Update vehicle
router.put('/vehicles/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
      return;
    }

    const {
      plate_number, state, make, model, year, color, secondary_color,
      body_style, doors, vin, owner_person_id,
      insurance_company, insurance_policy, registration_expiry,
      damage_description, distinguishing_features,
      trim, engine_type, fuel_type, transmission, drive_type,
      tow_status, tow_company, tow_date, plate_type,
      commercial_vehicle, hazmat, odometer,
      owner_address, owner_phone, lien_holder,
      stolen_status, stolen_date, recovery_date,
      flags, notes,
    } = req.body;

    // Build dynamic SET clause — only update fields explicitly provided
    const fields: string[] = [];
    const values: any[] = [];
    const bodyKeys = Object.keys(req.body);

    const vFieldMap: Record<string, (v: any) => any> = {
      plate_number: v => v ?? null, state: v => v ?? null, make: v => v ?? null,
      model: v => v ?? null, year: v => v ?? null, color: v => v ?? null,
      secondary_color: v => v ?? null, body_style: v => v ?? null, doors: v => v ?? null,
      vin: v => v ?? null, owner_person_id: v => v ?? null,
      insurance_company: v => v ?? null, insurance_policy: v => v ?? null,
      registration_expiry: v => v ?? null, damage_description: v => v ?? null,
      distinguishing_features: v => v ?? null, trim: v => v ?? null,
      engine_type: v => v ?? null, fuel_type: v => v ?? null,
      transmission: v => v ?? null, drive_type: v => v ?? null,
      tow_status: v => v ?? null, tow_company: v => v ?? null,
      tow_date: v => v ?? null, plate_type: v => v ?? null,
      commercial_vehicle: v => v ? 1 : 0, hazmat: v => v ? 1 : 0,
      odometer: v => v ?? null, owner_address: v => v ?? null,
      owner_phone: v => v ?? null, lien_holder: v => v ?? null,
      stolen_status: v => v ?? null, stolen_date: v => v ?? null,
      recovery_date: v => v ?? null, notes: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(vFieldMap)) {
      if (bodyKeys.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(transform(req.body[key]));
      }
    }
    if (bodyKeys.includes('flags')) {
      fields.push('flags = ?');
      values.push(JSON.stringify(flags ?? []));
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
    console.error('Update vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/vehicles/:id - Delete vehicle
router.delete('/vehicles/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
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
    res.json({ message: 'Vehicle deleted' });
  } catch (error: any) {
    console.error('Delete vehicle error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/vehicles/:id/archive
router.post('/vehicles/:id/archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const v = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!v) { res.status(404).json({ error: 'Vehicle not found' }); return; }
    if (v.archived_at) { res.status(400).json({ error: 'Vehicle is already archived' }); return; }
    const now = localNow();
    const vArchiveTx = db.transaction(() => {
      db.prepare('UPDATE vehicles_records SET archived_at = ? WHERE id = ?').run(now, v.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'vehicle_archived', 'vehicle', ?, ?, ?)`).run(req.user!.userId, v.id, `Archived vehicle: ${v.plate_number || v.vin || v.id}`, req.ip || 'unknown');
    });
    vArchiveTx();
    res.json(db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(v.id));
  } catch (error: any) { console.error('Archive vehicle error:', error?.message || 'Unknown error'); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/records/vehicles/:id/unarchive
router.post('/vehicles/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const v = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!v) { res.status(404).json({ error: 'Vehicle not found' }); return; }
    if (!v.archived_at) { res.status(400).json({ error: 'Vehicle is not archived' }); return; }
    const vUnarchiveTx = db.transaction(() => {
      db.prepare('UPDATE vehicles_records SET archived_at = NULL WHERE id = ?').run(v.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        Values (?, 'vehicle_unarchived', 'vehicle', ?, ?, ?)`).run(req.user!.userId, v.id, `Restored vehicle: ${v.plate_number || v.vin || v.id}`, req.ip || 'unknown');
    });
    vUnarchiveTx();
    res.json(db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(v.id));
  } catch (error: any) { console.error('Unarchive vehicle error:', error?.message || 'Unknown error'); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── PROPERTIES ───────────────────────────────────────

// GET /api/records/properties - List properties
router.get('/properties', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all(...params);

    res.json(properties);
  } catch (error: any) {
    console.error('Get properties error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/properties/:id - Get property details
router.get('/properties/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
      res.status(404).json({ error: 'Property not found' });
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
    `).all(property.id);

    // Get today's schedule
    const today = localToday();
    const schedules = db.prepare(`
      SELECT s.*, u.full_name as officer_name
      FROM schedules s
      LEFT JOIN users u ON s.officer_id = u.id
      WHERE s.property_id = ? AND s.shift_date = ?
    `).all(property.id, today);

    // Get linked persons via client_persons (employees, tenants, managers, etc.)
    let linkedPersons: any[] = [];
    if (property.client_id) {
      linkedPersons = db.prepare(`
        SELECT p.id, p.first_name, p.last_name, p.phone, p.email, p.photo_url,
          p.flags, p.notes, p.alias_nickname,
          cp.relationship, cp.title, cp.is_primary, cp.notes as link_notes
        FROM client_persons cp
        JOIN persons p ON cp.person_id = p.id
        WHERE cp.client_id = ?
        ORDER BY cp.is_primary DESC, cp.relationship, p.last_name
      `).all(property.client_id);
    }

    // Also get directly linked persons via record_links (trespass subjects, etc.)
    const directLinks = db.prepare(`
      SELECT p.id, p.first_name, p.last_name, p.phone, p.email, p.photo_url,
        p.flags, p.notes, p.alias_nickname,
        rl.relationship, rl.notes as link_notes
      FROM record_links rl
      JOIN persons p ON rl.target_id = p.id AND rl.target_type = 'person'
      WHERE rl.source_type = 'property' AND rl.source_id = ?
      UNION
      SELECT p.id, p.first_name, p.last_name, p.phone, p.email, p.photo_url,
        p.flags, p.notes, p.alias_nickname,
        rl.relationship, rl.notes as link_notes
      FROM record_links rl
      JOIN persons p ON rl.source_id = p.id AND rl.source_type = 'person'
      WHERE rl.target_type = 'property' AND rl.target_id = ?
    `).all(property.id, property.id);

    // Merge direct links, avoiding duplicates
    const existingIds = new Set(linkedPersons.map((p: any) => p.id));
    for (const dl of directLinks) {
      if (!existingIds.has((dl as any).id)) {
        linkedPersons.push(dl);
      }
    }

    res.json({
      ...property,
      recentCalls,
      checkpoints,
      todaySchedules: schedules,
      linkedPersons,
    });
  } catch (error: any) {
    console.error('Get property error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/properties - Create property
router.post('/properties', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      client_id, name, address, city, state, zip, latitude, longitude, property_type,
      risk_level,
      gate_code, alarm_code, emergency_contact, post_orders, hazard_notes,
      access_instructions, is_active,
    } = req.body;

    if (!client_id) {
      res.status(400).json({ error: 'client_id is required' });
      return;
    }
    if (!name || !address) {
      res.status(400).json({ error: 'name and address are required' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO properties (client_id, name, address, city, state, zip, latitude, longitude, property_type,
        risk_level, gate_code, alarm_code, emergency_contact, post_orders, hazard_notes, access_instructions, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      client_id, name, address, city || null, state || null, zip || null,
      latitude ?? null, longitude ?? null,
      property_type || null, risk_level || 'low',
      gate_code || null, alarm_code || null,
      emergency_contact || null, post_orders || null, hazard_notes || null,
      access_instructions || null, is_active !== undefined ? (is_active ? 1 : 0) : 1,
    );

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'property_created', 'property', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created property: ${name}`, req.ip || 'unknown');

    const property = db.prepare(`
      SELECT p.*, c.name as client_name
      FROM properties p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(property);
  } catch (error: any) {
    console.error('Create property error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── INCIDENT CROSS-REFERENCES ───────────────────────

// GET /api/records/persons/:id/incidents - All incidents linked to a person
router.get('/persons/:id/incidents', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare(`SELECT ${PERSON_COLUMNS} FROM persons WHERE id = ?`).get(req.params.id) as any;
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
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
    `).all(person.id);

    res.json(incidents);
  } catch (error: any) {
    console.error('Get person incidents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/vehicles/:id/incidents - All incidents linked to a vehicle
router.get('/vehicles/:id/incidents', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const vehicle = db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(req.params.id) as any;
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found' });
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
    `).all(vehicle.id);

    res.json(incidents);
  } catch (error: any) {
    console.error('Get vehicle incidents error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/evidence - List all evidence with incident info
router.get('/evidence', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page = '1', limit = '50', archived } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
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
        total: countRow?.total ?? 0,
        totalPages: limitNum > 0 ? Math.ceil((countRow?.total ?? 0) / limitNum) : 0,
      },
    });
  } catch (error: any) {
    console.error('Get evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/records/evidence/:id - Update evidence
router.put('/evidence/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }

    // Build dynamic SET clause — only update fields explicitly provided
    const eFields: string[] = [];
    const eValues: any[] = [];
    const eBodyKeys = Object.keys(req.body);

    const eFieldMap: Record<string, (v: any) => any> = {
      description: v => v ?? null, evidence_type: v => v ?? null,
      storage_location: v => v ?? null, collected_date: v => v ?? null,
      category: v => v ?? null, packaging_type: v => v ?? null,
      serial_number: v => v ?? null, brand: v => v ?? null, model: v => v ?? null,
      estimated_value: v => v ?? null, dimensions: v => v ?? null, weight: v => v ?? null,
      photo_taken: v => v ? 1 : 0, lab_submitted: v => v ? 1 : 0,
      lab_case_number: v => v ?? null, lab_name: v => v ?? null,
      disposal_method: v => v ?? null, disposal_date: v => v ?? null,
      disposal_authorized_by: v => v ?? null, notes: v => v ?? null,
    };

    for (const [key, transform] of Object.entries(eFieldMap)) {
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
    console.error('Update evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/evidence/:id - Delete evidence
router.delete('/evidence/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found' });
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
    console.error('Delete evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/evidence/:id/archive
router.post('/evidence/:id/archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) { res.status(404).json({ error: 'Evidence not found' }); return; }
    if (evidence.archived_at) { res.status(400).json({ error: 'Evidence is already archived' }); return; }

    const now = localNow();
    const eArchiveTx = db.transaction(() => {
      db.prepare('UPDATE evidence SET archived_at = ? WHERE id = ?').run(now, evidence.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'evidence_archived', 'evidence', ?, ?, ?)`).run(
        req.user!.userId, evidence.id, `Archived evidence: ${evidence.description || 'ID ' + evidence.id}`, req.ip || 'unknown');
    });
    eArchiveTx();

    const updated = db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidence.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Archive evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/evidence/:id/unarchive
router.post('/evidence/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) { res.status(404).json({ error: 'Evidence not found' }); return; }
    if (!evidence.archived_at) { res.status(400).json({ error: 'Evidence is not archived' }); return; }

    const eUnarchiveTx = db.transaction(() => {
      db.prepare('UPDATE evidence SET archived_at = NULL WHERE id = ?').run(evidence.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'evidence_unarchived', 'evidence', ?, ?, ?)`).run(
        req.user!.userId, evidence.id, `Unarchived evidence: ${evidence.description || 'ID ' + evidence.id}`, req.ip || 'unknown');
    });
    eUnarchiveTx();

    const updated = db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidence.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Unarchive evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/evidence/:id/custody - Add chain of custody entry
router.post('/evidence/:id/custody', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) {
      res.status(404).json({ error: 'Evidence not found' });
      return;
    }

    const { action, to_person, from_person, reason } = req.body;
    if (!action || !to_person) {
      res.status(400).json({ error: 'action and to_person are required' });
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
    console.error('Add custody entry error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/evidence/stats — Property room aggregate stats
router.get('/evidence/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    console.error('Evidence stats error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/evidence/locations — Distinct storage locations from system_config
router.get('/evidence/locations', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const locations = db.prepare(`
      SELECT config_key as name, config_value as details
      FROM system_config WHERE category = 'evidence_location' AND is_active = 1
      ORDER BY sort_order
    `).all();
    res.json({ data: locations });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/evidence/:id/chain-action — Enhanced chain-of-custody action
router.post('/evidence/:id/chain-action', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const evidence = db.prepare('SELECT * FROM evidence WHERE id = ?').get(req.params.id) as any;
    if (!evidence) return res.status(404).json({ error: 'Evidence not found' });

    const { action, from_location, to_location, notes } = req.body;
    const validActions = ['check_in', 'check_out', 'transfer', 'lab_submit', 'release', 'dispose'];
    if (!action || !validActions.includes(action)) return res.status(400).json({ error: 'Valid action required' });

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

    db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'evidence', ?, ?, ?, ?)`).run(
      req.user!.userId, `evidence_${action}`, evidence.id, JSON.stringify({ action, to_location }), req.ip || 'unknown', localNow());

    res.json({ data: { id: evidence.id, status: newStatus, chain_of_custody: chain } });
  } catch (error: any) {
    console.error('Evidence chain-action error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/records/properties/:id - Update property
router.put('/properties/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    // Build dynamic SET clause — only update fields explicitly provided
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
      access_instructions: v => v ?? null,
      risk_level: v => v ?? null,
      is_active: v => v ? 1 : 0,
      client_id: v => v || null,
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
    console.error('Update property error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/properties/:id - Delete property
router.delete('/properties/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!property) {
      res.status(404).json({ error: 'Property not found' });
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
    console.error('Delete property error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/properties/:id/archive
router.post('/properties/:id/archive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!prop) { res.status(404).json({ error: 'Property not found' }); return; }
    if (prop.archived_at) { res.status(400).json({ error: 'Property is already archived' }); return; }
    const now = localNow();
    const pArchiveTx = db.transaction(() => {
      db.prepare('UPDATE properties SET archived_at = ? WHERE id = ?').run(now, prop.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'property_archived', 'property', ?, ?, ?)`).run(req.user!.userId, prop.id, `Archived property: ${prop.name}`, req.ip || 'unknown');
    });
    pArchiveTx();
    res.json(db.prepare('SELECT * FROM properties WHERE id = ?').get(prop.id));
  } catch (error: any) { console.error('Archive property error:', error?.message || 'Unknown error'); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/records/properties/:id/unarchive
router.post('/properties/:id/unarchive', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id) as any;
    if (!prop) { res.status(404).json({ error: 'Property not found' }); return; }
    if (!prop.archived_at) { res.status(400).json({ error: 'Property is not archived' }); return; }
    const pUnarchiveTx = db.transaction(() => {
      db.prepare('UPDATE properties SET archived_at = NULL WHERE id = ?').run(prop.id);
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'property_unarchived', 'property', ?, ?, ?)`).run(req.user!.userId, prop.id, `Restored property: ${prop.name}`, req.ip || 'unknown');
    });
    pUnarchiveTx();
    res.json(db.prepare('SELECT * FROM properties WHERE id = ?').get(prop.id));
  } catch (error: any) { console.error('Unarchive property error:', error?.message || 'Unknown error'); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── STANDALONE EVIDENCE CREATION ────────────────────

// POST /api/records/evidence - Create standalone evidence (no incident required)
router.post('/evidence', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      incident_id, description, evidence_type, storage_location,
      collected_date, packaging_type, dimensions, weight,
      photo_taken, lab_submitted, lab_case_number, lab_name,
      disposal_method, disposal_date, disposal_authorized_by,
      serial_number, brand, model, estimated_value, category, notes
    } = req.body;

    if (!description || !evidence_type) {
      res.status(400).json({ error: 'description and evidence_type are required' });
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
      const parsed = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
      if (!isNaN(parsed)) nextNum = parsed + 1;
    }
    const evidenceNumber = `EV-${currentYear}-${String(nextNum).padStart(5, '0')}`;

    const result = db.prepare(`
      INSERT INTO evidence (
        evidence_number, incident_id, description, evidence_type, storage_location, collected_by,
        collected_date, packaging_type, dimensions, weight,
        photo_taken, lab_submitted, lab_case_number, lab_name,
        disposal_method, disposal_date, disposal_authorized_by,
        serial_number, brand, model, estimated_value, category, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidenceNumber, incident_id || null, description, evidence_type,
      storage_location || null, req.user!.userId,
      collected_date || null, packaging_type || null, dimensions || null, weight ?? null,
      photo_taken ? 1 : 0, lab_submitted ? 1 : 0, lab_case_number || null, lab_name || null,
      disposal_method || null, disposal_date || null, disposal_authorized_by || null,
      serial_number || null, brand || null, model || null, estimated_value ?? null, category || null,
      notes || null
    );

    // Activity log
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'evidence_created', 'evidence', ?, ?, ?)
    `).run(req.user!.userId, result.lastInsertRowid, `Created evidence: ${evidenceNumber} - ${description}`, req.ip || 'unknown');

    const created = db.prepare(`
      SELECT e.*, i.incident_number, u.full_name as collected_by_name
      FROM evidence e
      LEFT JOIN incidents i ON e.incident_id = i.id
      LEFT JOIN users u ON e.collected_by = u.id
      WHERE e.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Create evidence error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
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
      case 'case': {
        const c = db.prepare('SELECT case_number, title FROM cases WHERE id = ?').get(id) as any;
        return c ? `${c.case_number} - ${c.title}` : `Case #${id}`;
      }
      case 'incident': {
        const i = db.prepare('SELECT incident_number, incident_type FROM incidents WHERE id = ?').get(id) as any;
        return i ? `${i.incident_number || ''} ${i.incident_type}`.trim() : `Incident #${id}`;
      }
      default:
        return `${type} #${id}`;
    }
  } catch {
    return `${type} #${id}`;
  }
}

// GET /api/records/links - Get all links for an entity (both directions)
router.get('/links', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, id } = req.query;

    if (!type || !id) {
      res.status(400).json({ error: 'type and id query parameters are required' });
      return;
    }

    const links = db.prepare(`
      SELECT rl.*, u.full_name as created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE (rl.source_type = ? AND rl.source_id = ?)
         OR (rl.target_type = ? AND rl.target_id = ?)
      ORDER BY rl.created_at DESC
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
    console.error('Get record links error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/links - Create a record link
router.post('/links', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { source_type, source_id, target_type, target_id, relationship, notes } = req.body;

    if (!source_type || !source_id || !target_type || !target_id) {
      res.status(400).json({ error: 'source_type, source_id, target_type, and target_id are required' });
      return;
    }

    // Prevent self-linking
    if (source_type === target_type && String(source_id) === String(target_id)) {
      res.status(400).json({ error: 'Cannot link a record to itself' });
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
      res.status(409).json({ error: 'This link already exists' });
      return;
    }
    console.error('Create record link error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/links/:id - Remove a record link
router.delete('/links/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM record_links WHERE id = ?').get(req.params.id) as any;
    if (!link) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }

    db.prepare('DELETE FROM record_links WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'record_unlinked', 'record_link', ?, ?, ?)
    `).run(req.user!.userId, link.id, `Removed link between ${link.source_type} #${link.source_id} and ${link.target_type} #${link.target_id}`, req.ip || 'unknown');

    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete record link error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── CLIENTS LIST (for property form) ────────────────

// GET /api/records/clients - Lightweight clients list for dropdowns
router.get('/clients', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const clients = db.prepare(`
      SELECT id, name, status FROM clients ORDER BY name
    `).all();
    res.json(clients);
  } catch (error: any) {
    console.error('Get clients list error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RECORD SEARCH (for linking modal) ──────────────

// GET /api/records/search - Search across record types
router.get('/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    console.error('Record search error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════
// CRIMINAL HISTORY
// ═══════════════════════════════════════════════════

// GET /api/records/persons/:id/criminal-history
router.get('/persons/:id/criminal-history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ch.*, u.first_name || ' ' || u.last_name as created_by_name
      FROM criminal_history ch
      LEFT JOIN users u ON ch.created_by = u.id
      WHERE ch.person_id = ?
      ORDER BY ch.offense_date DESC, ch.created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get criminal history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/persons/:id/criminal-history
router.post('/persons/:id/criminal-history', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
      res.status(400).json({ error: 'Offense is required' });
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
    console.error('Create criminal history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/records/criminal-history/:id
router.put('/criminal-history/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const {
      record_type, offense, offense_level, statute, case_number,
      agency, jurisdiction, offense_date, disposition, disposition_date,
      sentence, source, notes,
    } = req.body;

    db.prepare(`
      UPDATE criminal_history SET
        record_type = COALESCE(?, record_type),
        offense = COALESCE(?, offense),
        offense_level = ?,
        statute = ?,
        case_number = ?,
        agency = ?,
        jurisdiction = ?,
        offense_date = ?,
        disposition = ?,
        disposition_date = ?,
        sentence = ?,
        source = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      record_type, offense, offense_level || null, statute || null,
      case_number || null, agency || null, jurisdiction || null,
      offense_date || null, disposition || null, disposition_date || null,
      sentence || null, source || null, notes || null, localNow(), req.params.id,
    );

    const updated = db.prepare('SELECT * FROM criminal_history WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error: any) {
    console.error('Update criminal history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/criminal-history/:id
router.delete('/criminal-history/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM criminal_history WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Delete criminal history error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════
// CLIENT-PERSON LINKS
// ═══════════════════════════════════════════════════

// GET /api/records/persons/:id/clients - Get all clients linked to a person
router.get('/persons/:id/clients', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get person clients error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/clients/:id/persons - Get all persons linked to a client
router.get('/clients/:id/persons', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
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
    `).all(req.params.id);
    res.json(rows);
  } catch (error: any) {
    console.error('Get client persons error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/records/client-persons - Link a person to a client
router.post('/client-persons', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const user = (req as any).user;
    const { client_id, person_id, relationship, title, notes, is_primary } = req.body;

    if (!client_id || !person_id) {
      return res.status(400).json({ error: 'client_id and person_id are required' });
    }

    // Verify both exist
    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(client_id) as any;
    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!person) return res.status(404).json({ error: 'Person not found' });

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
    if (!link) { res.status(500).json({ error: 'Failed to retrieve created link' }); return; }
    res.status(201).json(link);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE'))) {
      return res.status(409).json({ error: 'This person is already linked to this client' });
    }
    console.error('Link client-person error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/records/client-persons/:id - Update link details
router.put('/client-persons/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare('SELECT * FROM client_persons WHERE id = ?').get(req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Link not found' });

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
    console.error('Update client-person link error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/records/client-persons/:id - Remove link
router.delete('/client-persons/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const link = db.prepare(`
      SELECT cp.*, p.first_name, p.last_name, c.name as client_name
      FROM client_persons cp
      JOIN persons p ON cp.person_id = p.id
      JOIN clients c ON cp.client_id = c.id
      WHERE cp.id = ?
    `).get(req.params.id) as any;
    if (!link) return res.status(404).json({ error: 'Link not found' });

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
    console.error('Delete client-person link error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/persons/:id/invoice-summary - Get billable summary for a person
// Shows all clients they're linked to, incidents for those clients, and invoice history
router.get('/persons/:id/invoice-summary', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(req.params.id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found' });

    // Get linked clients
    const linkedClients = db.prepare(`
      SELECT cp.client_id, cp.relationship, c.name as client_name, c.status as client_status
      FROM client_persons cp
      JOIN clients c ON cp.client_id = c.id
      WHERE cp.person_id = ?
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
    console.error('Person invoice summary error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/records/ncic-query ─────────────────────────────
// NCIC/NLETS query simulation — searches local database and returns
// raw record data for client-side NCIC formatting.
router.get('/ncic-query', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, query: q } = req.query;

    if (!type || !q || (q as string).length < 2) {
      res.status(400).json({ error: 'type and query (min 2 chars) are required' });
      return;
    }

    const searchTerm = `%${q}%`;

    switch (type) {
      case 'person': {
        // Search persons by name
        const persons = db.prepare(`
          SELECT ${PERSON_LIST_COLUMNS} FROM persons
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
          `).all(p.id);

          let warrants: any[] = [];
          try {
            warrants = db.prepare(`
              SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active'
              ORDER BY issue_date DESC
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
          `).all(p.id);

          let warrants: any[] = [];
          try {
            warrants = db.prepare(`
              SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active'
              ORDER BY issue_date DESC
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

        // Also search Utah state warrants (live scraper + local cache)
        let utahResults: any[] = [];
        try {
          utahResults = await searchUtahWarrants(q as string);
        } catch (err) {
          console.warn('[NCIC] Utah warrant search failed:', err);
        }

        res.json({ type: 'warrant', results: warrants, utahResults, query: q });
        break;
      }

      case 'phone': {
        // Search persons by phone number
        const phoneTerm = (q as string).replace(/[^\d]/g, ''); // strip non-digits
        const phoneSearch = `%${phoneTerm}%`;
        const persons = db.prepare(`
          SELECT ${PERSON_LIST_COLUMNS} FROM persons
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
          ORDER BY last_name, first_name
          LIMIT 5
        `).all(phoneSearch) as any[];

        if (persons.length === 0) {
          res.json({ type: 'phone', results: [], query: q });
          return;
        }

        const results = persons.map(p => {
          const criminalHistory = db.prepare(
            'SELECT * FROM criminal_history WHERE person_id = ? ORDER BY offense_date DESC'
          ).all(p.id);
          let warrants: any[] = [];
          try {
            warrants = db.prepare(
              "SELECT * FROM warrants WHERE subject_person_id = ? AND status = 'active' ORDER BY issue_date DESC"
            ).all(p.id);
          } catch { /* warrants table may not exist */ }
          return { person: p, criminalHistory, warrants };
        });

        res.json({ type: 'phone', results, query: q });
        break;
      }

      case 'address': {
        // Address lookup — persons, calls for service, properties, trespass orders
        const addrSearch = searchTerm;

        // Persons at this address
        const addrPersons = db.prepare(`
          SELECT ${PERSON_LIST_COLUMNS} FROM persons
          WHERE address LIKE ? OR (address || ' ' || COALESCE(city,'') || ' ' || COALESCE(state,'') || ' ' || COALESCE(zip,'')) LIKE ?
          ORDER BY last_name, first_name
          LIMIT 10
        `).all(addrSearch, addrSearch) as any[];

        // Add active warrant count per person
        const personsWithWarrants = addrPersons.map(p => {
          let active_warrants = 0;
          try {
            const row = db.prepare(
              "SELECT COUNT(*) as cnt FROM warrants WHERE subject_person_id = ? AND status = 'active'"
            ).get(p.id) as any;
            active_warrants = row?.cnt || 0;
          } catch { /* warrants table may not exist */ }
          return { ...p, active_warrants };
        });

        // Recent calls at this address
        let calls: any[] = [];
        try {
          calls = db.prepare(`
            SELECT call_number, incident_type, priority, disposition, created_at,
              weapons_involved, domestic_violence
            FROM calls_for_service
            WHERE location_address LIKE ?
            ORDER BY created_at DESC
            LIMIT 5
          `).all(addrSearch);
        } catch { /* calls table may not exist */ }

        // Properties matching address
        let properties: any[] = [];
        try {
          properties = db.prepare(`
            SELECT name, address, gate_code, alarm_code, post_orders, hazard_notes
            FROM properties
            WHERE address LIKE ? OR name LIKE ?
            LIMIT 5
          `).all(addrSearch, addrSearch);
        } catch { /* properties table may not exist */ }

        // Active trespass orders at this address
        let trespassOrders: any[] = [];
        try {
          trespassOrders = db.prepare(`
            SELECT order_number, status,
              (subject_first_name || ' ' || subject_last_name) as subject_name,
              expiration_date
            FROM trespass_orders
            WHERE location LIKE ? AND status = 'active'
            ORDER BY created_at DESC
            LIMIT 10
          `).all(addrSearch);
        } catch { /* trespass table may not exist */ }

        res.json({
          type: 'address',
          persons: personsWithWarrants,
          calls,
          properties,
          trespassOrders,
          query: q,
        });
        break;
      }

      default:
        res.status(400).json({ error: 'Invalid type. Use: person, vehicle, warrant, phone, address' });
    }
  } catch (error: any) {
    console.error('NCIC query error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
