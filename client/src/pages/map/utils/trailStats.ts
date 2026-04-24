// ============================================================
// RMPG Flex — Breadcrumb Trail Stats + GPX Export
// Pure utilities that operate on a PlaybackTrail so they stay
// out of the MapPage effect soup. Computing stats on a tap lets
// dispatchers answer "how far has unit X driven today?" without
// clicking through to a separate analytics view.
// ============================================================

interface TrailPoint {
  lat: number;
  lng: number;
  speed?: number | null;
  time: string;
}

export interface TrailStats {
  /** Total route length in meters */
  distanceMeters: number;
  /** Duration in seconds between first and last point */
  durationSec: number;
  /** Highest recorded point speed in m/s, or null if none tracked */
  maxSpeedMps: number | null;
  /** Average speed = distance / duration in m/s (0 when duration is 0) */
  avgSpeedMps: number;
  /** Number of points in the trail */
  pointCount: number;
}

export interface UnitTrail {
  unit_id: number | string;
  call_sign: string;
  officer_name?: string;
  badge_number?: string | null;
  points: TrailPoint[];
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return 0;
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeTrailStats(trail: UnitTrail): TrailStats {
  const pts = trail.points || [];
  if (pts.length === 0) {
    return { distanceMeters: 0, durationSec: 0, maxSpeedMps: null, avgSpeedMps: 0, pointCount: 0 };
  }
  let distanceMeters = 0;
  let maxSpeedMps: number | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    distanceMeters += haversineMeters(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
  }
  for (const p of pts) {
    if (p.speed != null && Number.isFinite(p.speed)) {
      if (maxSpeedMps == null || p.speed > maxSpeedMps) maxSpeedMps = p.speed;
    }
  }
  const first = Date.parse(pts[0].time);
  const last = Date.parse(pts[pts.length - 1].time);
  const durationSec = Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, (last - first) / 1000) : 0;
  const avgSpeedMps = durationSec > 0 ? distanceMeters / durationSec : 0;
  return { distanceMeters, durationSec, maxSpeedMps, avgSpeedMps, pointCount: pts.length };
}

/** Human-friendly summary, e.g. "3.4 mi · 1h 12m · max 42 mph". */
export function formatTrailStats(stats: TrailStats): string {
  const miles = (stats.distanceMeters / 1609.344).toFixed(1);
  const hours = Math.floor(stats.durationSec / 3600);
  const mins = Math.floor((stats.durationSec % 3600) / 60);
  const dur = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const maxMph = stats.maxSpeedMps != null ? Math.round(stats.maxSpeedMps * 2.23694) : null;
  const parts = [`${miles} mi`, dur];
  if (maxMph != null) parts.push(`max ${maxMph} mph`);
  return parts.join(' · ');
}

/**
 * Emit GPX 1.1 for a unit trail. Wraps the whole trail as one <trkseg>
 * so GIS tools don't need to merge segments. Time stamps are ISO-8601
 * pass-through — whatever format the server returned.
 */
export function trailToGpx(trail: UnitTrail): string {
  const ptsXml = (trail.points || [])
    .map((p) =>
      `      <trkpt lat="${p.lat}" lon="${p.lng}">\n` +
      `        <time>${new Date(p.time).toISOString()}</time>\n` +
      (p.speed != null ? `        <speed>${p.speed}</speed>\n` : '') +
      `      </trkpt>`,
    )
    .join('\n');
  const name = `${trail.call_sign || trail.unit_id}${trail.officer_name ? ` (${trail.officer_name})` : ''}`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="RMPG Flex CAD/RMS" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n` +
    `    <name>${escapeXml(name)}</name>\n` +
    `    <trkseg>\n` +
    ptsXml + '\n' +
    `    </trkseg>\n` +
    `  </trk>\n` +
    `</gpx>\n`
  );
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

/**
 * Trigger a browser download of the given trail as a .gpx file. Works in
 * all evergreen browsers; no external dep. Falls back silently on failure
 * (e.g. sandboxed Electron child-window with no fs access).
 */
export function downloadTrailAsGpx(trail: UnitTrail, filename?: string): void {
  try {
    const xml = trailToGpx(trail);
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `${trail.call_sign || 'trail'}-${new Date().toISOString().slice(0, 10)}.gpx`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.warn('[trailStats] GPX download failed:', err);
  }
}
