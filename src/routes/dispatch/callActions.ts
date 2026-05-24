// Call actions — the assorted endpoints the legacy callActions.ts
// and callLifecycle.ts exposed that didn't fit the existing Hono calls.ts.
//
// Includes: notes/timeline, warnings (officer-safety auto-push),
// generate-incident, mileage, validate-transition, response-time,
// timeline-summary. Each note add and warning recompute can fire a
// targeted MDT message so the assigned officers' voice queue speaks
// it ("Note added" — short status form).

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import {
  broadcastDispatchUpdate,
  sendToUsers,
  pushPremiseAlertToOfficers,
  pushOfficerSafetyFlag,
} from '../../lib/broadcast';

const actions = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────────

async function getCall(db: ReturnType<typeof getDb>, id: string | number) {
  return queryFirst<Record<string, unknown>>(
    db, 'SELECT * FROM calls_for_service WHERE id = ?', id,
  );
}

async function getOfficerUserIdsForCall(db: ReturnType<typeof getDb>, call: any): Promise<number[]> {
  if (!call?.assigned_unit_ids) return [];
  let unitIds: number[] = [];
  try { unitIds = JSON.parse(String(call.assigned_unit_ids)); } catch { return []; }
  if (unitIds.length === 0) return [];
  const placeholders = unitIds.map(() => '?').join(',');
  const rows = await query<{ officer_id: number | null }>(
    db, `SELECT officer_id FROM units WHERE id IN (${placeholders}) AND officer_id IS NOT NULL`, ...unitIds,
  );
  return rows.map(r => r.officer_id!).filter((id): id is number => typeof id === 'number');
}

// ── Notes / timeline ────────────────────────────────────────────

