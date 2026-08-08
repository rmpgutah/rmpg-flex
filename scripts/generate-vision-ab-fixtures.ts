// ============================================================
// Generates the rasterized PNG fixtures the vision A/B (Task 3)
// reads, from the checked-in SVG sources. Re-run this whenever an
// .svg fixture changes — the PNGs are checked in too, so a vision
// A/B run never depends on this script executing first, but the
// PNGs must match their .svg source or the fixture guard test
// (Task 2, Step 5) has nothing to say about what the model actually saw.
//
//   npx tsx scripts/generate-vision-ab-fixtures.ts
// ============================================================
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const DIR = join(process.cwd(), 'tests', 'fixtures', 'serve-intake', 'vision');

async function main() {
  const svgFiles = readdirSync(DIR).filter((f) => f.endsWith('.svg'));
  for (const file of svgFiles) {
    const svg = readFileSync(join(DIR, file));
    const pngPath = join(DIR, file.replace(/\.svg$/, '.png'));
    await sharp(svg).png().toFile(pngPath);
    console.log(`wrote ${pngPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
