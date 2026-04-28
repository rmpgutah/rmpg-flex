// ============================================================
// driving_events — source-agnostic insert helper
// ============================================================
// Single normalized writer for telematics events across all
// sources (ClearPathGPS, Traccar, Freematics, Flex Dashcam AI).
// Vendor-specific code paths translate their event vocabulary
// into the normalized event_type set, then call insertDrivingEvent
// here. Reports/UIs read the unified shape.
//
// Dedup: (source, source_event_id) is unique-by-convention.
// Re-inserts of the same event are silently skipped.
//
// Linkage: at write time, attempts to resolve the active call
// for the unit so that AAR replay can scrub video alongside
// dispatch state. Beat lookup is best-effort against
// dispatch_beats and may be deferred to a backfill job for
// performance under load.

import type { Database } from 'better-sqlite3';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';

export type DrivingEventSource =
  | 'clearpathgps'
  | 'traccar'
  | 'freematics'
  | 'flex_ai'
  | 'manual';

/**
 * Normalized event vocabulary. Keep this list narrow on purpose —
 * adapters MUST map vendor strings to one of these. Anything that
 * doesn't fit cleanly goes in event_type='custom' with detail in
 * raw_json.notes, so reports stay sane.
 */
export type DrivingEventType =
  // IMU-derived (any source with an accelerometer)
  | 'hard_brake'
  | 'hard_accel'
  | 'hard_turn'
  | 'impact'
  // ADAS / vision (Flex Dashcam AI, premium telematics vendors)
  | 'fcw'        // forward collision warning
  | 'ldw'        // lane departure warning
  | 'tailgate'   // following too closely
  | 'pedestrian' // pedestrian proximity warning
  // Driver monitoring
  | 'drowsy'
  | 'distracted'
  | 'phone_use'
  | 'seatbelt_off'
  // Speed / route
  | 'speeding'
  | 'overspeed_zone'
  | 'route_deviation'
  // Vehicle / OBD
  | 'ignition_on'
  | 'ignition_off'
  | 'idle_excessive'
  | 'dtc_set'
  // Officer-safety
  | 'panic'
  | 'sos'
  | 'man_down'
  // CAD-driven custom
  | 'k9_deploy'
  | 'weapon_draw'
  | 'use_of_force'
  | 'pursuit_start'
  | 'pursuit_end'
  // Catch-all
  | 'custom';

export type DrivingEventSeverity = 'info' | 'warning' | 'alert' | 'critical';

export interface DrivingEventInput {
  source: DrivingEventSource;
  /** Vendor's id for this event (used for dedup). Recommended even if synthetic. */
  source_event_id?: string | null;
  device_id?: string | null;
  unit_id?: number | null;
  officer_id?: number | null;
  event_type: DrivingEventType;
  severity?: DrivingEventSeverity;
  event_timestamp: string; // ISO or 'YYYY-MM-DD HH:MM:SS'
  latitude?: number | null;
  longitude?: number | null;
  heading?: number | null;
  speed_mph?: number | null;
  address?: string | null;
  call_id?: number | null;
  incident_id?: number | null;
  beat_code?: string | null;
  has_video?: boolean;
  video_url?: string | null;
  clip_object_key?: string | null;
  thumb_object_key?: string | null;
  duration_sec?: number | null;
  model_version?: string | null;
  confidence?: number | null;
  /** Vendor original payload, JSON-stringified. Preserved for forensic review. */
  raw_json?: string | null;
}

export interface DrivingEventInsertResult {
  /** New row id, or existing id if dedup fired. */
  id: number;
  /** True if this was a fresh insert. False if (source, source_event_id) already existed. */
  inserted: boolean;
}

/**
 * Insert a normalized telematics event. Idempotent on
 * (source, source_event_id) when source_event_id is non-null.
 *
 * If the unit has an active call_for_service and call_id wasn't
 * supplied, we resolve it here so AAR replay can correlate.
 */
