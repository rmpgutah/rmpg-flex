// ============================================================
// RMPG Flex — GPX 1.1 Track Export
// Serializes a patrol track to a standard GPX 1.1 <trk> document
// and triggers a browser download. The serializer (trackToGpx) is
// pure and DOM-free for testing; downloadGpx does the Blob+anchor
// dance and is guarded for non-browser environments.
// ============================================================

export interface GpxPoint {
  lat: number;
  lng: number;
  /** epoch ms (or ISO string) of the fix. */
  t?: number | string;
  /** speed in m/s (optional, emitted as GPX <speed>). */
  speed?: number;
  /** elevation in metres (optional, emitted as GPX <ele>). */
  ele?: number;
}

export interface GpxMeta {
  name: string;
  /** purely informational unit tag stored as a track <type>. */
  unit?: string;
}

/** XML-escape a text value for safe attribute/element content. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIso(t: number | string | undefined): string | null {
  if (t == null) return null;
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Build a GPX 1.1 XML string from track points + metadata. */
export function trackToGpx(points: GpxPoint[], meta: GpxMeta): string {
  const pts = Array.isArray(points) ? points : [];
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="RMPG Flex" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
  );
  lines.push('  <metadata>');
  lines.push(`    <name>${esc(meta.name)}</name>`);
  const firstT = toIso(pts[0]?.t);
  if (firstT) lines.push(`    <time>${firstT}</time>`);
  lines.push('  </metadata>');
  lines.push('  <trk>');
  lines.push(`    <name>${esc(meta.name)}</name>`);
  if (meta.unit) lines.push(`    <type>${esc(meta.unit)}</type>`);
  lines.push('    <trkseg>');
  for (const p of pts) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    lines.push(`      <trkpt lat="${p.lat}" lon="${p.lng}">`);
    if (Number.isFinite(p.ele as number)) {
      lines.push(`        <ele>${p.ele}</ele>`);
    }
    const iso = toIso(p.t);
    if (iso) lines.push(`        <time>${iso}</time>`);
    if (Number.isFinite(p.speed as number)) {
      lines.push(`        <extensions><speed>${p.speed}</speed></extensions>`);
    }
    lines.push('      </trkpt>');
  }
  lines.push('    </trkseg>');
  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n');
}

/** Trigger a client-side download of a GPX string. No-op outside a browser. */
export function downloadGpx(filename: string, xml: string): void {
  try {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
    const safeName = /\.gpx$/i.test(filename) ? filename : `${filename}.gpx`;
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    /* best effort */
  }
}
