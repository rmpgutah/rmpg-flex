// ============================================================
// RMPG Flex — Records Routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/records.ts for Workers runtime.
// Read + write endpoints for persons, vehicles, properties, evidence.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, paramStr, localNow, filterFieldMap } from '../worker-middleware/d1Helpers';

export function mountRecordsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  api.use('/*', authenticateToken);

  // ═══════════════════════════════════════════════════════════
  // PROPERTIES
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/properties - List properties
  api.get('/properties', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { clientId, archived } = c.req.query();

      const conditions: string[] = [];
      const params: any[] = [];

      if (clientId) {
        conditions.push('p.client_id = ?');
        params.push(clientId);
      }

      if (archived === 'true') {
        conditions.push('p.archived_at IS NOT NULL');
      } else if (archived !== 'all') {
        conditions.push('p.archived_at IS NULL');
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const properties = await db.prepare(`
        SELECT p.*, c.name as client_name FROM properties p
        LEFT JOIN clients c ON p.client_id = c.id ${whereClause}
        ORDER BY c.name, p.name LIMIT 1000
      `).all(...params);

      return c.json(properties);
    } catch (err: any) {
      if (err?.message?.includes('no such column')) {
        const db = new D1Db(c.env.DB);
        try {
          const rows = await db.prepare(`
            SELECT p.*, c.name as client_name FROM properties p
            LEFT JOIN clients c ON p.client_id = c.id
            ORDER BY c.name, p.name LIMIT 1000
          `).all();
          return c.json(rows);
        } catch { /* fall through to error */ }
      }
      return c.json({ error: 'Failed to list properties', code: 'PROPERTIES_LIST_ERROR' }, 500);
    }
  });

  // GET /api/records/properties/:id - Get property details
  api.get('/properties/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const property = await db.prepare(`
      SELECT p.*, c.name as client_name, c.contact_name as client_contact,
        c.contact_phone as client_phone, c.sla_response_minutes
      FROM properties p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id = ?
    `).get(id);

    if (!property) return c.json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }, 404);

    const recentCalls = await db.prepare(`SELECT * FROM calls_for_service WHERE property_id = ? ORDER BY created_at DESC LIMIT 10`).all(id);
    const recentIncidents = await db.prepare(`SELECT * FROM incidents WHERE property_id = ? ORDER BY created_at DESC LIMIT 10`).all(id);

    return c.json({ ...property, recent_calls: recentCalls, recent_incidents: recentIncidents });
  });

  // ═══════════════════════════════════════════════════════════
  // CLIENTS
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/clients - List clients for dropdowns
  api.get('/clients', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const clients = await db.prepare(`
        SELECT id, name, status FROM clients ORDER BY name LIMIT 1000
      `).all();
      return c.json(clients);
    } catch (err: any) {
      return c.json({ error: 'Failed to get clients list', code: 'GET_CLIENTS_LIST_ERROR' }, 500);
    }
  });

  // GET /api/records/clients/:id/persons - List persons linked to a client
  api.get('/clients/:id/persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const rows = await db.prepare(`
        SELECT cp.*, p.first_name, p.last_name, p.phone, p.email,
               p.address, p.employer, p.occupation,
               u.full_name as created_by_name
        FROM client_persons cp
        JOIN persons p ON cp.person_id = p.id
        LEFT JOIN users u ON cp.created_by = u.id
        WHERE cp.client_id = ?
        ORDER BY cp.is_primary DESC, p.last_name, p.first_name
        LIMIT 1000
      `).all(id);
      return c.json(rows);
    } catch (err: any) {
      return c.json({ error: 'Failed to get client persons', code: 'GET_CLIENT_PERSONS_ERROR' }, 500);
    }
  });

  // POST /api/records/client-persons - Link a person to a client
  api.post('/client-persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { client_id, person_id, relationship, title, notes, is_primary } = body;

      if (!client_id || !person_id) {
        return c.json({ error: 'client_id and person_id are required', code: 'CLIENTID_AND_PERSONID_ARE' }, 400);
      }

      const client = await db.prepare('SELECT id, name FROM clients WHERE id = ?').get(client_id) as any;
      const person = await db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
      if (!client) return c.json({ error: 'Client not found', code: 'CLIENT_NOT_FOUND' }, 404);
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

      if (is_primary) {
        await db.prepare('UPDATE client_persons SET is_primary = 0 WHERE client_id = ? AND relationship = ?').run(client_id, relationship || 'contact');
      }

      const result = await db.prepare(
        'INSERT INTO client_persons (client_id, person_id, relationship, title, notes, is_primary, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(client_id, person_id, relationship || 'contact', title || null, notes || null, is_primary ? 1 : 0, user.userId);

      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'client_person_linked', 'person', person_id, `Linked person ${person.first_name} ${person.last_name} to client ${client.name} as ${relationship || 'contact'}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      const link = await db.prepare('SELECT * FROM client_persons WHERE id = ?').get(Number(result.meta.last_row_id));
      return c.json(link, 201);
    } catch (err: any) {
      return c.json({ error: err?.message?.includes('UNIQUE') ? 'This person is already linked to this client' : 'Failed to link client-person', code: 'LINK_CLIENTPERSON_ERROR' }, err?.message?.includes('UNIQUE') ? 409 : 500);
    }
  });

  // PUT /api/records/client-persons/:id - Update link details
  api.put('/client-persons/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const link = await db.prepare('SELECT * FROM client_persons WHERE id = ?').get(id) as any;
      if (!link) return c.json({ error: 'Link not found', code: 'LINK_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { relationship, title, notes, is_primary } = body;

      if (is_primary) {
        await db.prepare('UPDATE client_persons SET is_primary = 0 WHERE client_id = ? AND relationship = ? AND id != ?').run(link.client_id, relationship || link.relationship, id);
      }

      await db.prepare(
        'UPDATE client_persons SET relationship = COALESCE(?, relationship), title = COALESCE(?, title), notes = COALESCE(?, notes), is_primary = ? WHERE id = ?'
      ).run(relationship || null, title !== undefined ? title : null, notes !== undefined ? notes : null, is_primary ? 1 : 0, id);

      const updated = await db.prepare('SELECT * FROM client_persons WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to update client-person link', code: 'UPDATE_CLIENTPERSON_LINK_ERROR' }, 500);
    }
  });

  // DELETE /api/records/client-persons/:id - Remove link
  api.delete('/client-persons/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const link = await db.prepare(`
        SELECT cp.*, p.first_name, p.last_name, c.name as client_name
        FROM client_persons cp
        JOIN persons p ON cp.person_id = p.id
        JOIN clients c ON cp.client_id = c.id
        WHERE cp.id = ?
      `).get(id) as any;
      if (!link) return c.json({ error: 'Link not found', code: 'LINK_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM client_persons WHERE id = ?').run(id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'client_person_unlinked', 'person', link.person_id, `Unlinked person ${link.first_name} ${link.last_name} from client ${link.client_name}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json({ message: 'Link removed' });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete client-person link', code: 'DELETE_CLIENTPERSON_LINK_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // PERSONS
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/persons - List persons
  api.get('/persons', async (c) => {
    const { page = '1', limit = '100000', flags, archived } = c.req.query();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;
    try {
      const db = new D1Db(c.env.DB);

      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (flags) {
        whereClause += ' AND flags LIKE ?';
        params.push(`%"${flags}"%`);
      }

      if (archived === 'true') {
        whereClause += ' AND archived_at IS NOT NULL';
      } else if (archived !== 'all') {
        whereClause += ' AND archived_at IS NULL';
      }

      const countRow = await db.prepare(`SELECT COUNT(*) as total FROM persons ${whereClause}`).get(...params) as any;
      const persons = await db.prepare(`
        SELECT * FROM persons ${whereClause}
        ORDER BY last_name, first_name
        LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);

      return c.json({
        data: persons,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: countRow?.total ?? 0,
          totalPages: Math.ceil((countRow?.total ?? 0) / limitNum),
        },
      });
    } catch (err: any) {
      if (err?.message?.includes('no such column') && archived !== 'all') {
        try {
          const db2 = new D1Db(c.env.DB);
          const cleanWhere = 'WHERE 1=1' + (flags ? ' AND flags LIKE ?' : '');
          const cleanParams = flags ? [`%"${flags}"%`] : [];
          const countRow2 = await db2.prepare(`SELECT COUNT(*) as total FROM persons ${cleanWhere}`).get(...cleanParams) as any;
          const persons2 = await db2.prepare(`
            SELECT * FROM persons ${cleanWhere}
            ORDER BY last_name, first_name
            LIMIT ? OFFSET ?
          `).all(...cleanParams, limitNum, offset);
          return c.json({
            data: persons2,
            pagination: {
              page: pageNum, limit: limitNum,
              total: countRow2?.total ?? 0,
              totalPages: Math.ceil((countRow2?.total ?? 0) / limitNum),
            },
          });
        } catch { /* fall through */ }
      }
      console.error('Get persons error:', err);
      return c.json({ error: 'Failed to get persons', code: 'GET_PERSONS_ERROR' }, 500);
    }
  });

  // GET /api/records/persons/:id - Get person details
  api.get('/persons/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
    if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);
    return c.json(person);
  });

  // POST /api/records/persons/check-duplicates - Check for duplicate persons
  api.post('/persons/check-duplicates', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { first_name, last_name, dob } = body;

      const conditions: string[] = [];
      const params: any[] = [];

      if (first_name) {
        conditions.push('LOWER(first_name) = LOWER(?)');
        params.push(first_name);
      }
      if (last_name) {
        conditions.push('LOWER(last_name) = LOWER(?)');
        params.push(last_name);
      }
      if (dob) {
        conditions.push('dob = ?');
        params.push(dob);
      }

      if (conditions.length === 0) {
        return c.json({ matches: [] });
      }

      const matches = await db.prepare(`
        SELECT id, first_name, last_name, dob, address, dl_number
        FROM persons WHERE ${conditions.join(' AND ')}
        ORDER BY last_name, first_name LIMIT 20
      `).all(...params);

      return c.json({ matches });
    } catch (err: any) {
      return c.json({ error: 'Failed to check duplicates', code: 'CHECK_DUPLICATES_ERROR' }, 500);
    }
  });

  const PERSON_FIELD_MAP: Record<string, (v: any) => any> = {
    // Core identity
    first_name: v => v ?? null, last_name: v => v ?? null,
    middle_name: v => v ?? null, alias_nickname: v => v ?? null,
    alias_dob: v => v ?? null, suffix: v => v ?? null,
    dob: v => v ?? null, gender: v => v ?? null, race: v => v ?? null,
    sex: v => v ?? null,
    // Physical description
    height: v => v ?? null,
    height_feet: v => v != null && v !== '' ? parseInt(String(v), 10) : null,
    height_inches: v => v != null && v !== '' ? parseInt(String(v), 10) : null,
    weight: v => v ?? null, build: v => v ?? null, complexion: v => v ?? null,
    hair_color: v => v ?? null, eye_color: v => v ?? null,
    hair_length: v => v ?? null, hair_style: v => v ?? null,
    facial_hair: v => v ?? null, glasses: v => v ?? null,
    shoe_size: v => v ?? null, blood_type: v => v ?? null,
    scars_marks_tattoos: v => v ?? null,
    tattoo_description: v => v ?? null, scar_description: v => v ?? null,
    piercing_description: v => v ?? null,
    distinguishing_features: v => v ?? null,
    identifying_marks_location: v => v ?? null,
    clothing_description: v => v ?? null,
    // Contact
    address: v => v ?? null, city: v => v ?? null, state: v => v ?? null,
    zip: v => v ?? null, phone: v => v ?? null, phone_secondary: v => v ?? null,
    home_phone: v => v ?? null, work_phone: v => v ?? null,
    email: v => v ?? null, email_secondary: v => v ?? null,
    // Identification documents
    dl_number: v => v ?? null, dl_state: v => v ?? null,
    dl_class: v => v ?? null, dl_expiry: v => v ?? null,
    ssn_full: v => v ?? null, ssn_last4: v => v ?? null,
    id_type: v => v ?? null, id_number: v => v ?? null,
    id_state: v => v ?? null, id_expiry: v => v ?? null,
    id_image_url: v => v ?? null, photo_url: v => v ?? null,
    ncic_number: v => v ?? null, sor_number: v => v ?? null,
    fbi_number: v => v ?? null, state_id_number: v => v ?? null,
    passport_number: v => v ?? null, passport_country: v => v ?? null,
    // Employment
    employer: v => v ?? null, occupation: v => v ?? null,
    // Demographics
    language: v => v ?? null, place_of_birth: v => v ?? null,
    citizenship: v => v ?? null, nationality: v => v ?? null,
    marital_status: v => v ?? null, education_level: v => v ?? null,
    // Social / online
    social_media: v => v ?? null,
    // Emergency contact
    emergency_contact_name: v => v ?? null,
    emergency_contact_phone: v => v ?? null,
    emergency_contact_relationship: v => v ?? null,
    // Law enforcement / flags
    gang_affiliation: v => v ?? null,
    probation_parole: v => v ?? null,
    probation_parole_officer: v => v ?? null,
    known_associates: v => v ?? null,
    caution_flags: v => v ?? null,
    is_sex_offender: v => v ? 1 : 0, is_veteran: v => v ? 1 : 0,
    date_last_seen: v => v ?? null, location_last_seen: v => v ?? null,
    // Military / legal
    military_branch: v => v ?? null, military_status: v => v ?? null,
    tribal_affiliation: v => v ?? null,
    immigration_status: v => v ?? null,
    disability_flags: v => v ?? null, mental_health_flags: v => v ?? null,
    substance_abuse: v => v ?? null, medication_notes: v => v ?? null,
    // Misc
    identifiers: v => v ?? null, mugshot_url: v => v ?? null,
    aka_names: v => v ?? null, employment: v => v ?? null,
    aliases: v => v ?? null,
    physical_marks: v => v ?? null,
    education: v => v ?? null,
    caution: v => v ?? null, caution_reason: v => v ?? null,
    notes: v => v ?? null,
  };

  // POST /api/records/persons — Create person
  api.post('/persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();

      if (!body.first_name || !body.last_name) {
        return c.json({ error: 'first_name and last_name are required', code: 'FIRSTNAME_AND_LASTNAME_ARE' }, 400);
      }

      const { columns, placeholders, values } = await filterFieldMap(db, 'persons', PERSON_FIELD_MAP, body, {
        flags: v => JSON.stringify(v ?? []),
      });

      const now = localNow();
      columns.push('created_at', 'updated_at');
      placeholders.push('?', '?');
      values.push(now, now);

      const result = await db.prepare(
        `INSERT INTO persons (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
      ).run(...values);

      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(result.meta.last_row_id);
      return c.json(person, 201);
    } catch (err: any) {
      console.error('Create person error:', err);
      return c.json({ error: 'Failed to create person', code: 'CREATE_PERSON_ERROR' }, 500);
    }
  });

  // PUT /api/records/persons/:id — Update person
  api.put('/persons/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { setClauses, values } = await filterFieldMap(db, 'persons', PERSON_FIELD_MAP, body, {
        flags: v => JSON.stringify(v ?? []),
      });

      if (setClauses.length > 0) {
        setClauses.push('updated_at = ?');
        values.push(localNow());
        values.push(id);
        await db.prepare(`UPDATE persons SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
      }

      const updated = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      console.error('Update person error:', err);
      return c.json({ error: 'Failed to update person', code: 'UPDATE_PERSON_ERROR' }, 500);
    }
  });

  // DELETE /api/records/persons/:id — Delete person
  api.delete('/persons/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

      const user = c.get('user');
      await db.prepare('DELETE FROM persons WHERE id = ?').run(id);
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'person_deleted', 'person', id, `Deleted person: ${person.first_name} ${person.last_name} (ID ${id})`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json({ success: true, id });
    } catch (err: any) {
      console.error('Delete person error:', err);
      return c.json({ error: 'Failed to delete person', code: 'DELETE_PERSON_ERROR' }, 500);
    }
  });

  // POST /api/records/persons/:id/archive — Archive person
  api.post('/persons/:id/archive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('persons');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);
      if (person.archived_at) return c.json({ error: 'Person is already archived', code: 'PERSON_ALREADY_ARCHIVED' }, 400);

      const now = localNow();
      await db.prepare('UPDATE persons SET archived_at = ? WHERE id = ?').run(now, id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'person_archived', 'person', id, `Archived person: ${person.first_name} ${person.last_name}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM persons WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Archive person error:', err);
      return c.json({ error: 'Failed to archive person', code: 'ARCHIVE_PERSON_ERROR' }, 500);
    }
  });

  // POST /api/records/persons/:id/unarchive — Unarchive person
  api.post('/persons/:id/unarchive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('persons');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);
      if (!person.archived_at) return c.json({ error: 'Person is not archived', code: 'PERSON_NOT_ARCHIVED' }, 400);

      await db.prepare('UPDATE persons SET archived_at = NULL WHERE id = ?').run(id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'person_unarchived', 'person', id, `Unarchived person: ${person.first_name} ${person.last_name}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM persons WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Unarchive person error:', err);
      return c.json({ error: 'Failed to unarchive person', code: 'UNARCHIVE_PERSON_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // SYSTEM HISTORY
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/persons/:id/system-history — Aggregated system history for a person
  api.get('/persons/:id/system-history', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as any;
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

      const [warrants, incidents, citations] = await Promise.all([
        db.prepare(`
          SELECT id, warrant_number, type, status, charge_description,
            offense_level, statute_citation, created_at as date_issued, expires_at
          FROM warrants WHERE subject_person_id = ?
          ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1000
        `).all(id).catch(() => []),
        db.prepare(`
          SELECT i.id, i.incident_number, i.incident_type, i.status, i.priority,
            i.narrative as description, i.created_at, ip.role
          FROM incident_persons ip JOIN incidents i ON ip.incident_id = i.id
          WHERE ip.person_id = ? ORDER BY i.created_at DESC LIMIT 1000
        `).all(id).catch(() => []),
        db.prepare(`
          SELECT id, citation_number, type, status, statute_citation,
            violation_description, offense_level, fine_amount,
            violation_date, violation_time, location,
            issuing_officer_name, court_date, court_name
          FROM citations WHERE person_id = ?
          ORDER BY CASE WHEN status = 'issued' THEN 0 WHEN status = 'contested' THEN 1 ELSE 2 END,
            violation_date DESC LIMIT 1000
        `).all(id).catch(() => []),
      ]);

      let calls: any[] = [];
      try {
        calls = await db.prepare(`
          SELECT DISTINCT c.id, c.call_number, c.incident_type, c.priority,
            c.status, c.location_address as location, c.created_at
          FROM incident_persons ip JOIN incidents i ON ip.incident_id = i.id
          JOIN calls_for_service c ON i.call_id = c.id
          WHERE ip.person_id = ? AND i.call_id IS NOT NULL
          ORDER BY c.created_at DESC LIMIT 1000
        `).all(id);
      } catch { /* non-fatal */ }

      let bolo_active = false;
      try {
        const flags = (person as any).flags ? JSON.parse((person as any).flags) : [];
        bolo_active = Array.isArray(flags) && flags.some((f: string) => typeof f === 'string' && f.toLowerCase() === 'bolo');
      } catch { /* ignore */ }

      const activeWarrants = (warrants as any[]).filter((w: any) => w.status === 'active').length;
      const activeCitations = (citations as any[]).filter((c: any) => c.status === 'issued' || c.status === 'contested').length;

      return c.json({
        warrants, incidents, calls, citations, bolo_active,
        summary: {
          total_warrants: (warrants as any[]).length,
          active_warrants: activeWarrants,
          total_incidents: (incidents as any[]).length,
          total_calls: calls.length,
          total_citations: (citations as any[]).length,
          active_citations: activeCitations,
        },
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to get person system-history', code: 'GET_PERSON_SYSTEMHISTORY_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // CRIMINAL HISTORY
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/persons/:id/criminal-history
  api.get('/persons/:id/criminal-history', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const rows = await db.prepare(`
        SELECT ch.*, u.first_name || ' ' || u.last_name as created_by_name
        FROM criminal_history ch LEFT JOIN users u ON ch.created_by = u.id
        WHERE ch.person_id = ? ORDER BY ch.offense_date DESC, ch.created_at DESC LIMIT 1000
      `).all(id);
      return c.json(rows);
    } catch (err: any) {
      return c.json({ error: 'Failed to get criminal history', code: 'GET_CRIMINAL_HISTORY_ERROR' }, 500);
    }
  });

  // POST /api/records/persons/:id/criminal-history
  api.post('/persons/:id/criminal-history', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const personId = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const { record_type, offense, offense_level, statute, case_number, agency, jurisdiction, offense_date, disposition, disposition_date, sentence, source, notes } = body;

      if (!offense) return c.json({ error: 'Offense is required', code: 'OFFENSE_IS_REQUIRED' }, 400);

      const result = await db.prepare(`
        INSERT INTO criminal_history (person_id, record_type, offense, offense_level, statute, case_number,
          agency, jurisdiction, offense_date, disposition, disposition_date, sentence, source, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(personId, record_type || 'other', offense, offense_level || null, statute || null,
        case_number || null, agency || null, jurisdiction || null, offense_date || null,
        disposition || null, disposition_date || null, sentence || null, source || null, notes || null, user.userId);

      const newRecord = await db.prepare('SELECT * FROM criminal_history WHERE id = ?').get(Number(result.meta?.last_row_id || result.meta?.changes || 0));
      return c.json(newRecord, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to create criminal history', code: 'CREATE_CRIMINAL_HISTORY_ERROR' }, 500);
    }
  });

  // PUT /api/records/criminal-history/:id
  api.put('/criminal-history/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const body = await c.req.json();
      const fieldMap: Record<string, (v: any) => any> = {
        record_type: v => v ?? null, offense: v => v ?? null, offense_level: v => v ?? null,
        statute: v => v ?? null, case_number: v => v ?? null, agency: v => v ?? null,
        jurisdiction: v => v ?? null, offense_date: v => v ?? null, disposition: v => v ?? null,
        disposition_date: v => v ?? null, sentence: v => v ?? null, source: v => v ?? null, notes: v => v ?? null,
      };
      const sets: string[] = [];
      const values: any[] = [];
      for (const [key, transform] of Object.entries(fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          sets.push(`${key} = ?`);
          values.push(transform(body[key]));
        }
      }
      if (sets.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);
      sets.push("updated_at = datetime('now','localtime')");
      values.push(id);
      await db.prepare(`UPDATE criminal_history SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      const updated = await db.prepare('SELECT * FROM criminal_history WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ error: 'Failed to update criminal history', code: 'UPDATE_CRIMINAL_HISTORY_ERROR' }, 500);
    }
  });

  // DELETE /api/records/criminal-history/:id
  api.delete('/criminal-history/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      await db.prepare('DELETE FROM criminal_history WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete criminal history', code: 'DELETE_CRIMINAL_HISTORY_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // CLIENT-PERSON LINKS (person → clients direction)
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/persons/:id/clients
  api.get('/persons/:id/clients', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const rows = await db.prepare(`
        SELECT cp.*, c.name as client_name, c.contact_name, c.contact_phone,
          c.status as client_status, c.address as client_address,
          u.full_name as created_by_name
        FROM client_persons cp JOIN clients c ON cp.client_id = c.id
        LEFT JOIN users u ON cp.created_by = u.id
        WHERE cp.person_id = ? ORDER BY cp.is_primary DESC, c.name LIMIT 1000
      `).all(id);
      return c.json(rows);
    } catch (err: any) {
      return c.json({ error: 'Failed to get person clients', code: 'GET_PERSON_CLIENTS_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // RECORD LINKS
  // ═══════════════════════════════════════════════════════════

  async function getRecordLabel(db: D1Db, type: string, id: number): Promise<string> {
    try {
      switch (type) {
        case 'person': {
          const p = await db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(id) as any;
          return p ? `${p.first_name} ${p.last_name}` : `Person #${id}`;
        }
        case 'vehicle': {
          const v = await db.prepare('SELECT make, model, plate_number FROM vehicles_records WHERE id = ?').get(id) as any;
          return v ? `${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() : `Vehicle #${id}`;
        }
        case 'property': {
          const pr = await db.prepare('SELECT name FROM properties WHERE id = ?').get(id) as any;
          return pr ? pr.name : `Property #${id}`;
        }
        case 'evidence': {
          const e = await db.prepare('SELECT evidence_number, description FROM evidence WHERE id = ?').get(id) as any;
          return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() : `Evidence #${id}`;
        }
        default:
          return `${type} #${id}`;
      }
    } catch {
      return `${type} #${id}`;
    }
  }

  // GET /api/records/links
  api.get('/links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const type = c.req.query('type');
      const idStr = c.req.query('id');
      if (!type || !idStr) return c.json({ error: 'type and id query parameters are required', code: 'TYPE_AND_ID_QUERY' }, 400);
      const id = parseInt(idStr, 10);
      if (isNaN(id)) return c.json({ error: 'Invalid id parameter', code: 'INVALID_ID_PARAM' }, 400);

      const links = await db.prepare(`
        SELECT rl.*, u.full_name as created_by_name
        FROM record_links rl LEFT JOIN users u ON rl.created_by = u.id
        WHERE (rl.source_type = ? AND rl.source_id = ?) OR (rl.target_type = ? AND rl.target_id = ?)
        ORDER BY rl.created_at DESC LIMIT 1000
      `).all(type, id, type, id) as any[];

      const enriched = await Promise.all((links as any[]).map(async (link: any) => {
        const isSource = link.source_type === type && String(link.source_id) === String(id);
        const linkedType = isSource ? link.target_type : link.source_type;
        const linkedId = isSource ? link.target_id : link.source_id;
        return { ...link, linked_type: linkedType, linked_id: linkedId, linked_label: await getRecordLabel(db, linkedType, linkedId) };
      }));

      return c.json(enriched);
    } catch (err: any) {
      return c.json({ error: 'Failed to get record links', code: 'GET_RECORD_LINKS_ERROR' }, 500);
    }
  });

  // POST /api/records/links
  api.post('/links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();
      const { source_type, source_id, target_type, target_id, relationship, notes } = body;

      if (!source_type || !source_id || !target_type || !target_id) {
        return c.json({ error: 'source_type, source_id, target_type, and target_id are required', code: 'SOURCETYPE_SOURCEID_TARGETTYPE_AND' }, 400);
      }
      if (source_type === target_type && String(source_id) === String(target_id)) {
        return c.json({ error: 'Cannot link a record to itself', code: 'CANNOT_LINK_A_RECORD' }, 400);
      }

      const result = await db.prepare(`
        INSERT INTO record_links (source_type, source_id, target_type, target_id, relationship, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(source_type, source_id, target_type, target_id, relationship || 'associated', notes || null, user.userId);

      const linkId = Number(result.meta?.last_row_id || result.meta?.changes || 0);

      const sourceLabel = await getRecordLabel(db, source_type, source_id);
      const targetLabel = await getRecordLabel(db, target_type, target_id);
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'record_linked', 'record_link', linkId,
        `Linked ${source_type} "${sourceLabel}" to ${target_type} "${targetLabel}"`,
        c.req.header('x-forwarded-for') || 'unknown', localNow());

      const created = await db.prepare(`
        SELECT rl.*, u.full_name as created_by_name
        FROM record_links rl LEFT JOIN users u ON rl.created_by = u.id WHERE rl.id = ?
      `).get(linkId);
      return c.json(created, 201);
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'This link already exists', code: 'THIS_LINK_ALREADY_EXISTS' }, 409);
      }
      return c.json({ error: 'Failed to create record link', code: 'CREATE_RECORD_LINK_ERROR' }, 500);
    }
  });

  // DELETE /api/records/links/:id
  api.delete('/links/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      const link = await db.prepare('SELECT * FROM record_links WHERE id = ?').get(id) as any;
      if (!link) return c.json({ error: 'Link not found', code: 'LINK_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM record_links WHERE id = ?').run(id);
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'record_unlinked', 'record_link', id,
        `Removed link between ${link.source_type} #${link.source_id} and ${link.target_type} #${link.target_id}`,
        c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to delete record link', code: 'DELETE_RECORD_LINK_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // VEHICLES
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/vehicles - List vehicles
  api.get('/vehicles', async (c) => {
    const { page = '1', limit = '100000', archived } = c.req.query();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;
    try {
      const db = new D1Db(c.env.DB);

      let whereClause = 'WHERE 1=1';
      if (archived === 'true') {
        whereClause += ' AND v.archived_at IS NOT NULL';
      } else if (archived !== 'all') {
        whereClause += ' AND v.archived_at IS NULL';
      }

      const countRow = await db.prepare(`SELECT COUNT(*) as total FROM vehicles_records v ${whereClause}`).get() as any;

      const vehicles = await db.prepare(`
        SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
        FROM vehicles_records v
        LEFT JOIN persons p ON v.owner_person_id = p.id
        ${whereClause}
        ORDER BY v.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limitNum, offset);

      return c.json({
        data: vehicles,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: countRow?.total ?? 0,
          totalPages: Math.ceil((countRow?.total ?? 0) / limitNum),
        },
      });
    } catch (err: any) {
      if (err?.message?.includes('no such column') && archived !== 'all') {
        try {
          const db2 = new D1Db(c.env.DB);
          const cleanWhere = 'WHERE 1=1';
          const countRow2 = await db2.prepare(`SELECT COUNT(*) as total FROM vehicles_records v ${cleanWhere}`).get() as any;
          const vehicles2 = await db2.prepare(`
            SELECT v.*, p.first_name as owner_first_name, p.last_name as owner_last_name
            FROM vehicles_records v
            LEFT JOIN persons p ON v.owner_person_id = p.id
            ${cleanWhere}
            ORDER BY v.created_at DESC
            LIMIT ? OFFSET ?
          `).all(limitNum, offset);
          return c.json({
            data: vehicles2,
            pagination: { page: pageNum, limit: limitNum, total: countRow2?.total ?? 0, totalPages: Math.ceil((countRow2?.total ?? 0) / limitNum) },
          });
        } catch { /* fall through */ }
      }
      console.error('Get vehicles error:', err);
      return c.json({ error: 'Failed to get vehicles', code: 'GET_VEHICLES_ERROR' }, 500);
    }
  });

  // GET /api/records/vehicles/:id - Get vehicle details
  api.get('/vehicles/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const vehicle = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id);
    if (!vehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
    return c.json(vehicle);
  });

  // GET /api/records/vehicles/:id/incidents - Get incidents linked to vehicle
  api.get('/vehicles/:id/incidents', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const incidents = await db.prepare(`
        SELECT i.*, l.role FROM incidents i
        JOIN incident_vehicles l ON i.id = l.incident_id
        WHERE l.vehicle_id = ?
        ORDER BY i.created_at DESC LIMIT 50
      `).all(id);
      return c.json(incidents);
    } catch (err: any) {
      return c.json({ error: 'Failed to get vehicle incidents', code: 'VEHICLE_INCIDENTS_ERROR' }, 500);
    }
  });

  const VEHICLE_FIELD_MAP: Record<string, (v: any) => any> = {
    plate_number: v => v ?? null, state: v => v ?? null,
    make: v => v ?? null, model: v => v ?? null, year: v => v ?? null,
    color: v => v ?? null, secondary_color: v => v ?? null,
    body_style: v => v ?? null, doors: v => v ?? null, vin: v => v ?? null,
    owner_person_id: v => v ?? null,
    insurance_company: v => v ?? null, insurance_policy: v => v ?? null,
    insurance_expiry: v => v ?? null, registration_expiry: v => v ?? null,
    registration_state: v => v ?? null, damage_description: v => v ?? null,
    distinguishing_features: v => v ?? null, trim: v => v ?? null,
    engine_type: v => v ?? null, fuel_type: v => v ?? null,
    transmission: v => v ?? null, drive_type: v => v ?? null,
    tow_status: v => v ?? null, tow_company: v => v ?? null,
    tow_date: v => v ?? null, tow_location: v => v ?? null,
    plate_type: v => v ?? null, commercial_vehicle: v => v ? 1 : 0,
    hazmat: v => v ? 1 : 0, odometer: v => v ?? null,
    owner_address: v => v ?? null, owner_phone: v => v ?? null,
    owner_name: v => v ?? null, owner_dl_number: v => v ?? null,
    owner_dob: v => v ?? null, primary_driver_name: v => v ?? null,
    registered_owner: v => v ?? null, lien_holder: v => v ?? null,
    stolen_status: v => v ?? null, stolen_date: v => v ?? null,
    recovery_date: v => v ?? null, title_status: v => v ?? null,
    exterior_condition: v => v ?? null, interior_condition: v => v ?? null,
    estimated_value: v => v ?? null, window_tint: v => v ?? null,
    modifications: v => v ?? null, equipment_notes: v => v ?? null,
    vehicle_use: v => v ?? null, ncic_entry_number: v => v ?? null,
    notes: v => v ?? null,
  };

  // POST /api/records/vehicles — Create vehicle
  api.post('/vehicles', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { columns, placeholders, values } = await filterFieldMap(db, 'vehicles_records', VEHICLE_FIELD_MAP, body, {
        flags: v => JSON.stringify(v ?? []),
      });

      const now = localNow();
      columns.push('created_at', 'updated_at');
      placeholders.push('?', '?');
      values.push(now, now);

      const result = await db.prepare(
        `INSERT INTO vehicles_records (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
      ).run(...values);

      const vehicle = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(result.meta.last_row_id);
      return c.json(vehicle, 201);
    } catch (err: any) {
      console.error('Create vehicle error:', err);
      return c.json({ error: 'Failed to create vehicle', code: 'CREATE_VEHICLE_ERROR' }, 500);
    }
  });

  // PUT /api/records/vehicles/:id — Update vehicle
  api.put('/vehicles/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { setClauses, values } = await filterFieldMap(db, 'vehicles_records', VEHICLE_FIELD_MAP, body, {
        flags: v => JSON.stringify(v ?? []),
      });

      if (setClauses.length > 0) {
        setClauses.push('updated_at = ?');
        values.push(localNow());
        values.push(id);
        await db.prepare(`UPDATE vehicles_records SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
      }

      const updated = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      console.error('Update vehicle error:', err);
      return c.json({ error: 'Failed to update vehicle', code: 'UPDATE_VEHICLE_ERROR' }, 500);
    }
  });

  // DELETE /api/records/vehicles/:id — Delete vehicle
  api.delete('/vehicles/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const v = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id) as any;
      if (!v) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);

      const user = c.get('user');
      await db.prepare('DELETE FROM vehicles_records WHERE id = ?').run(id);
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'vehicle_deleted', 'vehicle', id, `Deleted vehicle: ${v.plate_number || v.vin || 'ID ' + id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json({ success: true, id });
    } catch (err: any) {
      console.error('Delete vehicle error:', err);
      return c.json({ error: 'Failed to delete vehicle', code: 'DELETE_VEHICLE_ERROR' }, 500);
    }
  });

  // POST /api/records/vehicles/:id/archive — Archive vehicle
  api.post('/vehicles/:id/archive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('vehicles_records');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const v = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id) as any;
      if (!v) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      if (v.archived_at) return c.json({ error: 'Vehicle is already archived', code: 'VEHICLE_ALREADY_ARCHIVED' }, 400);

      const now = localNow();
      await db.prepare('UPDATE vehicles_records SET archived_at = ? WHERE id = ?').run(now, id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'vehicle_archived', 'vehicle', id, `Archived vehicle: ${v.plate_number || v.vin || 'ID ' + id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Archive vehicle error:', err);
      return c.json({ error: 'Failed to archive vehicle', code: 'ARCHIVE_VEHICLE_ERROR' }, 500);
    }
  });

  // POST /api/records/vehicles/:id/unarchive — Unarchive vehicle
  api.post('/vehicles/:id/unarchive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('vehicles_records');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const v = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id) as any;
      if (!v) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
      if (!v.archived_at) return c.json({ error: 'Vehicle is not archived', code: 'VEHICLE_NOT_ARCHIVED' }, 400);

      await db.prepare('UPDATE vehicles_records SET archived_at = NULL WHERE id = ?').run(id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'vehicle_unarchived', 'vehicle', id, `Unarchived vehicle: ${v.plate_number || v.vin || 'ID ' + id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Unarchive vehicle error:', err);
      return c.json({ error: 'Failed to unarchive vehicle', code: 'UNARCHIVE_VEHICLE_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // PROPERTIES (write)
  // ═══════════════════════════════════════════════════════════

  // POST /api/records/properties — Create property
  api.post('/properties', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();

      if (!body.client_id) return c.json({ error: 'client_id is required', code: 'CLIENTID_IS_REQUIRED' }, 400);
      if (!body.name || !body.address) return c.json({ error: 'name and address are required', code: 'NAME_AND_ADDRESS_ARE' }, 400);

      const columns: string[] = ['client_id', 'name', 'address'];
      const placeholders: string[] = ['?', '?', '?'];
      const values: any[] = [body.client_id, body.name, body.address];

      const PROPERTY_FIELDS: Record<string, (v: any) => any> = {
        city: v => v ?? null, state: v => v ?? null, zip: v => v ?? null,
        latitude: v => v ?? null, longitude: v => v ?? null,
        property_type: v => v ?? null, gate_code: v => v ?? null,
        alarm_code: v => v ?? null, emergency_contact: v => v ?? null,
        post_orders: v => v ?? null, hazard_notes: v => v ?? null,
        access_instructions: v => v ?? null, notes: v => v ?? null,
        is_active: v => v ? 1 : 0,
        business_type: v => v ?? null, structure_type: v => v ?? null,
        occupancy_status: v => v ?? null, year_built: v => v ?? null,
        square_footage: v => v ?? null, number_of_stories: v => v ?? null,
        security_features: v => v ?? null, key_holder_name: v => v ?? null,
        key_holder_phone: v => v ?? null,
        key_holder_relationship: v => v ?? null, owner_name: v => v ?? null,
        owner_phone: v => v ?? null, last_inspection_date: v => v ?? null,
        inspection_status: v => v ?? null,
        alarm_company: v => v ?? null, alarm_account: v => v ?? null,
        camera_system: v => v ?? null,
        parking_info: v => v ?? null, roof_access: v => v ?? null,
        utility_shutoffs: v => v ?? null, known_hazards: v => v ?? null,
        contact_email: v => v ?? null,
        secondary_contact_name: v => v ?? null,
        secondary_contact_phone: v => v ?? null,
        patrol_frequency: v => v ?? null,
        opening_hours: v => v ?? null, closing_hours: v => v ?? null,
      };

      const existingCols = await db.getColumns('properties');
      for (const [key, transform] of Object.entries(PROPERTY_FIELDS)) {
        if (Object.keys(body).includes(key) && existingCols.has(key)) {
          columns.push(key);
          placeholders.push('?');
          values.push(transform(body[key]));
        }
      }

      const now = localNow();
      if (existingCols.has('created_at') && existingCols.has('updated_at')) {
        columns.push('created_at', 'updated_at');
        placeholders.push('?', '?');
        values.push(now, now);
      }

      const result = await db.prepare(
        `INSERT INTO properties (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
      ).run(...values);

      const property = await db.prepare(`
        SELECT p.*, c.name as client_name
        FROM properties p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id = ?
      `).get(result.meta.last_row_id);

      return c.json(property, 201);
    } catch (err: any) {
      console.error('Create property error:', err);
      return c.json({ error: 'Failed to create property', code: 'CREATE_PROPERTY_ERROR' }, 500);
    }
  });

  // PUT /api/records/properties/:id — Update property
  api.put('/properties/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const pFieldMap: Record<string, (v: any) => any> = {
        name: v => v ?? null, address: v => v ?? null,
        city: v => v ?? null, state: v => v ?? null, zip: v => v ?? null,
        latitude: v => v ?? null, longitude: v => v ?? null,
        property_type: v => v ?? null, gate_code: v => v ?? null,
        alarm_code: v => v ?? null, emergency_contact: v => v ?? null,
        post_orders: v => v ?? null, hazard_notes: v => v ?? null,
        access_instructions: v => v ?? null, notes: v => v ?? null,
        is_active: v => v ? 1 : 0, client_id: v => v || null,
        business_type: v => v ?? null, structure_type: v => v ?? null,
        occupancy_status: v => v ?? null, year_built: v => v ?? null,
        square_footage: v => v ?? null, number_of_stories: v => v ?? null,
        security_features: v => v ?? null, key_holder_name: v => v ?? null,
        key_holder_phone: v => v ?? null,
        key_holder_relationship: v => v ?? null, owner_name: v => v ?? null,
        owner_phone: v => v ?? null, last_inspection_date: v => v ?? null,
        inspection_status: v => v ?? null,
        alarm_company: v => v ?? null, alarm_account: v => v ?? null,
        camera_system: v => v ?? null,
        parking_info: v => v ?? null, roof_access: v => v ?? null,
        utility_shutoffs: v => v ?? null, known_hazards: v => v ?? null,
        contact_email: v => v ?? null,
        secondary_contact_name: v => v ?? null,
        secondary_contact_phone: v => v ?? null,
        patrol_frequency: v => v ?? null,
        opening_hours: v => v ?? null, closing_hours: v => v ?? null,
      };

      const existingCols = await db.getColumns('properties');
      const pFields: string[] = [];
      const pValues: any[] = [];
      const pBodyKeys = Object.keys(body);

      for (const [key, transform] of Object.entries(pFieldMap)) {
        if (pBodyKeys.includes(key) && existingCols.has(key)) {
          pFields.push(`${key} = ?`);
          pValues.push(transform(body[key]));
        }
      }

      if (pFields.length > 0) {
        if (existingCols.has('updated_at')) {
          pFields.push('updated_at = ?');
          pValues.push(localNow());
        }
        pValues.push(id);
        await db.prepare(`UPDATE properties SET ${pFields.join(', ')} WHERE id = ?`).run(...pValues);
      }

      const updated = await db.prepare(`
        SELECT p.*, c.name as client_name
        FROM properties p LEFT JOIN clients c ON p.client_id = c.id WHERE p.id = ?
      `).get(id);

      return c.json(updated);
    } catch (err: any) {
      console.error('Update property error:', err);
      return c.json({ error: 'Failed to update property', code: 'UPDATE_PROPERTY_ERROR' }, 500);
    }
  });

  // DELETE /api/records/properties/:id — Delete property
  api.delete('/properties/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const prop = await db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as any;
      if (!prop) return c.json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }, 404);

      const user = c.get('user');
      await db.prepare('DELETE FROM properties WHERE id = ?').run(id);
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'property_deleted', 'property', id, `Deleted property: ${prop.name} (ID ${id})`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json({ success: true, id });
    } catch (err: any) {
      console.error('Delete property error:', err);
      return c.json({ error: 'Failed to delete property', code: 'DELETE_PROPERTY_ERROR' }, 500);
    }
  });

  // POST /api/records/properties/:id/archive — Archive property
  api.post('/properties/:id/archive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('properties');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const prop = await db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as any;
      if (!prop) return c.json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }, 404);
      if (prop.archived_at) return c.json({ error: 'Property is already archived', code: 'PROPERTY_ALREADY_ARCHIVED' }, 400);

      const now = localNow();
      await db.prepare('UPDATE properties SET archived_at = ? WHERE id = ?').run(now, id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'property_archived', 'property', id, `Archived property: ${prop.name}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM properties WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Archive property error:', err);
      return c.json({ error: 'Failed to archive property', code: 'ARCHIVE_PROPERTY_ERROR' }, 500);
    }
  });

  // POST /api/records/properties/:id/unarchive — Unarchive property
  api.post('/properties/:id/unarchive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('properties');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const prop = await db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as any;
      if (!prop) return c.json({ error: 'Property not found', code: 'PROPERTY_NOT_FOUND' }, 404);
      if (!prop.archived_at) return c.json({ error: 'Property is not archived', code: 'PROPERTY_NOT_ARCHIVED' }, 400);

      await db.prepare('UPDATE properties SET archived_at = NULL WHERE id = ?').run(id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'property_unarchived', 'property', id, `Unarchived property: ${prop.name}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM properties WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Unarchive property error:', err);
      return c.json({ error: 'Failed to unarchive property', code: 'UNARCHIVE_PROPERTY_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // EVIDENCE
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/evidence - List evidence
  api.get('/evidence', async (c) => {
    const { page = '1', limit = '100000', archived } = c.req.query();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100000, Math.max(1, (parseInt(limit, 10)) || 100000));
    const offset = (pageNum - 1) * limitNum;
    try {
      const db = new D1Db(c.env.DB);

      let whereClause = 'WHERE 1=1';
      if (archived === 'true') {
        whereClause += ' AND e.archived_at IS NOT NULL';
      } else if (archived !== 'all') {
        whereClause += ' AND e.archived_at IS NULL';
      }

      const countRow = await db.prepare(`SELECT COUNT(*) as total FROM evidence e ${whereClause}`).get() as any;

      const evidence = await db.prepare(`
        SELECT e.*, i.incident_number, u.full_name as collected_by_name
        FROM evidence e
        LEFT JOIN incidents i ON e.incident_id = i.id
        LEFT JOIN users u ON e.collected_by = u.id
        ${whereClause}
        ORDER BY e.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limitNum, offset);

      return c.json({
        data: evidence,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: countRow?.total ?? 0,
          totalPages: Math.ceil((countRow?.total ?? 0) / limitNum),
        },
      });
    } catch (err: any) {
      if (err?.message?.includes('no such column') && archived !== 'all') {
        try {
          const db2 = new D1Db(c.env.DB);
          const cleanWhere = 'WHERE 1=1';
          const countRow2 = await db2.prepare(`SELECT COUNT(*) as total FROM evidence e ${cleanWhere}`).get() as any;
          const evidence2 = await db2.prepare(`
            SELECT e.*, i.incident_number, u.full_name as collected_by_name
            FROM evidence e
            LEFT JOIN incidents i ON e.incident_id = i.id
            LEFT JOIN users u ON e.collected_by = u.id
            ${cleanWhere}
            ORDER BY e.created_at DESC
            LIMIT ? OFFSET ?
          `).all(limitNum, offset);
          return c.json({
            data: evidence2,
            pagination: { page: pageNum, limit: limitNum, total: countRow2?.total ?? 0, totalPages: Math.ceil((countRow2?.total ?? 0) / limitNum) },
          });
        } catch { /* fall through */ }
      }
      return c.json({ error: 'Failed to get evidence', code: 'GET_EVIDENCE_ERROR' }, 500);
    }
  });

  // GET /api/records/evidence/:id - Get evidence detail
  api.get('/evidence/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const item = await db.prepare(`
        SELECT e.*, i.incident_number, u.full_name as collected_by_name
        FROM evidence e
        LEFT JOIN incidents i ON e.incident_id = i.id
        LEFT JOIN users u ON e.collected_by = u.id
        WHERE e.id = ?
      `).get(id);
      if (!item) return c.json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }, 404);
      return c.json(item);
    } catch (err: any) {
      return c.json({ error: 'Failed to get evidence', code: 'GET_EVIDENCE_BY_ID_ERROR' }, 500);
    }
  });

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
    location_found: v => v ?? null,
    condition: v => v ?? null,
    quantity: v => v === '' || v == null ? null : parseInt(v, 10) || null,
    is_biological: v => v ? 1 : 0,
    narcotics_flag: v => v ? 1 : 0,
    temperature_sensitive: v => v ? 1 : 0,
  };

  // POST /api/records/evidence — Create evidence
  api.post('/evidence', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const body = await c.req.json();

      if (!body.description || !body.evidence_type) {
        return c.json({ error: 'description and evidence_type are required', code: 'DESCRIPTION_AND_EVIDENCETYPE_ARE' }, 400);
      }

      const currentYear = new Date().getFullYear();
      const lastEvidence = await db.prepare(
        `SELECT evidence_number FROM evidence WHERE evidence_number LIKE ? ORDER BY id DESC LIMIT 1`
      ).get(`EV-${currentYear}-%`) as any;

      let nextNum = 1;
      if (lastEvidence) {
        const parts = lastEvidence.evidence_number.split('-');
        nextNum = parseInt(parts[2], 10) + 1;
      }
      const evidenceNumber = `EV-${currentYear}-${String(nextNum).padStart(5, '0')}`;

      const existingCols = await db.getColumns('evidence');
      const columns: string[] = [];
      const placeholders: string[] = [];
      const values: any[] = [];

      if (existingCols.has('evidence_number')) { columns.push('evidence_number'); placeholders.push('?'); values.push(evidenceNumber); }
      if (existingCols.has('description')) { columns.push('description'); placeholders.push('?'); values.push(body.description); }
      if (existingCols.has('evidence_type')) { columns.push('evidence_type'); placeholders.push('?'); values.push(body.evidence_type); }
      if (existingCols.has('collected_by')) { columns.push('collected_by'); placeholders.push('?'); values.push(user.userId); }

      for (const [key, transform] of Object.entries(EVIDENCE_FIELD_MAP)) {
        if (key === 'description' || key === 'evidence_type') continue;
        if (Object.keys(body).includes(key) && existingCols.has(key)) {
          columns.push(key);
          placeholders.push('?');
          values.push(transform(body[key]));
        }
      }

      const now = localNow();
      if (existingCols.has('created_at') && existingCols.has('updated_at')) {
        columns.push('created_at', 'updated_at');
        placeholders.push('?', '?');
        values.push(now, now);
      }

      const result = await db.prepare(
        `INSERT INTO evidence (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
      ).run(...values);

      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'evidence_created', 'evidence', result.meta.last_row_id ?? 0, `Created evidence: ${evidenceNumber} - ${body.description}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      const created = await db.prepare(`
        SELECT e.*, i.incident_number, u.full_name as collected_by_name
        FROM evidence e
        LEFT JOIN incidents i ON e.incident_id = i.id
        LEFT JOIN users u ON e.collected_by = u.id
        WHERE e.id = ?
      `).get(result.meta.last_row_id);

      return c.json(created, 201);
    } catch (err: any) {
      console.error('Create evidence error:', err);
      return c.json({ error: 'Failed to create evidence', code: 'CREATE_EVIDENCE_ERROR' }, 500);
    }
  });

  // PUT /api/records/evidence/:id — Update evidence
  api.put('/evidence/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as any;
      if (!existing) return c.json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }, 404);

      const user = c.get('user');
      const body = await c.req.json();

      const existingCols = await db.getColumns('evidence');
      const fields: string[] = [];
      const values: any[] = [];
      const bodyKeys = Object.keys(body);

      for (const [key, transform] of Object.entries(EVIDENCE_FIELD_MAP)) {
        if (bodyKeys.includes(key) && existingCols.has(key)) {
          fields.push(`${key} = ?`);
          values.push(transform(body[key]));
        }
      }

      if (fields.length > 0) {
        if (existingCols.has('updated_at')) {
          fields.push('updated_at = ?');
          values.push(localNow());
        }
        values.push(id);
        await db.prepare(`UPDATE evidence SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }

      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'evidence_updated', 'evidence', id, `Updated evidence: ${existing.description || 'ID ' + existing.id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      const updated = await db.prepare(`
        SELECT e.*, i.incident_number, u.full_name as collected_by_name
        FROM evidence e
        LEFT JOIN incidents i ON e.incident_id = i.id
        LEFT JOIN users u ON e.collected_by = u.id
        WHERE e.id = ?
      `).get(id);

      return c.json(updated);
    } catch (err: any) {
      console.error('Update evidence error:', err);
      return c.json({ error: 'Failed to update evidence', code: 'UPDATE_EVIDENCE_ERROR' }, 500);
    }
  });

  // DELETE /api/records/evidence/:id — Delete evidence
  api.delete('/evidence/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const ev = await db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as any;
      if (!ev) return c.json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }, 404);

      const user = c.get('user');
      await db.prepare('DELETE FROM evidence WHERE id = ?').run(id);
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'evidence_deleted', 'evidence', id, `Deleted evidence: ${ev.description || 'ID ' + ev.id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json({ success: true, id });
    } catch (err: any) {
      console.error('Delete evidence error:', err);
      return c.json({ error: 'Failed to delete evidence', code: 'DELETE_EVIDENCE_ERROR' }, 500);
    }
  });

  // POST /api/records/evidence/:id/archive — Archive evidence
  api.post('/evidence/:id/archive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('evidence');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const ev = await db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as any;
      if (!ev) return c.json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }, 404);
      if (ev.archived_at) return c.json({ error: 'Evidence is already archived', code: 'EVIDENCE_ALREADY_ARCHIVED' }, 400);

      const now = localNow();
      await db.prepare('UPDATE evidence SET archived_at = ? WHERE id = ?').run(now, id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'evidence_archived', 'evidence', id, `Archived evidence: ${ev.description || 'ID ' + ev.id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM evidence WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Archive evidence error:', err);
      return c.json({ error: 'Failed to archive evidence', code: 'ARCHIVE_EVIDENCE_ERROR' }, 500);
    }
  });

  // POST /api/records/evidence/:id/unarchive — Unarchive evidence
  api.post('/evidence/:id/unarchive', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const existingCols = await db.getColumns('evidence');
      if (!existingCols.has('archived_at')) return c.json({ error: 'Archive feature not available', code: 'ARCHIVE_NOT_AVAILABLE' }, 501);
      const id = paramNum(c.req.param('id'));
      const ev = await db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as any;
      if (!ev) return c.json({ error: 'Evidence not found', code: 'EVIDENCE_NOT_FOUND' }, 404);
      if (!ev.archived_at) return c.json({ error: 'Evidence is not archived', code: 'EVIDENCE_NOT_ARCHIVED' }, 400);

      await db.prepare('UPDATE evidence SET archived_at = NULL WHERE id = ?').run(id);

      const user = c.get('user');
      await db.prepare(
        'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(user.userId, 'evidence_unarchived', 'evidence', id, `Unarchived evidence: ${ev.description || 'ID ' + ev.id}`, c.req.header('x-forwarded-for') || 'unknown', localNow());

      return c.json(await db.prepare('SELECT * FROM evidence WHERE id = ?').get(id));
    } catch (err: any) {
      console.error('Unarchive evidence error:', err);
      return c.json({ error: 'Failed to unarchive evidence', code: 'UNARCHIVE_EVIDENCE_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // WARRANTS (read-only)
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/warrants - Search warrants
  api.get('/warrants', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    const status = c.req.query('status');

    let where = '1=1';
    const params: any[] = [];

    if (q.length >= 2) {
      where += " AND (w.warrant_number LIKE ? OR p.last_name LIKE ? OR p.first_name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      where += ' AND w.status = ?';
      params.push(status);
    }

    const warrants = await db.prepare(`
      SELECT w.*, p.last_name, p.first_name, p.dob
      FROM warrants w LEFT JOIN persons p ON w.person_id = p.id
      WHERE ${where} ORDER BY w.created_at DESC LIMIT 500
    `).all(...params);

    return c.json(warrants);
  });

  // ═══════════════════════════════════════════════════════════
  // BOLOS (read-only)
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/bolos - Search BOLOs
  api.get('/bolos', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    const status = c.req.query('status');

    let where = '1=1';
    const params: any[] = [];

    if (q.length >= 2) {
      where += " AND (b.bolo_number LIKE ? OR b.subject LIKE ? OR b.description LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }

    const bolos = await db.prepare(`SELECT b.* FROM bolos b WHERE ${where} ORDER BY b.created_at DESC LIMIT 500`).all(...params);
    return c.json(bolos);
  });

  // ═══════════════════════════════════════════════════════════
  // COMPOUND SEARCH
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/compound-search
  api.get('/compound-search', async (c) => {
    const db = new D1Db(c.env.DB);
    const name = c.req.query('name') || '';
    const dob = c.req.query('dob') || '';
    const plate = c.req.query('plate') || '';

    const results: Record<string, any[]> = {};

    if (name.length >= 2) {
      results.persons = await db.prepare(`
        SELECT * FROM persons WHERE last_name LIKE ? OR first_name LIKE ? LIMIT 50
      `).all(`%${name}%`, `%${name}%`);
    }

    if (plate.length >= 2) {
      results.vehicles = await db.prepare(`SELECT * FROM vehicles_records WHERE plate_number LIKE ? LIMIT 50`).all(`%${plate}%`);
    }

    if (dob) {
      results.persons_by_dob = await db.prepare(`SELECT * FROM persons WHERE dob = ? LIMIT 50`).all(dob);
    }

    return c.json(results);
  });

  // ═══════════════════════════════════════════════════════════
  // UNIVERSAL SEARCH
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/persons/search - Search persons
  api.get('/persons/search', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query('q') || '';
      if (q.length < 2) return c.json({ error: 'Search query must be at least 2 characters', code: 'SEARCH_QUERY_MUST_BE' }, 400);

      const searchTerm = `%${q}%`;
      const persons = await db.prepare(`
        SELECT * FROM persons
        WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
          OR address LIKE ? OR (first_name || ' ' || last_name) LIKE ?
        ORDER BY last_name, first_name LIMIT 50
      `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);

      return c.json(persons || []);
    } catch (err: any) {
      return c.json({ error: 'Failed to search persons', code: 'SEARCH_PERSONS_ERROR' }, 500);
    }
  });

  // GET /api/records/universal-search
  api.get('/universal-search', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    if (q.length < 2) return c.json({ results: [], total: 0 });

    const [persons, vehicles, calls, incidents, warrants, bolos] = await Promise.all([
      db.prepare(`SELECT id, last_name, first_name, dob, 'person' as type FROM persons WHERE last_name LIKE ? OR first_name LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`),
      db.prepare(`SELECT id, plate_number, make, model, 'vehicle' as type FROM vehicles_records WHERE plate_number LIKE ? OR vin LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`),
      db.prepare(`SELECT id, call_number, incident_type, location_address, 'call' as type FROM calls_for_service WHERE call_number LIKE ? OR location_address LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`),
      db.prepare(`SELECT id, incident_number, incident_type, location_address, 'incident' as type FROM incidents WHERE incident_number LIKE ? OR location_address LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`),
      db.prepare(`SELECT id, warrant_number, 'warrant' as type FROM warrants WHERE warrant_number LIKE ? LIMIT 10`).all(`%${q}%`),
      db.prepare(`SELECT id, bolo_number, 'bolo' as type FROM bolos WHERE bolo_number LIKE ? LIMIT 10`).all(`%${q}%`),
    ]);

    const results = [...(persons as any[]), ...(vehicles as any[]), ...(calls as any[]), ...(incidents as any[]), ...(warrants as any[]), ...(bolos as any[])];
    return c.json({ results, total: results.length });
  });

  // Mount all records routes under /records
  app.route('/api/records', api);
}