// POST /dispatch/calls/:id/notes — adds an activity_log entry and
// pushes a short "Note added" status to each assigned officer's MDT.
actions.post('/calls/:id/notes', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const id = c.req.param('id');
  const { details, action } = await c.req.json<{ details: string; action?: string }>();
  if (!details || typeof details !== 'string') return c.json({ error: 'details required' }, 400);
  if (details.length > 5000) return c.json({ error: 'details too long' }, 400);

  const call = await getCall(db, id);
  if (!call) return c.json({ error: 'Call not found' }, 404);

  const result = await execute(
    db,
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, 'call', ?, ?, datetime('now'))`,
    userId, action || 'note_added', id, details,
  );
  const entry = await queryFirst(
    db,
    `SELECT al.*, u.full_name as user_name
     FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
     WHERE al.id = ?`,
    Number(result.meta.last_row_id),
  );

  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_note_added', call_id: Number(id), entry,
  }).then(() => {}));

  // Short status to officers' MDTs — voice queue speaks "Note added".
  const officerIds = await getOfficerUserIdsForCall(db, call);
  if (officerIds.length > 0) {
    c.executionCtx.waitUntil(sendToUsers(c.env, officerIds, 'call_status_for_officer', {
      action: 'note_added', call_id: Number(id), short: 'Note added',
    }).then(() => {}));
  }
  return c.json(entry, 201);
});

actions.put('/calls/:id/timeline/:entryId', async (c) => {
  const db = getDb(c.env);
  const { details } = await c.req.json<{ details: string }>();
  if (typeof details !== 'string' || details.length > 5000) return c.json({ error: 'invalid details' }, 400);
  const entryId = parseInt(c.req.param('entryId'), 10);
  if (isNaN(entryId)) return c.json({ error: 'invalid entry id' }, 400);
  const entry = await queryFirst(
    db, `SELECT id FROM activity_log WHERE id = ? AND entity_type = 'call' AND entity_id = ?`,
    entryId, c.req.param('id'),
  );
  if (!entry) return c.json({ error: 'Timeline entry not found' }, 404);
  await execute(db, 'UPDATE activity_log SET details = ? WHERE id = ?', details, entryId);
  const updated = await queryFirst(
    db,
    `SELECT al.*, u.full_name as user_name
     FROM activity_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.id = ?`,
    entryId,
  );
  return c.json(updated);
});

actions.delete('/calls/:id/timeline/:entryId', async (c) => {
  const db = getDb(c.env);
  const entryId = parseInt(c.req.param('entryId'), 10);
  if (isNaN(entryId)) return c.json({ error: 'invalid entry id' }, 400);
  await execute(
    db, `DELETE FROM activity_log WHERE id = ? AND entity_type = 'call' AND entity_id = ?`,
    entryId, c.req.param('id'),
  );
  return c.json({ success: true });
});

// ── Warnings (officer-safety auto-push on lookup) ───────────────
// Mirrors legacy /:id/warnings. Each call into this endpoint also
// fires `pushOfficerSafetyFlag` to every assigned officer's MDT
// when a critical-severity warning is present, so the voice queue
// speaks it during enroute even if the officer never opens the call
// detail panel.

interface Warning {
  type: string;
  label: string;
  severity: 'critical' | 'high' | 'medium';
  source: string;
}

actions.get('/calls/:id/warnings', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const call = await getCall(db, id) as any;
  if (!call) return c.json({ error: 'Call not found' }, 404);

  const warnings: Warning[] = [];

  // Call-level flags
  if (call.weapons_involved) warnings.push({ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' });
  if (call.domestic_violence) warnings.push({ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' });
  if (call.injuries_reported) warnings.push({ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' });
  if (call.mental_health_crisis) warnings.push({ type: 'MH', label: 'MENTAL HEALTH', severity: 'high', source: 'call' });
  if (call.felony_in_progress) warnings.push({ type: 'FELONY', label: 'FELONY IN PROGRESS', severity: 'critical', source: 'call' });
  if (call.officer_safety_caution) warnings.push({ type: 'OS', label: 'OFFICER SAFETY', severity: 'critical', source: 'call' });
  if (call.hazmat) warnings.push({ type: 'HAZMAT', label: 'HAZMAT', severity: 'critical', source: 'call' });
  if (call.gang_related) warnings.push({ type: 'GANG', label: 'GANG RELATED', severity: 'high', source: 'call' });

  // Incident-type heuristics
  const itype = String(call.incident_type || '').toLowerCase();
  if (/shooting|shots_fired|armed/.test(itype) && !warnings.find(w => w.type === 'ARMED')) {
    warnings.push({ type: 'ARMED', label: 'POSSIBLE WEAPONS', severity: 'critical', source: 'Incident type' });
  }
  if (/barricade|hostage|standoff/.test(itype)) {
    warnings.push({ type: 'BARRICADE', label: 'BARRICADED SUBJECT', severity: 'critical', source: 'Incident type' });
  }

  // Push critical warnings to assigned officers' MDTs — they hear it
  // even if the call panel isn't focused. Filtered to critical to
  // avoid voice spam on low-severity flags.
  const criticals = warnings.filter(w => w.severity === 'critical');
  if (criticals.length > 0) {
    const officerIds = await getOfficerUserIdsForCall(db, call);
    if (officerIds.length > 0) {
      c.executionCtx.waitUntil(pushOfficerSafetyFlag(c.env, officerIds, {
        call_id: Number(id), call_number: call.call_number, warnings: criticals,
      }).then(() => {}));
    }
  }
  return c.json(warnings);
});

// ── Validate transition (read-only legality check) ──────────────

const LEGAL_TRANSITIONS: Record<string, string[]> = {
  pending:     ['dispatched', 'cancelled', 'on_hold'],
  dispatched:  ['enroute', 'onscene', 'cleared', 'cancelled', 'on_hold', 'pending'],
  enroute:     ['onscene', 'cleared', 'cancelled', 'on_hold', 'dispatched'],
  onscene:     ['cleared', 'closed', 'cancelled', 'on_hold', 'enroute'],
  cleared:     ['closed', 'archived', 'onscene'],
  closed:      ['archived', 'cleared'],
  cancelled:   ['archived', 'pending'],
  on_hold:     ['pending', 'dispatched', 'enroute', 'onscene'],
  archived:    ['closed'],
};

actions.post('/calls/:id/validate-transition', async (c) => {
  const db = getDb(c.env);
  const call = await queryFirst<{ status: string; call_number: string }>(
    db, 'SELECT status, call_number FROM calls_for_service WHERE id = ?', c.req.param('id'),
  );
  if (!call) return c.json({ error: 'Call not found' }, 404);
  const { target_status } = await c.req.json<{ target_status: string }>();
  const allowed = LEGAL_TRANSITIONS[call.status] || [];
  return c.json({
    current_status: call.status,
    target_status,
    allowed: allowed.includes(target_status),
    valid_transitions: allowed,
    call_number: call.call_number,
  });
});

// ── Response time / timeline summary (read-only computed) ───────

const safeDiffSec = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const at = new Date(a).getTime();
  const bt = new Date(b).getTime();
  if (isNaN(at) || isNaN(bt)) return null;
  const diff = bt - at;
  if (diff < 0 || diff > 86_400_000) return null;
  return Math.round(diff / 1000);
};

actions.get('/calls/:id/response-time', async (c) => {
  const db = getDb(c.env);
  const call = await getCall(db, c.req.param('id')) as any;
  if (!call) return c.json({ error: 'Call not found' }, 404);
  return c.json({
    call_number: call.call_number,
    priority: call.priority,
    queue_time_seconds: safeDiffSec(call.created_at, call.dispatched_at),
    travel_time_seconds: safeDiffSec(call.dispatched_at, call.enroute_at),
    arrival_time_seconds: safeDiffSec(call.enroute_at, call.onscene_at),
    total_response_seconds: safeDiffSec(call.created_at, call.onscene_at),
    on_scene_duration_seconds: safeDiffSec(call.onscene_at, call.cleared_at),
    total_call_duration_seconds: safeDiffSec(call.created_at, call.cleared_at),
    timestamps: {
      created_at: call.created_at, dispatched_at: call.dispatched_at,
      enroute_at: call.enroute_at, onscene_at: call.onscene_at,
      cleared_at: call.cleared_at, closed_at: call.closed_at,
    },
  });
});

actions.get('/calls/:id/timeline-summary', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const call = await getCall(db, id) as any;
  if (!call) return c.json({ error: 'Call not found' }, 404);
  const baseTime = call.created_at ? new Date(call.created_at).getTime() : null;
  const events = ['created_at', 'dispatched_at', 'enroute_at', 'onscene_at', 'cleared_at', 'closed_at', 'archived_at'];
  const timeline = events
    .filter(e => call[e])
    .map(e => {
      const t = new Date(call[e]).getTime();
      return {
        event: e.replace(/_at$/, ''),
        timestamp: call[e],
        elapsed_seconds: baseTime && !isNaN(t) ? Math.round((t - baseTime) / 1000) : null,
      };
    });
  const actionCounts = await query<{ action: string; count: number }>(
    db,
    `SELECT action, COUNT(*) as count FROM activity_log
     WHERE entity_type = 'call' AND entity_id = ? GROUP BY action ORDER BY count DESC`,
    id,
  );
  return c.json({
    call_number: call.call_number,
    current_status: call.status,
    timeline,
    action_counts: actionCounts,
    response_time_seconds: safeDiffSec(call.created_at, call.onscene_at),
  });
});

// ── Mileage ─────────────────────────────────────────────────────

actions.put('/calls/:id/mileage', async (c) => {
  const db = getDb(c.env);
  const id = c.req.param('id');
  const { starting_mileage, ending_mileage } = await c.req.json<{
    starting_mileage?: number; ending_mileage?: number;
  }>();
  const validMileage = (m: unknown) => m == null || (typeof m === 'number' && m >= 0 && m <= 9_999_999);
  if (!validMileage(starting_mileage) || !validMileage(ending_mileage)) {
    return c.json({ error: 'Invalid mileage' }, 400);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (starting_mileage !== undefined) { sets.push('starting_mileage = ?'); params.push(starting_mileage); }
  if (ending_mileage !== undefined)   { sets.push('ending_mileage = ?');   params.push(ending_mileage); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await execute(db, `UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const updated = await getCall(db, id);
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, { action: 'call_updated', call: updated }).then(() => {}));
  return c.json(updated);
});

