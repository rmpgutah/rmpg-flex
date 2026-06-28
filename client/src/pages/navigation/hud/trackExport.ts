// ============================================================
// RMPG Flex — Drive-Mode HUD · track export (GPX / CSV)
// ============================================================
// Self-contained (drive-lane only) exporters for the captured GPS track. Take a
// minimal point shape so they don't depend on any other lane's types. Trigger a
// client-side file download via a Blob + anchor. No-op for <2 points.
// ============================================================

export interface TrackSample {
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null; // m/s
  timestamp?: string;    // ISO 8601
  source?: string;
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function download(filename: string, mime: string, content: string): void {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after the click has a chance to dispatch.
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 1000);
  } catch { /* download blocked — best-effort */ }
}

function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export the track as a GPX 1.1 track (<trkpt>). No-op for <2 points. */
export function gpxExport(points: TrackSample[]): void {
  if (!points || points.length < 2) return;
  const trkpts = points.map((p) => {
    const tags: string[] = [];
    if (p.timestamp) tags.push(`<time>${esc(p.timestamp)}</time>`);
    if (p.speed != null) tags.push(`<speed>${Number(p.speed).toFixed(2)}</speed>`);
    if (p.heading != null) tags.push(`<course>${Number(p.heading).toFixed(1)}</course>`);
    return `      <trkpt lat="${p.lat}" lon="${p.lng}">${tags.length ? `\n        ${tags.join('\n        ')}\n      ` : ''}</trkpt>`;
  }).join('\n');
  const gpx =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="RMPG Flex Navigation" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n    <name>RMPG Patrol Track ${ts()}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>\n`;
  download(`rmpg-track-${ts()}.gpx`, 'application/gpx+xml', gpx);
}

/** Export the track as CSV. No-op for <2 points. */
export function navCsvExport(points: TrackSample[]): void {
  if (!points || points.length < 2) return;
  const header = ['timestamp', 'lat', 'lng', 'speed_ms', 'heading', 'accuracy_m', 'source'];
  const rows = points.map((p) => [
    esc(p.timestamp ?? ''), esc(p.lat), esc(p.lng),
    esc(p.speed ?? ''), esc(p.heading ?? ''), esc(p.accuracy ?? ''), esc(p.source ?? ''),
  ].join(','));
  download(`rmpg-track-${ts()}.csv`, 'text/csv', [header.join(','), ...rows].join('\n'));
}
