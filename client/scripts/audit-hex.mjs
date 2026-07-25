// client/scripts/audit-hex.mjs
// Reports migratable hex literals per directory, so the Class D sweep can be
// batched into reviewable PRs instead of one unreviewable 549-file diff.
// Usage: npx tsx scripts/audit-hex.mjs [--list <dir>]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { classifyFile } from '../src/utils/hexClassifier.ts';

const ROOT = 'src';
const HEX = /#[0-9a-fA-F]{6}\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*[,)]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const tally = new Map();
let excludedFiles = 0, excludedHits = 0;

for (const file of walk(ROOT)) {
  const hits = (readFileSync(file, 'utf8').match(HEX) ?? []).length;
  if (!hits) continue;
  const rel = relative('.', file);
  if (classifyFile(rel) === 'excluded') { excludedFiles++; excludedHits += hits; continue; }
  const bucket = rel.split('/').slice(0, 3).join('/');
  const prev = tally.get(bucket) ?? { files: 0, hits: 0, paths: [] };
  tally.set(bucket, { files: prev.files + 1, hits: prev.hits + hits, paths: [...prev.paths, rel] });
}

const listDir = process.argv.includes('--list') ? process.argv[process.argv.indexOf('--list') + 1] : null;
if (listDir) {
  for (const [bucket, v] of tally) if (bucket.startsWith(listDir)) v.paths.forEach((p) => console.log(p));
} else {
  const rows = [...tally.entries()].sort((a, b) => b[1].hits - a[1].hits);
  let totalFiles = 0, totalHits = 0;
  for (const [bucket, v] of rows) {
    console.log(String(v.hits).padStart(6), String(v.files).padStart(4) + ' files ', bucket);
    totalFiles += v.files; totalHits += v.hits;
  }
  console.log('\nIN SCOPE :', totalHits, 'literals across', totalFiles, 'files,', rows.length, 'batches');
  console.log('EXCLUDED :', excludedHits, 'literals across', excludedFiles, 'files');
}
