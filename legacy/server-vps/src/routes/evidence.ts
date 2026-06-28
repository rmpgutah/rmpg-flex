// ============================================================
// /api/evidence — Phase 4 hardening surfaces
// ============================================================
// Operator-facing endpoints for chain-of-custody operations:
//   GET  /api/evidence/audit                    — chain integrity dashboard
//   GET  /api/evidence/keypair-info             — public key + signing status
//   GET  /api/evidence/:event_id/manifest.json  — prosecutor manifest
//   GET  /api/evidence/:event_id/verify.html    — self-contained verifier
//   GET  /api/evidence/:event_id/clip           — clip download (auth-gated)
//
// All routes require JWT auth. The clip route also accepts
// ?token=<jwt> in the query string so a downloaded verify.html
// can <a href> the clip without breaking the browser's request
// (HTML's anchor element can't carry an Authorization header).

import { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { verifyEvidenceChain } from '../utils/evidenceHasher';
import { loadKeypairFromEnv } from '../utils/evidenceSigner';
import { createFilesystemStorage } from '../utils/storageAdapter';
import { buildPackageManifest, buildVerifyHtml, type PackageManifestInput } from '../utils/prosecutorExport';
import { logger } from '../utils/logger';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const DEFAULT_STORAGE_DIR = path.resolve(__dirname_local, '../../data/dashcam-ai-evidence');
const STORAGE_DIR = process.env.DASHCAM_AI_STORAGE_DIR || DEFAULT_STORAGE_DIR;
const storage = createFilesystemStorage(STORAGE_DIR);

const router = Router();

// HTML5 anchor / video tags can't set custom headers, so promote
// ?token= → Authorization for the clip download path. Mirrors the
// fleet/dashcamVideos/personnel pattern.
router.use((req, _res, next) => {
  if (!req.headers['authorization'] && typeof req.query.token === 'string' && req.query.token.length < 2048) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(authenticateToken);

// ============================================================
// GET /api/evidence/keypair-info
// Reports whether a signing keypair is configured and which
// public key new evidence rows are signed with. Admin/manager
// can pull the full base64 public key for distribution to a
// DA's office; everyone else sees presence/absence only.
// ============================================================
router.get(
  '/keypair-info',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    const kp = loadKeypairFromEnv();
    const role = (req as any).user?.role;
    const isPrivileged = role === 'admin' || role === 'manager';

    res.json({
      configured: !!kp,
      algorithm: 'Ed25519',
      public_key: isPrivileged ? (kp?.publicKey ?? null) : null,
      message: kp
        ? 'Evidence signing is active. New evidence_hashes entries are signed.'
        : 'Evidence signing is NOT configured. Set EVIDENCE_SIGNING_PRIVATE_KEY and EVIDENCE_SIGNING_PUBLIC_KEY in server/.env. Run scripts/generate-evidence-keypair.mjs to mint a fresh pair.',
    });
  },
);

// ============================================================
// GET /api/evidence/audit
// Per-artifact-type chain audit. Returns chain link + signature
// validity counts. Surfaced in the supervisor / IA dashboard.
// ============================================================
router.get(
  '/audit',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const requestedType = typeof req.query.artifact_type === 'string'
        ? req.query.artifact_type
        : null;

      const types = requestedType
        ? [requestedType]
        : (db.prepare(
            `SELECT DISTINCT artifact_type FROM evidence_hashes ORDER BY artifact_type`,
          ).all() as Array<{ artifact_type: string }>).map(r => r.artifact_type);

      const kp = loadKeypairFromEnv();
      const audits = types.map(t => ({
        artifact_type: t,
        ...verifyEvidenceChain(t, db, kp ? { verifySignatures: true, publicKey: kp.publicKey } : undefined),
      }));

      // Roll-up summary
      const total = audits.reduce((s, a) => s + a.checked, 0);
      const allOk = audits.every(a => a.ok);
      const anyTampered = audits.some(a => a.signature_failure);
      const anyUnsigned = audits.some(a => (a.unsigned_count ?? 0) > 0);

      res.json({
        signing_configured: !!kp,
        all_chains_ok: allOk,
        any_signature_failure: anyTampered,
        any_unsigned: anyUnsigned,
        total_entries: total,
        audits,
      });
    } catch (err: any) {
      logger.error({ err }, 'evidence audit error');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ============================================================
// Helper: load full event + chain bundle for an event id.
// Used by manifest, verify.html, and clip endpoints.
// ============================================================
function loadEventBundle(eventId: number, db = getDb()) {
  const event = db.prepare(`
    SELECT
      e.id, e.source, e.source_event_id, e.device_id, e.unit_id, e.officer_id,
      e.event_type, e.severity, e.event_timestamp,
      e.latitude, e.longitude, e.heading, e.speed_mph, e.address,
      e.call_id, e.incident_id, e.beat_code,
      e.has_video, e.video_url, e.clip_object_key, e.thumb_object_key,
      e.duration_sec, e.model_version, e.confidence,
      u.call_sign, usr.full_name as officer_name, usr.badge_number,
      c.call_number
    FROM driving_events e
    LEFT JOIN units u ON e.unit_id = u.id
    LEFT JOIN users usr ON e.officer_id = usr.id
    LEFT JOIN calls_for_service c ON e.call_id = c.id
    WHERE e.id = ?
  `).get(eventId) as any;
  if (!event) return null;

  const evidence = db.prepare(`
    SELECT id, artifact_type, artifact_id, sha256, size_bytes,
           storage_uri, captured_at, hashed_at, signer, signature, prev_hash_id
    FROM evidence_hashes
    WHERE artifact_id = ? AND artifact_type = 'driving_event_clip'
    ORDER BY id ASC
  `).all(eventId) as any[];

  return { event, evidence };
}

function buildManifestInputFromBundle(
  eventId: number,
  caseRef: string | undefined,
  user: any,
): PackageManifestInput | null {
  const bundle = loadEventBundle(eventId);
  if (!bundle) return null;
  const { event, evidence } = bundle;
  const primary = evidence[evidence.length - 1]; // most recent for this artifact_id
  if (!primary) return null;

  const kp = loadKeypairFromEnv();
  return {
    exported_at: new Date().toISOString(),
    exported_by: {
      id: user?.userId ?? 0,
      full_name: user?.fullName ?? user?.username ?? 'unknown',
      badge: user?.badgeNumber ?? '',
    },
    case_reference: caseRef,
    event: {
      id: event.id,
      source: event.source,
      event_type: event.event_type,
      event_timestamp: event.event_timestamp,
      unit_id: event.unit_id,
      call_sign: event.call_sign,
      officer_name: event.officer_name,
      badge_number: event.badge_number,
      latitude: event.latitude,
      longitude: event.longitude,
      speed_mph: event.speed_mph,
      address: event.address,
      call_number: event.call_number,
      duration_sec: event.duration_sec,
      model_version: event.model_version,
      confidence: event.confidence,
    },
    clip: {
      object_key: primary.storage_uri ?? event.clip_object_key ?? '',
      sha256: primary.sha256,
      size_bytes: primary.size_bytes ?? 0,
      captured_at: primary.captured_at,
    },
    evidence_chain: evidence.map((e: any) => ({
      id: e.id,
      sha256: e.sha256,
      captured_at: e.captured_at,
      hashed_at: e.hashed_at,
      prev_hash_id: e.prev_hash_id,
      signer: e.signer,
      signature: e.signature,
    })),
    signing_public_key: kp?.publicKey ?? '',
  };
}

// ============================================================
// GET /api/evidence/:event_id/manifest.json
// ============================================================
router.get(
  '/:event_id/manifest.json',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    const eventId = parseInt(String(req.params.event_id), 10);
    if (isNaN(eventId)) { res.status(400).json({ error: 'Invalid event ID' }); return; }

    const caseRef = typeof req.query.case_ref === 'string' ? req.query.case_ref : undefined;
    const input = buildManifestInputFromBundle(eventId, caseRef, (req as any).user);
    if (!input) { res.status(404).json({ error: 'Event or evidence missing' }); return; }

    const manifest = buildPackageManifest(input);
    res.set('Content-Disposition', `attachment; filename="event-${eventId}-manifest.json"`);
    res.json(manifest);
  },
);

// ============================================================
// GET /api/evidence/:event_id/verify.html
// ============================================================
router.get(
  '/:event_id/verify.html',
  requireRole('admin', 'manager', 'supervisor'),
  (req: Request, res: Response) => {
    const eventId = parseInt(String(req.params.event_id), 10);
    if (isNaN(eventId)) { res.status(400).send('Invalid event ID'); return; }

    const caseRef = typeof req.query.case_ref === 'string' ? req.query.case_ref : undefined;
    const input = buildManifestInputFromBundle(eventId, caseRef, (req as any).user);
    if (!input) { res.status(404).send('Event or evidence missing'); return; }

    const html = buildVerifyHtml(input);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="event-${eventId}-verify.html"`);
    res.send(html);
  },
);

// ============================================================
// GET /api/evidence/:event_id/clip
// Streams the clip bytes (no Range support — this is for
// download-and-attach-to-bundle, not for in-browser scrubbing).
// AAR's existing clip endpoint at /api/driving-events/:id/clip
// is the Range-aware path.
// ============================================================
router.get(
  '/:event_id/clip',
  requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'),
  async (req: Request, res: Response) => {
    try {
      const eventId = parseInt(String(req.params.event_id), 10);
      if (isNaN(eventId)) { res.status(400).json({ error: 'Invalid event ID' }); return; }

      const db = getDb();
      const ev = db.prepare(
        `SELECT id, clip_object_key, has_video FROM driving_events WHERE id = ?`,
      ).get(eventId) as { id: number; clip_object_key: string | null; has_video: number } | undefined;
      if (!ev) { res.status(404).json({ error: 'Event not found' }); return; }
      if (!ev.has_video || !ev.clip_object_key) {
        res.status(404).json({ error: 'No clip for this event' });
        return;
      }

      const body = await storage.get(ev.clip_object_key);
      const ext = path.extname(ev.clip_object_key).toLowerCase();
      const mime = ext === '.mp4' ? 'video/mp4'
        : ext === '.webm' ? 'video/webm'
        : ext === '.mov' ? 'video/quicktime'
        : 'application/octet-stream';

      res.set({
        'Content-Type': mime,
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="event-${eventId}-clip${ext || '.bin'}"`,
      });
      res.status(200).send(body);
    } catch (err: any) {
      logger.error({ err }, 'evidence clip download error');
      if (!res.headersSent) {
        res.status(404).json({ error: 'Clip storage missing or inaccessible' });
      }
    }
  },
);

export default router;
