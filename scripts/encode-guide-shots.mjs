#!/usr/bin/env node
// ============================================================
// Encode captured dispatch-console screenshots into the
// client/src/utils/dispatchGuideShots.ts asset module.
//
// Usage:
//   node scripts/encode-guide-shots.mjs <shotsDir>
//
// <shotsDir> contains PNGs named "<slug>.png" (e.g. console.png,
// commandLine.png, fkeys.png, ...). Each is downscaled to a sane
// width and re-encoded as JPEG (q≈72) via macOS `sips`, then
// base64-embedded with its aspect ratio (height/width). Slugs map
// 1:1 to the addFigure(ctx, '<slug>', ...) call sites in the guide.
// ============================================================
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shotsDir = process.argv[2];
if (!shotsDir) {
  console.error('usage: node scripts/encode-guide-shots.mjs <shotsDir>');
  process.exit(1);
}

const TARGET_W = 1500;        // downscale wide captures to this; keeps PDF small
const JPEG_QUALITY = 72;      // sips uses 1-100 via formatOptions
const tmp = mkdtempSync(join(tmpdir(), 'guideshots-'));

function dimensions(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = +(out.match(/pixelWidth:\s*(\d+)/)?.[1] || 0);
  const h = +(out.match(/pixelHeight:\s*(\d+)/)?.[1] || 0);
  return { w, h };
}

const files = readdirSync(shotsDir).filter(f => /\.png$/i.test(f) && !f.startsWith('_'));
const entries = [];
for (const f of files.sort()) {
  const slug = f.replace(/\.png$/i, '');
  const src = join(shotsDir, f);
  const { w: w0, h: h0 } = dimensions(src);
  if (!w0 || !h0) { console.warn(`skip ${f} (no dimensions)`); continue; }
  const outW = Math.min(TARGET_W, w0);
  const jpg = join(tmp, `${slug}.jpg`);
  // Resize to width + convert to JPEG in one sips pass.
  execFileSync('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(JPEG_QUALITY),
    '--resampleWidth', String(outW),
    src, '--out', jpg,
  ], { stdio: 'ignore' });
  const { w, h } = dimensions(jpg);
  const b64 = readFileSync(jpg).toString('base64');
  const aspect = +(h / w).toFixed(4);
  entries.push({ slug, b64, aspect, w, h, bytes: b64.length });
  console.log(`  ${slug.padEnd(16)} ${w}x${h}  aspect=${aspect}  ~${Math.round(b64.length / 1024)}KB b64`);
}

const body = entries.map(e =>
  `  ${JSON.stringify(e.slug)}: { format: 'JPEG', aspect: ${e.aspect}, data: 'data:image/jpeg;base64,${e.b64}' },`
).join('\n');

const header = `// ============================================================
// RMPG Flex — Dispatch Guide Screenshot Assets  (GENERATED)
//
// Real captures of the running RMPG Flex console, embedded into the
// Dispatch Guide PDF. Regenerate with:
//   node scripts/encode-guide-shots.mjs <shotsDir>
// Do not hand-edit the SHOTS payload below.
// ============================================================

export interface GuideShot {
  /** base64 data URL — "data:image/jpeg;base64,..." */
  data: string;
  format: 'JPEG' | 'PNG';
  /** naturalHeight / naturalWidth, used to letterbox the figure. */
  aspect: number;
}

/** Keyed by figure slug. When a slug is absent, addFigure() falls back
 *  to the original vector diagram (or skips). */
export const SHOTS: Partial<Record<string, GuideShot>> = {
${body}
};
`;

const outFile = 'client/src/utils/dispatchGuideShots.ts';
writeFileSync(outFile, header);
const totalKB = Math.round(entries.reduce((s, e) => s + e.bytes, 0) / 1024);
console.log(`\nWrote ${entries.length} shots to ${outFile}  (~${totalKB}KB base64 total)`);
