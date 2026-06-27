import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { D1Database } from '@cloudflare/workers-types';

const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: any } }>();

// ── Automation Rule CRUD ──
const ruleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  trigger_event: z.string().min(1).max(100),
  conditions: z.any().default({}),
  actions: z.any().default({}),
  cooldown_minutes: z.number().int().min(0).default(60),
});

app.get('/rules', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM automation_rule_config ORDER BY name'
  ).all();
  return c.json({ data: rows.results || [] });
});

app.post('/rules', zValidator('json', ruleCreateSchema), async (c) => {
  const user = c.var.user;
  const { name, description, trigger_event, conditions, actions, cooldown_minutes } = c.req.valid('json');
  const result = await c.env.DB.prepare(
    `INSERT INTO automation_rule_config (name, description, trigger_event, conditions, actions, cooldown_minutes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(name, description || null, trigger_event, JSON.stringify(conditions), JSON.stringify(actions), cooldown_minutes, user?.id || null).run();
  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

app.put('/rules/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid rule ID' }, 400);

  const body = await c.req.json<any>();
  const sets: string[] = [];
  const vals: any[] = [];

  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description); }
  if (body.trigger_event !== undefined) { sets.push('trigger_event = ?'); vals.push(body.trigger_event); }
  if (body.conditions !== undefined) { sets.push('conditions = ?'); vals.push(JSON.stringify(body.conditions)); }
  if (body.actions !== undefined) { sets.push('actions = ?'); vals.push(JSON.stringify(body.actions)); }
  if (body.enabled !== undefined) { sets.push('enabled = ?'); vals.push(body.enabled ? 1 : 0); }
  if (body.cooldown_minutes !== undefined) { sets.push('cooldown_minutes = ?'); vals.push(body.cooldown_minutes); }
  sets.push("updated_at = datetime('now')");
  vals.push(id);

  if (sets.length === 1) return c.json({ error: 'No fields to update' }, 400);
  await c.env.DB.prepare(`UPDATE automation_rule_config SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return c.json({ success: true });
});

app.delete('/rules/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid rule ID' }, 400);
  await c.env.DB.prepare('DELETE FROM automation_rule_config WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ── Toggle rule on/off ──
app.post('/rules/:id/toggle', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid rule ID' }, 400);

  const rule = await c.env.DB.prepare(
    'SELECT enabled FROM automation_rule_config WHERE id = ?'
  ).bind(id).first<{ enabled: number }>();

  if (!rule) return c.json({ error: 'Rule not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE automation_rule_config SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(rule.enabled ? 0 : 1, id).run();

  return c.json({ success: true, enabled: !rule.enabled });
});

// ── Execution Log ──
app.get('/rules/:id/log', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid rule ID' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM automation_execution_log
     WHERE rule_id = ?
     ORDER BY started_at DESC
     LIMIT 50`
  ).bind(id).all();

  return c.json({ data: rows.results || [] });
});

export default app;
