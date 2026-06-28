import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config to control isProduction and ssl.enabled
vi.mock('../../src/config', () => ({
  default: {
    isProduction: false,
    ssl: { enabled: false },
  },
}));

import { securityHeaders } from '../../src/middleware/securityHeaders';
import config from '../../src/config';

// ── Helpers ─────────────────────────────────────────────
function mockReq(overrides: Record<string, any> = {}) {
  return {
    path: '/api/test',
    ...overrides,
  } as any;
}

function mockRes() {
  const headers: Record<string, string> = {};
  const removed: string[] = [];
  const res: any = {
    _headers: headers,
    _removed: removed,
  };
  res.set = vi.fn((key: string, value: string) => {
    headers[key] = value;
    return res;
  });
  res.removeHeader = vi.fn((key: string) => {
    removed.push(key);
    delete headers[key];
  });
  return res;
}

function mockNext() {
  return vi.fn();
}

describe('securityHeaders middleware', () => {
  beforeEach(() => {
    // Reset config for each test
    (config as any).isProduction = false;
    (config as any).ssl = { enabled: false };
  });

  it('calls next()', () => {
    const next = mockNext();
    securityHeaders(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets X-Content-Type-Options header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets X-Frame-Options header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('sets X-XSS-Protection header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['X-XSS-Protection']).toBe('1; mode=block');
  });

  it('sets Referrer-Policy header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    const pp = res._headers['Permissions-Policy'];
    expect(pp).toContain('camera=(self)');
    expect(pp).toContain('microphone=(self)');
    expect(pp).toContain('geolocation=(self)');
    expect(pp).toContain('payment=()');
  });

  it('sets Content-Security-Policy header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    const csp = res._headers['Content-Security-Policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('removes X-Powered-By header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res.removeHeader).toHaveBeenCalledWith('X-Powered-By');
  });

  it('sets Cross-Origin-Opener-Policy header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('sets Cross-Origin-Resource-Policy header', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  // ── HSTS behavior ──────────────────────────────────────

  it('does NOT set HSTS in development mode without SSL', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('sets HSTS in production mode', () => {
    (config as any).isProduction = true;
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(res._headers['Strict-Transport-Security']).toContain('includeSubDomains');
    expect(res._headers['Strict-Transport-Security']).toContain('preload');
  });

  it('sets HSTS when SSL is enabled', () => {
    (config as any).ssl = { enabled: true };
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    expect(res._headers['Strict-Transport-Security']).toBeDefined();
  });

  // ── Cache-Control for API paths ────────────────────────

  it('sets Cache-Control for /api/ paths', () => {
    const res = mockRes();
    securityHeaders(mockReq({ path: '/api/warrants' }), res, mockNext());
    expect(res._headers['Cache-Control']).toBe('no-store, no-cache, must-revalidate, private');
    expect(res._headers['Pragma']).toBe('no-cache');
  });

  it('does NOT set Cache-Control for non-API paths', () => {
    const res = mockRes();
    securityHeaders(mockReq({ path: '/static/image.png' }), res, mockNext());
    expect(res._headers['Cache-Control']).toBeUndefined();
    expect(res._headers['Pragma']).toBeUndefined();
  });

  // ── CSP allows Mapbox resources ────────────────────

  it('CSP allows Mapbox domains', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    const csp = res._headers['Content-Security-Policy'];
    expect(csp).toContain('api.mapbox.com');
    expect(csp).toContain('events.mapbox.com');
  });

  it('CSP allows ArcGIS domains', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    const csp = res._headers['Content-Security-Policy'];
    expect(csp).toContain('arcgis.com');
  });

  it('CSP allows Open-Meteo for weather data', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    const csp = res._headers['Content-Security-Policy'];
    expect(csp).toContain('api.open-meteo.com');
  });

  it('CSP allows WebSocket connections', () => {
    const res = mockRes();
    securityHeaders(mockReq(), res, mockNext());
    const csp = res._headers['Content-Security-Policy'];
    expect(csp).toContain('ws:');
    expect(csp).toContain('wss:');
  });
});
