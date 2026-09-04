// ============================================================
// RMPG Flex — Global mutation audit middleware
// ============================================================
// Automatically writes an audit_log row for every authenticated
// state-changing request (POST/PUT/PATCH/DELETE) that returns 2xx.
//
// Why a middleware rather than per-route recordAudit() calls:
//   169 of 222 route files have mutation handlers with zero audit
//   coverage (discovered in the 2026-09 architecture review). Wiring
//   169 individual calls would be noisy, inconsistent, and
//   perpetually incomplete as new routes ship. A single middleware
//   applied globally guarantees minimum coverage by construction.
//
// Routes that already call recordAudit() explicitly (e.g. calls.ts,
// records.ts) will produce a second, generic entry. That is acceptable
// — the explicit entry carries richer context (call number, status
// change type); the generic entry proves the request happened even if
// the explicit call was accidentally removed or bypassed. Audit
// redundancy in law enforcement RMS is by design.
//
// To suppress the generic entry on a specific handler (e.g. high-
// frequency GPS pings that already have dedicated logging), set
//   c.set('skipAutoAudit', true)
// anywhere before the response is returned. The middleware checks this
// flag after next() returns and skips the DB write.
// ============================================================
import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { recordAuditCore } from '../utils/auditLog';

/**
 * Converts a camelCase or kebab-case + plural API path segment to a
 * singular snake_case entity type name suitable for audit_log.entity_type.
 *   "calls"        → "call"
 *   "callLinks"    → "call_link"
 *   "jailRoster"   → "jail_roster"
 */
function segmentToEntityType(segment: string): string {
  const desnaked = segment
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/-/g, '_');
  // Basic English singularisation (sufficient for these route names)
  if (desnaked.endsWith('ies')) return desnaked.slice(0, -3) + 'y';
  if (desnaked.endsWith('sses') || desnaked.endsWith('xes') || desnaked.endsWith('ches') || desnaked.endsWith('shes')) {
    return desnaked.slice(0, -2);
  }
  if (desnaked.endsWith('s') && desnaked.length > 2) return desnaked.slice(0, -1);
  return desnaked;
}

/**
 * Returns a human-readable entity type from a request pathname.
 * Examples:
 *   /api/dispatch/calls/123/notes  → "call"
 *   /api/warrants/456              → "warrant"
 *   /api/arrests                   → "arrest"
 *   /api/evidence/photos           → "evidence"
 */
function entityTypeFromPath(path: string): string {
  // Normalise: strip leading /api/ and split
  const segments = path.replace(/^\/+api\/+/, '').split('/').filter(Boolean);
  if (segments.length === 0) return 'unknown';

  // /api/dispatch/<resource>/… — use the sub-resource name
  if (segments[0] === 'dispatch' && segments[1]) {
    return segmentToEntityType(segments[1]);
  }
  return segmentToEntityType(segments[0]);
}

/**
 * Returns the first numeric path segment, which is almost always the
 * primary record id. Returns null for collection-level mutations (e.g.
 * POST /api/warrants to create a new warrant).
 */
function entityIdFromPath(path: string): number | null {
  for (const part of path.split('/')) {
    if (/^\d+$/.test(part)) return Number(part);
  }
  return null;
}

/**
 * Global mutation audit middleware.
 *
 * Mount AFTER authentication middleware (this middleware reads c.get('userId'),
 * which is only set once JWT verification succeeds). Requests without a resolved
 * userId (public/unauthenticated paths) are silently skipped.
 *
 * The DB write is fire-and-forget via executionCtx.waitUntil so it never adds
 * latency to the response. recordAuditCore() never throws.
 */
export async function mutationAuditMiddleware(c: Context<Env>, next: Next): Promise<void> {
  await next();

  // Skip reads
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  // Skip unauthenticated requests and callers that opt out
  const userId = c.get('userId') as number | undefined;
  if (!userId) return;
  if (c.get('skipAutoAudit')) return;

  // Only log successful mutations (4xx/5xx are failed attempts, not state changes)
  const status = c.res.status;
  if (status >= 400) return;

  const path = new URL(c.req.url).pathname;
  const entityType = entityTypeFromPath(path);
  const entityId = entityIdFromPath(path);

  const auditPromise = recordAuditCore(
    c.env,
    {
      action: `${method}_${entityType.toUpperCase()}`,
      entityType,
      entityId,
      actorId: userId,
      details: { path, status, auto: true },
    },
  );

  try {
    c.executionCtx.waitUntil(auditPromise);
  } catch {
    // executionCtx unavailable (test harness, DO alarm path)
    await auditPromise;
  }
}
