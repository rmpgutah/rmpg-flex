import { Request, Response, NextFunction } from 'express';
import config from '../config';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// [FIX 11] Cap store size to prevent unbounded memory growth from IP spoofing/DDoS
const MAX_STORE_SIZE = 100_000;

// [FIX 12] Store interval handle so it can be cleaned up; unref so it doesn't block shutdown
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}

export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? config.security.rateLimitWindowMs;
  const maxRequests = options.maxRequests ?? config.security.rateLimitMaxRequests;
  const keyGenerator = options.keyGenerator ?? ((req: Request) => req.ip || 'unknown');
  const message = options.message ?? 'Too many requests, please try again later';

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting in development
    if (!config.isProduction) {
      next();
      return;
    }

    const key = keyGenerator(req);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      // [FIX 13] Evict oldest entries when store exceeds max size to prevent memory exhaustion
      if (!entry && store.size >= MAX_STORE_SIZE) {
        const firstKey = store.keys().next().value;
        if (firstKey !== undefined) store.delete(firstKey);
      }
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count);
    res.set('X-RateLimit-Limit', String(maxRequests));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

// Stricter rate limiter for auth/MFA endpoints
export const mfaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyGenerator: (req) => `mfa:${req.ip || 'unknown'}`,
  message: 'Too many MFA attempts. Please try again in 15 minutes.',
});

// Stricter rate limiter for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,           // 10 attempts per window
  keyGenerator: (req) => `auth:${req.ip || 'unknown'}`,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// General API rate limiter
export const apiRateLimit = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  maxRequests: config.security.rateLimitMaxRequests,
});

// ── Blocked IP tracking (used by security dashboard) ──

const blockedIps = new Map<string, { reason: string; blockedAt: number; expiresAt: number }>();

// [FIX 14] Cap blocked IPs map to prevent unbounded memory growth
const MAX_BLOCKED_IPS = 10_000;

export function getBlockedIps(): Array<{ ip: string; reason: string; blockedAt: string; expiresAt: string }> {
  const now = Date.now();
  const result: Array<{ ip: string; reason: string; blockedAt: string; expiresAt: string }> = [];
  for (const [ip, entry] of blockedIps) {
    if (now > entry.expiresAt) {
      blockedIps.delete(ip);
      continue;
    }
    result.push({
      ip,
      reason: entry.reason,
      blockedAt: new Date(entry.blockedAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
    });
  }
  return result;
}

export function unblockIp(ip: string): boolean {
  return blockedIps.delete(ip);
}

export function blockIp(ip: string, reason: string, durationMs = 30 * 60 * 1000): void {
  // [FIX 15] Evict oldest blocked IP when at capacity
  if (blockedIps.size >= MAX_BLOCKED_IPS && !blockedIps.has(ip)) {
    const firstKey = blockedIps.keys().next().value;
    if (firstKey !== undefined) blockedIps.delete(firstKey);
  }
  // [FIX 16] Validate IP string is not empty
  if (!ip || typeof ip !== 'string') return;
  blockedIps.set(ip, { reason, blockedAt: Date.now(), expiresAt: Date.now() + durationMs });
}
