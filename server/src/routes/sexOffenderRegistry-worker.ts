// Sex Offender Registry routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow } from '../worker-middleware/d1Helpers';

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

function escapeCsvValue(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function mountSexOffenderRegistryRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  api.get('/stats', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const total = (await db.prepare('SELECT COUNT(*) as count FROM sex_offender_registry').get() as any)?.count || 0;
      const tierCounts = await db.prepare('SELECT tier, COUNT(*) as count FROM sex_offender_registry GROUP BY tier ORDER BY tier').all() as any[];
      const statusCounts = await db.prepare('SELECT registration_status, COUNT(*) as count FROM sex_offender_registry GROUP BY registration_status').all() as any[];
      const nonCompliant = (await db.prepare("SELECT COUNT(*) as count FROM sex_offender_registry WHERE registration_status IN ('non_compliant', 'absconded')").get() as any)?.count || 0;
      const dueForVerification = (await db.prepare("SELECT COUNT(*) as count FROM sex_offender_registry WHERE next_verification_due IS NOT NULL AND next_verification_due <= DATE('now', '+30 days')").get() as any)?.count || 0;
      return c.json({ data: { total, by_tier: Object.fromEntries(tierCounts.map(r => [r.tier, r.count])), by_status: Object.fromEntries(statusCounts.map(r => [r.registration_status, r.count])), non_compliant: nonCompliant, due_for_verification: dueForVerification } });
    } catch {
      return c.json({ error: 'Failed to sor stats', code: 'SOR_STATS_ERROR' }, 500);
    }
  });

  api.get('/', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const pageNum = Math.max(1, parseInt(q.page || '1', 10) || 1);
      const limitNum = Math.min(100000, Math.max(1, parseInt(q.limit || '100000', 10) || 100000));
      const offset = (pageNum - 1) * limitNum;
      let where = 'WHERE 1=1';
      const params: any[] = [];
      if (q.tier) { where += ' AND s.tier = ?'; params.push(parseInt(q.tier, 10)); }
      if (q.status) { where += ' AND s.registration_status = ?'; params.push(q.status); }
      if (q.risk_level) { where += ' AND s.risk_level = ?'; params.push(q.risk_level); }
      if (q.search) {
        where += " AND (s.first_name LIKE ? ESCAPE '\\' OR s.last_name LIKE ? ESCAPE '\\' OR s.registry_id LIKE ? ESCAPE '\\' OR s.aliases LIKE ? ESCAPE '\\')";
        const s2 = `%${escapeLike(String(q.search))}%`;
        params.push(s2, s2, s2, s2);
      }
      const total = (await db.prepare(`SELECT COUNT(*) as count FROM sex_offender_registry s ${where}`).get(...params) as any)?.count || 0;
      const rows = await db.prepare(`
        SELECT s.* FROM sex_offender_registry s ${where} ORDER BY
          CASE s.registration_status WHEN 'absconded' THEN 0 WHEN 'non_compliant' THEN 1 WHEN 'compliant' THEN 2 WHEN 'incarcerated' THEN 3 ELSE 4 END,
          s.tier DESC, s.last_name, s.first_name LIMIT ? OFFSET ?
      `).all(...params, limitNum, offset);
      return c.json({ data: rows, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
    } catch {
      return c.json({ error: 'Failed to sor list', code: 'SOR_LIST_ERROR' }, 500);
    }
  });

  api.get('/:id', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id) || id < 1) return c.json({ error: 'Invalid ID parameter' }, 400);
      const row = await db.prepare('SELECT * FROM sex_offender_registry WHERE id = ?').get(id);
      if (!row) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
      return c.json({ data: row });
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.post('/', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const body = await c.req.json();
      const { person_id, registry_id, first_name, last_name, middle_name, aliases, dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos, photo_url, tier, risk_level, registration_status, registration_date, expiration_date, last_verification, next_verification_due, registration_jurisdiction, offenses, conviction_state, addresses, vehicles, employer, employer_address, school, school_address, restrictions, conditions, supervising_officer, source, notes } = body;
      if (!first_name || !last_name) return c.json({ error: 'First and last name required', code: 'FIRST_AND_LAST_NAME' }, 400);
      if (tier !== undefined && tier !== null) {
        const t = Number(tier);
        if (!Number.isInteger(t) || t < 1 || t > 3) return c.json({ error: 'Tier must be 1, 2, or 3', code: 'TIER_MUST_BE_1' }, 400);
      }
      const VALID_REG_STATUSES = ['compliant', 'non_compliant', 'absconded', 'incarcerated', 'deceased', 'removed'];
      if (registration_status && !VALID_REG_STATUSES.includes(registration_status)) return c.json({ error: `Invalid registration_status. Must be one of: ${VALID_REG_STATUSES.join(', ')}` }, 400);
      const VALID_RISK = ['low', 'moderate', 'high'];
      if (risk_level && !VALID_RISK.includes(risk_level)) return c.json({ error: `Invalid risk_level. Must be one of: ${VALID_RISK.join(', ')}` }, 400);
      if (first_name.length > 200 || last_name.length > 200) return c.json({ error: 'Name fields must be 200 characters or less', code: 'NAME_FIELDS_MUST_BE' }, 400);
      const result = await db.prepare(`
        INSERT INTO sex_offender_registry (person_id, registry_id, first_name, last_name, middle_name, aliases, dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos, photo_url, tier, risk_level, registration_status, registration_date, expiration_date, last_verification, next_verification_due, registration_jurisdiction, offenses, conviction_state, addresses, vehicles, employer, employer_address, school, school_address, restrictions, conditions, supervising_officer, source, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(person_id || null, registry_id || null, first_name, last_name, middle_name || null, typeof aliases === 'string' ? aliases : JSON.stringify(aliases || []), dob || null, gender || null, race || null, height || null, weight || null, hair_color || null, eye_color || null, scars_marks_tattoos || null, photo_url || null, tier ?? 1, risk_level || null, registration_status || 'compliant', registration_date || null, expiration_date || null, last_verification || null, next_verification_due || null, registration_jurisdiction || null, typeof offenses === 'string' ? offenses : JSON.stringify(offenses || []), conviction_state || null, typeof addresses === 'string' ? addresses : JSON.stringify(addresses || []), typeof vehicles === 'string' ? vehicles : JSON.stringify(vehicles || []), employer || null, employer_address || null, school || null, school_address || null, restrictions || null, typeof conditions === 'string' ? conditions : JSON.stringify(conditions || []), supervising_officer || null, source || 'manual', notes || null, user.userId, now, now);
      const recId = Number(result.meta.last_row_id);
      if (person_id) { try { await db.prepare('UPDATE persons SET is_sex_offender = 1, updated_at = ? WHERE id = ?').run(now, person_id); } catch { /* silent */ } }
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'create', 'sex_offender_registry', ?, ?, ?)`).run(user.userId, recId, JSON.stringify({ first_name, last_name, tier, registration_status: registration_status || 'compliant' }), now);
      return c.json({ data: { id: recId } }, 201);
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint')) return c.json({ error: 'Registry ID already exists', code: 'REGISTRY_ID_ALREADY_EXISTS' }, 409);
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  api.put('/:id', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      if (isNaN(id) || id < 1) return c.json({ error: 'Invalid ID parameter' }, 400);
      const body = await c.req.json();
      const allowedFields = ['person_id', 'registry_id', 'first_name', 'last_name', 'middle_name', 'dob', 'gender', 'race', 'height', 'weight', 'hair_color', 'eye_color', 'scars_marks_tattoos', 'photo_url', 'tier', 'risk_level', 'registration_status', 'registration_date', 'expiration_date', 'last_verification', 'next_verification_due', 'registration_jurisdiction', 'conviction_state', 'employer', 'employer_address', 'school', 'school_address', 'restrictions', 'supervising_officer', 'source', 'notes'];
      const jsonFields = ['aliases', 'offenses', 'addresses', 'vehicles', 'conditions'];
      const updates: string[] = ['updated_at = ?'];
      const params: any[] = [now];
      for (const f of allowedFields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); } }
      for (const f of jsonFields) { if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(typeof body[f] === 'string' ? body[f] : JSON.stringify(body[f])); } }
      params.push(id);
      await db.prepare(`UPDATE sex_offender_registry SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'update', 'sex_offender_registry', ?, '{}', ?)`).run(user.userId, id, now);
      return c.json({ data: { id } });
    } catch {
      return c.json({ error: 'Failed to sor update', code: 'SOR_UPDATE_ERROR' }, 500);
    }
  });

  api.put('/:id/verify', requireRole('admin', 'manager', 'supervisor', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const id = paramNum(c.req.param('id'));
      if (isNaN(id) || id < 1) return c.json({ error: 'Invalid ID parameter' }, 400);
      const body = await c.req.json();
      const { status, notes } = body;
      if (status) {
        const VALID_V_STATUSES = ['compliant', 'non_compliant', 'absconded', 'incarcerated', 'verified'];
        if (!VALID_V_STATUSES.includes(status)) return c.json({ error: `Invalid verification status. Must be one of: ${VALID_V_STATUSES.join(', ')}` }, 400);
      }
      const record = await db.prepare('SELECT tier FROM sex_offender_registry WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);
      const intervalDays = record.tier === 3 ? 90 : record.tier === 2 ? 180 : 365;
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + intervalDays);
      const nextDueStr = nextDue.toISOString().split('T')[0];
      const updates: string[] = ['last_verification = ?', 'next_verification_due = ?', 'updated_at = ?'];
      const params: any[] = [now, nextDueStr, now];
      if (status) { updates.push('registration_status = ?'); params.push(status); }
      if (notes) { updates.push('notes = ?'); params.push(notes); }
      params.push(id);
      await db.prepare(`UPDATE sex_offender_registry SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'verify', 'sex_offender_registry', ?, ?, ?)`).run(user.userId, id, JSON.stringify({ status: status || 'verified', next_due: nextDueStr }), now);
      return c.json({ data: { id, last_verification: now, next_verification_due: nextDueStr } });
    } catch {
      return c.json({ error: 'Failed to sor verify', code: 'SOR_VERIFY_ERROR' }, 500);
    }
  });

  api.post('/import', requireRole('admin'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const body = await c.req.json();
      const { records } = body;
      if (!Array.isArray(records) || records.length === 0) return c.json({ error: 'Records array required', code: 'RECORDS_ARRAY_REQUIRED' }, 400);
      if (records.length > 5000) return c.json({ error: 'Maximum 5000 records per import', code: 'MAXIMUM_5000_RECORDS_PER' }, 400);
      const insert = db.prepare(`
        INSERT OR IGNORE INTO sex_offender_registry (registry_id, first_name, last_name, middle_name, aliases, dob, gender, race, height, weight, hair_color, eye_color, scars_marks_tattoos, photo_url, tier, risk_level, registration_status, registration_date, expiration_date, registration_jurisdiction, offenses, conviction_state, addresses, vehicles, employer, employer_address, restrictions, supervising_officer, source, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let imported = 0;
      let skipped = 0;
      for (const r of records) {
        if (!r.first_name || !r.last_name) { skipped++; continue; }
        try {
          const result = await insert.run(r.registry_id || null, r.first_name, r.last_name, r.middle_name || null, typeof r.aliases === 'string' ? r.aliases : JSON.stringify(r.aliases || []), r.dob || null, r.gender || null, r.race || null, r.height || null, r.weight || null, r.hair_color || null, r.eye_color || null, r.scars_marks_tattoos || null, r.photo_url || null, r.tier ?? 1, r.risk_level || null, r.registration_status || 'compliant', r.registration_date || null, r.expiration_date || null, r.registration_jurisdiction || null, typeof r.offenses === 'string' ? r.offenses : JSON.stringify(r.offenses || []), r.conviction_state || null, typeof r.addresses === 'string' ? r.addresses : JSON.stringify(r.addresses || []), typeof r.vehicles === 'string' ? r.vehicles : JSON.stringify(r.vehicles || []), r.employer || null, r.employer_address || null, r.restrictions || null, r.supervising_officer || null, 'csv_import', user.userId, now, now);
          if (result.meta.changes > 0) imported++; else skipped++;
        } catch { skipped++; }
      }
      await db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at) VALUES (?, 'import', 'sex_offender_registry', 0, ?, ?)`).run(user.userId, JSON.stringify({ imported, skipped, total: records.length }), now);
      return c.json({ data: { imported, skipped, total: records.length } });
    } catch {
      return c.json({ error: 'Failed to sor import', code: 'SOR_IMPORT_ERROR' }, 500);
    }
  });

  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT id, registry_id, first_name, last_name, middle_name, aliases, dob, gender, race, height, weight, hair_color, eye_color, tier, risk_level, registration_status, registration_date, expiration_date, last_verification, next_verification_due, registration_jurisdiction, conviction_state, employer, employer_address, school, school_address, restrictions, supervising_officer, source, notes, created_at
        FROM sex_offender_registry ORDER BY last_name, first_name LIMIT 10000
      `).all() as any[];
      const columns = [
        { key: 'id', header: 'ID' }, { key: 'registry_id', header: 'Registry ID' }, { key: 'first_name', header: 'First Name' },
        { key: 'last_name', header: 'Last Name' }, { key: 'middle_name', header: 'Middle Name' }, { key: 'aliases', header: 'Aliases' },
        { key: 'dob', header: 'DOB' }, { key: 'gender', header: 'Gender' }, { key: 'race', header: 'Race' },
        { key: 'tier', header: 'Tier' }, { key: 'risk_level', header: 'Risk Level' }, { key: 'registration_status', header: 'Registration Status' },
        { key: 'registration_date', header: 'Registration Date' }, { key: 'expiration_date', header: 'Expiration Date' },
        { key: 'last_verification', header: 'Last Verification' }, { key: 'next_verification_due', header: 'Next Verification Due' },
        { key: 'registration_jurisdiction', header: 'Jurisdiction' }, { key: 'conviction_state', header: 'Conviction State' },
        { key: 'employer', header: 'Employer' }, { key: 'supervising_officer', header: 'Supervising Officer' },
        { key: 'source', header: 'Source' }, { key: 'notes', header: 'Notes' }, { key: 'created_at', header: 'Created At' },
      ];
      const bom = '\uFEFF';
      const headerRow = columns.map(col => escapeCsvValue(col.header)).join(',');
      const dataRows = rows.map(row => columns.map(col => escapeCsvValue(row[col.key])).join(','));
      const csv = bom + [headerRow, ...dataRows].join('\r\n');
      return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sex_offender_registry_export.csv"' });
    } catch {
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  app.route('/api/sex-offender-registry', api);
}
