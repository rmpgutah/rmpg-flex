import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROXY = readFileSync(resolve(process.cwd(), 'proxy/index.ts'), 'utf8');
const PROXY_TOML = readFileSync(resolve(process.cwd(), 'proxy/wrangler.toml'), 'utf8');

describe('rmpg-api-proxy upload routing', () => {
  it('sends /api/uploads to the rewrite Worker (env.API), not fallthrough', () => {
    expect(PROXY).toMatch(/kind:\s*'prefix',\s*value:\s*'\/api\/uploads'/);
  });

  it('binds the proxy to both apex and www /api/* zone routes', () => {
    expect(PROXY_TOML).toContain('rmpgutah.us/api/*');
    expect(PROXY_TOML).toContain('www.rmpgutah.us/api/*');
  });
});
