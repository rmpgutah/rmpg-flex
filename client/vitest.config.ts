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
    // Use worker_threads instead of child-process forks so the whole pool shares
    // one V8 heap (bounded by NODE_OPTIONS --max-old-space-size=4096 in CI).
    // Forks give each worker its own heap — N forks × heap-limit easily overflows
    // the 7 GB available on ubuntu-latest runners (confirmed OOM on PR #3528).
    // isolate:false makes all test files in a thread share one module registry
    // instead of loading a fresh copy per file. React, Tailwind, and shared
    // utils load once rather than 590×, cutting peak RSS by ~60-70%.
    // Risk: module-level side effects persist across files — setup.ts resets
    // mocks+localStorage between files so this is safe here.
    isolate: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 2,
        minThreads: 1,
      },
    },
  },
});
