import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Worker-runtime (Miniflare/workerd) test config — SEPARATE from the node-env
// vitest.config.ts. Runs route-level smoke tests for the Worker against real
// Miniflare D1/KV/R2 bindings (the AI binding is module-mocked per test). Run with
// `npm run test:worker`. The node suite (vitest.config.ts) only includes tests/**,
// so it never picks these up. (vitest-pool-workers 0.16 + Vitest 4: configure via
// the cloudflareTest plugin + cloudflarePool runner, not the old `/config` helper.)
const workerPoolOptions = {
  main: './test-workers/entry.ts',
  miniflare: {
    compatibilityDate: '2025-05-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'alpr-test' },
    kvNamespaces: ['KV'],
    r2Buckets: ['UPLOADS', 'DOWNLOADS'],
    // Needed so authMiddleware (src/middleware/auth.ts) can verify JWTs when
    // exercised end-to-end via SELF.fetch (test-workers/dailyReports.test.ts).
    // Unlike test-workers/auth.test.ts — which calls authRouter.request()
    // directly and can pass a per-call env override — SELF.fetch runs
    // against the ambient worker env, so the secret has to be a real binding
    // here rather than injected per request.
    bindings: { JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod' },
  },
};

export default defineConfig({
  plugins: [cloudflareTest(workerPoolOptions)],
  // pdf-lib's default (CJS) build pulls in pako via a relative `require()`
  // that the workerd/Miniflare module loader can't resolve (no Node-style
  // relative CJS resolution) — every test importing anything that reaches
  // src/utils/dailyReport/render.ts (pdf-lib) failed with "No such module
  // .../pako/lib/utils/common" before this alias. pdf-lib ships a pure-ESM
  // build under `es/` with no such require, so route around the CJS entry.
  resolve: {
    alias: {
      // pako's default entry (index.js) does relative `require('./lib/...')`
      // calls the workerd/Miniflare module loader can't resolve — every test
      // reaching src/utils/dailyReport/render.ts (pdf-lib, which depends on
      // pako for stream compression) failed with "No such module .../pako/
      // lib/utils/common" before this alias. dist/pako.js is a single
      // self-contained UMD bundle with no internal requires, so it loads
      // cleanly under the same loader.
      pako: 'pako/dist/pako.js',
    },
  },
  test: {
    include: ['test-workers/**/*.test.ts'],
    pool: cloudflarePool(workerPoolOptions),
  },
});
