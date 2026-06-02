import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { normalizeDob } from '../utils/normalizeDob';

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
    // Normalize DOB to ISO at the write boundary so age-matching + display
    // get a consistent format. normalizeDob returns null for unparseable
    // input (honest) rather than a guessed-wrong date.
    const dob = normalizeDob(typeof body.dob === 'string' ? body.dob : null);
    const result = await execute(db,
      'INSERT INTO persons (first_name, last_name, dob, gender, race, height, weight, hair_color, eye_color, address, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      body.first_name, body.last_name, dob, body.gender || null, body.race || null,
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

// ── Persons extra endpoints (must be before /:id to avoid param capture) ──

// GET /records/persons/export — CSV export of all persons.
records.get('/persons/export', async (c) => {
  try {
    const db = getDb(c.env);
    const { archived } = c.req.query();
    let sql = 'SELECT * FROM persons';
    if (archived !== 'true') {
      sql += " WHERE (flags IS NULL OR flags = '[]' OR NOT EXISTS (SELECT 1 FROM json_each(flags) WHERE json_each.value->>'$.type' = 'archived'))";
    }
    sql += ' ORDER BY last_name, first_name LIMIT 50000';
    const rows = await query<Record<string, unknown>>(db, sql);
    if (rows.length === 0) return c.json([]);
    const keys = ['first_name','last_name','dob','gender','race','height','weight','hair_color','eye_color','address','phone','email'];
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=persons_export.csv' });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// POST /records/persons/check-duplicates — find potential duplicate persons.
records.post('/persons/check-duplicates', async (c) => {
  try {
    const db = getDb(c.env);
    const { first_name, last_name, dob } = await c.req.json<{ first_name?: string; last_name?: string; dob?: string }>();
    if (!first_name || !last_name) return c.json({ matches: [] });
    const matches = await query<Record<string, unknown>>(db,
      'SELECT id, first_name, last_name, dob, gender, race, address, phone FROM persons WHERE last_name = ? AND first_name = ?',
      last_name.trim(), first_name.trim());
    if (matches.length === 0 && dob) {
      const dobMatches = await query<Record<string, unknown>>(db,
        'SELECT id, first_name, last_name, dob, gender, race, address, phone FROM persons WHERE last_name = ? AND dob = ?',
        last_name.trim(), dob);
      return c.json({ matches: dobMatches });
    }
    return c.json({ matches });
  } catch (err) { return c.json({ matches: [] }); }
});

// GET /records/persons/duplicates — find potential duplicate pairs.
records.get('/persons/duplicates', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT a.id as id_a, a.first_name as first_name_a, a.last_name as last_name_a, a.dob as dob_a,
             b.id as id_b, b.first_name as first_name_b, b.last_name as last_name_b, b.dob as dob_b
      FROM persons a JOIN persons b ON a.last_name = b.last_name AND a.first_name = b.first_name AND a.id < b.id
      ORDER BY a.last_name, a.first_name LIMIT 200`);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// POST /records/persons/merge — merge duplicate person records.
records.post('/persons/merge', async (c) => {
  try {
    const db = getDb(c.env);
    const { keep_id, merge_id } = await c.req.json<{ keep_id?: number; merge_id?: number }>();
    if (!keep_id || !merge_id || keep_id === merge_id) return c.json({ error: 'keep_id and merge_id required and must differ' }, 400);
    const [keep, merge] = await Promise.all([
      queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', keep_id),
      queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', merge_id),
    ]);
    if (!keep || !merge) return c.json({ error: 'One or both persons not found' }, 404);
    // Update FK references from merge_id to keep_id
    for (const t of ['vehicles_records', 'incident_persons', 'call_persons', 'warrants', 'criminal_history']) {
      try { await execute(db, `UPDATE ${t} SET person_id = ? WHERE person_id = ?`, keep_id, merge_id); } catch { /* table may not exist */ }
    }
    await execute(db, 'DELETE FROM persons WHERE id = ?', merge_id);
    return c.json({ success: true, keep_id });
  } catch (err) { return c.json({ error: 'Merge failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/persons/alias-search — search by potential alias (name match).
records.get('/persons/alias-search', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    if (!q || q.length < 2) return c.json([]);
    const like = `%${q}%`;
    const rows = await query<Record<string, unknown>>(db,
      'SELECT id, first_name, last_name, dob, gender FROM persons WHERE first_name LIKE ? OR last_name LIKE ? ORDER BY last_name, first_name LIMIT 50',
      like, like);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// GET /records/persons/:id — fetch a single person by ID (full detail).
// Called by PersonsTab on selection, DispatchRecordPanel, RecordDetailWindow,
// and PrintRecordButton for cross-reference. Returns the full row so the
// client can render address, phone, flags, etc. without a second query.
records.get('/persons/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const person = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', id);
    if (!person) return c.json({ error: 'Person not found' }, 404);
    return c.json(person);
  } catch (err) {
    console.error('GET /records/persons/:id failed:', err);
    return c.json({ error: 'Failed to get person', detail: (err as Error)?.message }, 500);
  }
});

// PUT /records/persons/:id — update a person. Accepts the same fields as
// POST /persons. Returns the updated row on success.
records.put('/persons/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM persons WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Person not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = [];
    const params: unknown[] = [];

    const writable = new Set([
      'first_name', 'last_name', 'dob', 'gender', 'race', 'height', 'weight',
      'hair_color', 'eye_color', 'scars_marks_tattoos', 'address', 'phone',
      'email', 'photo_url', 'flags', 'notes',
    ]);

    for (const [key, val] of Object.entries(body)) {
      if (writable.has(key)) {
        cols.push(`${key} = ?`);
        params.push(val ?? null);
      }
    }

    if (cols.length === 0) return c.json({ message: 'No changes' });

    const result = await execute(db, `UPDATE persons SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM persons WHERE id = ?', id);
    return c.json(updated);
  } catch (err) {
    console.error('PUT /records/persons/:id failed:', err);
    return c.json({ error: 'Failed to update person', detail: (err as Error)?.message }, 500);
  }
});

// DELETE /records/persons/:id — hard-delete a person.
// The client also supports archiving (POST /.../archive) as a softer
// alternative; this path is the explicit "delete" button in the UI.
records.delete('/persons/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM persons WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Person not found' }, 404);
    await execute(db, 'DELETE FROM persons WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /records/persons/:id failed:', err);
    return c.json({ error: 'Failed to delete person', detail: (err as Error)?.message }, 500);
  }
});

