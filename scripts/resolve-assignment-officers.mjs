#!/usr/bin/env node
// ============================================================
// resolve-assignment-officers.mjs — backfill fleet_assignments.officer_id
//
// CONTEXT: fleet_assignments historically stored only a free-text
// officer_name. Migration 0222 added a nullable officer_id FK so historical
// driving events can be attributed to a real users row (Driver Performance
// feature). This one-time script resolves that FK conservatively.
//
// MATCHING RULES (strict on purpose — see the brief for why):
//   - Normalize both sides: trim, collapse internal whitespace to a single
//     space, lowercase. No fuzzy matching, no edit distance, no nickname
//     expansion, no substring/partial matching.
//   - Candidate names come from users.full_name (NOT NULL, canonical — the
//     live API route also reads officer_name from full_name, see
//     src/routes/driverPerformance.ts) PLUS, as a secondary alias for the
//     same user id, `first_name + ' ' + last_name` for any user where both
//     parts are present. A user can therefore have more than one normalized
//     alias; matches are deduped by user id before counting, so multiple
//     aliases for the SAME person are one match, not an ambiguity.
//   - Write officer_id ONLY when exactly one DISTINCT user id matches across
//     all aliases. Zero matches and 2+ distinct user ids BOTH stay null — a
//     wrong match here permanently attributes someone else's driving events
//     to a named officer in a system that feeds performance review and may
//     be read in litigation.
//
// SAFETY:
//   - Defaults to a DRY RUN. Pass --apply to actually write.
//   - Defaults to LOCAL D1 (safer). Pass --remote to target live D1.
//   - Unresolved rows (no-match + ambiguous) are written to
//     scratchpad/unresolved-assignments.txt for human review — assignment id
//     + officer_name ONLY. That file must never be committed (names are PII
//     and this repo's rules forbid PII in the repo).
//
// USAGE:
//   node scripts/resolve-assignment-officers.mjs                # dry run, local
//   node scripts/resolve-assignment-officers.mjs --remote        # dry run, remote
//   node scripts/resolve-assignment-officers.mjs --apply          # write, local
//   node scripts/resolve-assignment-officers.mjs --apply --remote # write, remote
// ============================================================

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_NAME = 'rmpg-flex';
const APPLY = process.argv.includes('--apply');
const REMOTE = process.argv.includes('--remote');
const TARGET_FLAG = REMOTE ? '--remote' : '--local';

const SCRATCHPAD_UNRESOLVED_PATH =
  process.env.RESOLVE_ASSIGNMENTS_UNRESOLVED_PATH ||
  '/private/tmp/claude-501/-Users-rmpgutah-RMPG-Flex--claude-worktrees-driver-performance-function-bc1cac/e0c8ccab-9704-4bd5-a487-000f1557d931/scratchpad/unresolved-assignments.txt';

