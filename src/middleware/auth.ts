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
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

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
  // itself verifies an HMAC SHA-256 signature against FLEETIO_WEBHOOK_SECRET
  // before queueing the inbound event (see src/routes/fleetioWebhook.ts).
  return pathname === '/api/email/oauth/callback'
    || pathname.endsWith('/oauth/callback')
    || pathname === '/api/fleetio/webhook';
}

// Media endpoints that browser tags fetch without headers. Auth for these
// arrives in the query string (signed params, or the legacy token fallback).
function isMediaPath(pathname: string): boolean {
  return pathname.includes('/uploads/')
    || pathname.includes('/field-photos/file/')
    || pathname.includes('/alpr/image/')
    || pathname.includes('/full-drive/clip/')  // dashcam clip streaming (<video> can't send header)
    || pathname.endsWith('/stream')
    || pathname.endsWith('/audio');
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
    if (sig && exp && c.req.method === 'GET' && isMediaPath(path)) {
      await next();
      return;
    }
    return c.json({ error: 'Authentication required' }, 401);
  }

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET as string);
    const { payload } = await jwtVerify(token, secret);
    const jwtPayload = payload as unknown as JwtPayload;

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

export async function readOnlyRoleGuard(c: Context, next: Next) {
  const user = c.get('user') as { role?: string } | undefined;
  if (user?.role && READ_ONLY_ROLES.has(user.role) && MUTATING_METHODS.has(c.req.method)) {
    return c.json({ error: 'Read-only role cannot modify data', code: 'FORBIDDEN' }, 403);
  }
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as { role: string };
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
