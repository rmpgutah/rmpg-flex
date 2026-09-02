// ============================================================
// RMPG Flex — Daily Email: recipient list configuration
// ============================================================
// Recipients are stored in system_config (category 'daily_email').
// Three keys:
//   daily_email_recipients  — comma-separated email addresses
//   daily_email_enabled     — '1' or '0'
//   daily_email_include_pdf — '1' or '0' (default '1')
//
// No UNIQUE constraint on system_config.config_key, so writes use
// update-then-insert upsert pattern (matching the existing convention
// in email.ts, integrations.ts, admin.ts).
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { queryFirst, execute } from '../db';

const CATEGORY = 'daily_email';

const KEYS = {
  recipients: 'daily_email_recipients',
  enabled: 'daily_email_enabled',
  includePdf: 'daily_email_include_pdf',
} as const;

// ── Read helpers ──────────────────────────────────────────

async function getVal(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(
    db,
    `SELECT config_value FROM system_config
      WHERE config_key = ? AND category = ? AND is_active = 1
      LIMIT 1`,
    key, CATEGORY,
  );
  return row?.config_value ?? null;
}

export async function getRecipients(db: D1Database): Promise<string[]> {
  const raw = await getVal(db, KEYS.recipients);
  if (!raw) return [];
  return raw
    .split(/[,;]\s*/)
    .map((s) => s.trim())
    .filter((s) => s && /@/.test(s));
}

export async function isEnabled(db: D1Database): Promise<boolean> {
  const v = await getVal(db, KEYS.enabled);
  return v === '1';
}

export async function includePdf(db: D1Database): Promise<boolean> {
  const v = await getVal(db, KEYS.includePdf);
  // Default to true when unset.
  return v !== '0';
}

// ── Write helpers ─────────────────────────────────────────

async function upsertConfig(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  // system_config has no UNIQUE(config_key) on live — update-then-insert.
  const existing = await queryFirst<{ id: number }>(
    db,
    'SELECT id FROM system_config WHERE config_key = ? LIMIT 1',
    key,
  );
  if (existing) {
    await execute(
      db,
      `UPDATE system_config
          SET config_value = ?, is_active = 1, updated_at = datetime('now')
        WHERE config_key = ?`,
      value, key,
    );
  } else {
    await execute(
      db,
      `INSERT INTO system_config
          (config_key, config_value, category, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
      key, value, CATEGORY,
    );
  }
}

export async function setRecipients(
  db: D1Database,
  emails: string[],
): Promise<void> {
  const cleaned = emails
    .map((s) => s.trim())
    .filter((s) => s && /@/.test(s));
  await upsertConfig(db, KEYS.recipients, cleaned.join(', '));
}

export async function setEnabled(
  db: D1Database,
  enabled: boolean,
): Promise<void> {
  await upsertConfig(db, KEYS.enabled, enabled ? '1' : '0');
}

export async function setIncludePdf(
  db: D1Database,
  include: boolean,
): Promise<void> {
  await upsertConfig(db, KEYS.includePdf, include ? '1' : '0');
}

// ── Bulk config read/write ────────────────────────────────

export interface DailyEmailConfig {
  enabled: boolean;
  recipients: string[];
  includePdf: boolean;
}

export async function getConfig(db: D1Database): Promise<DailyEmailConfig> {
  const [enabled, recipients, includePdfVal] = await Promise.all([
    isEnabled(db),
    getRecipients(db),
    includePdf(db),
  ]);
  return { enabled, recipients, includePdf: includePdfVal };
}

export async function setConfig(
  db: D1Database,
  config: Partial<DailyEmailConfig>,
): Promise<DailyEmailConfig> {
  if (config.enabled !== undefined) await setEnabled(db, config.enabled);
  if (config.recipients !== undefined) await setRecipients(db, config.recipients);
  if (config.includePdf !== undefined) await setIncludePdf(db, config.includePdf);
  return getConfig(db);
}
