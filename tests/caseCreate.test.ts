// ============================================================
// caseCreate.ts — pure-DB Case File creation helper
// ============================================================
// Verifies the contract that commitIntake (and any future caller)
// relies on:
//   1. Case insert with the right defaults (status='open', priority
//      derived from case_type when not overridden, opened_date=today)
//   2. Junction writes happen in the right order with the right args
//   3. Junction writes are best-effort: a thrown UPDATE/INSERT on
//      legacy D1 (missing column or table) must not abort the case
//      itself, and the function must still return {case_id, case_number}
//   4. generateCaseNumber follows the YY-NNNNNN-XX format and
//      increments off the most recent case for the current year
// ============================================================

import { describe, it, expect } from 'vitest';
import { recordingDb } from './helpers/fakeD1';
import {
  createCaseWithLinks,
  generateCaseNumber,
  autoCasePriority,
  caseTypeCode,
} from '../src/utils/caseCreate';

describe('caseTypeCode', () => {
  it('maps known types to their 2-letter code', () => {
    expect(caseTypeCode('service')).toBe('SV');
    expect(caseTypeCode('criminal')).toBe('CR');
    expect(caseTypeCode('property')).toBe('PR');
  });
  it('falls back to GN for unknown types', () => {
    expect(caseTypeCode('not-a-real-type')).toBe('GN');
    expect(caseTypeCode('')).toBe('GN');
  });
});

describe('autoCasePriority', () => {
  it('returns critical for high-severity types', () => {
    expect(autoCasePriority('death')).toBe('critical');
    expect(autoCasePriority('assault')).toBe('critical');
  });
  it('returns high for elevated types', () => {
    expect(autoCasePriority('burglary')).toBe('high');
    expect(autoCasePriority('domestic')).toBe('high');
  });
  it('returns low for admin/civil/property/other', () => {
    expect(autoCasePriority('admin')).toBe('low');
    expect(autoCasePriority('civil')).toBe('low');
  });
  it('returns normal for service (the auto-intake default)', () => {
    expect(autoCasePriority('service')).toBe('normal');
  });
});

describe('generateCaseNumber', () => {
  it('formats as YY-NNNNNN-XX with sequence starting at 1 when no prior case', async () => {
    const { db } = recordingDb([]);
    const yy = String(new Date().getFullYear()).slice(-2);
    const num = await generateCaseNumber(db, 'service');
    expect(num).toBe(`${yy}-000001-SV`);
  });
  it('increments the sequence from the most recent case for the year', async () => {
    const yy = String(new Date().getFullYear()).slice(-2);
    const { db } = recordingDb([
      { match: /SELECT case_number FROM cases/, rows: [{ case_number: `${yy}-000041-CR` }] },
    ]);
    expect(await generateCaseNumber(db, 'service')).toBe(`${yy}-000042-SV`);
  });
});

