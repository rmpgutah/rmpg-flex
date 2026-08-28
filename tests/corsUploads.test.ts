import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

// Mirrors the CORS + CORP settings in src/index.ts. Importing the real `app`
// pulls Durable Object / Container class evaluation that this Node suite
// does not need; the contract under test is the middleware options.

function makeApp() {
  const app = new Hono();
  app.use('*', secureHeaders({
    crossOriginResourcePolicy: 'cross-origin',
  }));
  app.use('*', cors({
    origin: (origin: string) => {
      const allowed = 'https://rmpgutah.us,https://www.rmpgutah.us,http://localhost:5173'
        .split(',').map((s) => s.trim());
      if (origin && allowed.includes(origin)) return origin;
      return undefined;
    },
    credentials: true,
    allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'Accept'],
    allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Trace-Id', 'X-Request-Id'],
    maxAge: 86400,
  }));
  app.post('/api/uploads', (c) => c.json({ ok: true }, 201));
  return app;
}

describe('upload CORS / CORP (Cloudflare cross-origin POST)', () => {
  it('answers a SPA preflight with the headers XHR actually sends', async () => {
    const res = await makeApp().request('/api/uploads', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://rmpgutah.us',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-requested-with',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://rmpgutah.us');
    const allow = (res.headers.get('Access-Control-Allow-Headers') || '').toLowerCase();
    expect(allow).toContain('authorization');
    expect(allow).toContain('x-requested-with');
    expect(allow).toContain('content-type');
    expect(res.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/);
  });

  it('does not set Cross-Origin-Resource-Policy: same-origin on the API response', async () => {
    const res = await makeApp().request('/api/uploads', {
      method: 'POST',
      headers: { Origin: 'https://rmpgutah.us' },
    });
    const corp = (res.headers.get('Cross-Origin-Resource-Policy') || '').toLowerCase();
    expect(corp).not.toBe('same-origin');
    expect(corp).toBe('cross-origin');
  });
});

describe('src/index.ts upload CORS contract', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');

  it('disables Hono default CORP same-origin', () => {
    expect(src).toMatch(/crossOriginResourcePolicy:\s*'cross-origin'/);
  });

  it('explicitly allows X-Requested-With on CORS preflight', () => {
    expect(src).toMatch(/allowHeaders:.*X-Requested-With/s);
  });
});