// ── Generate incident from cleared/closed call ──────────────────

actions.post('/calls/:id/generate-incident', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId') as number;
  const id = c.req.param('id');
  const call = await getCall(db, id) as any;
  if (!call) return c.json({ error: 'Call not found' }, 404);
  if (!['cleared', 'closed'].includes(call.status)) {
    return c.json({ error: 'Can only generate from cleared or closed calls' }, 400);
  }

  const existing = await queryFirst<{ id: number; incident_number: string }>(
    db, 'SELECT id, incident_number FROM incidents WHERE call_id = ?', id,
  );
  if (existing) {
    return c.json({
      error: 'An incident already exists for this call',
      incident_id: existing.id,
      incident_number: existing.incident_number,
    }, 409);
  }

  // Incident number: RMP-YY-NNNNN format. The full legacy generator
  // supported per-incident-type code suffixes; we keep it simple here.
  const yr = new Date().getFullYear().toString().slice(-2);
  const [{ max }] = await query<{ max: string | null }>(
    db, `SELECT MAX(incident_number) as max FROM incidents WHERE incident_number LIKE ?`, `RMP-${yr}-%`,
  );
  let nextSeq = 1;
  if (max) {
    const m = max.match(/RMP-\d{2}-(\d+)/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  const incidentNumber = `RMP-${yr}-${String(nextSeq).padStart(5, '0')}`;

  const narrativeLines = [
    `Incident generated from dispatch call ${call.call_number}.`,
    `Call Type: ${String(call.incident_type || '').replace(/_/g, ' ').toUpperCase()}`,
    `Priority: ${call.priority}`,
    `Location: ${call.location_address || 'Unknown'}`,
    call.description ? `\nCall Description: ${call.description}` : '',
    call.disposition ? `Disposition: ${call.disposition}` : '',
    `\nCall Timeline:`,
    call.created_at ? `  Created: ${call.created_at}` : '',
    call.dispatched_at ? `  Dispatched: ${call.dispatched_at}` : '',
    call.enroute_at ? `  En Route: ${call.enroute_at}` : '',
    call.onscene_at ? `  On Scene: ${call.onscene_at}` : '',
    call.cleared_at ? `  Cleared: ${call.cleared_at}` : '',
    `\n--- Officer narrative below ---\n`,
  ].filter(Boolean).join('\n');

  const result = await execute(
    db,
    `INSERT INTO incidents
       (incident_number, call_id, incident_type, priority, status, location_address,
        property_id, latitude, longitude, narrative, officer_id, client_id, disposition,
        sector_id, zone_id, beat_id)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    incidentNumber, id, call.incident_type, call.priority,
    call.location_address || null,
    call.property_id || null, call.latitude ?? null, call.longitude ?? null,
    narrativeLines, userId, call.client_id || null, call.disposition || null,
    call.sector_id || null, call.zone_id || null, call.beat_id || null,
  );

  const incident = await queryFirst(
    db,
    `SELECT i.*, o.full_name as officer_name, c.call_number
     FROM incidents i
     LEFT JOIN users o ON i.officer_id = o.id
     LEFT JOIN calls_for_service c ON i.call_id = c.id
     WHERE i.id = ?`,
    Number(result.meta.last_row_id),
  );

  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'incident_generated', call_id: Number(id), incident,
  }).then(() => {}));

  return c.json(incident, 201);
});

export default actions;
