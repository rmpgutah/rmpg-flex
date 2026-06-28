// Broadcast helpers — what route handlers import to fan out real-time
// updates. Hides the DispatchHub Durable Object stub fetch so route
// code reads like the legacy `broadcastDispatchUpdate(...)` calls did.

import type { Bindings } from '../types';

function getStub(env: Bindings) {
  // Single global instance — every Worker isolate routes to the same DO.
  const id = env.HUB.idFromName('global');
  return env.HUB.get(id);
}

async function rpc(env: Bindings, path: string, body: unknown): Promise<{ delivered: number }> {
  const stub = getStub(env);
  const res = await stub.fetch('https://hub.internal' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { delivered: 0 };
  return res.json();
}

// ─────────────────────────────────────────────────────────────────
// Channel broadcasts (every client subscribed to channel hears it)
// ─────────────────────────────────────────────────────────────────

/**
 * Generic dispatch_update — the client's Dispatcher Brain fans in
 * on this single type and routes by data.action. Keep the action
 * discriminator stable: 'call_created', 'call_updated', 'call_dispatched',
 * 'call_enroute', 'call_onscene', 'call_cleared', 'call_note_added',
 * 'unit_added', 'unit_removed', 'premise_alert'.
 */
export function broadcastDispatchUpdate(env: Bindings, data: any) {
  return rpc(env, '/broadcast', {
    channel: 'dispatch',
    message: { type: 'dispatch_update', data },
  });
}

export function broadcastUnitUpdate(env: Bindings, data: any) {
  return rpc(env, '/broadcast', {
    channel: 'unit',
    message: { type: 'unit_update', data },
  });
}

// Panic gets its own channel + type so client can wire emergency
// tones independently of normal dispatch chatter.
export function broadcastPanic(env: Bindings, data: any) {
  return rpc(env, '/broadcast', {
    channel: 'panic',
    message: { type: 'panic_alert', data },
  });
}

// calls:created / calls:updated mirror the legacy event shape that
// the client already wires P1/P2 alert tones to (see
// client/src/context/WebSocketContext.tsx lines 171–201).
export function broadcastCallCreated(env: Bindings, call: any) {
  return rpc(env, '/broadcast', {
    channel: 'dispatch',
    message: { type: 'calls:created', data: call, call },
  });
}

export function broadcastCallUpdated(env: Bindings, call: any) {
  return rpc(env, '/broadcast', {
    channel: 'dispatch',
    message: { type: 'calls:updated', data: call, call },
  });
}

// ─────────────────────────────────────────────────────────────────
// Targeted delivery
// ─────────────────────────────────────────────────────────────────

export function sendToUser(env: Bindings, userId: number, type: string, data: any) {
  return rpc(env, '/send-to-user', {
    userIds: [userId],
    message: { type, data },
  });
}

export function sendToUsers(env: Bindings, userIds: number[], type: string, data: any) {
  return rpc(env, '/send-to-user', { userIds, message: { type, data } });
}

export function sendToRoles(env: Bindings, roles: string[], type: string, data: any) {
  return rpc(env, '/send-to-role', { roles, message: { type, data } });
}

// ─────────────────────────────────────────────────────────────────
// Premise / officer-safety auto-push — every officer currently
// assigned to a call gets a direct prompt their MDT can voice out.
// ─────────────────────────────────────────────────────────────────

// Type name MUST match the client's WSMessageType union at
// client/src/types/index.ts. `premise_alert_for_unit` is what's
// already wired into the dispatcher/MDT subscribers.
export function pushPremiseAlertToOfficers(env: Bindings, officerUserIds: number[], alert: any) {
  return sendToUsers(env, officerUserIds, 'premise_alert_for_unit', alert);
}

// `dispatch_alert` is the existing officer-safety-flag channel in
// the client union — reuse it so we don't need a client-side type
// extension just to fire flags.
export function pushOfficerSafetyFlag(env: Bindings, officerUserIds: number[], flag: any) {
  return sendToUsers(env, officerUserIds, 'dispatch_alert', flag);
}
