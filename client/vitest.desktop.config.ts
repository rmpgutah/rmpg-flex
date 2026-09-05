import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'src/components/desktop/**/*.test.ts',
      'src/components/desktop/**/*.test.tsx',
      'src/pages/DesktopPage.test.tsx',
    ],
    testTimeout: 20_000,
    // maxForks:2 caps concurrent jsdom environments so they don't all compete
    // for the 16 GB runner RAM simultaneously. Full parallelism on a 2-4 vCPU
    // runner causes GC contention that pushes wall-clock past 60 min; capping
    // at 2 forks keeps peak RSS bounded while staying well under the timeout.
    poolOptions: { forks: { maxForks: 2 } },
  },
});
