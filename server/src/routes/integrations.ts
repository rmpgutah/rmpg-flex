// ============================================================
// RMPG Flex — Integration Routes
// ============================================================
// Section A: Public API-key-authenticated endpoint for process
//            service intake (POST /service-request).
// Section B: Admin JWT-authenticated endpoints for managing
//            integration API keys (/keys/*).
// ============================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { authenticateApiKey } from '../middleware/apiKeyAuth';
import { authenticateToken, requireRole } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { generateCallNumber, generateCaseNumber } from '../utils/caseNumbers';
import { broadcastDispatchUpdate } from '../utils/websocket';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { encryptApiKey, decryptApiKey } from '../utils/serveManagerClient';

const router = Router();

// ─── Valid service types for process service requests ────────
const VALID_SERVICE_TYPES = ['subpoena', 'summons', 'complaint', 'eviction', 'restraining_order', 'other'] as const;
type ServiceType = typeof VALID_SERVICE_TYPES[number];

// ═════════════════════════════════════════════════════════════
// SECTION A — Public Endpoint (API Key Auth)
// ═════════════════════════════════════════════════════════════

const serviceRequestRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,
  keyGenerator: (req: Request) => `integration:${req.apiKeyId || req.ip || 'unknown'}`,
  message: 'Too many service requests. Please try again in a moment.',
});