export function insertDrivingEvent(
  input: DrivingEventInput,
  dbHandle?: Database,
): DrivingEventInsertResult {
  const db = dbHandle ?? getDb();

  // Dedup check — only if vendor gave us an id
  if (input.source_event_id) {
    const existing = db
      .prepare(
        'SELECT id FROM driving_events WHERE source = ? AND source_event_id = ? LIMIT 1',
      )
      .get(input.source, input.source_event_id) as { id: number } | undefined;
    if (existing) return { id: existing.id, inserted: false };
  }

  // Auto-resolve active call for this unit (if not already provided)
  let callId = input.call_id ?? null;
  if (callId == null && input.unit_id != null) {
    const row = db
      .prepare(
        `SELECT current_call_id FROM units WHERE id = ? AND current_call_id IS NOT NULL`,
      )
      .get(input.unit_id) as { current_call_id: number | null } | undefined;
    if (row?.current_call_id) callId = row.current_call_id;
  }

  // Auto-resolve officer for this unit
  let officerId = input.officer_id ?? null;
  if (officerId == null && input.unit_id != null) {
    const row = db
      .prepare(`SELECT officer_id FROM units WHERE id = ?`)
      .get(input.unit_id) as { officer_id: number | null } | undefined;
    if (row?.officer_id) officerId = row.officer_id;
  }

  const result = db
    .prepare(
      `INSERT INTO driving_events (
        source, source_event_id, device_id, unit_id, officer_id,
        event_type, severity, event_timestamp,
        latitude, longitude, heading, speed_mph, address,
        call_id, incident_id, beat_code,
        has_video, video_url, clip_object_key, thumb_object_key,
        duration_sec, model_version, confidence, raw_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.source,
      input.source_event_id ?? null,
      input.device_id ?? null,
      input.unit_id ?? null,
      officerId,
      input.event_type,
      input.severity ?? 'info',
      input.event_timestamp,
      input.latitude ?? null,
      input.longitude ?? null,
      input.heading ?? null,
      input.speed_mph ?? null,
      input.address ?? null,
      callId,
      input.incident_id ?? null,
      input.beat_code ?? null,
      input.has_video ? 1 : 0,
      input.video_url ?? null,
      input.clip_object_key ?? null,
      input.thumb_object_key ?? null,
      input.duration_sec ?? null,
      input.model_version ?? null,
      input.confidence ?? null,
      input.raw_json ?? null,
      localNow(),
    );

  return { id: Number(result.lastInsertRowid), inserted: true };
}

/**
 * Map a ClearPathGPS status code (the strings used by their fleet
 * API) to a normalized event_type. Returns null for codes that are
 * not events of interest (e.g. routine pings).
 *
 * Source: ClearPathGPS v3.0 status code dictionary, observed in
 * production traffic 2026-04. Extend as new codes appear.
 */
export function mapClearPathStatusCode(statusCode: string | null | undefined): {
  type: DrivingEventType;
  severity: DrivingEventSeverity;
} | null {
  if (!statusCode) return null;
  const code = String(statusCode).toUpperCase().replace(/[\s-]/g, '_');

  switch (code) {
    case 'HARD_BRAKE':
      return { type: 'hard_brake', severity: 'warning' };
    case 'HARD_ACCEL':
    case 'HARSH_ACCELERATION':
      return { type: 'hard_accel', severity: 'warning' };
    case 'HARD_TURN':
    case 'HARD_CORNERING':
      return { type: 'hard_turn', severity: 'warning' };
    case 'SPEEDING':
      return { type: 'speeding', severity: 'warning' };
    case 'IMPACT':
    case 'COLLISION':
      return { type: 'impact', severity: 'critical' };
    case 'PANIC':
    case 'SOS':
      return { type: 'sos', severity: 'critical' };
    case 'TAMPER':
      return { type: 'custom', severity: 'alert' };
    case 'IGNITION_ON':
      return { type: 'ignition_on', severity: 'info' };
    case 'IGNITION_OFF':
      return { type: 'ignition_off', severity: 'info' };
    case 'VIDEO_START':
    case 'VIDEO_STOP':
    case 'VIDEO_ALARM':
    case 'CAMERA_TRIGGERED':
      // These reach driving_events with has_video=1 but the underlying
      // *trigger* is the AI event from the camera firmware. Without
      // more detail we tag as custom; specific FCW/LDW require the
      // statusCodeText.
      return { type: 'custom', severity: 'info' };
    default:
      return null;
  }
}