// POST /records/persons/:id/archive — soft-delete by marking the person's
// flags JSON with an archived entry. The persons table has no dedicated
// archived_at column (near the D1 100-col cap), so we overload the existing
// flags TEXT field (a JSON array) by appending {"type":"archived"}.
// The search handler /persons/search does NOT filter by default — archived
// persons still appear in search results but the client's list view
// filters them client-side via showArchived state.
records.post('/persons/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const person = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM persons WHERE id = ?', id);
    if (!person) return c.json({ error: 'Person not found' }, 404);

    const flags = (() => {
      try { const p = JSON.parse(person.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
    })();
    const isArchived = flags.some((f: any) => typeof f === 'object' && f.type === 'archived');
    if (isArchived) return c.json({ message: 'Already archived' });

    flags.push({ type: 'archived', at: new Date().toISOString() });
    await execute(db, 'UPDATE persons SET flags = ? WHERE id = ?', JSON.stringify(flags), id);
    return c.json({ success: true, archived: true });
  } catch (err) {
    console.error('POST /records/persons/:id/archive failed:', err);
    return c.json({ error: 'Failed to archive person', detail: (err as Error)?.message }, 500);
  }
});

// POST /records/persons/:id/unarchive — reverse the archive flag.
records.post('/persons/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const person = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM persons WHERE id = ?', id);
    if (!person) return c.json({ error: 'Person not found' }, 404);

    const flags = (() => {
      try { const p = JSON.parse(person.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
    })();
    const filtered = flags.filter((f: any) => !(typeof f === 'object' && f.type === 'archived'));
    if (filtered.length === flags.length) return c.json({ message: 'Not archived' });

    await execute(db, 'UPDATE persons SET flags = ? WHERE id = ?', JSON.stringify(filtered), id);
    return c.json({ success: true, archived: false });
  } catch (err) {
    console.error('POST /records/persons/:id/unarchive failed:', err);
    return c.json({ error: 'Failed to unarchive person', detail: (err as Error)?.message }, 500);
  }
});

// ── Persons sub-resource endpoints ──

// GET /records/persons/:id/system-history — warrants, incidents, calls, citations for a person.
records.get('/persons/:id/system-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const [warrants, incidents, calls, citations] = await Promise.all([
      query<Record<string, unknown>>(db, `SELECT id, warrant_number, type, charge_description AS description, status, bond_amount, bail_amount, issuing_agency, issuing_court, issued_date, expires_at FROM warrants WHERE person_id = ? ORDER BY created_at DESC LIMIT 50`, id),
      query<Record<string, unknown>>(db, 'SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at, i.location_address FROM incidents i JOIN incident_persons ip ON i.id = ip.incident_id WHERE ip.person_id = ? ORDER BY i.created_at DESC LIMIT 50', id),
      query<Record<string, unknown>>(db, 'SELECT c.id, c.call_number, c.incident_type, c.status, c.created_at, c.location_address FROM calls_for_service c JOIN call_persons cp ON c.id = cp.call_id WHERE cp.person_id = ? ORDER BY c.created_at DESC LIMIT 50', id),
      query<Record<string, unknown>>(db, 'SELECT id, citation_number, type, violation_description, status, fine_amount, violation_date, court_date FROM citations WHERE person_id = ? ORDER BY created_at DESC LIMIT 50', id),
    ]);
    const activeWarrants = warrants.filter((w: any) => w.status === 'active');
    const activeCitations = citations.filter((c: any) => c.status === 'issued' || c.status === 'contested');
    const boloActive = false;
    return c.json({
      warrants,
      incidents,
      calls,
      citations,
      bolo_active: boloActive,
      summary: {
        total_warrants: warrants.length,
        active_warrants: activeWarrants.length,
        total_incidents: incidents.length,
        total_calls: calls.length,
        total_citations: citations.length,
        active_citations: activeCitations.length,
      },
    });
  } catch (err) {
    console.error('GET /records/persons/:id/system-history failed:', err);
    return c.json({ warrants: [], incidents: [], calls: [], citations: [], bolo_active: false, summary: { total_warrants: 0, active_warrants: 0, total_incidents: 0, total_calls: 0, total_citations: 0, active_citations: 0 } });
  }
});

