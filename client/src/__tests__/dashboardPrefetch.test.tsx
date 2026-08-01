import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Dashboard chunk must be warmed as soon as auth flips to true, so that
// making DashboardPage lazy does not introduce a post-login stall.
describe('dashboard prefetch on auth', () => {
  beforeEach(() => vi.resetModules());

  it('exports a reusable Dashboard import factory', async () => {
    // The factory lives in routes/routeModules.ts, not App.tsx — App.tsx
    // imports it from there (and re-uses the SAME import for both
    // lazyRetry(importDashboard) and this login-success prefetch effect) so
    // there is exactly one DashboardPage chunk. Defining it in App.tsx would
    // make it circular with routeModules.ts (which App.tsx also imports,
    // transitively, via useRoutePrefetch), reading an uninitialized `const`
    // at module-eval time and breaking `npm run dev` with a TDZ
    // ReferenceError — production's bundler hides the same cycle by
    // flattening scopes, so only dev surfaces it.
    const mod = await import('../routes/routeModules');
    expect(typeof mod.importDashboard).toBe('function');
  });

  it('returns a promise from the import factory', async () => {
    // A real dynamic import of DashboardPage pulls a deep tree (Mapbox
    // loader, mini-maps, many contexts) that does not resolve cleanly under
    // jsdom. The real module load is covered by the browser verification
    // step instead; here we only assert the factory shape.
    const { importDashboard } = await import('../routes/routeModules');
    expect(importDashboard()).toBeInstanceOf(Promise);
  });
});