describe('createCaseWithLinks', () => {
  it('inserts a case row and returns the new id + case_number', async () => {
    const { db, calls } = recordingDb([]);
    const res = await createCaseWithLinks(db, {
      title: 'Service: Jane Doe — Subpoena',
      case_type: 'service',
      summary: 'Civil packet',
      created_by: 7,
    });
    expect(res.case_id).toBeGreaterThan(0);
    expect(res.case_number).toMatch(/^\d{2}-\d{6}-SV$/);
    const insertCall = calls.find((c) => /INSERT INTO cases/.test(c.sql));
    expect(insertCall).toBeDefined();
    // status='open' is a SQL literal (not bound), so args are:
    // [case_number, title, case_type, priority, summary, linked_calls, linked_persons, created_by]
    expect(insertCall!.args[3]).toBe('normal'); // priority
    expect(insertCall!.args[4]).toBe('Civil packet'); // summary
    expect(insertCall!.args[7]).toBe(7); // created_by
  });

  it('writes case_calls + calls_for_service UPDATE when linked_call_id present', async () => {
    const { db, calls } = recordingDb([]);
    await createCaseWithLinks(db, {
      title: 't', created_by: 1,
      linked_call_id: 99,
    });
    expect(calls.some((c) =>
      /UPDATE calls_for_service SET case_id = \?, case_number = \? WHERE id = \?/.test(c.sql)
      && c.args[2] === 99,
    )).toBe(true);
    expect(calls.some((c) =>
      /INSERT OR IGNORE INTO case_calls/.test(c.sql) && c.args[1] === 99,
    )).toBe(true);
  });

  it('writes case_person_links with relationship for each linked person', async () => {
    const { db, calls } = recordingDb([]);
    await createCaseWithLinks(db, {
      title: 't', created_by: 1,
      linked_persons: [
        { person_id: 11, relationship: 'serve_recipient' },
        { person_id: 22, relationship: 'serve_recipient_agent' },
      ],
    });
    const personInserts = calls.filter((c) => /INSERT OR IGNORE INTO case_person_links/.test(c.sql));
    expect(personInserts).toHaveLength(2);
    expect(personInserts[0].args).toEqual([expect.any(Number), 11, 'serve_recipient']);
    expect(personInserts[1].args).toEqual([expect.any(Number), 22, 'serve_recipient_agent']);
  });

  it('writes case_properties for linked_property_id', async () => {
    const { db, calls } = recordingDb([]);
    await createCaseWithLinks(db, {
      title: 't', created_by: 1,
      linked_property_id: 55,
    });
    expect(calls.some((c) =>
      /INSERT OR IGNORE INTO case_properties/.test(c.sql) && c.args[1] === 55,
    )).toBe(true);
  });

  it('dual-writes case_serve_jobs + serve_queue.case_id when linked_serve_queue_id present', async () => {
    const { db, calls } = recordingDb([]);
    const res = await createCaseWithLinks(db, {
      title: 't', created_by: 1,
      linked_serve_queue_id: 1234,
    });
    expect(calls.some((c) =>
      /INSERT OR IGNORE INTO case_serve_jobs/.test(c.sql) && c.args[1] === 1234,
    )).toBe(true);
    expect(calls.some((c) =>
      /UPDATE serve_queue SET case_id = \? WHERE id = \?/.test(c.sql)
      && c.args[0] === res.case_id && c.args[1] === 1234,
    )).toBe(true);
  });

  it('logs case.created activity with source metadata', async () => {
    const { db, calls } = recordingDb([]);
    await createCaseWithLinks(db, {
      title: 't', created_by: 1,
      source: 'serve-intake',
    });
    const activity = calls.find((c) => /INSERT INTO case_activity/.test(c.sql));
    expect(activity).toBeDefined();
    expect(activity!.args[1]).toBe('case.created');
    expect(activity!.args[2]).toBe(1);
    const detail = JSON.parse(String(activity!.args[3]));
    expect(detail.source).toBe('serve-intake');
  });

  it('survives a junction write failure (best-effort) and still returns case_id', async () => {
    // Surgical fake: case INSERT succeeds, but case_serve_jobs INSERT throws.
    let id = 0;
    const db = {
      prepare(sql: string) {
        const stmt: any = {
          bind: () => stmt,
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => {
            if (/INSERT INTO cases/.test(sql)) {
              id++;
              return { meta: { changes: 1, last_row_id: id } };
            }
            if (/INSERT OR IGNORE INTO case_serve_jobs/.test(sql)) {
              throw new Error('no such table: case_serve_jobs');
            }
            return { meta: { changes: 1, last_row_id: 0 } };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;

    // Must not throw despite the junction failure.
    const res = await createCaseWithLinks(db, {
      title: 'best-effort', created_by: 1,
      linked_serve_queue_id: 999,
    });
    expect(res.case_id).toBeGreaterThan(0);
    expect(res.case_number).toMatch(/^\d{2}-\d{6}-GN$/);
  });
});
