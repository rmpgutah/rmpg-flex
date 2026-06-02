import { describe, it, expect } from 'vitest';
import { recordingDb } from '../helpers/fakeD1';
import { upsertScrapedWarrant, markScrapedCleared } from '../../src/utils/warrantSources/store';
import type { RawWarrantHit } from '../../src/utils/warrantSources/types';

const hit: RawWarrantHit = { source_key: 'ada-county-id', warrant_id: 'W1', last_name: 'Smith', first_name: 'John', charge_description: 'BATTERY', state: 'ID' };

describe('upsertScrapedWarrant', () => {
  it('INSERTs a new row keyed on (source_key, warrant_id) when none exists', async () => {
    const { db, calls } = recordingDb([]); // SELECT returns nothing => insert path
    await upsertScrapedWarrant(db, hit, 42);
    const insert = calls.find(c => /INSERT INTO scraped_warrants/i.test(c.sql));
    expect(insert).toBeTruthy();
    // binds include the source_key, warrant_id, and person_id
    expect(insert!.args).toContain('ada-county-id');
    expect(insert!.args).toContain('W1');
    expect(insert!.args).toContain(42);
  });

  it('UPDATEs when a row already exists for (source_key, warrant_id)', async () => {
    const { db, calls } = recordingDb([{ match: /SELECT id FROM scraped_warrants/i, rows: [{ id: 5 }] }]);
    await upsertScrapedWarrant(db, hit, 42);
    expect(calls.some(c => /UPDATE scraped_warrants/i.test(c.sql))).toBe(true);
    expect(calls.some(c => /INSERT INTO scraped_warrants/i.test(c.sql))).toBe(false);
  });

  it('is null-safe on missing hit fields (no person_id, sparse hit)', async () => {
    const sparse: RawWarrantHit = { source_key: 'natrona-county-wy', warrant_id: 'X9' };
    const { db, calls } = recordingDb([]);
    await upsertScrapedWarrant(db, sparse, null);
    const insert = calls.find(c => /INSERT INTO scraped_warrants/i.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert!.args).toContain('natrona-county-wy');
    expect(insert!.args).toContain('X9');
    // person_id null, plus every absent field coerced to null (never undefined)
    expect(insert!.args.every(a => a !== undefined)).toBe(true);
  });
});

describe('markScrapedCleared', () => {
  it('clears using datetime() on BOTH sides (guards the format-mismatch bug)', async () => {
    const { db, calls } = recordingDb([]);
    const n = await markScrapedCleared(db, 'ada-county-id', '2026-06-02T04:00:00.000Z');
    const upd = calls.find(c => /UPDATE scraped_warrants SET status='cleared'/i.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd!.sql).toMatch(/datetime\(last_seen_at\)\s*<\s*datetime\(\?\)/i);
    expect(upd!.args).toContain('ada-county-id');
    expect(typeof n).toBe('number');
  });

  it('scopes the clear to ONE source_key and only active rows', async () => {
    const { db, calls } = recordingDb([]);
    await markScrapedCleared(db, 'natrona-county-wy', '2026-06-02T04:00:00.000Z');
    const upd = calls.find(c => /UPDATE scraped_warrants SET status='cleared'/i.test(c.sql));
    expect(upd!.sql).toMatch(/source_key\s*=\s*\?/i);
    expect(upd!.sql).toMatch(/status\s*=\s*'active'/i);
    expect(upd!.args).toContain('natrona-county-wy');
  });
});
