#!/usr/bin/env node
// ============================================================
// RMPG Flex — D1 bulk loader (chunked SQL → live D1 over REST)
// ------------------------------------------------------------
// POSTs each SQL chunk to the Cloudflare D1 REST API, in filename order, using
// the OAuth token wrangler already stores. This is the documented bulk-load
// path (project-law-book memory): `wrangler` is not authed here and the MCP
// d1_database_query routes SQL through the model context (too large for a
// multi-MB seed), so we curl the REST endpoint directly at ~50KB/request.
//
// Usage:
//   node load-to-d1.mjs data/seed-chunks            # a directory of *.sql
//   node load-to-d1.mjs data/update-chunks --dry-run
// ============================================================
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const ACCOUNT_ID = '5caa95c5789f4fc4ed3934b2a2c29ed4';
const DATABASE_ID = '785de7ae-3e7a-4e01-93bb-d24ddd813f6b';

async function getToken() {
  const cfg = await readFile(resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8');
  const m = cfg.match(/oauth_token\s*=\s*"?([^"\n]+)"?/);
  if (!m) throw new Error('no oauth_token in wrangler config');
  return m[1].trim();
}

async function runSql(token, sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`HTTP ${res.status} ${JSON.stringify(data.errors || data).slice(0, 300)}`);
  return (data.result || []).reduce((acc, r) => acc + (r.meta?.changes || 0), 0);
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  if (!dir) { process.stderr.write('usage: node load-to-d1.mjs <chunk-dir> [--dry-run]\n'); process.exit(1); }

  const abs = resolve(process.cwd(), dir);
  const files = (await readdir(abs)).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) throw new Error(`no .sql chunks in ${abs}`);

  let totalBytes = 0;
  for (const f of files) totalBytes += (await stat(resolve(abs, f))).size;
  process.stderr.write(`${files.length} chunks, ${(totalBytes / 1024).toFixed(0)} KB total\n`);
  if (dryRun) { process.stderr.write('dry-run: not posting\n'); return; }

  const token = await getToken();
  let changes = 0;
  for (const f of files) {
    const sql = await readFile(resolve(abs, f), 'utf8');
    const c = await runSql(token, sql);
    changes += c;
    process.stderr.write(`  ✔ ${f}  (+${c} changes)\n`);
  }
  process.stderr.write(`══ applied ${files.length} chunks, ${changes} total row changes\n`);
}

main().catch((e) => { process.stderr.write(`✖ ${e.stack || e}\n`); process.exit(1); });
