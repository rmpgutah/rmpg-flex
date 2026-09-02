#!/usr/bin/env node
/**
 * Apply untracked D1 migrations one statement at a time.
 *
 * Why this exists:
 *   `wrangler d1 migrations apply --remote` stops the whole pending batch
 *   on the first error. Live D1 already has `time_entries.starting_mileage`,
 *   so 0227_time_entries_mileage_reason_repair.sql fails with
 *   "duplicate column name" and every later file (0265 person-intel tables,
 *   0269 skiptracer v2, 0270 tesseract page_number, …) never runs.
 *   deploy.yml then continues, ships Worker + Pages, and the features look
 *   deployed while their schema is missing — which is why they are not
 *   functional.
 *
 * This script:
 *   1. Reads d1_migrations from live (or --dry-run sample).
 *   2. Applies each untracked migrations/*.sql statement-by-statement.
 *   3. Treats duplicate-column / already-exists as success.
 *   4. Never executes remote-unsafe table rebuilds (DROP TABLE of CAD
 *      tables) or local-only FZ-55 files — those are marked tracked so
 *      they stop blocking the batch.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

const IGNORABLE_ERROR = /duplicate column name|already exists|duplicate index/i;

const UNSAFE_DROP = /\bDROP\s+TABLE\s+(IF\s+EXISTS\s+)?(calls_for_service|shift_swap_requests)\b/i;

export type PendingAction = 'track-only' | 'apply';

export type ExecuteResult = { ok: boolean; message?: string };

export type PendingSummary = {
  applied: string[];
  trackedOnly: string[];
  skippedAlready: string[];
  failed: Array<{ filename: string; message?: string; stmt?: string }>;
};

export function isIgnorableD1Error(message: unknown): boolean {
  return IGNORABLE_ERROR.test(String(message || ''));
}

export function isLocalOnlyMigration(sql: string, filename = ''): boolean {
  const head = String(sql).split('\n').slice(0, 5).join('\n');
  if (/local-only/i.test(head)) return true;
  return /^(0249_sync_queue|0250_sync_conflicts)\.sql$/.test(filename);
}

export function isUnsafeRemoteRebuild(sql: string): boolean {
  return UNSAFE_DROP.test(String(sql || ''));
}

/** Split SQL into executable statements. Strips `--` line comments. */
export function splitSqlStatements(sql: string): string[] {
  const withoutBlock = String(sql).replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = withoutBlock.split('\n').map((line) => {
    let inStr = false;
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inStr) { inStr = true; out += ch; continue; }
      if (ch === "'" && inStr) {
        if (line[i + 1] === "'") { out += "''"; i++; continue; }
        inStr = false; out += ch; continue;
      }
      if (!inStr && ch === '-' && line[i + 1] === '-') break;
      out += ch;
    }
    return out;
  });
  const text = lines.join('\n');
  const stmts: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inStr) { inStr = true; cur += ch; continue; }
    if (ch === "'" && inStr) {
      if (text[i + 1] === "'") { cur += "''"; i++; continue; }
      inStr = false; cur += ch; continue;
    }
    if (!inStr && ch === ';') {
      const trimmed = cur.trim();
      if (trimmed) stmts.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

export function classifyPendingFile(filename: string, sql: string): { action: PendingAction; reason: string } {
  if (isLocalOnlyMigration(sql, filename)) {
    return { action: 'track-only', reason: 'local-only (must not land on live D1)' };
  }
  if (isUnsafeRemoteRebuild(sql)) {
    return { action: 'track-only', reason: 'table-rebuild DROP would destroy live CAD/HR rows' };
  }
  return { action: 'apply', reason: 'safe to apply statement-by-statement' };
}

function wranglerJson(args: string[]): unknown {
  const raw = execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error(`wrangler did not return JSON: ${raw.slice(0, 400)}`);
  }
}

