/**
 * Shift Briefing Generator
 *
 * Produces a structured shift summary with call statistics,
 * open call details, and a natural-language narrative suitable for TTS.
 */

import { getDb } from '../models/database';

// ─── Types ──────────────────────────────────────────────────

export interface ShiftSummary {
  shiftDate: string;
  totalCalls: number;
  callsByPriority: Record<string, number>;
  callsByType: { type: string; count: number }[];
  arrests: number;
  openCalls: number;
  openCallDetails: { callNumber: string; incidentType: string; locationAddress: string; priority: string }[];
  unitsOnDuty: number;
  narrative: string;
}

// ─── Default Window ─────────────────────────────────────────

const DEFAULT_WINDOW_HOURS = 12;

// ─── Generator ──────────────────────────────────────────────

/**
 * Query the database for shift statistics and compose a summary
 * with a natural-language narrative for TTS.
 *
 * @param startTime - ISO string for window start (default: 12 hours ago)
 * @param endTime   - ISO string for window end (default: now)
 */
export function generateShiftSummary(startTime?: string, endTime?: string): ShiftSummary {
  const db = getDb();

  const end = endTime || new Date().toISOString();
  const start = startTime || new Date(Date.now() - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  // 1. Total calls
  let totalCalls = 0;
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS cnt FROM calls_for_service WHERE created_at BETWEEN ? AND ?`
    ).get(start, end) as { cnt: number } | undefined;
    totalCalls = row?.cnt ?? 0;
  } catch { /* table may not exist in dev */ }

  // 2. Calls by priority
  const callsByPriority: Record<string, number> = {};
  try {
    const rows = db.prepare(
      `SELECT priority, COUNT(*) AS cnt FROM calls_for_service WHERE created_at BETWEEN ? AND ? GROUP BY priority`
    ).all(start, end) as { priority: string; cnt: number }[];
    for (const row of rows) {
      callsByPriority[row.priority || 'unassigned'] = row.cnt;
    }
  } catch { /* table may not exist in dev */ }

  // 3. Top 5 call types
  const callsByType: { type: string; count: number }[] = [];
  try {
    const rows = db.prepare(
      `SELECT incident_type, COUNT(*) AS cnt FROM calls_for_service WHERE created_at BETWEEN ? AND ? GROUP BY incident_type ORDER BY cnt DESC LIMIT 5`
    ).all(start, end) as { incident_type: string; cnt: number }[];
    for (const row of rows) {
      callsByType.push({ type: row.incident_type || 'Unknown', count: row.cnt });
    }
  } catch { /* table may not exist in dev */ }

  // 4. Arrests (calls with arrest-related dispositions)
  let arrests = 0;
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS cnt FROM calls_for_service WHERE created_at BETWEEN ? AND ? AND (disposition LIKE '%arrest%' OR disposition LIKE '%custody%')`
    ).get(start, end) as { cnt: number } | undefined;
    arrests = row?.cnt ?? 0;
  } catch { /* table may not exist in dev */ }

  // 5. Open calls
  const openCallDetails: { callNumber: string; incidentType: string; locationAddress: string; priority: string }[] = [];
  try {
    const rows = db.prepare(
      `SELECT call_number, incident_type, location_address, priority FROM calls_for_service WHERE status NOT IN ('closed','cleared','cancelled') AND archived = 0 ORDER BY priority LIMIT 10`
    ).all() as { call_number: string; incident_type: string; location_address: string; priority: string }[];
    for (const row of rows) {
      openCallDetails.push({
        callNumber: row.call_number,
        incidentType: row.incident_type || 'Unknown',
        locationAddress: row.location_address || 'Unknown location',
        priority: row.priority || 'unassigned',
      });
    }
  } catch { /* table may not exist in dev */ }

  const openCalls = openCallDetails.length;

  // 6. Units on duty
  let unitsOnDuty = 0;
  try {
    const row = db.prepare(
      `SELECT COUNT(*) AS cnt FROM dispatch_units WHERE status != 'off_duty'`
    ).get() as { cnt: number } | undefined;
    unitsOnDuty = row?.cnt ?? 0;
  } catch { /* table may not exist in dev */ }

  // ─── Compose narrative ─────────────────────────────────────

  const narrativeParts: string[] = [];

  // Total
  narrativeParts.push(`Shift summary. ${totalCalls} call${totalCalls !== 1 ? 's' : ''} handled.`);

  // Priority breakdown
  const priorityEntries = Object.entries(callsByPriority).sort(([a], [b]) => a.localeCompare(b));
  if (priorityEntries.length > 0) {
    const priorityParts = priorityEntries.map(([priority, count]) => {
      return `${count} priority ${priority} call${count !== 1 ? 's' : ''}`;
    });
    narrativeParts.push(priorityParts.join('. ') + '.');
  }

  // Open calls carrying over
  if (openCalls > 0) {
    const listed = openCallDetails.slice(0, 3);
    const listedText = listed.map(c => `${c.incidentType} at ${c.locationAddress}`).join('. ');

    if (openCalls <= 3) {
      narrativeParts.push(`${openCalls} open call${openCalls !== 1 ? 's' : ''} carrying over: ${listedText}.`);
    } else {
      const additional = openCalls - 3;
      narrativeParts.push(`${openCalls} open calls carrying over: ${listedText}. Plus ${additional} additional.`);
    }
  } else {
    narrativeParts.push('No open calls carrying over.');
  }

  // Units on duty
  narrativeParts.push(`${unitsOnDuty} unit${unitsOnDuty !== 1 ? 's' : ''} currently on duty.`);

  const narrative = narrativeParts.join(' ');

  return {
    shiftDate: start.split('T')[0],
    totalCalls,
    callsByPriority,
    callsByType,
    arrests,
    openCalls,
    openCallDetails,
    unitsOnDuty,
    narrative,
  };
}
