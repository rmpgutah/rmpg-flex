#!/usr/bin/env npx tsx
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Args {
  csv: string;
  geojson: string;
  db: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--csv') { args.csv = value; i++; }
    else if (flag === '--geojson') { args.geojson = value; i++; }
    else if (flag === '--db') { args.db = value; i++; }
  }
  if (!args.csv || !args.geojson) {
    console.error('Usage: import-utah-roads.ts --csv <path> --geojson <path> [--db <path>]');
    process.exit(1);
  }
  return {
    csv: args.csv,
    geojson: args.geojson,
    db: args.db ?? path.resolve(__dirname, '../data/rmpg-flex.db'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const [label, file] of [['csv', args.csv], ['geojson', args.geojson]] as const) {
    if (!fs.existsSync(file)) {
      console.error(`[error] ${label} file not found: ${file}`);
      process.exit(1);
    }
  }
  const db = new Database(args.db);
  console.log(`[import] db=${args.db} csv=${args.csv} geojson=${args.geojson}`);
  // TODO Task 5: pass 1 (CSV)
  // TODO Task 6: pass 2 (GeoJSON)
  db.close();
  console.log('[import] done (skeleton only)');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
