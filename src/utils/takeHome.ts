import { queryFirst } from './db';

export interface TakeHomeStatus {
  hasTakeHome: boolean;
  vehicleId: number | null;
}

// Take-home status is derived from the only schema that exists for it
// (migration 0064): users.take_home_vehicle_id → fleet_vehicles.take_home.
// There is no users.has_take_home column — selecting it 500s on every DB
// built from the migrations.
export async function resolveTakeHome(db: D1Database, userId: number | null): Promise<TakeHomeStatus> {
  if (userId == null) return { hasTakeHome: false, vehicleId: null };
  const row = await queryFirst<{ take_home_vehicle_id: number | null; vehicle_take_home: number | null }>(
    db,
    `SELECT u.take_home_vehicle_id, fv.take_home AS vehicle_take_home
       FROM users u
       LEFT JOIN fleet_vehicles fv ON fv.id = u.take_home_vehicle_id
      WHERE u.id = ?`,
    userId,
  );
  const vehicleId = row?.take_home_vehicle_id ?? null;
  return { hasTakeHome: vehicleId != null && row?.vehicle_take_home === 1, vehicleId };
}
