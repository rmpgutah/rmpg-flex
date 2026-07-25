// ============================================================
// Dispatcher awareness — a failed warrant lookup must never be SPOKEN as a
// clearance.
// ============================================================
// lookupPerson's warrant query used `.catch(() => [])`, and the spoken text
// branched only on `warrants.length`. So any failure — including D1's 50-char
// LIKE pattern cap on a long subject name — was read aloud as "No active
// warrants on file." That is an audible false clear on warrant status.
//
// Uses the same hand-rolled D1 double as tests/aiDispatcherSafety.test.ts, with
// the ability to make a specific query throw.
// ============================================================

import { describe, it, expect } from 'vitest';
import { runLookup } from '../src/utils/dispatcherAwareness';

type Row = Record<string, unknown>;

/** D1 double. `throwOn` makes any matching SQL reject, like a real D1 error. */
function fakeDb(canned: { match: RegExp; rows: Row[] }[], throwOn?: RegExp) {
  const resultsFor = (sql: string) => {
    for (const c of canned) if (c.match.test(sql)) return c.rows;
    return [];
  };
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: (..._a: unknown[]) => stmt,
        all: async () => {
          if (throwOn?.test(sql)) {
            throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');
          }
          return { results: resultsFor(sql) };
        },
        first: async () => {
          if (throwOn?.test(sql)) {
            throw new Error('D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR');
          }
          return resultsFor(sql)[0] ?? null;
        },
        run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
      };
      return stmt;
    },
  };
  return db as unknown as import('@cloudflare/workers-types').D1Database;
}

const PERSON = [{
  id: 42, first_name: 'John', last_name: 'Doe', dob: '1990-01-01',
  flags: null, caution_flags: null, is_sex_offender: 0, gang_affiliation: null,
}];

const env = {} as any;

describe('person lookup — warrant leg failure', () => {
  it('does NOT speak "no active warrants" when the warrant query fails', async () => {
    const db = fakeDb(
      [{ match: /FROM persons/, rows: PERSON }],
      /FROM warrants/,           // the warrant leg throws
    );
    const res = await runLookup(env, db, { type: 'person', query: 'John Doe' });
    const text = res?.text ?? '';

    expect(text).not.toMatch(/No active warrants/i);
    expect(text).toMatch(/WARRANT CHECK FAILED/);
    expect(text).toMatch(/UNKNOWN/);
    expect(text).toMatch(/Verify manually/i);
  });

  it('still identifies the subject so the lookup is not useless', async () => {
    const db = fakeDb([{ match: /FROM persons/, rows: PERSON }], /FROM warrants/);
    const res = await runLookup(env, db, { type: 'person', query: 'John Doe' });
    expect(res?.text).toMatch(/John Doe/);
    expect(res?.record).toEqual({ kind: 'person', id: 42 });
  });

  it('a genuinely clear subject IS still reported as clear', async () => {
    // No throw — the warrant query runs and legitimately returns nothing.
    const db = fakeDb([{ match: /FROM persons/, rows: PERSON }]);
    const res = await runLookup(env, db, { type: 'person', query: 'John Doe' });
    expect(res?.text).toMatch(/No active warrants on file/);
    expect(res?.text).not.toMatch(/FAILED/);
  });

  it('an actual warrant hit is still announced', async () => {
    const db = fakeDb([
      { match: /FROM persons/, rows: PERSON },
      { match: /FROM warrants/, rows: [{ warrant_number: 'W-123', offense: 'Theft', status: 'active' }] },
    ]);
    const res = await runLookup(env, db, { type: 'person', query: 'John Doe' });
    expect(res?.text).toMatch(/ACTIVE WARRANT/);
    expect(res?.text).toMatch(/W-123/);
    expect(res?.text).toMatch(/Confirm before action/i);
  });
});

describe('the warrant name match is D1-safe', () => {
  it('uses instr(), so a long subject name cannot trip the LIKE cap', async () => {
    let seenSql = '';
    const db = {
      prepare(sql: string) {
        if (/FROM warrants/.test(sql)) seenSql = sql;
        const stmt = {
          bind: (..._a: unknown[]) => stmt,
          all: async () => ({ results: [] }),
          first: async () => (/FROM persons/.test(sql) ? PERSON[0] : null),
          run: async () => ({ meta: { changes: 0, last_row_id: 0 } }),
        };
        return stmt;
      },
    } as unknown as import('@cloudflare/workers-types').D1Database;

    await runLookup(env, db, { type: 'person', query: 'John Doe' });
    expect(seenSql).toContain('instr(');
    expect(seenSql).not.toMatch(/subject_name LIKE/);
  });
});
