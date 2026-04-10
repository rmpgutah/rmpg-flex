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
import { validateParamId, validateParamIdMiddleware, validateStr, validateDateStr, requireInt, requireFloat, validateEnum } from '../middleware/sanitize';
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
  scheduleArrestSync,
  stopArrestSync,
} from '../utils/arrestScraper';
import { auditLog } from '../utils/auditLogger';
import { broadcastRecordUpdate, broadcastDispatchUpdate } from '../utils/websocket';
import { sendCsv } from '../utils/csvExport';
import { createNotification, createNotificationForRoles } from './notifications';

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
    const user = req.user!;
    const b = req.body;

    // ── Input validation ──
    const ARREST_STATUSES = ['active', 'released', 'transferred', 'bonded', 'closed'] as const;
    const GENDERS = ['male', 'female', 'non_binary', 'unknown'] as const;

    const fullName = validateStr(b.full_name, 'full_name', 200);
    if (!fullName || fullName.length < 2) {
      return res.status(400).json({ error: 'Full name is required (min 2 characters)', code: 'FULL_NAME_IS_REQUIRED' });
    }

    const validDob = validateDateStr(b.date_of_birth, 'date_of_birth');
    const validBookingDate = validateDateStr(b.booking_date, 'booking_date');
    const validReleaseDate = validateDateStr(b.release_date, 'release_date');
    const validStatus = validateEnum(b.status, ARREST_STATUSES, 'status') || 'active';
    const validBail = requireFloat(b.bail_amount, 'bail_amount', 0, 100_000_000);
    const validCounty = validateStr(b.county, 'county', 100) || '';
    const validState = validateStr(b.state, 'state', 2) || 'UT';
    const validBookingNum = validateStr(b.booking_number, 'booking_number', 100);
    const validAgency = validateStr(b.agency, 'agency', 200);
    const validGender = validateStr(b.gender, 'gender', 50);
    const validRace = validateStr(b.race, 'race', 50);
    const validHeight = validateStr(b.height, 'height', 20);
    const validWeight = validateStr(b.weight, 'weight', 20);
    const validHairColor = validateStr(b.hair_color, 'hair_color', 50);
    const validEyeColor = validateStr(b.eye_color, 'eye_color', 50);
    const validAddress = validateStr(b.address, 'address', 500);
    const validHoldReason = validateStr(b.hold_reason, 'hold_reason', 1000);
    const validNotes = validateStr(b.notes, 'notes', 5000);

    const { first, middle, last } = splitName(fullName);
    const charges = Array.isArray(b.charges) ? JSON.stringify(b.charges.slice(0, 100))
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
      validDob, validBookingDate || now, validReleaseDate,
      charges, validCounty, validState, validStatus, validBookingNum, validAgency,
      validGender, validRace, validHeight, validWeight, validHairColor, validEyeColor,
      validAddress, validBail, validHoldReason, validNotes,
      user?.userId || null, now, now,
    );

    const newId = Number(result.lastInsertRowid) as number;

    auditLog(req, 'arrest_created', 'arrest_record', newId,
      `Manual booking: ${fullName}`);
    broadcastRecordUpdate({ type: 'arrest_created', id: newId });
    broadcastDispatchUpdate({
      action: 'arrest_created',
      arrest: { id: newId, subject_name: fullName, charge: charges, booking_number: validBookingNum, officer_name: user?.username || '' },
    });

    // Run cross-linking for the new record
    try { crossLinkArrests(); } catch { /* non-critical */ }

    // Check for active warrants matching this person by name
    try {
      const personName = fullName;
      const activeWarrants = db.prepare(`
        SELECT COUNT(*) as cnt FROM warrants w
        JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND LOWER(TRIM(p.first_name || ' ' || p.last_name)) = LOWER(TRIM(?))
      `).get(personName) as { cnt: number } | undefined;

      if (activeWarrants && activeWarrants.cnt > 0) {
        // Notify the arresting officer
        createNotification(
          user.userId, 'warrant',
          `Warrant Hit: ${personName}`,
          `Person has ${activeWarrants.cnt} active warrant(s). Verify and coordinate with court.`,
          'warrant', 0, 'high'
        );
        // Notify supervisors and admins
        createNotificationForRoles(
          ['admin', 'manager', 'supervisor'],
          'warrant',
          `Warrant Hit on Arrest: ${personName}`,
          `Arrested person has ${activeWarrants.cnt} active warrant(s).`,
          'warrant', 0, 'high',
          'warrant.hit_on_arrest', user.userId
        );
      }
    } catch { /* non-critical — don't block arrest creation */ }

    res.status(201).json({ success: true, id: newId, message: 'Booking record created' });
  } catch (err: any) {
    if (err.message?.startsWith('Invalid ') || err.message?.includes('must be')) {
      res.status(400).json({ error: err.message }); return;
    }
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── PUT /manual/:id — Update a booking record ───────────────
router.put('/manual/:id', validateParamIdMiddleware, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });

    const existing = db.prepare('SELECT id FROM arrest_records WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

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
      params.push(b.bail_amount != null && !isNaN(parseFloat(b.bail_amount)) && isFinite(parseFloat(b.bail_amount)) ? parseFloat(b.bail_amount) : null);
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
      return res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    db.prepare(`UPDATE arrest_records SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // God Mode: admin can change status to anything, edit booking number — log override
    if (req.user?.role === 'admin' && (b.status !== undefined || b.booking_number !== undefined)) {
      auditLog(req, 'ADMIN_OVERRIDE', 'arrest_record', id, `Admin God Mode: updated arrest record #${id} (status/booking_number change)`);
    }

    auditLog(req, 'arrest_updated', 'arrest_record', id, `Updated arrest record #${id}`);
    broadcastRecordUpdate({ type: 'arrest_updated', id });

    res.json({ success: true, message: 'Record updated' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── DELETE /manual/:id — Delete a booking record ────────────
router.delete('/manual/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });

    const existing = db.prepare('SELECT id FROM arrest_records WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    // God Mode: admin can delete any arrest record regardless of status
    if (req.user?.role === 'admin') {
      auditLog(req, 'ADMIN_OVERRIDE', 'arrest_record', id, `Admin God Mode: deleting arrest record #${id} (bypassed restrictions)`);
    }

    // Delete cross-links first (FK cascade should handle, but be explicit)
    db.prepare('DELETE FROM arrest_cross_links WHERE arrest_record_id = ?').run(id);
    db.prepare('DELETE FROM arrest_records WHERE id = ?').run(id);

    auditLog(req, 'arrest_deleted', 'arrest_record', id, `Deleted arrest record #${id}`);
    broadcastRecordUpdate({ type: 'arrest_deleted', id });

    res.json({ success: true, message: 'Record deleted' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── GET /manual/:id — Get a single booking record ───────────
router.get('/manual/:id', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });

    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    // Parse charges
    try { record.charges = JSON.parse(record.charges || '[]'); } catch { record.charges = []; }

    // Get cross-links
    const links = db.prepare(`
      SELECT linked_type, linked_id, match_type, match_confidence, created_at
      FROM arrest_cross_links WHERE arrest_record_id = ?
    
      LIMIT 1000
    `).all(id);

    res.json({ ...record, cross_links: links });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── POST /import-csv — Bulk import from CSV data ────────────
router.post('/import-csv', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const user = req.user!;
    const { records, county, agency } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required and must not be empty', code: 'RECORDS_ARRAY_IS_REQUIRED' });
    }

    if (records.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 records per import', code: 'MAXIMUM_500_RECORDS_PER' });
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
            (() => { const v = parseFloat(r.bail_amount ?? r.BailAmount ?? r.BAIL_AMOUNT); return isNaN(v) || !isFinite(v) ? null : v; })(),
            r.hold_reason || r.HoldReason || null,
            r.notes || null,
            user?.userId || null, now, now,
          );
          imported++;
        } catch (rowErr: any) {
          skipped++;
          // Log full error server-side for debugging; return generic message to client
          console.error(`[Arrests Import] Row ${i + 1} error:`, rowErr.message);
          if (errors.length < 5) errors.push(`Row ${i + 1}: Import failed`);
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
    } catch (e: any) {
      console.warn('[Arrests] Cross-link after import failed:', e?.message);
      res.json({ success: true, imported, skipped, total: records.length, errors: errors.length > 0 ? errors : undefined });
    }
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
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
    try { counties = JSON.parse(enabledCounties || '[]'); } catch (e) { console.warn('[arrests] Failed to parse enabled counties:', e); }

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
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── PUT /credentials — Save RapidAPI key (encrypted) ────────
router.put('/credentials', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
      return res.status(400).json({ error: 'Invalid API key', code: 'INVALID_API_KEY' });
    }
    setConfigValue(CONFIG_KEYS.apiKey, apiKey.trim(), true);
    if (getConfigValue(CONFIG_KEYS.enabled) !== 'true') {
      setConfigValue(CONFIG_KEYS.enabled, 'true');
    }
    res.json({ success: true, message: 'API key saved and encrypted' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── DELETE /credentials — Clear API key ─────────────────────
router.delete('/credentials', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    deleteConfigValue(CONFIG_KEYS.apiKey);
    setConfigValue(CONFIG_KEYS.enabled, 'false');
    res.json({ success: true, message: 'API key removed' });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── PUT /toggle — Enable/disable API sync ───────────────────
router.put('/toggle', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    setConfigValue(CONFIG_KEYS.enabled, enabled ? 'true' : 'false');
    res.json({ success: true, enabled: !!enabled });
  } catch (err: any) {
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── POST /poller/restart — Restart the arrest sync poller ────
router.post('/poller/restart', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    stopArrestSync();
    scheduleArrestSync();
    res.json({ success: true, message: 'Arrest sync poller restarted' });
  } catch (err: any) {
    console.error('[Arrests] Failed to restart poller:', err?.message || err);
    res.status(500).json({ error: 'Failed to restart poller', code: 'POLLER_RESTART_ERROR' });
  }
});

// ── POST /poller/stop — Stop the arrest sync poller ────
router.post('/poller/stop', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    stopArrestSync();
    res.json({ success: true, message: 'Arrest sync poller stopped' });
  } catch (err: any) {
    console.error('[Arrests] Failed to stop poller:', err?.message || err);
    res.status(500).json({ error: 'Failed to stop poller', code: 'POLLER_STOP_ERROR' });
  }
});

// ── POST /test — Test API connectivity ──────────────────────
router.post('/test', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const apiKey = getDecryptedValue(CONFIG_KEYS.apiKey);
    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'No RapidAPI key configured.' });
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
    if (apiRes.status === 403) return res.status(502).json({ success: false, status: 403, error: 'API key invalid or subscription inactive.' });
    if (apiRes.status === 429) return res.status(502).json({ success: false, status: 429, error: 'Rate limited. Wait and retry.' });
    if (apiRes.status === 404) return res.status(502).json({ success: false, status: 404, error: 'JailBase API offline — all endpoints returning 404. The service appears deprecated. Cached records remain searchable.' });
    if (!apiRes.ok) return res.status(502).json({ success: false, status: apiRes.status, error: `API returned ${apiRes.status}` });
    const body = await apiRes.json();
    res.json({ success: true, status: 200, message: `API key valid. ${body.records?.length || 0} source(s).` });
  } catch (err: any) {
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: 'Timed out after 10s' });
    console.error('[arrests] API test error:', err.message);
    res.status(502).json({ success: false, error: 'Connection failed' });
  }
});

