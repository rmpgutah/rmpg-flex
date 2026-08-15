import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // threads pool: each worker thread transforms lazily (on-demand) rather than
    // the parent pre-transforming all shard files eagerly. This prevents the
    // ~6 GB transform-cache accumulation in the parent that caused GC thrash after
    // all tests completed under pool:'forks'. maxThreads:2 limits concurrency so
    // the shared V8 heap stays within the 6144 MB ceiling on the 7 GB CI runner.
    // Same fix applied to vitest.desktop.config.ts (commit 6b8f775e49).
    pool: 'threads',
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 2,
      },
    },
    // Vitest's 5s default is too tight here. Rendering a heavy page under jsdom
    // (MdtPage, the document-writer action suite) can exceed it purely from
    // parallel-worker contention — these files pass comfortably in isolation
    // and take 8-12s inside the full 443-file run. Symptom: adding an unrelated
    // test file re-shards the workers and unrelated pages start "failing".
    // A real hang still fails, just later.
    testTimeout: 20_000,
    // Excluded sets run in their own dedicated CI jobs to prevent their heavy
    // import chains (Mapbox, jsPDF, pdf-lib) from inflating the Vite transform
    // cache in the parent vitest process past the 7 GB runner RAM limit.
    // Keep these patterns in sync with vitest.desktop.config.ts and vitest.pdf.config.ts.
    exclude: [
      // → vitest.desktop.config.ts
      'src/components/desktop/**',
      // → vitest.pdf.config.ts
      // jsPDF and pdf-lib are each ~10 MB parsed AST. 17 PDF tests per shard
      // × those libraries = ~4 GB transform cache → OOM after tests complete.
      'src/utils/pdf/**',
      'src/lib/rmpg-pdf-engine/**',
      'src/pages/pdf-editor/**',
      'src/pages/document-writer/**',
      'src/devtools/pdfGallery/**',
      'src/**/*Pdf*.test.ts',
      'src/**/*Pdf*.test.tsx',
      'src/**/*pdf*.test.ts',
      'src/**/*pdf*.test.tsx',
    ],
  },
});
