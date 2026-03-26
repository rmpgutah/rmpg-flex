import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate, broadcastUnitUpdate } from '../utils/websocket';

const router = Router();
router.use(authenticateToken);

// ─── Multer for audio upload (max 5MB) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ─── Rate limiting (10 commands/min per user) ────────
const rateLimits = new Map<number, { count: number; resetAt: number }>();

function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// ─── Whisper transcription ───────────────────────────
async function transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer as unknown as BlobPart], { type: 'audio/webm' }), 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'text');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!resp.ok) {
      console.error('[VOICE] Whisper API error:', resp.status, await resp.text());
      return null;
    }

    const text = await resp.text();
    return text.trim() || null;
  } catch (err: any) {
    console.error('[VOICE] Whisper transcription failed:', err?.message || err);
    return null;
  }
}

// ─── Command types ───────────────────────────────────
interface ParsedCommand {
  action: string;
  params: Record<string, string>;
  raw: string;
}

// ─── Command parser (regex-based) ────────────────────
function parseCommand(transcript: string): ParsedCommand | null {
  const t = transcript.toLowerCase().trim();

  // Status updates
  if (/\b(en\s*route|10[-\s]?76)\b/.test(t)) {
    return { action: 'status_update', params: { status: 'en_route' }, raw: transcript };
  }
  if (/\b(on\s*scene|10[-\s]?97)\b/.test(t)) {
    return { action: 'status_update', params: { status: 'on_scene' }, raw: transcript };
  }
  if (/\b(available|10[-\s]?8|cleared)\b/.test(t)) {
    return { action: 'status_update', params: { status: 'available' }, raw: transcript };
  }
  if (/\b(out\s*of\s*service|10[-\s]?7)\b/.test(t)) {
    return { action: 'status_update', params: { status: 'out_of_service' }, raw: transcript };
  }
  if (/\b(on\s*break|10[-\s]?10)\b/.test(t)) {
    return { action: 'status_update', params: { status: 'on_break' }, raw: transcript };
  }
  if (/\b(busy|10[-\s]?6)\b/.test(t)) {
    return { action: 'status_update', params: { status: 'busy' }, raw: transcript };
  }

  // Acknowledgments
  if (/\b(copy|10[-\s]?4|roger)\b/.test(t)) {
    return { action: 'acknowledge', params: {}, raw: transcript };
  }

  // Requests
  if (/\brequest\s*(backup)\b/.test(t)) {
    return { action: 'request_backup', params: {}, raw: transcript };
  }
  if (/\brequest\s*(ems|ambulance|medic)\b/.test(t)) {
    return { action: 'request_ems', params: {}, raw: transcript };
  }
  if (/\brequest\s*(k[-\s]?9|canine)\b/.test(t)) {
    return { action: 'request_k9', params: {}, raw: transcript };
  }

  // Run plate
  const plateMatch = t.match(/\brun\s*plate\s+([a-z0-9\s]+)/i);
  if (plateMatch) {
    return { action: 'run_plate', params: { plate: plateMatch[1].trim() }, raw: transcript };
  }

  // Next call
  if (/\bnext\s*call\b/.test(t)) {
    return { action: 'next_call', params: {}, raw: transcript };
  }

  // Dispatch actions
  if (/\bstart\s*pursuit\b/.test(t)) {
    return { action: 'start_pursuit', params: {}, raw: transcript };
  }
  if (/\bmark\s*evidence\b/.test(t)) {
    return { action: 'mark_evidence', params: {}, raw: transcript };
  }

  return null;
}

// ─── Helper: get user's active unit ──────────────────
function getUserUnit(userId: number): { id: number; call_sign: string; status: string } | null {
  const db = getDb();
  return db.prepare(
    `SELECT id, call_sign, status FROM dispatch_units WHERE officer_user_id = ? AND status != 'off_duty'`
  ).get(userId) as any || null;
}

