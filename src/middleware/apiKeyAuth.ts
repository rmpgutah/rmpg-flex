// ============================================================
// RMPG Flex — integration API-key auth middleware
// ============================================================
// Gates machine-to-machine endpoints (e.g. Dial Connect pushing new
// incidents into calls_for_service) using the `integration_api_keys` table
// created by migration 0006 and issued via POST /api/integrations/keys.
//
// This is a DIFFERENT auth model than authMiddleware (src/middleware/auth.ts,
// human JWT sessions). A route gated by this middleware must be added to the
// `isPublicAuthBypass()` allow-list in auth.ts so the JWT check doesn't run
// first and 401 the request before this middleware ever sees it (same
// pattern already used for the Fleet.io webhook).
//
// Lookup strategy: key_hash carries a UNIQUE constraint (migration 0006), so
// we hash the inbound bearer token and look it up directly by key_hash —
// no need to first resolve a row by key_prefix and then compare hashes.
// (The key_prefix column exists for display in the admin UI's key list,
// not for lookup.) Hashing reuses `sha256Hex` from ../utils/apiKeys — the
// exact same helper POST /api/integrations/keys uses to compute key_hash at
// issuance time, so the two can never drift out of sync.
//
// integration_api_keys has no expires_at column (checked migration 0006 —
// none exists), so there is nothing to check there; only is_active gates
// revocation.
// ============================================================

import type { Context, Next } from 'hono';
import { getDb, queryFirst, execute } from '../utils/db';
import { sha256Hex } from '../utils/apiKeys';

interface IntegrationApiKeyRow {
  id: number;
  name: string;
  is_active: number;
  scopes: string;
}

export interface IntegrationApiKeyContext {
  id: number;
  name: string;
  scopes: string[];
}

/**
 * Returns Hono middleware that requires a valid, active `integration_api_keys`
 * bearer token whose `scopes` array includes `scope`.
 *
 * - Missing / malformed / unknown / revoked key → 401.
 * - Valid, active key but missing the required scope → 403.
 * - On success, sets `c.set('apiKey', { id, name, scopes })` for handlers to
 *   read, and best-effort bumps `last_used_at` / `request_count`.
 */
export function requireApiKeyScope(scope: string) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing bearer API key' }, 401);
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return c.json({ error: 'Missing bearer API key' }, 401);
    }

    const db = getDb(c.env as { DB: any });
    const keyHash = await sha256Hex(token);
    const row = await queryFirst<IntegrationApiKeyRow>(
      db,
      `SELECT id, name, is_active, scopes FROM integration_api_keys WHERE key_hash = ?`,
      keyHash,
    );

    if (!row || !row.is_active) {
      return c.json({ error: 'Invalid or revoked API key' }, 401);
    }

    let scopes: string[] = [];
    try {
      const parsed = JSON.parse(row.scopes);
      if (Array.isArray(parsed)) scopes = parsed;
    } catch {
      scopes = [];
    }

    if (!scopes.includes(scope)) {
      return c.json({ error: `API key is missing required scope "${scope}"`, code: 'FORBIDDEN' }, 403);
    }

    c.set('apiKey', { id: row.id, name: row.name, scopes } as IntegrationApiKeyContext);

    // Best-effort usage tracking — never blocks or fails the request.
    try {
      await execute(
        db,
        `UPDATE integration_api_keys SET last_used_at = datetime('now'), request_count = request_count + 1 WHERE id = ?`,
        row.id,
      );
    } catch {
      /* usage tracking is non-critical */
    }

    await next();
  };
}
