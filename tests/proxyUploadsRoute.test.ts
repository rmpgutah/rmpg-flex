import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROXY = readFileSync(resolve(process.cwd(), 'proxy/index.ts'), 'utf8');
const PROXY_TOML = readFileSync(resolve(process.cwd(), 'proxy/wrangler.toml'), 'utf8');

describe('rmpg-api-proxy same-origin routing', () => {
  it('sends /api/uploads to the rewrite Worker (env.API), not fallthrough', () => {
    expect(PROXY).toMatch(/kind:\s*'prefix',\s*value:\s*'\/api\/uploads'/);
  });

  it('binds the proxy to both apex and www /api/* zone routes', () => {
    expect(PROXY_TOML).toContain('rmpgutah.us/api/*');
    expect(PROXY_TOML).toContain('www.rmpgutah.us/api/*');
  });

  it('does not stub /api/audit (real audit.ts handlers must win)', () => {
    expect(PROXY).not.toMatch(/match:\s*\/\^\\\/api\\\/audit/);
    expect(PROXY).toMatch(/kind:\s*'prefix',\s*value:\s*'\/api\/audit'/);
  });

  it('routes WebSocket upgrades to the rewrite Worker', () => {
    for (const path of ['/api/ws', '/api/alerts-ws', '/api/voice-ws', '/api/web-browser-ws']) {
      expect(PROXY).toContain(`value: '${path}'`);
    }
  });

  it('routes assessor, evidence, field-photos, and company-browser to env.API', () => {
    for (const path of ['/api/assessor', '/api/evidence', '/api/field-photos', '/api/user', '/api/web-browser', '/api/browser-search']) {
      expect(PROXY).toContain(`value: '${path}'`);
    }
  });

  it('routes serve attempt uploads, property photos, and redactions to env.API', () => {
    for (const path of [
      '/api/process-server', '/api/serve/', '/api/serve-dashboard', '/api/serve-queue',
      '/api/property-photos', '/api/business-photos', '/api/redactions',
      '/api/tesseract-training', '/api/tesseract-ocr', '/api/mapbox',
    ]) {
      expect(PROXY).toContain(`value: '${path}'`);
    }
    expect(PROXY).toContain('value: /^\\/api\\/serve$/');
    // A bare `/api/serve` prefix would steal /api/servemanager.
    expect(PROXY).not.toMatch(/kind:\s*'prefix',\s*value:\s*'\/api\/serve'/);
  });

  it('routes integration namespaces to env.API', () => {
    for (const path of [
      '/api/integrations', '/api/geocode', '/api/email', '/api/email-oauth',
      '/api/jail-roster', '/api/microbilt', '/api/clearpathgps', '/api/traccar',
      '/api/servemanager', '/api/howen',
    ]) {
      expect(PROXY).toContain(`value: '${path}'`);
    }
  });

  it('does not stub /api/arrests/status (Admin Arrests tile)', () => {
    expect(PROXY).not.toMatch(/match:\s*\/\^\\\/api\\\/arrests\\\/status/);
  });
});
