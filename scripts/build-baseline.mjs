#!/usr/bin/env node
// build-baseline.mjs — regenerate migrations/baseline/schema.sql from LIVE D1.
//
// The historical migrations/*.sql files are NOT replayable from scratch (dirty-
// schema rehoming artifact). `npm run migrate:local` bootstraps a fresh local D1
// from a schema snapshot of live (the source of truth) instead of replaying them.
// This script (re)produces that snapshot.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=<acct> node scripts/build-baseline.mjs
//   # or point at an existing dump:  BASELINE_RAW=/path/to/dump.sql node scripts/build-baseline.mjs
//
// SCHEMA ONLY (--no-data). Never snapshot live rows — this is a police system
// (persons/calls = PII) and the file is committed to git.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB = 'rmpg-flex';
const OUT = 'migrations/baseline/schema.sql';
const rawPath = process.env.BASELINE_RAW || join(tmpdir(), 'live_schema_raw.sql');

if (!process.env.BASELINE_RAW) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID (or BASELINE_RAW to reuse a dump).');
    process.exit(1);
  }
  console.error(`Exporting live schema of ${DB} (--no-data) → ${rawPath} ...`);
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'export', DB, '--remote', '--no-data', `--output=${rawPath}`],
    { stdio: 'inherit' },
  );
}

let sql = readFileSync(rawPath, 'utf8');

// Make every CREATE idempotent so the baseline is safe to re-run against an
// already-bootstrapped local DB (wrangler's export emits bare CREATE …).
sql = sql
  .replace(/^CREATE TABLE (?!IF NOT EXISTS)/gm, 'CREATE TABLE IF NOT EXISTS ')
  .replace(/^CREATE UNIQUE INDEX (?!IF NOT EXISTS)/gm, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
  .replace(/^CREATE INDEX (?!IF NOT EXISTS)/gm, 'CREATE INDEX IF NOT EXISTS ');

// Tracker seed: mark every on-disk migration as applied so a subsequent
// `wrangler d1 migrations apply --local` runs only migrations newer than this
// snapshot (0072+).
const migs = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
const seedValues = migs.map((m) => `('${m}')`).join(',\n  ');
const seed = `

-- ============================================================
-- Migration tracker seed: mark every historical migration through the
-- snapshot point as applied, so \`wrangler d1 migrations apply --local\`
-- only runs migrations added AFTER this baseline (0072+).
-- ============================================================
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ${seedValues};
`;

const stamp = new Date().toISOString().slice(0, 10);
const header = `-- ============================================================
-- migrations/baseline/schema.sql  — LOCAL-DEV BASELINE SNAPSHOT
-- ============================================================
-- Authoritative schema snapshot of LIVE D1 \`${DB}\`, the source of truth.
--
-- WHY THIS EXISTS: the historical migrations/*.sql files are NOT replayable
-- from scratch (dirty-schema rehoming artifact — two conflicting 0001 files,
-- ordering violations, non-constant ADD COLUMN defaults). \`npm run migrate:local\`
-- bootstraps a fresh local D1 from THIS snapshot instead of replaying history,
-- then applies any migrations newer than the snapshot (0072+) via wrangler.
--
-- NOT applied to remote and NOT picked up by \`wrangler d1 migrations apply\`
-- (wrangler only reads *.sql in migrations/, not subdirectories).
--
-- SCHEMA ONLY — no rows. Never dump live data here (PII: persons/calls).
--
-- REGENERATE:  CLOUDFLARE_ACCOUNT_ID=<acct> node scripts/build-baseline.mjs
-- Generated ${stamp} from \`wrangler d1 export --no-data\` + IF-NOT-EXISTS + tracker seed.
-- ============================================================

`;

mkdirSync('migrations/baseline', { recursive: true });
writeFileSync(OUT, header + sql + seed);
console.error(`Wrote ${OUT} (${migs.length} migrations seeded).`);
