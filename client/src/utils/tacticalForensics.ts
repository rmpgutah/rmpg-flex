// ============================================================
// RMPG Flex — Tactical forensic helpers (pure)
// ============================================================
// Pure cores behind the forensic player's tactical wave: live threat/behavior
// detection, instantaneous g-force, digital-zoom transform math, and the
// burned-in evidence stamp. All deterministic → unit-tested.
// ============================================================

import { positionAtTime, type GpsPoint } from './dashcamForensics';

const MPH_TO_MS = 0.44704;
const G = 9.80665;

/** Instantaneous longitudinal g-force at a time (from the 1Hz speed track).
 *  Positive = accelerating, negative = braking. */
export function instAccelG(gps: GpsPoint[], tSec: number, window = 0.6): number {
  if (gps.length < 2) return 0;
  const a = positionAtTime(gps, Math.max(0, tSec - window));
  const b = positionAtTime(gps, tSec + window);
  if (!a || !b) return 0;
  const dv = ((b.speed || 0) - (a.speed || 0)) * MPH_TO_MS;   // m/s
  const dt = 2 * window;
  return dv / dt / G;
}

export type Severity = 'info' | 'warning' | 'critical';
export interface Threat { key: string; label: string; severity: Severity }

export interface ThreatInput {
  speed: number;            // current mph
  turnRate: number;         // deg/sec (signed)
  accelG: number;           // instantaneous longitudinal g (signed)
  postedLimit?: number | null;
}

/** Live behavior/threat flags from telemetry — the tactical chips. */
export function activeThreats(i: ThreatInput): Threat[] {
  const out: Threat[] = [];
  const limit = i.postedLimit ?? null;
  if (limit != null && i.speed > limit + 15) out.push({ key: 'speed', label: `${Math.round(i.speed)} / ${limit} MPH`, severity: 'critical' });
  else if (limit != null && i.speed > limit + 8) out.push({ key: 'speed', label: `${Math.round(i.speed)} / ${limit} MPH`, severity: 'warning' });
  else if (limit == null && i.speed > 80) out.push({ key: 'speed', label: `${Math.round(i.speed)} MPH`, severity: 'critical' });
  else if (limit == null && i.speed > 70) out.push({ key: 'speed', label: `${Math.round(i.speed)} MPH`, severity: 'warning' });

  if (i.accelG <= -0.55) out.push({ key: 'brake', label: 'HARD BRAKE', severity: 'critical' });
  else if (i.accelG <= -0.38) out.push({ key: 'brake', label: 'BRAKING', severity: 'warning' });

  if (i.accelG >= 0.5) out.push({ key: 'accel', label: 'RAPID ACCEL', severity: 'warning' });

  const tr = Math.abs(i.turnRate);
  if (tr >= 28) out.push({ key: 'turn', label: `SHARP TURN ${i.turnRate > 0 ? 'R' : 'L'}`, severity: 'critical' });
  else if (tr >= 16) out.push({ key: 'turn', label: `TURNING ${i.turnRate > 0 ? 'R' : 'L'}`, severity: 'warning' });

  return out;
}

export const severityColor = (s: Severity): string =>
  s === 'critical' ? '#ef4444' : s === 'warning' ? '#d4a017' : '#7dd3fc';

// ── Digital PTZ zoom ─────────────────────────────────────────

export type Box = [number, number, number, number];
export interface ZoomTransform { scale: number; originXPct: number; originYPct: number }

/** CSS transform to digitally zoom into a box so it fills ~`fill` of the frame,
 *  capped at `maxScale`. transform-origin is the box centre (percent). */
export function zoomTransform(box: Box, viewW: number, viewH: number, fill = 0.6, maxScale = 4): ZoomTransform {
  const [x, y, w, h] = box;
  const need = Math.max(w / viewW, h / viewH);
  const scale = Math.max(1.2, Math.min(maxScale, fill / Math.max(0.001, need)));
  const cx = x + w / 2, cy = y + h / 2;
  return {
    scale,
    originXPct: Math.max(0, Math.min(100, (cx / viewW) * 100)),
    originYPct: Math.max(0, Math.min(100, (cy / viewH) * 100)),
  };
}

// ── Evidence stamp ───────────────────────────────────────────

export interface EvidenceMeta {
  caseLabel?: string | null;
  eventType?: string | null;
  address?: string | null;
  timestamp?: string | null;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  plate?: string | null;
  device?: string | null;
  officer?: string | null;
  playbackTime?: number | null;   // seconds into clip
}

/** Lines for the burned-in chain-of-custody stamp on an exported frame. */
export function evidenceStampLines(m: EvidenceMeta): string[] {
  const lines: string[] = [];
  lines.push(`RMPG FLEX — FORENSIC EVIDENCE CAPTURE`);
  const id: string[] = [];
  if (m.eventType) id.push(m.eventType.replace(/_/g, ' '));
  if (m.device) id.push(`UNIT ${m.device}`);
  if (m.caseLabel) id.push(m.caseLabel);
  if (id.length) lines.push(id.join('  ·  '));
  if (m.address) lines.push(m.address);
  const geo: string[] = [];
  if (m.timestamp) geo.push(m.timestamp);
  if (m.lat != null && m.lng != null) geo.push(`${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}`);
  if (m.speed != null) geo.push(`${Math.round(m.speed)} mph`);
  if (m.playbackTime != null) geo.push(`t+${m.playbackTime.toFixed(1)}s`);
  if (geo.length) lines.push(geo.join('  ·  '));
  if (m.plate) lines.push(`PLATE: ${m.plate}`);
  if (m.officer) lines.push(`Captured by ${m.officer}`);
  return lines;
}

/** Safe filename for an evidence export. */
export function evidenceFilename(m: EvidenceMeta): string {
  const stamp = (m.timestamp || '').replace(/[^0-9]/g, '').slice(0, 14) || 'capture';
  const plate = (m.plate || '').replace(/[^A-Z0-9]/gi, '');
  return `rmpg-evidence_${m.device || 'cam'}_${stamp}${plate ? '_' + plate : ''}.jpg`;
}
