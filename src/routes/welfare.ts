// ============================================================
// RMPG Flex — Officer Welfare (Hono / lean API, DI-4)
//   POST /api/dispatch/welfare/ack
//   POST /api/dispatch/welfare/help     emergency broadcast
//   POST /api/dispatch/welfare/snooze
//   POST /api/dispatch/welfare/prompt/:userId   dispatcher manual prompt
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { sendToUser, broadcastAll } from './ws';

const ALL_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher', 'officer'];

const welfare = new Hono<Env>();

welfare.post('/ack', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    try {
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'welfare_ack', 'user', ?, ?, ?)`,
        userId, userId, 'Code 4 ack received', c.req.header('cf-connecting-ip') || 'unknown');
    } catch { /* non-fatal */ }
    broadcastAll('dispatch_update', { action: 'welfare_cleared', user_id: userId, at: new Date().toISOString() });
    return c.json({ success: true, message: 'Code 4 ack received.' });
  } catch (err) {
    console.error('[welfare] ack error', err);
    return c.json({ error: 'Failed to ack welfare check', code: 'WELFARE_ACK_ERR' }, 500);
  }
});

welfare.post('/help', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const userRow = await queryFirst<any>(db, 'SELECT id, full_name FROM users WHERE id = ?', userId);
    const unit = await queryFirst<any>(db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ?', userId);
    const callContext = unit?.current_call_id
      ? await queryFirst<any>(db, 'SELECT id, call_number, incident_type, location_address, latitude, longitude FROM calls_for_service WHERE id = ?', unit.current_call_id)
      : null;

    const payload = {
      action: 'welfare_emergency',
      user_id: userId,
      officer_name: userRow?.full_name || 'Unknown officer',
      call_sign: unit?.call_sign || null,
      call_id: callContext?.id ?? null,
      call_number: callContext?.call_number ?? null,
      location_address: callContext?.location_address ?? null,
      latitude: callContext?.latitude ?? null,
      longitude: callContext?.longitude ?? null,
      triggered_by: 'mdt_button',
      at: new Date().toISOString(),
    };

    try {
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'welfare_help_requested', 'user', ?, ?, ?)`,
        userId, userId,
        `Officer requested help from MDT welfare modal${callContext ? ' on call ' + callContext.call_number : ''}`,
        c.req.header('cf-connecting-ip') || 'unknown');
    } catch { /* non-fatal */ }

    broadcastAll('dispatch_update', payload);
    return c.json({ success: true, broadcast: payload });
  } catch (err) {
    console.error('[welfare] help error', err);
    return c.json({ error: 'Failed to broadcast help request', code: 'WELFARE_HELP_ERR' }, 500);
  }
});

welfare.post('/snooze', requireRole(...ALL_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    try {
      await execute(db, `
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'welfare_snooze', 'user', ?, ?, ?)`,
        userId, userId, 'Welfare prompt snoozed (5 min)', c.req.header('cf-connecting-ip') || 'unknown');
    } catch { /* non-fatal */ }
    return c.json({ success: true, message: 'Welfare timer reset.' });
  } catch (err) {
    console.error('[welfare] snooze error', err);
    return c.json({ error: 'Failed to snooze welfare check', code: 'WELFARE_SNOOZE_ERR' }, 500);
  }
});

welfare.post('/prompt/:userId', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
  try {
    const db = getDb(c.env);
    const targetUserId = parseInt(c.req.param('userId') || '', 10);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) return c.json({ error: 'Invalid userId', code: 'INVALID_USERID' }, 400);
    const unit = await queryFirst<any>(db, 'SELECT id, call_sign, current_call_id FROM units WHERE officer_id = ?', targetUserId);
    const callContext = unit?.current_call_id
      ? await queryFirst<any>(db, 'SELECT id, call_number FROM calls_for_service WHERE id = ?', unit.current_call_id)
      : null;

    const delivered = sendToUser(targetUserId, 'welfare_check', {
      action: 'welfare_prompt',
      callSign: unit?.call_sign || null,
      callId: callContext?.id ?? null,
      callNumber: callContext?.call_number ?? null,
      message: `Welfare check: ${unit?.call_sign || 'unit'}, are you code 4${callContext ? ` on call ${callContext.call_number}` : ''}?`,
    });

    return c.json({ success: true, delivered, callSign: unit?.call_sign });
  } catch (err) {
    console.error('[welfare] prompt error', err);
    return c.json({ error: 'Failed to send welfare prompt', code: 'WELFARE_PROMPT_ERR' }, 500);
  }
});

export default welfare;
