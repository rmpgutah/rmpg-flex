import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';
import { getDb, queryFirst } from '../utils/db';

export interface JwtPayload {
  sub?: string;
  // Both spellings live in the wild: tokens issued by this Worker use
  // `user_id` (snake_case), but tokens issued by the legacy `rmpg-flex`
  // Worker — still the source for /api/auth/login behind the proxy —
  // use `userId` (camelCase, see legacy/server-vps/src/middleware/auth.ts).
  // Accept both so a legacy-issued session can call any rewrite-routed
  // endpoint without re-authenticating.
  user_id?: number;
  userId?: number;
  username: string;
  role: string;
  // Token purpose. 'access' for real sessions; absent on legacy-issued
  // tokens. Anything in NON_SESSION_TOKEN_TYPES is rejected below.
  type?: string;
  // Narrow, single-purpose grants (e.g. 'pso-mobile'). Never a session.
  scope?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

// Token `type` values minted elsewhere with JWT_SECRET that must NEVER be
// accepted as a session bearer. Each is redeemable only by the endpoint
// that owns its flow:
//   refresh      → POST /api/auth/refresh
//   2fa_pending  → POST /api/auth/login/verify-2fa  (pre-second-factor)
//   pwd_reset    → the forgot-password completion handler
const NON_SESSION_TOKEN_TYPES = new Set(['refresh', '2fa_pending', 'pwd_reset']);

// Paths that MUST stay public no matter where authMiddleware is invoked from.
// OAuth providers (Microsoft Identity) redirect the user's BROWSER straight to
// the callback with ?code=&state=, carrying NO Authorization header or app
// cookie — so auth-gating it 401s every consent ("Authentication required").
// The callback authenticates via the CSRF `state` token instead. We bypass auth
// here (the single chokepoint) rather than relying only on per-router skips,
// which proved fragile (the email router's own skip + the registry's public
// flag weren't enough in prod). Matched by suffix so it holds regardless of the
// router's mount prefix.
function isPublicAuthBypass(pathname: string): boolean {
  // /api/fleetio/webhook — Fleet.io POSTs here without a JWT; the route
  // itself verifies the inbound 'Authorization' header equals
  // FLEETIO_WEBHOOK_SECRET (Fleet.io's authz model — PR 4c rewrite)
  // before queueing the inbound event (see src/routes/fleetioWebhook.ts).
  return pathname === '/api/email/oauth/callback'
    || pathname.endsWith('/oauth/callback')
    // Per-user mailbox connect callback (Phase 3): Microsoft redirects the
    // browser here with ?code&state after consent — no JWT in the request.
    // The callback authenticates via the CSRF state token stored in D1.
    || pathname === '/api/email/connect/callback'
    || pathname === '/api/fleetio/webhook'
    // Dial Connect → calls_for_service push. External service, no human
    // JWT session — gated instead by requireApiKeyScope('service_request')
    // in src/routes/integrations.ts (integration_api_keys, migration 0006).
    || pathname === '/api/integrations/calls-for-service'
    // Dial Connect → recording + transcript ingest (same API-key model as CFS).
    || pathname === '/api/integrations/dial-connect-recordings';
}

// ── Audited self-verifying media routes ─────────────────────────
// The `sig`+`exp` passthrough below hands a request to the handler WITHOUT
// verifying the signature, on the promise that the handler verifies it
// itself (via verifySignedResource() or uploads' resolveAuth()). That
// promise is unenforceable by construction: a new `/stream` route that
// merely MATCHES isMediaPath() silently inherits "no authentication at
// all" rather than failing closed. That is exactly how the dashcam,
// FlexCam, ClearPath, field-photo and email-proxy handlers ended up
// world-readable.
//
// So the passthrough is now DEFAULT-DENY: a path must appear here, having
// been read and confirmed to verify its own signature, or it gets a 401
// like any other unauthenticated request. Adding a new signed-media route
// means adding its pattern here — and if you forget, the failure is a
// visible 401 on your own feature, not silent public access to evidence.
const SELF_VERIFYING_MEDIA_PATHS: RegExp[] = [
  /^\/api\/uploads\/[^/]+(\/(content|thumbnail))?$/,            // resolveAuth() — HMAC binds fileId
  /^\/api\/fleet\/dashcam-videos\/\d+\/stream$/,                // verifySignedResource 'dashcam'
  /^\/api\/personnel\/bodycam-videos\/\d+\/(stream|thumbnail)$/, // 'bodycam' / 'bodycam-thumb'
  /^\/api\/radio\/transmissions\/\d+\/audio$/,                  // 'radio'
  /^\/api\/alpr\/image\/.+$/,                                   // requireRole → fails closed without a user
  /^\/api\/driving-events\/\d+\/stream$/,                       // 'driving-event'
  /^\/api\/clearpathgps\/media\/\d+\/stream$/,                  // 'dashcam' (same rows as the fleet route)
  /^\/api\/flexcam\/footage\/\d+\/chunk\/\d+\/stream$/,         // 'flexcam-chunk'
  /^\/api\/field-photos\/file\/.+$/,                            // 'field-photo'
  /^\/api\/email\/image-proxy$/,                                // 'email-image'
  /^\/api\/email\/messages\/[^/]+\/attachments\/[^/]+$/,        // 'email-attachment'
];

function isSelfVerifyingMediaPath(pathname: string): boolean {
  return SELF_VERIFYING_MEDIA_PATHS.some((re) => re.test(pathname));
}

// Media endpoints that browser tags fetch without headers. Auth for these
// arrives in the query string (signed params, or the legacy token fallback).
function isMediaPath(pathname: string): boolean {
  return pathname.includes('/uploads/')
    || pathname.includes('/field-photos/file/')
    || pathname.includes('/alpr/image/')
    || pathname.includes('/full-drive/clip/')  // dashcam clip streaming (<video> can't send header)
    || pathname.endsWith('/stream')
    || pathname.endsWith('/audio')
    || pathname.endsWith('/thumbnail')  // bodycam-video <img> tags (Task 4, storage-architecture phase)
    || pathname === '/api/email/image-proxy'  // email remote-image proxy (<img> in blob: iframe)
    || /\/email\/messages\/[^/]+\/attachments\/[^/]+$/.test(pathname)  // email inline CID images
    // Training portal <img>/<a download> tags cannot send Authorization.
    || /\/api\/tesseract-training\/documents\/\d+\/image$/.test(pathname)
    || /\/api\/tesseract-training\/documents\/runs\/\d+\/download$/.test(pathname)
    // Serve intake packet <a href> / <img> cannot send Authorization.
    || /\/api\/serve-intake\/documents\/\d+\/file$/.test(pathname)
    // Digital evidence preview/download (<img>/<a> + authedImageUrl).
    || /\/api\/evidence\/digital\/\d+\/file$/.test(pathname)
    || pathname.includes('/evidence/digital/file/')
    // Premise / property gallery <img src> (RecordPhotoGallery).
    || pathname.includes('/property-photos/file/')
    || pathname.includes('/business-photos/file/')
    // Redacted video download links.
    || /\/api\/redactions\/\d+\/download$/.test(pathname);
}

export async function authMiddleware(c: Context, next: Next) {
  if (isPublicAuthBypass(new URL(c.req.url).pathname)) {
    return next();
  }
  const authHeader = c.req.header('Authorization');
  const cookieToken = getCookie(c, 'access_token');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookieToken) {
    token = cookieToken;
  } else if (c.req.method === 'GET' && isMediaPath(new URL(c.req.url).pathname)) {
    // LEGACY query-token fallback, now restricted to GET on media paths
    // only. <video>/<audio>/<img> tags can't carry an Authorization header;
    // the preferred mechanism is per-resource HMAC params issued by
    // POST /api/auth/sign-urls (sig/exp/nonce — handled below). This branch
    // remains so cached pre-signed-URL clients keep playing media for one
    // SW cycle; a JWT in a query string anywhere else is rejected.
    const queryToken = c.req.query('token');
    if (queryToken) token = queryToken;
  }

