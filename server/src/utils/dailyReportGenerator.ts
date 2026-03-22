// ============================================================
// RMPG Flex — Daily Patrol Report Generator (Server-Side)
// Generates and saves a patrol tracking PDF every 24 hours at
// midnight. Uses jsPDF server-side (no browser APIs).
// Saves to server/data/reports/ with date-based naming.
// ============================================================

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { identifyBeat } from './geofence';
import { reverseGeocodeDetailed } from './geocode';
import { localNow } from './timeUtils';

// Use createRequire for jsPDF — tsx ESM interop can resolve the named
// export incorrectly under long-running processes (not-a-constructor bug).
// CJS require('jspdf').jsPDF always returns the constructor reliably.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const __require = createRequire(import.meta.url);
const { jsPDF } = __require('jspdf');

// ── Report storage directory ────────────────────────────────

const REPORTS_DIR = process.env.RMPG_REPORTS_DIR || path.resolve(__dirname, '../../data/reports');

function ensureReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

// ── Types ───────────────────────────────────────────────────

interface ProcessedPoint {
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
  beat_id: string | null;
  beat_code: string | null;
  zone: string | null;
  cumulative_distance_miles: number;
  road_name: string | null;
  nearest_intersection: string | null;
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
  points: ProcessedPoint[];
  stats: {
    total_points: number;
    stationary_points: number;
    moving_points: number;
    total_distance_miles: number;
    max_speed_mph: number;
    avg_speed_mph: number;
    duration_minutes: number;
  };
  response_segments: ResponseSegment[];
  zone_coverage: Record<string, {
    beat_code: string;
    city: string;
    point_count: number;
    time_seconds: number;
    percentage: number;
  }>;
}

// ── Helpers ─────────────────────────────────────────────────

function formatDateTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) + ' '
      + d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return isoStr; }
}

