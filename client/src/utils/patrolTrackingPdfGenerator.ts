// ============================================================
// RMPG Flex — Patrol Tracking PDF Report Generator
// Generates a detailed patrol tracking report from GPS breadcrumb
// data, including cover page, detail table, response time segments,
// and per-unit summary statistics.
// All headers use black text on white/light backgrounds.
// ============================================================

import jsPDF from 'jspdf';
import { loadLogoDarkBase64, FORM_NUMBERS, FORM_REVISION } from './pdfAssets';
import { localToday } from './dateUtils';
import { fetchPdfBranding, DEFAULT_PDF_BRANDING } from './pdfGenerator';
import { COLOR, FONT, BORDER, SPACING, LAYOUT, getCapHeight } from './pdfTokens';

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

// ── Helpers ──────────────────────────────────────────────────

function formatDateTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) + ' '
      + d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return isoStr; }
}

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return isoStr; }
}

function formatDate(isoStr: string | null): string {
  if (!isoStr) return '-';
  try {
    return new Date(isoStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return isoStr; }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '#303030').replace('#', '');
  return [
    parseInt(clean.substring(0, 2), 16) || 48,
    parseInt(clean.substring(2, 4), 16) || 48,
    parseInt(clean.substring(4, 6), 16) || 48,
  ];
}

// ── PDF Generator ───────────────────────────────────────────