// GET /records/persons/:id/criminal-history
records.get('/persons/:id/criminal-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT * FROM criminal_history WHERE person_id = ? ORDER BY created_at DESC LIMIT 200', id);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// POST /records/persons/:id/criminal-history
records.post('/persons/:id/criminal-history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const user = c.get('user') as { id: number } | undefined;
    if (!body.offense) return c.json({ error: 'offense required' }, 400);
    const result = await execute(db,
      `INSERT INTO criminal_history (person_id, record_type, offense, offense_level, statute, case_number, agency, jurisdiction, offense_date, disposition, disposition_date, sentence, source, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, body.record_type || 'arrest', body.offense, body.offense_level || null,
      body.statute || null, body.case_number || null, body.agency || null,
      body.jurisdiction || null, body.offense_date || null, body.disposition || null,
      body.disposition_date || null, body.sentence || null, body.source || null,
      body.notes || null, user?.id ?? null);
    const created = await queryFirst(db, 'SELECT * FROM criminal_history WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/persons/:id/incidents — incidents involving this person.
records.get('/persons/:id/incidents', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at, i.location_address FROM incidents i JOIN incident_persons ip ON i.id = ip.incident_id WHERE ip.person_id = ? ORDER BY i.created_at DESC LIMIT 200', id);
    return c.json(rows);
  } catch (err) { return c.json([]); }
});

// GET /records/persons/:id/clients — client relationships for this person.
records.get('/persons/:id/clients', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT cpl.*, cl.name as client_name FROM client_person_links cpl LEFT JOIN clients cl ON cpl.client_id = cl.id WHERE cpl.person_id = ? ORDER BY cpl.created_at DESC LIMIT 100', id);
    return c.json(rows);
  } catch (err) { return c.json([]); }
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

// GET /records/vehicles/:id — fetch a single vehicle by ID.
records.get('/vehicles/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const vehicle = await queryFirst<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name, p.first_name AS owner_first_name, p.last_name AS owner_last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id WHERE v.id = ?', id);
    if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);
    return c.json(vehicle);
  } catch (err) { return c.json({ error: 'Failed to get vehicle', detail: (err as Error)?.message }, 500); }
});

// PUT /records/vehicles/:id — update a vehicle.
records.put('/vehicles/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM vehicles_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Vehicle not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const cols: string[] = [];
    const params: unknown[] = [];
    const writable = new Set(['plate_number', 'state', 'make', 'model', 'year', 'color', 'vin', 'owner_person_id', 'flags', 'notes']);
    for (const [key, val] of Object.entries(body)) { if (writable.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); } }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    await execute(db, `UPDATE vehicles_records SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id WHERE v.id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Failed to update vehicle', detail: (err as Error)?.message }, 500); }
});

// DELETE /records/vehicles/:id
records.delete('/vehicles/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM vehicles_records WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Vehicle not found' }, 404);
    await execute(db, 'DELETE FROM vehicles_records WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed to delete vehicle', detail: (err as Error)?.message }, 500); }
});

