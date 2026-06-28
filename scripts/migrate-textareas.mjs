// One-shot migration: replace every <textarea> with <RichTextArea> across client/src.
// Adds the import line if missing, computes the correct relative path per file,
// rewrites self-closing and balanced tags, and skips opt-out files.
//
// Usage: node scripts/migrate-textareas.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { relative, dirname, join } from 'node:path';

const SKIP = new Set([
  'client/src/pages/dispatch/DispatchPage.tsx', // CLAUDE.md gotcha #4 — defer
  'client/src/components/DebouncedInput.tsx',   // primitive — wrapping would self-loop
  'client/src/components/RichTextArea.tsx',     // the component itself
]);

const COMPONENT_PATH = 'client/src/components/RichTextArea';
const ROOT = 'client/src';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter(f => !SKIP.has(f));

let touched = 0, replaced = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const openCount = (original.match(/<textarea\b/g) || []).length;
  if (openCount === 0) continue;

  const fromDir = dirname(file);
  let rel = relative(fromDir, COMPONENT_PATH).split('\\').join('/');
  if (!rel.startsWith('.')) rel = './' + rel;

  let src = original
    .replace(/<textarea\b/g, '<RichTextArea')
    .replace(/<\/textarea>/g, '</RichTextArea>');

  if (!/from ['"][^'"]*RichTextArea['"]/.test(src)) {
    const importRegex = /^(import .+;\s*\n)+/m;
    const m = src.match(importRegex);
    const importLine = `import RichTextArea from '${rel}';\n`;
    if (m) {
      const insertAt = m.index + m[0].length;
      src = src.slice(0, insertAt) + importLine + src.slice(insertAt);
    } else {
      src = importLine + src;
    }
  }

  writeFileSync(file, src);
  touched++;
  replaced += openCount;
}

console.log(`migrated: ${touched} files, ${replaced} <textarea> tags replaced`);
