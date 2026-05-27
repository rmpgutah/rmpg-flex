#!/usr/bin/env node
// ============================================================
// check-column-cap.js
// ============================================================
// CI guard against D1 100-column-cap regressions.
//
// Modes:
//   1. CHANGED_MIGRATIONS env var is set (workflow mode):
//      Check ONLY the listed files (newline-separated). Even when
//      the list is empty (PR doesn't touch migrations/), exit 0.
//      Never fall back to scanning everything — that would trip
//      on the historical churn that already pushed
//      calls_for_service to 100 cols on paper.
//
//   2. CHANGED_MIGRATIONS env var is unset (local debug mode):
//      Scan every file in migrations/. Expect many "violations"
//      from the historical files; use this mode to spot-check
//      that the watch list is correctly detecting ALTERs you
//      know are present.
//
// Watch set:
//   calls_for_service  — 100 cols on live D1 (at the cap)
//   persons            — 94 cols on live (one ALTER from the cap)
// ============================================================

const fs = require('fs');
const path = require('path');

const WATCHED = new Set([
  'calls_for_service',
  'persons',
]);

const SOFT_WATCH = new Set([
  'calls_for_service_ext',
  'incidents',
]);

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function parseAdds(sql) {
  const results = [];
  const re = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+(?:COLUMN\s+)?(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    results.push({ table: m[1], column: m[2] });
  }
  return results;
}

function getTargetFiles() {
  // Distinguish unset (local debug) from set-but-empty (workflow
  // mode, PR didn't touch migrations). `'CHANGED_MIGRATIONS' in
  // process.env` is true even when the value is an empty string.
  const envSet = 'CHANGED_MIGRATIONS' in process.env;
  if (envSet) {
    const fromEnv = (process.env.CHANGED_MIGRATIONS || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.endsWith('.sql') && s.includes('migrations/'));
    return { files: fromEnv.map((p) => path.resolve(__dirname, '..', p)), mode: 'workflow' };
  }

  const dir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(dir)) return { files: [], mode: 'local' };
  return {
    files: fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
      .map((f) => path.join(dir, f)),
    mode: 'local',
  };
}

function isAllowedByOverride(table) {
  return process.env['ALLOW_ALTER_' + table.toUpperCase()] === '1';
}

function main() {
  const { files, mode } = getTargetFiles();
  console.log('[col-cap-check] mode: ' + mode);

  if (files.length === 0) {
    if (mode === 'workflow') {
      console.log('[col-cap-check] OK — no migration files changed in this PR');
      process.exit(0);
    }
    console.log('[col-cap-check] no .sql files found');
    process.exit(0);
  }

  console.log('[col-cap-check] scanning ' + files.length + ' file(s)');
  console.log('[col-cap-check] watched tables: ' + [...WATCHED].join(', '));
  if (SOFT_WATCH.size > 0) {
    console.log('[col-cap-check] soft watch (notice only): ' + [...SOFT_WATCH].join(', '));
  }
  console.log('');

  const violations = [];
  const notices = [];

  for (const fullPath of files) {
    const relName = path.basename(fullPath);
    let raw;
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      console.error('[col-cap-check] cannot read ' + relName + ': ' + err.message);
      process.exit(2);
    }
    const sql = stripComments(raw);

    for (const { table, column } of parseAdds(sql)) {
      if (WATCHED.has(table)) {
        if (isAllowedByOverride(table)) {
          notices.push({ file: relName, table, column, kind: 'override' });
        } else {
          violations.push({ file: relName, table, column });
        }
      } else if (SOFT_WATCH.has(table)) {
        notices.push({ file: relName, table, column, kind: 'soft' });
      }
    }
  }

  for (const n of notices) {
    if (n.kind === 'override') {
      console.log(
        '[col-cap-check] notice (override): ' + n.file + ' adds ' + n.table + '.' + n.column +
          ' — allowed via ALLOW_ALTER_' + n.table.toUpperCase() + '=1',
      );
    } else {
      console.log(
        '[col-cap-check] notice (soft watch): ' + n.file + ' adds ' + n.table + '.' + n.column +
          ' — table is trending toward the cap, no action required',
      );
    }
  }

  if (violations.length === 0) {
    console.log('');
    console.log('[col-cap-check] OK — no watched-table ALTERs in the checked files');
    process.exit(0);
  }

  // Local mode treats historical violations as informational.
  if (mode === 'local') {
    console.log('');
    console.log('[col-cap-check] local mode — found ' + violations.length + ' historical watched-table ALTER(s) (informational):');
    for (const v of violations.slice(0, 10)) {
      console.log('  - ' + v.file + ': ALTER TABLE ' + v.table + ' ADD COLUMN ' + v.column);
    }
    if (violations.length > 10) console.log('  ... and ' + (violations.length - 10) + ' more');
    console.log('[col-cap-check] OK — local mode does not fail on grandfathered ALTERs');
    process.exit(0);
  }

  console.error('');
  console.error('[col-cap-check] FAIL — ' + violations.length + ' watched-table ALTER(s):');
  for (const v of violations) {
    console.error('  - ' + v.file + ': ALTER TABLE ' + v.table + ' ADD COLUMN ' + v.column);
  }
  console.error('');
  console.error('These tables are at or near the D1 100-column cap. Adding columns to');
  console.error('them breaks every SELECT * on the table.');
  console.error('');
  console.error('Resolutions (in order of preference):');
  console.error('  1. Move the new column(s) to the table\'s _ext overflow table.');
  console.error('  2. If no _ext exists, create one and use it for new columns.');
  console.error('  3. Set ALLOW_ALTER_' + violations[0].table.toUpperCase() + '=1 in this workflow run');
  console.error('     AND document the justification in the PR body.');
  process.exit(1);
}

main();
