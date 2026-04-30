// Copies pdfjs-dist's standard_fonts/ and cmaps/ directories from node_modules
// into client/public/pdfjs/ so the browser can fetch them at runtime when
// PDF.js needs to render documents that reference Standard 14 fonts without
// embedding them, or PDFs with CJK text that needs CMap files.
//
// PDF.js v5 does NOT bundle these assets with the worker — the caller must
// provide standardFontDataUrl + cMapUrl pointing to a directory that hosts
// them. Without these URLs set, render() throws on most real-world PDFs.
//
// Run automatically as `prebuild` in client/package.json. Re-runs are cheap
// (idempotent — copies into the public/ tree which Vite serves verbatim).

import { mkdirSync, readdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = join(__dirname, '..');
const SRC_ROOT = join(CLIENT_ROOT, 'node_modules', 'pdfjs-dist');
const DEST_ROOT = join(CLIENT_ROOT, 'public', 'pdfjs');

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

if (!existsSync(SRC_ROOT)) {
  console.error('[copy-pdfjs-assets] node_modules/pdfjs-dist not found — run npm install first');
  process.exit(0); // Don't fail the build; PDF.js will degrade gracefully
}

let copied = 0;
for (const dir of ['standard_fonts', 'cmaps']) {
  const src = join(SRC_ROOT, dir);
  const dest = join(DEST_ROOT, dir);
  if (existsSync(src)) {
    copyDir(src, dest);
    const count = readdirSync(dest).length;
    console.log(`[copy-pdfjs-assets] ${dir}/ → ${count} files`);
    copied += count;
  } else {
    console.warn(`[copy-pdfjs-assets] missing source: ${src}`);
  }
}
console.log(`[copy-pdfjs-assets] total ${copied} files into ${DEST_ROOT}`);
