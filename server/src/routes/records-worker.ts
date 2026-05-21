// ============================================================
// RMPG Flex — Records Routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/records.ts for Workers runtime.
// Read + write endpoints for persons, vehicles, properties.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

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
  // PERSONS (read-only)
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/persons - Search persons
  api.get('/persons', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    if (q.length < 2) return c.json([]);

    const persons = await db.prepare(`
      SELECT * FROM persons
      WHERE last_name LIKE ? OR first_name LIKE ? OR dob LIKE ? OR plate_number LIKE ?
      ORDER BY last_name, first_name LIMIT 200
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);

    return c.json(persons);
  });

  // GET /api/records/persons/:id - Get person details
  api.get('/persons/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const person = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
    if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);
    return c.json(person);
  });

  // ═══════════════════════════════════════════════════════════
  // VEHICLES (read-only)
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/vehicles - Search vehicles
  api.get('/vehicles', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    if (q.length < 2) return c.json([]);

    const vehicles = await db.prepare(`
      SELECT * FROM vehicles_records
      WHERE plate_number LIKE ? OR vin LIKE ? OR make LIKE ? OR model LIKE ?
      ORDER BY created_at DESC LIMIT 200
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);

    return c.json(vehicles);
  });

  // GET /api/records/vehicles/:id - Get vehicle details
  api.get('/vehicles/:id', async (c) => {
    const db = new D1Db(c.env.DB);
    const id = paramNum(c.req.param('id'));
    const vehicle = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id);
    if (!vehicle) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);
    return c.json(vehicle);
  });

  // ═══════════════════════════════════════════════════════════
  // EVIDENCE (read-only)
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/evidence - Search evidence
  api.get('/evidence', async (c) => {
    const db = new D1Db(c.env.DB);
    const q = c.req.query('q') || '';
    if (q.length < 2) return c.json([]);

    const evidence = await db.prepare(`
      SELECT e.*, i.incident_number FROM evidence e
      LEFT JOIN incidents i ON e.incident_id = i.id
      WHERE e.item_number LIKE ? OR e.description LIKE ? OR e.category LIKE ?
      ORDER BY e.created_at DESC LIMIT 200
    `).all(`%${q}%`, `%${q}%`, `%${q}%`);

    return c.json(evidence);
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

  // ═══════════════════════════════════════════════════════════
  // PERSONS (write)
  // ═══════════════════════════════════════════════════════════

  const PERSON_FIELD_MAP: Record<string, (v: any) => any> = {
    first_name: v => v ?? null, last_name: v => v ?? null,
    middle_name: v => v ?? null, suffix: v => v ?? null, dob: v => v ?? null,
    ssn: v => v ?? null, phone: v => v ?? null, email: v => v ?? null,
    address: v => v ?? null, city: v => v ?? null, state: v => v ?? null,
    zip: v => v ?? null, race: v => v ?? null, sex: v => v ?? null,
    height: v => v ?? null, weight: v => v ?? null,
    hair_color: v => v ?? null, eye_color: v => v ?? null,
    identifiers: v => v ?? null, mugshot_url: v => v ?? null,
    aka_names: v => v ?? null, employment: v => v ?? null,
    phone2: v => v ?? null, drivers_license_number: v => v ?? null,
    drivers_license_state: v => v ?? null, physical_marks: v => v ?? null,
    occupation: v => v ?? null, education: v => v ?? null,
    marital_status: v => v ?? null, nationality: v => v ?? null,
    aliases: v => v ?? null, place_of_birth: v => v ?? null,
    citizenship: v => v ?? null, id_type: v => v ?? null,
    id_number: v => v ?? null, id_state: v => v ?? null,
    id_expiration: v => v ?? null, caution: v => v ?? null,
    caution_reason: v => v ?? null, notes: v => v ?? null,
    photo_url: v => v ?? null,
  };

  // POST /api/records/persons — Create person
  api.post('/persons', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();

      if (!body.first_name || !body.last_name) {
        return c.json({ error: 'first_name and last_name are required', code: 'FIRSTNAME_AND_LASTNAME_ARE' }, 400);
      }

      const columns: string[] = [];
      const placeholders: string[] = [];
      const values: any[] = [];
      const bodyKeys = Object.keys(body);

      for (const [key, transform] of Object.entries(PERSON_FIELD_MAP)) {
        if (bodyKeys.includes(key)) {
          columns.push(key);
          placeholders.push('?');
          values.push(transform(body[key]));
        }
      }

      if (bodyKeys.includes('flags')) {
        columns.push('flags');
        placeholders.push('?');
        values.push(JSON.stringify(body.flags ?? []));
      }

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
      const fields: string[] = [];
      const values: any[] = [];
      const bodyKeys = Object.keys(body);

      for (const [key, transform] of Object.entries(PERSON_FIELD_MAP)) {
        if (bodyKeys.includes(key)) {
          fields.push(`${key} = ?`);
          values.push(transform(body[key]));
        }
      }

      if (bodyKeys.includes('flags')) {
        fields.push('flags = ?');
        values.push(JSON.stringify(body.flags ?? []));
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(localNow());
        values.push(id);
        await db.prepare(`UPDATE persons SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }

      const updated = await db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      console.error('Update person error:', err);
      return c.json({ error: 'Failed to update person', code: 'UPDATE_PERSON_ERROR' }, 500);
    }
  });

  // ═══════════════════════════════════════════════════════════
  // VEHICLES (write)
  // ═══════════════════════════════════════════════════════════

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
      const bodyKeys = Object.keys(body || {});
      const columns: string[] = [];
      const placeholders: string[] = [];
      const values: any[] = [];

      for (const [key, transform] of Object.entries(VEHICLE_FIELD_MAP)) {
        if (bodyKeys.includes(key)) {
          columns.push(key);
          placeholders.push('?');
          values.push(transform(body[key]));
        }
      }

      columns.push('flags');
      placeholders.push('?');
      values.push(JSON.stringify(body.flags || []));

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
      const fields: string[] = [];
      const values: any[] = [];
      const bodyKeys = Object.keys(body);

      for (const [key, transform] of Object.entries(VEHICLE_FIELD_MAP)) {
        if (bodyKeys.includes(key)) {
          fields.push(`${key} = ?`);
          values.push(transform(body[key]));
        }
      }

      if (bodyKeys.includes('flags')) {
        fields.push('flags = ?');
        values.push(JSON.stringify(body.flags ?? []));
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(localNow());
        values.push(id);
        await db.prepare(`UPDATE vehicles_records SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }

      const updated = await db.prepare('SELECT * FROM vehicles_records WHERE id = ?').get(id);
      return c.json(updated);
    } catch (err: any) {
      console.error('Update vehicle error:', err);
      return c.json({ error: 'Failed to update vehicle', code: 'UPDATE_VEHICLE_ERROR' }, 500);
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
      };

      for (const [key, transform] of Object.entries(PROPERTY_FIELDS)) {
        if (Object.keys(body).includes(key)) {
          columns.push(key);
          placeholders.push('?');
          values.push(transform(body[key]));
        }
      }

      const now = localNow();
      columns.push('created_at', 'updated_at');
      placeholders.push('?', '?');
      values.push(now, now);

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
      const pFields: string[] = [];
      const pValues: any[] = [];
      const pBodyKeys = Object.keys(body);

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
      };

      for (const [key, transform] of Object.entries(pFieldMap)) {
        if (pBodyKeys.includes(key)) {
          pFields.push(`${key} = ?`);
          pValues.push(transform(body[key]));
        }
      }

      if (pFields.length > 0) {
        pFields.push('updated_at = ?');
        pValues.push(localNow());
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

  // Mount all records routes under /records
  app.route('/api/records', api);
}
