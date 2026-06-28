#!/usr/bin/env tsx
// ============================================================
// inspect-intake — calibrate document intake extractors
// ============================================================
// Run an extractor against a PDF or text file from the command
// line and print a hit/miss table. Faster feedback loop than
// going through the UI: edit anchor regex → re-run → see which
// fields newly hit/missed.
//
// Usage:
//   tsx server/scripts/inspect-intake.ts <path>
//   tsx server/scripts/inspect-intake.ts <path> --kind=court_order
//   tsx server/scripts/inspect-intake.ts <path> --raw   (also prints the OCR text)
//   echo "raw text..." | tsx server/scripts/inspect-intake.ts -
//
// Accepts either:
//   - a PDF path: runs the full pdftotext + ocrmypdf pipeline
//   - a .txt / .text path: skips OCR, calls extractFromText directly
//   - "-": reads text from stdin
//
// Exit code 0 if confidence >= 0.6 (passing), 1 otherwise — useful
// for shell loops over a directory of samples.

import { readFileSync, statSync } from 'fs';
import { extname, basename } from 'path';
import {
  extractFromText, extractFromPdf, listRegisteredKinds, detectKind,
} from '../src/utils/documentIntake/index.js';
import type { DocumentKind } from '../src/utils/documentIntake/types.js';

interface Args {
  path: string;
  kind?: DocumentKind;
  raw: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { path: '', raw: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--kind=')) {
      args.kind = a.slice('--kind='.length) as DocumentKind;
    } else if (a === '--raw') {
      args.raw = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: tsx server/scripts/inspect-intake.ts <path-or-dash> [--kind=<kind>] [--raw]

Registered kinds:
${listRegisteredKinds().map((k) => `  ${k.kind.padEnd(28)} (${k.tier}, ${k.anchorCount} anchors)`).join('\n')}
`);
      process.exit(0);
    } else if (!args.path) {
      args.path = a;
    }
  }
  if (!args.path) {
    console.error('error: path required (or "-" for stdin)');
    process.exit(2);
  }
  return args;
}

async function loadInput(args: Args): Promise<{ text: string; viaOcr: boolean }> {
  if (args.path === '-') {
    const stdinBuf = readFileSync(0);
    return { text: stdinBuf.toString('utf8'), viaOcr: false };
  }
  const ext = extname(args.path).toLowerCase();
  if (ext === '.txt' || ext === '.text') {
    return { text: readFileSync(args.path, 'utf8'), viaOcr: false };
  }
  if (ext === '.pdf') {
    const buf = readFileSync(args.path);
    const result = await extractFromPdf(buf);
    return { text: result.rawTextPreview, viaOcr: result.usedOcr };
  }
  throw new Error(`Unsupported extension: ${ext} (expected .pdf, .txt, or "-" for stdin)`);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function colorConfidence(c: number): string {
  if (c >= 0.8) return green((c * 100).toFixed(0) + '%');
  if (c >= 0.5) return yellow((c * 100).toFixed(0) + '%');
  if (c > 0)    return red((c * 100).toFixed(0) + '%');
  return red('miss');
}

async function main() {
  const args = parseArgs(process.argv);

  let text: string;
  let viaOcr = false;
  if (args.path !== '-' && extname(args.path).toLowerCase() === '.pdf') {
    // Full pipeline — show the path in output
    const buf = readFileSync(args.path);
    const fullResult = await extractFromPdf(buf, { forceKind: args.kind });
    printResult(args, fullResult, fullResult.rawTextPreview);
    process.exit(fullResult.confidence >= 0.6 ? 0 : 1);
    return;
  }
  ({ text, viaOcr } = await loadInput(args));
  if (!text.trim()) {
    console.error(red('error: input is empty'));
    process.exit(2);
  }

  const result = extractFromText(text, { forceKind: args.kind, usedOcr: viaOcr });
  printResult(args, result, text);
  process.exit(result.confidence >= 0.6 ? 0 : 1);
}

function printResult(args: Args, result: any, text: string) {
  const label = args.path === '-' ? '<stdin>' : basename(args.path);
  console.log(bold(`\n=== ${label} ===`));
  console.log(`${dim('detected kind:')}    ${result.kind} ${dim(`(tier: ${result.tier})`)}`);
  console.log(`${dim('confidence:')}       ${colorConfidence(result.confidence)} ${dim(`(${result.fields.length} anchors)`)}`);
  if (result.courtCategory) {
    console.log(`${dim('court category:')}   ${result.courtCategory}${result.state ? dim(` [${result.state}]`) : ''}`);
  }
  console.log(`${dim('input source:')}     ${args.path === '-' ? 'stdin' : args.path} ${result.usedOcr ? dim('(OCR fallback ran)') : ''}`);

  // Hit/miss table
  const hits = result.fields.filter((f: any) => f.confidence > 0);
  const misses = result.fields.filter((f: any) => f.confidence === 0);
  console.log(`\n${bold('HITS')} (${hits.length}):`);
  for (const f of hits) {
    const v = f.value.length > 80 ? f.value.slice(0, 77) + '…' : f.value;
    console.log(`  ${colorConfidence(f.confidence).padEnd(20)} ${dim(f.matchedAnchor || f.key)}  →  ${v}`);
  }
  if (misses.length > 0) {
    console.log(`\n${bold('MISSES')} (${misses.length}) ${dim('— anchors that found nothing; calibrate these next')}:`);
    for (const f of misses) {
      console.log(`  ${red('miss').padEnd(20)} ${dim(f.matchedAnchor || f.key)}`);
    }
  }

  if (args.raw) {
    const cap = Math.min(text.length, 2000);
    console.log(`\n${bold('RAW TEXT (first 2KB)')}:`);
    console.log(dim(text.slice(0, cap)));
    if (text.length > cap) console.log(dim(`... (${text.length - cap} more chars)`));
  }
  console.log('');
}

main().catch((err) => {
  console.error(red('FAILED:'), err?.message ?? err);
  process.exit(2);
});
