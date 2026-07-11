// ============================================================
// RMPG Flex — Animal Control Case Management
// ============================================================
// Backs client/src/pages/AnimalControlPage.tsx. Was a fully-built
// client page with zero matching route. Migration
// 0167_impounds_pawn_tips_crash_animal.sql.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const animalControl = new Hono<Env>();

const WRITE = ['admin', 'manager', 'supervisor', 'officer'];

function requireRole(c: { get: (k: 'user') => { role: string } | undefined }, ...roles: string[]): string | null {
  const u = c.get('user');
  if (!u || !roles.includes(u.role)) return 'Insufficient role';
  return null;
}

async function generateCaseNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `AC-${yy}-`;
  const last = await queryFirst<{ case_number: string }>(
    db, 'SELECT case_number FROM animal_control_cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1', `${prefix}%`);
  let next = 1;
  if (last?.case_number) {
    const m = last.case_number.match(/^AC-\d{2}-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// GET / — paginated list, filterable by search/case_type/status
animalControl.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const { search, case_type, status } = c.req.query();
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('per_page') || '50', 10) || 50));
    const offset = (page - 1) * perPage;
    const conditions: string[] = ['1=1']; const params: unknown[] = [];
    if (search) {
      conditions.push('(case_number LIKE ? OR animal_name LIKE ? OR owner_last_name LIKE ? OR location LIKE ?)');
      const s = `%${search}%`; params.push(s, s, s, s);
    }
    if (case_type) { conditions.push('case_type = ?'); params.push(case_type); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    const where = conditions.join(' AND ');
    const count = await queryFirst<{ total: number }>(db, `SELECT COUNT(*) as total FROM animal_control_cases WHERE ${where}`, ...params);
    const rows = await query<Record<string, unknown>>(db,
      `SELECT * FROM animal_control_cases WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, perPage, offset);
    const total = count?.total ?? 0;
    return c.json({ data: rows, pagination: { page, per_page: perPage, total, totalPages: Math.ceil(total / perPage) } });
  } catch (err) {
    return c.json({ error: 'Failed to list cases' }, 500);
  }
});

// POST / — create
animalControl.post('/', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const b = await c.req.json<Record<string, any>>();
    const caseNumber = await generateCaseNumber(db);
    const result = await execute(db,
      `INSERT INTO animal_control_cases (
        case_number, case_type, status, animal_type, breed, animal_name, animal_color, animal_sex, animal_weight,
        microchip_id, rabies_tag, owner_first_name, owner_last_name, owner_phone, owner_address,
        location, description, notes, officer_name, assigned_officer_id, quarantine_start, quarantine_end
      ) VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?)`,
      caseNumber, b.case_type ?? 'complaint', b.status ?? 'open', b.animal_type ?? null, b.breed ?? null, b.animal_name ?? null, b.animal_color ?? null, b.animal_sex ?? null, b.animal_weight ?? null,
      b.microchip_id ?? null, b.rabies_tag ?? null, b.owner_first_name ?? null, b.owner_last_name ?? null, b.owner_phone ?? null, b.owner_address ?? null,
      b.location ?? null, b.description ?? null, b.notes ?? null, b.officer_name ?? null, b.assigned_officer_id ?? null, b.quarantine_start ?? null, b.quarantine_end ?? null,
    );
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM animal_control_cases WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create case' }, 500);
  }
});

// PUT /:id — update
animalControl.put('/:id', async (c) => {
  const denied = requireRole(c, ...WRITE);
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const b = await c.req.json<Record<string, any>>();
    const updatable = new Set([
      'case_type', 'status', 'animal_type', 'breed', 'animal_name', 'animal_color', 'animal_sex', 'animal_weight',
      'microchip_id', 'rabies_tag', 'owner_first_name', 'owner_last_name', 'owner_phone', 'owner_address',
      'location', 'description', 'notes', 'officer_name', 'assigned_officer_id', 'quarantine_start', 'quarantine_end',
    ]);
    const sets: string[] = []; const vals: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { if (updatable.has(k)) { sets.push(`${k} = ?`); vals.push(v ?? null); } }
    if (!sets.length) return c.json({ error: 'No fields' }, 400);
    sets.push(`updated_at = datetime('now','localtime')`); vals.push(id);
    await execute(db, `UPDATE animal_control_cases SET ${sets.join(', ')} WHERE id = ?`, ...vals);
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM animal_control_cases WHERE id = ?', id);
    if (!updated) return c.json({ error: 'Not found' }, 404);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to update case' }, 500);
  }
});

// DELETE /:id
animalControl.delete('/:id', async (c) => {
  const denied = requireRole(c, 'admin', 'manager');
  if (denied) return c.json({ error: denied }, 403);
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    const result = await execute(db, 'DELETE FROM animal_control_cases WHERE id = ?', id);
    if (result.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete case' }, 500);
  }
});

export default animalControl;
