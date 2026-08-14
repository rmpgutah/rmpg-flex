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
    // vmForks creates child processes where each test file runs in a dedicated
    // vm.Module context that is GC-able after the file completes.  Regular
    // forks accumulate module entries in the process-global require cache so
    // RSS grows monotonically across 570 files and OOMs near the end.  VM
    // contexts release that pressure by letting old contexts be collected.
    pool: 'vmForks',
    poolOptions: {
      vmForks: {
        maxForks: 2,
        minForks: 1,
      },
    },
    // Desktop component tests run in a separate CI job (client-tests-desktop).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/components/desktop/**',
    ],
  },
});
