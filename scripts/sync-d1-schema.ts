import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const dbTs = readFileSync('server/src/models/database.ts', 'utf-8');

// Extract CREATE TABLE statements
const createTableRegex = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/g;
const createStatements: { table: string; sql: string }[] = [];
let match;
while ((match = createTableRegex.exec(dbTs)) !== null) {
  createStatements.push({ table: match[1], sql: match[0] });
}
console.log(`Found ${createStatements.length} CREATE TABLE statements`);

// Extract addCol calls
const addColRegex = /addCol\(['"](\w+)['"],\s*['"](\w+)['"],\s*['"]?([^"']+?)['"]?\s*(?:,\s*[^)]+)?\s*\)/g;
const addCols: { table: string; column: string; type: string }[] = [];
while ((match = addColRegex.exec(dbTs)) !== null) {
  let type = match[3].replace(/DEFAULT\s+.*$/, '').trim();
  addCols.push({ table: match[1], column: match[2], type });
}
console.log(`Found ${addCols.length} addCol calls across ${new Set(addCols.map(a => a.table)).size} tables`);

// Query D1 using --json flag
function d1Query(sql: string): any[] {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute rmpg-flex --remote --json --command "${escaped}"`;
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed) && parsed[0]?.results) return parsed[0].results;
    return [];
  } catch (e: any) {
    // Try parsing stdout even on error
    if (e.stdout) {
      try { const p = JSON.parse(e.stdout); if (Array.isArray(p) && p[0]?.results) return p[0].results; } catch {}
    }
    console.error(`D1 query failed: ${e.message}`);
    return [];
  }
}

// Get D1 tables
console.log('\nFetching D1 schema...');
const d1TablesRaw = d1Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
const d1Tables = d1TablesRaw.map((r: any) => r.name);
console.log(`D1 has ${d1Tables.length} tables`);

// Build list of all expected columns per table from CREATE TABLE + addCol
const expectedColumns = new Map<string, Map<string, string>>();
for (const stmt of createStatements) {
  if (!expectedColumns.has(stmt.table)) expectedColumns.set(stmt.table, new Map());
}
for (const col of addCols) {
  if (!expectedColumns.has(col.table)) expectedColumns.set(col.table, new Map());
  expectedColumns.get(col.table)!.set(col.column, col.type);
}

// Check D1 for missing tables and columns
const missingTables: string[] = [];
const missingColsByTable = new Map<string, { column: string; type: string }[]>();

for (const [table, cols] of expectedColumns) {
  if (!d1Tables.includes(table)) {
    missingTables.push(table);
    const allCols: { column: string; type: string }[] = [];
    for (const [col, type] of cols) allCols.push({ column: col, type });
    missingColsByTable.set(table, allCols);
  } else {
    const d1Cols = d1Query(`PRAGMA table_info(${table})`);
    const existingColNames = new Set(d1Cols.map((c: any) => c.name));
    for (const [col, type] of cols) {
      if (!existingColNames.has(col)) {
        if (!missingColsByTable.has(table)) missingColsByTable.set(table, []);
        missingColsByTable.get(table)!.push({ column: col, type });
      }
    }
  }
}

console.log(`Missing tables: ${missingTables.length}`);
console.log(`Missing columns across existing tables: ${Array.from(missingColsByTable.values()).filter(v => !missingTables.includes('')).reduce((s, v) => s + v.length, 0)}`);

// Generate SQL
let sql = '-- Sync production D1 to match database.ts schema\n';
sql += '-- Generated: ' + new Date().toISOString() + '\n\n';

// CREATE TABLE for missing tables
for (const stmt of createStatements) {
  if (missingTables.includes(stmt.table)) {
    sql += `-- New table: ${stmt.table}\n`;
    sql += stmt.sql + '\n\n';
  }
}

// ALTER TABLE ADD COLUMN
for (const [table, cols] of missingColsByTable) {
  if (missingTables.includes(table)) continue; // Skip - table will be created fresh
  sql += `-- Missing columns for ${table} (${cols.length})\n`;
  for (const col of cols) {
    sql += `ALTER TABLE ${table} ADD COLUMN ${col.column} ${col.type};\n`;
  }
  sql += '\n';
}

// Write output
if (!existsSync('server/migrations')) mkdirSync('server/migrations', { recursive: true });
writeFileSync('server/migrations/0001_sync_production.sql', sql);
console.log(`\nMigration SQL written to server/migrations/0001_sync_production.sql`);
console.log(`Total SQL size: ${sql.length} bytes`);
