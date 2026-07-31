import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, URL } from 'url';
import path from 'path';
import { execFileSync } from 'child_process';
import { stampCfAsync } from './src/utils/rocketLoaderOptout';

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
    {
      // ── Rocket Loader opt-out ────────────────────────────────────────────
      // Cloudflare Rocket Loader is enabled on the rmpgutah.us zone and BREAKS
      // this app. It rewrites the entry script's type attribute:
      //
      //   <script type="module" src="/assets/index-<hash>.js">
      //   -> <script type="<cf-hash>-module" src="/assets/index-<hash>.js">
      //
      // A mangled type is not a module type, so the browser fetches the bundle
      // (network shows 200) but never executes it. React never mounts and the
      // page sits on the #pre-splash "INITIALIZING" div forever. Confirmed live
      // 2026-07-31 on a fresh profile with no service worker and no caches.
      //
      // Why it was invisible: sw.js's CACHE_NAME is stamped from the git SHA, so
      // a warm service worker kept serving the app — until a deploy rotated the
      // cache and forced every client back through the rewritten HTML.
      //
      // `data-cfasync="false"` is Cloudflare's documented opt-out:
      // https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/
      // Two constraints from those docs, both satisfied here: the attribute must
      // appear BEFORE `src`, and dependent scripts need it too — which is why
      // this stamps EVERY script in index.html, not just the module entry. The
      // inline pre-paint theme resolver matters as much as the entry: deferring
      // it would reintroduce the theme FOUC that script exists to prevent.
      //
      // This is defense-in-depth, not a substitute for turning Rocket Loader off
      // at the zone — but it means a future accidental re-enable cannot wedge
      // the app again.
      name: 'rocket-loader-optout',
      enforce: 'post' as const,
      transformIndexHtml: (html: string) => stampCfAsync(html),
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
          // Vite's shared dynamic-`import()` runtime helper (needed by every
          // one of the app's 130+ lazy() routes to fire the FIRST code-split
          // load). Left unassigned, Rollup's chunk-graph heuristic kept
          // co-locating this tiny helper inside whichever large vendor
          // bucket below it judged "most central" — vendor-deckgl, then
          // vendor-mapbox, then vendor-pdf, each time forcing the ENTRY to
          // eagerly download that entire multi-hundred-KB-to-multi-MB chunk
          // just to reach the helper (2026-07-02 perf fix; see the removed
          // vendor-mapbox/vendor-deckgl buckets below). Pin it explicitly to
          // the already-eager, genuinely tiny rolldown-runtime chunk instead.
          if (id === '\0vite/preload-helper.js') return 'rolldown-runtime';
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
          // Mapbox GL JS — primary map engine.
          if (id.includes('node_modules/mapbox-gl')) {
            return 'vendor-mapbox';
          }
          // MapLibre GL — free map fallback (no API key)
          if (id.includes('node_modules/maplibre-gl')) {
            return 'vendor-maplibre';
          }
          // Deck.gl — GPU-accelerated map layers
          if (/node_modules\/@(deck|luma|loaders|math|probe)\.gl/.test(id)) {
            return 'vendor-deckgl';
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
