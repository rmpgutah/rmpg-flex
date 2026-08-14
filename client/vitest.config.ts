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
    // Desktop component tests run in a separate CI job (client-tests-desktop)
    // to prevent the 590-file suite from exhausting the 7 GB ubuntu-latest RAM.
    // The module cache grows monotonically across all files and crashes near
    // the end even with pool tuning — splitting keeps each job well within limits.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/components/desktop/**',
    ],
  },
});
