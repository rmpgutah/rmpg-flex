// Officer welfare — three endpoints the MDT calls:
//
//   POST /welfare/ack     officer responds Code 4 (all good)
//   POST /welfare/help    officer explicitly requests help (panic-equiv)
//   POST /welfare/snooze  officer asks for more time (resets timer)
//
// What's deferred: the auto-prompt timer engine (15 min idle →
// `welfare_check` push, 20 min idle → emergency broadcast). On the
// legacy Express server this runs in a setInterval. On Workers it
// needs a DispatchHub Durable Object Alarm — separate task.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, queryFirst, execute } from '../../utils/db';
import {
  broadcastDispatchUpdate,
  broadcastPanic,
  sendToRoles,
} from '../../lib/broadcast';

const welfare = new Hono<Env>();

async function recordActivity(env: any, userId: number) {
  const db = getDb(env);
  await execute(
    db,
    `INSERT INTO officer_welfare (user_id, last_activity_at, status)
     VALUES (?, datetime('now'), 'normal')
     ON CONFLICT(user_id) DO UPDATE SET last_activity_at = datetime('now'), status = 'normal'`,
    userId,
  );
}

welfare.post('/welfare/ack', async (c) => {
  const userId = c.get('userId') as number;
  await recordActivity(c.env, userId);
  const db = getDb(c.env);
  await execute(
    db,
    `UPDATE officer_welfare SET last_ack_at = datetime('now'), status = 'normal' WHERE user_id = ?`,
    userId,
  );
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'welfare_cleared', user_id: userId,
  }).then(() => {}));
  return c.json({ success: true, message: 'Code 4 acknowledged' });
});

welfare.post('/welfare/help', async (c) => {
  const userId = c.get('userId') as number;
  const db = getDb(c.env);
  const user = await queryFirst<{ id: number; full_name: string; badge_number: string }>(
    db, 'SELECT id, full_name, badge_number FROM users WHERE id = ?', userId,
  );
  const unit = await queryFirst<{ id: number; call_sign: string; current_call_id: number | null }>(
    db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ? LIMIT 1', userId,
  );
  // Same shape as a panic so the dispatcher screen treats it identically.
  await execute(
    db,
    `INSERT INTO panic_alerts (user_id, unit_id, call_id, source) VALUES (?, ?, ?, 'welfare')`,
    userId, unit?.id ?? null, unit?.current_call_id ?? null,
  );
  await execute(db, `UPDATE officer_welfare SET status = 'emergency' WHERE user_id = ?`, userId);

  const payload = {
    action: 'welfare_emergency',
    user_id: userId,
    officer_name: user?.full_name,
    badge_number: user?.badge_number,
    call_sign: unit?.call_sign,
    call_id: unit?.current_call_id,
  };
  c.executionCtx.waitUntil(broadcastPanic(c.env, payload).then(() => {}));
  c.executionCtx.waitUntil(sendToRoles(c.env, ['dispatcher', 'supervisor', 'manager', 'admin'],
    'panic_alert', payload).then(() => {}));
  return c.json({ success: true, message: 'Help request escalated' });
});

welfare.post('/welfare/snooze', async (c) => {
  const userId = c.get('userId') as number;
  await recordActivity(c.env, userId);
  return c.json({ success: true, message: 'Activity recorded — timer reset' });
});

export default welfare;
