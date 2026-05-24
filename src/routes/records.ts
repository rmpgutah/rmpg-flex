import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const records = new Hono<Env>();

// GET /records/properties
records.get('/properties', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, client_id } = c.req.query();
    let sql = 'SELECT * FROM properties';
    const params: unknown[] = [];
    const wheres: string[] = [];
    if (search) { wheres.push("(name LIKE ? OR address LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (client_id) { wheres.push('client_id = ?'); params.push(client_id); }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY name LIMIT 500';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// POST /records/persons
records.post('/persons', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.first_name || !body.last_name) return c.json({ error: 'first_name and last_name required' }, 400);
    const result = await execute(db,
      'INSERT INTO persons (first_name, last_name, dob, gender, race, height, weight, hair_color, eye_color, address, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      body.first_name, body.last_name, body.dob || null, body.gender || null, body.race || null,
      body.height || null, body.weight || null, body.hair_color || null, body.eye_color || null,
      body.address || null, body.phone || null, body.email || null, body.notes || null
    );
    const person = await queryFirst(db, 'SELECT * FROM persons WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(person, 201);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/persons/search
records.get('/persons/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    if (!q || q.length < 2) return c.json([]);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT * FROM persons
      WHERE last_name LIKE ? OR first_name LIKE ? OR phone LIKE ?
      ORDER BY last_name, first_name LIMIT 50
    `, `%${q}%`, `%${q}%`, `%${q}%`);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// POST /records/vehicles
records.post('/vehicles', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.plate_number) return c.json({ error: 'plate_number required' }, 400);
    const result = await execute(db,
      'INSERT INTO vehicles_records (plate_number, state, make, model, year, color, vin, owner_person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      body.plate_number, body.state || null, body.make || null, body.model || null,
      body.year || null, body.color || null, body.vin || null, body.owner_person_id || null
    );
    const vehicle = await queryFirst(db, 'SELECT * FROM vehicles_records WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(vehicle, 201);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/vehicles/search
records.get('/vehicles/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    if (!q || q.length < 2) return c.json([]);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT v.*, p.first_name, p.last_name FROM vehicles_records v
      LEFT JOIN persons p ON v.owner_person_id = p.id
      WHERE v.plate_number LIKE ? OR v.vin LIKE ? OR v.make LIKE ? OR v.model LIKE ?
      ORDER BY v.plate_number LIMIT 50
    `, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/search?q=...&type=person|vehicle|business
// Used by client/src/components/LinkRecordModal.tsx for cross-type linking.
// Returns an array of records matching the query for the given type. Legacy
// has no handler at this exact path (it has /persons/search and /vehicles/
// search separately) so calls fell through with empty `[]` and the dropdown
// stayed blank.
records.get('/search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    const type = (c.req.query('type') || 'person').toLowerCase();
    if (!q || q.length < 2) return c.json([]);
    const like = `%${q}%`;

    // Client (LinkRecordModal.tsx) renders `result.label || result.name ||
    // result.id`. Without a `label` field it falls back to the numeric record
    // id ("1", "2") which the user reported as "showing the Record number".
    // Format per user spec: persons → "Last, First"; vehicles → plate number;
    // properties → business name if it looks like a business, else street
    // address. We synthesize `label` on every row.

    if (type === 'person') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT * FROM persons
        WHERE last_name LIKE ? OR first_name LIKE ? OR phone LIKE ?
          OR (first_name || ' ' || last_name) LIKE ?
        ORDER BY last_name, first_name LIMIT 50
      `, like, like, like, like);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.last_name, r.first_name].filter(Boolean).join(', ') || `Person #${r.id}`,
      })));
    }

    if (type === 'vehicle') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT v.*, p.first_name, p.last_name
        FROM vehicles_records v
        LEFT JOIN persons p ON v.owner_person_id = p.id
        WHERE v.plate_number LIKE ? OR v.vin LIKE ? OR v.make LIKE ? OR v.model LIKE ?
        ORDER BY v.plate_number LIMIT 50
      `, like, like, like, like);
      return c.json(rows.map((r) => {
        const plate = (r.plate_number as string | null) || '';
        const yearMakeModel = [r.year, r.make, r.model].filter(Boolean).join(' ');
        // "8JAR3 — 2022 Dodge RAM" reads better than just the plate when the
        // dispatcher's picking from a list of look-alike plates.
        const label = plate
          ? (yearMakeModel ? `${plate} — ${yearMakeModel}` : plate)
          : (yearMakeModel || `Vehicle #${r.id}`);
        return { ...r, label };
      }));
    }

    if (type === 'business' || type === 'property') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT * FROM properties
        WHERE name LIKE ? OR address LIKE ?
        ORDER BY name LIMIT 50
      `, like, like);
      return c.json(rows.map((r) => {
        // If `business_type` is populated the property is a business → name first;
        // otherwise treat as residential → address first. Falls back the other
        // direction if the chosen field is empty so we never return just the id.
        const isBusiness = Boolean((r.business_type as string | null) || '');
        const name = (r.name as string | null) || '';
        const address = (r.address as string | null) || '';
        const label = isBusiness
          ? (name || address || `Property #${r.id}`)
          : (address || name || `Property #${r.id}`);
        return { ...r, label };
      }));
    }

    // Unknown type — empty array keeps the client UI consistent (no error toast).
    return c.json([]);
  } catch (err) {
    console.error('GET /records/search failed:', err);
    return c.json({ error: 'Search failed', detail: (err as Error)?.message }, 500);
  }
});

export default records;
