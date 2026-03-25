/**
 * AI Data Cleanup Agent
 *
 * Detects stale calls, orphaned units, and incomplete records.
 * Provides AI-generated summaries and admin-initiated fix actions.
 */

import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import aiManager from './aiManager';
import { auditLogSystem } from './auditLogger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaleCallItem {
  call_id: number;
  call_number: string;
  status: string;
  hours_in_status: number;
  incident_type: string;
  location: string;
  suggested_action: string;
}

export interface StaleCallReport {
  items: StaleCallItem[];
  count: number;
}

export interface OrphanedUnitItem {
  unit_id: number;
  call_sign: string;
  status: string;
  last_call_id: number | null;
  suggested_action: string;
}

export interface OrphanedUnitReport {
  items: OrphanedUnitItem[];
  count: number;
}

export interface IncompleteRecordItem {
  call_id: number;
  call_number: string;
  missing_fields: string[];
  suggested_action: string;
}

export interface IncompleteRecordReport {
  items: IncompleteRecordItem[];
  count: number;
}

export interface DataCleanupReport {
  timestamp: string;
  staleCalls: StaleCallReport;
  orphanedUnits: OrphanedUnitReport;
  incompleteRecords: IncompleteRecordReport;
  totalIssues: number;
  aiSummary: string | null;
}

// ---------------------------------------------------------------------------
// Detection Functions
// ---------------------------------------------------------------------------

