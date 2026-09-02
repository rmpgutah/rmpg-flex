import { describe, it, expect } from 'vitest';
import { collectExtendedActivity } from '../src/utils/dailyEmail/collectExtended';

/** Records every SQL string + bindings, returns canned rows per table. */
function makeDb(rowsByTable: Record<string, unknown[]>) {
  const calls: { sql: string; bindings: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const ctx = { sql, bindings: [] as unknown[] };
      const stmt = {
        bind(...args: unknown[]) { ctx.bindings = args; return stmt; },
        async all<T>(): Promise<{ results: T[] }> {
          calls.push(ctx);
          const table = Object.keys(rowsByTable).find((t) => new RegExp(`FROM ${t}\\b`).test(sql));
          return { results: (table ? rowsByTable[table] : []) as T[] };
        },
      };
      return stmt;
    },
  } as unknown as Parameters<typeof collectExtendedActivity>[0];
  return { db, calls };
}

const EMPTY = {};

describe('collectExtendedActivity', () => {
  it('returns empty sections when no data exists', async () => {
    const { db } = makeDb(EMPTY);
    const data = await collectExtendedActivity(db, '2026-07-18');
    expect(data.warrants.totalCount).toBe(0);
    expect(data.incidents.totalCount).toBe(0);
    expect(data.alpr.totalCount).toBe(0);
    expect(data.patrolScans.totalCount).toBe(0);
    expect(data.persons.totalCount).toBe(0);
  });

  it('collects warrants data', async () => {
    const { db } = makeDb({
      warrants: [{
        warrant_number: 'W-001',
        type: 'bench',
        status: 'active',
        subject_name: 'John Doe',
        charge_description: 'Theft',
        offense_level: 'misdemeanor',
        bond_amount: 500,
        served_at: null,
        created_at: '2026-07-18 14:00:00',
      }],
    });
    const data = await collectExtendedActivity(db, '2026-07-18');
    expect(data.warrants.newCount).toBe(1);
    expect(data.warrants.newToday[0].warrant_number).toBe('W-001');
  });

  it('collects incidents data', async () => {
    const { db } = makeDb({
      incidents: [
        { incident_number: 'I-001', incident_type: 'THEFT', status: 'draft', priority: 'P2', location_address: '100 Main', created_at: '2026-07-18 08:00:00' },
        { incident_number: 'I-002', incident_type: 'ASSAULT', status: 'approved', priority: 'P1', location_address: '200 Main', created_at: '2026-07-18 10:00:00' },
      ],
    });
    const data = await collectExtendedActivity(db, '2026-07-18');
    expect(data.incidents.totalCount).toBe(2);
    expect(data.incidents.byStatus['draft']).toBe(1);
    expect(data.incidents.byStatus['approved']).toBe(1);
  });

  it('collects ALPR data and counts alerted', async () => {
    const { db } = makeDb({
      alpr_captures: [
        { id: 1, plate: 'ABC123', state: 'UT', make: null, model: null, color: null, confidence: 0.95, risk_score: 0.1, review_status: 'confirmed', alerted: 0, call_id: null, created_at: '2026-07-18 09:00:00' },
        { id: 2, plate: 'XYZ789', state: 'UT', make: null, model: null, color: null, confidence: 0.88, risk_score: 0.9, review_status: 'needs_review', alerted: 1, call_id: 1, created_at: '2026-07-18 11:00:00' },
      ],
    });
    const data = await collectExtendedActivity(db, '2026-07-18');
    expect(data.alpr.totalCount).toBe(2);
    expect(data.alpr.alertedCount).toBe(1);
  });

  it('collects patrol scans and aggregates statuses', async () => {
    const { db } = makeDb({
      patrol_scans: [
        { checkpoint_id: 1, officer_id: 1, status: 'on_time', scanned_at: '2026-07-18 06:00:00', notes: null },
        { checkpoint_id: 2, officer_id: 2, status: 'late', scanned_at: '2026-07-18 06:15:00', notes: 'Traffic' },
        { checkpoint_id: 3, officer_id: 3, status: 'missed', scanned_at: '2026-07-18 06:30:00', notes: null },
      ],
    });
    const data = await collectExtendedActivity(db, '2026-07-18');
    expect(data.patrolScans.totalCount).toBe(3);
    expect(data.patrolScans.onTime).toBe(1);
    expect(data.patrolScans.late).toBe(1);
    expect(data.patrolScans.missed).toBe(1);
  });

  it('collects new persons', async () => {
    const { db } = makeDb({
      persons: [
        { first_name: 'Jane', last_name: 'Smith', dob: '1990-01-15', flags: '[]', created_at: '2026-07-18 14:00:00' },
      ],
    });
    const data = await collectExtendedActivity(db, '2026-07-18');
    expect(data.persons.totalCount).toBe(1);
    expect(data.persons.rows[0].first_name).toBe('Jane');
  });

  it('binds Denver day bounds in D1 format', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectExtendedActivity(db, '2026-07-18');
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.bindings).toContain('2026-07-18 06:00:00');
      expect(c.bindings).toContain('2026-07-19 06:00:00');
    }
  });

  it('never selects * from any table', async () => {
    const { db, calls } = makeDb(EMPTY);
    await collectExtendedActivity(db, '2026-07-18');
    for (const c of calls) {
      expect(c.sql).not.toMatch(/SELECT\s+\*|SELECT\s+\w+\.\*/i);
    }
  });
});
