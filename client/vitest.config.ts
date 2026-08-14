import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Vitest's 5s default is too tight here. Rendering a heavy page under jsdom
    // (MdtPage, the document-writer action suite) can exceed it purely from
    // parallel-worker contention — these files pass comfortably in isolation
    // and take 8-12s inside the full 443-file run. Symptom: adding an unrelated
    // test file re-shards the workers and unrelated pages start "failing".
    // A real hang still fails, just later.
    testTimeout: 20_000,
    // Limit concurrent forks to 1 on CI. GitHub ubuntu-latest runners have 7 GB
    // RAM. With the default fork count (cpus-1 = 3 on a 4-core runner) and
    // --max-old-space-size=4096, peak usage = 3 × 4 GB = 12 GB → OOM + fork
    // crash. A single fork uses at most ~4.7 GB (heap + parent overhead), which
    // fits comfortably. The suite is split into shards so wall-clock time per
    // runner stays low even without fork parallelism.
    poolOptions: {
      forks: {
        maxForks: 1,
      },
    },
  },
});