// ── GET /search — Search arrest records by name ─────────────
router.get('/search', async (req: Request, res: Response) => {
  try {
    const name = (req.query.name as string || '').trim();
    if (!name || name.length < 2) return res.status(400).json({ error: 'Name required (min 2 characters)', code: 'NAME_REQUIRED_MIN_2' });
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
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── GET /recent — Recent arrests (paginated, filterable) ────
router.get('/recent', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const county = (req.query.county as string || '').trim();
    const source = (req.query.source as string || '').trim(); // 'manual', 'csv', 'api', or ''
    const statusFilter = (req.query.status as string || '').trim();
    const parsedPage = parseInt(req.query.page as string, 10);
    const page = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
    const parsedLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.min(100, Math.max(1, isNaN(parsedLimit) ? 50 : parsedLimit));
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
    console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  }
});

// ── GET /sync-status ────────────────────────────────────────
router.get('/sync-status', (_req: Request, res: Response) => {
  try { res.json(getArrestSyncStatus()); }
  catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ── GET /usage ──────────────────────────────────────────────
router.get('/usage', (_req: Request, res: Response) => {
  try { res.json(getArrestUsageStats()); }
  catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ── POST /sync — Manual API sync ────────────────────────────
router.post('/sync', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const result = await syncArrestData();
    res.json({ success: true, ...result });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
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
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
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
    try { enabled = JSON.parse(enabledStr || '[]'); } catch (e) { console.warn('[arrests] Failed to parse enabled counties:', e); }
    const sources = UTAH_COUNTY_DEFAULTS.map(c => ({
      ...c, recordCount: countsMap.get(c.sourceId) || 0,
      enabled: enabled.length === 0 || enabled.includes(c.sourceId),
    }));
    res.json({ sources, discovered: false });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ── PUT /counties ───────────────────────────────────────────
router.put('/counties', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const { counties } = req.body;
    if (!Array.isArray(counties)) return res.status(400).json({ error: 'counties must be an array', code: 'COUNTIES_MUST_BE_AN' });
    setConfigValue(CONFIG_KEYS.enabledCounties, JSON.stringify(counties));
    res.json({ success: true, enabledCounties: counties });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ── GET /:id/cross-links ────────────────────────────────────
router.get('/:id/cross-links', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });
    const links = db.prepare(
      'SELECT linked_type, linked_id, match_type, match_confidence, created_at FROM arrest_cross_links WHERE arrest_record_id = ?'
    ).all(id) as any[];
    res.json({ arrestRecordId: id, links });
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ── PUT /:id/link-person ────────────────────────────────────
// Manually link an arrest record to a person record
router.put('/:id/link-person', validateParamIdMiddleware, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    const { person_id } = req.body;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid arrest record ID', code: 'INVALID_ARREST_RECORD_ID' });
    if (!person_id) return res.status(400).json({ error: 'person_id is required', code: 'PERSONID_IS_REQUIRED' });

    // Verify person exists
    const person = db.prepare('SELECT id, first_name, last_name FROM persons WHERE id = ?').get(person_id) as any;
    if (!person) return res.status(404).json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' });

    // Update arrest record with person_id
    db.prepare('UPDATE arrest_records SET person_id = ?, updated_at = ? WHERE id = ?')
      .run(person_id, localNow(), id);

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
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ── DELETE /:id/link-person ─────────────────────────────────
// Remove manual person link from arrest record
router.delete('/:id/link-person', validateParamIdMiddleware, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid arrest record ID', code: 'INVALID_ARREST_RECORD_ID' });

    const record = db.prepare('SELECT person_id FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Arrest record not found', code: 'ARREST_RECORD_NOT_FOUND' });

    db.prepare('UPDATE arrest_records SET person_id = NULL, updated_at = ? WHERE id = ?')
      .run(localNow(), id);

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
  } catch (err: any) { console.error(err); res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' }); }
});

// ─── GET /export/csv ────────────────────────────────────
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT booking_number, full_name as arrestee_name, charges as charge,
             booking_date as arrest_date, county as location,
             agency as arresting_officer, status
      FROM arrest_records
      ORDER BY booking_date DESC
    
      LIMIT 1000
    `).all() as any[];

    // Parse charges JSON to a readable string
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

    sendCsv(res, 'arrests-export.csv', [
      { key: 'booking_number', header: 'Booking Number' },
      { key: 'arrestee_name', header: 'Arrestee Name' },
      { key: 'charge', header: 'Charge' },
      { key: 'arrest_date', header: 'Arrest Date' },
      { key: 'location', header: 'Location' },
      { key: 'arresting_officer', header: 'Arresting Officer' },
      { key: 'status', header: 'Status' },
    ], rows);
  } catch (error: any) {
    console.error('Arrests CSV export error:', error?.message);
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Booking Checklist
// ════════════════════════════════════════════════════════════

router.get('/manual/:id/checklist', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    let checklist: any = {};
    try { checklist = JSON.parse(record.booking_checklist || '{}'); } catch { /* ignore */ }

    // Define standard checklist items
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

    res.json({
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
    console.error(err);
    res.status(500).json({ error: 'Failed to get booking checklist', code: 'BOOKING_CHECKLIST_ERROR' });
  }
});

router.put('/manual/:id/checklist', validateParamIdMiddleware, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    const { item_key, completed, notes } = req.body;
    if (!item_key) return res.status(400).json({ error: 'item_key required', code: 'ITEM_KEY_REQUIRED' });

    const now = localNow();
    let checklist: any = {};
    try { checklist = JSON.parse(record.booking_checklist || '{}'); } catch { /* ignore */ }

    if (completed) {
      const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
      checklist[item_key] = { at: now, by: user?.full_name || '', by_id: req.user!.userId, notes: notes || '' };
    } else {
      delete checklist[item_key];
    }

    db.prepare('UPDATE arrest_records SET booking_checklist = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(checklist), now, id);

    auditLog(req, 'checklist_updated', 'arrest_record', id, `Checklist item ${item_key}: ${completed ? 'completed' : 'unchecked'}`);
    res.json({ data: { arrest_id: id, item_key, completed: !!completed } });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update checklist', code: 'CHECKLIST_UPDATE_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Property Inventory at Arrest
// ════════════════════════════════════════════════════════════

router.get('/manual/:id/property', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    let inventory: any[] = [];
    try { inventory = JSON.parse(record.property_inventory || '[]'); } catch { /* ignore */ }

    res.json({ data: { arrest_id: id, items: inventory, total_items: inventory.length } });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get property inventory', code: 'PROPERTY_INVENTORY_ERROR' });
  }
});

router.post('/manual/:id/property', validateParamIdMiddleware, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    const { description, category, quantity, serial_number, estimated_value, disposition, notes } = req.body;
    if (!description) return res.status(400).json({ error: 'description required', code: 'DESCRIPTION_REQUIRED' });

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;

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
      logged_by_id: req.user!.userId,
      logged_at: now,
    };

    inventory.push(item);

    db.prepare('UPDATE arrest_records SET property_inventory = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(inventory), now, id);

    auditLog(req, 'property_added', 'arrest_record', id, `Property item added: ${description}`);
    broadcastRecordUpdate({ type: 'arrest_property_added', id });
    res.status(201).json({ data: item });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add property item', code: 'ADD_PROPERTY_ERROR' });
  }
});

router.delete('/manual/:id/property/:itemId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    let inventory: any[] = [];
    try { inventory = JSON.parse(record.property_inventory || '[]'); } catch { /* ignore */ }

    const newInventory = inventory.filter((i: any) => i.id !== req.params.itemId);
    if (newInventory.length === inventory.length) return res.status(404).json({ error: 'Property item not found', code: 'ITEM_NOT_FOUND' });

    db.prepare('UPDATE arrest_records SET property_inventory = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(newInventory), localNow(), id);

    res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove property item', code: 'REMOVE_PROPERTY_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Miranda Rights Acknowledgment Tracking
// ════════════════════════════════════════════════════════════

router.post('/manual/:id/miranda', validateParamIdMiddleware, requireRole('admin', 'manager', 'officer', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    const { read_at, acknowledged, waived_rights, requested_attorney, language,
      interpreter_used, interpreter_name, witness_officer_id, notes } = req.body;

    const now = localNow();
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user!.userId) as any;
    const witnessOfficer = witness_officer_id
      ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(witness_officer_id) as any
      : null;

    const mirandaData = {
      read_at: read_at || now,
      read_by: user?.full_name || '',
      read_by_id: req.user!.userId,
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

    db.prepare('UPDATE arrest_records SET miranda_data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(mirandaData), now, id);

    // Also update the booking checklist
    let checklist: any = {};
    try { checklist = JSON.parse(record.booking_checklist || '{}'); } catch { /* ignore */ }
    checklist.miranda_read = { at: now, by: user?.full_name || '', by_id: req.user!.userId };
    if (acknowledged !== false) {
      checklist.miranda_acknowledged = { at: now, by: user?.full_name || '', by_id: req.user!.userId };
    }
    db.prepare('UPDATE arrest_records SET booking_checklist = ? WHERE id = ?')
      .run(JSON.stringify(checklist), id);

    auditLog(req, 'miranda_recorded', 'arrest_record', id,
      `Miranda rights read: ${acknowledged !== false ? 'acknowledged' : 'refused'}${waived_rights ? ', rights waived' : ''}${requested_attorney ? ', attorney requested' : ''}`);

    res.json({ data: mirandaData });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record Miranda rights', code: 'MIRANDA_ERROR' });
  }
});

router.get('/manual/:id/miranda', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    let mirandaData: any = null;
    try { mirandaData = JSON.parse(record.miranda_data || 'null'); } catch { /* ignore */ }

    res.json({ data: { arrest_id: id, miranda: mirandaData } });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get Miranda data', code: 'MIRANDA_DATA_ERROR' });
  }
});

// ════════════════════════════════════════════════════════════
// UPGRADE: Cross-Link Arrests to Court Events
// ════════════════════════════════════════════════════════════

router.get('/manual/:id/linked-records', validateParamIdMiddleware, (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    const record = db.prepare('SELECT * FROM arrest_records WHERE id = ?').get(id) as any;
    if (!record) return res.status(404).json({ error: 'Record not found', code: 'RECORD_NOT_FOUND' });

    // Get cross-links
    const crossLinks = db.prepare(`
      SELECT linked_type, linked_id, match_type, match_confidence, created_at
      FROM arrest_cross_links WHERE arrest_record_id = ?
      LIMIT 100
    `).all(id) as any[];

    const links: any = { warrants: [], court_events: [], citations: [], incidents: [], cross_links: crossLinks };

    // Find warrants by name
    if (record.full_name) {
      try {
        links.warrants = db.prepare(`
          SELECT w.id, w.warrant_number, w.type as warrant_type, w.status,
            COALESCE(p.first_name || ' ' || p.last_name, '') as subject_name
          FROM warrants w LEFT JOIN persons p ON w.subject_person_id = p.id
          WHERE (p.last_name LIKE ? OR p.first_name LIKE ?) AND w.status = 'active' LIMIT 10
        `).all(`%${record.last_name}%`, `%${record.last_name}%`);
      } catch { /* warrants table may not exist */ }
    }

    // Find court events by name
    if (record.full_name) {
      links.court_events = db.prepare(`
        SELECT id, event_number, event_type, event_date, status, outcome FROM court_events
        WHERE defendant_name LIKE ? ORDER BY event_date DESC LIMIT 10
      `).all(`%${record.last_name}%`);
    }

    // Find citations by name
    if (record.full_name) {
      links.citations = db.prepare(`
        SELECT id, citation_number, violation, person_name, status FROM citations
        WHERE person_name LIKE ? ORDER BY created_at DESC LIMIT 10
      `).all(`%${record.last_name}%`);
    }

    res.json({ data: links });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get linked records', code: 'LINKED_RECORDS_ERROR' });
  }
});

export default router;
