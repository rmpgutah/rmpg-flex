import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';
import path from 'path';
import { execFileSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    // Replaces 'rmpg-flex-BUILD' in dist/sw.js with 'rmpg-flex-<git-sha>' after
    // every production build so the SW cache name is unique per commit without
    // storing a version number in source (which caused merge conflicts on every
    // branch that touched sw.js).
    {
      name: 'stamp-sw-version',
      closeBundle() {
        const distSw = path.join(fileURLToPath(new URL('.', import.meta.url)), 'dist', 'sw.js');
        try {
          const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
          let content = readFileSync(distSw, 'utf-8');
          content = content.replaceAll("'rmpg-flex-BUILD'", `'rmpg-flex-${sha}'`);
          writeFileSync(distSw, content, 'utf-8');
        } catch {
          // dist/sw.js absent during watch mode or if build failed — no-op
        }
      },
    },
  ],
  resolve: {
    alias: {
      // Direct alias to the no-op dompurify stub — bypasses npm's inconsistent
      // handling of file: overrides for symlinks across platforms. jsPDF's ESM
      // build imports dompurify but we don't use jsPDF.html(), so the stub is safe.
      dompurify: fileURLToPath(new URL('./stubs/dompurify/index.mjs', import.meta.url)),
    },
  },
  build: {
    // Disable Vite's automatic <link rel="modulepreload"> emission for
    // every dynamic import. By default Vite eagerly preloads EVERY
    // chunk reachable from the entry point, which on this app means
    // ~3MB of JS (vendor-pdf, vendor-barcode, vendor-charts, etc.)
    // gets downloaded on every page load even when the user isn't
    // generating PDFs or viewing charts. Caught 2026-05-05 on a slow
    // Electron desktop session — disabling the auto-preload cuts the
    // initial network payload to the critical-path bundle (index +
    // vendor-react + a few small chunks); heavy chunks load on demand
    // when their first dynamic import fires (e.g. PDF generation).
    modulePreload: { polyfill: true, resolveDependencies: () => [] },
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
          // (removed: vendor-graph chunk for react-force-graph-2d — the only
          // consumer was the dead client/src/pages/ForensicsPage.tsx, which
          // was an older Canvas-based reimplementation of the live d3-force
          // ConnectionsPage. The `/forensics` route already redirects to
          // `/connections`. Dropping the chunk + the dependency shrinks the
          // production bundle by ~120KB.)
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
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
      '/downloads': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/updates': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/download': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/rmpg-seal.png': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
