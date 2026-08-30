import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const MIDDLEWARE = readFileSync(resolve(process.cwd(), '../functions/_middleware.ts'), 'utf8');

function scriptSrc(source: string, label: string): string {
  const fromMeta = source.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  const blob = fromMeta?.[1] ?? source;
  const directive = blob.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
  expect(directive, `${label} has no script-src`).toBeTruthy();
  return directive!;
}

function connectSrc(source: string, label: string): string {
  const fromMeta = source.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  const blob = fromMeta?.[1] ?? source;
  const directive = blob.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
  expect(directive, `${label} has no connect-src`).toBeTruthy();
  return directive!;
}

describe('Pages CSP is not the Observatory starter policy', () => {
  // Live Dial Connect console floods look like:
  //   script-src 'unsafe-inline' 'unsafe-eval'   (no 'self')
  //   connect-src 'none'
  // That is Cloudflare Observatory's report-only template, not FULL_CSP.
  // Guard the CAD policy so we never ship that starter string ourselves.
  it('index.html meta script-src includes self and Cloudflare challenges, not Insights', () => {
    const src = scriptSrc(INDEX_HTML, 'index.html');
    expect(src).toContain("'self'");
    expect(src).not.toContain('https://static.cloudflareinsights.com');
    expect(src).toContain('https://challenges.cloudflare.com');
    // Chrome 109+ gates WebAssembly compile on this token separately from
    // 'unsafe-eval'. Without it, zxing-wasm never instantiates and every
    // PDF417 ID scan fails in Chromium (the documented field failure).
    expect(src).toContain("'wasm-unsafe-eval'");
  });

  it('index.html meta connect-src is not none', () => {
    const src = connectSrc(INDEX_HTML, 'index.html');
    expect(src).not.toMatch(/connect-src 'none'/);
    expect(src).toContain('https://*.rmpgutah.us');
  });

  it('Pages middleware FULL_CSP includes self and a real connect-src', () => {
    const policyBlock = MIDDLEWARE.slice(MIDDLEWARE.indexOf('const FULL_CSP'));
    expect(policyBlock).toMatch(/script-src 'self'/);
    expect(policyBlock).toContain("'wasm-unsafe-eval'");
    expect(policyBlock).not.toContain('https://static.cloudflareinsights.com');
    expect(policyBlock).toContain('https://challenges.cloudflare.com');
    expect(policyBlock).toContain('https://dialer.rmpgutah.us');
    expect(policyBlock).toMatch(/connect-src \$\{ALLOWED_CONNECT\}/);
    expect(policyBlock).not.toMatch(/connect-src 'none'/);
  });
});
