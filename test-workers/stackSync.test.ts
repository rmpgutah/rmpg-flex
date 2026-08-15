// Miniflare integration tests for the stacked dispatch call linking feature.
// Verifies assignStackGroup, leaveStackGroup, and syncToStack against a real
// (Miniflare) D1 instance so we catch any SQL/index issues missed by unit stubs.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { execute } from '../src/utils/db';
import {
  assignStackGroup,
  leaveStackGroup,
  syncToStack,
} from '../src/utils/stackSync';

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_type TEXT NOT NULL DEFAULT 'test',
    priority TEXT NOT NULL DEFAULT 'P3',
    status TEXT NOT NULL DEFAULT 'pending',
    location_address TEXT,
    assigned_unit_ids TEXT DEFAULT '[]',
    unit_call_signs TEXT DEFAULT '[]',
    dispatched_at TEXT,
    enroute_at TEXT,
    onscene_at TEXT,
    starting_mileage REAL,
    ending_mileage REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS calls_for_service_ext (
    id INTEGER PRIMARY KEY,
    stack_group_id TEXT
  )`);
});

async function seed(
  db: D1Database,
  address: string,
  status = 'pending',
): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO calls_for_service
         (incident_type, priority, status, location_address, created_at, updated_at)
       VALUES ('test', 'P3', ?, ?, datetime('now'), datetime('now'))`,
    )
    .bind(status, address)
    .run();
  const id = Number(r.meta.last_row_id);
  await db.prepare('INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)').bind(id).run();
  return id;
}

async function groupId(db: D1Database, callId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?')
    .bind(callId)
    .first<{ stack_group_id: string | null }>();
  return row?.stack_group_id ?? null;
}

describe('assignStackGroup — Miniflare', () => {
  it('two calls at same address share the same stack_group_id', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id1 = await seed(db, '100 Test Ave');
    const id2 = await seed(db, '100 Test Ave');
    await assignStackGroup(db, id1, '100 Test Ave');
    await assignStackGroup(db, id2, '100 Test Ave');
    const g1 = await groupId(db, id1);
    const g2 = await groupId(db, id2);
    expect(g1).not.toBeNull();
    expect(g1).toBe(g2);
  });

  it('calls at different addresses stay ungrouped', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id1 = await seed(db, '100 Alpha St');
    const id2 = await seed(db, '200 Beta Ave');
    await assignStackGroup(db, id1, '100 Alpha St');
    await assignStackGroup(db, id2, '200 Beta Ave');
    expect(await groupId(db, id1)).toBeNull();
    expect(await groupId(db, id2)).toBeNull();
  });
});

describe('leaveStackGroup — Miniflare', () => {
  it('dissolves singleton group when both members leave', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id1 = await seed(db, '300 Gamma Rd');
    const id2 = await seed(db, '300 Gamma Rd');
    await assignStackGroup(db, id1, '300 Gamma Rd');
    await assignStackGroup(db, id2, '300 Gamma Rd');
    expect(await groupId(db, id1)).not.toBeNull();
    await leaveStackGroup(db, id1);
    // Sibling should dissolve to NULL because only one remains
    expect(await groupId(db, id2)).toBeNull();
  });
});

describe('syncToStack — Miniflare', () => {
  it('fill-only: propagates enroute_at to sibling with no timestamp', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id1 = await seed(db, '400 Delta Ln');
    const id2 = await seed(db, '400 Delta Ln');
    await assignStackGroup(db, id1, '400 Delta Ln');
    await assignStackGroup(db, id2, '400 Delta Ln');
    const g = await groupId(db, id1);
    await syncToStack(db, g!, id1, { timestamps: { enroute_at: '2026-08-14T10:00:00' } });
    const row = await db
      .prepare('SELECT enroute_at FROM calls_for_service WHERE id = ?')
      .bind(id2)
      .first<{ enroute_at: string | null }>();
    expect(row?.enroute_at).toBe('2026-08-14T10:00:00');
  });

  it('fill-only: does not overwrite existing enroute_at on sibling', async () => {
    const db = (env as unknown as { DB: D1Database }).DB;
    const id1 = await seed(db, '500 Echo Blvd');
    const id2 = await seed(db, '500 Echo Blvd');
    await assignStackGroup(db, id1, '500 Echo Blvd');
    await assignStackGroup(db, id2, '500 Echo Blvd');
    await db
      .prepare("UPDATE calls_for_service SET enroute_at = '2026-08-14T09:00:00' WHERE id = ?")
      .bind(id2)
      .run();
    const g = await groupId(db, id1);
    await syncToStack(db, g!, id1, { timestamps: { enroute_at: '2026-08-14T10:00:00' } });
    const row = await db
      .prepare('SELECT enroute_at FROM calls_for_service WHERE id = ?')
      .bind(id2)
      .first<{ enroute_at: string | null }>();
    expect(row?.enroute_at).toBe('2026-08-14T09:00:00');
  });
});
