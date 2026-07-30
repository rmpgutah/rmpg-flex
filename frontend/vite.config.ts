import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/kimi-connect/',
  plugins: [react()],
  server: {
    proxy: {
      // Straight pass-through: the Worker mounts its Hono app under the
      // `/kimi-connect` basePath, so dev and production see identical paths.
      '/kimi-connect/api': {
        target: 'http://localhost:8787',
      },
    },
  },
});
