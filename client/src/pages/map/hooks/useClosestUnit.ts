export interface ClosestUnitResult {
  unit_id: number;
  call_sign: string;
  distance_km: number;
  bearing: number;
  status: string;
  latitude: number;
  longitude: number;
}

export function useClosestUnit(_callId?: number) {
  return [] as ClosestUnitResult[];
}
