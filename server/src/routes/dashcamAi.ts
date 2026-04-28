// ============================================================
// /api/dashcam-ai — webhook ingest from Flex edge runners
// ============================================================
// Two endpoints:
//   POST /event       — single event with optional clip
//   POST /heartbeat   — fleet-health snapshot
//
// Both use HMAC-SHA256 signed-body authentication, NOT JWT.
// Mount this router BEFORE the global express.json() so we can
// take raw body for HMAC verification — once express.json
// consumes the stream, the bytes are gone and HMAC is impossible.
//
// Env vars:
//   DASHCAM_FORWARD_SECRET    required — shared secret with edge devices
//   DASHCAM_AI_STORAGE_DIR    optional — defaults to <server>/data/dashcam-ai-evidence

import express, { Router, Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { handleEventIngest } from '../utils/dashcamAiIngest';
import { handleHeartbeat } from '../utils/dashcamAiHeartbeat';
import { createFilesystemStorage, type StorageAdapter } from '../utils/storageAdapter';
import { logger } from '../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default storage location: server/data/dashcam-ai-evidence/, adjacent
// to the SQLite db. Override in production via DASHCAM_AI_STORAGE_DIR.
const DEFAULT_STORAGE_DIR = path.resolve(__dirname, '../../data/dashcam-ai-evidence');

let cachedStorage: StorageAdapter | null = null;
function getStorage(): StorageAdapter {
  if (cachedStorage) return cachedStorage;
  const dir = process.env.DASHCAM_AI_STORAGE_DIR || DEFAULT_STORAGE_DIR;
  cachedStorage = createFilesystemStorage(dir);
  return cachedStorage;
}

function getSecret(): string | null {
  return process.env.DASHCAM_FORWARD_SECRET || null;
}

export const dashcamAiRouter = Router();

// Raw-body parser scoped to THIS router only. limit raised to 100mb to
// accommodate base64-encoded clips at typical sizes (60s @ 8 Mbps ≈ 60 MB
// raw → 80 MB base64).
const rawBodyParser = express.raw({ type: '*/*', limit: '100mb' });

dashcamAiRouter.post('/event', rawBodyParser, async (req: Request, res: Response) => {
  const secret = getSecret();
  if (!secret) {
    logger.error('dashcam-ai: DASHCAM_FORWARD_SECRET is not configured');
    res.status(503).json({ error: 'service_not_configured' });
    return;
  }

  // express.raw stores the body on req.body as a Buffer. Defensive coerce.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');

  try {
    const result = await handleEventIngest({
      rawBody,
      headers: {
        'x-dashcam-signature': req.header('x-dashcam-signature') ?? undefined,
        'x-dashcam-timestamp': req.header('x-dashcam-timestamp') ?? undefined,
      },
      secret,
      storage: getStorage(),
      db: getDb(),
    });
    res.status(result.status).json(result.body);
  } catch (err: any) {
    logger.error({ err }, 'dashcam-ai: handler crashed');
    res.status(500).json({ error: 'internal_error' });
  }
});

dashcamAiRouter.post('/heartbeat', rawBodyParser, async (req: Request, res: Response) => {
  const secret = getSecret();
  if (!secret) {
    res.status(503).json({ error: 'service_not_configured' });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');

  try {
    const result = await handleHeartbeat({
      rawBody,
      headers: {
        'x-dashcam-signature': req.header('x-dashcam-signature') ?? undefined,
        'x-dashcam-timestamp': req.header('x-dashcam-timestamp') ?? undefined,
      },
      secret,
      db: getDb(),
    });
    res.status(result.status).json(result.body);
  } catch (err: any) {
    logger.error({ err }, 'dashcam-ai-heartbeat: handler crashed');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default dashcamAiRouter;
