// ============================================================
// RMPG Flex — API Key Authentication Middleware
// ============================================================
// Validates X-API-Key header against integration_api_keys table.
// Used for external integrations (e.g., process service intake)
// that authenticate via API key rather than JWT.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb } from '../models/database';
import { localNow } from '../utils/timeUtils';

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

    // Hash the provided key and look it up
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const db = getDb();

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

    // Update usage tracking
    db.prepare(
      'UPDATE integration_api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?'
    ).run(localNow(), row.id);

    // Attach key info to request for downstream use
    req.apiKeyId = row.id;
    req.apiKeyName = row.name;

    next();
  };
}
