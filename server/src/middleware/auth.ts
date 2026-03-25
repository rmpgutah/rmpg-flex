import { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import config from '../config';
import { getDb } from '../models/database';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  fullName: string;
  sessionId?: string;
  type?: 'access' | 'refresh' | '2fa_pending';
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // [FIX 1] Reject obviously malformed tokens before passing to jwt.verify
  if (token.length > 4096) {
    res.status(400).json({ error: 'Malformed token' });
    return;
  }

  try {
    // [FIX 2] Explicitly specify allowed algorithms to prevent algorithm confusion attacks
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as JwtPayload;

    // Reject refresh tokens and 2FA-pending tokens used as access tokens
    if (decoded.type === 'refresh' || decoded.type === '2fa_pending') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }

    // [FIX 3] Validate required fields exist in decoded token payload
    if (!decoded.userId || !decoded.username || !decoded.role) {
      res.status(403).json({ error: 'Malformed token payload' });
      return;
    }

    // IP-based session validation
    if (config.session.enforceIpBinding && decoded.sessionId) {
      try {
        const db = getDb();
        const session = db.prepare(
          'SELECT ip_address FROM sessions WHERE session_id = ? AND is_active = 1'
        ).get(decoded.sessionId) as { ip_address: string } | undefined;

        // [FIX 4] Reject tokens whose sessionId references an inactive/missing session
        if (!session) {
          res.status(401).json({ error: 'Session not found or inactive', code: 'SESSION_INVALID' });
          return;
        }

        if (session.ip_address !== req.ip) {
          const action = config.session.ipChangeAction;
          if (action === 'invalidate') {
            db.prepare('UPDATE sessions SET is_active = 0 WHERE session_id = ?')
              .run(decoded.sessionId);
            res.status(401).json({ error: 'Session invalidated: IP address changed', code: 'IP_CHANGED' });
            return;
          } else if (action === 'reauth') {
            res.status(401).json({ error: 'Re-authentication required: IP address changed', code: 'IP_CHANGED_REAUTH' });
            return;
          }
          // 'warn' mode: log but allow through
          // [FIX 5] Actually log the warning in warn mode
          console.warn(`[AUTH] IP change detected for user ${decoded.username}: session IP ${session.ip_address} → request IP ${req.ip}`);
        }
      } catch { /* DB not available - allow through */ }
    }

    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    // [FIX 6] Handle JsonWebTokenError separately from NotBeforeError
    } else if (err.name === 'NotBeforeError') {
      res.status(401).json({ error: 'Token not yet active', code: 'TOKEN_NOT_ACTIVE' });
    } else {
      res.status(403).json({ error: 'Invalid or expired token' });
    }
  }
}

export function requireRole(...roles: string[]) {
  // [FIX 7] Validate that roles were actually provided to prevent accidental open access
  if (roles.length === 0) {
    throw new Error('requireRole() called with no roles — this would deny all access');
  }
  // [FIX 8] Flatten nested arrays (handles requireRole(['admin', 'officer']) pattern)
  const flatRoles = roles.flat() as string[];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Admin role always has full access to every endpoint
    if (req.user.role === 'admin') {
      next();
      return;
    }

    if (!flatRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions', required: flatRoles });
      return;
    }

    next();
  };
}

export function generateAccessToken(payload: Omit<JwtPayload, 'type'>): string {
  const options: SignOptions = { expiresIn: config.jwt.accessExpiry as SignOptions['expiresIn'] };
  return jwt.sign(
    { ...payload, type: 'access' },
    config.jwt.secret,
    options
  );
}

export function generateRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
  const options: SignOptions = { expiresIn: config.jwt.refreshExpiry as SignOptions['expiresIn'] };
  return jwt.sign(
    { ...payload, type: 'refresh' },
    config.jwt.secret,
    options
  );
}

export function verifyRefreshToken(token: string): JwtPayload {
  // [FIX 9] Validate token string before verification
  if (!token || typeof token !== 'string') {
    throw new Error('Refresh token is required');
  }
  const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] }) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  // [FIX 10] Validate required fields in refresh token payload
  if (!decoded.userId || !decoded.username) {
    throw new Error('Malformed refresh token payload');
  }
  return decoded;
}

/** Short-lived token (5 min) for the 2FA verification step. Cannot access any protected endpoint. */
export function generate2faPendingToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: '2fa_pending' },
    config.jwt.secret,
    { expiresIn: '5m' }
  );
}

// Backwards compatibility aliases
export function generateToken(payload: Omit<JwtPayload, 'type'>): string {
  return generateAccessToken(payload);
}
export const generateTempToken = generate2faPendingToken;
