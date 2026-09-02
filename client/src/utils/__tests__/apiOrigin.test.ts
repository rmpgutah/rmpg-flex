import { describe, it, expect } from 'vitest';
import {
  resolveApiHttpBase,
  resolveApiWsBase,
  WORKER_HTTP_ORIGIN,
  WORKER_WS_ORIGIN,
} from '../apiOrigin';

describe('resolveApiHttpBase', () => {
  it('uses relative URLs in Vite dev', () => {
    expect(resolveApiHttpBase({ isDev: true, hostname: 'localhost' })).toBe('');
  });

  it('uses relative URLs on the live SPA so the zone proxy carries the WAF cookie', () => {
    expect(resolveApiHttpBase({ isDev: false, hostname: 'rmpgutah.us' })).toBe('');
    expect(resolveApiHttpBase({ isDev: false, hostname: 'www.rmpgutah.us' })).toBe('');
    expect(resolveApiHttpBase({ isDev: false, hostname: 'flex.rmpgutah.us' })).toBe('');
    expect(resolveApiHttpBase({ isDev: false, hostname: 'preview.pages.dev' })).toBe('');
  });

  it('does not send the SPA to api.rmpgutah.us', () => {
    expect(resolveApiHttpBase({ isDev: false, hostname: 'rmpgutah.us' }))
      .not.toContain('api.rmpgutah.us');
  });

  it('falls back to the Worker hostname off the app origin', () => {
    expect(resolveApiHttpBase({ isDev: false, hostname: 'localhost' }))
      .toBe('http://localhost:8787');
    expect(resolveApiHttpBase({ isDev: false, hostname: '' }))
      .toBe(WORKER_HTTP_ORIGIN);
    expect(resolveApiHttpBase({ isDev: false, hostname: 'api.rmpgutah.us' }))
      .toBe(WORKER_HTTP_ORIGIN);
  });
});

describe('resolveApiWsBase', () => {
  it('points local hosts at wrangler :8787', () => {
    expect(resolveApiWsBase({ hostname: 'localhost' })).toBe('ws://localhost:8787');
    expect(resolveApiWsBase({ hostname: '127.0.0.1' })).toBe('ws://127.0.0.1:8787');
  });

  it('uses the SPA host on rmpgutah.us (not the managed-challenge API hostname)', () => {
    const base = resolveApiWsBase({
      hostname: 'rmpgutah.us',
      hostWithPort: 'rmpgutah.us',
      protocol: 'https:',
    });
    expect(base).toBe('wss://rmpgutah.us');
    expect(base).not.toBe(WORKER_WS_ORIGIN);
  });

  it('falls back to the Worker WS origin off the app origin', () => {
    expect(resolveApiWsBase({ hostname: '' })).toBe(WORKER_WS_ORIGIN);
  });
});