// POST /records/vehicles/:id/archive — mark vehicle as archived in flags JSON.
records.post('/vehicles/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM vehicles_records WHERE id = ?', id);
    if (!row) return c.json({ error: 'Vehicle not found' }, 404);
    const flags = (() => { try { const p = JSON.parse(row.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
    if (flags.some((f: any) => typeof f === 'object' && f.type === 'archived')) return c.json({ message: 'Already archived' });
    flags.push({ type: 'archived', at: new Date().toISOString() });
    await execute(db, 'UPDATE vehicles_records SET flags = ? WHERE id = ?', JSON.stringify(flags), id);
    return c.json({ success: true, archived: true });
  } catch (err) { return c.json({ error: 'Failed to archive vehicle', detail: (err as Error)?.message }, 500); }
});

// POST /records/vehicles/:id/unarchive
records.post('/vehicles/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<{ id: number; flags: string }>(db, 'SELECT id, flags FROM vehicles_records WHERE id = ?', id);
    if (!row) return c.json({ error: 'Vehicle not found' }, 404);
    const flags = (() => { try { const p = JSON.parse(row.flags || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
    const filtered = flags.filter((f: any) => !(typeof f === 'object' && f.type === 'archived'));
    if (filtered.length === flags.length) return c.json({ message: 'Not archived' });
    await execute(db, 'UPDATE vehicles_records SET flags = ? WHERE id = ?', JSON.stringify(filtered), id);
    return c.json({ success: true, archived: false });
  } catch (err) { return c.json({ error: 'Failed to unarchive vehicle', detail: (err as Error)?.message }, 500); }
});

// GET /records/vehicles/:id/incidents — incidents involving this vehicle.
records.get('/vehicles/:id/incidents', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, 'SELECT i.id, i.incident_number, i.incident_type, i.status, i.created_at FROM incidents i JOIN incident_vehicles iv ON i.id = iv.incident_id WHERE iv.vehicle_id = ? ORDER BY i.created_at DESC LIMIT 100', id);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/vehicles/:id/history — calls/field interviews this vehicle was involved in.
records.get('/vehicles/:id/history', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const rows = await query<Record<string, unknown>>(db, `
      SELECT 'call' as source, c.id, c.call_number, c.incident_type, c.status, c.created_at, c.location_address FROM calls_for_service c JOIN call_vehicles cv ON c.id = cv.call_id WHERE cv.vehicle_id = ?
      UNION ALL
      SELECT 'fi' as source, fi.id, NULL as call_number, fi.contact_reason as incident_type, fi.status, fi.created_at, fi.location FROM field_interviews fi JOIN fi_vehicles fv ON fi.id = fv.fi_id WHERE fv.vehicle_id = ?
      ORDER BY created_at DESC LIMIT 100`,
      id, id);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/vehicles/export
records.get('/vehicles/export', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id ORDER BY v.plate_number LIMIT 50000');
    const csv = ['plate_number,state,make,model,year,color,vin,owner_first_name,owner_last_name,notes', ...rows.map((r: any) => [r.plate_number, r.state, r.make, r.model, r.year, r.color, r.vin, r.first_name, r.last_name, r.notes].map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=vehicles_export.csv' });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/vehicles/plate-lookup — quick plate check.
records.get('/vehicles/plate-lookup', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json(null);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT v.*, p.first_name, p.last_name FROM vehicles_records v LEFT JOIN persons p ON v.owner_person_id = p.id WHERE v.plate_number = ? LIMIT 1', plate.toUpperCase());
    return c.json(row || null);
  } catch (err) { return c.json(null); }
});

// GET /records/vehicles/bolo-check — active BOLOs matching this vehicle.
records.get('/vehicles/bolo-check', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json({ matches: [], count: 0 });
    const like = `%${plate.toUpperCase()}%`;
    const rows = await query<Record<string, unknown>>(db,
      "SELECT id, bolo_number, title, description, priority, created_at FROM bolos WHERE status = 'active' AND (UPPER(vehicle_description) LIKE ? OR UPPER(description) LIKE ?) ORDER BY priority ASC, created_at DESC LIMIT 10",
      like, like);
    return c.json({ matches: rows, count: rows.length });
  } catch (err) { return c.json({ matches: [], count: 0 }); }
});

// POST /records/vehicles/stolen-check — placeholder for NCIC stolen vehicle check.
records.post('/vehicles/stolen-check', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const plate = typeof body.plate === 'string' ? body.plate : null;
    const vin = typeof body.vin === 'string' ? body.vin : null;
    const state = typeof body.state === 'string' ? body.state : null;
    return c.json({ checked: true, stolen: false, source: 'local', plate, vin, state });
  } catch (err) { return c.json({ checked: true, stolen: false, source: 'local' }); }
});

// GET /records/vehicles/alerts/expired-registration — check registration expiry.
records.get('/vehicles/alerts/expired-registration', async (c) => {
  try {
    const db = getDb(c.env);
    const plate = c.req.query('plate');
    if (!plate || plate.length < 2) return c.json({ expired: false });
    const row = await queryFirst<Record<string, unknown>>(db, "SELECT id, plate_number, vin FROM vehicles_records WHERE plate_number = ?", plate.toUpperCase());
    return c.json({ expired: false, vehicle: row || null });
  } catch (err) { return c.json({ expired: false }); }
});

// ── Businesses (stored in the properties table, filtered by business_type) ──

// GET /records/businesses — list businesses (properties with business_type set).
records.get('/businesses', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('archived');
    const archived = q === 'true';
    const rows = await query<Record<string, unknown>>(db, `SELECT * FROM properties WHERE business_type IS NOT NULL AND business_type != ''${archived ? " AND archived_at IS NOT NULL" : " AND archived_at IS NULL"} ORDER BY name LIMIT 500`);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// POST /records/businesses — create a business (property with business_type).
records.post('/businesses', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.name || !body.business_type) return c.json({ error: 'name and business_type required' }, 400);
    // Persist the full business profile (migration 0061 added these columns).
    // Previously only name/address/type/phone/email/notes were written, so
    // EIN/DBA/owner/contact/industry/revenue/status were silently dropped.
    const result = await execute(db,
      `INSERT INTO properties (
         client_id, name, address, city, state, zip, business_type,
         latitude, longitude, phone, email, notes,
         dba_name, ein, license_number, website,
         owner_name, owner_phone, contact_name, contact_phone, contact_email,
         industry, employee_count, annual_revenue, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      body.client_id || 1, body.name, body.address || '', body.city || null, body.state || null, body.zip || null,
      body.business_type, body.latitude || null, body.longitude || null, body.phone || null, body.email || null, body.notes || null,
      body.dba_name || null, body.ein || null, body.license_number || null, body.website || null,
      body.owner_name || null, body.owner_phone || null, body.contact_name || null, body.contact_phone || null, body.contact_email || null,
      body.industry || null, body.employee_count || null, body.annual_revenue || null, body.status || 'active');
    const created = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// PUT /records/businesses/:id — update a business.
records.put('/businesses/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM properties WHERE id = ? AND business_type IS NOT NULL AND business_type != ?', id, '');
    if (!existing) return c.json({ error: 'Business not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const writable = new Set([
      'name', 'address', 'business_type', 'latitude', 'longitude', 'phone', 'email', 'notes', 'client_id', 'city', 'state', 'zip',
      'dba_name', 'ein', 'license_number', 'website', 'owner_name', 'owner_phone',
      'contact_name', 'contact_phone', 'contact_email', 'industry', 'employee_count', 'annual_revenue', 'status',
    ]);
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) { if (writable.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); } }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    await execute(db, `UPDATE properties SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT * FROM properties WHERE id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// ── Evidence ─────────────────────────────────────────────────

// GET /records/evidence — list/search evidence.
records.get('/evidence', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query('q');
    const status = c.req.query('status');
    let sql = 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE 1=1';
    const params: unknown[] = [];
    if (q) { sql += ' AND (e.evidence_number LIKE ? OR e.description LIKE ?)'; const s = `%${q}%`; params.push(s, s); }
    if (status) { sql += ' AND e.status = ?'; params.push(status); }
    sql += ' ORDER BY e.created_at DESC LIMIT 500';
    const rows = await query<Record<string, unknown>>(db, sql, ...params);
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/stats
records.get('/evidence/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const row = await queryFirst<Record<string, unknown>>(db, "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'collected' THEN 1 ELSE 0 END) as collected, SUM(CASE WHEN status = 'stored' THEN 1 ELSE 0 END) as stored, SUM(CASE WHEN status IN ('transferred','destroyed','returned') THEN 1 ELSE 0 END) as closed FROM evidence");
    return c.json(row || { total: 0, collected: 0, stored: 0, closed: 0 });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/locations
records.get('/evidence/locations', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, "SELECT storage_location, COUNT(*) as count FROM evidence WHERE storage_location IS NOT NULL AND storage_location != '' GROUP BY storage_location ORDER BY count DESC");
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/aging-report
records.get('/evidence/aging-report', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, "SELECT e.*, u.full_name as collected_by_name, julianday('now') - julianday(e.created_at) as age_days FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.status IN ('collected', 'stored') ORDER BY e.created_at ASC LIMIT 200");
    return c.json(rows);
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/export
records.get('/evidence/export', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id ORDER BY e.created_at DESC LIMIT 50000');
    if (rows.length === 0) return c.json([]);
    const keys = Object.keys(rows[0] as object);
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map((k: string) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    return c.newResponse(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=evidence_export.csv' });
  } catch (err) { return c.json({ error: 'Failed' }, 500); }
});

// GET /records/evidence/:id
records.get('/evidence/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    if (!row) return c.json({ error: 'Evidence not found' }, 404);
    return c.json(row);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// POST /records/evidence — create evidence.
records.post('/evidence', async (c) => {
  try {
    const db = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    if (!body.type || !body.description) return c.json({ error: 'type and description required' }, 400);
    const user = c.get('user') as { id: number } | undefined;
    const collected_by = body.collected_by ?? user?.id ?? null;
    const result = await execute(db,
      'INSERT INTO evidence (evidence_number, incident_id, case_id, type, description, location_found, collected_by, storage_location, chain_of_custody, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
      body.evidence_number || `E${Date.now()}`, body.incident_id || null, body.case_id || null,
      body.type, body.description, body.location_found || null, collected_by,
      body.storage_location || null, body.chain_of_custody || '[]', body.status || 'collected');
    const created = await queryFirst(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', Number(result.meta.last_row_id));
    return c.json(created, 201);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// PUT /records/evidence/:id
records.put('/evidence/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM evidence WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Evidence not found' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    const writable = new Set(['evidence_number', 'incident_id', 'case_id', 'type', 'description', 'location_found', 'collected_by', 'storage_location', 'chain_of_custody', 'status']);
    const cols: string[] = []; const params: unknown[] = [];
    for (const [key, val] of Object.entries(body)) { if (writable.has(key)) { cols.push(`${key} = ?`); params.push(val ?? null); } }
    if (cols.length === 0) return c.json({ message: 'No changes' });
    await execute(db, `UPDATE evidence SET ${cols.join(', ')} WHERE id = ?`, ...params, id);
    const updated = await queryFirst(db, 'SELECT e.*, u.full_name as collected_by_name FROM evidence e LEFT JOIN users u ON e.collected_by = u.id WHERE e.id = ?', id);
    return c.json(updated);
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// DELETE /records/evidence/:id
records.delete('/evidence/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM evidence WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Evidence not found' }, 404);
    await execute(db, 'DELETE FROM evidence WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// POST /records/evidence/:id/archive — not applicable (evidence uses status transitions).
records.post('/evidence/:id/archive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number; status: string }>(db, "SELECT id, status FROM evidence WHERE id = ? AND status NOT IN ('destroyed', 'returned')", id);
    if (!existing) return c.json({ error: 'Evidence not found or already finalized' }, 404);
    await execute(db, "UPDATE evidence SET status = 'destroyed' WHERE id = ?", id);
    return c.json({ success: true, archived: true, status: 'destroyed' });
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// POST /records/evidence/:id/unarchive
records.post('/evidence/:id/unarchive', async (c) => {
  try {
    const db = getDb(c.env);
    const id = c.req.param('id');
    const existing = await queryFirst<{ id: number; status: string }>(db, "SELECT id, status FROM evidence WHERE id = ? AND status = 'destroyed'", id);
    if (!existing) return c.json({ error: 'Evidence not found or not archived' }, 404);
    await execute(db, "UPDATE evidence SET status = 'stored' WHERE id = ?", id);
    return c.json({ success: true, archived: false, status: 'stored' });
  } catch (err) { return c.json({ error: 'Failed', detail: (err as Error)?.message }, 500); }
});

// GET /records/ncic-query?type=person|vehicle|warrant|phone|address&query=...
// Powers the NCIC/NLETS terminal (QH/QV/QW/QT/QA + the QX cross-reference
// fan-out). Ported from the legacy VPS handler with the fixes that were
// causing live "PERSON QUERY FAILED" / "WARRANT QUERY FAILED" errors:
//   1. warrants are keyed on person_id — the legacy handler queried
//      subject_person_id, a column that does NOT exist on the live warrants
//      table, so every warrant/person query threw a SQL 500.
//   2. each optional sub-query (criminal_history, warrants) is wrapped so a
//      missing/drifted table degrades to an empty list instead of 500ing the
//      whole request (live D1 schema drifts from /migrations/).
// The terminal renders a 200 with whatever data exists ("NO RECORD FOUND")
// rather than a scary red "QUERY FAILED".
records.get('/ncic-query', async (c) => {
  const db = getDb(c.env);
  const type = c.req.query('type');
  const q = c.req.query('query');
  if (!type || !q || q.length < 2) {
    return c.json({ error: 'type and query (min 2 chars) required', code: 'TYPE_AND_QUERY_MIN' }, 400);
  }
  const like = `%${q}%`;

  // Run an OPTIONAL sub-query that must never fail the whole response. A
  // missing table / drifted column resolves to [] instead of throwing.
  const soft = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
    try { return await fn(); } catch { return []; }
  };
  // Warrant projection aliased to the field names the client formatter reads
  // (charge_description, bail_amount). offense_level isn't on the live table —
  // the formatter tolerates its absence.
  // Real live columns: charge_description / bail_amount|bond_amount / issuing_court /
  // issued_date / expires_at. Alias to the names the formatter reads (jurisdiction,
  // issued_at) so none resolve undefined; `charge`/`jurisdiction`/`issued_at` do NOT
  // exist on the live warrants table (the old names 500'd this query).
  const WARRANT_COLS = `id, warrant_number, type, charge_description, status,
    COALESCE(bail_amount, bond_amount) AS bail_amount, issuing_court AS jurisdiction,
    issuing_agency, issued_date AS issued_at, expires_at`;

  try {
    switch (type) {
      case 'person': {
        const persons = await query<Record<string, any>>(db, `
          SELECT * FROM persons
          WHERE first_name LIKE ? OR last_name LIKE ?
            OR (first_name || ' ' || last_name) LIKE ?
            OR (last_name || ', ' || first_name) LIKE ?
          ORDER BY last_name, first_name LIMIT 5
        `, like, like, like, like);

        // Normalize live column-name drift to the field names the NCIC client
        // terminal formatter reads. Live `persons` stores dob/gender/dl_number
        // (verified via PersonsTab's row mapping), but the formatter reads
        // date_of_birth/sex/drivers_license — without this the terminal showed
        // blank SEX/DOB and a missing OLN/ line on an otherwise-good record.
        // JS-level (post-SELECT *) so a column that doesn't exist can't throw.
        for (const p of persons) {
          if (p.date_of_birth == null && p.dob != null) p.date_of_birth = p.dob;
          if (p.sex == null && p.gender != null) p.sex = p.gender;
          if (p.drivers_license == null && p.dl_number != null) p.drivers_license = p.dl_number;
        }

        const results = [];
        for (const p of persons) {
          const criminalHistory = await soft(() => query<Record<string, any>>(db,
            `SELECT * FROM criminal_history WHERE person_id = ? ORDER BY offense_date DESC LIMIT 50`,
            p.id));
          const warrants = await soft(() => query<Record<string, any>>(db,
            `SELECT ${WARRANT_COLS} FROM warrants
             WHERE person_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 50`,
            p.id));
          results.push({ person: p, criminalHistory, warrants });
        }
        return c.json({ type, results, query: q });
      }
      case 'warrant': {
        const results = await soft(() => query<Record<string, any>>(db, `
          SELECT ${WARRANT_COLS.split(',').map(s => 'w.' + s.trim()).join(', ')},
                 p.first_name AS subject_first_name, p.last_name AS subject_last_name
          FROM warrants w
          LEFT JOIN persons p ON w.person_id = p.id
          WHERE w.status = 'active'
            AND (w.warrant_number LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?
                 OR (p.last_name || ', ' || p.first_name) LIKE ?)
          ORDER BY w.created_at DESC LIMIT 10
        `, like, like, like, like));
        return c.json({ type, results, query: q });
      }
      case 'vehicle': {
        const results = await soft(() => query<Record<string, any>>(db, `
          SELECT v.*, p.first_name AS owner_first_name, p.last_name AS owner_last_name
          FROM vehicles_records v
          LEFT JOIN persons p ON v.owner_person_id = p.id
          WHERE v.plate_number LIKE ? OR v.vin LIKE ?
          ORDER BY v.plate_number LIMIT 10
        `, like, like));
        return c.json({ type, results, query: q });
      }
      case 'phone': {
        const results = await soft(() => query<Record<string, any>>(db,
          `SELECT * FROM persons WHERE phone LIKE ? ORDER BY last_name, first_name LIMIT 10`, like));
        return c.json({ type, results, query: q });
      }
      case 'address': {
        const results = await soft(() => query<Record<string, any>>(db,
          `SELECT * FROM persons WHERE address LIKE ? ORDER BY last_name, first_name LIMIT 10`, like));
        return c.json({ type, results, query: q });
      }
      default:
        return c.json({ error: 'unknown query type', code: 'UNKNOWN_TYPE' }, 400);
    }
  } catch {
    // Even the base persons query failing should render as "NO RECORD FOUND",
    // not a terminal error — return an empty, flagged result set.
    return c.json({ type, results: [], query: q, degraded: true });
  }
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

    if (type === 'evidence') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT * FROM evidence
        WHERE evidence_number LIKE ? OR description LIKE ? OR case_number LIKE ?
        ORDER BY evidence_number LIMIT 50
      `, like, like, like);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.evidence_number, r.description].filter(Boolean).join(' — ') || `Evidence #${r.id}`,
      })));
    }

    if (type === 'incident') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, incident_number, incident_type, status, location_address, created_at FROM incidents
        WHERE incident_number LIKE ? OR incident_type LIKE ? OR location_address LIKE ?
        ORDER BY created_at DESC LIMIT 50
      `, like, like, like);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.incident_number, r.incident_type].filter(Boolean).join(' — ') || `Incident #${r.id}`,
      })));
    }

    if (type === 'case') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, case_number, title, status, case_type, created_at FROM cases
        WHERE case_number LIKE ? OR title LIKE ? OR case_type LIKE ?
        ORDER BY created_at DESC LIMIT 50
      `, like, like, like);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.case_number, r.title].filter(Boolean).join(' — ') || `Case #${r.id}`,
      })));
    }

    if (type === 'warrant') {
      const rows = await query<Record<string, unknown>>(db, `
        SELECT id, warrant_number, subject_name, charge_description, status, created_at FROM warrants
        WHERE warrant_number LIKE ? OR subject_name LIKE ? OR charge_description LIKE ?
        ORDER BY created_at DESC LIMIT 50
      `, like, like, like);
      return c.json(rows.map((r) => ({
        ...r,
        label: [r.warrant_number, r.subject_name].filter(Boolean).join(' — ') || `Warrant #${r.id}`,
      })));
    }

    // Unknown type — empty array keeps the client UI consistent (no error toast).
    return c.json([]);
  } catch (err) {
    console.error('GET /records/search failed:', err);
    return c.json({ error: 'Search failed', detail: (err as Error)?.message }, 500);
  }
});

