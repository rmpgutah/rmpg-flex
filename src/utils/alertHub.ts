// emitAlert — the one helper every rewrite route handler uses to fan an
// officer-safety event to the whole fleet through the global AlertHubDO.
//
// Replaces the dead broadcastAll() path in src/routes/ws.ts for cross-device
// alerts: broadcastAll only reaches THIS isolate's sockets (empty, because the
// client's main /api/ws socket lives on the legacy worker). AlertHubDO is a
// single global Durable Object every client connects to directly, so emit
// here reaches every connected console/MDT.
//
// Fire-and-forget by design: a panic must never be blocked on alert fan-out.
// Callers can `await` it (it's cheap — one DO fetch) or drop it in ctx.waitUntil.

interface AlertEnv {
  ALERT_HUB?: DurableObjectNamespace;
}

/**
 * Broadcast an officer-safety event to all connected clients via AlertHubDO.
 * @param type  the WS message type the client subscribe bus keys on (e.g. 'panic_alert')
 * @param data  the rest of the frame (e.g. { action:'panic_activated', panic })
 *              — merged flat into the broadcast, matching broadcastAll's shape.
 */
export async function emitAlert(env: AlertEnv, type: string, data: Record<string, unknown>): Promise<void> {
  if (!env.ALERT_HUB) return; // binding absent (e.g. a stripped test env) — no-op
  try {
    const id = env.ALERT_HUB.idFromName('global');
    const stub = env.ALERT_HUB.get(id);
    // panic_id is pulled to the top level so the DO's forced-ack lifecycle can
    // key on it without re-deriving from the nested panic object.
    const panicId = (data.panic as { id?: number } | undefined)?.id
      ?? (data.panic_id as number | undefined);
    await stub.fetch('https://alert-hub/emit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, action: data.action, panic_id: panicId, data }),
    });
  } catch (err) {
    console.error('[emitAlert] fan-out failed (non-fatal)', err);
  }
}
