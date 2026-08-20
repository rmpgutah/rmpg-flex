import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // PDF test suite — isolated because jsPDF and pdf-lib have large parsed ASTs
    // (~10 MB each) that inflate the Vite transform cache when run alongside the
    // main suite. Running them separately keeps each shard's RAM footprint safe.
    include: [
      'src/utils/pdf/**/*.test.ts',
      'src/utils/pdf/**/*.test.tsx',
      'src/lib/rmpg-pdf-engine/**/*.test.ts',
      'src/lib/rmpg-pdf-engine/**/*.test.tsx',
      'src/pages/pdf-editor/**/*.test.ts',
      'src/pages/pdf-editor/**/*.test.tsx',
      'src/pages/document-writer/**/*.test.ts',
      'src/pages/document-writer/**/*.test.tsx',
      'src/devtools/pdfGallery/**/*.test.ts',
      'src/devtools/pdfGallery/**/*.test.tsx',
      'src/**/*Pdf*.test.ts',
      'src/**/*Pdf*.test.tsx',
      'src/**/*pdf*.test.ts',
      'src/**/*pdf*.test.tsx',
    ],
    testTimeout: 30_000,
  },
});
