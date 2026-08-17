import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { log } from '../utils/logger';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.post('/remote-lock', async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Admin or manager access required' }, 403);
  }
  const body = await c.req.json<{ unit_id: number }>();
  if (!body?.unit_id) return c.json({ error: 'unit_id required' }, 400);
  const payload = JSON.stringify({
    locked_at: new Date().toISOString(),
    locked_by: user.id,
    locked_by_name: user.full_name ?? user.username,
  });
  await c.env.KV.put(`remote_lock:${body.unit_id}`, payload, { expirationTtl: 86400 });
  log.info('Remote lock signal sent', { unit_id: body.unit_id, locked_by: user.id, traceId: c.get('traceId') });
  return c.json({ ok: true, unit_id: body.unit_id, message: 'Lock signal sent' });
});

app.get('/lock-status', async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ locked: false });
  const unit = await c.env.DB.prepare('SELECT id FROM units WHERE officer_id = ? LIMIT 1')
    .bind(user.id).first<{ id: number }>();
  if (!unit) return c.json({ locked: false });
  const raw = await c.env.KV.get(`remote_lock:${unit.id}`);
  if (!raw) return c.json({ locked: false });
  return c.json({ locked: true, ...JSON.parse(raw) });
});

app.delete('/remote-lock/:unit_id', async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Admin or manager access required' }, 403);
  }
  await c.env.KV.delete(`remote_lock:${c.req.param('unit_id')}`);
  return c.json({ ok: true });
});

app.get('/my-call', async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ call: null });
  const call = await c.env.DB.prepare(`
    SELECT cfs.id, cfs.call_number, cfs.incident_type, cfs.priority, cfs.status, cfs.location_address, cfs.created_at
    FROM calls_for_service cfs
    JOIN units du ON du.current_call_id = cfs.id
    WHERE du.officer_id = ? LIMIT 1
  `).bind(user.id).first<{
    id: number; call_number: string; incident_type: string;
    priority: number; status: string; location_address?: string; created_at?: string;
  }>();
  return c.json({ call: call ?? null });
});

app.get('/my-unit-status', async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ status: 'available' });
  const unit = await c.env.DB.prepare('SELECT status FROM units WHERE officer_id = ? LIMIT 1')
    .bind(user.id).first<{ status: string }>();
  return c.json({ status: unit?.status ?? 'available' });
});

app.patch('/my-unit-status', async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ status: string }>();
  if (!body?.status) return c.json({ error: 'status required' }, 400);
  await c.env.DB.prepare('UPDATE units SET status = ? WHERE officer_id = ?')
    .bind(body.status, user.id).run();
  return c.json({ ok: true, status: body.status });
});

export default app;
