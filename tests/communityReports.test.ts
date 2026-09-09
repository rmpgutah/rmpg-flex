import { describe, it, expect } from 'vitest';
import { communityReports } from '../src/routes/community';

describe('communityReports router', () => {
  it('exports a valid Hono sub-router', () => {
    expect(communityReports).toBeDefined();
    expect(typeof communityReports.fetch).toBe('function');
  });

  it('declares GET / and PATCH /:id routes', () => {
    const routes = communityReports.routes;
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('PATCH /:id');
  });
});
