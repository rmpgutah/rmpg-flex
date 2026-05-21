// Syncs the D1 production schema by reading database.ts CREATE TABLE + addCol
// and applying any missing tables/columns to the remote D1 database.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const dbTs = readFileSync('server/src/models/database.ts', 'utf-8');

// Extract all CREATE TABLE IF NOT EXISTS statements
const createTableRegex = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/g;
const createStatements: { table: string; sql: string }[] = [];
let match;
while ((match = createTableRegex.exec(dbTs)) !== null) {
  const table = match[1];
  const fullSql = match[0];
  createStatements.push({ table, sql: fullSql });
}
console.log(`Found ${createStatements.length} CREATE TABLE statements`);

// Extract all addCol calls: addCol('tablename', 'columnname', 'TYPE')
const addColRegex = /addCol\(['"](\w+)['"],\s*['"](\w+)['"],\s*['"]([^'"]+)['"]\)/g;
const addCols: { table: string; column: string; type: string }[] = [];
while ((match = addColRegex.exec(dbTs)) !== null) {
  addCols.push({ table: match[1], column: match[2], type: match[3].replace(/\\'/g, "'") });
}
console.log(`Found ${addCols.length} addCol calls across ${new Set(addCols.map(a => a.table)).size} tables`);

// Extract CREATE INDEX statements
const createIndexRegex = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+ON\s+(\w+)/gi;
const indexes: string[] = [];
while ((match = createIndexRegex.exec(dbTs)) !== null) {
  indexes.push(match[0]);
}
console.log(`Found ${indexes.length} CREATE INDEX statements`);

// Query D1 for existing tables and columns
function d1Query(sql: string): any[] {
  const cmd = `npx wrangler d1 execute rmpg-flex --remote --command "${sql.replace(/"/g, '\\"')}" 2>&1`;
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    const lines = output.split('\n');
    const results: any[] = [];
    let inResults = false;
    for (const line of lines) {
      if (line.includes('"results":')) inResults = true;
      if (inResults && line.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(line.trim().replace(/,$/, ''));
          if (parsed.results) results.push(...parsed.results);
        } catch {}
      }
    }
    return results;
  } catch (e: any) {
    const stderr = e.stderr || '';
    // Parse D1 JSON output from stderr
    try {
      const lines = stderr.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed[0]?.results) {
              return parsed[0].results;
            }
          } catch {}
        }
      }
    } catch {}
    console.error(`D1 query failed: ${e.message}\n${stderr}`);
    return [];
  }
}

// Get all tables from D1
console.log('\nFetching D1 schema...');
const d1TablesRaw = d1Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
const d1Tables = d1TablesRaw.map((r: any) => r.name);
console.log(`D1 has ${d1Tables.length} tables`);

// For each table in our schema, check if it exists in D1
const missingTables: string[] = [];
const missingColumns: { table: string; column: string; type: string; addCol: boolean }[] = [];

for (const stmt of createStatements) {
  if (!d1Tables.includes(stmt.table)) {
    missingTables.push(stmt.table);
    console.log(`  MISSING TABLE: ${stmt.table}`);
    // Also add all columns from the CREATE TABLE + any addCols for this table
    const cols = addCols.filter(a => a.table === stmt.table);
    for (const col of cols) {
      missingColumns.push({ ...col, addCol: true });
    }
  } else {
    // Table exists - get its columns
    const cols = d1Query(`PRAGMA table_info(${stmt.table})`);
    const existingCols = cols.map((c: any) => c.name);
    
    // Check each addCol for this table
    const tableAddCols = addCols.filter(a => a.table === stmt.table);
    for (const col of tableAddCols) {
      if (!existingCols.includes(col.column)) {
        missingColumns.push({ ...col, addCol: true });
      }
    }
  }
}

console.log(`\nMissing tables: ${missingTables.length}`);
console.log(`Missing columns: ${missingColumns.length}`);

// Generate SQL
let sql = '-- Sync production D1 to match database.ts schema\n';
sql += '-- Generated: ' + new Date().toISOString() + '\n\n';

// CREATE TABLE statements for missing tables
for (const stmt of createStatements) {
  if (missingTables.includes(stmt.table)) {
    sql += `-- New table: ${stmt.table}\n`;
    sql += stmt.sql + '\n\n';
  }
}

// ALTER TABLE ADD COLUMN for missing columns
// Group by table for efficiency
const byTable = new Map<string, typeof missingColumns>();
for (const mc of missingColumns) {
  if (!byTable.has(mc.table)) byTable.set(mc.table, []);
  byTable.get(mc.table)!.push(mc);
}

for (const [table, cols] of byTable) {
  sql += `-- Missing columns for ${table}\n`;
  for (const col of cols) {
    const defVal = col.type.includes('DEFAULT') ? '' : (col.type.includes('TEXT') ? " DEFAULT ''" : (col.type.includes('INTEGER') ? ' DEFAULT 0' : (col.type.includes('REAL') ? ' DEFAULT 0.0' : '')));
    sql += `ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.type};\n`;
  }
  sql += '\n';
}

// Write the SQL file
const outputPath = 'server/migrations/0001_sync_production.sql';
const fs = require('fs');
if (!fs.existsSync('server/migrations')) fs.mkdirSync('server/migrations', { recursive: true });
fs.writeFileSync(outputPath, sql);
console.log(`\nMigration SQL written to ${outputPath}`);

// Also write a summary
let summary = `# D1 Schema Sync Summary\n\n`;
summary += `- Total CREATE TABLE statements: ${createStatements.length}\n`;
summary += `- Total addCol calls: ${addCols.length}\n`;
summary += `- D1 has ${d1Tables.length} tables\n`;
summary += `- Missing tables: ${missingTables.length}\n`;
summary += `- Missing columns: ${missingColumns.length}\n`;
summary += `\n## Missing Tables\n`;
for (const t of missingTables) summary += `- \`${t}\`\n`;
summary += `\n## Missing Columns by Table\n`;
for (const [table, cols] of byTable) {
  summary += `### ${table} (${cols.length} columns)\n`;
  for (const col of cols) summary += `- \`${col.column}\` ${col.type}\n`;
}
fs.writeFileSync('server/migrations/0001_summary.md', summary);
console.log(`Summary written to server/migrations/0001_summary.md`);
