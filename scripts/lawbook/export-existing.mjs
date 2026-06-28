#!/usr/bin/env node
// ============================================================
// RMPG Flex — export existing utah_statutes rows lacking a summary
// ------------------------------------------------------------
// Pages the live D1 over REST and writes the rows that still need a plain-
// language summary to data/existing.jsonl, so generate-summaries.mjs +
// build-seed.mjs --update-summaries can backfill them without re-scraping.
//
// Usage: node export-existing.mjs [--all]   (--all ignores plain_summary filter)
// ============================================================
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ACCOUNT_ID = '5caa95c5789f4fc4ed3934b2a2c29ed4';
const DATABASE_ID = '785de7ae-3e7a-4e01-93bb-d24ddd813f6b';
const PAGE = 300;

async function getToken() {
  const cfg = await readFile(resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  return cfg.match(/oauth_token\s*=\s*"?([^"\n]+)"?/)[1].trim();
}
async function runSql(token, sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result[0].results;
}

async function main() {
  const all = process.argv.includes('--all');
  const token = await getToken();
  const where = all ? '' : 'WHERE plain_summary IS NULL';
  const recs = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await runSql(token,
      `SELECT id, citation, short_title, description, category FROM utah_statutes ${where} ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`);
    recs.push(...rows);
    process.stderr.write(`  …${recs.length}\n`);
    if (rows.length < PAGE) break;
  }
  const out = resolve(HERE, 'data', 'existing.jsonl');
  await writeFile(out, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  process.stderr.write(`✔ ${recs.length} rows → ${out}\n`);
}
main().catch((e) => { process.stderr.write(`✖ ${e.stack || e}\n`); process.exit(1); });
