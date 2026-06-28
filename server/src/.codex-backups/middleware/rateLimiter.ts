import rateLimit from 'express-rate-limit';
import config from '../config';

// Re-export for route-level usage (e.g. skiptracer.ts)
export { rateLimit };

// Skip rate limiting in development
const skip = () => !config.isProduction;

// General API rate limiter (applied globally to /api)
export const apiRateLimit = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  limit: config.security.rateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: { error: 'Too many requests, please try again later' },
});

// Stricter rate limiter for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

// Stricter rate limiter for MFA endpoints
export const mfaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  message: { error: 'Too many MFA attempts. Please try again in 15 minutes.' },
});

// ── Blocked IP tracking (used by security dashboard) ──

const blockedIps = new Map<string, { reason: string; blockedAt: number; expiresAt: number }>();
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
  if (blockedIps.size >= MAX_BLOCKED_IPS && !blockedIps.has(ip)) {
    const firstKey = blockedIps.keys().next().value;
    if (firstKey !== undefined) blockedIps.delete(firstKey);
  }
  if (!ip || typeof ip !== 'string') return;
  blockedIps.set(ip, { reason, blockedAt: Date.now(), expiresAt: Date.now() + durationMs });
}
