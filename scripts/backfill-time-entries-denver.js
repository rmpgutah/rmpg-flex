#!/usr/bin/env node
// ============================================================
// One-shot backfill — populate time_entries._local columns from the existing
// UTC ISO columns. Run as a Node script that talks to D1 via the wrangler
// CLI in batched UPDATEs:
//
//   node scripts/backfill-time-entries-denver.js              (--remote default)
//   node scripts/backfill-time-entries-denver.js --local      (against local D1)
//
// Idempotent: only updates rows where the *_local column is still NULL.
//
// Note: `time_entries` has no `break_end` UTC column — end-break clears
// `break_start` and accumulates `break_minutes` (a duration). Three pairs only.
//
// The toDenverWallClock helper duplicates src/utils/denverTime.ts on purpose —
// this script runs in Node CLI context (not Worker context) and can't import
// from the worker TS module without setting up tsx/esbuild. A 15-line duplicate
// is cheaper than dragging build tooling into a one-shot script.
// ============================================================

// Uses execFileSync (not execSync) with an argument array so wrangler's
// argv is passed directly without going through a shell — no metacharacters
// in SQL strings get interpreted, eliminating the shell-injection surface.
const { execFileSync } = require('node:child_process');

const FLAG = process.argv.includes('--local') ? '--local' : '--remote';
const BATCH = 100;

const DENVER_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function toDenverWallClock(utcString) {
  if (!utcString) return null;
  const d = new Date(utcString);
  if (Number.isNaN(d.getTime())) return null;
  const parts = DENVER_FMT.formatToParts(d).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

function d1Query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'rmpg-flex', FLAG, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function d1Execute(sql) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'rmpg-flex', FLAG, '--command', sql],
    { encoding: 'utf8' },
  );
}

const COLUMN_PAIRS = [
  ['clock_in', 'clock_in_local'],
  ['clock_out', 'clock_out_local'],
  ['break_start', 'break_start_local'],
];

function escapeSqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  let totalUpdated = 0;

  for (const [src, dst] of COLUMN_PAIRS) {
    console.log(`\n→ Backfilling ${dst} from ${src}`);
    let updatedThisCol = 0;

    while (true) {
      const rows = d1Query(
        `SELECT id, ${src} FROM time_entries WHERE ${src} IS NOT NULL AND ${dst} IS NULL LIMIT ${BATCH}`,
      );
      if (rows.length === 0) break;

      const updates = rows
        .map((r) => {
          const local = toDenverWallClock(r[src]);
          if (!local) return null;
          return `UPDATE time_entries SET ${dst} = ${escapeSqlValue(local)} WHERE id = ${Number(r.id)};`;
        })
        .filter(Boolean)
        .join('\n');

      if (updates.length === 0) break;
      d1Execute(updates);
      updatedThisCol += rows.length;
      console.log(`  …${updatedThisCol} rows`);
    }
    totalUpdated += updatedThisCol;
  }

  console.log(`\n✅ Backfill complete. ${totalUpdated} rows updated across 3 columns.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
