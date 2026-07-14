// test-workers/connectionsForensics.test.ts
//
// Confirms forensic cases become graph nodes, reachable from a linked
// entity via the forensic_case_entity_links table (shipped in PR #2790)
// exactly the way record_links is already queried bidirectionally.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import connections from '../src/routes/connections';

const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: { id: number; role: string; username: string }; userId: number } }>();
app.use('*', async (c, next) => {
  c.set('user', { id: 1, role: 'admin', username: 'test-analyst' });
  c.set('userId', 1);
  await next();
});
app.route('/api/connections', connections);

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  await execute(db, `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT, role TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS persons (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT)`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_number TEXT, title TEXT,
    received_date TEXT NOT NULL DEFAULT (datetime('now')), status TEXT
  )`);
  await execute(db, `CREATE TABLE IF NOT EXISTS forensic_case_entity_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, forensic_case_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, entity_label TEXT,
    relationship TEXT NOT NULL DEFAULT 'related', linked_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await execute(db, `INSERT INTO users (id, full_name, role) VALUES (1, 'Test Analyst', 'admin')`);
  await execute(db, `INSERT INTO persons (id, first_name, last_name) VALUES (1, 'Jane', 'Doe')`);
  await execute(db, `INSERT INTO forensic_cases (id, lab_number, title) VALUES (1, 'LAB-26-0010', 'DNA Case')`);
  await execute(db, `INSERT INTO forensic_case_entity_links (forensic_case_id, entity_type, entity_id, entity_label, relationship) VALUES (1, 'person', 1, 'Doe, Jane', 'suspect')`);
});

describe('Forensic case graph nodes', () => {
  it('GET /connections/graph?type=person&id=1 includes the linked forensic case', async () => {
    const res = await app.request('/api/connections/graph?type=person&id=1&depth=1', {}, env as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);
    const body = await res.json() as { nodes: Array<{ type: string; entityId: number; label: string }> };
    const fcNode = body.nodes.find((n) => n.type === 'forensic_case' && n.entityId === 1);
    expect(fcNode).toBeTruthy();
    expect(fcNode?.label).toContain('LAB-26-0010');
  });
});
