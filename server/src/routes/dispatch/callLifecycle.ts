import { Router, Request, Response } from 'express';
import { getDb } from '../../models/database';
import { requireRole } from '../../middleware/auth';
import { validateParamId, validateParamIdMiddleware } from '../../middleware/sanitize';
import { broadcastDispatchUpdate, broadcastUnitUpdate } from '../../utils/websocket';
import { generateIncidentNumber } from '../../utils/caseNumbers';
import { localNow } from '../../utils/timeUtils';
import { auditLog } from '../../utils/auditLogger';

const router = Router();

// ── Upgrade 45: Legal status transition map ──
// Defines which status transitions are allowed.
const LEGAL_TRANSITIONS: Record<string, string[]> = {
  pending:     ['dispatched', 'cancelled', 'on_hold'],
  dispatched:  ['enroute', 'onscene', 'cleared', 'cancelled', 'on_hold', 'pending'],
  enroute:     ['onscene', 'cleared', 'cancelled', 'on_hold', 'dispatched'],
  onscene:     ['cleared', 'closed', 'cancelled', 'on_hold', 'enroute'],
  cleared:     ['closed', 'archived', 'onscene'],  // allow revert to onscene
  closed:      ['archived', 'cleared'],              // allow revert to cleared
  cancelled:   ['archived', 'pending'],              // allow reopen to pending
  on_hold:     ['pending', 'dispatched', 'enroute', 'onscene'],  // resume to any active
  archived:    ['closed'],                           // unarchive only
};

function isLegalTransition(fromStatus: string, toStatus: string): boolean {
  const allowed = LEGAL_TRANSITIONS[fromStatus];
  if (!allowed) return false;
  return allowed.includes(toStatus);
}

// ── Upgrade 46: Calculate response time in seconds ──
function calculateResponseTimeSeconds(createdAt: string | null, onsceneAt: string | null): number | null {
  if (!createdAt || !onsceneAt) return null;
  try {
    const created = new Date(createdAt);
    const onscene = new Date(onsceneAt);
    if (isNaN(created.getTime()) || isNaN(onscene.getTime())) return null;
    const diffMs = onscene.getTime() - created.getTime();
    if (diffMs < 0 || diffMs > 43200000) return null; // ignore negative or > 12 hours
    return Math.round(diffMs / 1000);
  } catch { return null; }
}

// POST /api/dispatch/calls/archive-bulk - Archive multiple cleared/closed/cancelled calls at once
// NOTE: This route MUST come before /calls/:id/archive to avoid Express matching "archive-bulk" as :id
router.post('/calls/archive-bulk', requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { call_ids, statuses } = req.body;

    const now = localNow();
    let callsToArchive: any[] = [];

    if (call_ids && Array.isArray(call_ids) && call_ids.length > 0) {
      if (call_ids.length > 500) {
        res.status(400).json({ error: 'Cannot archive more than 500 calls at once', code: 'CANNOT_ARCHIVE_MORE_THAN' });
        return;
      }
      // Validate all IDs are positive integers
      for (const id of call_ids) {
        const n = parseInt(String(id), 10);
        if (isNaN(n) || n < 1) {
          res.status(400).json({ error: 'All call_ids must be positive integers', code: 'ALL_CALLIDS_MUST_BE' });
          return;
        }
      }
      // Archive specific calls by ID
      const placeholders = call_ids.map(() => '?').join(',');
      callsToArchive = db.prepare(
        `SELECT * FROM calls_for_service WHERE id IN (${placeholders}) AND status != 'archived'`
      ).all(...call_ids);
    } else {
      // Archive all calls matching the given statuses (default: cleared, closed, cancelled)
      const validArchiveStatuses = ['pending', 'dispatched', 'enroute', 'onscene', 'cleared', 'closed', 'cancelled'];
      const targetStatuses = Array.isArray(statuses) && statuses.length > 0
        ? statuses.filter((s: any) => typeof s === 'string' && validArchiveStatuses.includes(s))
        : ['cleared', 'closed', 'cancelled'];
      const placeholders = targetStatuses.map(() => '?').join(',');
      callsToArchive = db.prepare(
        `SELECT * FROM calls_for_service WHERE status IN (${placeholders})`
      ).all(...targetStatuses);
    }

    if (callsToArchive.length === 0) {
      res.json({ archived_count: 0, message: 'No calls to archive' });
      return;
    }

    const archiveStmt = db.prepare('UPDATE calls_for_service SET status = ?, archived_at = ? WHERE id = ?');
    const freeUnitStmt = db.prepare(
      `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`
    );
    const logStmt = db.prepare(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, 'call_archived', 'call', ?, ?, ?)`
    );

    const archiveTransaction = db.transaction(() => {
      for (const call of callsToArchive) {
        archiveStmt.run('archived', now, call.id);

        // Free up any assigned units
        let unitIds: number[] = [];
        try { const p = JSON.parse(call.assigned_unit_ids || '[]'); unitIds = Array.isArray(p) ? p : []; } catch (parseErr) { console.error('[CallLifecycle] Failed to parse assigned_unit_ids for bulk archive:', parseErr instanceof Error ? parseErr.message : parseErr); }
        for (const unitId of unitIds) {
          freeUnitStmt.run(now, unitId, call.id);
        }

        logStmt.run(req.user!.userId, call.id, `${call.call_number} bulk archived`, req.ip || 'unknown');
      }
    });

    archiveTransaction();

    broadcastDispatchUpdate({ action: 'calls_bulk_archived', count: callsToArchive.length });

    res.json({ archived_count: callsToArchive.length, message: `${callsToArchive.length} call(s) archived` });
  } catch (error: any) {
    console.error('[CallLifecycle] bulk archive error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to bulk archive', code: 'CALLLIFECYCLE_BULK_ARCHIVE_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/archive - Archive a closed/cleared call
router.post('/calls/:id/archive', validateParamIdMiddleware, requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (call.status === 'archived') {
      res.status(400).json({ error: 'Call is already archived', code: 'CALL_IS_ALREADY_ARCHIVED' });
      return;
    }

    const now = localNow();

    // Transaction: archive call + free units + log activity atomically
    const archiveTx = db.transaction(() => {
      db.prepare('UPDATE calls_for_service SET status = ?, archived_at = ? WHERE id = ?')
        .run('archived', now, call.id);

      // Free up any assigned units when archiving
      let unitIds: number[] = [];
      try {
        const parsed = JSON.parse(call.assigned_unit_ids || '[]');
        unitIds = Array.isArray(parsed) ? parsed : [];
      } catch (parseErr) { console.error('[CallLifecycle] Failed to parse assigned_unit_ids for archive:', parseErr instanceof Error ? parseErr.message : parseErr); }
      for (const unitId of unitIds) {
        db.prepare(`UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?`)
          .run(now, unitId, call.id);
      }

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_archived', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${call.call_number} archived`, req.ip || 'unknown');
    });
    archiveTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_archived', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('[CallLifecycle] archive call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to archive call', code: 'CALLLIFECYCLE_ARCHIVE_CALL_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/unarchive - Restore archived call back to closed
