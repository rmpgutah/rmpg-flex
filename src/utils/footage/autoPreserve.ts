import type { Bindings } from '../../types';
import { getDb, queryFirst, execute } from '../db';
import { enqueueFootage } from './captureOrchestrator';
import { footageEvidenceNumber, logCustody } from './evidence';

const PRE_MS = 2 * 60_000;   // 2 min before
const POST_MS = 5 * 60_000;  // 5 min after

/** Best-effort: preserve + auto-lock footage around a critical event. Caller wraps
 *  in try/catch; returns the footage_requests id or null. */
export async function preserveForEvent(env: Bindings, p: {
  eventType: 'panic_alert' | 'use_of_force' | 'incident';
  eventId: number; reason: 'panic' | 'use_of_force' | 'incident';
  unitId: number | null; officerUserId: number | null; callId?: number | null; eventTs: number;
}): Promise<number | null> {
  const db = getDb(env);
  if (!p.unitId) return null;
  const map = await queryFirst<{ cpg_camera_id: number | null; cpg_device_id: string }>(
    db, 'SELECT cpg_camera_id, cpg_device_id FROM cpg_device_mappings WHERE unit_id=? AND is_active=1 LIMIT 1', p.unitId).catch(() => null);
  const assetId = map?.cpg_camera_id ?? 0;
  if (!assetId) return null;

  const requestId = await enqueueFootage(env, {
    assetId, unitId: p.unitId, cpgDeviceId: map!.cpg_device_id, callId: p.callId ?? null,
    fromTs: p.eventTs - PRE_MS, toTs: p.eventTs + POST_MS, reason: 'critical_event',
    title: `${p.reason.toUpperCase()} #${p.eventId}`, createdBy: p.officerUserId ?? null,
  }).catch(() => null);
  if (!requestId) return null;

  // Auto-lock as evidence + chain-of-custody. Year from the event timestamp.
  const year = Number(new Date(p.eventTs).toISOString().slice(0, 4)); // new-date-ok
  const seqRow = await queryFirst<{ n: number }>(db,
    "SELECT COUNT(*) AS n FROM footage_requests WHERE evidence_number IS NOT NULL AND substr(evidence_number,1,2)=?",
    String(year).slice(-2)).catch(() => ({ n: 0 }));
  const evNum = footageEvidenceNumber(year, (seqRow?.n ?? 0) + 1);
  await execute(db,
    `UPDATE footage_requests SET evidence_locked=1, classification='evidence',
       preserved_reason=?, preserved_event_type=?, preserved_event_id=?, evidence_number=COALESCE(evidence_number, ?), updated_at=datetime('now')
     WHERE id=?`,
    p.reason, p.eventType, p.eventId, evNum, requestId).catch(() => {});
  await logCustody(db, { requestId, action: 'preserved', actorUserId: p.officerUserId, detail: { eventType: p.eventType, eventId: p.eventId } });
  await logCustody(db, { requestId, action: 'locked', actorUserId: p.officerUserId, reason: `auto-locked on ${p.reason}` });
  // Link to the originating event's incident/UoF + call when present.
  if (p.eventType === 'incident') {
    await execute(db, `INSERT OR IGNORE INTO footage_evidence_links (footage_request_id, entity_type, entity_id, linked_by) VALUES (?, 'incident', ?, ?)`, requestId, p.eventId, p.officerUserId ?? null).catch(() => {});
  } else if (p.eventType === 'use_of_force') {
    await execute(db, `INSERT OR IGNORE INTO footage_evidence_links (footage_request_id, entity_type, entity_id, linked_by) VALUES (?, 'use_of_force', ?, ?)`, requestId, p.eventId, p.officerUserId ?? null).catch(() => {});
  }
  if (p.callId) {
    await execute(db, `INSERT OR IGNORE INTO footage_evidence_links (footage_request_id, entity_type, entity_id, linked_by) VALUES (?, 'call', ?, ?)`, requestId, p.callId, p.officerUserId ?? null).catch(() => {});
  }
  return requestId;
}
