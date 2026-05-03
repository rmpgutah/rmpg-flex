import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      // Direct alias to the no-op dompurify stub — bypasses npm's inconsistent
      // handling of file: overrides for symlinks across platforms. jsPDF's ESM
      // build imports dompurify but we don't use jsPDF.html(), so the stub is safe.
      dompurify: fileURLToPath(new URL('./stubs/dompurify/index.mjs', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor chunking: libraries that don't change between deploys are
        // split into their own long-lived cache-friendly chunks. Each group
        // has its own browser-cache lifetime, so a fix that doesn't touch
        // these vendors only invalidates the (much smaller) app code.
        // Goal: shrink the main index chunk so initial page-paint isn't
        // blocked behind 1.7 MB of unrelated framework code.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          // Core React runtime — loaded on every page
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          // PDF generators (jsPDF + pdf-lib) — used by every record-PDF action
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/pdf-lib')) {
            return 'vendor-pdf';
          }
          // PDF.js renderer — only loaded by PDF editor / viewer, but big
          if (id.includes('node_modules/pdfjs-dist')) {
            return 'vendor-pdfjs';
          }
          // Lucide icon set — large but commonly tree-shakable across pages
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          // Charts (recharts + d3) — admin/analytics pages
          if (id.includes('node_modules/recharts') || /node_modules\/d3-[a-z]+\//.test(id)) {
            return 'vendor-charts';
          }
          // Graph viz — connections analyst tool
          if (id.includes('node_modules/force-graph') || id.includes('node_modules/react-force-graph')) {
            return 'vendor-graph';
          }
          // Barcode + QR — citation/warrant printouts only
          if (id.includes('node_modules/bwip-js') || id.includes('node_modules/jsbarcode') || id.includes('node_modules/qrcode')) {
            return 'vendor-barcode';
          }
          // html2canvas — screenshot/PDF rendering only
          if (id.includes('node_modules/html2canvas')) {
            return 'vendor-canvas';
          }
          // Terminal — recon-connect workspace only
          if (id.includes('node_modules/@xterm')) {
            return 'vendor-terminal';
          }
          // Map fallback — only when Google Maps is unavailable
          if (id.includes('node_modules/leaflet')) {
            return 'vendor-leaflet';
          }
          // HTML sanitizer — used by RichTextArea
          if (id.includes('node_modules/sanitize-html')) {
            return 'vendor-sanitize';
          }
          // IndexedDB wrapper + general utility
          if (id.includes('node_modules/idb')) {
            return 'vendor-idb';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