router.post('/calls/:id/unarchive', validateParamIdMiddleware, requireRole('admin', 'manager', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (call.status !== 'archived') {
      res.status(400).json({ error: 'Call is not archived', code: 'CALL_IS_NOT_ARCHIVED' });
      return;
    }

    const unarchiveTx = db.transaction(() => {
      db.prepare('UPDATE calls_for_service SET status = ?, archived_at = NULL WHERE id = ?').run('closed', call.id);
      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_unarchived', 'call', ?, ?, ?)
      `).run(req.user!.userId, call.id, `${call.call_number} restored from archive`, req.ip || 'unknown');
    });
    unarchiveTx();

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(call.id);
    broadcastDispatchUpdate({ action: 'call_unarchived', call: updated });
    res.json(updated);
  } catch (error: any) {
    console.error('[CallLifecycle] unarchive call error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to unarchive call', code: 'CALLLIFECYCLE_UNARCHIVE_CALL_ERROR' });
  }
});

// DELETE /api/dispatch/calls/:id - Hard delete a call (admin/manager only)
router.delete('/calls/:id', validateParamIdMiddleware, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) { res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }); return; }

    const now = localNow();

    // Transaction: free units, nullify FKs, delete call atomically
    const deleteTx = db.transaction(() => {
      // If call has active units assigned, free them first
      let unitIds: number[] = [];
      try { const p = JSON.parse(call.assigned_unit_ids || '[]'); unitIds = Array.isArray(p) ? p : []; } catch (parseErr) { console.error('[CallLifecycle] Failed to parse assigned_unit_ids for delete:', parseErr instanceof Error ? parseErr.message : parseErr); }
      for (const unitId of unitIds) {
        db.prepare(`
          UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ? AND current_call_id = ?
        `).run(now, unitId, call.id);
      }

      // Nullify FK references in related tables before deleting the call
      try { db.prepare('UPDATE incidents SET call_id = NULL WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to nullify incidents FK:', e instanceof Error ? e.message : e); }
      try { db.prepare('UPDATE units SET current_call_id = NULL WHERE current_call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to nullify units FK:', e instanceof Error ? e.message : e); }
      try { db.prepare('DELETE FROM record_links WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)').run('call', String(call.id), 'call', String(call.id)); } catch (e) { console.error('[CallLifecycle] Failed to delete record_links:', e instanceof Error ? e.message : e); }

      // Delete child rows from non-cascading FK tables
      try { db.prepare('DELETE FROM call_visit_history WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete call_visit_history:', e instanceof Error ? e.message : e); }
      try { db.prepare('DELETE FROM call_persons WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete call_persons:', e instanceof Error ? e.message : e); }
      try { db.prepare('DELETE FROM call_vehicles WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete call_vehicles:', e instanceof Error ? e.message : e); }
      try { db.prepare('DELETE FROM call_units WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete call_units:', e instanceof Error ? e.message : e); }
      try { db.prepare("DELETE FROM dashcam_video_links WHERE entity_type = 'call' AND entity_id = ?").run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete dashcam_video_links:', e instanceof Error ? e.message : e); }
      // Additional FK tables
      try { db.prepare('DELETE FROM alarm_responses WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete alarm_responses:', e instanceof Error ? e.message : e); }
      try { db.prepare('UPDATE body_camera_recordings SET call_id = NULL WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to nullify body_camera_recordings FK:', e instanceof Error ? e.message : e); }
      try { db.prepare('DELETE FROM serve_queue WHERE call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete serve_queue:', e instanceof Error ? e.message : e); }
      try { db.prepare('UPDATE calls_for_service SET parent_call_id = NULL WHERE parent_call_id = ?').run(call.id); } catch (e) { console.error('[CallLifecycle] Failed to nullify child call parent_call_id:', e instanceof Error ? e.message : e); }

      // Delete related activity log entries
      try { db.prepare('DELETE FROM activity_log WHERE entity_type = ? AND entity_id = ?').run('call', call.id); } catch (e) { console.error('[CallLifecycle] Failed to delete activity_log entries:', e instanceof Error ? e.message : e); }

      db.prepare('DELETE FROM calls_for_service WHERE id = ?').run(call.id);

      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'call_deleted', 'call', ?, ?, ?)`).run(
        req.user!.userId, call.id, `Deleted call ${call.call_number}`, req.ip || 'unknown');
    });
    deleteTx();

    broadcastDispatchUpdate({ action: 'call_deleted', call_id: call.id });
    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error('[CallLifecycle] delete call error:', error?.message || 'Unknown error');
    const msg = error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
      ? 'Cannot delete: this call has linked records. Unlink them first.'
      : 'Failed to delete call';
    res.status(500).json({ error: msg, code: 'CALLLIFECYCLE_DELETE_CALL_ERROR' });
  }
});

