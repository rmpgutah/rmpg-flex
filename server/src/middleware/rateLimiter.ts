import { Request, Response, NextFunction } from 'express';
import config from '../config';

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lastAccess: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 10_000; // Prevent unbounded memory growth from IP flooding

// ─── IP Blocklist ─────────────────────────────────────────
// Temporarily blocks IPs that repeatedly hit rate limits.
// After VIOLATION_THRESHOLD violations in VIOLATION_WINDOW, the IP is blocked for an
// exponentially increasing duration starting at BASE_BLOCK_DURATION.
interface BlockEntry {
  blockedUntil: number;
  violations: number;
  lastViolation: number;
}
const ipBlocklist: Map<string, BlockEntry> = new Map();
const VIOLATION_THRESHOLD = 10;           // violations before first block
const VIOLATION_WINDOW_MS = 10 * 60 * 1000; // 10 minute sliding window
const BASE_BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minute initial block
const MAX_BLOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour max block

function recordViolation(ip: string): void {
  if (!ip) return; // Still record violations for 'unknown' IPs
  const now = Date.now();
  let entry = ipBlocklist.get(ip);
  if (!entry) {
    entry = { blockedUntil: 0, violations: 0, lastViolation: now };
    ipBlocklist.set(ip, entry);
  }
  // Reset violations if outside the sliding window
  if (now - entry.lastViolation > VIOLATION_WINDOW_MS) {
    entry.violations = 0;
  }
  entry.violations++;
  entry.lastViolation = now;

  if (entry.violations >= VIOLATION_THRESHOLD) {
    // Exponential backoff: 5m → 10m → 20m → 40m → 60m (capped)
    const multiplier = Math.pow(2, Math.floor(entry.violations / VIOLATION_THRESHOLD) - 1);
    const blockDuration = Math.min(BASE_BLOCK_DURATION_MS * multiplier, MAX_BLOCK_DURATION_MS);
    entry.blockedUntil = now + blockDuration;
    console.warn(`[RateLimit] IP ${ip} blocked for ${Math.ceil(blockDuration / 60000)}m after ${entry.violations} violations`);
  }
}

function isIpBlocked(ip: string): { blocked: boolean; retryAfter: number } {
  if (!ip) return { blocked: false, retryAfter: 0 };
  // 'unknown' IPs are still checked — fail closed rather than bypassing rate limits
  const entry = ipBlocklist.get(ip);
  if (!entry) return { blocked: false, retryAfter: 0 };
  const now = Date.now();
  if (now < entry.blockedUntil) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  return { blocked: false, retryAfter: 0 };
}

// Admin: unblock a specific IP or all IPs
export function unblockIp(ip?: string): number {
  if (ip) {
    const had = ipBlocklist.has(ip);
    ipBlocklist.delete(ip);
    // Also clear rate limit entries for this IP
    for (const [key] of store) {
      if (key === ip || key.endsWith(`:${ip}`) || key.includes(`:${ip}:`)) {
        store.delete(key);
      }
    }
    return had ? 1 : 0;
  }
  // Unblock all
  const count = ipBlocklist.size;
  ipBlocklist.clear();
  return count;
}

// Export for admin dashboard / security monitoring
export function getBlockedIps(): Array<{ ip: string; blockedUntil: string; violations: number }> {
  const now = Date.now();
  const result: Array<{ ip: string; blockedUntil: string; violations: number }> = [];
  for (const [ip, entry] of ipBlocklist) {
    if (now < entry.blockedUntil) {
      result.push({ ip, blockedUntil: new Date(entry.blockedUntil).toISOString(), violations: entry.violations });
    }
  }
  return result;
}

// Clean up expired entries every 5 minutes
// .unref() so this timer doesn't prevent graceful Node.js shutdown
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
  // Clean expired blocklist entries
  for (const [ip, entry] of ipBlocklist) {
    if (now > entry.blockedUntil && now - entry.lastViolation > VIOLATION_WINDOW_MS) {
      ipBlocklist.delete(ip);
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

    // Check IP blocklist first — reject immediately if blocked
    const clientIp = req.ip || 'unknown';
    const blockStatus = isIpBlocked(clientIp);
    if (blockStatus.blocked) {
      res.set('Retry-After', String(blockStatus.retryAfter));
      res.status(429).json({ error: 'IP temporarily blocked due to repeated violations' });
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
      // Record violation for exponential backoff / IP blocking
      recordViolation(clientIp);
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      // Log rate limit violations for security monitoring (first hit only per window)
      if (entry.count === maxRequests + 1) {
        console.warn(`[RateLimit] Rate limit exceeded: ip=${clientIp} key=${key} count=${entry.count}/${maxRequests} path=${req.path}`);
      }
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}

// Stricter rate limiter for auth endpoints (login)
// Uses compound key (IP + username) to prevent distributed brute-force AND per-user targeting
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,           // 10 attempts per window per IP+username
  keyGenerator: (req) => `auth:${req.ip || 'unknown'}:${req.body?.username || ''}`,
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

// IP-wide auth rate limit — catches credential stuffing attacks where the attacker
// rotates through different usernames from the same IP address.
// More generous than per-username limit (30 vs 10) to avoid blocking shared IPs.
export const authIpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 30,           // 30 total login attempts per IP regardless of username
  keyGenerator: (req) => `auth-ip:${req.ip || 'unknown'}`,
  message: 'Too many login attempts from this IP. Please try again later.',
});

// Rate limiter for 2FA verification — prevent brute-forcing TOTP codes
// Field officers may fumble codes on mobile/vehicle — 8 attempts is field-friendly
// while still preventing brute-force (1M codes / 768 per day = 1,302 days)
export const mfaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 8,            // 8 attempts per window (field-friendly)
  keyGenerator: (req) => `mfa:${req.ip || 'unknown'}:${req.body?.username || req.user?.userId || ''}`,
  message: 'Too many verification attempts. Please wait 15 minutes before trying again.',
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

// Rate limiter for forgot-password requests — prevent enumeration and abuse
export const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 3,            // 3 requests per window per IP
  keyGenerator: (req) => `forgot:${req.ip || 'unknown'}`,
  message: 'Too many password reset requests. Please try again later.',
});

// Rate limiter for webhook endpoints — prevent deploy DoS
export const webhookRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 5,           // max 5 webhook calls per 5 min
  keyGenerator: (req) => `webhook:${req.ip || 'unknown'}`,
  message: 'Too many webhook requests. Please try again later.',
});

// Rate limiter for public endpoints (downloads/health) — stricter to prevent enumeration
export const publicEndpointRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 30,          // 30 requests per 5 min
  keyGenerator: (req) => `pub:${req.ip || 'unknown'}`,
  message: 'Too many requests. Please try again later.',
});

// Data export rate limiter — prevents bulk data exfiltration via CSV/export endpoints
export const exportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,           // 10 exports per 15 min per user
  keyGenerator: (req) => `export:${req.user?.userId || req.ip || 'unknown'}`,
  message: 'Too many export requests. Please wait before exporting again.',
});

// General API rate limiter
export const apiRateLimit = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  maxRequests: config.security.rateLimitMaxRequests,
});
