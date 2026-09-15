// Route-level test (Miniflare/workerd) for the Dispatcher Command Engine,
// POST /api/dispatcher/command. Exercises the no-AI path (deterministic
// rules), reference resolution against real D1 rows, the KV-backed
// confirmation round-trip for destructive plans, RBAC, server-side reads,
// the audit-log row, and the graceful "planner offline" degradation when no
// AI provider is reachable (the AI binding is absent in this pool).
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { execute, query, queryFirst } from '../src/utils/db';
import dispatcher from '../src/routes/dispatcherCommand';

type User = { id: number; role: string; username: string; full_name: string };

function appAs(user: User) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: User; userId: number } }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('userId', user.id); await next(); });
  app.route('/api/dispatcher', dispatcher);
  return app;
}

const DISPATCHER: User = { id: 41, role: 'dispatcher', username: 'disp', full_name: 'Dee Spatcher' };
const VIEWER: User = { id: 42, role: 'client_viewer', username: 'view', full_name: 'Client Viewer' };
// Only admin/manager may delete a call — and a true delete is now the only
// operation that raises the confirmation gate, so the round-trip tests below
// need an admin actor to reach it at all.
const ADMIN: User = { id: 43, role: 'admin', username: 'adm', full_name: 'Ada Min' };
const db = () => (env as unknown as { DB: D1Database }).DB;

