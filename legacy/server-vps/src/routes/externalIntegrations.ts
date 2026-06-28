// ============================================================
// RMPG Flex — External API Integrations
// ------------------------------------------------------------
// Admin-managed registry of OUTBOUND HTTP integrations the app
// can call into. Each integration is a base URL + auth method
// + encrypted credential. Distinct from /api/admin/api-keys
// which handles INBOUND keys (other systems calling Flex).
//
// Routes:
//   GET    /api/admin/external-integrations           list
//   POST   /api/admin/external-integrations           create
//   PUT    /api/admin/external-integrations/:id       update
//   DELETE /api/admin/external-integrations/:id       delete
//   POST   /api/admin/external-integrations/:id/test  probe via GET
// ============================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { config } from '../config';
import { logger } from '../utils/logger';
import { paramStr } from '../utils/reqHelpers';

const router = Router();
router.use(authenticateToken);

const VALID_AUTH_TYPES = new Set(['none', 'api_key', 'bearer', 'basic', 'header']);

/** AES-256-GCM with key = SHA-256(JWT_SECRET). Same scheme as admin.ts. */
function encryptValue(plaintext: string): string {
  const key = crypto.createHash('sha256').update(config.jwt.secret).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

function decryptValue(stored: string): string {
  if (!/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i.test(stored)) return stored;
  try {
    const [ivHex, authTagHex, ctHex] = stored.split(':');
    const key = crypto.createHash('sha256').update(config.jwt.secret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let plain = decipher.update(ctHex, 'hex', 'utf8');
    plain += decipher.final('utf8');
    return plain;
  } catch { return ''; }
}

interface IntegrationRow {
  id: string;
  name: string;
  description: string | null;
  base_url: string;
  auth_type: string;
  auth_header_name: string | null;
  auth_value_encrypted: string | null;
  default_headers_json: string | null;
  enabled: number;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/** Public-safe shape — never returns the credential plaintext. */
function sanitize(row: IntegrationRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    base_url: row.base_url,
    auth_type: row.auth_type,
    auth_header_name: row.auth_header_name || '',
    has_credential: !!row.auth_value_encrypted,
    default_headers: row.default_headers_json ? safeParseJson(row.default_headers_json) : {},
    enabled: !!row.enabled,
    last_tested_at: row.last_tested_at,
    last_test_status: row.last_test_status,
    last_test_message: row.last_test_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
  };
}

function safeParseJson(s: string): Record<string, string> {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}

// ── List ─────────────────────────────────────────────────────
router.get('/', requireRole('admin'), (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM external_integrations ORDER BY enabled DESC, name ASC'
  ).all() as IntegrationRow[];
  res.json(rows.map(sanitize));
});

// ── Create ───────────────────────────────────────────────────
router.post('/', requireRole('admin'), (req: Request, res: Response) => {
  const {
    name, description, base_url, auth_type,
    auth_header_name, auth_value, default_headers, enabled,
  } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!base_url || typeof base_url !== 'string') {
    return res.status(400).json({ error: 'base_url is required' });
  }
  try { new URL(base_url); } catch {
    return res.status(400).json({ error: 'base_url is not a valid URL' });
  }
  const at = (auth_type || 'none').toLowerCase();
  if (!VALID_AUTH_TYPES.has(at)) {
    return res.status(400).json({ error: `auth_type must be one of: ${[...VALID_AUTH_TYPES].join(', ')}` });
  }

  const id = `int_${crypto.randomBytes(8).toString('hex')}`;
  const encrypted = auth_value ? encryptValue(String(auth_value)) : null;
  const headersJson = default_headers && typeof default_headers === 'object'
    ? JSON.stringify(default_headers) : null;
  const userId = (req as Request & { user?: { username?: string } }).user?.username || null;

  const db = getDb();
  db.prepare(`
    INSERT INTO external_integrations
      (id, name, description, base_url, auth_type, auth_header_name,
       auth_value_encrypted, default_headers_json, enabled, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name.trim(), description || null, base_url.trim(), at,
    auth_header_name || null, encrypted, headersJson,
    enabled === false ? 0 : 1, userId,
  );
  auditLog(req, 'CREATE', 'external_integrations', id, null, { name, base_url, auth_type: at });
  const row = db.prepare('SELECT * FROM external_integrations WHERE id = ?').get(id) as IntegrationRow;
  res.status(201).json(sanitize(row));
});

// ── Update ───────────────────────────────────────────────────
router.put('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const db = getDb();
  const existing = db.prepare('SELECT * FROM external_integrations WHERE id = ?').get(id) as IntegrationRow | undefined;
  if (!existing) return res.status(404).json({ error: 'integration not found' });

  const {
    name, description, base_url, auth_type,
    auth_header_name, auth_value, default_headers, enabled,
  } = req.body || {};

  if (base_url) {
    try { new URL(base_url); } catch {
      return res.status(400).json({ error: 'base_url is not a valid URL' });
    }
  }
  if (auth_type && !VALID_AUTH_TYPES.has(String(auth_type).toLowerCase())) {
    return res.status(400).json({ error: `auth_type must be one of: ${[...VALID_AUTH_TYPES].join(', ')}` });
  }

  // Only re-encrypt if a fresh credential was supplied. An empty string
  // means "clear the credential"; undefined means "keep existing".
  let encrypted: string | null | undefined = undefined;
  if (auth_value === '') encrypted = null;
  else if (typeof auth_value === 'string' && auth_value.length > 0) {
    encrypted = encryptValue(auth_value);
  }

  const headersJson = default_headers && typeof default_headers === 'object'
    ? JSON.stringify(default_headers) : (default_headers === null ? null : undefined);

  const fields: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(String(name).trim()); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description || null); }
  if (base_url !== undefined) { fields.push('base_url = ?'); values.push(String(base_url).trim()); }
  if (auth_type !== undefined) { fields.push('auth_type = ?'); values.push(String(auth_type).toLowerCase()); }
  if (auth_header_name !== undefined) { fields.push('auth_header_name = ?'); values.push(auth_header_name || null); }
  if (encrypted !== undefined) { fields.push('auth_value_encrypted = ?'); values.push(encrypted); }
  if (headersJson !== undefined) { fields.push('default_headers_json = ?'); values.push(headersJson); }
  if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
  fields.push("updated_at = datetime('now','localtime')");

  if (fields.length === 1) {
    return res.json(sanitize(existing));  // nothing changed except the timestamp
  }
  values.push(id);
  db.prepare(`UPDATE external_integrations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  auditLog(req, 'UPDATE', 'external_integrations', id, existing, req.body);
  const row = db.prepare('SELECT * FROM external_integrations WHERE id = ?').get(id) as IntegrationRow;
  res.json(sanitize(row));
});

// ── Delete ───────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const db = getDb();
  const existing = db.prepare('SELECT * FROM external_integrations WHERE id = ?').get(id) as IntegrationRow | undefined;
  if (!existing) return res.status(404).json({ error: 'integration not found' });
  db.prepare('DELETE FROM external_integrations WHERE id = ?').run(id);
  auditLog(req, 'DELETE', 'external_integrations', id, existing, null);
  res.json({ success: true });
});

