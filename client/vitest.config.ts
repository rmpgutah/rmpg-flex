import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// ConnectionsPage tests were failing with "Cannot read properties of null
// (reading 'useRef')" — vitest resolved react-router-dom against a
// different React module record than the app code, breaking hook dispatch.
// Pin every React-family package to this workspace's node_modules.
const nm = path.resolve(__dirname, 'node_modules');

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom'],
    alias: {
      react: path.join(nm, 'react'),
      'react-dom': path.join(nm, 'react-dom'),
      'react-router': path.join(nm, 'react-router'),
      'react-router-dom': path.join(nm, 'react-router-dom'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    server: { deps: { inline: [/react-router/, /react-dom/] } },
  },
});
