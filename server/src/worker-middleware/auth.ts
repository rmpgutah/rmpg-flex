// ============================================================
// RMPG Flex — Workers Auth Middleware
// ============================================================
// JWT authentication and role-based access control for Hono/Workers.
// Mirrors server/src/middleware/auth.ts for Express.
// ============================================================

import { Context, Next } from 'hono';
import { jwtVerify } from 'jose';
import type { Env } from '../worker';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
  }
}

// JWT authentication middleware
export async function authenticateToken(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    // Accept either `userId` (this Worker's native format) or `user_id`
    // (the legacy /src/ Worker's format). Cutover-compat shim — lets
    // already-issued tokens stay valid through the switchover. Remove the
    // fallback once all /src/-issued sessions have expired (≤ 7 days).
    const uid = payload.userId ?? (payload as Record<string, unknown>).user_id;
    c.set('user', {
      userId: Number(uid),
      username: String(payload.username),
      role: String(payload.role),
      iat: Number(payload.iat),
      exp: Number(payload.exp),
    });

    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }, 401);
  }
}

// Role-based access control middleware
export function requireRole(...allowedRoles: string[]) {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    const user = c.get('user');
    if (!user || !allowedRoles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }
    await next();
  };
}

// Optional auth — sets user if token present, continues without error
export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next): Promise<void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    await next();
    return;
  }

  const token = authHeader.slice(7);
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    // Accept either `userId` (this Worker's native format) or `user_id`
    // (the legacy /src/ Worker's format). Cutover-compat shim — lets
    // already-issued tokens stay valid through the switchover. Remove the
    // fallback once all /src/-issued sessions have expired (≤ 7 days).
    const uid = payload.userId ?? (payload as Record<string, unknown>).user_id;
    c.set('user', {
      userId: Number(uid),
      username: String(payload.username),
      role: String(payload.role),
      iat: Number(payload.iat),
      exp: Number(payload.exp),
    });
  } catch {
    // Token invalid — continue without user
  }
  await next();
}
