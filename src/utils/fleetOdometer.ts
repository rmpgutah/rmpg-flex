// src/utils/fleetOdometer.ts
// Keeps fleet_vehicles.current_mileage in sync with actual vehicle travel.
//
// Two write modes with different trust semantics:
//   • setFleetOdometer  — an officer read the physical odometer (duty start/end,
//     call mileage entry, admin correction). Authoritative: SETS the value, even
//     downward (a GPS-accrued value may have drifted high).
//   • accrueFleetOdometer — GPS dead-reckoning from a closed unit_trips row.
//     Additive between physical readings; the next real reading re-anchors it.
//
// Both are best-effort: callers wrap in try/catch (or rely on the internal
// guard) so an odometer sync can never break the write that triggered it.

import { log } from './logger';
type DB = D1Database;

const MAX_ODOMETER = 999_999;

/** Authoritative absolute odometer reading for a fleet vehicle. */
export async function setFleetOdometer(db: DB, vehicleId: number | null | undefined, mileage: number | null | undefined): Promise<void> {
  if (vehicleId == null || mileage == null) return;
  const mi = Number(mileage);
  if (!Number.isFinite(mi) || mi <= 0 || mi > MAX_ODOMETER) return;
  try {
    await db.prepare(
      `UPDATE fleet_vehicles SET current_mileage = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(Math.round(mi * 10) / 10, vehicleId).run();
  } catch (err) {
    log.warn('set failed (non-fatal)', { err });
  }
}

/** Current odometer reading for the fleet vehicle assigned to a unit, or null. */
export async function vehicleOdometerForUnit(db: DB, unitId: number | null | undefined): Promise<number | null> {
  if (unitId == null) return null;
  try {
    const row = await db.prepare(
      `SELECT current_mileage FROM fleet_vehicles WHERE assigned_unit_id = ? AND archived_at IS NULL
        ORDER BY current_mileage DESC LIMIT 1`,
    ).bind(unitId).first<{ current_mileage: number | null }>();
    const mi = row?.current_mileage != null ? Number(row.current_mileage) : null;
    return mi != null && Number.isFinite(mi) && mi > 0 && mi <= MAX_ODOMETER ? mi : null;
  } catch (err) {
    log.warn('unit lookup failed (non-fatal)', { err });
    return null;
  }
}

/** Add GPS-derived trip distance (meters) onto the vehicle's odometer. */
export async function accrueFleetOdometer(db: DB, vehicleId: number | null | undefined, distanceM: number | null | undefined): Promise<void> {
  if (vehicleId == null || distanceM == null) return;
  const miles = Number(distanceM) / 1609.344;
  // Ignore sub-0.1mi accruals — GPS jitter, not travel.
  if (!Number.isFinite(miles) || miles < 0.1) return;
  try {
    await db.prepare(
      `UPDATE fleet_vehicles
          SET current_mileage = ROUND(COALESCE(current_mileage, 0) + ?, 1), updated_at = datetime('now')
        WHERE id = ? AND COALESCE(current_mileage, 0) + ? <= ?`,
    ).bind(Math.round(miles * 10) / 10, vehicleId, miles, MAX_ODOMETER).run();
  } catch (err) {
    log.warn('accrue failed (non-fatal)', { err });
  }
}