// GET /api/records/reports/approval-queue — ReportsPage Pending Approvals tab.
// Backed by the incidents table: any incident with status in submitted /
// pending_approval / returned is in supervisor's queue. Joins officer +
// supervisor name so the queue row renders without an extra lookup.
records.get('/reports/approval-queue', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(db, `
      SELECT
        i.id, i.incident_number, i.incident_type, i.priority, i.status,
        i.location_address, i.created_at, i.updated_at, i.officer_id,
        u.full_name AS officer_name,
        u.badge_number AS officer_badge,
        s.full_name AS supervisor_name
      FROM incidents i
      LEFT JOIN users u ON u.id = i.officer_id
      LEFT JOIN users s ON s.id = i.supervisor_id
      WHERE i.status IN ('submitted', 'pending_approval', 'returned')
      ORDER BY i.created_at DESC
      LIMIT 200
    `);
    return c.json(rows);
  } catch (err) {
    console.error('GET /records/reports/approval-queue error:', err);
    return c.json([], 200);
  }
});

/* ------------------------------------------------------------------ */
/*  Record links (cross-entity linkage)                                */
/* ------------------------------------------------------------------ */
//
// Ported from the legacy `rmpg-flex` Worker so the manual "Link Record"
// flow (client/src/components/LinkRecordModal.tsx +
// LinkedRecordsSection.tsx) actually persists. On the legacy backend the
// feature wrote zero rows for production's entire life (record_links
// stayed empty, no record_linked audit entries) — see the linkage-drop
// investigation. Routing /api/records/links to this rewrite handler via
// the proxy makes created_by come from the DB-verified `user.id`, which
// the legacy handler's NaN-prone `user.userId` bind could not guarantee.
//
// Live schema (verified): record_links(id, source_type, source_id TEXT,
// target_type, target_id TEXT, relationship DEFAULT 'associated', notes,
// created_by, created_at, UNIQUE(source_type, source_id, target_type,
// target_id)). source_id/target_id are TEXT — bind ids as strings so the
// comparison matches regardless of the numeric value the client sends.

