import { Request, Response, NextFunction } from 'express';
import config from '../config';

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lastAccess: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 10_000; // Prevent unbounded memory growth from IP flooding

// Clean up expired entries every 5 minutes
// .unref() so this timer doesn't prevent graceful Node.js shutdown
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

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
      // Enforce size cap before adding new entries — evict expired first, then LRU
      if (!entry && store.size >= MAX_STORE_SIZE) {
        for (const [k, e] of store) {
          if (now > e.resetAt) store.delete(k);
        }
        // If still over cap after purging expired, evict least-recently-accessed 20%
        if (store.size >= MAX_STORE_SIZE) {
          const sorted = [...store.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
          const evictCount = Math.ceil(MAX_STORE_SIZE * 0.2);
          for (let i = 0; i < evictCount && i < sorted.length; i++) {
            store.delete(sorted[i][0]);
          }
        }
      }
      entry = { count: 0, resetAt: now + windowMs, lastAccess: now };
      store.set(key, entry);
    }

    entry.count++;
    entry.lastAccess = now;

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

// Stricter rate limiter for auth endpoints (login)
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,           // 10 attempts per window
  keyGenerator: (req) => `auth:${req.ip || 'unknown'}`,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// Rate limiter for 2FA verification — prevent brute-forcing TOTP codes
export const mfaRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 3,           // 3 attempts per window
  keyGenerator: (req) => `mfa:${req.ip || 'unknown'}`,
  message: 'Too many verification attempts. Please wait before trying again.',
});

// Rate limiter for token refresh — prevent token grinding
export const refreshRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 15,          // 15 refreshes per minute (generous for normal use)
  keyGenerator: (req) => `refresh:${req.ip || 'unknown'}`,
  message: 'Too many refresh requests. Please try again shortly.',
});

// Rate limiter for password change — prevent brute-forcing current password
export const passwordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,            // 5 attempts per window
  keyGenerator: (req) => `pwd:${req.ip || 'unknown'}`,
  message: 'Too many password change attempts. Please try again later.',
});

// Rate limiter for webhook endpoints — prevent deploy DoS
export const webhookRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 5,           // max 5 webhook calls per 5 min
  keyGenerator: (req) => `webhook:${req.ip || 'unknown'}`,
  message: 'Too many webhook requests. Please try again later.',
});

// Rate limiter for file uploads — prevent storage exhaustion
export const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 30,           // 30 uploads per 15 min per user
  keyGenerator: (req) => `upload:${req.ip || 'unknown'}`,
  message: 'Too many file uploads. Please try again later.',
});

// General API rate limiter
export const apiRateLimit = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  maxRequests: config.security.rateLimitMaxRequests,
});
