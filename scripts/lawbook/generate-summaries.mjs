#!/usr/bin/env node
// ============================================================
// RMPG Flex — plain-language summary generator (Workers AI → JSONL)
// ------------------------------------------------------------
// Adds "basic language and understanding" to each statute record: a short
// plain-English summary + a few key-point bullets an officer can scan. Writes
// the fields back into the JSONL in place, so it is fully RESUMABLE — a record
// that already has plain_summary is skipped, and the file is flushed
// periodically so a crash never loses completed work.
//
// Generation runs through the account's Workers AI over the Cloudflare REST
// API (same OAuth token wrangler stores), using the fp8-fast Llama the Worker
// itself uses — verified reachable from this environment. No deploy required.
//
// Usage:
//   node generate-summaries.mjs <file1.jsonl> [file2.jsonl ...]
//   node generate-summaries.mjs --glob            # every data/*.jsonl
//   node generate-summaries.mjs file.jsonl --concurrency=8 --limit=200
// ============================================================
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, 'data');
const ACCOUNT_ID = '5caa95c5789f4fc4ed3934b2a2c29ed4';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

async function getToken() {
  const cfg = await readFile(resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const m = cfg.match(/oauth_token\s*=\s*"?([^"\n]+)"?/);
  if (!m) throw new Error('no oauth_token in wrangler config');
  return m[1].trim();
}

const SYSTEM = [
  'You are a legal plain-language assistant for Utah peace officers and private',
  'security personnel. Given one section of the Utah Code, explain it in clear,',
  'plain English a patrol officer can understand at a glance. Be accurate and',
  'neutral. Never invent penalties, elements, or duties that are not in the text.',
  'Do not give legal advice. Follow the requested output format exactly.',
].join(' ');

// A labeled plain-text format — small models follow it far more reliably than
// JSON (the 70B fp8 model emits malformed JSON arrays), and it parses cleanly.
function buildUserPrompt(rec) {
  const text = (rec.description || '').slice(0, 3500);
  return [
    `Citation: ${rec.citation}`,
    `Catchline: ${rec.short_title}`,
    `Area of law: ${rec.category}`,
    '',
    'Statute text:',
    text,
    '',
    'Respond in EXACTLY this format and nothing else:',
    'SUMMARY: <2-3 plain-English sentences on what this section does and who it applies to>',
    'KEY POINTS:',
    '- <short point: a key element, exception, penalty class if stated, or practical note for an officer>',
    '- <short point>',
    '(give 3 to 5 key points, each on its own line starting with "- ")',
  ].join('\n');
}

async function runModel(token, rec) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUserPrompt(rec) }],
      max_tokens: 360,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`AI error ${JSON.stringify(data.errors)}`);
  const r = data.result?.response;
  return typeof r === 'string' ? r : r == null ? '' : JSON.stringify(r);
}

// Parse the labeled "SUMMARY:/KEY POINTS:" format, tolerant of drift.
function parseResult(raw) {
  const text = String(raw);
  let summary = '';
  let elements = [];
  const sumM = text.match(/SUMMARY:\s*([\s\S]*?)(?:\n\s*KEY POINTS:|$)/i);
  if (sumM) summary = sumM[1].replace(/\s+/g, ' ').trim();
  const kpM = text.match(/KEY POINTS:\s*([\s\S]*)$/i);
  if (kpM) {
    elements = kpM[1].split('\n')
      .map((l) => l.replace(/^[\s\-•*\d.)]+/, '').trim())
      .filter((l) => l.length > 1)
      .slice(0, 6);
  }
  if (!summary) {
    summary = text.replace(/KEY POINTS:[\s\S]*$/i, '').replace(/^\s*SUMMARY:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 600);
  }
  return { summary, elements };
}

async function summarizeRecord(token, rec, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const raw = await runModel(token, rec);
      const { summary, elements } = parseResult(raw);
      if (summary) {
        rec.plain_summary = summary;
        rec.plain_elements = elements.length ? JSON.stringify(elements) : null;
        rec.summary_model = MODEL;
        return true;
      }
    } catch (err) { lastErr = err; await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
  }
  process.stderr.write(`  ! ${rec.citation}: ${lastErr?.message || 'no summary'}\n`);
  return false;
}

// Bounded-concurrency map over an index list.
async function pool(items, worker, concurrency) {
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
      done++;
      if (done % 25 === 0) process.stderr.write(`    …${done}/${items.length}\n`);
    }
  });
  await Promise.all(runners);
}

async function processFile(path, token, opts) {
  const text = await readFile(path, 'utf8');
  const recs = text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let todo = recs.filter((r) => !r.plain_summary && r.description);
  if (opts.limit) todo = todo.slice(0, opts.limit);
  process.stderr.write(`▶ ${path}: ${recs.length} rows, ${todo.length} need summaries\n`);
  if (!todo.length) return 0;

  const flush = () => writeFile(path, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  let sinceFlush = 0;
  await pool(todo, async (rec) => {
    const ok = await summarizeRecord(token, rec);
    if (ok && ++sinceFlush >= 40) { sinceFlush = 0; await flush(); }
  }, opts.concurrency);
  await flush();
  const done = recs.filter((r) => r.plain_summary).length;
  process.stderr.write(`✔ ${path}: ${done}/${recs.length} summarized\n`);
  return done;
}

function parseArgs(argv) {
  const a = { _: [] };
  for (const t of argv) { const m = t.match(/^--([^=]+)(?:=(.*))?$/); if (m) a[m[1]] = m[2] ?? true; else a._.push(t); }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = { concurrency: parseInt(args.concurrency || '8', 10), limit: args.limit ? parseInt(args.limit, 10) : 0 };
  let files = args._;
  if (args.glob) files = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.jsonl')).map((f) => resolve(DATA_DIR, f));
  if (!files.length) { process.stderr.write('usage: node generate-summaries.mjs <file.jsonl ...> | --glob\n'); process.exit(1); }
  const token = await getToken();
  let total = 0;
  for (const f of files) total += await processFile(resolve(process.cwd(), f), token, opts);
  process.stderr.write(`\n══ summaries present: ${total}\n`);
}

main().catch((e) => { process.stderr.write(`✖ ${e.stack || e}\n`); process.exit(1); });