router.post(
  '/service-request',
  authenticateApiKey('service_request'),
  serviceRequestRateLimit,
  (req: Request, res: Response): void => {
    try {
      const {
        respondent_name,
        respondent_address,
        service_type,
        rush,
        priority: requestedPriority,
        client_name,
        client_phone,
        client_email,
        billing_code,
        authorization,
        documents_description,
        court,
        case_number: clientCaseNumber,
        special_instructions,
      } = req.body;

      // ─── Validation ──────────────────────────────────
      if (!respondent_name || typeof respondent_name !== 'string' || !respondent_name.trim()) {
        res.status(400).json({ error: 'respondent_name is required.' });
        return;
      }
      if (!respondent_address || typeof respondent_address !== 'string' || !respondent_address.trim()) {
        res.status(400).json({ error: 'respondent_address is required.' });
        return;
      }
      if (!service_type || !VALID_SERVICE_TYPES.includes(service_type as ServiceType)) {
        res.status(400).json({
          error: `service_type is required and must be one of: ${VALID_SERVICE_TYPES.join(', ')}`,
        });
        return;
      }

      // Priority: default P3, P2 if rush, validate P1-P4
      let priority = 'P3';
      if (rush) priority = 'P2';
      if (requestedPriority) {
        if (!['P1', 'P2', 'P3', 'P4'].includes(requestedPriority)) {
          res.status(400).json({ error: 'priority must be P1, P2, P3, or P4.' });
          return;
        }
        priority = requestedPriority;
      }

      // ─── Build description ────────────────────────────
      const descParts: string[] = [`Process Service: ${service_type}`];
      if (documents_description) descParts.push(`Documents: ${documents_description}`);
      if (court) descParts.push(`Court: ${court}`);
      if (clientCaseNumber) descParts.push(`Case #: ${clientCaseNumber}`);
      const description = descParts.join(' | ');

      // ─── Generate numbers ────────────────────────────
      const db = getDb();
      const call_number = generateCallNumber(db);
      const case_number = generateCaseNumber(db, 'service');
      const now = localNow();

      // ─── INSERT into calls_for_service ────────────────
      const result = db.prepare(`
        INSERT INTO calls_for_service (
          call_number, incident_type, priority, status, source,
          location_address, description, notes,
          pso_service_type, pso_requestor_name, pso_requestor_phone, pso_requestor_email,
          pso_billing_code, pso_authorization,
          process_service_type, process_served_to, process_served_address,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        call_number,
        'process_service',
        priority,
        'pending',
        'online',
        respondent_address.trim(),
        description,
        special_instructions || null,
        'process_service',
        client_name || null,
        client_phone || null,
        client_email || null,
        billing_code || null,
        authorization || null,
        service_type,
        respondent_name.trim(),
        respondent_address.trim(),
        now,
      );

      const callId = Number(result.lastInsertRowid);

      // Fetch the full row for broadcasting
      const newCall = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(callId);

      // ─── Broadcast + Audit ────────────────────────────
      broadcastDispatchUpdate({ event: 'calls:created', call: newCall });

      auditLog(
        req,
        'integration_service_request',
        'integration_service_request',
        callId,
        `Process service request via API key "${req.apiKeyName}" — ${service_type} to ${respondent_name} at ${respondent_address}`,
      );

      res.status(201).json({
        success: true,
        call_id: callId,
        call_number,
        case_number,
        status: 'pending',
        message: 'Process service request created successfully.',
      });
    } catch (err: any) {
      console.error('[Integrations] Service request error:', err);
      res.status(500).json({ error: 'Failed to create service request.' });
    }
  },
);


// ═════════════════════════════════════════════════════════════
// SECTION B — Admin Endpoints (JWT Auth)
// ═════════════════════════════════════════════════════════════

// All /keys routes require JWT + admin or manager role
const adminRouter = Router();
adminRouter.use(authenticateToken);
adminRouter.use(requireRole('admin', 'manager'));

// GET /keys — List all API keys (never expose key_hash)
adminRouter.get('/', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        k.id, k.name, k.key_prefix, k.is_active, k.scopes,
        k.created_by, k.last_used_at, k.request_count, k.created_at,
        u.full_name AS created_by_name
      FROM integration_api_keys k
      LEFT JOIN users u ON u.id = k.created_by
      ORDER BY k.created_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[Integrations] List keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys.' });
  }
});

// POST /keys — Generate a new API key
adminRouter.post('/', (req: Request, res: Response): void => {
  try {
    const { name, scopes } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required.' });
      return;
    }

    // Generate key: rmpg_ps_ + 32 random hex bytes (64 hex chars)
    const rawKey = `rmpg_ps_${crypto.randomBytes(32).toString('hex')}`;
    const keyPrefix = rawKey.substring(0, 16); // rmpg_ps_ + first 8 hex chars
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // Default scopes or validate provided ones
    const keyScopes = scopes && Array.isArray(scopes) ? JSON.stringify(scopes) : '["service_request"]';

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO integration_api_keys (name, key_prefix, key_hash, scopes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name.trim(), keyPrefix, keyHash, keyScopes, req.user?.userId ?? null, localNow());

    const keyId = Number(result.lastInsertRowid);

    auditLog(
      req,
      'integration_key_created',
      'integration_api_key',
      keyId,
      `API key "${name.trim()}" created with prefix ${keyPrefix}`,
    );

    // Return the full key ONCE — it cannot be retrieved again
    res.status(201).json({
      success: true,
      id: keyId,
      name: name.trim(),
      key: rawKey,
      key_prefix: keyPrefix,
      scopes: JSON.parse(keyScopes),
      message: 'Save this API key now. It cannot be retrieved again.',
    });
  } catch (err: any) {
    console.error('[Integrations] Create key error:', err);
    res.status(500).json({ error: 'Failed to create API key.' });
  }
});

// PATCH /keys/:id/revoke — Deactivate an API key
adminRouter.patch('/:id/revoke', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;
    const result = db.prepare('UPDATE integration_api_keys SET is_active = 0 WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    auditLog(req, 'integration_key_revoked', 'integration_api_key', id, `API key #${id} revoked`);
    res.json({ success: true, message: 'API key revoked.' });
  } catch (err: any) {
    console.error('[Integrations] Revoke key error:', err);
    res.status(500).json({ error: 'Failed to revoke API key.' });
  }
});

// PATCH /keys/:id/activate — Re-activate an API key
adminRouter.patch('/:id/activate', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;
    const result = db.prepare('UPDATE integration_api_keys SET is_active = 1 WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    auditLog(req, 'integration_key_activated', 'integration_api_key', id, `API key #${id} activated`);
    res.json({ success: true, message: 'API key activated.' });
  } catch (err: any) {
    console.error('[Integrations] Activate key error:', err);
    res.status(500).json({ error: 'Failed to activate API key.' });
  }
});

