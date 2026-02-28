import { Request, Response, NextFunction } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import config from '../config';

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

// Accepts EITHER a full access token OR an mfa_pending temp token
export function authenticateAnyToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

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

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions', required: roles });
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

export function generateTempToken(payload: Omit<JwtPayload, 'type'>, pendingActions: string[] = []): string {
  const options: SignOptions = { expiresIn: config.twoFactor.tempTokenExpiry as SignOptions['expiresIn'] };
  return jwt.sign(
    { ...payload, type: 'mfa_pending', pendingActions },
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

// Backwards compatibility
export function generateToken(payload: Omit<JwtPayload, 'type'>): string {
  return generateAccessToken(payload);
}
