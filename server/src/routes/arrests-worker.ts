// ============================================================
// Arrest Records — Workers (Hono) Port
// Manual booking CRUD, CSV import, search, status, export,
// booking checklist, property inventory, Miranda rights.
// Skips: scraper sync, auditLog, broadcast, notifications, csvExport.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, safeStr } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

function splitName(fullName: string): { first: string; middle: string; last: string } {
  const cleaned = (fullName || '').trim();
  if (!cleaned) return { first: '', middle: '', last: '' };
  if (cleaned.includes(',')) {
    const [last, rest] = cleaned.split(',', 2).map(s => s.trim());
    const parts = (rest || '').split(/\s+/);
    return { first: parts[0] || '', middle: parts.slice(1).join(' '), last };
  }
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
}

export function mountArrestsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // === POST /manual — Create manual booking ===
  api.post('/manual', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const b = await c.req.json();

      const fullName = safeStr(b.full_name);
      if (!fullName || fullName.length < 2) {
        return c.json({ error: 'Full name is required (min 2 characters)', code: 'FULL_NAME_IS_REQUIRED' }, 400);
      }

      const { first, middle, last } = splitName(fullName);
      const charges = Array.isArray(b.charges) ? JSON.stringify(b.charges.slice(0, 100))
        : typeof b.charges === 'string' ? b.charges : '[]';

      const jailbaseId = `manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

      const result = await db.prepare(`
        INSERT INTO arrest_records (
          jailbase_id, source_id, source_name,
          full_name, first_name, last_name, middle_name,
          date_of_birth, booking_date, release_date,
          charges, county, state, status, booking_number, agency,
          gender, race, height, weight, hair_color, eye_color,
          address, bail_amount, hold_reason, notes,
          entry_source, entered_by, created_at, updated_at
        ) VALUES (
          ?, 'manual', 'Manual Entry',
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          'manual', ?, ?, ?
        )
      `).run(
        jailbaseId,
        fullName, first || b.first_name || '', last || b.last_name || '', middle || b.middle_name || '',
        b.date_of_birth || null, b.booking_date || now, b.release_date || null,
        charges, b.county || '', b.state || 'UT',
        b.status || 'active', b.booking_number || null, b.agency || null,
        b.gender || null, b.race || null, b.height || null, b.weight || null,
        b.hair_color || null, b.eye_color || null,
        b.address || null, b.bail_amount ?? null, b.hold_reason || null, b.notes || null,
        user.userId, now, now,
      );

      const newId = result.meta.last_row_id || 1;

      return c.json({ success: true, id: newId, message: 'Booking record created' }, 201);
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === PUT /manual/:id — Update booking record ===
  api.put('/manual/:id', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT id FROM arrest_records WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      const b = await c.req.json();
      const updates: string[] = [];
      const params: any[] = [];

      const fields: Record<string, any> = {
        full_name: b.full_name, first_name: b.first_name, last_name: b.last_name, middle_name: b.middle_name,
        date_of_birth: b.date_of_birth, booking_date: b.booking_date, release_date: b.release_date,
        county: b.county, state: b.state, status: b.status, booking_number: b.booking_number, agency: b.agency,
        gender: b.gender, race: b.race, height: b.height, weight: b.weight,
        hair_color: b.hair_color, eye_color: b.eye_color, address: b.address,
        hold_reason: b.hold_reason, notes: b.notes,
      };

      for (const [col, val] of Object.entries(fields)) {
        if (val !== undefined) {
          updates.push(`${col} = ?`);
          params.push(val);
        }
      }

      if (b.bail_amount !== undefined) {
        updates.push('bail_amount = ?');
        params.push(b.bail_amount != null && !isNaN(parseFloat(b.bail_amount)) && isFinite(parseFloat(b.bail_amount)) ? parseFloat(b.bail_amount) : null);
      }

      if (b.charges !== undefined) {
        updates.push('charges = ?');
        params.push(Array.isArray(b.charges) ? JSON.stringify(b.charges) : b.charges);
      }

      if (b.full_name && !b.first_name && !b.last_name) {
        const { first, middle, last } = splitName(b.full_name);
        updates.push('first_name = ?', 'last_name = ?', 'middle_name = ?');
        params.push(first, last, middle);
      }

      if (updates.length === 0) {
        return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);
      }

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      await db.prepare(`UPDATE arrest_records SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      return c.json({ success: true, message: 'Record updated' });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === DELETE /manual/:id — Delete booking record ===
  api.delete('/manual/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const existing = await db.prepare('SELECT id FROM arrest_records WHERE id = ?').get(id);
      if (!existing) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      await db.prepare('DELETE FROM arrest_cross_links WHERE arrest_record_id = ?').run(id);
      await db.prepare('DELETE FROM arrest_records WHERE id = ?').run(id);

      return c.json({ success: true, message: 'Record deleted' });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /manual/:id — Get single booking record ===
  api.get('/manual/:id', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);

      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      try { record.charges = JSON.parse(record.charges || '[]'); } catch { record.charges = []; }

      const links = await db.prepare(`
        SELECT linked_type, linked_id, match_type, match_confidence, created_at
        FROM arrest_cross_links WHERE arrest_record_id = ? LIMIT 1000
      `).all(id);

      return c.json({ ...record, cross_links: links });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === POST /import-csv — Bulk import CSV records ===
  api.post('/import-csv', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const user = c.get('user');
      const { records, county, agency } = await c.req.json();

      if (!Array.isArray(records) || records.length === 0) {
        return c.json({ error: 'records array is required and must not be empty', code: 'RECORDS_ARRAY_IS_REQUIRED' }, 400);
      }
      if (records.length > 500) {
        return c.json({ error: 'Maximum 500 records per import', code: 'MAXIMUM_500_RECORDS_PER' }, 400);
      }

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        try {
          const fullName = (
            r.full_name || r.name || r.Name || r.FULL_NAME || r.INMATE_NAME ||
            `${r.first_name || r.FirstName || r.FIRST_NAME || ''} ${r.last_name || r.LastName || r.LAST_NAME || ''}`.trim()
          );

          if (!fullName || fullName.length < 2) { skipped++; continue; }

          const { first, middle, last } = splitName(fullName);
          const charges = r.charges || r.Charges || r.CHARGES || r.offense || r.Offense || '';
          const chargesJson = Array.isArray(charges) ? JSON.stringify(charges)
            : typeof charges === 'string' && charges ? JSON.stringify([charges]) : '[]';

          await db.prepare(`
            INSERT INTO arrest_records (
              jailbase_id, source_id, source_name,
              full_name, first_name, last_name, middle_name,
              date_of_birth, booking_date, release_date,
              charges, county, state, status, booking_number, agency,
              gender, race, height, weight, hair_color, eye_color,
              address, bail_amount, hold_reason, notes,
              entry_source, entered_by, created_at, updated_at
            ) VALUES (
              ?, 'csv-import', ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'csv', ?, ?, ?
            )
          `).run(
            `csv-${Date.now()}-${i}-${crypto.randomUUID().slice(0, 6)}`,
            `CSV Import (${agency || county || 'Unknown'})`,
            fullName,
            r.first_name || r.FirstName || r.FIRST_NAME || first || '',
            r.last_name || r.LastName || r.LAST_NAME || last || '',
            r.middle_name || r.MiddleName || r.MIDDLE_NAME || middle || '',
            r.date_of_birth || r.dob || r.DOB || r.DateOfBirth || null,
            r.booking_date || r.BookingDate || r.BOOKING_DATE || r.arrest_date || now,
            r.release_date || r.ReleaseDate || r.RELEASE_DATE || null,
            chargesJson,
            r.county || county || '',
            r.state || 'UT',
            r.status || 'active',
            r.booking_number || r.BookingNumber || r.BOOKING_NUMBER || r.booking_id || null,
            r.agency || agency || null,
            r.gender || r.Gender || r.GENDER || r.sex || r.Sex || null,
            r.race || r.Race || r.RACE || null,
            r.height || r.Height || r.HEIGHT || null,
            r.weight || r.Weight || r.WEIGHT || null,
            r.hair_color || r.HairColor || r.HAIR_COLOR || null,
            r.eye_color || r.EyeColor || r.EYE_COLOR || null,
            r.address || r.Address || r.ADDRESS || null,
            (() => { const v = parseFloat(r.bail_amount ?? r.BailAmount ?? r.BAIL_AMOUNT); return isNaN(v) || !isFinite(v) ? null : v; })(),
            r.hold_reason || r.HoldReason || null,
            r.notes || null,
            user.userId, now, now,
          );
          imported++;
        } catch (rowErr: any) {
          skipped++;
          if (errors.length < 5) errors.push(`Row ${i + 1}: Import failed`);
        }
      }

      return c.json({
        success: true, imported, skipped, total: records.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Imported ${imported} of ${records.length} records`,
      });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /status — Configuration + roster status ===
  api.get('/status', async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const manualCount = (await db.prepare("SELECT COUNT(*) as c FROM arrest_records WHERE entry_source = 'manual'").get() as any)?.c || 0;
      const csvCount = (await db.prepare("SELECT COUNT(*) as c FROM arrest_records WHERE entry_source = 'csv'").get() as any)?.c || 0;
      const totalRecords = (await db.prepare('SELECT COUNT(*) as c FROM arrest_records').get() as any)?.c || 0;

      return c.json({
        configured: false,
        enabled: false,
        enabledCounties: [],
        lastSync: null,
        recordsCount: totalRecords,
        manualCount,
        csvCount,
        apiCount: totalRecords - manualCount - csvCount,
        countiesSynced: 0,
        status: 'manual_only',
        lastError: null,
        apiOffline: false,
      });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /search — Search arrest records by name ===
  api.get('/search', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const name = (c.req.query('name') || '').trim();
      if (!name || name.length < 2) return c.json({ error: 'Name required (min 2 characters)', code: 'NAME_REQUIRED_MIN_2' }, 400);

      const likeName = `%${name}%`;
      const records = await db.prepare(`
        SELECT ar.* FROM arrest_records ar
        WHERE ar.full_name LIKE ?1 OR ar.first_name LIKE ?1 OR ar.last_name LIKE ?1
        ORDER BY ar.booking_date DESC LIMIT 100
      `).all(likeName) as any[];

      const sourceFilter = (c.req.query('source') || '').trim();
      const countyFilter = (c.req.query('source_id') || '').trim();
      let filtered = records;
      if (sourceFilter || countyFilter) {
        filtered = filtered.filter((r: any) => {
          if (sourceFilter && r.entry_source !== sourceFilter) return false;
          if (countyFilter && r.source_id !== countyFilter) return false;
          return true;
        });
      }

      return c.json({ records: filtered, resultCount: filtered.length });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET / — List arrests ===
  api.get('/', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const { status, limit = '50', offset = '0' } = c.req.query();
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 50));
      const offsetNum = parseInt(offset as string, 10) || 0;
      let sql = 'SELECT ar.*, u.full_name as entered_by_name FROM arrest_records ar LEFT JOIN users u ON ar.entered_by = u.id';
      const params: any[] = [];
      const where: string[] = [];
      if (status) { where.push('ar.status = ?'); params.push(status); }
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY ar.created_at DESC LIMIT ? OFFSET ?';
      params.push(limitNum, offsetNum);
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'Failed to load arrests', code: 'ARREST_LOAD_ERROR' }, 500);
    }
  });

  // === GET /recent — Recent arrests (paginated, filterable) ===
  api.get('/recent', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const county = (c.req.query('county') || '').trim();
      const source = (c.req.query('source') || '').trim();
      const statusFilter = (c.req.query('status') || '').trim();
      const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
      const limit = Math.min(100000, Math.max(1, parseInt(c.req.query('limit') || '100000', 10) || 100000));
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const params: any[] = [];

      const sourceId = (c.req.query('source_id') || '').trim();
      const stateFilter = (c.req.query('state') || '').trim().toUpperCase();
      if (county) { conditions.push('ar.county = ?'); params.push(county); }
      if (sourceId) { conditions.push('ar.source_id = ?'); params.push(sourceId); }
      if (stateFilter) { conditions.push('ar.state = ?'); params.push(stateFilter); }
      if (source === 'manual') { conditions.push("ar.entry_source = 'manual'"); }
      else if (source === 'csv') { conditions.push("ar.entry_source = 'csv'"); }
      else if (source === 'scraper') { conditions.push("ar.entry_source = 'scraper'"); }
      else if (source === 'api') { conditions.push("(ar.entry_source IS NULL OR ar.entry_source = 'api')"); }
      if (statusFilter) { conditions.push('ar.status = ?'); params.push(statusFilter); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM arrest_records ar ${where}`).get(...params) as any;
      const total = totalRow?.c || 0;

      const records = await db.prepare(`
        SELECT ar.*, p.first_name AS linked_first, p.last_name AS linked_last
        FROM arrest_records ar
        LEFT JOIN persons p ON ar.person_id = p.id
        ${where}
        ORDER BY ar.booking_date DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as any[];

      const parsed = records.map(r => ({
        ...r,
        charges: (() => { try { return JSON.parse(r.charges || '[]'); } catch { return []; } })(),
        linked_person: r.person_id ? { id: r.person_id, name: `${r.linked_last || ''}, ${r.linked_first || ''}`.trim() } : null,
      }));

      return c.json({ records: parsed, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /states — Record counts by state ===
  api.get('/states', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const states = await db.prepare(`
        SELECT COALESCE(state, 'UT') as state, COUNT(*) as count
        FROM arrest_records
        GROUP BY COALESCE(state, 'UT')
        ORDER BY count DESC
      `).all() as { state: string; count: number }[];
      return c.json({ states });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /:id/cross-links ===
  api.get('/:id/cross-links', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
      const links = await db.prepare(
        'SELECT linked_type, linked_id, match_type, match_confidence, created_at FROM arrest_cross_links WHERE arrest_record_id = ?'
      ).all(id) as any[];
      return c.json({ arrestRecordId: id, links });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === PUT /:id/link-person — Manually link arrest to person ===
  api.put('/:id/link-person', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const { person_id } = await c.req.json();
      if (isNaN(id)) return c.json({ error: 'Invalid arrest record ID', code: 'INVALID_ARREST_RECORD_ID' }, 400);
      if (!person_id) return c.json({ error: 'person_id is required', code: 'PERSONID_IS_REQUIRED' }, 400);

      const person = await db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
      if (!person) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 404);

      await db.prepare('UPDATE arrest_records SET person_id = ?, updated_at = ? WHERE id = ?').run(person_id, localNow(), id);

      const existing = await db.prepare(
        'SELECT id FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = ? AND linked_id = ?'
      ).get(id, 'person', person_id);
      if (!existing) {
        await db.prepare(
          'INSERT INTO arrest_cross_links (arrest_record_id, linked_type, linked_id, match_type, match_confidence) VALUES (?, ?, ?, ?, ?)'
        ).run(id, 'person', person_id, 'manual', 1.0);
      }

      return c.json({ success: true, person: { id: person.id, name: `${person.last_name}, ${person.first_name}` } });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === DELETE /:id/link-person — Remove person link ===
  api.delete('/:id/link-person', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      if (isNaN(id)) return c.json({ error: 'Invalid arrest record ID', code: 'INVALID_ARREST_RECORD_ID' }, 400);

      const record = await db.prepare('SELECT person_id FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Arrest record not found', code: 'ARREST_RECORD_NOT_FOUND' }, 404);

      await db.prepare('UPDATE arrest_records SET person_id = NULL, updated_at = ? WHERE id = ?').run(localNow(), id);

      if (record.person_id) {
        await db.prepare(
          'DELETE FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = ? AND linked_id = ? AND match_type = ?'
        ).run(id, 'person', record.person_id, 'manual');
      }

      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }, 500);
    }
  });

  // === GET /export/csv — CSV export ===
  api.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
        SELECT booking_number, full_name as arrestee_name, charges as charge,
               booking_date as arrest_date, county as location,
               agency as arresting_officer, status
        FROM arrest_records ORDER BY booking_date DESC LIMIT 1000
      `).all() as any[];

      for (const row of rows) {
        if (row.charge) {
          try {
            const parsed = JSON.parse(row.charge);
            if (Array.isArray(parsed)) {
              row.charge = parsed.map((c: any) => typeof c === 'string' ? c : c.description || c.charge || c.name || JSON.stringify(c)).join('; ');
            }
          } catch { /* keep raw string */ }
        }
      }

      const headers = ['Booking Number', 'Arrestee Name', 'Charge', 'Arrest Date', 'Location', 'Arresting Officer', 'Status'];
      const csvRows = rows.map((r: any) => [r.booking_number, r.arrestee_name, r.charge, r.arrest_date, r.location, r.arresting_officer, r.status]);
      const csv = [headers.join(','), ...csvRows.map((r: any[]) => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');

      c.header('Content-Type', 'text/csv');
      c.header('Content-Disposition', `attachment; filename="arrests-export.csv"`);
      return c.body(csv);
    } catch (err: any) {
      return c.json({ error: 'Export failed', code: 'EXPORT_FAILED' }, 500);
    }
  });

  // === GET /manual/:id/checklist — Booking checklist ===
  api.get('/manual/:id/checklist', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      let checklist: any = {};
      try { checklist = JSON.parse(record.booking_checklist || '{}'); } catch { /* ignore */ }

      const standardItems = [
        { key: 'miranda_read', label: 'Miranda Rights Read', required: true },
        { key: 'miranda_acknowledged', label: 'Miranda Acknowledged', required: true },
        { key: 'personal_search', label: 'Personal Search Completed', required: true },
        { key: 'property_inventory', label: 'Property Inventory Completed', required: true },
        { key: 'fingerprinted', label: 'Fingerprinted', required: true },
        { key: 'photographed', label: 'Booking Photo Taken', required: true },
        { key: 'medical_screening', label: 'Medical Screening', required: true },
        { key: 'phone_call_offered', label: 'Phone Call Offered', required: true },
        { key: 'warrant_verified', label: 'Warrant Verified', required: false },
        { key: 'vehicle_secured', label: 'Vehicle Secured/Towed', required: false },
        { key: 'evidence_secured', label: 'Evidence Secured', required: false },
        { key: 'supervisor_notified', label: 'Supervisor Notified', required: false },
        { key: 'bail_info_provided', label: 'Bail Information Provided', required: false },
      ];

      const itemsWithStatus = standardItems.map(item => ({
        ...item,
        completed: !!checklist[item.key],
        completed_at: checklist[item.key]?.at || null,
        completed_by: checklist[item.key]?.by || null,
        notes: checklist[item.key]?.notes || null,
      }));

      const completedCount = itemsWithStatus.filter(i => i.completed).length;
      const requiredCount = standardItems.filter(i => i.required).length;
      const requiredCompleted = itemsWithStatus.filter(i => i.required && i.completed).length;

      return c.json({
        data: {
          arrest_id: id,
          items: itemsWithStatus,
          total_items: standardItems.length,
          completed_count: completedCount,
          required_count: requiredCount,
          required_completed: requiredCompleted,
          is_complete: requiredCompleted >= requiredCount,
        },
      });
    } catch (err: any) {
      return c.json({ error: 'Failed to get booking checklist', code: 'BOOKING_CHECKLIST_ERROR' }, 500);
    }
  });

  // === PUT /manual/:id/checklist — Update checklist item ===
  api.put('/manual/:id/checklist', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      const { item_key, completed, notes } = await c.req.json();
      if (!item_key) return c.json({ error: 'item_key required', code: 'ITEM_KEY_REQUIRED' }, 400);

      const now = localNow();
      let checklist: any = {};
      try { checklist = JSON.parse(record.booking_checklist || '{}'); } catch { /* ignore */ }

      if (completed) {
        const user = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(c.get('user').userId) as any;
        checklist[item_key] = { at: now, by: user?.full_name || '', by_id: c.get('user').userId, notes: notes || '' };
      } else {
        delete checklist[item_key];
      }

      await db.prepare('UPDATE arrest_records SET booking_checklist = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(checklist), now, id);

      return c.json({ data: { arrest_id: id, item_key, completed: !!completed } });
    } catch (err: any) {
      return c.json({ error: 'Failed to update checklist', code: 'CHECKLIST_UPDATE_ERROR' }, 500);
    }
  });

  // === GET /manual/:id/property — Property inventory ===
  api.get('/manual/:id/property', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      let inventory: any[] = [];
      try { inventory = JSON.parse(record.property_inventory || '[]'); } catch { /* ignore */ }

      return c.json({ data: { arrest_id: id, items: inventory, total_items: inventory.length } });
    } catch (err: any) {
      return c.json({ error: 'Failed to get property inventory', code: 'PROPERTY_INVENTORY_ERROR' }, 500);
    }
  });

  // === POST /manual/:id/property — Add property item ===
  api.post('/manual/:id/property', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { description, category, quantity, serial_number, estimated_value, disposition, notes } = body;
      if (!description) return c.json({ error: 'description required', code: 'DESCRIPTION_REQUIRED' }, 400);

      const now = localNow();
      const user = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(c.get('user').userId) as any;

      let inventory: any[] = [];
      try { inventory = JSON.parse(record.property_inventory || '[]'); } catch { /* ignore */ }

      const item = {
        id: `PROP-${Date.now()}-${inventory.length + 1}`,
        description,
        category: category || 'personal_item',
        quantity: quantity || 1,
        serial_number: serial_number || null,
        estimated_value: estimated_value || null,
        disposition: disposition || 'held',
        notes: notes || '',
        logged_by: user?.full_name || '',
        logged_by_id: c.get('user').userId,
        logged_at: now,
      };

      inventory.push(item);

      await db.prepare('UPDATE arrest_records SET property_inventory = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(inventory), now, id);

      return c.json({ data: item }, 201);
    } catch (err: any) {
      return c.json({ error: 'Failed to add property item', code: 'ADD_PROPERTY_ERROR' }, 500);
    }
  });

  // === DELETE /manual/:id/property/:itemId — Remove property item ===
  api.delete('/manual/:id/property/:itemId', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      let inventory: any[] = [];
      try { inventory = JSON.parse(record.property_inventory || '[]'); } catch { /* ignore */ }

      const newInventory = inventory.filter((i: any) => i.id !== c.req.param('itemId'));
      if (newInventory.length === inventory.length) return c.json({ error: 'Property item not found', code: 'ITEM_NOT_FOUND' }, 404);

      await db.prepare('UPDATE arrest_records SET property_inventory = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(newInventory), localNow(), id);

      return c.json({ success: true });
    } catch (err: any) {
      return c.json({ error: 'Failed to remove property item', code: 'REMOVE_PROPERTY_ERROR' }, 500);
    }
  });

  // === POST /manual/:id/miranda — Record Miranda rights ===
  api.post('/manual/:id/miranda', requireRole('admin', 'manager', 'officer', 'supervisor'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      const body = await c.req.json();
      const { read_at, acknowledged, waived_rights, requested_attorney, language,
        interpreter_used, interpreter_name, witness_officer_id, notes } = body;

      const now = localNow();
      const user = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(c.get('user').userId) as any;
      const witnessOfficer = witness_officer_id
        ? await db.prepare('SELECT full_name FROM users WHERE id = ?').get(witness_officer_id) as any
        : null;

      const mirandaData = {
        read_at: read_at || now,
        read_by: user?.full_name || '',
        read_by_id: c.get('user').userId,
        acknowledged: acknowledged !== false,
        waived_rights: !!waived_rights,
        requested_attorney: !!requested_attorney,
        language: language || 'English',
        interpreter_used: !!interpreter_used,
        interpreter_name: interpreter_name || null,
        witness_officer_id: witness_officer_id || null,
        witness_officer_name: witnessOfficer?.full_name || null,
        notes: notes || '',
        recorded_at: now,
      };

      await db.prepare('UPDATE arrest_records SET miranda_data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(mirandaData), now, id);

      let checklist: any = {};
      try { checklist = JSON.parse(record.booking_checklist || '{}'); } catch { /* ignore */ }
      checklist.miranda_read = { at: now, by: user?.full_name || '', by_id: c.get('user').userId };
      if (acknowledged !== false) {
        checklist.miranda_acknowledged = { at: now, by: user?.full_name || '', by_id: c.get('user').userId };
      }
      await db.prepare('UPDATE arrest_records SET booking_checklist = ? WHERE id = ?').run(JSON.stringify(checklist), id);

      return c.json({ data: mirandaData });
    } catch (err: any) {
      return c.json({ error: 'Failed to record Miranda rights', code: 'MIRANDA_ERROR' }, 500);
    }
  });

  // === GET /manual/:id/miranda — Get Miranda data ===
  api.get('/manual/:id/miranda', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      let mirandaData: any = null;
      try { mirandaData = JSON.parse(record.miranda_data || 'null'); } catch { /* ignore */ }

      return c.json({ data: { arrest_id: id, miranda: mirandaData } });
    } catch (err: any) {
      return c.json({ error: 'Failed to get Miranda data', code: 'MIRANDA_DATA_ERROR' }, 500);
    }
  });

  // === GET /manual/:id/linked-records — Linked records overview ===
  api.get('/manual/:id/linked-records', async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const record = await db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
      if (!record) return c.json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' }, 404);

      const crossLinks = await db.prepare(`
        SELECT linked_type, linked_id, match_type, match_confidence, created_at
        FROM arrest_cross_links WHERE arrest_record_id = ? LIMIT 100
      `).all(id) as any[];

      const links: any = { warrants: [], court_events: [], citations: [], incidents: [], cross_links: crossLinks };

      if (record.full_name) {
        try {
          links.warrants = await db.prepare(`
            SELECT w.id, w.warrant_number, w.type as warrant_type, w.status,
              COALESCE(p.first_name || ' ' || p.last_name, '') as subject_name
            FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
            WHERE (p.last_name LIKE ? OR p.first_name LIKE ?) AND w.status = 'active' LIMIT 10
          `).all(`%${record.last_name}%`, `%${record.last_name}%`);
        } catch { /* warrants table may not exist */ }
      }

      if (record.full_name) {
        links.court_events = await db.prepare(`
          SELECT id, event_number, event_type, event_date, status, outcome FROM court_events
          WHERE defendant_name LIKE ? ORDER BY event_date DESC LIMIT 10
        `).all(`%${record.last_name}%`);
      }

      if (record.full_name) {
        links.citations = await db.prepare(`
          SELECT id, citation_number, violation, person_name, status FROM citations
          WHERE person_name LIKE ? ORDER BY created_at DESC LIMIT 10
        `).all(`%${record.last_name}%`);
      }

      return c.json({ data: links });
    } catch (err: any) {
      return c.json({ error: 'Failed to get linked records', code: 'LINKED_RECORDS_ERROR' }, 500);
    }
  });

  app.route('/api/arrests', api);
}
