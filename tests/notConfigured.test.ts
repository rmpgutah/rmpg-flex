import { describe, it, expect } from 'vitest';
import { notConfigured } from '../src/utils/notConfigured';

function fakeContext() {
  let lastBody: Record<string, unknown> | null = null;
  const c = {
    json(body: Record<string, unknown>): Response {
      lastBody = body;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    get body() { return lastBody; },
  };
  return c;
}

describe('notConfigured', () => {
  it('returns HTTP 200 with skipped:true and code:not_configured', async () => {
    const c = fakeContext();
    const r = notConfigured(c, 'firecrawl_api_key_unset');
    expect(r.status).toBe(200);
    expect(c.body).toEqual({
      ok: false,
      skipped: true,
      code: 'not_configured',
      reason: 'firecrawl_api_key_unset',
    });
  });

  it('preserves caller-supplied extras (error message, code) for back-compat', () => {
    const c = fakeContext();
    notConfigured(c, 'anthropic_api_key_unset', { error: 'AI not configured', code: 'NO_AI_KEY' });
    // Caller-supplied `code` overrides default 'not_configured' for back-compat
    // with clients that branch on the legacy code string.
    expect(c.body).toEqual({
      ok: false,
      skipped: true,
      code: 'NO_AI_KEY',
      reason: 'anthropic_api_key_unset',
      error: 'AI not configured',
    });
  });
});
