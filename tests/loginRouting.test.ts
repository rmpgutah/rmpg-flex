import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const proxySrc = readFileSync(join(__dirname, '..', 'proxy', 'index.ts'), 'utf8');
const authSrc = readFileSync(join(__dirname, '..', 'src', 'routes', 'auth.ts'), 'utf8');

describe('login family is routed to the rewrite, not legacy', () => {
  it('sends POST /api/auth/login (and 2FA subpaths) to env.API', () => {
    expect(proxySrc).toMatch(/value:\s*'\/api\/auth\/login'/);
    expect(proxySrc).toMatch(/value:\s*'\/api\/auth\/refresh'/);
    expect(proxySrc).toMatch(/value:\s*'\/api\/auth\/logout'/);
    expect(proxySrc).toMatch(/value:\s*'\/api\/auth\/me'/);
    expect(proxySrc).toMatch(/value:\s*'\/api\/auth\/webauthn'/);
  });

  it('does not swallow the legacy-only email-token reset path', () => {
    expect(proxySrc).not.toMatch(/value:\s*'\/api\/auth\/reset-password'/);
    expect(proxySrc).not.toMatch(/value:\s*'\/api\/auth'/);
  });
});

describe('2FA token issue is not double-wrapped', () => {
  it('never nests issueLoginTokens inside another c.json()', () => {
    expect(authSrc).not.toMatch(/c\.json\(\s*await\s+issueLoginTokens/);
  });

  it('returns the body parsed by resolve2faPending instead of calling json() again', () => {
    expect(authSrc).toMatch(/return \{ user, body \}/);
    expect(authSrc).toMatch(/const \{ user, body \} = resolved/);
  });

  it('keys session refresh by session_id, not a possibly-absent id column', () => {
    expect(authSrc).toMatch(/SELECT session_id, user_id FROM sessions/);
    expect(authSrc).not.toMatch(/SELECT id, session_id, user_id FROM sessions/);
    expect(authSrc).toMatch(/WHERE session_id = \?/);
    expect(authSrc).not.toMatch(/UPDATE sessions SET refresh_token_hash = \?, last_used_at = datetime\('now'\) WHERE id = \?/);
  });

  it('falls back to core session columns if the geo INSERT fails', () => {
    expect(authSrc).toMatch(/retrying core columns/);
    expect(authSrc).toMatch(
      /INSERT INTO sessions \(session_id, user_id, refresh_token_hash, ip_address, user_agent, expires_at\)/,
    );
  });
});
