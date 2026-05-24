#!/usr/bin/env tsx
// ============================================================
// Warrant Scrapers CLI
// ============================================================
// Usage: npm run scrapers <command> [args]
//
// Commands:
//   status [--grade=F]                  — list sources with health
//   test <source_key> [--file=path]     — dry-run parse (no DB write)
//   trigger <source_key>                — force immediate scrape
//   reset <source_key>                  — clear circuit breaker
//   metrics <source_key> [--window=24]  — show rolling metrics as JSON
// ============================================================

import { readFileSync } from 'node:fs';
import { getDb } from '../src/models/database';
import { getSourceMetrics, getHealthSummary, type ScraperHealthGrade } from '../src/utils/scraperMetrics';

const [, , command, ...args] = process.argv;

function flag(name: string): string | null {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
}

function arg(index: number): string | null {
  const positional = args.filter(a => !a.startsWith('--'));
  return positional[index] ?? null;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.substring(0, width) : s + ' '.repeat(width - s.length);
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s.substring(0, width) : ' '.repeat(width - s.length) + s;
}

async function cmdStatus(): Promise<void> {
  const summary = getHealthSummary();
  console.log('\nScraper Health Summary:');
  console.log(`  Total:    ${summary.total}`);
  console.log(`  Healthy:  ${summary.healthy}`);
  console.log(`  Degraded: ${summary.degraded}`);
  console.log(`  Failed:   ${summary.failed}`);
  console.log(`  Broken:   ${summary.circuit_broken}`);
  console.log(`\nLast hour: ${summary.last_hour_runs} runs, ${summary.last_hour_inserted} new warrants\n`);

  const gradeFilter = flag('grade');
  const db = getDb();
  const sources = db.prepare(`
    SELECT source_key, state FROM warrant_scraper_config
    WHERE enabled = 1
    ORDER BY state, source_key
  `).all() as { source_key: string; state: string | null }[];

  console.log(`${pad('SOURCE', 40)} ${pad('STATE', 6)} GRADE  RUNS  SUCCESS  LAST_ERROR`);
  console.log('─'.repeat(100));

  for (const s of sources) {
    const m = getSourceMetrics(s.source_key, 24);
    if (gradeFilter && m.health_grade !== gradeFilter.toUpperCase()) continue;
    const state = s.state || '';
    const rate = `${Math.round(m.success_rate * 100)}%`;
    const err = (m.last_error || '').substring(0, 40);
    console.log(
      `${pad(s.source_key, 40)} ${pad(state, 6)} ${pad(m.health_grade, 6)} ${padRight(String(m.total_runs), 4)}  ${padRight(rate, 6)}   ${err}`
    );
  }
}

async function cmdTest(): Promise<void> {
  const sourceKey = arg(0);
  if (!sourceKey) {
    console.error('Usage: test <source_key> [--file=path]');
    process.exit(1);
  }

  const db = getDb();
  const config = db.prepare('SELECT * FROM warrant_scraper_config WHERE source_key = ?').get(sourceKey) as any;
  if (!config) {
    console.error(`Source not found: ${sourceKey}`);
    process.exit(1);
  }

  const filePath = flag('file');
  let html: string;
  if (filePath) {
    html = readFileSync(filePath, 'utf-8');
    console.log(`[TEST] Loaded ${html.length} bytes from ${filePath}`);
  } else {
    console.log(`[TEST] Fetching ${config.source_url}...`);
    const res = await fetch(config.source_url);
    html = await res.text();
    console.log(`[TEST] Received ${html.length} bytes, status ${res.status}`);
  }

  const { parseWithFallback } = await import('../src/utils/multiStateWarrantScraper');
  const result = parseWithFallback(config, html);

  console.log(`\n[TEST] Parser used: ${result.parserUsed}`);
  console.log(`[TEST] Entries found: ${result.entries.length}`);
  if (result.driftSignal) console.log(`[TEST] Drift signal: ${result.driftSignal}`);

  console.log(`\nSample entries (first 5):`);
  for (const e of result.entries.slice(0, 5)) {
    const values = Object.values(e).filter(v => v !== '' && v !== null && v !== undefined);
    const total = Object.keys(e).length;
    const pct = Math.round((values.length / total) * 100);
    console.log(`  [${pct}% filled] ${e.full_name || '(no name)'} — ${e.charge_description || '(no charge)'}`);
  }
}

async function cmdTrigger(): Promise<void> {
  const sourceKey = arg(0);
  if (!sourceKey) {
    console.error('Usage: trigger <source_key>');
    process.exit(1);
  }
  console.log(`[TRIGGER] ${sourceKey} — forcing scrape...`);
  const { syncSource } = await import('../src/utils/multiStateWarrantScraper');
  await syncSource(sourceKey);
  console.log(`[TRIGGER] Done. Check warrant_scraper_runs for result.`);
}

async function cmdReset(): Promise<void> {
  const sourceKey = arg(0);
  if (!sourceKey) {
    console.error('Usage: reset <source_key>');
    process.exit(1);
  }
  const db = getDb();
  const result = db.prepare(
    'UPDATE warrant_scraper_config SET consecutive_errors = 0, circuit_broken = 0 WHERE source_key = ?'
  ).run(sourceKey);
  if (result.changes === 0) {
    console.error(`Source not found: ${sourceKey}`);
    process.exit(1);
  }
  console.log(`[RESET] Circuit breaker cleared for ${sourceKey}`);
}

async function cmdMetrics(): Promise<void> {
  const sourceKey = arg(0);
  if (!sourceKey) {
    console.error('Usage: metrics <source_key> [--window=24]');
    process.exit(1);
  }
  const window = parseInt(flag('window') ?? '24', 10);
  const metrics = getSourceMetrics(sourceKey, window);
  console.log(JSON.stringify(metrics, null, 2));
}

async function main(): Promise<void> {
  switch (command) {
    case 'status':
      await cmdStatus();
      break;
    case 'test':
      await cmdTest();
      break;
    case 'trigger':
      await cmdTrigger();
      break;
    case 'reset':
      await cmdReset();
      break;
    case 'metrics':
      await cmdMetrics();
      break;
    default:
      console.log('Usage: npm run scrapers <status|test|trigger|reset|metrics>');
      console.log('\nCommands:');
      console.log('  status [--grade=F]                  List sources with health grade');
      console.log('  test <source_key> [--file=path]     Dry-run parse (no DB write)');
      console.log('  trigger <source_key>                Force immediate scrape');
      console.log('  reset <source_key>                  Clear circuit breaker');
      console.log('  metrics <source_key> [--window=24]  Show rolling metrics as JSON');
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => {
  console.error('[SCRAPER CLI]', (err as Error).message);
  process.exit(1);
});
