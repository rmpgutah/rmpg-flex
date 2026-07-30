import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      // Straight pass-through: the Worker has no basePath, so dev and
      // production both see plain `/api/...` paths.
      '/api': {
        target: 'http://localhost:8787',
      },
    },
  },
});
