#!/usr/bin/env node
/**
 * check-column-cap.js
 * Prevents PRs from adding ALTER TABLE ADD COLUMN against D1 tables at/near
 * the 100-column SELECT cap. Cloudflare D1 caps result sets at ~100 columns;
 * tables exceeding this (e.g. calls_for_service at 110 cols) must use _ext
 * overflow tables instead of direct ALTERs.
 *
 * Usage: node scripts/check-column-cap.js [--allow-list file.json]
 *
 * Scans every migration file under migrations/ for patterns like
 *   ALTER TABLE <table> ADD [COLUMN] <col>
 * and fails if <table> is in the watchlist with a cap <= current+added cols.
 *
 * Exit codes:
 *   0 — no cap violations
 *   1 — cap violation(s) found
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_BASELINE = path.join(__dirname, 'column-cap-baseline.json');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function loadBaseline(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`WARN: Baseline file not found at ${filePath}, using empty baseline`);
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function parseAlterTable(sql) {
  const pattern = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s+ADD(?:\s+COLUMN)?\s+[`"']?(\w+)[`"']?/gi;
  const results = [];
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    results.push({ table: match[1].toLowerCase(), column: match[2] });
  }
  return results;
}

function main() {
  const baselinePath = process.argv.includes('--allow-list')
    ? path.resolve(process.argv[process.argv.indexOf('--allow-list') + 1])
    : DEFAULT_BASELINE;

  const baseline = loadBaseline(baselinePath);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const violations = [];

  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    const alters = parseAlterTable(sql);

    for (const { table, column } of alters) {
      if (baseline[table] !== undefined) {
        violations.push({ file, table, column });
        console.error(`VIOLATION: ${file} — ALTER TABLE ${table} ADD ${column}`
          + ` (table "${table}" is at/near the 100-column cap, baseline: ${baseline[table]})`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n${violations.length} cap violation(s) found.`
      + ` Use _ext overflow tables instead of direct ALTERs on watched tables.`);
    process.exit(1);
  }

  console.log('OK — no column-cap violations in any migration file.');
  process.exit(0);
}

main();