// ── Test probe ───────────────────────────────────────────────
// Issues a single GET to base_url with the configured auth header.
// Stores the result on the row (last_test_status, last_test_message,
// last_tested_at) so the UI badge stays accurate.
router.post('/:id/test', requireRole('admin'), async (req: Request, res: Response) => {
  const id = paramStr(req.params.id);
  const db = getDb();
  const row = db.prepare('SELECT * FROM external_integrations WHERE id = ?').get(id) as IntegrationRow | undefined;
  if (!row) return res.status(404).json({ error: 'integration not found' });

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (row.default_headers_json) {
    const extra = safeParseJson(row.default_headers_json);
    for (const [k, v] of Object.entries(extra)) headers[k] = String(v);
  }

  const credential = row.auth_value_encrypted ? decryptValue(row.auth_value_encrypted) : '';
  switch (row.auth_type) {
    case 'api_key':
      headers[row.auth_header_name || 'X-API-Key'] = credential;
      break;
    case 'bearer':
      headers.Authorization = `Bearer ${credential}`;
      break;
    case 'basic':
      headers.Authorization = `Basic ${Buffer.from(credential).toString('base64')}`;
      break;
    case 'header':
      if (row.auth_header_name) headers[row.auth_header_name] = credential;
      break;
    case 'none':
    default:
      break;
  }

  let status: 'ok' | 'error' = 'error';
  let message = '';
  let httpStatus: number | null = null;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);  // 8s timeout
    const resp = await fetch(row.base_url, { method: 'GET', headers, signal: ctrl.signal });
    clearTimeout(t);
    httpStatus = resp.status;
    if (resp.ok) {
      status = 'ok';
      message = `HTTP ${resp.status}`;
    } else {
      status = 'error';
      message = `HTTP ${resp.status} ${resp.statusText || ''}`.trim();
    }
  } catch (err: unknown) {
    status = 'error';
    const e = err as { name?: string; message?: string };
    message = e?.name === 'AbortError' ? 'timeout (8s)' : (e?.message || 'fetch failed');
    logger.warn({ err, integrationId: id }, 'external integration test failed');
  }

  db.prepare(`
    UPDATE external_integrations
    SET last_tested_at = datetime('now','localtime'),
        last_test_status = ?, last_test_message = ?
    WHERE id = ?
  `).run(status, message.slice(0, 500), id);

  auditLog(req, 'TEST', 'external_integrations', id, null, { status, http_status: httpStatus });
  const updated = db.prepare('SELECT * FROM external_integrations WHERE id = ?').get(id) as IntegrationRow;
  res.json({ ...sanitize(updated), test: { status, message, http_status: httpStatus } });
});

export default router;
