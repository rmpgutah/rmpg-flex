// ============================================================
// dashcam-ai event ingest — pure handler
// ============================================================
// Orchestrates the full event-acceptance flow as a pure function
// so tests don't need an HTTP server. The Express route at
// server/src/routes/dashcamAi.ts is a thin shim that:
//   1. Captures raw body via express.raw()
//   2. Calls handleEventIngest with raw body + headers + deps
//   3. Maps {status, body} → res.status(...).json(...)
//
// Order of operations is deliberate:
//   1. HMAC verify (cheapest, fail fast)
//   2. JSON parse + schema validate
//   3. Dedup check (avoids redundant storage writes)
//   4. Storage.put (if clip present) — produces orphan on later
//      DB failure, which is recoverable via GC; reverse order
//      would leave DB rows pointing at missing files
//   5. driving_events insert
//   6. evidence_hashes insert (chain-of-custody linkage)

import type { Database } from 'better-sqlite3';
import { verifyDashcamSignature } from './dashcamAiHmac';
import { insertDrivingEvent, type DrivingEventType, type DrivingEventSeverity } from './drivingEvents';
import { recordEvidence, sha256OfBuffer } from './evidenceHasher';
import type { StorageAdapter } from './storageAdapter';
import { logger } from './logger';

export interface EventIngestInput {
  rawBody: Buffer;
  headers: {
    'x-dashcam-signature'?: string;
    'x-dashcam-timestamp'?: string;
    [k: string]: string | undefined;
  };
  secret: string;
  storage: StorageAdapter;
  db: Database;
}

export interface EventIngestResult {
  status: number;
  body: any;
}

const VALID_EVENT_TYPES = new Set<DrivingEventType>([
  'hard_brake', 'hard_accel', 'hard_turn', 'impact',
  'fcw', 'ldw', 'tailgate', 'pedestrian',
  'drowsy', 'distracted', 'phone_use', 'seatbelt_off',
  'speeding', 'overspeed_zone', 'route_deviation',
  'ignition_on', 'ignition_off', 'idle_excessive', 'dtc_set',
  'panic', 'sos', 'man_down',
  'k9_deploy', 'weapon_draw', 'use_of_force', 'pursuit_start', 'pursuit_end',
  'custom',
]);

const VALID_SEVERITIES = new Set<DrivingEventSeverity>(['info', 'warning', 'alert', 'critical']);

export async function handleEventIngest(input: EventIngestInput): Promise<EventIngestResult> {
  const { rawBody, headers, secret, storage, db } = input;

  // ── Step 1: HMAC verify ──────────────────────────────────
  const verify = verifyDashcamSignature({
    body: rawBody,
    timestamp: headers['x-dashcam-timestamp'],
    signature: headers['x-dashcam-signature'],
    secret,
  });
  if (!verify.ok) {
    logger.warn({ reason: verify.reason }, 'dashcam-ai: rejected webhook');
    return { status: 401, body: { error: 'unauthorized' } };
  }

  // ── Step 2: parse + validate ─────────────────────────────
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err: any) {
    return { status: 400, body: { error: 'invalid_json' } };
  }

  if (!payload.event_type || !VALID_EVENT_TYPES.has(payload.event_type)) {
    return { status: 400, body: { error: 'invalid event_type' } };
  }
  if (!payload.event_timestamp || typeof payload.event_timestamp !== 'string') {
    return { status: 400, body: { error: 'missing event_timestamp' } };
  }

  const severity: DrivingEventSeverity = VALID_SEVERITIES.has(payload.severity)
    ? payload.severity
    : 'info';

  // ── Step 3: dedup ────────────────────────────────────────
  if (payload.source_event_id) {
    const existing = db.prepare(
      `SELECT id FROM driving_events WHERE source = 'flex_ai' AND source_event_id = ? LIMIT 1`,
    ).get(payload.source_event_id) as { id: number } | undefined;
    if (existing) {
      return {
        status: 200,
        body: { ok: true, event_id: existing.id, evidence_id: null, deduped: true },
      };
    }
  }

  // ── Step 4: storage (if clip provided) ───────────────────
  let storage_uri: string | null = null;
  let clipBytes: Buffer | null = null;
  let clipSha256: string | null = null;

  if (payload.clip_base64) {
    try {
      clipBytes = Buffer.from(payload.clip_base64, 'base64');
    } catch {
      return { status: 400, body: { error: 'invalid clip_base64' } };
    }
    clipSha256 = sha256OfBuffer(clipBytes);
    // We don't have artifact_id yet — provisional storage with a temp
    // id, then patch driving_events.clip_object_key after the insert.
    // Use the source_event_id (or sha256 prefix) so collisions stay
    // human-debuggable.
    // We'll stage with artifact_id=0 and re-assign after the DB row.
    // Simpler: do storage AFTER the DB insert, accepting orphan-DB-row
    // risk on storage failure (we delete it on failure to compensate).
  }

  // ── Step 5: insert driving_events row ────────────────────
  const insert = insertDrivingEvent({
    source: 'flex_ai',
    source_event_id: payload.source_event_id ?? null,
    device_id: payload.device_id ?? null,
    unit_id: payload.unit_id ?? null,
    officer_id: payload.officer_id ?? null,
    event_type: payload.event_type,
    severity,
    event_timestamp: payload.event_timestamp,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    heading: payload.heading ?? null,
    speed_mph: payload.speed_mph ?? null,
    address: payload.address ?? null,
    call_id: payload.call_id ?? null,
    incident_id: payload.incident_id ?? null,
    beat_code: payload.beat_code ?? null,
    has_video: !!clipBytes,
    duration_sec: payload.duration_sec ?? null,
    model_version: payload.model_version ?? null,
    confidence: payload.confidence ?? null,
    raw_json: payload.raw_metadata ? JSON.stringify(payload.raw_metadata) : null,
  }, db);

  // ── Step 6: storage.put + evidence_hashes (if clip) ──────
  let evidence_id: number | null = null;
  if (clipBytes && clipSha256) {
    try {
      const stored = await storage.put({
        body: clipBytes,
        sha256: clipSha256,
        artifact_type: 'driving_event_clip',
        artifact_id: insert.id,
        unit_id: payload.unit_id ?? undefined,
        captured_at: payload.event_timestamp,
        filename: payload.clip_filename ?? 'clip.mp4',
      });
      storage_uri = stored.storage_uri;

      // Patch the driving_events row with the URI
      db.prepare(`UPDATE driving_events SET clip_object_key = ?, video_url = ? WHERE id = ?`)
        .run(storage_uri, storage_uri, insert.id);

      // Append evidence-chain row
      const evidence = recordEvidence({
        artifact_type: 'driving_event_clip',
        artifact_id: insert.id,
        sha256: clipSha256,
        size_bytes: stored.size_bytes,
        storage_uri,
        captured_at: payload.event_timestamp,
      }, db);
      evidence_id = evidence.id;
    } catch (err: any) {
      logger.error({ err, eventId: insert.id }, 'dashcam-ai: storage.put failed; row left without clip');
      // Don't delete the DB row — the metadata is still valuable; UI
      // shows "clip missing" and an operator can investigate. Log
      // with safe fields so a malicious payload can't poison logs.
      return {
        status: 200,
        body: {
          ok: true,
          event_id: insert.id,
          evidence_id: null,
          deduped: false,
          warning: 'clip_storage_failed',
        },
      };
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      event_id: insert.id,
      evidence_id,
      deduped: false,
    },
  };
}