function formatDate(isoStr: string): string {
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

// ── Data Collection ─────────────────────────────────────────

async function collectDailyBreadcrumbs(dateStr: string): Promise<UnitTrail[]> {
  const db = getDb();

  // Fetch all breadcrumbs for the given date (midnight to midnight)
  const startDate = `${dateStr} 00:00:00`;
  const endDate = `${dateStr} 23:59:59`;

  const rows = db.prepare(`
    SELECT b.id, b.unit_id, b.officer_id, b.latitude, b.longitude, b.accuracy,
      b.heading, b.speed, b.unit_status, b.call_sign, b.officer_name,
      b.badge_number, b.current_call_id, b.current_call_number,
      b.current_call_type, b.recorded_at
    FROM gps_breadcrumbs b
    WHERE b.recorded_at >= ? AND b.recorded_at <= ?
    ORDER BY b.unit_id, b.recorded_at ASC
  `).all(startDate, endDate) as any[];

  if (rows.length === 0) return [];

  // Constants
  const MAX_ACCURACY = 150;
  const MAX_SPEED = 80;
  const MIN_DISTANCE = 3;

  // Haversine distance
  const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const headingCardinal = (deg: number | null): string | null => {
    if (deg == null) return null;
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  };

  // Group by unit
  const trailMap: Record<number, { raw: any[]; info: { call_sign: string; officer_name: string; badge_number: string } }> = {};

  for (const row of rows) {
    if (!trailMap[row.unit_id]) {
      trailMap[row.unit_id] = {
        raw: [],
        info: { call_sign: row.call_sign || '', officer_name: row.officer_name || '', badge_number: row.badge_number || '' },
      };
    }
    if (row.accuracy != null && row.accuracy > MAX_ACCURACY) continue;
    trailMap[row.unit_id].raw.push(row);
  }

  const trails: UnitTrail[] = [];

  for (const [uid, trail] of Object.entries(trailMap)) {
    const unitId = parseInt(uid, 10);
    const points: ProcessedPoint[] = [];
    let totalDistance = 0;
    let maxSpeed = 0;
    let speedSum = 0;
    let speedCount = 0;
    let stationaryCount = 0;
    let prevAccepted: any = null;

    for (const row of trail.raw) {
      let distFromPrev: number | null = null;
      let timeDelta: number | null = null;

      if (prevAccepted) {
        distFromPrev = haversineM(prevAccepted.latitude, prevAccepted.longitude, row.latitude, row.longitude);
        const prevTime = new Date(prevAccepted.recorded_at).getTime();
        const curTime = new Date(row.recorded_at).getTime();
        if (isNaN(prevTime) || isNaN(curTime)) continue;
        timeDelta = (curTime - prevTime) / 1000;

        if (timeDelta > 0) {
          const impliedSpeed = distFromPrev / timeDelta;
          if (impliedSpeed > MAX_SPEED) continue;
        }
        if (timeDelta <= 0) continue;
      }

      const speedMs = row.speed != null ? row.speed : (distFromPrev && timeDelta && timeDelta > 0 ? distFromPrev / timeDelta : null);
      const speedMph = speedMs != null ? speedMs * 2.237 : null;
      const isStationary = (speedMs != null && speedMs < 0.5) || (distFromPrev != null && distFromPrev < MIN_DISTANCE);

      if (distFromPrev != null && !isStationary) totalDistance += distFromPrev;
      if (speedMph != null && speedMph > 0) {
        if (speedMph > maxSpeed) maxSpeed = speedMph;
        speedSum += speedMph;
        speedCount++;
      }
      if (isStationary) stationaryCount++;

      const beat = identifyBeat(row.latitude, row.longitude);
      const cumulativeMiles = Math.round((totalDistance / 1609.34) * 100) / 100;

      points.push({
        lat: row.latitude,
        lng: row.longitude,
        accuracy: row.accuracy,
        heading_cardinal: headingCardinal(row.heading),
        speed_mph: speedMph != null ? Math.round(speedMph * 10) / 10 : null,
        status: row.unit_status,
        current_call_number: row.current_call_number,
        current_call_type: row.current_call_type,
        time: row.recorded_at,
        distance_from_prev_meters: distFromPrev != null ? Math.round(distFromPrev * 10) / 10 : null,
        is_stationary: isStationary,
        beat_id: beat?.beat_id || null,
        beat_code: beat?.beat_code || null,
        zone: beat ? `${beat.city} ${beat.district_letter}${beat.beat_number}` : null,
        cumulative_distance_miles: cumulativeMiles,
        road_name: null,
        nearest_intersection: null,
      });

      prevAccepted = row;
    }

    // Response time segments
    const responseSegments: ResponseSegment[] = [];
    const callIds = new Set(points.filter(p => p.current_call_number).map(p => {
      // Look up call ID from breadcrumb data
      const brow = trail.raw.find(r => r.current_call_number === p.current_call_number && r.current_call_id);
      return brow?.current_call_id;
    }).filter(Boolean));

    for (const callId of callIds) {
      try {
        const call = db.prepare(`
          SELECT id, call_number, incident_type, priority,
            dispatched_at, onscene_at
          FROM calls_for_service WHERE id = ?
        `).get(callId) as any;

        if (!call) continue;

        const callPoints = points.filter(p => p.current_call_number === call.call_number);
        if (callPoints.length === 0) continue;

        let responseDist = 0;
        for (let i = 1; i < callPoints.length; i++) {
          const d = callPoints[i].distance_from_prev_meters;
          if (d && !callPoints[i].is_stationary) responseDist += d;
        }

        let timeToOnscene: number | null = null;
        if (call.dispatched_at && call.onscene_at) {
          timeToOnscene = Math.round((new Date(call.onscene_at).getTime() - new Date(call.dispatched_at).getTime()) / 1000);
        }

        responseSegments.push({
          call_number: call.call_number,
          incident_type: call.incident_type,
          priority: call.priority,
          dispatched_at: call.dispatched_at,
          onscene_at: call.onscene_at,
          time_to_onscene_seconds: timeToOnscene,
          response_distance_miles: Math.round((responseDist / 1609.34) * 100) / 100,
          breadcrumb_count: callPoints.length,
        });
      } catch (e: any) { console.warn('[DailyReport] Section skipped:', e?.message); }
    }

    // Zone coverage
    const zoneCoverage: Record<string, { beat_code: string; city: string; point_count: number; time_seconds: number; percentage: number }> = {};
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (!pt.beat_id) continue;
      if (!zoneCoverage[pt.beat_id]) {
        zoneCoverage[pt.beat_id] = { beat_code: pt.beat_code || '', city: pt.zone || '', point_count: 0, time_seconds: 0, percentage: 0 };
      }
      zoneCoverage[pt.beat_id].point_count++;
      // Estimate time in zone from interval between consecutive points
      if (i > 0 && points[i - 1].beat_id === pt.beat_id) {
        const prevTime = new Date(points[i - 1].time).getTime();
        const curTime = new Date(pt.time).getTime();
        const delta = (curTime - prevTime) / 1000;
        if (delta > 0 && delta < 600) { // cap at 10 min gap to avoid idle inflation
          zoneCoverage[pt.beat_id].time_seconds += delta;
        }
      }
    }
    const totalTrackedSeconds = Object.values(zoneCoverage).reduce((s, z) => s + z.time_seconds, 0);
    for (const z of Object.values(zoneCoverage)) {
      z.percentage = totalTrackedSeconds > 0 ? Math.round((z.time_seconds / totalTrackedSeconds) * 1000) / 10 : 0;
    }

    // Duration
    let durationMinutes = 0;
    if (points.length >= 2) {
      const first = new Date(points[0].time).getTime();
      const last = new Date(points[points.length - 1].time).getTime();
      durationMinutes = Math.round((last - first) / 60000);
    }

    trails.push({
      unit_id: unitId,
      call_sign: trail.info.call_sign,
      officer_name: trail.info.officer_name,
      badge_number: trail.info.badge_number,
      points,
      stats: {
        total_points: points.length,
        stationary_points: stationaryCount,
        moving_points: points.length - stationaryCount,
        total_distance_miles: Math.round((totalDistance / 1609.34) * 100) / 100,
        max_speed_mph: Math.round(maxSpeed * 10) / 10,
        avg_speed_mph: speedCount > 0 ? Math.round((speedSum / speedCount) * 10) / 10 : 0,
        duration_minutes: durationMinutes,
      },
      response_segments: responseSegments,
      zone_coverage: zoneCoverage,
    });
  }

  // ── Reverse geocode sampled points for road/cross-street ──
  let geocodeCount = 0;
  const MAX_GEOCODE_CALLS = 50;
  const GEOCODE_MIN_DISTANCE = 100; // meters between geocoded points

  for (const trail of trails) {
    let lastGeoLat = 0;
    let lastGeoLng = 0;
    let lastRoadName: string | null = null;
    let lastIntersection: string | null = null;

    for (const pt of trail.points) {
      const dist = lastGeoLat ? haversineM(lastGeoLat, lastGeoLng, pt.lat, pt.lng) : Infinity;

      if (dist > GEOCODE_MIN_DISTANCE && geocodeCount < MAX_GEOCODE_CALLS) {
        try {
          const result = await reverseGeocodeDetailed(pt.lat, pt.lng);
          if (result) {
            lastRoadName = result.road_name;
            lastIntersection = result.nearest_intersection;
          }
        } catch (e: any) { console.warn('[DailyReport] Section skipped:', e?.message); }
        lastGeoLat = pt.lat;
        lastGeoLng = pt.lng;
        geocodeCount++;
      }

      pt.road_name = lastRoadName;
      pt.nearest_intersection = lastIntersection;
    }
  }

  console.log(`[Daily Report] Reverse geocoded ${geocodeCount} points for road/intersection data`);

  return trails;
}

