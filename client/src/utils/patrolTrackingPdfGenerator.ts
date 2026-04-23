// ═══════════════════════════════════════════════════════════════
// Patrol Tracking Report — clean, Fuel-Report-style PDF generator
//
// Rewritten 2026-04-22 to match fleetFuelReport.ts visual style:
// stock Helvetica, no crest, no accent bars, no watermark, no
// barcode, no dark header bars. Letter-landscape so the wide
// breadcrumb table fits without cramming.
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';

// ── Types matching the server patrol-tracking response ──────

interface PatrolPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading_cardinal: string | null;
  speed_mph: number | null;
  status: string | null;
  current_call_number: string | null;
  current_call_type: string | null;
  time: string;
  distance_from_prev_meters: number | null;
  is_stationary: boolean;
  road_name?: string | null;
  nearest_intersection?: string | null;
  source?: string;
  beat_id?: string | null;
  beat_code?: string | null;
  zone?: string | null;
  cumulative_distance_miles?: number;
}

interface ResponseSegment {
  call_number: string;
  incident_type: string;
  priority: string;
  dispatched_at: string;
  onscene_at: string | null;
  time_to_onscene_seconds: number | null;
  response_distance_miles: number;
  breadcrumb_count: number;
}

interface UnitTrail {
  unit_id: number;
  call_sign: string;
  officer_name: string;
  badge_number: string;
  points: PatrolPoint[];
  stats: {
    total_points: number;
    stationary_points: number;
    moving_points: number;
    total_distance_miles: number;
    max_speed_mph: number;
    avg_speed_mph: number;
    duration_minutes: number;
    source_breakdown?: Record<string, number>;
  };
  response_segments: ResponseSegment[];
  zone_coverage?: Record<string, {
    beat_code: string;
    city: string;
    point_count: number;
    time_seconds: number;
    percentage: number;
  }>;
}

export interface PatrolTrackingReportData {
  trails: UnitTrail[];
  query: {
    startDate: string | null;
    endDate: string | null;
    hours: number;
  };
  total_units: number;
  total_points: number;
}

// ── Helpers (mirroring fleetFuelReport style) ────────────────

/** Replace Unicode dashes so jsPDF's cp1252 Helvetica renders cleanly. */
function asciify(s: string): string {
  return s.replace(/→/g, ' to ').replace(/—/g, ' - ').replace(/–/g, ' - ');
}

/** "MM/DD HH:MM:SS" for a breadcrumb timestamp. */
function formatPointTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "YYYY-MM-DD" or pass-through. */
function formatDayOnly(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || isNaN(Number(n))) return '-';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes < 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Generator ────────────────────────────────────────────────