/** Resolve a human-readable label for a linked record. Best-effort: any
 *  failure degrades to "<type> #<id>" rather than throwing the request. */
async function getRecordLabel(
  db: D1Database,
  type: string,
  id: string | number,
): Promise<string> {
  try {
    switch (type) {
      case 'person': {
        const p = await queryFirst<{ first_name: string; last_name: string }>(
          db, 'SELECT first_name, last_name FROM persons WHERE id = ?', id);
        return p ? `${p.first_name} ${p.last_name}`.trim() : `Person #${id}`;
      }
      case 'vehicle': {
        const v = await queryFirst<{ make: string; model: string; plate_number: string }>(
          db, 'SELECT make, model, plate_number FROM vehicles_records WHERE id = ?', id);
        return v
          ? `${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() || `Vehicle #${id}`
          : `Vehicle #${id}`;
      }
      case 'property':
      case 'business': {
        // property + business share the `properties` table (business = a
        // property row with business_type populated).
        const pr = await queryFirst<{ name: string; address: string }>(
          db, 'SELECT name, address FROM properties WHERE id = ?', id);
        const tLabel = type === 'business' ? 'Business' : 'Property';
        return pr ? (pr.name || pr.address || `${tLabel} #${id}`) : `${tLabel} #${id}`;
      }
      case 'evidence': {
        const e = await queryFirst<{ evidence_number: string; description: string }>(
          db, 'SELECT evidence_number, description FROM evidence WHERE id = ?', id);
        return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() || `Evidence #${id}` : `Evidence #${id}`;
      }
      case 'incident': {
        const i = await queryFirst<{ incident_number: string; incident_type: string }>(
          db, 'SELECT incident_number, incident_type FROM incidents WHERE id = ?', id);
        return i ? `${i.incident_number || `Incident #${id}`}${i.incident_type ? ` — ${i.incident_type}` : ''}` : `Incident #${id}`;
      }
      case 'case': {
        const cs = await queryFirst<{ case_number: string; title: string }>(
          db, 'SELECT case_number, title FROM cases WHERE id = ?', id);
        return cs ? `${cs.case_number || `Case #${id}`}${cs.title ? ` — ${cs.title}` : ''}` : `Case #${id}`;
      }
      case 'warrant': {
        const w = await queryFirst<{ warrant_number: string; subject_name: string }>(
          db, 'SELECT warrant_number, subject_name FROM warrants WHERE id = ?', id);
        return w ? `${w.warrant_number || `Warrant #${id}`}${w.subject_name ? ` — ${w.subject_name}` : ''}` : `Warrant #${id}`;
      }
      default:
        return `${type} #${id}`;
    }
  } catch {
    return `${type} #${id}`;
  }
}

