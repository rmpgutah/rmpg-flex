import { defineConfig } from 'vitest/config';

// Worker-scoped vitest config. The /client/ tree has its own vitest
// setup with `jsdom` env and a separate test suite — running the
// worker tests from the repo root must NOT pick those up (they'd
// fail with `document is not defined` since this config runs node).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'client', 'legacy'],
    environment: 'node',
  },
});
