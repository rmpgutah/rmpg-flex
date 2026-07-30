import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/kimi-connect/',
  plugins: [react()],
  server: {
    proxy: {
      '/kimi-connect/api': {
        target: 'http://localhost:8787',
        rewrite: (path) => path.replace(/^\/kimi-connect\/api/, '/api'),
      },
    },
  },
});