  if (!token) {
    // HMAC-signed resource access: uploads routes verify sig+exp via their
    // own resolveAuth(); stream/audio handlers verify sig/exp/nonce via
    // verifySignedResource(). Either way the HANDLER is the verification
    // point — this passthrough only applies to GET on media paths, and a
    // bogus signature still 401s in the handler.
    const sig = c.req.query('sig');
    const exp = c.req.query('exp');
    const path = new URL(c.req.url).pathname;
    // Default-deny: only routes explicitly listed as self-verifying may run
    // header-less. isMediaPath() alone is NOT sufficient — see the comment
    // on SELF_VERIFYING_MEDIA_PATHS.
    if (sig && exp && c.req.method === 'GET' && isSelfVerifyingMediaPath(path)) {
      await next();
      return;
    }
    return c.json({ error: 'Authentication required' }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET as string);
    const { payload } = await jwtVerify(token, secret);
    const jwtPayload = payload as unknown as JwtPayload;

    // ── Token purpose enforcement ─────────────────────────────
    // Several flows mint short-lived JWTs with the SAME JWT_SECRET this
    // middleware trusts. Verifying the signature alone is therefore not
    // enough to prove a token is a session: without these checks, a
    // pre-2FA handle is a full API session (MFA bypass), and a refresh
    // token works as an access token.
    //
    // `type` is absent on legacy-issued tokens (see JwtPayload above), so
    // this is a DENY-list on known non-session purposes rather than an
    // allow-list on 'access' — an allow-list would log out every legacy
    // session on deploy.
    const tokenType = typeof jwtPayload.type === 'string' ? jwtPayload.type : null;
    if (tokenType && NON_SESSION_TOKEN_TYPES.has(tokenType)) {
      return c.json({ error: 'Token is not valid for session use' }, 401);
    }

    // Scoped tokens (currently the PSO QR session minted by
    // src/routes/mobileCfs.ts, `scope: 'pso-mobile'`) authorize ONE call
    // and are verified by their own router, which is mounted public. If
    // accepted here they would silently become a full API session
    // carrying whatever role the user row holds.
    if (jwtPayload.scope != null) {
      return c.json({ error: 'Scoped token cannot be used as a session' }, 401);
    }

    const userId = jwtPayload.user_id ?? jwtPayload.userId;
    if (userId == null) {
      return c.json({ error: 'Invalid token: missing user id claim' }, 401);
    }

    const db = getDb(c.env);
    const user = await queryFirst<{
      id: number;
      username: string;
      role: string;
      full_name: string;
      status: string;
    }>(
      db,
      'SELECT id, username, role, full_name, status FROM users WHERE id = ? AND status = ?',
      userId,
      'active'
    );

    if (!user) {
      return c.json({ error: 'User not found or inactive' }, 401);
    }

    c.set('user', {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
    });
    c.set('userId', user.id);
    c.set('sessionId', typeof jwtPayload.sessionId === 'string' ? jwtPayload.sessionId : null);

    await next();
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}

// ── Router-level RBAC floor ─────────────────────────────────
// Per-handler requireRole() checks are opt-in — any new mutation handler
// that forgets one is open to every authenticated role. This guard is the
// default-deny backstop: read-only roles can never mutate, no matter what
// an individual handler does (or forgets). Mounted on every auth-required
// prefix in src/index.ts, right after authMiddleware.
const READ_ONLY_ROLES = new Set(['client_viewer']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── Sensitive-read deny-list for read-only roles ────────────────
//
// The mutation backstop above covers WRITES ONLY. Reads had no floor at all,
// and `requireRole` is opt-in per handler — so a GET written as a plain
// `get(path, handler)` was reachable by EVERY authenticated role, including
// client_viewer (a hiring client with a login).
//
// Audited 2026-07-31 across the sensitive routers. The asymmetry was total:
//   jail.ts 10 GETs / 0 gated      records.ts 39 / 0      intel.ts 17 / 0
//   warrants.ts 13 / 0             billing.ts  7 / 0      useOfForce.ts 4 / 0
//   flexcam.ts 9 / 0
// Every write in those files was gated; not one read was. That left ~120
// endpoints exposing inmate medical screenings, visitor PII, full person
// records, intel products, warrant subjects, every client's invoices, and
// video evidence. (affairs.ts and dlRecords.ts gate all their reads, which is
// the precedent this follows — the practice existed, it was just not applied
// consistently.)
//
// ⚠️ This is a PREFIX floor, not row-level authorization. "A client may see
// their own contract data" is NOT implementable today: `users` has no
// client_id/org_id, and billing.ts takes client_id from a QUERY PARAMETER
// (`?client_id=`) with conditions starting at `1=1` — so /api/billing/invoices
// returns EVERY client's invoices by default. A real client portal needs a
// user->client linkage plus row filtering; until that exists, denying is the
// only correct answer, so /api/billing and /api/invoices are on this list.
//
// Deliberately NOT listed (not client-sensitive): /api/assessor (public parcel
// data), /api/inspection-templates (fleet config), /api/voice-persona (the
// caller's own preferences), /api/code-enforcement.
//
// Prefix match, so a parent covers its children: '/api/intel' also denies
// /api/intel/ai, '/api/serve' also denies /api/serve-queue, and so on.
const READ_ONLY_DENIED_PREFIXES = [
  '/api/affairs', '/api/alpr', '/api/arrests', '/api/billing', '/api/cases',
  '/api/citations', '/api/comms/bolos', '/api/dispatch/bolos', '/api/dl-records',
  '/api/driver-performance',
  '/api/evidence', '/api/flexcam', '/api/gang-intel', '/api/hr', '/api/incidents',
  '/api/intel', '/api/invoices', '/api/jail', '/api/nsopw', '/api/person-intel',
  '/api/personnel', '/api/process-server', '/api/records', '/api/serve',
  '/api/sor-sources', '/api/use-of-force', '/api/warrants',
  '/api/dial-connect-recordings',
];

export async function readOnlyRoleGuard(c: Context, next: Next) {
  const user = c.get('user') as { role?: string } | undefined;
  if (user?.role && READ_ONLY_ROLES.has(user.role)) {
    if (MUTATING_METHODS.has(c.req.method)) {
      return c.json({ error: 'Read-only role cannot modify data', code: 'FORBIDDEN' }, 403);
    }
    const path = c.req.path;
    if (READ_ONLY_DENIED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
      return c.json({ error: 'Read-only role cannot access this resource', code: 'FORBIDDEN' }, 403);
    }
  }
  await next();
}

/** Exported for the RBAC ratchet in tests/readOnlyRoleGuard.test.ts. */
export const __readOnlyGuardInternals = { READ_ONLY_ROLES, MUTATING_METHODS, READ_ONLY_DENIED_PREFIXES };

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as { role: string };
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
