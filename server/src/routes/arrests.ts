// ============================================================
// Jail Roster & Arrest Records API Routes
// ============================================================
// Manages arrest/booking records from multiple sources:
//   1. Manual entry — officers log bookings directly
//   2. CSV/bulk import — import county jail roster exports
//   3. JailBase API (legacy) — automated sync when available
// Also provides search and cross-linking against warrants,
// court events, and known persons.
// ============================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import config from '../config';
import {
  syncArrestData,
  searchArrests,
  crossLinkArrests,
  getArrestSyncStatus,
  getArrestUsageStats,
  getCountyRecordCounts,
  discoverUtahSources,
  UTAH_COUNTY_DEFAULTS,
} from '../utils/arrestScraper';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate } from '../utils/websocket';

const router = Router();
router.use(authenticateToken);

// ── Encryption helpers ──────────────────────────────────────

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(config.jwt.secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(stored: string): string {
  const key = deriveKey();
  const parts = stored.split(':');
  if (parts.length < 3) throw new Error('Malformed encrypted value');
  const [ivHex, authTagHex, ciphertext] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Config helpers ──────────────────────────────────────────

const CONFIG_KEYS = {
  apiKey: 'jailbase_rapidapi_key',
  enabled: 'jailbase_enabled',
  enabledCounties: 'jailbase_enabled_counties',
} as const;

function getConfigValue(key: string): string | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = ? AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get(key) as { config_value: string } | undefined;
    return row?.config_value || null;
  } catch { return null; }
}

function getDecryptedValue(key: string): string | null {
  const val = getConfigValue(key);
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

function setConfigValue(key: string, value: string, shouldEncrypt = false): void {
  const db = getDb();
  const now = localNow();
  const stored = shouldEncrypt ? encrypt(value) : value;

  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);

  db.prepare(
    "INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at) VALUES (?, ?, 'integrations', 0, 1, ?, ?)"
  ).run(key, stored, now, now);
}

function deleteConfigValue(key: string): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM system_config WHERE config_key = ? AND category = 'integrations'"
  ).run(key);
}

// ── Name helpers ────────────────────────────────────────────

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

// ============================================================
// MANUAL BOOKING CRUD ROUTES
// ============================================================