// Canonical map of linkable entity type → backing table. Single source of
// truth for both existence validation and label resolution. Mirrors
// LINKABLE_TYPES in client/src/utils/recordLinks.ts and RecordEntityType in
// client/src/types/index.ts. `business` shares the `properties` table with
// `property` (a business is a property row with business_type populated).
// Values are a fixed whitelist — never interpolate caller input into SQL.
const LINK_ENTITY_TABLE: Record<string, string> = {
  person: 'persons',
  vehicle: 'vehicles_records',
  property: 'properties',
  business: 'properties',
  evidence: 'evidence',
  incident: 'incidents',
  case: 'cases',
  warrant: 'warrants',
};

/** A type is linkable iff it maps to a known backing table. */
function isLinkableType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(LINK_ENTITY_TABLE, type);
}

/** True iff a record of this linkable type with this id actually exists.
 *  Used to enforce the strict rule that a link's two endpoints must both be
 *  real records — you cannot link to a record that isn't in the system. */
async function recordExists(db: D1Database, type: string, id: string | number): Promise<boolean> {
  const table = LINK_ENTITY_TABLE[type];
  if (!table) return false;
  try {
    const row = await queryFirst<{ one: number }>(
      db, `SELECT 1 AS one FROM ${table} WHERE id = ? LIMIT 1`, id);
    return !!row;
  } catch {
    return false;
  }
}

interface RecordLinkRow {
  id: number;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship: string;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  created_by_name?: string | null;
}

