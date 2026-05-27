#!/usr/bin/env node
/**
 * D1 column-cap guard.
 *
 * Walks every *.sql file under migrations/ in lexicographic order (matching
 * wrangler's apply order), reconstructs the per-table column set from
 * CREATE TABLE + ALTER TABLE ADD COLUMN statements, and fails the build when:
 *
 *   1. a NEW table reaches D1_COL_THRESHOLD columns (default 90), or
 *   2. a BASELINED table grows past its recorded count.
 *
 * The real D1 SELECT result-set cap is ~100; the threshold gives us headroom
 * so new fields can be routed to a sibling `<table>_ext` instead of the base
 * table (the established escape hatch — see CLAUDE.md "D1 column cap").
 *
 * Baseline mechanism:
 *   scripts/column-cap-baseline.json freezes the projected column count for
 *   tables that are already over the threshold OR are close to it. The guard
 *   treats those counts as the allowed maximum. To bump a baseline (after a
 *   deliberate, reviewed schema change), edit the JSON in the same PR.
 *
 *   Run with COLUMN_CAP_BASELINE_UPDATE=1 to rewrite the baseline from the
 *   current schema state (use after confirming the new state is acceptable).
 *
 * Dedup rules (must match what D1 actually applies, since this repo's
 * migrations contain intentional ADD COLUMN overlap from the dirty-prod era):
 *   - CREATE TABLE for an already-known table is treated as no-op
 *     (idempotent IF NOT EXISTS re-creates are common in this repo).
 *   - ADD COLUMN with a name already present on the table is ignored
 *     (migrations 0003 and 0009 add overlapping sets — only the first wins).
 */

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');
const BASELINE_PATH = path.resolve(__dirname, 'column-cap-baseline.json');
const THRESHOLD = Number(process.env.D1_COL_THRESHOLD || 90);
const HARD_CAP = 100;
const UPDATE_BASELINE = process.env.COLUMN_CAP_BASELINE_UPDATE === '1';

const CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'FOREIGN',
  'UNIQUE',
  'CHECK',
  'CONSTRAINT',
]);

function stripLineComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function findCreateTables(sql) {
  const results = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    const tableName = m[1].toLowerCase();
    const parenStart = m.index + m[0].length - 1;
    if (sql[parenStart] !== '(') continue;
    let depth = 0;
    let end = -1;
    for (let i = parenStart; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    results.push({ tableName, body: sql.slice(parenStart + 1, end) });
  }
  return results;
}

function firstIdentifier(s) {
  const m = s.match(/^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w]*))/);
  if (!m) return null;
  return (m[1] || m[2] || m[3] || m[4]).toLowerCase();
}

function parseColumns(body) {
  const cols = new Set();
  for (const item of splitTopLevel(body)) {
    const head = item.trimStart().split(/\s+/)[0]?.toUpperCase() ?? '';
    if (CONSTRAINT_KEYWORDS.has(head)) continue;
    const name = firstIdentifier(item);
    if (name) cols.add(name);
  }
  return cols;
}

function findAddColumns(sql) {
  const re =
    /ALTER\s+TABLE\s+([A-Za-z_][\w]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w]*))/gi;
  const out = [];
  for (const m of sql.matchAll(re)) {
    out.push({
      tableName: m[1].toLowerCase(),
      colName: (m[2] || m[3] || m[4] || m[5]).toLowerCase(),
    });
  }
  return out;
}

function buildSchema(files) {
  const schema = new Map();
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const sql = stripLineComments(raw);
    const rel = path.relative(path.dirname(MIGRATIONS_DIR), file);

    for (const { tableName, body } of findCreateTables(sql)) {
      if (schema.has(tableName)) continue;
      schema.set(tableName, { columns: parseColumns(body), lastTouchedBy: rel });
    }

    for (const { tableName, colName } of findAddColumns(sql)) {
      const entry = schema.get(tableName);
      if (!entry) {
        schema.set(tableName, { columns: new Set([colName]), lastTouchedBy: rel });
        continue;
      }
      if (entry.columns.has(colName)) continue;
      entry.columns.add(colName);
      entry.lastTouchedBy = rel;
    }
  }
  return schema;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).tables || {};
  } catch (err) {
    console.error(`Failed to parse ${BASELINE_PATH}: ${err.message}`);
    process.exit(2);
  }
}

function writeBaseline(snapshot) {
  const payload = {
    note:
      'Auto-managed by scripts/check-column-cap.js. Captures projected column counts for tables at or above the threshold. To regenerate after an intentional schema change, run COLUMN_CAP_BASELINE_UPDATE=1 node scripts/check-column-cap.js.',
    threshold: THRESHOLD,
    tables: snapshot,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote baseline to ${path.relative(process.cwd(), BASELINE_PATH)}`);
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));

  const schema = buildSchema(files);
  const baseline = loadBaseline();

  const ranked = [...schema.entries()]
    .map(([name, { columns, lastTouchedBy }]) => ({
      name,
      count: columns.size,
      lastTouchedBy,
    }))
    .sort((a, b) => b.count - a.count);

  console.log(`D1 column-cap check (threshold=${THRESHOLD}, hard cap=${HARD_CAP})`);
  console.log('Top 10 widest tables:');
  for (const row of ranked.slice(0, 10)) {
    const baselined = baseline[row.name] != null ? ` [baseline: ${baseline[row.name]}]` : '';
    console.log(
      `  ${String(row.count).padStart(3)}  ${row.name.padEnd(40)} (last touched: ${row.lastTouchedBy})${baselined}`,
    );
  }

  if (UPDATE_BASELINE) {
    const snapshot = {};
    for (const r of ranked) {
      if (r.count >= THRESHOLD) snapshot[r.name] = r.count;
    }
    writeBaseline(snapshot);
    return;
  }

  const failures = [];
  for (const r of ranked) {
    const baselineCount = baseline[r.name];
    if (baselineCount != null) {
      if (r.count > baselineCount) {
        failures.push({
          kind: 'grew',
          name: r.name,
          count: r.count,
          baseline: baselineCount,
          lastTouchedBy: r.lastTouchedBy,
        });
      }
      continue;
    }
    if (r.count >= THRESHOLD) {
      failures.push({
        kind: 'new',
        name: r.name,
        count: r.count,
        lastTouchedBy: r.lastTouchedBy,
      });
    }
  }

  if (failures.length === 0) {
    console.log(`\nOK — all ${ranked.length} tables within their allowed limits.`);
    return;
  }

  console.error(`\nFAIL — ${failures.length} table(s) over their allowed limit:`);
  for (const f of failures) {
    if (f.kind === 'new') {
      const tag = f.count >= HARD_CAP ? 'AT/OVER D1 CAP' : 'approaching cap';
      console.error(
        `  [NEW] ${f.name}: ${f.count} columns (${tag}). Last touched by ${f.lastTouchedBy}.`,
      );
    } else {
      console.error(
        `  [GREW] ${f.name}: ${f.count} columns (baseline was ${f.baseline}). Last touched by ${f.lastTouchedBy}.`,
      );
    }
    console.error(
      `    -> Move new fields for "${f.name}" onto "${f.name}_ext" (see CLAUDE.md "D1 column cap").`,
    );
    console.error(
      `       If this growth is intentional and reviewed, run: COLUMN_CAP_BASELINE_UPDATE=1 node scripts/check-column-cap.js`,
    );
  }
  process.exit(1);
}

main();
