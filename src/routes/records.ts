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
      case 'property': {
        const pr = await queryFirst<{ name: string }>(
          db, 'SELECT name FROM properties WHERE id = ?', id);
        return pr?.name || `Property #${id}`;
      }
      case 'evidence': {
        const e = await queryFirst<{ evidence_number: string; description: string }>(
          db, 'SELECT evidence_number, description FROM evidence WHERE id = ?', id);
        return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() || `Evidence #${id}` : `Evidence #${id}`;
      }
      default:
        return `${type} #${id}`;
    }
  } catch {
    return `${type} #${id}`;
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
records.get('/links', async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.query('type');
    const id = c.req.query('id');
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
