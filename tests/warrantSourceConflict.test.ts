// ============================================================
// Utah poller — flag manual/state warrant disagreements, never overwrite
// ============================================================
// The poller matched existing rows ONLY on its own scraped identity
// (external_warrant_id + external_source_key). A manually-entered row carrying
// the same warrant number WITHOUT the `UTW-` prefix was invisible to it, so the
// two rows for one real warrant coexisted and drifted apart.
//
// Found live 2026-08-01: warrants 3149919 and 3155534 each had a UTW- twin with
// the SAME issued_date and issuing_court, while the manual rows read 'active'
// and the state read 'recalled' with last_check_result='cleared'. Two of the 23
// warrants the system reported ACTIVE had been recalled by Utah — an officer
// running those subjects would see a warrant the state no longer holds.
//
// POLICY PINNED HERE: flag, never auto-overwrite. A scraper must not silently
// replace an officer-entered status. The disagreement is recorded for a human.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const poller = readFileSync(join(__dirname, '..', 'src', 'utils', 'utahWarrantPoller.ts'), 'utf8');
// Comments in this file describe the very constructs under test, so strip them:
// asserting against raw source would stay green on prose alone.
const code = poller.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');

const migration = readFileSync(
  join(__dirname, '..', 'migrations', '0220_warrant_source_conflicts.sql'), 'utf8',
);

describe('conflict detection is wired into the sync path', () => {
  it('runs after the scraped row is upserted', () => {
    expect(code).toContain('await recordSourceConflict(db, w)');
  });

  it('is best-effort — a failure cannot abort the scan', () => {
    const fn = code.slice(code.indexOf('async function recordSourceConflict'));
    expect(fn.slice(0, 3000)).toContain('catch (err)');
  });
});

describe('the officer-entered status is never overwritten', () => {
  const fn = code.slice(code.indexOf('async function recordSourceConflict'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  it('issues no UPDATE against the warrants table', () => {
    // The whole point of the chosen policy. An UPDATE ... warrants here would
    // silently replace a human's entry with a scraper's.
    expect(body).not.toMatch(/UPDATE\s+warrants/i);
  });

  it('only writes to the conflicts table', () => {
    expect(body).toContain('INSERT INTO warrant_source_conflicts');
  });
});

describe('matching is conservative enough not to fabricate conflicts', () => {
  const fn = code.slice(code.indexOf('async function recordSourceConflict'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);

  it('requires corroboration beyond the bare number', () => {
    // Warrant numbering is only unique per issuing court, so number-alone
    // matching would link unrelated warrants across jurisdictions.
    expect(body).toContain('issued_date = ?');
    expect(body).toMatch(/issuing_court/);
  });

  it('compares courts case-insensitively', () => {
    // Live data had "Davis County Justice Cou" against "DAVIS COUNTY JUSTICE COU".
    expect(body).toMatch(/UPPER\(TRIM\(COALESCE\(issuing_court/);
  });

  it('excludes the scraper\'s own rows from the "manual" side', () => {
    expect(body).toContain('external_source_key != ?');
    expect(body).toContain('id != ?');
  });

  it('records nothing when the two sides agree', () => {
    expect(body).toContain('local.status === scraped.status');
  });
});

describe('re-detection refreshes rather than stacking rows', () => {
  it('upserts on the pair', () => {
    // The poller is on a cron; without this an open conflict would insert a new
    // row every cycle.
    expect(code).toContain('ON CONFLICT(local_warrant_id, scraped_warrant_id) DO UPDATE SET');
  });

  it('the migration provides the unique index that upsert depends on', () => {
    // ON CONFLICT(cols) requires a matching unique index or it throws at runtime.
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_warrant_conflicts_pair\s+ON warrant_source_conflicts\(local_warrant_id, scraped_warrant_id\)/,
    );
  });

  it('supports resolution so a reviewed conflict stops re-alerting', () => {
    for (const col of ['resolved_at', 'resolved_by', 'resolution_note']) {
      expect(migration).toContain(col);
    }
  });
});