// ── POST /manual — Create a manual booking entry ────────────
router.post('/manual', requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = (req as any).user;
    const b = req.body;

    // Require at minimum a name
    const fullName = (b.full_name || '').trim();
    if (!fullName || fullName.length < 2) {
      return res.status(400).json({ error: 'Full name is required (min 2 characters)' });
    }

    const { first, middle, last } = splitName(fullName);
    const charges = Array.isArray(b.charges) ? JSON.stringify(b.charges)
      : typeof b.charges === 'string' ? b.charges : '[]';

    const result = db.prepare(`
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
      `manual-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      fullName, first || b.first_name || '', last || b.last_name || '', middle || b.middle_name || '',
      b.date_of_birth || null, b.booking_date || now, b.release_date || null,
      charges, b.county || '', b.state || 'UT', b.status || 'active', b.booking_number || null, b.agency || null,
      b.gender || null, b.race || null, b.height ?? null, b.weight ?? null, b.hair_color || null, b.eye_color || null,
      b.address || null, b.bail_amount != null && !isNaN(parseFloat(b.bail_amount)) ? parseFloat(b.bail_amount) : null, b.hold_reason || null, b.notes || null,
      user?.id || null, now, now,
    );

    const newId = result.lastInsertRowid as number;

    auditLog(req, 'arrest_created', 'arrest_record', newId,
      `Manual booking: ${fullName}`);
    broadcastRecordUpdate({ type: 'arrest_created', id: newId });

    // Run cross-linking for the new record
    try { crossLinkArrests(); } catch { /* non-critical */ }

    res.json({ success: true, id: newId, message: 'Booking record created' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /manual/:id — Update a booking record ───────────────
router.put('/manual/:id', requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = db.prepare('SELECT id FROM arrest_records WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    const b = req.body;
    const updates: string[] = [];
    const params: any[] = [];

    const fields: Record<string, string> = {
      full_name: b.full_name, first_name: b.first_name, last_name: b.last_name, middle_name: b.middle_name,
      date_of_birth: b.date_of_birth, booking_date: b.booking_date, release_date: b.release_date,
      county: b.county, status: b.status, booking_number: b.booking_number, agency: b.agency,
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
      params.push(b.bail_amount != null && !isNaN(parseFloat(b.bail_amount)) ? parseFloat(b.bail_amount) : null);
    }

    if (b.charges !== undefined) {
      updates.push('charges = ?');
      params.push(Array.isArray(b.charges) ? JSON.stringify(b.charges) : b.charges);
    }

    // If full_name changed, re-split first/last/middle
    if (b.full_name && !b.first_name && !b.last_name) {
      const { first, middle, last } = splitName(b.full_name);
      updates.push('first_name = ?', 'last_name = ?', 'middle_name = ?');
      params.push(first, last, middle);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE arrest_records SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'arrest_updated', 'arrest_record', id, `Updated arrest record #${id}`);
    broadcastRecordUpdate({ type: 'arrest_updated', id });

    res.json({ success: true, message: 'Record updated' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /manual/:id — Delete a booking record ────────────
router.delete('/manual/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const existing = db.prepare('SELECT id FROM arrest_records WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    // Delete cross-links first (FK cascade should handle, but be explicit)
    db.prepare('DELETE FROM arrest_cross_links WHERE arrest_record_id = ?').run(id);
    db.prepare('DELETE FROM arrest_records WHERE id = ?').run(id);

    auditLog(req, 'arrest_deleted', 'arrest_record', id, `Deleted arrest record #${id}`);
    broadcastRecordUpdate({ type: 'arrest_deleted', id });

    res.json({ success: true, message: 'Record deleted' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /manual/:id — Get a single booking record ───────────
router.get('/manual/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Parse charges
    try { record.charges = JSON.parse(record.charges || '[]'); } catch { record.charges = []; }

    // Get cross-links
    const links = db.prepare(`
      SELECT linked_type, linked_id, match_type, match_confidence, created_at
      FROM arrest_cross_links WHERE arrest_record_id = ?
    `).all(id);

    res.json({ ...record, cross_links: links });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /import-csv — Bulk import from CSV data ────────────
router.post('/import-csv', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = (req as any).user;
    const { records, county, agency } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required and must not be empty' });
    }

    if (records.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 records per import' });
    }

    const insert = db.prepare(`
      INSERT INTO arrest_records (
        jailbase_id, source_id, source_name,
        full_name, first_name, last_name, middle_name,
        date_of_birth, booking_date, release_date,
        charges, county, state, status, booking_number, agency,
        gender, race, height, weight, hair_color, eye_color,
        address, bail_amount, hold_reason, notes,
        entry_source, entered_by, created_at, updated_at
      ) VALUES (
        ?, 'csv-import', ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        'csv', ?, ?, ?
      )
    `);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    const importTx = db.transaction(() => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        try {
          // Normalize name — support multiple CSV column name formats
          const fullName = (
            r.full_name || r.name || r.Name || r.FULL_NAME || r.INMATE_NAME ||
            `${r.first_name || r.FirstName || r.FIRST_NAME || ''} ${r.last_name || r.LastName || r.LAST_NAME || ''}`.trim()
          );

          if (!fullName || fullName.length < 2) {
            skipped++;
            continue;
          }

          const { first, middle, last } = splitName(fullName);
          const charges = r.charges || r.Charges || r.CHARGES || r.offense || r.Offense || '';
          const chargesJson = Array.isArray(charges) ? JSON.stringify(charges)
            : typeof charges === 'string' && charges ? JSON.stringify([charges]) : '[]';

          insert.run(
            `csv-${Date.now()}-${i}-${crypto.randomBytes(3).toString('hex')}`,
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
            r.bail_amount || r.BailAmount || r.BAIL_AMOUNT || null,
            r.hold_reason || r.HoldReason || null,
            r.notes || null,
            user?.id || null, now, now,
          );
          imported++;
        } catch (rowErr: any) {
          skipped++;
          if (errors.length < 5) errors.push(`Row ${i + 1}: ${rowErr.message}`);
        }
      }
    });

    importTx();

    auditLog(req, 'arrest_imported', 'arrest_record', 0,
      `CSV import: ${imported} of ${records.length} records (county: ${county || 'unknown'})`);
    broadcastRecordUpdate({ type: 'arrest_imported', imported, total: records.length });

    // Run cross-linking on all new records
    try {
      const crossLinks = crossLinkArrests();
      res.json({
        success: true,
        imported,
        skipped,
        total: records.length,
        crossLinks,
        errors: errors.length > 0 ? errors : undefined,
        message: `Imported ${imported} of ${records.length} records`,
      });
    } catch {
      res.json({ success: true, imported, skipped, total: records.length, errors: errors.length > 0 ? errors : undefined });
    }
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// EXISTING ROUTES (JailBase API + Search + Status)
// ============================================================

// ── GET /status — Configuration + roster status ─────────────
router.get('/status', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const hasApiKey = !!getDecryptedValue(CONFIG_KEYS.apiKey);
    const enabled = getConfigValue(CONFIG_KEYS.enabled) === 'true';
    const syncStatus = getArrestSyncStatus();
    const enabledCounties = getConfigValue(CONFIG_KEYS.enabledCounties);
    let counties: string[] = [];
    try { counties = JSON.parse(enabledCounties || '[]'); } catch {}

    // Detect if API is offline (recent errors all mention 404)
    const apiOffline = syncStatus.lastError?.includes('404') || syncStatus.lastError?.includes('offline');

    // Manual entry stats
    const manualCount = (db.prepare("SELECT COUNT(*) as c FROM arrest_records WHERE entry_source = 'manual'").get() as any)?.c || 0;
    const csvCount = (db.prepare("SELECT COUNT(*) as c FROM arrest_records WHERE entry_source = 'csv'").get() as any)?.c || 0;
    const totalRecords = (db.prepare('SELECT COUNT(*) as c FROM arrest_records').get() as any)?.c || 0;

    res.json({
      configured: hasApiKey,
      enabled,
      enabledCounties: counties,
      lastSync: syncStatus.lastSync,
      recordsCount: totalRecords,
      manualCount,
      csvCount,
      apiCount: totalRecords - manualCount - csvCount,
      countiesSynced: syncStatus.countiesSynced,
      status: apiOffline ? 'api_offline' : syncStatus.status,
      lastError: syncStatus.lastError,
      apiOffline,
    });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /credentials — Save RapidAPI key (encrypted) ────────
router.put('/credentials', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
      return res.status(400).json({ error: 'Invalid API key' });
    }
    setConfigValue(CONFIG_KEYS.apiKey, apiKey.trim(), true);
    if (getConfigValue(CONFIG_KEYS.enabled) !== 'true') {
      setConfigValue(CONFIG_KEYS.enabled, 'true');
    }
    res.json({ success: true, message: 'API key saved and encrypted' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /credentials — Clear API key ─────────────────────
router.delete('/credentials', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    deleteConfigValue(CONFIG_KEYS.apiKey);
    setConfigValue(CONFIG_KEYS.enabled, 'false');
    res.json({ success: true, message: 'API key removed' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /toggle — Enable/disable API sync ───────────────────
router.put('/toggle', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    setConfigValue(CONFIG_KEYS.enabled, enabled ? 'true' : 'false');
    res.json({ success: true, enabled: !!enabled });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /test — Test API connectivity ──────────────────────
router.post('/test', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const apiKey = getDecryptedValue(CONFIG_KEYS.apiKey);
    if (!apiKey) {
      return res.json({ success: false, error: 'No RapidAPI key configured.' });
    }
    const url = `https://jailbase-jailbase.p.rapidapi.com/sources?state=UT`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const apiRes = await fetch(url, {
      method: 'GET',
      headers: { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'jailbase-jailbase.p.rapidapi.com' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (apiRes.status === 403) return res.json({ success: false, status: 403, error: 'API key invalid or subscription inactive.' });
    if (apiRes.status === 429) return res.json({ success: false, status: 429, error: 'Rate limited. Wait and retry.' });
    if (apiRes.status === 404) return res.json({ success: false, status: 404, error: 'JailBase API offline — all endpoints returning 404. The service appears deprecated. Cached records remain searchable.' });
    if (!apiRes.ok) return res.json({ success: false, status: apiRes.status, error: `API returned ${apiRes.status}` });
    const body = await apiRes.json();
    res.json({ success: true, status: 200, message: `API key valid. ${body.records?.length || 0} source(s).` });
  } catch (err: any) {
    if (err.name === 'AbortError') return res.json({ success: false, error: 'Timed out after 10s' });
    res.json({ success: false, error: err.message });
  }
});

// ── GET /search — Search arrest records by name ─────────────
router.get('/search', async (req: Request, res: Response) => {
  try {
    const name = (req.query.name as string || '').trim();
    if (!name || name.length < 2) return res.status(400).json({ error: 'Name required (min 2 characters)' });
    const result = await searchArrests(name);

    // Apply optional client-side filters (source, source_id/county) that searchArrests doesn't handle
    const sourceFilter = (req.query.source as string || '').trim();
    const countyFilter = (req.query.source_id as string || '').trim();
    if (sourceFilter || countyFilter) {
      result.records = result.records.filter((r: any) => {
        if (sourceFilter && r.entry_source !== sourceFilter) return false;
        if (countyFilter && r.source_id !== countyFilter) return false;
        return true;
      });
      result.resultCount = result.records.length;
    }

    res.json(result);
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /recent — Recent arrests (paginated, filterable) ────
router.get('/recent', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const county = (req.query.county as string || '').trim();
    const source = (req.query.source as string || '').trim(); // 'manual', 'csv', 'api', or ''
    const statusFilter = (req.query.status as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];

    const sourceId = (req.query.source_id as string || '').trim(); // county key: weber, davis, etc.
    const stateFilter = (req.query.state as string || '').trim().toUpperCase();
    if (county) { conditions.push('ar.county = ?'); params.push(county); }
    if (sourceId) { conditions.push('ar.source_id = ?'); params.push(sourceId); }
    if (stateFilter) { conditions.push('ar.state = ?'); params.push(stateFilter); }
    if (source === 'manual') { conditions.push("ar.entry_source = 'manual'"); }
    else if (source === 'csv') { conditions.push("ar.entry_source = 'csv'"); }
    else if (source === 'scraper') { conditions.push("ar.entry_source = 'scraper'"); }
    else if (source === 'api') { conditions.push("(ar.entry_source IS NULL OR ar.entry_source = 'api')"); }
    if (statusFilter) { conditions.push('ar.status = ?'); params.push(statusFilter); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = (db.prepare(
      `SELECT COUNT(*) as c FROM arrest_records ar ${where}`
    ).get(...params) as any)?.c || 0;

    params.push(limit, offset);
    const records = db.prepare(`
      SELECT ar.*, p.first_name AS linked_first, p.last_name AS linked_last
      FROM arrest_records ar
      LEFT JOIN persons p ON ar.person_id = p.id
      ${where}
      ORDER BY ar.booking_date DESC
      LIMIT ? OFFSET ?
    `).all(...params) as any[];

    const parsed = records.map(r => ({
      ...r,
      charges: (() => { try { return JSON.parse(r.charges || '[]'); } catch { return []; } })(),
      linked_person: r.person_id ? { id: r.person_id, name: `${r.linked_last || ''}, ${r.linked_first || ''}`.trim() } : null,
    }));

    res.json({ records: parsed, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /sync-status ────────────────────────────────────────
router.get('/sync-status', (_req: Request, res: Response) => {
  try { res.json(getArrestSyncStatus()); }
  catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /usage ──────────────────────────────────────────────
router.get('/usage', (_req: Request, res: Response) => {
  try { res.json(getArrestUsageStats()); }
  catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── POST /sync — Manual API sync ────────────────────────────
router.post('/sync', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const result = await syncArrestData();
    res.json({ success: true, ...result });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /states — Record counts by state ────────────────────
router.get('/states', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const states = db.prepare(`
      SELECT COALESCE(state, 'UT') as state, COUNT(*) as count
      FROM arrest_records
      GROUP BY COALESCE(state, 'UT')
      ORDER BY count DESC
    `).all() as { state: string; count: number }[];
    res.json({ states });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /counties ───────────────────────────────────────────
router.get('/counties', async (req: Request, res: Response) => {
  try {
    const discover = req.query.discover === 'true';
    if (discover) {
      const sources = await discoverUtahSources();
      return res.json({ sources, discovered: true });
    }
    const counts = getCountyRecordCounts();
    const countsMap = new Map(counts.map(c => [c.sourceId, c.count]));
    const enabledStr = getConfigValue(CONFIG_KEYS.enabledCounties);
    let enabled: string[] = [];
    try { enabled = JSON.parse(enabledStr || '[]'); } catch {}
    const sources = UTAH_COUNTY_DEFAULTS.map(c => ({
      ...c, recordCount: countsMap.get(c.sourceId) || 0,
      enabled: enabled.length === 0 || enabled.includes(c.sourceId),
    }));
    res.json({ sources, discovered: false });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── PUT /counties ───────────────────────────────────────────
router.put('/counties', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { counties } = req.body;
    if (!Array.isArray(counties)) return res.status(400).json({ error: 'counties must be an array' });
    setConfigValue(CONFIG_KEYS.enabledCounties, JSON.stringify(counties));
    res.json({ success: true, enabledCounties: counties });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /:id/cross-links ────────────────────────────────────
router.get('/:id/cross-links', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const links = db.prepare(
      'SELECT linked_type, linked_id, match_type, match_confidence, created_at FROM arrest_cross_links WHERE arrest_record_id = ?'
    ).all(id) as any[];
    res.json({ arrestRecordId: id, links });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── PUT /:id/link-person ────────────────────────────────────
// Manually link an arrest record to a person record
router.put('/:id/link-person', requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string);
    const { person_id } = req.body;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid arrest record ID' });
    if (!person_id) return res.status(400).json({ error: 'person_id is required' });

    // Verify person exists
    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found' });

    // Update arrest record with person_id
    db.prepare('UPDATE arrest_records SET person_id = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(person_id, id);

    // Also add a cross-link if not already present
    const existing = db.prepare(
      'SELECT id FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = ? AND linked_id = ?'
    ).get(id, 'person', person_id);
    if (!existing) {
      db.prepare(
        'INSERT INTO arrest_cross_links (arrest_record_id, linked_type, linked_id, match_type, match_confidence) VALUES (?, ?, ?, ?, ?)'
      ).run(id, 'person', person_id, 'manual', 1.0);
    }

    auditLog(req, 'arrest_linked', 'arrest_record', id,
      `Linked arrest #${id} to person ${person.last_name}, ${person.first_name} (ID: ${person_id})`);
    broadcastRecordUpdate({ type: 'arrest_linked', arrestId: id, personId: person_id });

    res.json({ success: true, person: { id: person.id, name: `${person.last_name}, ${person.first_name}` } });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── DELETE /:id/link-person ─────────────────────────────────
// Remove manual person link from arrest record
router.delete('/:id/link-person', requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid arrest record ID' });

    const record = db.prepare('SELECT person_id FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Arrest record not found' });

    db.prepare('UPDATE arrest_records SET person_id = NULL, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(id);

    // Remove manual cross-link
    if (record.person_id) {
      db.prepare(
        'DELETE FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = ? AND linked_id = ? AND match_type = ?'
      ).run(id, 'person', record.person_id, 'manual');
    }

    auditLog(req, 'arrest_unlinked', 'arrest_record', id,
      `Unlinked person from arrest #${id}`);
    broadcastRecordUpdate({ type: 'arrest_unlinked', arrestId: id });

    res.json({ success: true });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

export default router;
