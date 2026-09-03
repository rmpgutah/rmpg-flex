import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // forks pool uses child processes instead of threads. Each test file
    // runs in its own V8 isolate whose heap is fully reclaimed on exit,
    // preventing the transform-cache accumulation that OOMs threads mode
    // on the 7 GB CI runner (~440 test files × heavy JSX transforms).
    pool: 'forks',
    maxWorkers: 1,
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
      // DesktopPage.test.tsx pulls the full desktop shell into the main suite.
      // After PromptDialog landed, the extra transform left the Vite cache
      // over the 8 GB heap (~23 min GC then FATAL ERROR after 464/465 files).
      'src/pages/DesktopPage.test.tsx',
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
      // → vitest.maps.config.ts
      // mapbox-gl has a large parsed AST; map tests cluster in one shard via
      // vitest's hash-based assignment, inflating the transform cache past the
      // 6144 MB ceiling — GC thrashes 18-24 min after tests complete, then
      // OOMs or times out. Isolated here to keep the main shards cache-lean.
      'src/**/*[Mm]ap*.test.ts',
      'src/**/*[Mm]ap*.test.tsx',
      'src/**/*mapbox*.test.ts',
      'src/**/*mapbox*.test.tsx',
      'src/**/*[Mm]apbox*.test.ts',
      'src/**/*[Mm]apbox*.test.tsx',
      'src/hooks/__tests__/useCachedBasemap.test.ts',
      'src/hooks/__tests__/useMapGeofenceAlerts.test.ts',
      'src/hooks/__tests__/useMapTraffic.test.ts',
      'src/hooks/__tests__/useVectorTileLayers.labels.test.ts',
      'src/hooks/__tests__/useVectorTileLayers.osm.test.ts',
      'src/hooks/__tests__/weatherAlertFeatures.test.ts',
      'src/hooks/__tests__/mapInfoPanelWeather.test.ts',
    ],
  },
});
