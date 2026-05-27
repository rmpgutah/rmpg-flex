#!/usr/bin/env node
// ============================================================
// check-column-cap.js
// ============================================================
// CI guard against D1 100-column-cap regressions.
//
// Why this exists:
//   Cloudflare D1 caps SELECT result sets at ~100 columns. Once a
//   table approaches that cap, any handler doing `SELECT *` (with
//   or without JOINs) starts 500-ing in production. We've hit this
//   twice — once shipped, once caught at merge — and don't want
//   it to happen again.
//
// What this checks:
//   For each migration file passed via the CHANGED_MIGRATIONS env
//   var (newline-separated, populated by the workflow from
//   `git diff origin/main...HEAD`), reject any:
//     ALTER TABLE <watched-table> ADD COLUMN ...
//   where <watched-table> is in the WATCHED set below.
//
//   Without CHANGED_MIGRATIONS, the script falls back to checking
//   every file in migrations/ — useful for local runs but noisy
//   in CI because it'll flag the historical churn that already
//   pushed calls_for_service to 100+ cols on paper.
//
// Why a watch list rather than column counting:
//   The migration history overstates the live schema state by
//   ~26 columns on calls_for_service (live=100 cols, migration
//   files imply 126). Schema drift between migrations/ and live
//   D1 is a separate problem documented in TRIAGE.md addenda.
//   A column-counting check trips on this drift on every PR; a
//   watch list focuses on the actual concern: "don't add MORE
//   columns to tables we already know are at the cap."
//
// To add a table to the watch list:
//   1. Query live D1 for its current column count via the D1 MCP:
//      SELECT COUNT(*) FROM pragma_table_info('<table>');
//   2. If the count is >= 85, add it to WATCHED with a comment
//      naming the source PR / incident.
//
// To override (intentionally raise the cap):
//   Set ALLOW_ALTER_<TABLE_UPPER>=1 in the workflow env. Document
//   why in the PR description.
//
// Exit codes:
//   0 — no violations in the changed files
//   1 — at least one violation (CI should fail)
//   2 — internal error
// ============================================================

const fs = require('fs');
const path = require('path');

// Tables at or near the D1 100-col cap. Any ALTER TABLE … ADD COLUMN
// against these in a new migration must be justified.
//
//   calls_for_service:     100 cols on live D1 (confirmed 2026-05-27).
//                          The migrations/ history implies 126 cols
//                          but most of the 0009/0011/0014 ALTERs did
//                          not land. Future cols MUST go to ext.
//   calls_for_service_ext: 29 cols on live, with explicit room for
//                          overflow. Allowed — listed only so future
//                          additions are visible in CI logs.
//   persons:               94 cols on live. Two more ALTERs and any
//                          SELECT * starts 500-ing.
const WATCHED = new Set([
  'calls_for_service',
  'persons',
]);

// Soft watch — log a notice in CI even though we don't fail. Use for
// tables that are <90 cols today but trending up.
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
  // CHANGED_MIGRATIONS is a newline-separated list passed by the
  // workflow. Each entry is a path relative to repo root, like
  // "migrations/0039_foo.sql".
  const env = process.env.CHANGED_MIGRATIONS || '';
  const fromEnv = env
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('.sql') && s.includes('migrations/'));

  if (fromEnv.length > 0) {
    return fromEnv.map((p) => path.resolve(__dirname, '..', p));
  }

  // Fallback for local runs: check ALL files. Will report against
  // every historical migration too — useful as a debug aid.
  const dir = path.join(__dirname, '..', 'migrations');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f));
}

function isAllowedByOverride(table) {
  const key = 'ALLOW_ALTER_' + table.toUpperCase();
  return process.env[key] === '1';
}

function main() {
  const files = getTargetFiles();
  if (files.length === 0) {
    console.log('[col-cap-check] no migration files to check');
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
          notices.push({
            file: relName,
            table,
            column,
            kind: 'override',
          });
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
  console.error('     calls_for_service has calls_for_service_ext (1:1) already.');
  console.error('  2. If no _ext exists, create one and use it for new columns.');
  console.error('  3. If the column truly must live on the base table, set the');
  console.error('     override env var ALLOW_ALTER_' + violations[0].table.toUpperCase() + '=1 in this');
  console.error('     workflow run AND document the justification in the PR body.');
  process.exit(1);
}

main();
