// ============================================================
// SearchBug Criminal Records API Integration
// ============================================================
// Proxies criminal records searches through SearchBug's API so
// credentials stay server-side. Stores encrypted API credentials
// in system_config (same pattern as Microbilt integration).
//
// API docs: https://www.searchbug.com/info/api/criminal-records-api/
// Endpoint: POST https://data.searchbug.com/api/search.aspx
// Auth: CO_CODE (account #) + Bearer token or PASS header

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';
import config from '../config';

const router = Router();
router.use(authenticateToken);

// ============================================================
// Encryption helpers (reuses pattern from microbilt.ts)
// ============================================================

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
  const [ivHex, authTagHex, ciphertext] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================
// Config helpers
// ============================================================

const CONFIG_KEYS = {
  accountNumber: 'searchbug_account_number',
  apiKey: 'searchbug_api_key',
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

// ============================================================
// SearchBug API constants
// ============================================================

const SEARCHBUG_API_URL = 'https://data.searchbug.com/api/search.aspx';

// ============================================================
// Admin routes — credential management
// ============================================================

// GET /api/searchbug/status — current configuration status
router.get('/status', requireRole('admin', 'manager'), (_req: Request, res: Response) => {
  try {
    const accountNumber = getConfigValue(CONFIG_KEYS.accountNumber);
    res.json({
      configured: !!accountNumber,
      has_account_number: !!accountNumber,
      has_api_key: !!getConfigValue(CONFIG_KEYS.apiKey),
    });
  } catch (error: any) {
    console.error('SearchBug status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/searchbug/credentials — save API credentials (encrypted)
router.put('/credentials', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const { account_number, api_key } = req.body;

    if (account_number) setConfigValue(CONFIG_KEYS.accountNumber, account_number, true);
    if (api_key) setConfigValue(CONFIG_KEYS.apiKey, api_key, true);

    // Log the change
    const db = getDb();
    const now = localNow();
    const userId = (req as any).user?.id || 0;
    try {
      db.prepare(
        "INSERT INTO audit_log (user_id, action, resource_type, details, created_at) VALUES (?, 'update', 'system_config', ?, ?)"
      ).run(userId, 'SearchBug API credentials updated', now);
    } catch { /* audit table may not exist */ }

    res.json({ message: 'SearchBug credentials saved' });
  } catch (error: any) {
    console.error('SearchBug credentials error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/searchbug/credentials — remove all SearchBug credentials
router.delete('/credentials', requireRole('admin'), (_req: Request, res: Response) => {
  try {
    deleteConfigValue(CONFIG_KEYS.accountNumber);
    deleteConfigValue(CONFIG_KEYS.apiKey);
    res.json({ message: 'SearchBug credentials removed' });
  } catch (error: any) {
    console.error('SearchBug delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/searchbug/test — test connection by checking account balance
router.post('/test', requireRole('admin', 'manager'), async (_req: Request, res: Response) => {
  try {
    const accountNumber = getDecryptedValue(CONFIG_KEYS.accountNumber);
    const apiKey = getDecryptedValue(CONFIG_KEYS.apiKey);
    if (!accountNumber || !apiKey) {
      return res.status(400).json({ success: false, error: 'SearchBug credentials not configured' });
    }

    const formData = new URLSearchParams();
    formData.append('CO_CODE', accountNumber);
    formData.append('PASS', apiKey);
    formData.append('TYPE', 'status');
    formData.append('TYPE_API', 'api_crm');
    formData.append('FORMAT', 'JSON');

    const resp = await fetch(SEARCHBUG_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (data?.Status === 'Success' || data?.Data?.BALANCE) {
      return res.json({
        success: true,
        message: `Connected — Balance: $${data.Data?.BALANCE || '?'}, Rate: $${data.Data?.RATE || '?'}/search`,
        balance: data.Data?.BALANCE,
        rate: data.Data?.RATE,
      });
    }

    return res.json({ success: false, error: data?.Error || data?.raw || 'Unknown error from SearchBug' });
  } catch (error: any) {
    console.error('SearchBug test error:', error);
    res.status(500).json({ success: false, error: error.message || 'Connection failed' });
  }
});

// ============================================================
// Search routes — criminal records lookup
// ============================================================

// POST /api/searchbug/criminal-search — search criminal records
router.post('/criminal-search', async (req: Request, res: Response) => {
  try {
    const accountNumber = getDecryptedValue(CONFIG_KEYS.accountNumber);
    const apiKey = getDecryptedValue(CONFIG_KEYS.apiKey);
    if (!accountNumber || !apiKey) {
      return res.status(400).json({ error: 'SearchBug API not configured. Contact your admin.' });
    }

    const { first_name, last_name, city, state, dob } = req.body;

    if (!last_name) {
      return res.status(400).json({ error: 'Last name is required' });
    }

    // Build the POST form body
    const formData = new URLSearchParams();
    formData.append('CO_CODE', accountNumber);
    formData.append('PASS', apiKey);
    formData.append('TYPE', 'api_crm');
    formData.append('FORMAT', 'JSON');
    if (first_name) formData.append('FNAME', first_name);
    if (last_name) formData.append('LNAME', last_name);
    if (city) formData.append('CITY', city);
    if (state) formData.append('STATE', state);
    if (dob) formData.append('DOB', dob);

    // Add a tracking reference
    formData.append('REF', `rmpg-flex-${(req as any).user?.id || 0}`);

    const resp = await fetch(SEARCHBUG_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const text = await resp.text();

    // Try to parse as JSON
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // Might be XML — try to detect a "no results" XML response
      if (text.includes('<FOUND>No</FOUND>')) {
        return res.json({ found: false, criminals: [] });
      }
      // Return raw for debugging
      return res.status(502).json({ error: 'Unexpected response format from SearchBug', raw: text.substring(0, 500) });
    }

    // Check for API-level errors
    if (data?.Status === 'Error' || data?.Error) {
      return res.status(400).json({ error: data.Error || 'SearchBug returned an error' });
    }

    // Log the search to audit trail
    const db = getDb();
    const now = localNow();
    const userId = (req as any).user?.id || 0;
    try {
      db.prepare(
        "INSERT INTO audit_log (user_id, action, resource_type, details, created_at) VALUES (?, 'search', 'criminal_records', ?, ?)"
      ).run(userId, JSON.stringify({ source: 'searchbug', last_name, first_name, state }), now);
    } catch { /* audit table may not exist */ }

    // Normalize the response
    const criminals = data?.criminals || data?.result?.criminals || [];
    const criminalList = Array.isArray(criminals) ? criminals : (criminals?.criminal ? [criminals.criminal] : []);

    // Map to a clean response format
    const results = criminalList.map((c: any) => {
      const suspect = c?.suspect || {};
      const name = suspect?.name || {};
      const address = suspect?.address || {};
      const crimes = c?.crimeDetailsRecords?.crimeDetails || [];
      const crimeList = Array.isArray(crimes) ? crimes : [crimes];

      return {
        name: {
          first: name.firstName || '',
          middle: name.middleName || '',
          last: name.lastName || '',
          suffix: name.nameSuffix || '',
        },
        dob: suspect.DOB || '',
        age: suspect.currentAge || '',
        gender: suspect.gender || '',
        race: suspect.ethnicity || '',
        hair: suspect.hair || '',
        eyes: suspect.eyes || '',
        height: suspect.height || '',
        weight: suspect.weight || '',
        scars_marks: suspect.scarsMarks || '',
        is_sex_offender: suspect.isSexOffender || 'Unknown',
        address: {
          line1: address.line1 || address.Line1 || '',
          city: address.City || address.city || '',
          county: address.county || '',
          state: address.state || '',
          zip: address.zip || '',
        },
        crimes: crimeList.filter(Boolean).map((crime: any) => ({
          source_state: crime.sourceState || '',
          case_number: crime.caseNumber || '',
          crime_type: crime.crimeType || '',
          case_type: crime.caseType || '',
          offense_code: crime.offenseCode || '',
          offense_description: crime.offenseDescription1 || '',
          offense_description_2: crime.offenseDescription2 || '',
          disposition: crime.disposition || '',
          disposition_date: crime.dispositionDate || '',
          offense_date: crime.offenseDate || '',
          charges_filed_date: crime.chargesFiledDate || '',
          court: crime.court || '',
          county: crime.crimeCounty || '',
          sentence: crime.sentence || '',
          probation: crime.probation || '',
          fines: crime.fines || '',
          plea: crime.plea || '',
          arresting_agency: crime.arrestingAgency || '',
          warrant: crime.warrant || '',
          warrant_date: crime.warrantDate || '',
          victim_gender: crime.victimGender || '',
          victim_age: crime.victimAge || '',
          victim_is_minor: crime.victimIsMinor || '',
        })),
      };
    });

    res.json({
      found: results.length > 0,
      count: results.length,
      criminals: results,
    });
  } catch (error: any) {
    console.error('SearchBug criminal search error:', error);
    res.status(500).json({ error: 'Criminal records search failed' });
  }
});

export default router;
