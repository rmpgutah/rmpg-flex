import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

const dbTs = readFileSync('server/src/models/database.ts', 'utf-8');

// Extract all CREATE TABLE statements
const createRegex = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/g;
const creates = [];
let m;
while ((m = createRegex.exec(dbTs)) !== null) {
  creates.push({ table: m[1], sql: m[0] });
}

// Extract all addCol calls
const addColRegex = /addCol\(['"](\w+)['"],\s*['"](\w+)['"],\s*['"]?([^"']+?)['"]?\s*(?:,.*?)?\)/g;
const addCols = [];
while ((m = addColRegex.exec(dbTs)) !== null) {
  addCols.push({ table: m[1], column: m[2], type: m[3].replace(/DEFAULT\s+.*$/, '').trim() });
}

console.log(`Tables: ${creates.length}, addCols: ${addCols.length}`);

// Query D1
function d1(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const r = execSync(`npx wrangler d1 execute rmpg-flex --remote --json --command "${escaped}"`, {
    encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe']
  });
  const p = JSON.parse(r);
  return (Array.isArray(p) && p[0]?.results) ? p[0].results : [];
}

// Get D1 tables
console.log('Fetching D1 schema...');
const d1Tables = d1("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
  .map(r => r.name);
console.log(`D1 has ${d1Tables.length} tables`);

// Check which tables are missing
const missingTables = new Set();
for (const c of creates) {
  if (!d1Tables.includes(c.table)) missingTables.add(c.table);
}

// Check which columns are missing on existing tables
const missingCols = new Map();
for (const ac of addCols) {
  if (missingTables.has(ac.table)) continue; // Table will be created fresh
  if (!d1Tables.includes(ac.table)) continue; // Table doesn't exist yet
  
  const d1Cols = d1(`PRAGMA table_info(${ac.table})`);
  const existing = new Set(d1Cols.map(c => c.name));
  if (!existing.has(ac.column)) {
    if (!missingCols.has(ac.table)) missingCols.set(ac.table, []);
    missingCols.get(ac.table).push({ column: ac.column, type: ac.type });
  }
}

console.log(`Missing tables: ${missingTables.size}, Missing columns: ${[...missingCols.values()].reduce((s, v) => s + v.length, 0)}`);

// Build SQL
let sql = `-- D1 Schema Sync ${new Date().toISOString()}\n\n`;
let stmtCount = 0;

for (const c of creates) {
  if (missingTables.has(c.table)) {
    sql += `${c.sql}\n\n`;
    stmtCount++;
  }
}

for (const [table, cols] of missingCols) {
  sql += `-- ${table}: +${cols.length} columns\n`;
  for (const col of cols) {
    sql += `ALTER TABLE ${table} ADD COLUMN ${col.column} ${col.type};\n`;
    stmtCount++;
  }
  sql += '\n';
}

mkdirSync('server/migrations', { recursive: true });
writeFileSync('server/migrations/0001_sync_production.sql', sql);
console.log(`Written: ${sql.length} bytes, ${stmtCount} statements`);

// Now apply via wrangler --file
console.log('\nApplying migration...');
try {
  const result = execSync(
    'npx wrangler d1 execute rmpg-flex --remote --file=server/migrations/0001_sync_production.sql',
    { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  console.log('Migration applied successfully');
} catch (e) {
  console.error('Migration failed:', e.message);
  if (e.stderr) console.error(e.stderr.substring(0, 500));
}
