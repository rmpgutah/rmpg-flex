import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // Map test suite — isolated because tests import mapbox-gl (a large library
    // whose parsed AST inflates the Vite transform cache when run alongside the
    // main suite). Running them separately keeps each main shard's RAM footprint
    // safe. Mirrors the PDF isolation strategy in vitest.pdf.config.ts.
    include: [
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
      'src/hooks/__tests__/useMapFeatureInspect.test.ts',
      'src/pages/map/hooks/__tests__/useLayerFavorites.test.ts',
    ],
    // Exclude desktop components to avoid duplicating the desktop job's scope.
    exclude: ['src/components/desktop/**'],
    testTimeout: 30_000,
  },
});
