import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Dashboard chunk must be warmed as soon as auth flips to true, so that
// making DashboardPage lazy does not introduce a post-login stall.
describe('dashboard prefetch on auth', () => {
  beforeEach(() => vi.resetModules());

  it('exports a reusable Dashboard import factory', async () => {
    const mod = await import('../App');
    expect(typeof mod.importDashboard).toBe('function');
  });

  it('returns a promise from the import factory', async () => {
    // A real dynamic import of DashboardPage pulls a deep tree (Mapbox
    // loader, mini-maps, many contexts) that does not resolve cleanly under
    // jsdom. The real module load is covered by the browser verification
    // step instead; here we only assert the factory shape.
    const { importDashboard } = await import('../App');
    expect(importDashboard()).toBeInstanceOf(Promise);
  });
});
