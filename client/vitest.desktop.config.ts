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
    poolOptions: {
      forks: {
        maxForks: 2,
      },
    },
  },
});
