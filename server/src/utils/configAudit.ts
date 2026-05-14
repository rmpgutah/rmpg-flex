// Improvement 70: Configuration change audit logger
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import { logger } from './logger';

/** Log a configuration change */
export function auditConfigChange(
  userId: number,
  username: string,
  key: string,
  oldValue: string | null,
  newValue: string | null,
  source: string = 'api'
): void {
  try {
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS config_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        config_key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source TEXT DEFAULT 'api',
        changed_at TEXT NOT NULL
      )
    `).run();
    
    db.prepare(
      'INSERT INTO config_audit_log (user_id, username, config_key, old_value, new_value, source, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, username, key, oldValue, newValue, source, localNow());
    
    logger.info({ userId, username, key, source }, 'Configuration changed');
  } catch (err) {
    logger.error({ err }, 'Failed to audit config change');
  }
}

/** Get configuration change history */
export function getConfigAuditLog(limit = 50): Array<{
  id: number;
  userId: number;
  username: string;
  configKey: string;
  oldValue: string | null;
  newValue: string | null;
  source: string;
  changedAt: string;
}> {
  try {
    const db = getDb();
    return db.prepare(
      `SELECT id, user_id as userId, username, config_key as configKey, 
              old_value as oldValue, new_value as newValue, source, changed_at as changedAt
       FROM config_audit_log ORDER BY id DESC LIMIT ?`
    ).all(limit) as any[];
  } catch {
    return [];
  }
}
