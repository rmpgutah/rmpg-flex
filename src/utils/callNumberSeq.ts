// Shared CFS call-number generation. One canonical implementation used by
// manual call creation, panic-triggered calls, and call splitting — these
// previously had three divergent implementations (calls.ts used an
// unrelated AUTOINCREMENT `call_number_seq` table that could restart
// numbering at CFS{YY}-00001 even when higher-numbered rows already
// existed for the year; panic.ts and the split endpoint each hand-rolled
// a MAX(call_number)+1 read with no retry on collision).
//
// Format: CFS{YY}-{NNNNN}, 5-digit sequence, resets each calendar year
// (Denver-zone year, not the UTC Workers host's — avoids rolling the
// prefix ~5-7pm MT on Dec 31). Numbering always continues from the
// highest existing call_number for that year's prefix.
import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';

export function currentCallNumberPrefix(): string {
  const year = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', year: 'numeric' }).slice(-2);
  return `CFS${year}-`;
}

export async function nextCallNumber(db: D1Database, prefix: string): Promise<string> {
  const rows = await query<{ max: string | null }>(
    db, 'SELECT MAX(call_number) as max FROM calls_for_service WHERE call_number LIKE ?', `${prefix}%`,
  );
  const max = rows[0]?.max ?? null;
  const seq = max ? String(parseInt(max.slice(prefix.length), 10) + 1).padStart(5, '0') : '00001';
  return `${prefix}${seq}`;
}

function isCallNumberConflict(err: unknown): boolean {
  const raw = String((err as Error)?.message ?? err);
  return /SQLITE_CONSTRAINT/i.test(raw) && /call_number/i.test(raw);
}

/**
 * Generates a call number and hands it to `attempt`. If `attempt` throws a
 * UNIQUE-constraint error on call_number (a concurrent request grabbed the
 * same number), regenerates and retries up to `maxAttempts` times.
 */
export async function withNextCallNumber<T>(
  db: D1Database,
  prefix: string,
  attempt: (callNumber: string) => Promise<T>,
  maxAttempts = 5,
): Promise<{ result: T; callNumber: string }> {
  let callNumber = await nextCallNumber(db, prefix);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await attempt(callNumber);
      return { result, callNumber };
    } catch (err) {
      if (i < maxAttempts - 1 && isCallNumberConflict(err)) {
        callNumber = await nextCallNumber(db, prefix);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to generate a unique call number');
}
