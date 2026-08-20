// ============================================================
// RMPG Flex — malformed-JSON-body guard
// ============================================================
// A request body that isn't valid JSON produced an HTTP 500 across the API.
// `c.req.json()` throws a SyntaxError, and every route reaches that the same
// two ways (measured 2026-08-02):
//
//   58 handlers call `await c.req.json()` with no catch at all
//      -> the SyntaxError reaches the global onError -> 500 UNHANDLED
//   the rest wrap it in a handler-level try/catch whose catch returns 500
//      (dbErrorResponse or a literal 500) because it was written for DB
//      failures, not for parse failures
//
// Either way a client typo answered "the server broke". That pollutes
// error_log, can trip alerting, and tells the caller nothing actionable —
// the same reasoning as the 400/404/416 tile and Range fixes.
//
// Fixing it centrally here beats editing 58 call sites: one seam, no
// per-handler behaviour decisions, and no risk of a codemod mangling a
// handler it didn't understand.
//
// ⚠️ ONLY touches bodies whose Content-Type is application/json. This is
// load-bearing, not a fast path: reading the body of a multipart/form-data
// request in middleware makes the handler's later `formData()` call fail with
// a TypeError (verified against Hono in this repo's test runner), which would
// break EVERY file upload in the app — ALPR captures, bodycam video, field
// photos, serve-intake scans. Hono caches the body it has already read, so a
// JSON body parsed here is reused by the handler rather than re-read; that
// cache is per-representation, and priming it with text() is exactly what
// breaks the multipart path.
//
// An EMPTY body is deliberately passed straight through. Several routes
// legitimately treat "no body" as "no edits" (see src/routes/alpr.ts's
// `catch { /* empty body = no edits */ }`), so rejecting it here would change
// working behaviour. This guard only rejects a body that is present and
// genuinely unparseable.
import type { Context, Next } from 'hono';

/** Methods that can carry a request body worth validating. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True only for a real application/json content type (charset suffix ok). */
function isJsonContentType(raw: string | undefined): boolean {
  if (!raw) return false;
  // Match the media type only, so "application/json; charset=utf-8" counts but
  // "multipart/form-data" and "application/x-www-form-urlencoded" never do.
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(raw.trim());
}

export async function jsonBodyGuard(c: Context, next: Next): Promise<Response | void> {
  if (!BODY_METHODS.has(c.req.method.toUpperCase())) return next();
  if (!isJsonContentType(c.req.header('content-type'))) return next();

  let raw: string;
  try {
    raw = await c.req.text();
  } catch {
    // Body unreadable (aborted upload, stream error) — not a parse problem.
    // Leave it to the handler so genuine transport faults still surface.
    return next();
  }

  if (raw.trim() === '') return next(); // see note above: empty is not malformed

  try {
    JSON.parse(raw);
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }

  return next();
}

export default jsonBodyGuard;
