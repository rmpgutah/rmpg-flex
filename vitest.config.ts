import { defineConfig } from 'vitest/config';

// Worker-scoped vitest config. The /client/ tree has its own vitest
// setup with `jsdom` env and a separate test suite — running the
// worker tests from the repo root must NOT pick those up (they'd
// fail with `document is not defined` since this config runs node).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'scripts/**/*.test.mjs', 'src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'client', 'legacy'],
    environment: 'node',
    // Vitest's 5s default is too tight for this suite and produced
    // load-dependent flakes in three unrelated files (pdfSign's SLH-DSA-256f
    // keygen+sign, flexcamRoute's court-package build). Those tests are slow,
    // not hung — they pass with headroom. A genuinely hung test still fails,
    // just 20s later, which is a good trade against a red suite that blocks
    // every commit via the pre-commit hook.
    testTimeout: 20_000,
  },
});
