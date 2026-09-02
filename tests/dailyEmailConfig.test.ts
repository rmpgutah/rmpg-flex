import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRecipients, isEnabled, includePdf,
  setRecipients, setEnabled, setIncludePdf,
  getConfig, setConfig,
  type DailyEmailConfig,
} from '../src/utils/dailyEmail/config';

// Stub D1 — records calls, returns canned rows.
function makeDb(rows: { id?: number; config_value?: string }[] = []) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const ctx = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async first<T>(): Promise<T | null> {
          calls.push(ctx);
          return (rows[0] as T) ?? null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          calls.push(ctx);
          return { results: rows as T[] };
        },
        async run(): Promise<{ success: boolean }> {
          calls.push(ctx);
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof getRecipients>[0];
  return { db, calls };
}

describe('dailyEmail/config', () => {
  describe('getRecipients', () => {
    it('returns empty array when no config exists', async () => {
      const { db } = makeDb([]);
      const result = await getRecipients(db);
      expect(result).toEqual([]);
    });

    it('parses comma-separated emails', async () => {
      const { db } = makeDb([{ config_value: 'a@test.com, b@test.com, c@test.com' }]);
      const result = await getRecipients(db);
      expect(result).toEqual(['a@test.com', 'b@test.com', 'c@test.com']);
    });

    it('filters out invalid entries', async () => {
      const { db } = makeDb([{ config_value: 'valid@test.com, notanemail, also-valid@ok.org' }]);
      const result = await getRecipients(db);
      expect(result).toEqual(['valid@test.com', 'also-valid@ok.org']);
    });
  });

  describe('isEnabled', () => {
    it('returns false when config is "0"', async () => {
      const { db } = makeDb([{ config_value: '0' }]);
      expect(await isEnabled(db)).toBe(false);
    });

    it('returns true when config is "1"', async () => {
      const { db } = makeDb([{ config_value: '1' }]);
      expect(await isEnabled(db)).toBe(true);
    });

    it('returns false when no config exists', async () => {
      const { db } = makeDb([]);
      expect(await isEnabled(db)).toBe(false);
    });
  });

  describe('includePdf', () => {
    it('returns true when config is "1"', async () => {
      const { db } = makeDb([{ config_value: '1' }]);
      expect(await includePdf(db)).toBe(true);
    });

    it('returns false when config is "0"', async () => {
      const { db } = makeDb([{ config_value: '0' }]);
      expect(await includePdf(db)).toBe(false);
    });

    it('returns true by default (unset)', async () => {
      const { db } = makeDb([]);
      expect(await includePdf(db)).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('returns full config object', async () => {
      const calls: { sql: string; bindings: unknown[] }[] = [];
      const configRows: Record<string, string> = {
        daily_email_recipients: 'admin@test.com',
        daily_email_enabled: '1',
        daily_email_include_pdf: '0',
      };
      const db = {
        prepare(sql: string) {
          const ctx = { sql, bindings: [] as unknown[] };
          const stmt = {
            bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
            async first<T>(): Promise<T | null> {
              calls.push(ctx);
              // Extract config_key from the SQL bindings
              const key = ctx.bindings[0] as string;
              const val = configRows[key];
              return (val !== undefined ? { config_value: val } : null) as T;
            },
            async all<T>(): Promise<{ results: T[] }> { return { results: [] as T[] }; },
            async run(): Promise<{ success: boolean }> { return { success: true }; },
          };
          return stmt;
        },
      } as unknown as Parameters<typeof getConfig>[0];

      const config = await getConfig(db);
      expect(config.enabled).toBe(true);
      expect(config.recipients).toEqual(['admin@test.com']);
      expect(config.includePdf).toBe(false);
    });
  });
});
