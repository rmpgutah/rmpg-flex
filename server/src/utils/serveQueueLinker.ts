// ============================================================
// RMPG Flex — Serve Queue Linker Utility
// ============================================================
// Extracted from callActions.ts send-to-serve logic.
// Creates a serve_queue entry from a dispatch call when the
// incident type is 'pso_client_request' or 'process_service'.
//
// Used by:
//   - intake.ts (auto-send on portal intake)
//   - calls.ts (auto-send on manual dispatch creation)
//   - callActions.ts (manual send-to-serve button)
// ============================================================

import { localNow, localToday } from './timeUtils';
import { notifyPortalStatusUpdate } from './portalCallback';

// ── Document type mapping ────────────────────────────────────

const DOC_TYPE_MAP: Record<string, string> = {
  subpoena: 'subpoena',
  summons: 'summons',
  complaint: 'complaint',
  eviction: 'eviction',
  restraining_order: 'restraining_order',
  writ: 'writ',
  order: 'order',
  notice: 'notice',
  petition: 'petition',
};

// ── Priority mapping (dispatch P1-P5 → serve queue) ──────────

const PRIORITY_MAP: Record<string, string> = {
  P1: 'rush',
  P2: 'high',
  P3: 'normal',
  P4: 'low',
  P5: 'low',
};

// ── Main export ──────────────────────────────────────────────

/**
 * Create a serve_queue entry from a dispatch call.
 *
 * @param db      - The better-sqlite3 database instance
 * @param call    - The full calls_for_service row
 * @param userId  - Optional user ID for activity log attribution
 * @returns       The new serve_queue row ID, or null if the call
 *                is not eligible or a duplicate entry already exists.
 */
export function createServeQueueFromCall(db: any, call: any, userId?: number): number | null {
  // 1. Validate incident type
  if (call.incident_type !== 'pso_client_request' && call.incident_type !== 'process_service') {
    return null;
  }

  // 2. Check for duplicate
  const existing = db.prepare('SELECT id FROM serve_queue WHERE call_id = ?').get(call.id) as any;
  if (existing) {
    return null;
  }

  const now = localNow();

  // 3. Parse recipient
  const recipientName = call.process_served_to || call.reporting_party || call.caller_name || call.subject || 'Unknown';

  // 4. Parse address into components (simple comma split)
  const addrParts = (call.process_served_address || call.location_address || '').split(',').map((s: string) => s.trim());
  const recipientAddress = addrParts[0] || call.location_address || '';
  const recipientCity = addrParts[1] || '';
  const recipientState = addrParts[2] || 'UT';
  const recipientZip = addrParts[3] || '';

  // 5. Try to get assigned officer
  let officerId: number | null = null;
  try {
    const unitIds = JSON.parse(call.assigned_unit_ids || '[]');
    if (Array.isArray(unitIds) && unitIds.length > 0) {
      const unit = db.prepare('SELECT officer_id FROM units WHERE id = ?').get(unitIds[0]) as any;
      if (unit?.officer_id) officerId = unit.officer_id;
    }
  } catch (parseErr) {
    console.error('[ServeQueueLinker] Failed to parse assigned_unit_ids:', parseErr instanceof Error ? parseErr.message : parseErr);
  }

  // 6. Map document type
  const documentType = DOC_TYPE_MAP[call.process_service_type] || call.process_service_type || 'civil';

  // 7. Map priority
  const servePriority = PRIORITY_MAP[call.priority] || 'normal';

  // 8. INSERT into serve_queue
  const info = db.prepare(`
    INSERT INTO serve_queue (
      call_id, officer_id, serve_date, recipient_name,
      recipient_address, recipient_city, recipient_state, recipient_zip,
      recipient_lat, recipient_lng, document_type, case_number,
      client_name, priority, max_attempts, service_instructions, notes,
      status, attempt_count, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 999, ?, ?)
  `).run(
    call.id, officerId,
    localToday(),
    recipientName,
    recipientAddress, recipientCity, recipientState, recipientZip,
    call.latitude || null, call.longitude || null,
    documentType, call.case_number || '',
    call.pso_requestor_name || '', servePriority,
    3, '', `From dispatch ${call.call_number}`,
    now, now,
  );

  const serveJobId = Number(info.lastInsertRowid);

  // 9. Update the call's activity log
  try {
    const activities = JSON.parse(call.activity_log || '[]');
    activities.push({
      action: 'sent_to_serve_queue',
      timestamp: now,
      user_id: userId ?? null,
      details: `Auto-sent to serve queue (ID: ${serveJobId})`,
    });
    db.prepare('UPDATE calls_for_service SET activity_log = ? WHERE id = ?').run(JSON.stringify(activities), call.id);
  } catch (logErr) {
    console.error('[ServeQueueLinker] Failed to update activity_log:', logErr instanceof Error ? logErr.message : logErr);
  }

  // 10. Notify portal of new serve entry (fire-and-forget)
  try {
    notifyPortalStatusUpdate(call);
  } catch { /* fire-and-forget */ }

  return serveJobId;
}
