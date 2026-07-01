import { execute, query } from './db';
import { log } from './logger';

const FTS_TABLES: Record<string, {
  columns: string[];
  contentTable: string;
  contentRowid: string;
  tokenizer: string;
}> = {
  persons_fts: {
    columns: ['first_name', 'last_name', 'dob', 'phone', 'address'],
    contentTable: 'persons',
    contentRowid: 'id',
    tokenizer: 'porter unicode61',
  },
  cases_fts: {
    columns: ['case_number', 'title', 'description', 'summary', 'narrative'],
    contentTable: 'cases',
    contentRowid: 'id',
    tokenizer: 'porter unicode61',
  },
};

function isCorruptVtab(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('SQLITE_CORRUPT') || msg.includes('corrupt') || msg.includes('malformed');
}

export async function rebuildFtsTable(db: D1Database, ftsTable: string): Promise<boolean> {
  const config = FTS_TABLES[ftsTable];
  if (!config) {
    log.error('[repairFts] Unknown FTS table', { ftsTable });
    return false;
  }

  try {
    const cols = config.columns.join(', ');
    const triggerCols = config.columns.map(c => `new.${c}`).join(', ');
    const oldCols = config.columns.map(c => `old.${c}`).join(', ');

    const ddl = `
      DROP TABLE IF EXISTS ${ftsTable};
      CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable} USING fts5(
        ${config.columns.join(', ')},
        content='${config.contentTable}',
        content_rowid='${config.contentRowid}',
        tokenize='${config.tokenizer}'
      );

      CREATE TRIGGER IF NOT EXISTS ${config.contentTable}_ai AFTER INSERT ON ${config.contentTable} BEGIN
        INSERT INTO ${ftsTable}(rowid, ${cols}) VALUES (new.${config.contentRowid}, ${triggerCols});
      END;

      CREATE TRIGGER IF NOT EXISTS ${config.contentTable}_ad AFTER DELETE ON ${config.contentTable} BEGIN
        INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${cols}) VALUES ('delete', old.${config.contentRowid}, ${oldCols});
      END;

      CREATE TRIGGER IF NOT EXISTS ${config.contentTable}_au AFTER UPDATE ON ${config.contentTable} BEGIN
        INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${cols}) VALUES ('delete', old.${config.contentRowid}, ${oldCols});
        INSERT INTO ${ftsTable}(rowid, ${cols}) VALUES (new.${config.contentRowid}, ${triggerCols});
      END;

      INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild');
    `;

    const statements = ddl.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.prepare(stmt + ';').run();
    }

    log.info('[repairFts] Rebuilt', { ftsTable });
    return true;
  } catch (err) {
    log.error('[repairFts] Failed to rebuild', { ftsTable }, err);
    return false;
  }
}

export async function tryRepairAndRetry<T>(
  db: D1Database,
  fn: () => Promise<T>,
  ftsTable: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isCorruptVtab(err)) {
      log.warn('[repairFts] Corrupt FTS detected, attempting repair', { ftsTable });
      const ok = await rebuildFtsTable(db, ftsTable);
      if (ok) {
        return await fn();
      }
    }
    throw err;
  }
}

export async function repairAllFtsTables(db: D1Database): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [];
  const failed: string[] = [];
  for (const name of Object.keys(FTS_TABLES)) {
    const result = await rebuildFtsTable(db, name);
    if (result) ok.push(name);
    else failed.push(name);
  }
  return { ok, failed };
}