async function command(user: User, body: Record<string, unknown>) {
  const res = await appAs(user).request('/api/dispatcher/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env as unknown as Record<string, unknown>);
  return { status: res.status, json: await res.json() as any };
}

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS calls_for_service (
    id INTEGER PRIMARY KEY, call_number TEXT, incident_type TEXT, priority TEXT, status TEXT,
    location_address TEXT, unit_call_signs TEXT, assigned_unit_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT)`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY, call_sign TEXT, status TEXT, officer_id INTEGER)`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, full_name TEXT)`);
  await execute(db(), `CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, config_key TEXT, config_value TEXT)`);
  await execute(db(), `DELETE FROM calls_for_service WHERE id IN (7001, 7002)`);
  await execute(db(), `DELETE FROM units WHERE id IN (301, 302)`);
  await execute(db(), `DELETE FROM system_config WHERE config_key = 'dispatcher_command_confirm_destructive'`);
  await execute(db(), `INSERT INTO calls_for_service (id, call_number, incident_type, priority, status, location_address)
    VALUES (7001, 'CFS26-0042', 'alarm', 'P2', 'pending', '1 Main St'),
           (7002, 'CFS26-0142', 'theft', 'P3', 'dispatched', '2 State St')`);
  await execute(db(), `INSERT INTO units (id, call_sign, status) VALUES (301, '12', 'available'), (302, '14', 'busy')`);
});

describe('POST /api/dispatcher/command — deterministic path (no AI)', () => {
  it('plans an assignment against real call/unit ids and logs it', async () => {
    const { status, json } = await command(DISPATCHER, { text: 'assign 12 to 42', source: 'typed' });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.planner).toBe('rules');
    expect(json.needs_confirmation).toBe(false);
    const http = json.steps.find((s: any) => s.kind === 'http');
    expect(http).toMatchObject({ method: 'POST', path: '/dispatch/calls/7001/dispatch', body: { unit_ids: [301] }, destructive: false });
    expect(json.steps.some((s: any) => s.kind === 'client' && s.action === 'refresh')).toBe(true);
    expect(json.reply).toContain('CFS26-0042');

    const row = await queryFirst<{ status: string; planner: string; input_text: string }>(
      db(), 'SELECT status, planner, input_text FROM dispatcher_command_log WHERE id = ?', json.log_id);
    expect(row).toMatchObject({ status: 'planned', planner: 'rules', input_text: 'assign 12 to 42' });
  });

  it('"42" resolves by numeric tail to 0042, not 0142', async () => {
    const { json } = await command(DISPATCHER, { text: 'hold 42' });
    expect(json.steps[0].path).toBe('/dispatch/calls/7001/hold');
  });

  it('"this call" resolves through context.selected_call_number', async () => {
    const { json } = await command(DISPATCHER, { text: 'priority 1 on this call', context: { selected_call_number: 'CFS26-0142' } });
    expect(json.steps[0]).toMatchObject({ path: '/dispatch/calls/7002/escalate', body: { new_priority: 'P1' } });
  });

  it('unknown call → clarify, nothing planned', async () => {
    const { json } = await command(DISPATCHER, { text: 'hold 9999' });
    expect(json.ok).toBe(false);
    expect(json.steps).toEqual([]);
    expect(json.clarify).toMatch(/No call matches "9999"/);
  });

  it('server-side read: pending calls are answered inline', async () => {
    const { json } = await command(DISPATCHER, { text: 'pending calls' });
    expect(json.ok).toBe(true);
    expect(json.reply).toContain('CFS26-0042');
    expect(json.steps.filter((s: any) => s.kind === 'http')).toEqual([]);
  });

  it('help lists the role-scoped catalog', async () => {
    const { json } = await command(DISPATCHER, { text: 'help' });
    expect(json.intent).toBe('help');
    expect(json.reply).toContain('- assign_units');
    expect(json.reply).toContain('- redispatch');
    const officer: User = { id: 5, role: 'officer', username: 'o', full_name: 'O' };
    const off = await command(officer, { text: 'help' });
    expect(off.json.reply).toContain('- create_call');
    expect(off.json.reply).not.toContain('- set_call_status');
  });
});

describe('confirmation round-trip', () => {
  // Policy (2026-09-14): only a TRUE DELETE raises the gate. Routine writes —
  // clearing a call, unassigning a unit — now execute immediately.
  it('clearing a call and unassigning a unit do NOT ask for confirmation', async () => {
    const clear = await command(DISPATCHER, { text: 'clear 42 unfounded' });
    expect(clear.json.needs_confirmation).toBe(false);
    expect(clear.json.steps[0]).toMatchObject({ path: '/dispatch/calls/7001/status', destructive: false });
    const unassign = await command(DISPATCHER, { text: 'remove 12 from 42' });
    expect(unassign.json.needs_confirmation).toBe(false);
  });

  it('destructive plan → token; Y executes; log status follows', async () => {
    const first = await command(ADMIN, { text: 'delete 42' });
    expect(first.json.needs_confirmation).toBe(true);
    expect(first.json.confirm_token).toBeTruthy();
    expect(first.json.reply).toMatch(/^Confirm:/);
    expect(first.json.steps[0]).toMatchObject({ method: 'DELETE', path: '/dispatch/calls/7001', destructive: true });
    const pending = await queryFirst<{ status: string }>(db(), 'SELECT status FROM dispatcher_command_log WHERE id = ?', first.json.log_id);
    expect(pending?.status).toBe('awaiting_confirmation');

    const second = await command(ADMIN, { confirm_token: first.json.confirm_token, confirmed: true });
    expect(second.json.confirmed).toBe(true);
    expect(second.json.needs_confirmation).toBe(false);
    expect(second.json.steps[0].path).toBe('/dispatch/calls/7001');
    const confirmed = await queryFirst<{ status: string }>(db(), 'SELECT status FROM dispatcher_command_log WHERE id = ?', first.json.log_id);
    expect(confirmed?.status).toBe('confirmed');

    // Token is single-use.
    const replay = await command(ADMIN, { confirm_token: first.json.confirm_token, confirmed: true });
    expect(replay.json.intent).toBe('confirm_expired');
  });

  it('N cancels and returns no steps', async () => {
    const first = await command(ADMIN, { text: 'delete 42' });
    expect(first.json.needs_confirmation).toBe(true);
    const second = await command(ADMIN, { confirm_token: first.json.confirm_token, confirmed: false });
    expect(second.json.confirmed).toBe(false);
    expect(second.json.steps).toEqual([]);
    expect(second.json.reply).toBe('Cancelled.');
  });

  it('another user cannot consume the token', async () => {
    const first = await command(ADMIN, { text: 'delete 42' });
    const other: User = { id: 99, role: 'admin', username: 'a', full_name: 'A' };
    const res = await command(other, { confirm_token: first.json.confirm_token, confirmed: true });
    expect(res.status).toBe(403);
  });

  it('operator can turn confirmation off via system_config', async () => {
    await execute(db(), `INSERT INTO system_config (config_key, config_value) VALUES ('dispatcher_command_confirm_destructive', '0')`);
    try {
      const { json } = await command(ADMIN, { text: 'delete 42' });
      expect(json.needs_confirmation).toBe(false);
      expect(json.steps[0].destructive).toBe(true);
    } finally {
      await execute(db(), `DELETE FROM system_config WHERE config_key = 'dispatcher_command_confirm_destructive'`);
    }
  });
});

describe('RBAC and degradation', () => {
  it('client_viewer is refused outright', async () => {
    const { status } = await command(VIEWER, { text: 'assign 12 to 42' });
    expect(status).toBe(403);
  });

  it('officer may not clear a call (catalog role gate) — reported, not executed', async () => {
    const officer: User = { id: 5, role: 'officer', username: 'o', full_name: 'O' };
    const { json } = await command(officer, { text: 'clear 42 unfounded' });
    expect(json.ok).toBe(false);
    expect(json.steps).toEqual([]);
    expect(json.reply).toMatch(/officer/);
  });

  it('free-form text with no AI provider degrades to an honest offline reply', async () => {
    const { status, json } = await command(DISPATCHER, { text: 'could you kindly make sure the alarm caller gets a callback tomorrow' });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.planner).toBe('none');
    expect(json.reply).toMatch(/offline|Say again/);
  });

  it('empty text is a no-op', async () => {
    const { json } = await command(DISPATCHER, { text: '   ' });
    expect(json.intent).toBe('empty');
  });
});

describe('POST /command/:id/result + GET /command/recent', () => {
  it('records client outcomes and lists them for supervisors', async () => {
    const { json } = await command(DISPATCHER, { text: 'put 14 available' });
    const res = await appAs(DISPATCHER).request(`/api/dispatcher/command/${json.log_id}/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: [{ index: 0, ok: false, status: 500, summary: 'x', error: 'boom' }] }),
    }, env as unknown as Record<string, unknown>);
    expect((await res.json() as any).status).toBe('failed');

    const denied = await appAs(DISPATCHER).request('/api/dispatcher/command/recent', {}, env as unknown as Record<string, unknown>);
    expect(denied.status).toBe(403);
    const sup: User = { id: 1, role: 'supervisor', username: 's', full_name: 'S' };
    const ok = await appAs(sup).request('/api/dispatcher/command/recent', {}, env as unknown as Record<string, unknown>);
    expect(ok.status).toBe(200);
    const rows = await ok.json() as any[];
    expect(rows.some(r => r.id === json.log_id && r.status === 'failed')).toBe(true);
    // Sanity: nothing in this suite ever hit the calls/units tables as a write.
    const call = await queryFirst<{ status: string }>(db(), 'SELECT status FROM calls_for_service WHERE id = 7001');
    expect(call?.status).toBe('pending');
    expect((await query(db(), 'SELECT * FROM units WHERE id = 302 AND status = ?', 'busy')).length).toBe(1);
  });
});