function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function d1(sql) {
  let raw;
  try {
    raw = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', DB_NAME, TARGET_FLAG, '--json', '--command', sql],
      { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err) {
    throw new Error(
      `wrangler d1 execute failed (target=${TARGET_FLAG}): ${err.stderr || err.message}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`could not parse wrangler JSON output: ${err.message}\nraw: ${raw}`);
  }
  return Array.isArray(parsed) && parsed[0]?.results ? parsed[0].results : [];
}

function main() {
  console.log(
    `resolve-assignment-officers: target=${REMOTE ? 'REMOTE' : 'local'} mode=${
      APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'
    }`
  );

  let assignments;
  let users;
  try {
    assignments = d1(
      "SELECT id, officer_name FROM fleet_assignments WHERE officer_id IS NULL AND officer_name IS NOT NULL AND TRIM(officer_name) != ''"
    );
    users = d1('SELECT id, full_name, first_name, last_name FROM users');
  } catch (err) {
    console.error(`✗ could not connect to D1 (${TARGET_FLAG}): ${err.message}`);
    console.error(
      REMOTE
        ? 'Remote D1 access failed — check wrangler auth / network.'
        : "Local D1 access failed — this worktree's local D1 is known to be incomplete/unset up. Not reporting a fake result."
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Fetched ${assignments.length} unresolved assignment row(s) and ${users.length} candidate user row(s).`
  );

  if (users.length === 0) {
    console.error(
      '✗ ABORTING — candidate user set is EMPTY. An empty `users` table is not a plausible ' +
        'real state for this system; this almost certainly means a configuration or ' +
        `connectivity problem (target=${TARGET_FLAG}), not "no users to match against". ` +
        'Refusing to print a normal 0-resolved summary or write an unresolved report — ' +
        'that would misrepresent a broken query as "nothing matched."'
    );
    process.exitCode = 1;
    return;
  }

  // Build normalized-name -> Set<user id> index. full_name is the primary,
  // canonical, NOT-NULL source; first_name+' '+last_name is a secondary
  // alias for the same user id where both parts are present. Multiple
  // aliases pointing at the same user id must collapse to one match.
  const byName = new Map();
  function addAlias(name, userId) {
    const key = normalizeName(name);
    if (!key) return;
    if (!byName.has(key)) byName.set(key, new Set());
    byName.get(key).add(userId);
  }
  for (const u of users) {
    addAlias(u.full_name, u.id);
    if (u.first_name && u.last_name) {
      addAlias(`${u.first_name} ${u.last_name}`, u.id);
    }
  }

  const resolved = [];
  const noMatch = [];
  const ambiguous = [];

  for (const a of assignments) {
    const key = normalizeName(a.officer_name);
    const matchIds = key ? [...(byName.get(key) || [])] : [];
    if (matchIds.length === 1) {
      resolved.push({ id: a.id, officer_name: a.officer_name, officer_id: matchIds[0] });
    } else if (matchIds.length === 0) {
      noMatch.push({ id: a.id, officer_name: a.officer_name });
    } else {
      ambiguous.push({ id: a.id, officer_name: a.officer_name, candidates: matchIds.length });
    }
  }

  console.log('--- Summary ---');
  console.log(`resolved:  ${resolved.length}`);
  console.log(`no-match:  ${noMatch.length}`);
  console.log(`ambiguous: ${ambiguous.length}`);

  // Write unresolved report to scratchpad only (PII, never into the repo)
  const unresolvedLines = [
    `# unresolved fleet_assignments — generated ${new Date().toISOString()}`,
    `# target=${REMOTE ? 'remote' : 'local'} mode=${APPLY ? 'apply' : 'dry-run'}`,
    `# no-match (${noMatch.length}):`,
    ...noMatch.map((r) => `id=${r.id}\tofficer_name=${r.officer_name}`),
    `# ambiguous (${ambiguous.length}):`,
    ...ambiguous.map((r) => `id=${r.id}\tofficer_name=${r.officer_name}\tcandidates=${r.candidates}`),
    '',
  ].join('\n');

  try {
    mkdirSync(dirname(SCRATCHPAD_UNRESOLVED_PATH), { recursive: true });
    writeFileSync(SCRATCHPAD_UNRESOLVED_PATH, unresolvedLines, 'utf-8');
    console.log(`Unresolved rows written to: ${SCRATCHPAD_UNRESOLVED_PATH}`);
  } catch (err) {
    console.error(`✗ could not write unresolved report: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log(
      `Dry run complete — 0 rows written. Re-run with --apply to write ${resolved.length} resolved officer_id value(s).`
    );
    return;
  }

  if (resolved.length === 0) {
    console.log('Nothing to apply — no unambiguous matches found.');
    return;
  }

  console.log(`Applying ${resolved.length} update(s) to fleet_assignments...`);
  let applied = 0;
  for (const r of resolved) {
    try {
      d1(`UPDATE fleet_assignments SET officer_id = ${Number(r.officer_id)} WHERE id = ${Number(r.id)}`);
      applied += 1;
    } catch (err) {
      console.error(`✗ failed to update assignment id=${r.id}: ${err.message}`);
    }
  }
  console.log(`✓ applied ${applied}/${resolved.length} update(s).`);
}

main();
