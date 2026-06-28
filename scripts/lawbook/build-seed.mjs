#!/usr/bin/env node
// ============================================================
// RMPG Flex — law-book seed builder (JSONL → chunked SQL)
// ------------------------------------------------------------
// Turns the scraped + summarized JSONL into SQL chunk files small enough for
// the D1 REST API (~100KB/request cap → we target ~50KB/chunk, the same
// bulk-load recipe documented in the project-law-book memory). Two modes:
//
//   (default)  full-row INSERTs for NEW sections. Emits a leading idempotent
//              DELETE for exactly the categories present in the input, so a
//              re-load is clean and never touches the existing criminal/
//              vehicle/licensing rows.
//   --update-summaries
//              UPDATE statements that set only plain_summary/plain_elements/
//              summary_model on EXISTING rows, keyed by citation.
//
// Usage:
//   node build-seed.mjs data/title-77.jsonl data/title-53.jsonl --out=data/seed-chunks
//   node build-seed.mjs --glob --out=data/seed-chunks
//   node build-seed.mjs data/existing.jsonl --update-summaries --out=data/update-chunks
// ============================================================
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, 'data');
const MAX_CHUNK = 50_000; // bytes of SQL per chunk file

const COLS = [
  'title', 'chapter', 'chapter_code', 'section', 'subsection', 'citation',
  'short_title', 'description', 'offense_level', 'category', 'subcategory',
  'part_name', 'code_type', 'effective_date', 'source_url', 'citation_fine',
  'plain_summary', 'plain_elements', 'summary_model',
];

const q = (v) => {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 'NULL' : String(Number(v)));

function rowValues(r) {
  return '(' + [
    num(r.title), num(r.chapter), q(r.chapter_code), q(r.section), q(r.subsection),
    q(r.citation), q(r.short_title), q(r.description), q(r.offense_level), q(r.category),
    q(r.subcategory), q(r.part_name), q(r.code_type || 'statute'), q(r.effective_date),
    q(r.source_url), num(r.citation_fine), q(r.plain_summary), q(r.plain_elements), q(r.summary_model),
  ].join(',') + ')';
}

async function loadRecords(files) {
  const recs = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    for (const line of text.trim().split('\n').filter(Boolean)) recs.push(JSON.parse(line));
  }
  return recs;
}

// Pack statements into ≤MAX_CHUNK files, numbered so the loader runs them in order.
async function writeChunks(outDir, statements) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  let buf = [];
  let size = 0;
  let n = 0;
  const flush = async () => {
    if (!buf.length) return;
    const name = `chunk-${String(n).padStart(4, '0')}.sql`;
    await writeFile(resolve(outDir, name), buf.join('\n'));
    n++; buf = []; size = 0;
  };
  for (const s of statements) {
    if (size + s.length > MAX_CHUNK) await flush();
    buf.push(s); size += s.length + 1;
  }
  await flush();
  return n;
}

function buildInserts(recs) {
  const cats = [...new Set(recs.map((r) => r.category))];
  const statements = [`DELETE FROM utah_statutes WHERE category IN (${cats.map(q).join(',')});`];
  // Multi-row INSERTs, each statement kept under the chunk cap.
  const head = `INSERT INTO utah_statutes (${COLS.join(',')}) VALUES`;
  let vals = [];
  let size = head.length;
  const flush = () => { if (vals.length) { statements.push(`${head}\n${vals.join(',\n')};`); vals = []; size = head.length; } };
  for (const r of recs) {
    const v = rowValues(r);
    if (size + v.length > MAX_CHUNK) flush();
    vals.push(v); size += v.length + 2;
  }
  flush();
  return { statements, cats };
}

function buildUpdates(recs, excludeCats) {
  const skip = new Set(excludeCats || []);
  return recs
    .filter((r) => r.plain_summary && r.citation && !skip.has(r.category))
    .map((r) =>
      `UPDATE utah_statutes SET plain_summary=${q(r.plain_summary)}, ` +
      `plain_elements=${q(r.plain_elements)}, summary_model=${q(r.summary_model)} ` +
      `WHERE citation=${q(r.citation)};`,
    );
}

function parseArgs(argv) {
  const a = { _: [] };
  for (const t of argv) { const m = t.match(/^--([^=]+)(?:=(.*))?$/); if (m) a[m[1]] = m[2] ?? true; else a._.push(t); }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let files = args._.map((f) => resolve(process.cwd(), f));
  if (args.glob) {
    files = (await readdir(DATA_DIR))
      .filter((f) => f.startsWith('title-') && f.endsWith('.jsonl'))
      .map((f) => resolve(DATA_DIR, f));
  }
  if (!files.length) { process.stderr.write('usage: node build-seed.mjs <file.jsonl ...> [--glob] [--update-summaries] [--out=dir]\n'); process.exit(1); }

  const recs = await loadRecords(files);
  const outDir = resolve(process.cwd(), args.out || resolve(DATA_DIR, args['update-summaries'] ? 'update-chunks' : 'seed-chunks'));

  if (args['update-summaries']) {
    const exclude = args['exclude-category'] ? String(args['exclude-category']).split(',').map((s) => s.trim()) : [];
    const statements = buildUpdates(recs, exclude);
    const n = await writeChunks(outDir, statements);
    process.stderr.write(`✔ ${statements.length} UPDATEs → ${n} chunks in ${outDir}\n`);
  } else {
    const { statements, cats } = buildInserts(recs);
    const n = await writeChunks(outDir, statements);
    process.stderr.write(`✔ ${recs.length} rows (categories: ${cats.join(', ')}) → ${n} chunks in ${outDir}\n`);
  }
}

main().catch((e) => { process.stderr.write(`✖ ${e.stack || e}\n`); process.exit(1); });
