import { getDb } from '../models/database';

/** Get all active (non-unassigned) unit IDs for a call */
export function getCallUnitIds(callId: number): number[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT unit_id FROM call_units WHERE call_id = ? AND unassigned_at IS NULL'
  ).all(callId) as { unit_id: number }[];
  return rows.map(r => r.unit_id);
}

/** Get full unit objects for a call (with officer details) */
export function getCallUnitsDetailed(callId: number): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT u.*, usr.full_name as officer_name, usr.badge_number, usr.phone as officer_phone,
      c.call_number, c.incident_type as current_call_type, c.location_address as current_call_location
    FROM call_units cu
    JOIN units u ON cu.unit_id = u.id
    LEFT JOIN users usr ON u.officer_id = usr.id
    LEFT JOIN calls_for_service c ON u.current_call_id = c.id
    WHERE cu.call_id = ? AND cu.unassigned_at IS NULL
  `).all(callId);
}

/** Assign units to a call (inside an existing transaction context) */
export function assignUnitsToCall(callId: number, unitIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO call_units (call_id, unit_id) VALUES (?, ?)'
  );
  for (const uid of unitIds) {
    stmt.run(callId, uid);
  }
}

/** Unassign a unit from a call (soft — sets unassigned_at) */
export function unassignUnitFromCall(callId: number, unitId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE call_units SET unassigned_at = datetime('now','localtime') WHERE call_id = ? AND unit_id = ? AND unassigned_at IS NULL"
  ).run(callId, unitId);
}

/** Unassign ALL units from a call (for clear/close/archive) */
export function unassignAllUnitsFromCall(callId: number): number[] {
  const db = getDb();
  const unitIds = getCallUnitIds(callId);
  db.prepare(
    "UPDATE call_units SET unassigned_at = datetime('now','localtime') WHERE call_id = ? AND unassigned_at IS NULL"
  ).run(callId);
  return unitIds;
}

/** Batch-fetch units for multiple calls (eliminates N+1) */
export function getUnitsForCalls(callIds: number[]): Record<number, any[]> {
  if (callIds.length === 0) return {};
  const db = getDb();
  const placeholders = callIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT cu.call_id, u.id, u.call_sign, u.status, u.officer_id,
      usr.full_name as officer_name, usr.badge_number
    FROM call_units cu
    JOIN units u ON cu.unit_id = u.id
    LEFT JOIN users usr ON u.officer_id = usr.id
    WHERE cu.call_id IN (${placeholders}) AND cu.unassigned_at IS NULL
  `).all(...callIds) as any[];

  const result: Record<number, any[]> = {};
  for (const cid of callIds) result[cid] = [];
  for (const row of rows) {
    result[row.call_id]?.push(row);
  }
  return result;
}