export async function generatePatrolTrackingPdf(data: PatrolTrackingReportData): Promise<void> {
  try {
  const branding = await fetchPdfBranding();
  const primaryRgb = hexToRgb(branding.primary_color || DEFAULT_PDF_BRANDING.primary_color);
  const accentRgb = hexToRgb(branding.accent_color || DEFAULT_PDF_BRANDING.accent_color);
  const headerBgRgb = hexToRgb(branding.header_bg_color || DEFAULT_PDF_BRANDING.header_bg_color);
  const logoB64 = await loadLogoDarkBase64();

  const doc = new jsPDF('landscape', 'mm', 'letter');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = LAYOUT.PAGE_MARGIN;
  const contentW = pageW - margin * 2;
  const reportDate = new Date().toLocaleString('en-US');
  const formNum = FORM_NUMBERS['patrol_tracking'] || 'FORM PS-210';

  let yPos: number = margin;

  // ── Utility: add header/footer to each page ──────────
  // Page 1 = cover (no top header bar — it has its own centered layout)
  // Pages 2+ = dark header bar with logo + text
  function addHeaderFooter(pageNum: number, totalPages: number) {
    // Only draw the top header bar on pages 2+
    if (pageNum > 1) {
      // Dark gray header bar (edge-to-edge for cover-style report)
      doc.setFillColor(...COLOR.BG_SECTION_HDR);
      doc.rect(0, 0, pageW, LAYOUT.PATROL_HEADER_H, 'F');

      // Logo in header
      if (logoB64) {
        try {
          doc.addImage(logoB64, 'PNG', margin, 2, 12, 10);
        } catch { /* ignore */ }
      }

      const textX = logoB64 ? margin + 14 : margin;
      doc.setTextColor(...COLOR.TEXT_INVERTED);
      doc.setFontSize(FONT.SIZE_CASE_NUMBER);
      doc.setFont('helvetica', 'bold');
      doc.text(branding.report_header_text, textX, 6);
      doc.setFontSize(FONT.SIZE_SUBHEADER);
      doc.setFont('helvetica', 'normal');
      doc.text('PATROL DIVISION', textX, 10);
      doc.setFontSize(FONT.SIZE_REPORT_TYPE);
      doc.text(`PATROL TRACKING REPORT  |  ${formNum}  |  ${FORM_REVISION}`, pageW - margin, 9, { align: 'right' });

      // Accent strip
      doc.setFillColor(...primaryRgb);
      doc.rect(0, 14, pageW / 2, 1, 'F');
      doc.setFillColor(...accentRgb);
      doc.rect(pageW / 2, 14, pageW / 2, 1, 'F');
    }

    // Footer on ALL pages (edge-to-edge for cover-style report)
    doc.setFillColor(...COLOR.BG_FORM_CELL_LABEL);
    doc.rect(0, pageH - 8, pageW, 8, 'F');
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW);
    doc.line(0, pageH - 8, pageW, pageH - 8);
    doc.setTextColor(...COLOR.TEXT_MUTED);
    doc.setFontSize(FONT.SIZE_FOOTER_SECONDARY);
    doc.text(`Generated: ${reportDate}  |  ${formNum}  |  CONFIDENTIAL — INTERNAL USE ONLY`, margin, pageH - 3.5);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageW - margin, pageH - 3.5, { align: 'right' });
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
  }

  // ── Utility: draw a section header bar (dark gray bg + white text) ──
  function drawSectionHeader(title: string) {
    const barH = 7;
    doc.setFillColor(...COLOR.BG_SECTION_HDR);
    doc.rect(margin, yPos, contentW, barH, 'F');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.setFontSize(FONT.SIZE_CASE_NUMBER);
    doc.setFont('helvetica', 'bold');
    doc.text(title.toUpperCase(), margin + SPACING.CONTENT_INSET, yPos + barH / 2 + 1.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    yPos += barH + 3;
  }

  // ── Utility: draw table column headers ──────────────
  function drawColumnHeaders(cols: { label: string; w: number }[]) {
    doc.setFillColor(...COLOR.BG_TABLE_HDR);
    doc.rect(margin, yPos, contentW, 5, 'F');
    doc.setDrawColor(...COLOR.BORDER_TABLE);
    doc.setLineWidth(BORDER.TABLE_ROW * 3);
    doc.line(margin, yPos + 5, margin + contentW, yPos + 5);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.setFontSize(FONT.SIZE_TABLE_HEADER);
    doc.setFont('helvetica', 'bold');
    let xOff = margin;
    for (const col of cols) {
      doc.text(col.label, xOff + 1, yPos + 3.5);
      xOff += col.w;
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    yPos += 6;
  }

  // ── Utility: new page with proper yPos ──────────────
  function newPage() {
    doc.addPage();
    yPos = margin + 18; // after header + accent strip
  }

  // ── Utility: check space and maybe new page ────────
  function ensureSpace(needed: number) {
    if (yPos + needed > pageH - 12) {
      newPage();
    }
  }

  // ════════════════════════════════════════════════════════
  // Cover Page — Professional centered logo + bold title
  // ════════════════════════════════════════════════════════

  // White background with accent strip at top
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, 60, 'F');
  doc.setFillColor(...primaryRgb);
  doc.rect(0, 0, pageW, 2, 'F');

  // Centered logo — one large logo as primary header element
  if (logoB64) {
    try {
      const logoSize = 30;
      const logoX = (pageW - logoSize) / 2;
      doc.addImage(logoB64, 'PNG', logoX, 6, logoSize, logoSize);
    } catch { /* ignore */ }
  }

  // Bold centered agency name
  const titleY = logoB64 ? 42 : 18;
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFontSize(FONT.SIZE_HEADER_TITLE + 5); // Cover page: larger than standard header
  doc.setFont('helvetica', 'bold');
  doc.text(branding.report_header_text, pageW / 2, titleY, { align: 'center' });

  doc.setFontSize(FONT.SIZE_TOTAL_LABEL);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(branding.report_subheader_text, pageW / 2, titleY + 6, { align: 'center' });

  // Bold report title
  doc.setFontSize(FONT.SIZE_BANNER);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...primaryRgb);
  doc.text('PATROL TRACKING REPORT', pageW / 2, titleY + 14, { align: 'center' });

  doc.setFontSize(FONT.SIZE_REPORT_TYPE);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLOR.TEXT_MUTED);
  doc.text(`${formNum}  |  ${FORM_REVISION}`, pageW / 2, titleY + 19, { align: 'center' });

  // Accent strip divider
  const stripY = titleY + 22;
  doc.setFillColor(...primaryRgb);
  doc.rect(margin, stripY, contentW / 2, 1.2, 'F');
  doc.setFillColor(...accentRgb);
  doc.rect(margin + contentW / 2, stripY, contentW / 2, 1.2, 'F');

  yPos = stripY + 6;

  // Title bar — light background with dark text
  drawSectionHeader('Report Details');

  // Report metadata
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFontSize(FONT.SIZE_CASE_NUMBER);
  doc.setFont('helvetica', 'normal');

  const startLabel = data.query.startDate
    ? formatDate(data.query.startDate)
    : `Last ${data.query.hours} hours`;
  const endLabel = data.query.endDate
    ? formatDate(data.query.endDate)
    : 'Now';

  const metaLines = [
    ['Report Period:', `${startLabel} — ${endLabel}`],
    ['Units Tracked:', String(data.total_units)],
    ['Total Breadcrumbs:', String(data.total_points)],
    ['Generated:', reportDate],
  ];

  for (const [label, value] of metaLines) {
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin + 4, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(value, margin + 42, yPos);
    yPos += 5;
  }
  yPos += 6;

  // ── Per-Unit Summary Cards ─────────────────────────
  drawSectionHeader('Unit Summary');

  for (const trail of data.trails) {
    ensureSpace(25);

    // Unit header line — light bg with accent left edge
    doc.setFillColor(...primaryRgb);
    doc.rect(margin, yPos, 2, 6, 'F');
    doc.setFillColor(...COLOR.BG_FORM_CELL_LABEL);
    doc.rect(margin + 2, yPos, contentW - 2, 6, 'F');
    doc.setDrawColor(...COLOR.BORDER_FIELD);
    doc.setLineWidth(BORDER.TABLE_ROW);
    doc.line(margin, yPos + 6, margin + contentW, yPos + 6);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setFontSize(FONT.SIZE_SECTION_TITLE);
    doc.setFont('helvetica', 'bold');
    doc.text(`${trail.call_sign}  —  ${trail.officer_name}  (Badge: ${trail.badge_number || 'N/A'})`, margin + 5, yPos + 4.2, { maxWidth: contentW - 10 });
    yPos += 8;

    // Stats grid
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.setFontSize(FONT.SIZE_TABLE_BODY);
    doc.setFont('helvetica', 'normal');

    const stats = trail.stats;
    const zonesCount = trail.zone_coverage ? Object.keys(trail.zone_coverage).length : 0;
    const movingPct = stats.total_points > 0 ? Math.round((stats.moving_points / stats.total_points) * 100) : 0;
    const sourceStr = stats.source_breakdown
      ? Object.entries(stats.source_breakdown).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(', ')
      : '';
    const statItems = [
      `Distance: ${stats.total_distance_miles} mi`,
      `Duration: ${stats.duration_minutes} min`,
      `Points: ${stats.total_points}`,
      `Moving: ${stats.moving_points} (${movingPct}%)`,
      `Max Speed: ${stats.max_speed_mph} mph`,
      `Avg Speed: ${stats.avg_speed_mph} mph`,
      `Calls: ${trail.response_segments.length}`,
      `Zones: ${zonesCount}`,
      ...(sourceStr ? [`Sources: ${sourceStr}`] : []),
    ];

    // 4 items per row
    const colW = contentW / 4;
    const rowCount = Math.ceil(statItems.length / 4);
    for (let i = 0; i < statItems.length; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      doc.text(statItems[i], margin + 4 + col * colW, yPos + row * 4.5);
    }
    yPos += rowCount * 4.5 + 3;
  }

  // ════════════════════════════════════════════════════════
  // Detail Pages — per-unit breadcrumb table
  // ════════════════════════════════════════════════════════

  for (const trail of data.trails) {
    newPage();

    // Section header — light bg
    drawSectionHeader(`${trail.call_sign}  —  ${trail.officer_name}  |  Breadcrumb Detail`);

    // Table headers — expanded with Date/Time, Beat, Sector, Zone, Call Type, Source
    const cols = [
      { label: 'Date/Time', w: 24 },
      { label: 'Beat', w: 10 },
      { label: 'Sector', w: 14 },
      { label: 'Zone', w: 16 },
      { label: 'Road', w: 22 },
      { label: 'Cross St', w: 18 },
      { label: 'Speed', w: 10 },
      { label: 'Hdg', w: 8 },
      { label: 'Src', w: 8 },
      { label: 'Status', w: 14 },
      { label: 'Call #', w: 14 },
      { label: 'Call Type', w: 16 },
      { label: 'Dist (mi)', w: 12 },
      { label: 'Lat/Lng', w: 18 },
    ];

    // Adjust widths to fit content width
    const totalColW = cols.reduce((s, c) => s + c.w, 0);
    const scale = contentW / totalColW;
    cols.forEach(c => { c.w = c.w * scale; });

    function drawBreadcrumbHeaders() {
      drawColumnHeaders(cols);
    }

    drawBreadcrumbHeaders();

    // Table rows
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'normal');

    // Sample points for readability — if > 300 points, sample every Nth
    const maxRows = 300;
    const sampleRate = trail.points.length > maxRows ? Math.ceil(trail.points.length / maxRows) : 1;

    for (let i = 0; i < trail.points.length; i += sampleRate) {
      const pt = trail.points[i];

      ensureSpace(5);
      if (yPos === margin + 18) {
        // After page break, redraw headers
        drawBreadcrumbHeaders();
      }

      // Zebra striping
      const rowIdx = Math.floor(i / sampleRate);
      if (rowIdx % 2 === 0) {
        doc.setFillColor(...COLOR.BG_ZEBRA);
        doc.rect(margin, yPos, contentW, 4, 'F');
      }

      doc.setTextColor(...COLOR.TEXT_PRIMARY);
      let xOff = margin;

      // Extract beat code and sector from zone string (e.g., "Riverton D2" → sector "D", beat "2")
      const beatCode = pt.beat_code || '-';
      const zoneParts = pt.zone || '-';
      // beat_code is the full identifier; zone is the area label
      const sector = beatCode !== '-' ? beatCode.replace(/[0-9]/g, '') : '-';

      const rowData = [
        formatDateTime(pt.time),                                        // Date/Time
        beatCode,                                                       // Beat
        sector,                                                         // Sector
        zoneParts,                                                      // Zone
        pt.road_name || '-',                                            // Road
        pt.nearest_intersection || '-',                                 // Cross St
        pt.speed_mph != null ? `${pt.speed_mph}` : '-',                // Speed
        pt.heading_cardinal || '-',                                     // Heading
        (pt.source || 'UNK').toUpperCase().slice(0, 4),                // Source
        (pt.status || '-').replace(/_/g, ' '),                          // Status
        pt.current_call_number || '-',                                  // Call #
        (pt.current_call_type || '-').replace(/_/g, ' '),              // Call Type
        pt.cumulative_distance_miles != null ? `${pt.cumulative_distance_miles}` : '-',  // Dist
        pt.lat != null && pt.lng != null ? `${Number(pt.lat).toFixed(4)},${Number(pt.lng).toFixed(4)}` : '-',  // Lat/Lng
      ];

      for (let ci = 0; ci < cols.length; ci++) {
        doc.text(rowData[ci], xOff + 0.8, yPos + 3, { maxWidth: cols[ci].w - 1.5 });
        xOff += cols[ci].w;
      }

      yPos += 4.5;
    }

    if (sampleRate > 1) {
      yPos += 2;
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.setFontSize(5.5);
      doc.text(`* Showing every ${sampleRate}${sampleRate === 2 ? 'nd' : sampleRate === 3 ? 'rd' : 'th'} point (${trail.points.length} total breadcrumbs)`, margin, yPos);
      yPos += 5;
    }

    // ── Response Time Segments ──────────────────────────
    if (trail.response_segments.length > 0) {
      ensureSpace(30); // header (10) + col headers (6) + at least 2 rows (10)
      drawSectionHeader('Response Time Segments');

      // Response table headers
      const rCols = [
        { label: 'Call #', w: 22 },
        { label: 'Type', w: 30 },
        { label: 'Priority', w: 14 },
        { label: 'Dispatched', w: 22 },
        { label: 'On Scene', w: 22 },
        { label: 'Response Time', w: 20 },
        { label: 'Distance', w: 16 },
        { label: 'Breadcrumbs', w: 16 },
      ];
      const rTotal = rCols.reduce((s, c) => s + c.w, 0);
      const rScale = contentW / rTotal;
      rCols.forEach(c => { c.w = c.w * rScale; });

      drawColumnHeaders(rCols);

      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);

      for (let si = 0; si < trail.response_segments.length; si++) {
        const seg = trail.response_segments[si];
        ensureSpace(5);

        if (si % 2 === 0) {
          doc.setFillColor(...COLOR.BG_ZEBRA);
          doc.rect(margin, yPos, contentW, 4.2, 'F');
        }

        let rxOff = margin;
        const rRowData = [
          seg.call_number || '-',
          (seg.incident_type || '-').replace(/_/g, ' '),
          `P${seg.priority}`,
          seg.dispatched_at ? formatDateTime(seg.dispatched_at) : '-',
          seg.onscene_at ? formatDateTime(seg.onscene_at) : '-',
          seg.time_to_onscene_seconds != null ? formatDuration(seg.time_to_onscene_seconds) : '-',
          seg.response_distance_miles != null ? `${seg.response_distance_miles} mi` : '-',
          String(seg.breadcrumb_count || 0),
        ];

        for (let ci = 0; ci < rCols.length; ci++) {
          doc.text(rRowData[ci], rxOff + 1, yPos + 3, { maxWidth: rCols[ci].w - 1.5 });
          rxOff += rCols[ci].w;
        }
        yPos += 4.5;
      }
    }

    // ── Zone Coverage Summary ──────────────────────────
    const zc = trail.zone_coverage || {};
    if (Object.keys(zc).length > 0) {
      ensureSpace(30); // header (10) + col headers (6) + at least 2 rows (10)
      drawSectionHeader('Zone Coverage Summary');

      const zCols = [
        { label: 'Beat', w: 18 },
        { label: 'Beat Code', w: 24 },
        { label: 'Area / Zone', w: 36 },
        { label: 'Points', w: 16 },
        { label: 'Time Spent', w: 22 },
        { label: '% of Shift', w: 18 },
      ];
      const zTotal = zCols.reduce((s, c) => s + c.w, 0);
      const zScale = contentW / zTotal;
      zCols.forEach(c => { c.w = c.w * zScale; });

      drawColumnHeaders(zCols);

      doc.setFontSize(FONT.SIZE_FIELD_LABEL);
      doc.setTextColor(...COLOR.TEXT_PRIMARY);

      // Sort by time spent descending
      const sorted = Object.entries(zc).sort(([, a], [, b]) => b.time_seconds - a.time_seconds);

      for (let zi = 0; zi < sorted.length; zi++) {
        ensureSpace(5);
        const [beatId, zone] = sorted[zi];

        if (zi % 2 === 0) {
          doc.setFillColor(...COLOR.BG_ZEBRA);
          doc.rect(margin, yPos, contentW, 4.2, 'F');
        }

        let zxOff = margin;
        const zRowData = [
          beatId || '-',
          zone.beat_code || '-',
          zone.city || '-',
          String(zone.point_count || 0),
          formatDuration(zone.time_seconds || 0),
          `${zone.percentage || 0}%`,
        ];

        for (let ci = 0; ci < zCols.length; ci++) {
          doc.text(zRowData[ci], zxOff + 1, yPos + 3, { maxWidth: zCols[ci].w - 1.5 });
          zxOff += zCols[ci].w;
        }
        yPos += 4.5;
      }
    }
  }

  // ── Apply headers/footers to all pages ───────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    addHeaderFooter(p, totalPages);
  }

  // ── Save the PDF ─────────────────────────────────────
  const dateStr = localToday().replace(/-/g, '');
  const firstCallSign = data.trails[0]?.call_sign || 'ALL';
  const suffix = data.total_units === 1 ? `_${firstCallSign}` : '';
  doc.save(`RMPG_Patrol_Tracking${suffix}_${dateStr}.pdf`);
  } catch (err) {
    console.error('Patrol tracking PDF generation failed:', err);
    throw new Error(`Failed to generate patrol tracking PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
