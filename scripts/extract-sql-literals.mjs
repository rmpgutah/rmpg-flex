#!/usr/bin/env node
// Extract every string / template literal from TypeScript sources using the
// TypeScript compiler's own scanner, and print them as JSON lines:
//   {"file": "...", "line": 123, "text": "SELECT ..."}
//
// Usage:  node scripts/extract-sql-literals.mjs src [more dirs...]
//
// WHY THIS EXISTS
// ---------------
// The schema checkers need SQL text out of .ts files. Three successive
// hand-rolled extractors all under-reported:
//
//   1. A regex alternation over `...` / '...' / "..." pairs quotes by POSITION
//      across the file, so one stray backtick shifts every later pairing.
//   2. Tracking ${} nesting with an integer ignores quotes inside the
//      interpolation.
//   3. Even a state-stack lexer mispaired backticks in src/routes/hr.ts, and
//      because each mistake cascades, 21 of 28 SQL-bearing literals in that
//      file came out as garbage — its ~81 statements were effectively NEVER
//      CHECKED. Silent under-reporting is the worst failure mode for a tool
//      whose whole job is finding things nobody noticed.
//
// TypeScript already has an exact lexer for its own grammar. Using it removes
// this entire class of bug instead of patching it again.
import ts from 'typescript';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node scripts/extract-sql-literals.mjs <dir> [dir...]');
  process.exit(64);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

for (const dir of dirs) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);

    const visit = (node) => {
      let text = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        text = node.text;
      } else if (ts.isTemplateExpression(node)) {
        // Reassemble head + spans, marking each interpolation. The checker
        // decides what to do with `${...}`; keeping a marker preserves the
        // fact that something was substituted there.
        text = node.head.text;
        for (const span of node.templateSpans) {
          text += '${' + span.expression.getText(sf) + '}' + span.literal.text;
        }
      }
      if (text !== null) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        process.stdout.write(JSON.stringify({ file, line: line + 1, text }) + '\n');
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }
}