export async function detectStaleCalls(): Promise<StaleCallReport> {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      id AS call_id,
      call_number,
      status,
      ROUND((julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24, 1) AS hours_in_status,
      incident_type,
      COALESCE(location_address, location_text, '') AS location
    FROM calls_for_service
    WHERE
      (status = 'dispatched' AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 > 2)
      OR (status = 'enroute' AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 > 4)
      OR (status = 'onscene' AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 > 8)
      OR (status = 'pending' AND (julianday('now') - julianday(COALESCE(updated_at, created_at))) * 24 > 24)
    ORDER BY hours_in_status DESC
  `).all() as any[];

  const items: StaleCallItem[] = rows.map(r => {
    let suggested_action = 'review';
    if (r.hours_in_status > 24) suggested_action = 'close';
    else if (r.hours_in_status > 8) suggested_action = 'escalate';
    else suggested_action = 'clear';

    return {
      call_id: r.call_id,
      call_number: r.call_number || `CFS-${r.call_id}`,
      status: r.status,
      hours_in_status: r.hours_in_status,
      incident_type: r.incident_type || 'Unknown',
      location: r.location || 'No location',
      suggested_action,
    };
  });

  return { items, count: items.length };
}

export async function detectOrphanedUnits(): Promise<OrphanedUnitReport> {
  const db = getDb();

  // Find units marked as dispatched/enroute/onscene but not linked to any active call
  const rows = db.prepare(`
    SELECT
      u.id AS unit_id,
      u.call_sign,
      u.status,
      u.current_call_id AS last_call_id
    FROM units u
    WHERE u.status IN ('dispatched', 'enroute', 'onscene')
      AND (
        u.current_call_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM calls_for_service c
          WHERE c.id = u.current_call_id
            AND c.status NOT IN ('closed', 'cancelled', 'completed')
        )
      )
  `).all() as any[];

  const items: OrphanedUnitItem[] = rows.map(r => ({
    unit_id: r.unit_id,
    call_sign: r.call_sign,
    status: r.status,
    last_call_id: r.last_call_id,
    suggested_action: 'reset_to_available',
  }));

  return { items, count: items.length };
}

export async function detectIncompleteRecords(): Promise<IncompleteRecordReport> {
  const db = getDb();

  // Calls created in the last 7 days that are missing critical fields
  const rows = db.prepare(`
    SELECT
      id AS call_id,
      call_number,
      description,
      notes,
      location_address,
      location_text,
      incident_type
    FROM calls_for_service
    WHERE created_at > datetime('now', '-7 days')
      AND status NOT IN ('closed', 'cancelled', 'completed')
      AND (
        (COALESCE(description, '') = '' AND COALESCE(notes, '') = '')
        OR (COALESCE(location_address, '') = '' AND COALESCE(location_text, '') = '')
        OR COALESCE(incident_type, '') = ''
      )
    ORDER BY created_at DESC
    LIMIT 50
  `).all() as any[];

  const items: IncompleteRecordItem[] = rows.map(r => {
    const missing: string[] = [];
    if (!r.description && !r.notes) missing.push('description/notes');
    if (!r.location_address && !r.location_text) missing.push('location');
    if (!r.incident_type) missing.push('incident_type');

    return {
      call_id: r.call_id,
      call_number: r.call_number || `CFS-${r.call_id}`,
      missing_fields: missing,
      suggested_action: missing.length >= 2 ? 'needs_review' : 'add_missing_info',
    };
  });

  return { items, count: items.length };
}

// ---------------------------------------------------------------------------
// Combined Scan with AI Summary
// ---------------------------------------------------------------------------

export async function runDataCleanupScan(): Promise<DataCleanupReport> {
  const [staleCalls, orphanedUnits, incompleteRecords] = await Promise.all([
    detectStaleCalls(),
    detectOrphanedUnits(),
    detectIncompleteRecords(),
  ]);

  const totalIssues = staleCalls.count + orphanedUnits.count + incompleteRecords.count;

  // Generate AI summary if there are issues and AI is available
  let aiSummary: string | null = null;
  if (totalIssues > 0) {
    try {
      const prompt = `You are a CAD/RMS system data quality analyst. Summarize the following data issues in 2-3 sentences with prioritized recommendations:

Stale Calls (${staleCalls.count}): ${staleCalls.items.slice(0, 5).map(c => `${c.call_number} stuck in "${c.status}" for ${c.hours_in_status}h`).join('; ')}
Orphaned Units (${orphanedUnits.count}): ${orphanedUnits.items.slice(0, 5).map(u => `${u.call_sign} shows "${u.status}" with no active call`).join('; ')}
Incomplete Records (${incompleteRecords.count}): ${incompleteRecords.items.slice(0, 5).map(r => `${r.call_number} missing ${r.missing_fields.join(', ')}`).join('; ')}

Be concise and actionable. Focus on the most urgent items first.`;

      aiSummary = await aiManager.chat(
        'You are a police CAD/RMS data quality assistant. Provide brief, actionable summaries.',
        prompt,
        { temperature: 0.3, maxTokens: 300 },
      );
    } catch (err) {
      console.warn('[aiDataCleanup] AI summary generation failed:', err);
    }
  }

  return {
    timestamp: localNow(),
    staleCalls,
    orphanedUnits,
    incompleteRecords,
    totalIssues,
    aiSummary,
  };
}

// ---------------------------------------------------------------------------
// Fix Actions (admin-initiated only)
// ---------------------------------------------------------------------------

export async function autoFixStaleCall(
  callId: number,
  action: 'clear' | 'close' | 'escalate',
): Promise<boolean> {
  const db = getDb();
  const now = localNow();

  const call = db.prepare('SELECT id, call_number, status FROM calls_for_service WHERE id = ?').get(callId) as any;
  if (!call) return false;

  const oldStatus = call.status;

  switch (action) {
    case 'clear': {
      db.prepare('UPDATE calls_for_service SET status = ?, updated_at = ? WHERE id = ?')
        .run('cleared', now, callId);
      // Reset any units assigned to this call
      db.prepare('UPDATE units SET status = ?, current_call_id = NULL, updated_at = ? WHERE current_call_id = ?')
        .run('available', now, callId);
      break;
    }
    case 'close': {
      db.prepare('UPDATE calls_for_service SET status = ?, updated_at = ? WHERE id = ?')
        .run('closed', now, callId);
      db.prepare('UPDATE units SET status = ?, current_call_id = NULL, updated_at = ? WHERE current_call_id = ?')
        .run('available', now, callId);
      break;
    }
    case 'escalate': {
      db.prepare('UPDATE calls_for_service SET priority = ?, updated_at = ? WHERE id = ?')
        .run('high', now, callId);
      break;
    }
    default:
      return false;
  }

  auditLogSystem(
    'call_updated',
    'call',
    callId,
    `AI Data Cleanup: ${action} stale call ${call.call_number} (was "${oldStatus}")`,
  );

  return true;
}

export async function autoFixOrphanedUnit(unitId: number): Promise<boolean> {
  const db = getDb();
  const now = localNow();

  const unit = db.prepare('SELECT id, call_sign, status FROM units WHERE id = ?').get(unitId) as any;
  if (!unit) return false;

  const oldStatus = unit.status;

  db.prepare('UPDATE units SET status = ?, current_call_id = NULL, updated_at = ? WHERE id = ?')
    .run('available', now, unitId);

  auditLogSystem(
    'unit_status_changed',
    'unit',
    unitId,
    `AI Data Cleanup: reset orphaned unit ${unit.call_sign} from "${oldStatus}" to "available"`,
  );

  return true;
}