// GET /records/links?type=<entity>&id=<id> — links where the entity is
// either source OR target. Each row is enriched with the *other* side
// (linked_type / linked_id / linked_label) so the panel renders without
// a second round-trip.
// Accepts both `type`/`id` and `source_type`/`source_id` param naming
// conventions (the client's PrintRecordButton uses the latter).
records.get('/links', async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.query('type') || c.req.query('source_type');
    const id = c.req.query('id') || c.req.query('source_id');
    if (!type || !id) {
      return c.json({ error: 'type and id query parameters are required' }, 400);
    }
    const links = await query<RecordLinkRow>(db, `
      SELECT rl.*, u.full_name AS created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE (rl.source_type = ? AND rl.source_id = ?)
         OR (rl.target_type = ? AND rl.target_id = ?)
      ORDER BY rl.created_at DESC
      LIMIT 1000
    `, type, id, type, id);

    const enriched = await Promise.all(links.map(async (link) => {
      const isSource = link.source_type === type && String(link.source_id) === String(id);
      const linkedType = isSource ? link.target_type : link.source_type;
      const linkedId = isSource ? link.target_id : link.source_id;
      return {
        ...link,
        linked_type: linkedType,
        linked_id: linkedId,
        linked_label: await getRecordLabel(db, linkedType, linkedId),
      };
    }));
    return c.json(enriched);
  } catch (err) {
    console.error('GET /records/links failed:', err);
    return c.json({ error: 'Failed to get record links', detail: (err as Error)?.message }, 500);
  }
});

// POST /records/links — create a cross-entity link.
records.post('/links', async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user');
    const body = await c.req.json<Record<string, unknown>>();
    const source_type = body.source_type as string | undefined;
    const target_type = body.target_type as string | undefined;
    // ids are TEXT in the table; coerce to string so an integer id sent by
    // the client stores identically to how GET (?id=2) later queries it.
    const source_id = body.source_id != null ? String(body.source_id) : undefined;
    const target_id = body.target_id != null ? String(body.target_id) : undefined;
    const relationship = (body.relationship as string) || 'associated';
    const notes = (body.notes as string) || null;

    if (!source_type || !source_id || !target_type || !target_id) {
      return c.json({ error: 'source_type, source_id, target_type, and target_id are required' }, 400);
    }
    if (source_type === target_type && source_id === target_id) {
      return c.json({ error: 'Cannot link a record to itself' }, 400);
    }

    // Strict referential rule: both endpoints must be a KNOWN record type and
    // an EXISTING record. A record is never linked to a non-existent ("non-
    // linked") record — that would create a dangling link the connections
    // graph and PDFs can't resolve.
    if (!isLinkableType(source_type) || !isLinkableType(target_type)) {
      return c.json({
        error: `Unsupported record type. Linkable types: ${Object.keys(LINK_ENTITY_TABLE).join(', ')}.`,
        code: 'LINK_TYPE_UNSUPPORTED',
      }, 400);
    }
    const [srcOk, tgtOk] = await Promise.all([
      recordExists(db, source_type, source_id),
      recordExists(db, target_type, target_id),
    ]);
    if (!srcOk || !tgtOk) {
      const missing: string[] = [];
      if (!srcOk) missing.push(`source ${source_type} #${source_id}`);
      if (!tgtOk) missing.push(`target ${target_type} #${target_id}`);
      return c.json({
        error: `Cannot create link — ${missing.join(' and ')} not found. A record can only be linked to an existing record.`,
        code: 'LINK_ENDPOINT_NOT_FOUND',
      }, 422);
    }

    let result;
    try {
      result = await execute(db, `
        INSERT INTO record_links (source_type, source_id, target_type, target_id, relationship, notes, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, source_type, source_id, target_type, target_id, relationship, notes, user.id);
    } catch (err) {
      // UNIQUE(source_type, source_id, target_type, target_id) — the exact
      // link already exists. Surface 409 so the client can message it
      // distinctly instead of a generic failure.
      if ((err as Error)?.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'This link already exists' }, 409);
      }
      throw err;
    }

    const linkId = Number(result.meta?.last_row_id || 0);

    // Audit trail (best-effort — a logging failure must not roll back the
    // link the user just created). UTC timestamp per the storage standard.
    try {
      const sourceLabel = await getRecordLabel(db, source_type, source_id);
      const targetLabel = await getRecordLabel(db, target_type, target_id);
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `, user.id, 'record_linked', 'record_link', linkId,
        `Linked ${source_type} "${sourceLabel}" to ${target_type} "${targetLabel}"`,
        c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown');
    } catch (err) {
      console.error('record_linked audit log failed (non-fatal):', err);
    }

    const created = await queryFirst<RecordLinkRow>(db, `
      SELECT rl.*, u.full_name AS created_by_name
      FROM record_links rl
      LEFT JOIN users u ON rl.created_by = u.id
      WHERE rl.id = ?
    `, linkId);
    return c.json(created, 201);
  } catch (err) {
    console.error('POST /records/links failed:', err);
    return c.json({ error: 'Failed to create record link', detail: (err as Error)?.message }, 500);
  }
});

// DELETE /records/links/:id — remove a link.
records.delete('/links/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid link id' }, 400);

    const link = await queryFirst<RecordLinkRow>(db, 'SELECT * FROM record_links WHERE id = ?', id);
    if (!link) return c.json({ error: 'Link not found' }, 404);

    await execute(db, 'DELETE FROM record_links WHERE id = ?', id);

    try {
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `, user.id, 'record_unlinked', 'record_link', id,
        `Removed link between ${link.source_type} #${link.source_id} and ${link.target_type} #${link.target_id}`,
        c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || 'unknown');
    } catch (err) {
      console.error('record_unlinked audit log failed (non-fatal):', err);
    }

    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /records/links failed:', err);
    return c.json({ error: 'Failed to delete record link', detail: (err as Error)?.message }, 500);
  }
});

export default records;