// POST /api/dispatch/calls/:id/generate-incident - Generate incident report from a cleared/closed call
router.post('/calls/:id/generate-incident', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare(`
      SELECT c.*, p.name as property_name, p.address as property_address
      FROM calls_for_service c
      LEFT JOIN properties p ON c.property_id = p.id
      WHERE c.id = ?
    `).get(req.params.id) as any;

    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    if (!['cleared', 'closed'].includes(call.status)) {
      res.status(400).json({ error: 'Can only generate incident reports from cleared or closed calls', code: 'CAN_ONLY_GENERATE_INCIDENT' });
      return;
    }

    // Check if incident already exists for this call
    const existingIncident = db.prepare('SELECT id, incident_number FROM incidents WHERE call_id = ?').get(call.id) as any;
    if (existingIncident) {
      res.status(409).json({
        error: 'An incident report already exists for this call',
        incident_id: existingIncident.id,
        incident_number: existingIncident.incident_number
      });
      return;
    }

    // Generate incident number: RMP-YY-NNNNN-CODE
    const incidentNumber = generateIncidentNumber(db, call.incident_type);

    // Build narrative template from call data
    const narrativeParts: string[] = [];
    narrativeParts.push(`Incident generated from dispatch call ${call.call_number}.`);
    narrativeParts.push(`\nCall Type: ${(call.incident_type || '').replace(/_/g, ' ').toUpperCase()}`);
    narrativeParts.push(`Priority: ${call.priority}`);
    narrativeParts.push(`Location: ${call.location_address || 'Unknown'}`);
    if (call.property_name) narrativeParts.push(`Property: ${call.property_name}`);
    if (call.caller_name) narrativeParts.push(`Caller: ${call.caller_name}${call.caller_phone ? ` (${call.caller_phone})` : ''}`);
    if (call.description) narrativeParts.push(`\nCall Description: ${call.description}`);
    if (call.disposition) narrativeParts.push(`Disposition: ${call.disposition}`);
    narrativeParts.push(`\nCall Timeline:`);
    if (call.created_at) narrativeParts.push(`  Created: ${call.created_at}`);
    if (call.dispatched_at) narrativeParts.push(`  Dispatched: ${call.dispatched_at}`);
    if (call.enroute_at) narrativeParts.push(`  En Route: ${call.enroute_at}`);
    if (call.onscene_at) narrativeParts.push(`  On Scene: ${call.onscene_at}`);
    if (call.cleared_at) narrativeParts.push(`  Cleared: ${call.cleared_at}`);
    narrativeParts.push(`\n--- Officer narrative below ---\n`);

    const narrative = narrativeParts.join('\n');

    // Extract Mountain Time date/time from call timestamps
    const toMountain = (iso: string | null) => {
      if (!iso) return { date: '', time: '' };
      const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
      if (isNaN(d.getTime())) return { date: '', time: '' };
      const mt = d.toLocaleString('en-US', { timeZone: 'America/Denver', hour12: false });
      const [datePart, timePart] = mt.split(', ');
      const [m, day, yr] = datePart.split('/');
      return {
        date: `${yr}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`,
        time: timePart?.slice(0, 5) || '',
      };
    };
    const started = toMountain(call.created_at);
    const ended = toMountain(call.cleared_at);

    const result = db.prepare(`
      INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address,
        property_id, latitude, longitude, narrative, officer_id, client_id, contract_id,
        occurred_date, occurred_time, end_date, end_time,
        pso_service_type, pso_attempt_number, pso_requestor_name, pso_requestor_phone,
        pso_requestor_email, pso_billing_code, pso_authorization,
        process_service_type, process_served_to, process_served_address, process_service_result, process_served_at, process_attempts,
        alcohol_involved, drugs_involved, domestic_violence, weapons_involved,
        injuries_reported, mental_health_crisis, juvenile_involved, felony_in_progress,
        officer_safety_caution, k9_requested, ems_requested, fire_requested,
        hazmat, gang_related, evidence_collected, body_camera_active, photos_taken,
        trespass_issued, vehicle_pursuit, foot_pursuit, le_notified, supervisor_notified,
        section_id, zone_id, beat_id, disposition)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?)
    `).run(
      incidentNumber, call.id, call.incident_type, call.priority,
      call.location_address || call.property_address || null,
      call.property_id || null, call.latitude ?? null, call.longitude ?? null,
      narrative, req.user!.userId, call.client_id || null, call.contract_id || null,
      started.date || null, started.time || null, ended.date || null, ended.time || null,
      call.pso_service_type || null, call.pso_attempt_number || null,
      call.pso_requestor_name || null, call.pso_requestor_phone || null,
      call.pso_requestor_email || null, call.pso_billing_code || null,
      call.pso_authorization || null,
      call.process_service_type || null, call.process_served_to || null,
      call.process_served_address || null, call.process_service_result || null,
      call.process_served_at || null, call.process_attempts || null,
      // Flags from dispatch call
      call.alcohol_involved ? 1 : 0, call.drugs_involved ? 1 : 0,
      call.domestic_violence ? 1 : 0, call.weapons_involved || null,
      call.injuries_reported ? 1 : 0, call.mental_health_crisis ? 1 : 0,
      call.juvenile_involved ? 1 : 0, call.felony_in_progress ? 1 : 0,
      call.officer_safety_caution ? 1 : 0, call.k9_requested ? 1 : 0,
      call.ems_requested ? 1 : 0, call.fire_requested ? 1 : 0,
      call.hazmat ? 1 : 0, call.gang_related ? 1 : 0,
      call.evidence_collected ? 1 : 0, call.body_camera_active ? 1 : 0,
      call.photos_taken ? 1 : 0, call.trespass_issued ? 1 : 0,
      call.vehicle_pursuit ? 1 : 0, call.foot_pursuit ? 1 : 0,
      call.le_notified ? 1 : 0, call.supervisor_notified ? 1 : 0,
      // District from dispatch call
      call.section_id || null, call.zone_id || null, call.beat_id || null,
      call.disposition || null
    );

    // Auto-link persons from the dispatch call to the new incident
    const callPersons = db.prepare('SELECT person_id, role, notes FROM call_persons WHERE call_id = ?').all(call.id) as any[];
    if (callPersons.length > 0) {
      const insertPerson = db.prepare(
        'INSERT OR IGNORE INTO incident_persons (incident_id, person_id, role, notes, added_by) VALUES (?, ?, ?, ?, ?)'
      );
      for (const cp of callPersons) {
        insertPerson.run(Number(result.lastInsertRowid), cp.person_id, cp.role, cp.notes, req.user!.userId);
      }
    }

    const incident = db.prepare(`
      SELECT i.*, o.full_name as officer_name, o.badge_number, c.call_number
      FROM incidents i
      LEFT JOIN users o ON i.officer_id = o.id
      LEFT JOIN calls_for_service c ON i.call_id = c.id
      WHERE i.id = ?
    `).get(Number(result.lastInsertRowid));
    if (!incident) { res.status(500).json({ error: 'Failed to retrieve created incident', code: 'FAILED_TO_RETRIEVE_CREATED' }); return; }

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'incident_created', 'incident', ?, ?, ?)
    `).run(
      req.user!.userId, Number(result.lastInsertRowid),
      `Generated ${incidentNumber} from call ${call.call_number}`,
      req.ip || 'unknown'
    );

    // ── Link all chained calls to this incident report ──
    // Find root call (trace up through parent_call_id)
    let rootId = call.id;
    if (call.parent_call_id) {
      const root = db.prepare('SELECT id FROM calls_for_service WHERE id = ?').get(call.parent_call_id) as any;
      if (root) rootId = root.id;
    }
    // Find all calls in the chain (root + all children)
    const chainedCalls = db.prepare(`
      SELECT id, call_number FROM calls_for_service
      WHERE id = ? OR parent_call_id = ?
      ORDER BY id ASC
    `).all(rootId, rootId) as any[];

    if (chainedCalls.length > 1) {
      const incidentId = Number(result.lastInsertRowid);
      const updateCase = db.prepare('UPDATE calls_for_service SET case_number = ? WHERE id = ? AND (case_number IS NULL OR case_number = ?)');
      const linkNarrative: string[] = [`\n--- Linked Calls (${chainedCalls.length} in chain) ---`];
      for (const cc of chainedCalls) {
        // Set case_number on all calls in chain so they're cross-referenced
        updateCase.run(incidentNumber, cc.id, '');
        if (cc.id !== call.id) {
          linkNarrative.push(`  ${cc.call_number} (linked)`);
        }
      }
      // Append chain info to the incident narrative
      db.prepare('UPDATE incidents SET narrative = narrative || ?, linked_incidents = ? WHERE id = ?')
        .run(linkNarrative.join('\n'), JSON.stringify(chainedCalls.map((c: any) => c.call_number)), incidentId);
    }

    res.status(201).json(incident);
  } catch (error: any) {
    console.error('[CallLifecycle] generate incident error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to generate incident', code: 'CALLLIFECYCLE_GENERATE_INCIDENT_ERROR' });
  }
});

// PUT /api/dispatch/calls/:id/timeline/:entryId - Edit a timeline/activity entry
router.put('/calls/:id/timeline/:entryId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const entryId = parseInt(req.params.entryId, 10);
    if (isNaN(entryId) || entryId < 1) {
      res.status(400).json({ error: 'Invalid timeline entry ID', code: 'INVALID_TIMELINE_ENTRY_ID' });
      return;
    }

    const entry = db.prepare('SELECT * FROM activity_log WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(entryId, 'call', req.params.id) as any;
    if (!entry) {
      res.status(404).json({ error: 'Timeline entry not found', code: 'TIMELINE_ENTRY_NOT_FOUND' });
      return;
    }

    const { details } = req.body;
    // Note: created_at is intentionally NOT editable — audit log timestamps are immutable
    const updates: string[] = [];
    const params: any[] = [];
    if (details !== undefined) {
      if (typeof details !== 'string' || details.length > 5000) {
        res.status(400).json({ error: 'details must be a string of 5000 characters or less', code: 'DETAILS_MUST_BE_A' });
        return;
      }
      updates.push('details = ?'); params.push(details);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' });
      return;
    }

    params.push(entry.id);
    db.prepare(`UPDATE activity_log SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    auditLog(req, 'UPDATE', 'call', Number(req.params.id), `Edited timeline entry #${entry.id} on call #${req.params.id}`);

    const updated = db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?').get(entry.id);
    res.json(updated);
  } catch (error: any) {
    console.error('[CallLifecycle] update timeline entry error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to update timeline entry', code: 'CALLLIFECYCLE_UPDATE_TIMELINE_ENTRY' });
  }
});

