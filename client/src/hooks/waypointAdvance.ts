export interface NavWaypoint {
  id: number | string;
  lat: number;
  lng: number;
  label: string;
  completed: boolean;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function nextWaypointIndex(waypoints: NavWaypoint[]): number | null {
  const idx = waypoints.findIndex(w => !w.completed);
  return idx === -1 ? null : idx;
}

export function hasArrivedAtWaypoint(waypoints: NavWaypoint[], lat: number, lng: number, arrivalRadiusM: number): boolean {
  const idx = nextWaypointIndex(waypoints);
  if (idx === null) return false;
  return haversineMeters(lat, lng, waypoints[idx].lat, waypoints[idx].lng) <= arrivalRadiusM;
}

export function advanceWaypoint(waypoints: NavWaypoint[]): NavWaypoint[] {
  const idx = nextWaypointIndex(waypoints);
  if (idx === null) return waypoints;
  return waypoints.map((w, i) => (i === idx ? { ...w, completed: true } : w));
}
