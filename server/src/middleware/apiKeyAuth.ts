// ============================================================
// RMPG Flex — API Key Authentication Middleware
// ============================================================
// Validates X-API-Key header against integration_api_keys table.
// Used for external integrations (e.g., process service intake)
// that authenticate via API key rather than JWT.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';
import { hashApiKey } from '../utils/apiKeyHash';

// Extend Express Request for API key context
declare global {
  namespace Express {
    interface Request {
      apiKeyId?: number;
      apiKeyName?: string;
    }
  }
}

interface ApiKeyRow {
  id: number;
  name: string;
  is_active: number;
  scopes: string;
}

/**
 * Middleware factory that authenticates requests via X-API-Key header.
 *
 * @param requiredScope  The scope the key must include (e.g., 'service_request')
 * @returns Express middleware
 */
export function authenticateApiKey(requiredScope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      res.status(401).json({ error: 'API key required. Provide X-API-Key header.' });
      return;
    }

    // [FIX 22] Reject obviously invalid API key lengths to prevent hash flooding
    if (apiKey.length > 512) {
      res.status(400).json({ error: 'Invalid API key format.' });
      return;
    }

    // Hash the provided key and look it up
    const keyHash = hashApiKey(apiKey);
    let db;
    try {
      db = getDb();
    } catch (err) {
      // [FIX 23] Handle database unavailability gracefully
      console.error('[API_KEY_AUTH] Database unavailable:', err);
      res.status(503).json({ error: 'Service temporarily unavailable' });
      return;
    }

    const row = db.prepare(
      'SELECT id, name, is_active, scopes FROM integration_api_keys WHERE key_hash = ?'
    ).get(keyHash) as ApiKeyRow | undefined;

    if (!row) {
      res.status(401).json({ error: 'Invalid API key.' });
      return;
    }

    if (!row.is_active) {
      res.status(403).json({ error: 'API key has been revoked.' });
      return;
    }

    // Validate scope
    let scopes: string[];
    try {
      scopes = JSON.parse(row.scopes);
    } catch {
      scopes = [];
    }

    if (!scopes.includes(requiredScope)) {
      res.status(403).json({ error: `API key does not have the required scope: ${requiredScope}` });
      return;
    }

    // [FIX 24] Wrap usage tracking update in try/catch so tracking failure doesn't block the request
    try {
      db.prepare(
        'UPDATE integration_api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?'
      ).run(localNow(), row.id);
    } catch (err) {
      console.error('[API_KEY_AUTH] Failed to update usage tracking:', err);
    }

    // Attach key info to request for downstream use
    req.apiKeyId = row.id;
    req.apiKeyName = row.name;

    next();
  };
}
