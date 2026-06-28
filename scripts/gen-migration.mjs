import { readFileSync, writeFileSync, mkdirSync } from 'fs';

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

console.log(`Found: ${creates.length} tables, ${addCols.length} addCols`);

// Build: all CREATE TABLE + all ALTER TABLE for addCols per table
let sql = `-- D1 Schema Sync ${new Date().toISOString()}\n\n`;
sql += `-- Tables: ${creates.length}, Columns: ${addCols.length}\n\n`;

let stmtCount = 0;

// CREATE TABLE statements (these are idempotent with IF NOT EXISTS)
for (const c of creates) {
  sql += `${c.sql}\n\n`;
  stmtCount++;
}

// Group addCols by table
const byTable = new Map();
for (const ac of addCols) {
  if (!byTable.has(ac.table)) byTable.set(ac.table, []);
  byTable.get(ac.table).push(ac);
}

// ALTER TABLE statements
for (const [table, cols] of byTable) {
  sql += `-- ${table}: add ${cols.length} missing columns\n`;
  for (const col of cols) {
    sql += `ALTER TABLE ${table} ADD COLUMN ${col.column} ${col.type};\n`;
    stmtCount++;
  }
  sql += '\n';
}

mkdirSync('server/migrations', { recursive: true });
writeFileSync('server/migrations/0001_full_sync.sql', sql);
console.log(`Written: ${sql.length} bytes, ${stmtCount} statements`);
console.log('File: server/migrations/0001_full_sync.sql');