// ── PDF Generation (Server-Side) ────────────────────────────

// Color constants (matching client pdfTokens)
const CLR = {
  TEXT:       [0, 0, 0] as const,
  TEXT_SEC:   [80, 80, 80] as const,
  TEXT_MUTED: [160, 160, 160] as const,
  BORDER:    [185, 185, 190] as const,
  BG_HDR:    [240, 240, 245] as const,
  BG_TBL:    [230, 230, 238] as const,
  BG_ZEBRA:  [238, 238, 243] as const,
  BG_DARK:   [30, 30, 30] as const,
  PRIMARY:   [0, 90, 180] as const,
  ACCENT:    [200, 170, 80] as const,
};

function generateDailyPdf(trails: UnitTrail[], dateStr: string): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const reportDate = new Date().toLocaleString('en-US');
  const totalPoints = trails.reduce((s, t) => s + t.stats.total_points, 0);

  let yPos = margin;

  // Load branding from DB
  const db = getDb();
  let brandText = 'ROCKY MOUNTAIN PATROL GROUP';
  let brandSub = 'Private Security & Operations Support';
  try {
    const cfg = db.prepare("SELECT config_value FROM system_config WHERE config_key = 'branding'").get() as any;
    if (cfg?.config_value) {
      const b = JSON.parse(cfg.config_value);
      brandText = b.report_header_text || brandText;
      brandSub = b.report_subheader_text || brandSub;
    }
  } catch (e: any) { console.warn('[DailyReport] Using defaults:', e?.message); }

  // ── Section header (light bg + dark text) ──
  function drawSectionHeader(title: string) {
    doc.setFillColor(...CLR.PRIMARY);
    doc.rect(margin, yPos, 2, 7, 'F');
    doc.setFillColor(...CLR.BG_HDR);
    doc.rect(margin + 2, yPos, contentW - 2, 7, 'F');
    doc.setDrawColor(...CLR.TEXT_SEC);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos + 7, margin + contentW, yPos + 7);
    doc.setTextColor(...CLR.TEXT);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(title.toUpperCase(), margin + 5, yPos + 5);
    doc.setFont('helvetica', 'normal');
    yPos += 10;
  }

  // ── Column headers ──
  function drawColumnHeaders(cols: { label: string; w: number }[]) {
    doc.setFillColor(...CLR.BG_TBL);
    doc.rect(margin, yPos, contentW, 5, 'F');
    doc.setDrawColor(...CLR.BORDER);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos + 5, margin + contentW, yPos + 5);
    doc.setTextColor(...CLR.TEXT_SEC);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    let xOff = margin;
    for (const col of cols) {
      doc.text(col.label, xOff + 1, yPos + 3.5);
      xOff += col.w;
    }
    doc.setFont('helvetica', 'normal');
    yPos += 6;
  }

  // ── Page utilities ──
  // Page 1 = cover (no top header — it has its own centered layout)
  // Pages 2+ = dark header bar with agency name + report title
  function addHeaderFooter(pageNum: number, totalPages: number) {
    if (pageNum > 1) {
      doc.setFillColor(...CLR.BG_DARK);
      doc.rect(0, 0, pageW, 14, 'F');

      // Logo in header if available
      if (logoPngB64) {
        try {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(margin - 1, 1.5, 13, 11, 1, 1, 'F');
          doc.addImage(logoPngB64, 'PNG', margin - 0.5, 2, 12, 10);
        } catch (e: any) { console.warn('[DailyReport] Ignored error:', e?.message); }
      }

      const textX = logoPngB64 ? margin + 14 : margin;
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(brandText, textX, 9);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`DAILY PATROL REPORT  |  ${dateStr}  |  FORM PS-210`, pageW - margin, 9, { align: 'right' });

      // Accent strip
      doc.setFillColor(...CLR.PRIMARY);
      doc.rect(0, 14, pageW / 2, 1, 'F');
      doc.setFillColor(...CLR.ACCENT);
      doc.rect(pageW / 2, 14, pageW / 2, 1, 'F');
    }

    // Footer on ALL pages
    doc.setFillColor(...CLR.BG_HDR);
    doc.rect(0, pageH - 8, pageW, 8, 'F');
    doc.setDrawColor(...CLR.BORDER);
    doc.setLineWidth(0.2);
    doc.line(0, pageH - 8, pageW, pageH - 8);
    doc.setTextColor(...CLR.TEXT_MUTED);
    doc.setFontSize(5.5);
    doc.text(`Generated: ${reportDate}  |  FORM PS-210  |  CONFIDENTIAL — INTERNAL USE ONLY`, margin, pageH - 3.5);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageW - margin, pageH - 3.5, { align: 'right' });
    doc.setTextColor(...CLR.TEXT);
  }

  function newPage() {
    doc.addPage();
    yPos = margin + 18;
  }

  function ensureSpace(needed: number) {
    if (yPos + needed > pageH - 12) newPage();
  }

  // ════════════════════════════════════════════════════════
  // Cover Page — Professional centered logo + bold title
  // ════════════════════════════════════════════════════════

  // Try to load logo from disk
  let logoPngB64: string | null = null;
  try {
    const logoPath = path.resolve(__dirname, '../../../client/public/RMPG Logo Dark.png');
    if (fs.existsSync(logoPath)) {
      const logoData = fs.readFileSync(logoPath);
      logoPngB64 = 'data:image/png;base64,' + logoData.toString('base64');
    }
  } catch (e: any) { console.warn('[DailyReport] Logo unavailable:', e?.message); }

  // White background with subtle border at top
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, 60, 'F');

  // Accent strip at top
  doc.setFillColor(...CLR.PRIMARY);
  doc.rect(0, 0, pageW, 2, 'F');

  // Centered logo
  if (logoPngB64) {
    try {
      const logoSize = 30;
      const logoX = (pageW - logoSize) / 2;
      doc.addImage(logoPngB64, 'PNG', logoX, 6, logoSize, logoSize);
    } catch (e: any) { console.warn('[DailyReport] Ignored error:', e?.message); }
  }

  // Bold centered title
  const titleY = logoPngB64 ? 42 : 18;
  doc.setTextColor(...CLR.TEXT);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(brandText, pageW / 2, titleY, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...CLR.TEXT_SEC);
  doc.text(brandSub, pageW / 2, titleY + 6, { align: 'center' });

  // Bold report title
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...CLR.PRIMARY);
  doc.text('DAILY PATROL TRACKING REPORT', pageW / 2, titleY + 14, { align: 'center' });

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...CLR.TEXT_MUTED);
  doc.text(`FORM PS-210  |  Rev. 2026-03`, pageW / 2, titleY + 19, { align: 'center' });

  // Accent strip divider
  const stripY = titleY + 22;
  doc.setFillColor(...CLR.PRIMARY);
  doc.rect(margin, stripY, contentW / 2, 1.2, 'F');
  doc.setFillColor(...CLR.ACCENT);
  doc.rect(margin + contentW / 2, stripY, contentW / 2, 1.2, 'F');

  yPos = stripY + 6;

  drawSectionHeader(`Report Period — ${formatDate(dateStr)}`);

  // Metadata
  doc.setTextColor(...CLR.TEXT);
  doc.setFontSize(9);
  const metaLines: [string, string][] = [
    ['Report Date:', formatDate(dateStr)],
    ['Period:', `${dateStr} 00:00 — 23:59`],
    ['Units Tracked:', String(trails.length)],
    ['Total Breadcrumbs:', String(totalPoints)],
    ['Generated:', reportDate],
    ['Auto-Generated:', 'Yes — Midnight Daily Report'],
  ];

  for (const [label, value] of metaLines) {
    doc.setFont('helvetica', 'bold');
    doc.text(label, margin + 4, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(value, margin + 44, yPos);
    yPos += 5;
  }
  yPos += 6;

  // Unit summaries
  drawSectionHeader('Unit Summary');

  for (const trail of trails) {
    ensureSpace(20);
    doc.setFillColor(...CLR.PRIMARY);
    doc.rect(margin, yPos, 2, 6, 'F');
    doc.setFillColor(245, 245, 250);
    doc.rect(margin + 2, yPos, contentW - 2, 6, 'F');
    doc.setTextColor(...CLR.TEXT);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(`${trail.call_sign}  —  ${trail.officer_name}  (Badge: ${trail.badge_number || 'N/A'})`, margin + 5, yPos + 4.2);
    yPos += 8;

    doc.setTextColor(...CLR.TEXT_SEC);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    const s = trail.stats;
    const items = [
      `Distance: ${s.total_distance_miles} mi`, `Duration: ${s.duration_minutes} min`,
      `Points: ${s.total_points}`, `Max Speed: ${s.max_speed_mph} mph`,
      `Avg Speed: ${s.avg_speed_mph} mph`, `Calls: ${trail.response_segments.length}`,
      `Zones: ${Object.keys(trail.zone_coverage).length}`,
      `Moving: ${s.moving_points} (${s.total_points > 0 ? Math.round((s.moving_points / s.total_points) * 100) : 0}%)`,
    ];
    const colW = contentW / 4;
    for (let i = 0; i < items.length; i++) {
      doc.text(items[i], margin + 4 + (i % 4) * colW, yPos + Math.floor(i / 4) * 4.5);
    }
    yPos += 12;
  }

  // ════════════════════════════════════════════════════════
  // Detail Pages
  // ════════════════════════════════════════════════════════

  for (const trail of trails) {
    newPage();
    drawSectionHeader(`${trail.call_sign}  —  ${trail.officer_name}  |  Breadcrumb Detail`);

    const cols = [
      { label: 'Date/Time', w: 24 }, { label: 'Beat', w: 10 }, { label: 'Sector', w: 12 },
      { label: 'Zone', w: 16 }, { label: 'Road', w: 24 }, { label: 'Cross St', w: 22 },
      { label: 'Speed', w: 10 }, { label: 'Hdg', w: 8 },
      { label: 'Status', w: 14 }, { label: 'Call #', w: 14 }, { label: 'Call Type', w: 16 },
      { label: 'Dist (mi)', w: 12 }, { label: 'Lat/Lng', w: 20 },
    ];
    const totalColW = cols.reduce((s, c) => s + c.w, 0);
    const scale = contentW / totalColW;
    cols.forEach(c => { c.w *= scale; });

    function drawBcHeaders() { drawColumnHeaders(cols); }
    drawBcHeaders();

    doc.setFontSize(5.5);
    const sampleRate = trail.points.length > 300 ? Math.ceil(trail.points.length / 300) : 1;

    for (let i = 0; i < trail.points.length; i += sampleRate) {
      const pt = trail.points[i];
      ensureSpace(5);
      if (yPos === margin + 18) drawBcHeaders();

      const rowIdx = Math.floor(i / sampleRate);
      if (rowIdx % 2 === 0) {
        doc.setFillColor(...CLR.BG_ZEBRA);
        doc.rect(margin, yPos, contentW, 4, 'F');
      }

      doc.setTextColor(...CLR.TEXT);
      let xOff = margin;
      const beatCode = pt.beat_code || '-';
      const sector = beatCode !== '-' ? beatCode.replace(/[0-9]/g, '') : '-';
      const rowData = [
        formatDateTime(pt.time), beatCode, sector, pt.zone || '-',
        pt.road_name || '-', pt.nearest_intersection || '-',
        pt.speed_mph != null ? `${pt.speed_mph}` : '-', pt.heading_cardinal || '-',
        (pt.status || '-').replace(/_/g, ' '), pt.current_call_number || '-',
        (pt.current_call_type || '-').replace(/_/g, ' '),
        pt.cumulative_distance_miles != null ? `${pt.cumulative_distance_miles}` : '-',
        `${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`,
      ];

      for (let ci = 0; ci < cols.length; ci++) {
        doc.text(rowData[ci], xOff + 0.8, yPos + 3, { maxWidth: cols[ci].w - 1.5 });
        xOff += cols[ci].w;
      }
      yPos += 4.5;
    }

    if (sampleRate > 1) {
      yPos += 2;
      doc.setTextColor(...CLR.TEXT_MUTED);
      doc.setFontSize(5.5);
      doc.text(`* Sampled every ${sampleRate} points (${trail.points.length} total)`, margin, yPos);
      yPos += 5;
    }

    // Response segments
    if (trail.response_segments.length > 0) {
      ensureSpace(30); // header (10) + col headers (6) + at least 2 rows (10)
      drawSectionHeader('Response Time Segments');

      const rCols = [
        { label: 'Call #', w: 22 }, { label: 'Type', w: 30 }, { label: 'Priority', w: 14 },
        { label: 'Dispatched', w: 22 }, { label: 'On Scene', w: 22 },
        { label: 'Response Time', w: 20 }, { label: 'Distance', w: 16 },
      ];
      const rTotal = rCols.reduce((s, c) => s + c.w, 0);
      rCols.forEach(c => { c.w *= contentW / rTotal; });
      drawColumnHeaders(rCols);

      doc.setFontSize(6);
      for (let si = 0; si < trail.response_segments.length; si++) {
        const seg = trail.response_segments[si];
        ensureSpace(5);
        if (si % 2 === 0) {
          doc.setFillColor(...CLR.BG_ZEBRA);
          doc.rect(margin, yPos, contentW, 4.2, 'F');
        }
        doc.setTextColor(...CLR.TEXT);
        let rxOff = margin;
        const rRow = [
          seg.call_number || '-', (seg.incident_type || '-').replace(/_/g, ' '),
          `P${seg.priority}`, seg.dispatched_at ? formatDateTime(seg.dispatched_at) : '-',
          seg.onscene_at ? formatDateTime(seg.onscene_at) : '-',
          seg.time_to_onscene_seconds != null ? formatDuration(seg.time_to_onscene_seconds) : '-',
          `${seg.response_distance_miles} mi`,
        ];
        for (let ci = 0; ci < rCols.length; ci++) {
          doc.text(rRow[ci], rxOff + 1, yPos + 3);
          rxOff += rCols[ci].w;
        }
        yPos += 4.5;
      }
    }

    // Zone coverage
    const zc = trail.zone_coverage;
    if (Object.keys(zc).length > 0) {
      ensureSpace(30); // header (10) + col headers (6) + at least 2 rows (10)
      drawSectionHeader('Zone Coverage Summary');

      const zCols = [
        { label: 'Beat', w: 18 }, { label: 'Code', w: 24 }, { label: 'Area', w: 36 },
        { label: 'Points', w: 16 }, { label: 'Time', w: 22 }, { label: '% Shift', w: 18 },
      ];
      const zTotal = zCols.reduce((s, c) => s + c.w, 0);
      zCols.forEach(c => { c.w *= contentW / zTotal; });
      drawColumnHeaders(zCols);

      doc.setFontSize(6);
      const sorted = Object.entries(zc).sort(([, a], [, b]) => b.time_seconds - a.time_seconds);
      for (let zi = 0; zi < sorted.length; zi++) {
        ensureSpace(5);
        const [beatId, zone] = sorted[zi];
        if (zi % 2 === 0) {
          doc.setFillColor(...CLR.BG_ZEBRA);
          doc.rect(margin, yPos, contentW, 4.2, 'F');
        }
        doc.setTextColor(...CLR.TEXT);
        let zxOff = margin;
        const zRow = [beatId, zone.beat_code, zone.city, String(zone.point_count), formatDuration(zone.time_seconds), `${zone.percentage}%`];
        for (let ci = 0; ci < zCols.length; ci++) {
          doc.text(zRow[ci], zxOff + 1, yPos + 3);
          zxOff += zCols[ci].w;
        }
        yPos += 4.5;
      }
    }
  }

  // Apply headers/footers
  const totalPages = doc.internal.pages.length - 1;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    addHeaderFooter(p, totalPages);
  }

  // Return as Buffer
  const arrayBuf = doc.output('arraybuffer');
  return Buffer.from(arrayBuf);
}