// DELETE /api/dispatch/calls/:id/timeline/:entryId - Delete a timeline/activity entry
router.delete('/calls/:id/timeline/:entryId', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const delEntryId = parseInt(req.params.entryId, 10);
    if (isNaN(delEntryId) || delEntryId < 1) {
      res.status(400).json({ error: 'Invalid timeline entry ID', code: 'INVALID_TIMELINE_ENTRY_ID' });
      return;
    }

    const entry = db.prepare('SELECT * FROM activity_log WHERE id = ? AND entity_type = ? AND entity_id = ?')
      .get(delEntryId, 'call', req.params.id) as any;
    if (!entry) {
      res.status(404).json({ error: 'Timeline entry not found', code: 'TIMELINE_ENTRY_NOT_FOUND' });
      return;
    }

    db.prepare('DELETE FROM activity_log WHERE id = ?').run(entry.id);
    auditLog(req, 'DELETE', 'call', Number(req.params.id), `Deleted timeline entry #${entry.id} from call #${req.params.id}`);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[CallLifecycle] delete timeline entry error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to delete timeline entry', code: 'CALLLIFECYCLE_DELETE_TIMELINE_ENTRY' });
  }
});

// POST /api/dispatch/calls/:id/timeline - Add a manual timeline entry
router.post('/calls/:id/timeline', validateParamIdMiddleware, requireRole('admin', 'manager', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { action, details, created_at } = req.body;
    if (!details) {
      res.status(400).json({ error: 'details is required', code: 'DETAILS_IS_REQUIRED' });
      return;
    }
    if (typeof details !== 'string' || details.length > 5000) {
      res.status(400).json({ error: 'details must be a string of 5000 characters or less', code: 'DETAILS_MUST_BE_A' });
      return;
    }

    // Validate created_at if provided
    let timestamp = localNow();
    if (created_at) {
      if (typeof created_at !== 'string' || created_at.length > 50) {
        res.status(400).json({ error: 'created_at must be a valid date string', code: 'CREATEDAT_MUST_BE_A' });
        return;
      }
      const parsed = new Date(created_at);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'created_at is not a valid date', code: 'CREATEDAT_IS_NOT_A' });
        return;
      }
      if (parsed.getTime() > Date.now() + 60_000) { // Allow 1 min clock skew
        res.status(400).json({ error: 'created_at cannot be in the future', code: 'CREATEDAT_CANNOT_BE_IN' });
        return;
      }
      timestamp = created_at;
    }
    const result = db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'call', ?, ?, ?, ?)
    `).run(req.user!.userId, action || 'note_added', call.id, details, req.ip || 'unknown', timestamp);

    const entry = db.prepare('SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?').get(Number(result.lastInsertRowid));
    if (!entry) { res.status(500).json({ error: 'Failed to retrieve created entry', code: 'FAILED_TO_RETRIEVE_CREATED' }); return; }
    res.status(201).json(entry);
  } catch (error: any) {
    console.error('[CallLifecycle] add timeline entry error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to add timeline entry', code: 'CALLLIFECYCLE_ADD_TIMELINE_ENTRY' });
  }
});

// GET /api/dispatch/calls/:id/warnings - Get warning tags for a call
router.get('/calls/:id/warnings', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const warnings: Array<{ type: string; label: string; severity: 'critical' | 'high' | 'medium'; source: string }> = [];

    // Check call flags
    if (call.weapons_involved && call.weapons_involved !== 'None') {
      warnings.push({ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' });
    }
    if (call.domestic_violence) {
      warnings.push({ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' });
    }
    if (call.injuries_reported) {
      warnings.push({ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' });
    }
    if (call.alcohol_involved) {
      warnings.push({ type: 'ALCOHOL', label: 'ALCOHOL INVOLVED', severity: 'medium', source: 'call' });
    }
    if (call.drugs_involved) {
      warnings.push({ type: 'DRUGS', label: 'DRUGS INVOLVED', severity: 'medium', source: 'call' });
    }

    // Check linked persons for caution flags and warrants
    try {
      const linkedPersons = db.prepare(`
        SELECT p.id, p.first_name, p.last_name, p.caution_flags, p.is_sex_offender, p.gang_affiliation,
               p.probation_parole
        FROM incident_persons ip
        JOIN persons p ON ip.person_id = p.id
        JOIN incidents i ON ip.incident_id = i.id
        WHERE i.call_id = ?
      
        LIMIT 1000
      `).all(call.id) as any[];

      for (const person of linkedPersons) {
        if (person.caution_flags) {
          const flags = person.caution_flags.split(',').map((f: string) => f.trim()).filter(Boolean);
          for (const flag of flags) {
            warnings.push({
              type: 'CAUTION',
              label: flag.toUpperCase(),
              severity: 'high',
              source: `${person.first_name} ${person.last_name}`
            });
          }
        }
        if (person.is_sex_offender) {
          warnings.push({ type: 'SEX_OFFENDER', label: 'SEX OFFENDER', severity: 'critical', source: `${person.first_name} ${person.last_name}` });
        }
        if (person.gang_affiliation) {
          warnings.push({ type: 'GANG', label: 'GANG AFFILIATED', severity: 'critical', source: `${person.first_name} ${person.last_name}` });
        }
        if (person.probation_parole) {
          warnings.push({ type: 'PROBATION', label: 'ON PROBATION/PAROLE', severity: 'high', source: `${person.first_name} ${person.last_name}` });
        }
        // Pre-Trial Supervision
        if (person.probation_parole && person.probation_parole.toLowerCase().includes('pre-trial')) {
          warnings.push({ type: 'PTS', label: 'PRE-TRIAL SUPERVISION', severity: 'high', source: `${person.first_name} ${person.last_name}` });
        }
      }
    } catch (lpErr) { console.error('[CallLifecycle] Linked persons lookup error:', lpErr instanceof Error ? lpErr.message : lpErr); }

    // Check for active warrants at location
    try {
      const activeWarrants = db.prepare(`
        SELECT w.warrant_number, w.charge_description, w.type, w.offense_level,
               p.first_name, p.last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
        AND (w.subject_person_id IN (
          SELECT ip.person_id FROM incident_persons ip
          JOIN incidents i ON ip.incident_id = i.id
          WHERE i.call_id = ?
        ))
      
        LIMIT 1000
      `).all(call.id) as any[];

      for (const warrant of activeWarrants) {
        warnings.push({
          type: 'WARRANT',
          label: `ACTIVE WARRANT: ${warrant.charge_description || warrant.type}`.toUpperCase(),
          severity: 'critical',
          source: `${warrant.first_name || ''} ${warrant.last_name || ''}`.trim() || warrant.warrant_number
        });
      }
    } catch (wErr) { console.error('[CallLifecycle] Warrants lookup error:', wErr instanceof Error ? wErr.message : wErr); }

    // Check property hazard notes
    if (call.property_id) {
      try {
        const property = db.prepare('SELECT hazard_notes, post_orders FROM properties WHERE id = ?').get(call.property_id) as any;
        if (property?.hazard_notes) {
          warnings.push({ type: 'HAZARD', label: 'PROPERTY HAZARD', severity: 'high', source: 'Property file' });
        }
      } catch (propErr) { console.error('[CallLifecycle] Property hazard lookup error:', propErr instanceof Error ? propErr.message : propErr); }
    }

    // Incident type-based warnings
    const itype = (call.incident_type || '').toLowerCase();
    if (itype.includes('shooting') || itype.includes('shots_fired') || itype.includes('armed')) {
      if (!warnings.find(w => w.type === 'ARMED')) {
        warnings.push({ type: 'ARMED', label: 'POSSIBLE WEAPONS', severity: 'critical', source: 'Incident type' });
      }
    }
    if (itype.includes('barricade') || itype.includes('hostage') || itype.includes('standoff')) {
      warnings.push({ type: 'BARRICADE', label: 'BARRICADED SUBJECT', severity: 'critical', source: 'Incident type' });
    }
    if (itype.includes('hazmat') || itype.includes('chemical') || itype.includes('spill')) {
      warnings.push({ type: 'HAZMAT', label: 'HAZMAT', severity: 'critical', source: 'Incident type' });
    }

    res.json(warnings);
  } catch (error: any) {
    console.error('[CallLifecycle] get warnings error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get warnings', code: 'CALLLIFECYCLE_GET_WARNINGS_ERROR' });
  }
});

// PUT /api/dispatch/calls/:id/mileage - Update starting/ending mileage
router.put('/calls/:id/mileage', validateParamIdMiddleware, requireRole('admin', 'manager', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { starting_mileage, ending_mileage } = req.body;

    // Validate mileage values
    if (starting_mileage !== undefined && starting_mileage !== null && (isNaN(Number(starting_mileage)) || Number(starting_mileage) < 0 || Number(starting_mileage) > 9999999)) {
      res.status(400).json({ error: 'Invalid starting mileage', code: 'INVALID_STARTING_MILEAGE' }); return;
    }
    if (ending_mileage !== undefined && ending_mileage !== null && (isNaN(Number(ending_mileage)) || Number(ending_mileage) < 0 || Number(ending_mileage) > 9999999)) {
      res.status(400).json({ error: 'Invalid ending mileage', code: 'INVALID_ENDING_MILEAGE' }); return;
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (starting_mileage !== undefined) {
      updates.push('starting_mileage = ?');
      params.push(starting_mileage ?? null);
    }
    if (ending_mileage !== undefined) {
      updates.push('ending_mileage = ?');
      params.push(ending_mileage ?? null);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No mileage fields provided', code: 'NO_MILEAGE_FIELDS_PROVIDED' });
      return;
    }

    updates.push('updated_at = ?');
    params.push(localNow());
    params.push(req.params.id);

    db.prepare(`UPDATE calls_for_service SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Log activity
    const details = [];
    if (starting_mileage !== undefined) details.push(`start: ${starting_mileage}`);
    if (ending_mileage !== undefined) details.push(`end: ${ending_mileage}`);
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'mileage_updated', 'call', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Mileage for ${call.call_number}: ${details.join(', ')}`, req.ip || 'unknown');

    const updated = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id);
    broadcastDispatchUpdate({ action: 'call_updated', call: updated });

    res.json(updated);
  } catch (error: any) {
    console.error('[CallLifecycle] mileage update error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to mileage update', code: 'CALLLIFECYCLE_MILEAGE_UPDATE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 47: POST /api/dispatch/calls/:id/validate-transition — Check if status transition is legal
// ═══════════════════════════════════════════════════════════
router.post('/calls/:id/validate-transition', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT id, call_number, status FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    const { target_status } = req.body;
    if (!target_status) {
      res.status(400).json({ error: 'target_status is required', code: 'TARGET_STATUS_REQUIRED' });
      return;
    }

    const legal = isLegalTransition(call.status, target_status);
    const allowed = LEGAL_TRANSITIONS[call.status] || [];

    res.json({
      current_status: call.status,
      target_status,
      allowed: legal,
      valid_transitions: allowed,
      call_number: call.call_number,
    });
  } catch (error: any) {
    console.error('[CallLifecycle] validate transition error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to validate transition', code: 'VALIDATE_TRANSITION_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 48: GET /api/dispatch/calls/:id/response-time — Get computed response metrics
// ═══════════════════════════════════════════════════════════
router.get('/calls/:id/response-time', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    // Upgrade 49: Detailed time breakdown
    const created = call.created_at ? new Date(call.created_at) : null;
    const dispatched = call.dispatched_at ? new Date(call.dispatched_at) : null;
    const enroute = call.enroute_at ? new Date(call.enroute_at) : null;
    const onscene = call.onscene_at ? new Date(call.onscene_at) : null;
    const cleared = call.cleared_at ? new Date(call.cleared_at) : null;

    const safeDiff = (a: Date | null, b: Date | null): number | null => {
      if (!a || !b) return null;
      const diff = b.getTime() - a.getTime();
      if (diff < 0 || diff > 86400000) return null; // max 24 hours
      return Math.round(diff / 1000);
    };

    // Upgrade 50: Time in queue, travel time, on-scene duration
    const queueTimeSec = safeDiff(created, dispatched);
    const travelTimeSec = safeDiff(dispatched, enroute);
    const arrivalTimeSec = safeDiff(enroute, onscene);
    const totalResponseSec = safeDiff(created, onscene);
    const onSceneDurationSec = safeDiff(onscene, cleared);
    const totalCallDurationSec = safeDiff(created, cleared);

    res.json({
      call_number: call.call_number,
      priority: call.priority,
      queue_time_seconds: queueTimeSec,
      travel_time_seconds: travelTimeSec,
      arrival_time_seconds: arrivalTimeSec,
      total_response_seconds: totalResponseSec,
      on_scene_duration_seconds: onSceneDurationSec,
      total_call_duration_seconds: totalCallDurationSec,
      // Human-readable
      total_response_minutes: totalResponseSec ? Math.round(totalResponseSec / 6) / 10 : null,
      on_scene_duration_minutes: onSceneDurationSec ? Math.round(onSceneDurationSec / 6) / 10 : null,
      timestamps: {
        created_at: call.created_at,
        dispatched_at: call.dispatched_at,
        enroute_at: call.enroute_at,
        onscene_at: call.onscene_at,
        cleared_at: call.cleared_at,
        closed_at: call.closed_at,
      },
    });
  } catch (error: any) {
    console.error('[CallLifecycle] response time error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get response time', code: 'RESPONSE_TIME_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 51: POST /api/dispatch/calls/:id/auto-close — Auto-close stale calls
// ═══════════════════════════════════════════════════════════
router.post('/calls/auto-close-stale', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { hours = 24, status_filter = ['cleared'] } = req.body;
    const maxHours = Math.max(1, Math.min(720, Number(hours) || 24));
    const now = localNow();

    // Upgrade 52: Find calls in cleared state older than threshold
    const validFilters = ['cleared'];
    const filters = (Array.isArray(status_filter) ? status_filter : [status_filter]).filter(
      (s: string) => validFilters.includes(s)
    );
    if (filters.length === 0) {
      res.status(400).json({ error: 'status_filter must include valid statuses (cleared)', code: 'INVALID_STATUS_FILTER' });
      return;
    }

    const placeholders = filters.map(() => '?').join(',');
    const cutoffTime = new Date(Date.now() - maxHours * 60 * 60 * 1000).toISOString();

    const staleCalls = db.prepare(`
      SELECT id, call_number, status, cleared_at
      FROM calls_for_service
      WHERE status IN (${placeholders}) AND cleared_at IS NOT NULL AND cleared_at < ?
    `).all(...filters, cutoffTime) as any[];

    if (staleCalls.length === 0) {
      res.json({ closed_count: 0, message: 'No stale calls to auto-close' });
      return;
    }

    // Upgrade 53: Auto-close in transaction
    let closedCount = 0;
    const closeTx = db.transaction(() => {
      for (const call of staleCalls) {
        db.prepare(`UPDATE calls_for_service SET status = 'closed', closed_at = COALESCE(closed_at, ?), status_changed_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, now, call.id);
        closedCount++;
      }
      db.prepare(`INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'auto_close_stale', 'call', 0, ?, ?)`).run(
        req.user!.userId, `Auto-closed ${closedCount} stale call(s) older than ${maxHours}h`, req.ip || 'unknown');
    });
    closeTx();

    broadcastDispatchUpdate({ action: 'calls_auto_closed', count: closedCount });
    res.json({ closed_count: closedCount, message: `Auto-closed ${closedCount} stale call(s)` });
  } catch (error: any) {
    console.error('[CallLifecycle] auto-close stale error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to auto-close stale calls', code: 'AUTO_CLOSE_STALE_ERROR' });
  }
});

