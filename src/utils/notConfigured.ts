// ============================================================
// RMPG Flex — "not configured" response helper
// ------------------------------------------------------------
// Standardizes the response when a route's underlying integration
// (Fleet.io, ClearPathGPS, Firecrawl, Anthropic, etc.) hasn't been
// provisioned yet — secret unset, API key blank, feature flag off.
//
// Anti-pattern this replaces: returning 503 Service Unavailable. 503
// means "the server is temporarily down, retry later" and triggers:
//   - the browser's red console error per request,
//   - automatic client retries (apiFetch retries on 5xx),
//   - misleading "outage" signals in observability dashboards.
//
// A missing secret is a configuration gap, NOT an outage. It's a stable
// state until the operator sets the secret — retrying is pointless.
// Returning **200 with `skipped: true`** in the body lets clients see
// the truth and gracefully no-op without polluting console / metrics.
//
// Use ONLY for "I literally cannot run because config X is missing"
// situations. For genuine runtime failures (decryption error, network
// timeout, upstream API down), keep returning 5xx.
// ============================================================

/** Hono-context shape needed here. We only call .json(), so a structural
 *  type avoids importing Hono's full Context generic and the
 *  Bindings/Variables generic gymnastics that come with it. */
interface JsonContext {
  json(obj: Record<string, unknown>): Response;
}

/** Standardized 200-OK response signaling the integration is not provisioned.
 *  Always returns HTTP 200 — the body's `ok: false` + `skipped: true`
 *  are the truthful signals. */
export function notConfigured(
  c: JsonContext,
  reason: string,
  extra?: Record<string, unknown>,
): Response {
  return c.json({
    ok: false,
    skipped: true,
    code: 'not_configured',
    reason,
    ...extra,
  });
}
