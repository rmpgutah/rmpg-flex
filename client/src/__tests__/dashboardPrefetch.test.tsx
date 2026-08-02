import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub DashboardPage so `importDashboard()` resolves immediately instead of
// pulling its real dependency tree (Mapbox loader, mini-maps, many contexts).
//
// Without this the second test below started a real dynamic import and never
// awaited it, so the load was still in flight when the environment tore down:
//
//   EnvironmentTeardownError: Cannot load '/node_modules/react/index.js'
//   imported from src/pages/DashboardPage.tsx after the environment was torn down
//
// Every test still PASSED — vitest reports it as an unhandled error and exits
// non-zero, which fails the whole run for a reason no failing assertion names.
// Whether it surfaced depended on suite scheduling, so it lay dormant until an
// unrelated new test file shifted the worker ordering.
vi.mock('../pages/DashboardPage', () => ({ default: () => null }));

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

  it('returns a promise from the import factory, and settles it', async () => {
    const { importDashboard } = await import('../routes/routeModules');
    const pending = importDashboard();
    expect(pending).toBeInstanceOf(Promise);
    // AWAIT it. Leaving the import in flight is what produced the teardown
    // error; DashboardPage is mocked above so this resolves immediately rather
    // than loading the real tree. Swallow a rejection — the assertion here is
    // about the factory's shape, not about the chunk's contents.
    await expect(pending.then(() => 'settled').catch(() => 'settled')).resolves.toBe('settled');
  });
});