// ═══════════════════════════════════════════════════════════
// Upgrade 54: GET /api/dispatch/calls/:id/timeline-summary — Condensed timeline
// ═══════════════════════════════════════════════════════════
router.get('/calls/:id/timeline-summary', validateParamIdMiddleware, requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const call = db.prepare('SELECT * FROM calls_for_service WHERE id = ?').get(req.params.id) as any;
    if (!call) {
      res.status(404).json({ error: 'Call not found', code: 'CALL_NOT_FOUND' });
      return;
    }

    // Upgrade 55: Build structured timeline from timestamps
    const timeline: Array<{ event: string; timestamp: string | null; elapsed_seconds: number | null }> = [];
    const baseTime = call.created_at ? new Date(call.created_at).getTime() : null;

    const addEvent = (event: string, ts: string | null) => {
      let elapsed: number | null = null;
      if (ts && baseTime) {
        const t = new Date(ts).getTime();
        if (!isNaN(t)) elapsed = Math.round((t - baseTime) / 1000);
      }
      timeline.push({ event, timestamp: ts, elapsed_seconds: elapsed });
    };

    addEvent('created', call.created_at);
    addEvent('dispatched', call.dispatched_at);
    addEvent('enroute', call.enroute_at);
    addEvent('onscene', call.onscene_at);
    addEvent('cleared', call.cleared_at);
    addEvent('closed', call.closed_at);
    addEvent('archived', call.archived_at);

    // Upgrade 56: Count of activity log entries by action type
    const actionCounts = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM activity_log
      WHERE entity_type = 'call' AND entity_id = ?
      GROUP BY action
      ORDER BY count DESC
    `).all(call.id);

    // Upgrade 57: Response time stored on the call
    const responseTimeSec = calculateResponseTimeSeconds(call.created_at, call.onscene_at);

    res.json({
      call_number: call.call_number,
      current_status: call.status,
      timeline: timeline.filter(t => t.timestamp),
      action_counts: actionCounts,
      response_time_seconds: responseTimeSec,
      response_time_minutes: responseTimeSec ? Math.round(responseTimeSec / 6) / 10 : null,
    });
  } catch (error: any) {
    console.error('[CallLifecycle] timeline summary error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Failed to get timeline summary', code: 'TIMELINE_SUMMARY_ERROR' });
  }
});

export default router;
