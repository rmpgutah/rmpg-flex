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
    r2Buckets: ['UPLOADS'],
  },
};

export default defineConfig({
  plugins: [cloudflareTest(workerPoolOptions)],
  test: {
    include: ['test-workers/**/*.test.ts'],
    pool: cloudflarePool(workerPoolOptions),
  },
});
