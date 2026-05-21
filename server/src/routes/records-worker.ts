// ============================================================
// RMPG Flex — Records Routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/records.ts for Workers runtime.
// Focus on read-only endpoints first.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountRecordsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();

  api.use('/*', authenticateToken);

  // ═══════════════════════════════════════════════════════════
  // PROPERTIES
  // ═══════════════════════════════════════════════════════════

  // GET /api/records/properties - List properties
  api.get('/properties', async (c) => {
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

  // Mount all records routes under /records
  app.route('/api/records', api);
}