function resultsFromWrangler(payload: unknown): Array<{ name?: string }> {
  if (Array.isArray(payload)) {
    const first = payload[0] as { results?: Array<{ name?: string }>; result?: Array<{ name?: string }> } | undefined;
    return first?.results ?? first?.result ?? [];
  }
  if (payload && typeof payload === 'object' && 'results' in payload) {
    const results = (payload as { results?: Array<{ name?: string }> }).results;
    return results ?? [];
  }
  return [];
}

function listMigrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function trackSql(filename: string): string {
  const escaped = filename.replace(/'/g, "''");
  return `INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES ('${escaped}', datetime('now'))`;
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
    return [e.stderr, e.stdout, e.message].filter(Boolean).map(String).join('\n');
  }
  return String(err);
}

function executeRemote(sql: string): ExecuteResult {
  try {
    wranglerJson(['d1', 'execute', 'rmpg-flex', '--remote', '--json', '--command', sql]);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: errorText(err) };
  }
}

export async function applyPending(opts: {
  executeSql: (sql: string) => Promise<ExecuteResult>;
  listAppliedNames: () => Promise<Iterable<string>>;
  log?: { info?: (m: string) => void; error?: (m: string) => void };
}): Promise<PendingSummary> {
  const { executeSql, listAppliedNames, log = console } = opts;
  const applied = new Set(await listAppliedNames());
  const files = listMigrationFiles();
  const summary: PendingSummary = { applied: [], trackedOnly: [], skippedAlready: [], failed: [] };

  for (const filename of files) {
    if (applied.has(filename)) {
      summary.skippedAlready.push(filename);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const cls = classifyPendingFile(filename, sql);
    log.info?.(`→ ${filename}: ${cls.action} (${cls.reason})`);

    if (cls.action === 'track-only') {
      const mark = await executeSql(trackSql(filename));
      if (!mark.ok && !isIgnorableD1Error(mark.message)) {
        summary.failed.push({ filename, message: mark.message });
        continue;
      }
      summary.trackedOnly.push(filename);
      applied.add(filename);
      continue;
    }

    let fileFailed = false;
    for (const stmt of splitSqlStatements(sql)) {
      const res = await executeSql(stmt);
      if (!res.ok && !isIgnorableD1Error(res.message)) {
        log.error?.(`   statement failed in ${filename}: ${res.message}`);
        summary.failed.push({ filename, message: res.message, stmt: stmt.slice(0, 120) });
        fileFailed = true;
        break;
      }
    }
    if (fileFailed) continue;

    const mark = await executeSql(trackSql(filename));
    if (!mark.ok && !isIgnorableD1Error(mark.message)) {
      summary.failed.push({ filename, message: `tracked insert failed: ${mark.message}` });
      continue;
    }
    summary.applied.push(filename);
    applied.add(filename);
  }
  return summary;
}

async function main(): Promise<void> {
  const remote = process.argv.includes('--remote');
  const dryRun = process.argv.includes('--dry-run');
  if (!remote && !dryRun) {
    console.error('usage: node --experimental-strip-types scripts/d1PendingMigrations.ts --remote | --dry-run');
    process.exit(64);
  }

  if (dryRun) {
    const files = listMigrationFiles();
    for (const filename of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      const cls = classifyPendingFile(filename, sql);
      if (cls.action !== 'apply') console.log(`${filename}\t${cls.action}\t${cls.reason}`);
    }
    return;
  }

  const payload = wranglerJson([
    'd1', 'execute', 'rmpg-flex', '--remote', '--json',
    '--command', 'SELECT name FROM d1_migrations',
  ]);
  const appliedNames = resultsFromWrangler(payload).map((r) => r.name).filter((n): n is string => !!n);

  const summary = await applyPending({
    listAppliedNames: async () => appliedNames,
    executeSql: async (sql) => executeRemote(sql),
    log: {
      info: (m) => console.log(m),
      error: (m) => console.error(m),
    },
  });

  console.log(JSON.stringify({
    applied: summary.applied,
    trackedOnly: summary.trackedOnly,
    failed: summary.failed,
  }, null, 2));

  if (summary.failed.length) process.exit(1);
}

const isCli = Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isCli) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
