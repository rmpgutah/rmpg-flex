// ============================================================
// RMPG Flex — rmpgutahps.us delivery-scheduler CAD push (piece 1/3)
// ============================================================
// POST /api/deliveries/webhook
//
// Auth model: HMAC-SHA256 over the raw request body, hex-encoded, header
// `x-rmpg-flex-hmac-sha256`, secret RMPG_FLEX_WEBHOOK_SECRET. Matches this
// repo's ServeManager webhook convention rather than a static API key —
// see the design doc for why. Reuses the existing hmacSha256Hex /
// constantTimeEquals helpers from fleetioWebhook.ts rather than
// reimplementing them.
//
// v1 is confirm-only: rmpgutahps.us calls this only from its approve
// action. No cancel/reschedule trigger in this phase (see spec, Out of
// Scope). A repeat call for the same delivery_slots.id (retry, duplicate
// click) updates the existing calls_for_service / calls_for_service_ext
// row pair in place rather than creating a duplicate call — keyed on
// calls_for_service_ext.delivery_slot_id (UNIQUE, partial index).
//
// Spec: docs/superpowers/specs/2026-09-14-delivery-scheduler-cad-push-design.md
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { hmacSha256Hex, constantTimeEquals } from './fleetioWebhook';
import { parseDeliveryWebhookPayload, type DeliveryWebhookPayload } from '../utils/deliveryWebhook';
import { getDb, execute, queryFirst, ensureDeliveryExtColumns } from '../utils/db';
import { currentCallNumberPrefix, withNextCallNumber } from '../utils/callNumberSeq';
import { notConfigured } from '../utils/notConfigured';
import { log } from '../utils/logger';

const deliveriesWebhook = new Hono<Env>();

async function findExistingCallId(db: D1Database, slotId: number): Promise<number | null> {
  const row = await queryFirst<{ id: number }>(
    db,
    `SELECT id FROM calls_for_service_ext WHERE delivery_slot_id = ?`,
    slotId,
  );
  return row?.id ?? null;
}

async function updateExistingDelivery(db: D1Database, callId: number, payload: DeliveryWebhookPayload): Promise<void> {
  await execute(
    db,
    `UPDATE calls_for_service SET location_address = COALESCE(?, location_address) WHERE id = ?`,
    payload.address, callId,
  );
  await execute(
    db,
    `UPDATE calls_for_service_ext SET
       delivery_case_number = ?, delivery_scheduled_date = ?, delivery_time_window = ?,
       delivery_contact_name = ?, delivery_contact_phone = ?, delivery_contact_email = ?,
       delivery_subject_name = ?, delivery_status = ?
     WHERE id = ?`,
    payload.caseNumber, payload.slotDate, payload.timeWindow,
    payload.contactName, payload.contactPhone, payload.contactEmail,
    payload.subjectName, payload.status, callId,
  );
}

// Race-safe upsert of the calls_for_service_ext row keyed on the partial
// UNIQUE index over delivery_slot_id (migration 0289 / ensureDeliveryExtColumns).
// A single INSERT … ON CONFLICT DO UPDATE — same pattern as dialerConnect.ts's
// upsertCall() — so two racers targeting the same slot converge onto ONE ext
// row instead of one of them hitting the unique-index violation.
async function upsertDeliveryExt(db: D1Database, callId: number, payload: DeliveryWebhookPayload): Promise<void> {
  await execute(
    db,
    `INSERT INTO calls_for_service_ext
       (id, external_source_system, delivery_slot_id, delivery_case_number,
        delivery_scheduled_date, delivery_time_window, delivery_contact_name,
        delivery_contact_phone, delivery_contact_email, delivery_subject_name, delivery_status)
     VALUES (?, 'delivery_scheduler', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(delivery_slot_id) WHERE delivery_slot_id IS NOT NULL DO UPDATE SET
       delivery_case_number = excluded.delivery_case_number,
       delivery_scheduled_date = excluded.delivery_scheduled_date,
       delivery_time_window = excluded.delivery_time_window,
       delivery_contact_name = excluded.delivery_contact_name,
       delivery_contact_phone = excluded.delivery_contact_phone,
       delivery_contact_email = excluded.delivery_contact_email,
       delivery_subject_name = excluded.delivery_subject_name,
       delivery_status = excluded.delivery_status`,
    callId, payload.slotId, payload.caseNumber, payload.slotDate, payload.timeWindow,
    payload.contactName, payload.contactPhone, payload.contactEmail, payload.subjectName, payload.status,
  );
}

