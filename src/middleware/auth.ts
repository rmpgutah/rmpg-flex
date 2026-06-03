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

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const cookieToken = getCookie(c, 'access_token');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookieToken) {
    token = cookieToken;
  } else {
    // Query-token fallback. Used by the bodycam-video stream endpoint
    // because <video src="..."> can't carry an Authorization header
    // and CORS prevents a service-worker shim. The trade-off: the JWT
    // ends up in CF tail logs and any proxy access log; the blast
    // radius is bounded by JWT lifetime. A follow-up should narrow
    // this to a short-lived HMAC-signed token issued at detail-GET
    // time — the client already supports `_signedQuery` on the video
    // row (VideoPlayer.tsx). Until that lands, only GET requests on
    // a small set of stream paths should be hitting this branch in
    // practice, and the verify-then-scope checks in the stream
    // handler still enforce per-resource access.
    const queryToken = c.req.query('token');
    if (queryToken) token = queryToken;
  }

  if (!token) {
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

export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as { role: string };
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