// ── Public API ──────────────────────────────────────────────

/**
 * Generate and save a daily patrol tracking PDF for the given date.
 * Returns the filename if successful, null if no data.
 */
export async function generateAndSaveDailyReport(dateStr?: string): Promise<string | null> {
  const date = dateStr || (() => {
    // Default to yesterday in local timezone (since this runs at midnight)
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  console.log(`[Daily Report] Generating patrol tracking report for ${date}...`);

  const trails = await collectDailyBreadcrumbs(date);

  if (trails.length === 0) {
    console.log(`[Daily Report] No breadcrumb data for ${date}, skipping.`);
    return null;
  }

  const totalPoints = trails.reduce((s, t) => s + t.stats.total_points, 0);
  console.log(`[Daily Report] Found ${trails.length} units, ${totalPoints} breadcrumbs for ${date}`);

  const pdfBuffer = generateDailyPdf(trails, date);

  // Save to reports directory
  ensureReportsDir();
  const filename = `RMPG_Daily_Patrol_${date.replace(/-/g, '')}.pdf`;
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, pdfBuffer);

  console.log(`[Daily Report] Saved: ${filepath} (${Math.round(pdfBuffer.length / 1024)} KB)`);

  // Also save metadata
  try {
    const metaPath = path.join(REPORTS_DIR, `${filename}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      date,
      generated_at: localNow(),
      units: trails.length,
      total_breadcrumbs: totalPoints,
      file_size_bytes: pdfBuffer.length,
      filename,
    }, null, 2));
  } catch (metaErr) {
    console.error('[Daily Report] Failed to write metadata file:', metaErr);
  }

  return filename;
}

/**
 * List all saved daily patrol reports.
 */
export function listDailyReports(): { filename: string; date: string; size: number; generated_at: string }[] {
  ensureReportsDir();
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.pdf') && f.startsWith('RMPG_Daily_Patrol_'));
  return files.map(f => {
    const filepath = path.join(REPORTS_DIR, f);
    const stat = fs.statSync(filepath);

    // Try to read metadata
    let date = '';
    let generated_at = stat.mtime.toISOString();
    try {
      const metaPath = filepath + '.meta.json';
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        date = meta.date || '';
        generated_at = meta.generated_at || generated_at;
      }
    } catch (e: any) { console.warn('[DailyReport] Using defaults:', e?.message); }

    // Extract date from filename if not in meta
    if (!date) {
      const match = f.match(/(\d{8})/);
      if (match) {
        const ds = match[1];
        date = `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6, 8)}`;
      }
    }

    return { filename: f, date, size: stat.size, generated_at };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get the full path for a saved report file.
 */
export function getReportPath(filename: string): string | null {
  ensureReportsDir();
  // Prevent path traversal
  const safe = path.basename(filename);
  const filepath = path.join(REPORTS_DIR, safe);
  if (!fs.existsSync(filepath)) return null;
  return filepath;
}

// ── Midnight Scheduler ──────────────────────────────────────

let midnightTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the midnight daily report scheduler.
 * Calculates time until next midnight and sets a repeating cycle.
 */
export function startDailyReportScheduler(): void {
  if (midnightTimer) return;

  const scheduleNextRun = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(nextMidnight.getDate() + 1);
    nextMidnight.setHours(0, 0, 30, 0); // 30 seconds past midnight for safety

    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    const hoursUntil = Math.round(msUntilMidnight / 3600000 * 10) / 10;
    console.log(`[Daily Report] Next generation scheduled in ${hoursUntil}h (${nextMidnight.toLocaleString()})`);

    midnightTimer = setTimeout(async () => {
      try {
        await generateAndSaveDailyReport();
      } catch (err) {
        console.error('[Daily Report] Generation failed:', err);
      }

      // Auto-archive: purge old breadcrumbs based on retention policy (default 30 days)
      try {
        const db = getDb();
        // Check if retention_policies table exists before querying
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='retention_policies'").get();
        const days = tableExists
          ? ((db.prepare("SELECT retention_days FROM retention_policies WHERE entity_type = 'gps_breadcrumbs' AND is_active = 1").get() as { retention_days: number } | undefined)?.retention_days ?? 30)
          : 30;
        const result = db.prepare(
          `DELETE FROM gps_breadcrumbs WHERE recorded_at < datetime('now', 'localtime', '-' || ? || ' days')`
        ).run(days);
        if (result.changes > 0) {
          console.log(`[Daily Report] Purged ${result.changes} breadcrumbs older than ${days} day(s)`);
        }
      } catch (err) {
        console.error('[Daily Report] Breadcrumb retention cleanup failed:', err);
      }

      // Purge old dashcam events based on retention policy (default 90 days)
      try {
        const db = getDb();
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='retention_policies'").get();
        const camDays = tableExists
          ? ((db.prepare("SELECT retention_days FROM retention_policies WHERE entity_type = 'dashcam_events' AND is_active = 1").get() as { retention_days: number } | undefined)?.retention_days ?? 90)
          : 90;
        const dashcamTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dashcam_events'").get();
        if (dashcamTableExists) {
          const camResult = db.prepare(
            `DELETE FROM dashcam_events WHERE created_at < datetime('now', 'localtime', '-' || ? || ' days')`
          ).run(camDays);
          if (camResult.changes > 0) {
            console.log(`[Daily Report] Purged ${camResult.changes} dashcam events older than ${camDays} day(s)`);
          }
        }
      } catch (err) {
        console.error('[Daily Report] Dashcam event retention cleanup failed:', err);
      }

      // Schedule the next one
      midnightTimer = null;
      scheduleNextRun();
    }, msUntilMidnight);
  };

  scheduleNextRun();
  console.log('[Daily Report] Midnight scheduler started');
}

export function stopDailyReportScheduler(): void {
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
    console.log('[Daily Report] Scheduler stopped');
  }
}