// calls_for_service_ext.id is a 1:1 FK onto calls_for_service.id, so — unlike
// dialerConnect's single-table upsert — the calls_for_service INSERT still has
// to happen before we know whether this racer will "win" the ext row. Two
// concurrent callers with no existing row both pass findExistingCallId's null
// check and both reach here, so BOTH insert a calls_for_service row. The
// upsertDeliveryExt ON CONFLICT above then lets only one of those ext rows
// become canonical; we re-read the authoritative id afterward and, if it isn't
// ours, delete our now-orphaned calls_for_service row rather than leaving a
// dispatchable call with no delivery data attached. See dialerConnect.ts /
// CLAUDE.md "Dial Connect (Twilio dialer)" for the precedent this follows.
async function createDeliveryCall(
  db: D1Database,
  payload: DeliveryWebhookPayload,
): Promise<{ callId: number; created: boolean }> {
  const prefix = currentCallNumberPrefix();
  const address = payload.address ?? '(address not provided by delivery scheduler)';
  const { result: callId } = await withNextCallNumber(db, prefix, async (callNumber) => {
    const insert = await execute(
      db,
      `INSERT INTO calls_for_service
         (call_number, incident_type, priority, status, caller_name, caller_phone,
          location_address, notes, source)
       VALUES (?, 'delivery', 'P4', 'pending', ?, ?, ?, ?, 'other')`,
      callNumber, payload.contactName, payload.contactPhone, address, payload.notes,
    );
    return Number(insert.meta.last_row_id);
  });

  await upsertDeliveryExt(db, callId, payload);

  const resolvedId = (await findExistingCallId(db, payload.slotId)) ?? callId;
  if (resolvedId !== callId) {
    // Lost the race: another concurrent request's row is now canonical for
    // this slot. Our INSERT above is an orphan with no ext row — remove it.
    await execute(db, `DELETE FROM calls_for_service WHERE id = ?`, callId);
    return { callId: resolvedId, created: false };
  }
  return { callId, created: true };
}

deliveriesWebhook.post('/', async (c) => {
  const secret = c.env.RMPG_FLEX_WEBHOOK_SECRET;
  if (!secret) {
    return notConfigured(c, 'rmpg_flex_webhook_secret_unset');
  }

  const rawBody = await c.req.text();
  const header = c.req.header('x-rmpg-flex-hmac-sha256');
  if (!header) {
    return c.json({ ok: false, error: 'Missing signature' }, 401);
  }
  const expected = await hmacSha256Hex(secret, rawBody);
  if (!constantTimeEquals(header.toLowerCase(), expected.toLowerCase())) {
    return c.json({ ok: false, error: 'Invalid signature' }, 401);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const parsed = parseDeliveryWebhookPayload(parsedBody);
  if (!parsed.ok) {
    return c.json({ ok: false, error: parsed.error }, 400);
  }

  const db = getDb(c.env);
  await ensureDeliveryExtColumns(db);

  try {
    const existingId = await findExistingCallId(db, parsed.payload.slotId);
    if (existingId !== null) {
      await updateExistingDelivery(db, existingId, parsed.payload);
      return c.json({ ok: true, call_id: existingId, created: false }, 200);
    }
    const { callId, created } = await createDeliveryCall(db, parsed.payload);
    return c.json({ ok: true, call_id: callId, created }, created ? 201 : 200);
  } catch (err) {
    log.error('delivery webhook failed', { slotId: parsed.payload.slotId },
      err instanceof Error ? err : new Error(String(err)));
    return c.json({ ok: false, error: 'Internal error' }, 500);
  }
});

export default deliveriesWebhook;