// DELETE /keys/:id — Permanently delete an API key
adminRouter.delete('/:id', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { id } = req.params;
    const result = db.prepare('DELETE FROM integration_api_keys WHERE id = ?').run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    auditLog(req, 'integration_key_deleted', 'integration_api_key', id, `API key #${id} permanently deleted`);
    res.json({ success: true, message: 'API key deleted.' });
  } catch (err: any) {
    console.error('[Integrations] Delete key error:', err);
    res.status(500).json({ error: 'Failed to delete API key.' });
  }
});

// GET /request-log — Recent integration service requests from audit log
adminRouter.get('/request-log', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, user_id, action, entity_type, entity_id, details, ip_address, created_at
      FROM activity_log
      WHERE entity_type = 'integration_service_request'
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('[Integrations] Request log error:', err);
    res.status(500).json({ error: 'Failed to fetch request log.' });
  }
});

// Mount admin routes under /keys
router.use('/keys', adminRouter);


// ═════════════════════════════════════════════════════════════
// SECTION C — Connected Services Config (JWT Auth)
// ═════════════════════════════════════════════════════════════

const servicesRouter = Router();
servicesRouter.use(authenticateToken);
servicesRouter.use(requireRole('admin', 'manager'));

const CONNECTED_SERVICE_KEYS = ['rmpgutahps_api_key', 'rmpgutahps_url'] as const;

// GET /services/rmpgutahps — Get connection status for rmpgutahps.us
servicesRouter.get('/rmpgutahps', (_req: Request, res: Response): void => {
  try {
    const db = getDb();
    const keyRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    const urlRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    res.json({
      configured: !!keyRow,
      url: urlRow?.config_value || 'https://rmpgutahps.us',
      key_preview: keyRow ? '••••••••' + decryptApiKey(keyRow.config_value).slice(-8) : null,
    });
  } catch (err: any) {
    console.error('[Integrations] Get rmpgutahps config error:', err);
    res.status(500).json({ error: 'Failed to get service config.' });
  }
});

// PUT /services/rmpgutahps — Save API key and URL for rmpgutahps.us
servicesRouter.put('/rmpgutahps', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { api_key, url } = req.body;
    const now = localNow();

    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      res.status(400).json({ error: 'api_key is required.' });
      return;
    }

    const encrypted = encryptApiKey(api_key.trim());

    // Upsert API key
    db.prepare(
      "DELETE FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations'"
    ).run();
    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
      VALUES ('rmpgutahps_api_key', ?, 'integrations', 0, 1, ?, ?)
    `).run(encrypted, now, now);

    // Upsert URL
    const siteUrl = (url && typeof url === 'string' && url.trim()) ? url.trim() : 'https://rmpgutahps.us';
    db.prepare(
      "DELETE FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations'"
    ).run();
    db.prepare(`
      INSERT INTO system_config (config_key, config_value, category, sort_order, is_active, created_at, updated_at)
      VALUES ('rmpgutahps_url', ?, 'integrations', 0, 1, ?, ?)
    `).run(siteUrl, now, now);

    auditLog(req, 'integration_key_created', 'integration_api_key', 0,
      `Updated rmpgutahps.us API key and URL (${siteUrl})`);

    res.json({ success: true, message: 'rmpgutahps.us API key saved.' });
  } catch (err: any) {
    console.error('[Integrations] Save rmpgutahps config error:', err);
    res.status(500).json({ error: 'Failed to save service config.' });
  }
});

// DELETE /services/rmpgutahps — Clear rmpgutahps.us API key
servicesRouter.delete('/rmpgutahps', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    db.prepare(
      "DELETE FROM system_config WHERE config_key IN ('rmpgutahps_api_key', 'rmpgutahps_url') AND category = 'integrations'"
    ).run();

    auditLog(req, 'integration_key_deleted', 'integration_api_key', 0,
      'Cleared rmpgutahps.us API key');

    res.json({ success: true, message: 'rmpgutahps.us API key cleared.' });
  } catch (err: any) {
    console.error('[Integrations] Clear rmpgutahps config error:', err);
    res.status(500).json({ error: 'Failed to clear service config.' });
  }
});

router.use('/services', servicesRouter);

export default router;
