import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('per-user connect routes exist and follow the CSRF pattern', () => {
  const src = readFileSync(new URL('../src/routes/email.ts', import.meta.url), 'utf-8');

  it('defines GET /connect/authorize', () => {
    expect(src).toMatch(/email\.get\('\/connect\/authorize'/);
  });

  it('defines GET /connect/callback', () => {
    expect(src).toMatch(/email\.get\('\/connect\/callback'/);
  });

  it('defines DELETE /connect', () => {
    expect(src).toMatch(/email\.delete\('\/connect'/);
  });

  it('defines GET /connect/status', () => {
    expect(src).toMatch(/email\.get\('\/connect\/status'/);
  });

  it('the callback is registered as a public route (bypasses authMiddleware) like the existing shared callback', () => {
    // The existing auth-skip check in email.use('*', ...) matches on pathname
    // suffix '/oauth/callback' OR the exact '/api/email/oauth/callback' path.
    // The new /connect/callback needs the same treatment or it will 401
    // before Microsoft's redirect (which carries no Authorization header)
    // ever reaches the handler.
    const authGateMatch = src.match(/email\.use\('\*',[\s\S]*?\n\}\);/);
    expect(authGateMatch).toBeTruthy();
    expect(authGateMatch![0]).toMatch(/connect\/callback/);
  });
});
