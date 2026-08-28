#!/usr/bin/env npx tsx
// Sync D1 schema to Turso secondary DB.
// Usage: TURSO_AUTH_TOKEN=<token> npx tsx scripts/sync-schema-to-turso.ts

import { createClient } from '@libsql/client/web';
import { execSync } from 'child_process';

const TURSO_URL = 'libsql://rmpg-flex-secondary-rmpgutah-us.aws-us-east-2.turso.io';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_AUTH_TOKEN) {
  console.error('Error: TURSO_AUTH_TOKEN environment variable is required.');
  process.exit(1);
}

function runWrangler(command: string): any[] {
  const raw = execSync(
    `npx wrangler d1 execute rmpg-flex --remote --command "${command}"`,
    { encoding: 'utf-8', cwd: '/Users/rmpgutah/rmpg-flex' },
  );
  // Extract JSON array from wrangler output (contains ANSI codes and status lines)
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Failed to parse wrangler output');
  const parsed = JSON.parse(match[0]);
  // wrangler returns [{ results: [...], success: true, meta: {...} }]
  return parsed?.[0]?.results ?? [];
}

async function main() {
  console.log('==> Dumping D1 tables...');
  const tables = runWrangler("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name");
  const createStatements = tables
    .map((t: any) => t.sql as string)
    .filter((sql: string) => sql && !sql.includes('_cf_KV'))
    .filter((sql: string) => !sql.includes('fts_config') && !sql.includes('fts_data') && !sql.includes('fts_docsize') && !sql.includes('fts_idx'));

  console.log(`==> Found ${createStatements.length} table definitions`);

  console.log('==> Dumping D1 indexes...');
  const indexes = runWrangler("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const idxStatements = indexes
    .map((t: any) => t.sql as string)
    .filter((sql: string) => sql && !sql.includes('_cf_KV') && !sql.includes('fts_'));

  console.log(`==> Found ${idxStatements.length} index definitions`);

  console.log('==> Connecting to Turso...');
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });
  await turso.execute('SELECT 1');
  console.log('==> Turso connection OK');

  let created = 0, skipped = 0, failed = 0;

  const allStatements = [...createStatements, ...idxStatements];
  for (const sql of allStatements) {
    try {
      await turso.execute(sql);
      created++;
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('already exists')) {
        skipped++;
      } else {
        console.error(`FAILED: ${msg.slice(0, 120)}`);
        failed++;
      }
    }
  }

  console.log(`\n==> Done: ${created} created, ${skipped} already existed, ${failed} failed`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
