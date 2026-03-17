import { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config';
import { getDb } from '../models/database';

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
  fullName: string;
  sessionId?: string;
  type?: 'access' | 'refresh' | 'mfa_pending';
  pendingActions?: string[];
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ─── Role-based security profiles ────────────────────────
// Admin gets lighter session security (no IP binding, no UA binding)
// since they log in from multiple locations/devices frequently.
// Officers/dispatchers keep stricter session binding for CJIS compliance.
const RELAXED_SESSION_ROLES = new Set(['admin']);

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Reject refresh tokens and MFA-pending tokens used as access tokens
    if (decoded.type === 'refresh' || decoded.type === 'mfa_pending') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }

    // IP and user-agent session validation
    // Skip strict binding for roles in RELAXED_SESSION_ROLES
    const useStrictBinding = config.session.enforceIpBinding
      && decoded.sessionId
      && !RELAXED_SESSION_ROLES.has(decoded.role);

    if (useStrictBinding) {
      try {
        const db = getDb();
        const session = db.prepare(
          'SELECT ip_address, ua_hash FROM sessions WHERE session_id = ? AND is_active = 1'
        ).get(decoded.sessionId) as { ip_address: string; ua_hash?: string } | undefined;

        // User-agent binding — detect token theft across different browsers
        if (session?.ua_hash) {
          const currentUaHash = crypto.createHash('sha256')
            .update(req.headers['user-agent'] || '').digest('hex').slice(0, 16);
          if (currentUaHash !== session.ua_hash) {
            db.prepare('UPDATE sessions SET is_active = 0 WHERE session_id = ?')
              .run(decoded.sessionId);
            res.status(401).json({ error: 'Session invalidated: device mismatch', code: 'UA_CHANGED' });
            return;
          }
        }

        if (session && session.ip_address !== req.ip) {
          const action = config.session.ipChangeAction;
          if (action === 'invalidate') {
            // Instead of immediately killing the session, update the session IP
            // and allow through. This handles dynamic IPs (mobile, carrier NAT).
            // The session is still bound to the same user-agent for theft detection.
            db.prepare('UPDATE sessions SET ip_address = ?, last_used_at = ? WHERE session_id = ?')
              .run(req.ip, new Date().toISOString(), decoded.sessionId);
            // Allow through — IP updated to current
          } else if (action === 'reauth') {
            res.status(401).json({ error: 'Re-authentication required: IP address changed', code: 'IP_CHANGED_REAUTH' });
            return;
          }
          // 'warn' mode: log but allow through
        }
      } catch {
        // DB unavailable — allow through rather than blocking all requests
        // The JWT signature is already verified, so the request is authentic
      }
    } else if (decoded.sessionId) {
      // For relaxed roles, still update last_used_at but don't enforce IP/UA binding
      try {
        const db = getDb();
        db.prepare('UPDATE sessions SET last_used_at = ?, ip_address = ? WHERE session_id = ? AND is_active = 1')
          .run(new Date().toISOString(), req.ip, decoded.sessionId);
      } catch {
        // Non-critical — don't block the request
      }
    }

    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(403).json({ error: 'Invalid or expired token' });
    }
  }
}

export function requireRole(...roles: string[]) {
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

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
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
  const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return decoded;
}

/** Short-lived token (5 min) for the 2FA verification step. Cannot access any protected endpoint. */
export function generate2faPendingToken(payload: Omit<JwtPayload, 'type'>): string {
  return jwt.sign(
    { ...payload, type: 'mfa_pending' },
    config.jwt.secret,
    { expiresIn: '5m' }
  );
}

// Middleware for 2FA endpoints — only accepts mfa_pending tokens
export function authenticateTempToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    if (decoded.type !== 'mfa_pending') {
      res.status(403).json({ error: 'Invalid token type — MFA token required' });
      return;
    }

    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'MFA verification expired. Please log in again.', code: 'MFA_EXPIRED' });
    } else {
      res.status(403).json({ error: 'Invalid MFA token' });
    }
  }
}

// Accepts EITHER a full access token OR an mfa_pending temp token (NOT refresh tokens)
export function authenticateAnyToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Block refresh tokens — they should never be used as access tokens
    if (decoded.type === 'refresh') {
      res.status(403).json({ error: 'Invalid token type' });
      return;
    }

    req.user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    } else {
      res.status(403).json({ error: 'Invalid or expired token' });
    }
  }
}

export function generateTempToken(payload: Omit<JwtPayload, 'type'>, pendingActions: string[] = []): string {
  const expiryStr = (config as any).twoFactor?.tempTokenExpiry || '5m';
  const options: SignOptions = { expiresIn: expiryStr as SignOptions['expiresIn'] };
  return jwt.sign(
    { ...payload, type: 'mfa_pending', pendingActions },
    config.jwt.secret,
    options
  );
}

// Backwards compatibility
export function generateToken(payload: Omit<JwtPayload, 'type'>): string {
  return generateAccessToken(payload);
}