export async function generatePatrolTrackingPdf(data: PatrolTrackingReportData): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const marginX = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // One PDF per generate call; when multiple units are selected we emit
  // one per unit as page groups — simplest flow is: loop trails, each
  // trail gets its own header/summary/breadcrumb section with addPage()
  // between them. For a single unit the filename uses that unit; for
  // multi-unit we use "multi".
  const firstTrail = data.trails[0];

  for (let ti = 0; ti < data.trails.length; ti++) {
    const trail = data.trails[ti];
    if (ti > 0) doc.addPage();
    let y = 40;

    // ── Header ────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(asciify('RMPG FLEX — PATROL TRACKING REPORT'), marginX, y);
    y += 22;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const unitLabel = `${trail.call_sign} - ${trail.officer_name}${trail.badge_number ? ` (Badge ${trail.badge_number})` : ''}`;
    doc.text(`Unit: ${unitLabel}`, marginX, y);
    y += 14;

    const startLabel = data.query.startDate
      ? formatDayOnly(data.query.startDate)
      : `Last ${data.query.hours} hours`;
    const endLabel = data.query.endDate ? formatDayOnly(data.query.endDate) : 'now';
    doc.text(`Period: ${startLabel} to ${endLabel}`, marginX, y);
    y += 14;
    doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y);
    y += 22;

    // ── Summary ───────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('SUMMARY', marginX, y);
    y += 4;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;

    const s = trail.stats;
    const zonesCount = trail.zone_coverage ? Object.keys(trail.zone_coverage).length : 0;
    const movingPct = s.total_points > 0 ? Math.round((s.moving_points / s.total_points) * 100) : 0;

    const cells: [string, string][] = [
      ['Total Points',     String(s.total_points)],
      ['Total Miles',      fmtNum(s.total_distance_miles, 2)],
      ['Duration',         formatDuration(s.duration_minutes)],
      ['Max Speed',        `${fmtNum(s.max_speed_mph, 1)} mph`],
      ['Avg Speed',        `${fmtNum(s.avg_speed_mph, 1)} mph`],
      ['Moving %',         `${movingPct}%`],
      ['Calls Responded',  String(trail.response_segments.length)],
      ['Zones Covered',    String(zonesCount)],
    ];
    if (s.source_breakdown) {
      for (const [src, n] of Object.entries(s.source_breakdown)) {
        cells.push([src, `${n} pts`]);
      }
    }

    doc.setFontSize(10);
    const colW = (pageW - marginX * 2) / 2;
    for (let i = 0; i < cells.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = marginX + col * colW;
      const rowY = y + row * 16;
      doc.setFont('helvetica', 'bold');
      doc.text(cells[i][0] + ':', x, rowY);
      doc.setFont('helvetica', 'normal');
      doc.text(cells[i][1], x + 110, rowY);
    }
    y += Math.ceil(cells.length / 2) * 16 + 10;

    // ── Breadcrumb table ──────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`BREADCRUMBS (${trail.points.length})`, marginX, y);
    y += 4;
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;

    // Column layout (points; total ≈ 595pt ≤ landscape content width ~712pt)
    const cDate   = marginX;
    const cBeat   = marginX + 90;
    const cRoad   = marginX + 140;
    const cSpd    = marginX + 235;
    const cHdg    = marginX + 270;
    const cSrc    = marginX + 295;
    const cStat   = marginX + 345;
    const cCall   = marginX + 400;
    const cDist   = marginX + 470;
    const cLL     = marginX + 505;

    const drawHeader = (yy: number) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('Date/Time', cDate, yy);
      doc.text('Beat',      cBeat, yy);
      doc.text('Road',      cRoad, yy);
      doc.text('Speed',     cSpd, yy);
      doc.text('Hdg',       cHdg, yy);
      doc.text('Src',       cSrc, yy);
      doc.text('Status',    cStat, yy);
      doc.text('Call #',    cCall, yy);
      doc.text('Dist',      cDist, yy);
      doc.text('Lat/Lng',   cLL, yy);
      doc.setFont('helvetica', 'normal');
    };
    drawHeader(y);
    y += 12;

    doc.setFontSize(8);
    let rowsOnPage = 0;
    for (const pt of trail.points) {
      if (rowsOnPage >= 50 || y > pageH - 40) {
        doc.addPage();
        y = 40;
        drawHeader(y);
        y += 12;
        rowsOnPage = 0;
      }

      doc.text(formatPointTime(pt.time),                                  cDate, y);
      doc.text((pt.beat_code || '-').toString(),                          cBeat, y);
      doc.text(truncate(pt.road_name || '-', 20),                         cRoad, y);
      doc.text(pt.speed_mph != null ? fmtNum(pt.speed_mph, 1) : '-',      cSpd, y);
      doc.text((pt.heading_cardinal || '-').toString(),                   cHdg, y);
      doc.text((pt.source || '-').toString().toUpperCase(),               cSrc, y);
      doc.text((pt.status || '-').replace(/_/g, ' ').toUpperCase(),       cStat, y);
      doc.text((pt.current_call_number || '-').toString(),                cCall, y);
      doc.text(pt.cumulative_distance_miles != null ? fmtNum(pt.cumulative_distance_miles, 1) : '-', cDist, y);
      doc.text(
        pt.lat != null && pt.lng != null
          ? `${Number(pt.lat).toFixed(4)},${Number(pt.lng).toFixed(4)}`
          : '-',
        cLL, y
      );

      y += 11;
      rowsOnPage += 1;
    }
  }

  // ── Save ──────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const ident = data.total_units === 1
    ? (firstTrail?.badge_number || firstTrail?.call_sign || 'unit')
    : 'multi';
  doc.save(`patrol-tracking-${ident}-${today}.pdf`);
}