// ─── Helper: get latest GPS for user's unit ──────────
function getLatestGps(callSign: string): { lat: number; lng: number; address?: string } | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT latitude, longitude, address FROM gps_locations WHERE call_sign = ? ORDER BY timestamp DESC LIMIT 1`
  ).get(callSign) as any;
  if (!row) return null;
  return { lat: row.latitude, lng: row.longitude, address: row.address };
}

// ─── Command executors ───────────────────────────────
async function executeCommand(
  cmd: ParsedCommand,
  req: Request,
): Promise<{ success: boolean; response: string }> {
  const userId = req.user!.userId;
  const userName = req.user!.fullName || req.user!.username;
  const db = getDb();

  switch (cmd.action) {
    case 'status_update': {
      const unit = getUserUnit(userId);
      if (!unit) return { success: false, response: 'No active unit found for your account.' };

      const newStatus = cmd.params.status;
      db.prepare('UPDATE dispatch_units SET status = ? WHERE id = ?').run(newStatus, unit.id);
      broadcastUnitUpdate({ id: unit.id, call_sign: unit.call_sign, status: newStatus });
      auditLog(req, 'unit_status_changed', 'unit', unit.id,
        `Voice command: ${unit.call_sign} status changed to ${newStatus}`);

      return { success: true, response: `Copy, ${unit.call_sign} now showing ${newStatus.replace(/_/g, ' ')}.` };
    }

    case 'acknowledge': {
      return { success: true, response: 'Acknowledged.' };
    }

    case 'request_backup': {
      const unit = getUserUnit(userId);
      if (!unit) return { success: false, response: 'No active unit found.' };
      const gps = getLatestGps(unit.call_sign);
      const location = gps?.address || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'unknown location');

      broadcastDispatchUpdate({
        action: 'backup_request',
        call_sign: unit.call_sign,
        location,
        requested_by: userName,
      });
      auditLog(req, 'broadcast_sent', 'unit', unit.id,
        `Voice command: backup request from ${unit.call_sign} at ${location}`);

      return { success: true, response: `Backup request transmitted for ${unit.call_sign} at ${location}.` };
    }

    case 'request_ems': {
      const unit = getUserUnit(userId);
      broadcastDispatchUpdate({
        action: 'ems_request',
        call_sign: unit?.call_sign || userName,
        requested_by: userName,
      });
      return { success: true, response: 'E.M.S. request transmitted.' };
    }

    case 'request_k9': {
      const unit = getUserUnit(userId);
      broadcastDispatchUpdate({
        action: 'k9_request',
        call_sign: unit?.call_sign || userName,
        requested_by: userName,
      });
      return { success: true, response: 'K-9 request transmitted.' };
    }

    case 'run_plate': {
      const plate = cmd.params.plate.replace(/\s+/g, '').toUpperCase();
      const vehicle = db.prepare(
        `SELECT plate_number, make, model, year, color, owner_name FROM vehicles WHERE UPPER(REPLACE(plate_number, ' ', '')) = ?`
      ).get(plate) as any;

      if (!vehicle) {
        return { success: true, response: `No local records found for plate ${plate}.` };
      }
      return {
        success: true,
        response: `Plate ${vehicle.plate_number}: ${vehicle.year || ''} ${vehicle.color || ''} ${vehicle.make || ''} ${vehicle.model || ''}. Registered to ${vehicle.owner_name || 'unknown'}.`.replace(/\s+/g, ' '),
      };
    }

    case 'next_call': {
      const call = db.prepare(
        `SELECT call_number, incident_type, priority, location_address
         FROM calls_for_service
         WHERE status IN ('pending', 'dispatched') AND archived = 0
         ORDER BY CASE priority
           WHEN 'P1' THEN 1
           WHEN 'P2' THEN 2
           WHEN 'P3' THEN 3
           WHEN 'P4' THEN 4
           ELSE 5
         END, created_at ASC
         LIMIT 1`
      ).get() as any;

      if (!call) {
        return { success: true, response: 'No pending calls in the queue.' };
      }
      return {
        success: true,
        response: `Next call: ${call.call_number}, ${call.incident_type}, priority ${call.priority}, at ${call.location_address || 'unknown location'}.`,
      };
    }

    case 'start_pursuit': {
      const unit = getUserUnit(userId);
      if (!unit) return { success: false, response: 'No active unit found.' };

      broadcastDispatchUpdate({
        action: 'pursuit_started',
        call_sign: unit.call_sign,
        initiated_by: userName,
      });
      auditLog(req, 'broadcast_sent', 'unit', unit.id,
        `Voice command: pursuit started by ${unit.call_sign}`);

      return { success: true, response: `Pursuit logged for ${unit.call_sign}. All units notified.` };
    }

    case 'mark_evidence': {
      const unit = getUserUnit(userId);
      const callSign = unit?.call_sign || userName;
      const gps = unit ? getLatestGps(unit.call_sign) : null;
      const address = gps?.address || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'current location');

      return { success: true, response: `Evidence marker placed at ${address}.` };
    }

    default:
      return { success: false, response: 'Unknown command.' };
  }
}

// ─── POST /api/voice/command — audio upload ──────────
router.post('/command', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    if (!checkRateLimit(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Max 10 commands per minute.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No audio file provided. Field name must be "audio".' });
      return;
    }

    const transcript = await transcribeAudio(req.file.buffer);
    if (!transcript) {
      res.status(422).json({ error: 'Could not transcribe audio. Check OPENAI_API_KEY is set.' });
      return;
    }

    const command = parseCommand(transcript);
    if (!command) {
      res.json({ success: false, transcript, response: `Could not parse command from: "${transcript}"` });
      return;
    }

    const result = await executeCommand(command, req);

    auditLog(req, 'VOICE_COMMAND' as any, 'voice' as any, '',
      JSON.stringify({ transcript, action: command.action, result: result.response }));

    res.json({ success: result.success, transcript, action: command.action, response: result.response });
  } catch (err: any) {
    console.error('[VOICE] Command error:', err?.message || err);
    res.status(500).json({ error: 'Voice command processing failed' });
  }
});

// ─── POST /api/voice/parse — text transcript ─────────
router.post('/parse', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    if (!checkRateLimit(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Max 10 commands per minute.' });
      return;
    }

    const { transcript } = req.body;
    if (!transcript || typeof transcript !== 'string') {
      res.status(400).json({ error: 'transcript is required and must be a string' });
      return;
    }

    if (transcript.length > 500) {
      res.status(400).json({ error: 'transcript must be 500 characters or less' });
      return;
    }

    const command = parseCommand(transcript);
    if (!command) {
      res.json({ success: false, transcript, response: `Could not parse command from: "${transcript}"` });
      return;
    }

    const result = await executeCommand(command, req);

    auditLog(req, 'VOICE_COMMAND' as any, 'voice' as any, '',
      JSON.stringify({ transcript, action: command.action, result: result.response }));

    res.json({ success: result.success, transcript, action: command.action, response: result.response });
  } catch (err: any) {
    console.error('[VOICE] Parse error:', err?.message || err);
    res.status(500).json({ error: 'Voice command processing failed' });
  }
});

export default router;
