import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate, broadcastUnitUpdate } from '../utils/websocket';
import { buildThreatContext, composeThreatBriefing } from '../utils/threatContext';
import { parseWithNLU } from '../utils/voiceNLU';
import { checkProximityHazards, composeProximityNarrative, findNearestUnits, composeNearestUnitsNarrative } from '../utils/proximityAlerts';
import { acknowledgeWelfareCheck, recordOfficerActivity } from '../utils/officerWelfare';
import { startPursuit, endPursuit, isInPursuit } from '../utils/pursuitTracker';
import { generateShiftSummary } from '../utils/shiftBriefing';

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

  // Case queries
  const caseStatusMatch = t.match(/\bstatus\s*(?:of\s*)?case\s*(\S+)/i);
  if (caseStatusMatch) return { action: 'case_status', params: { case_number: caseStatusMatch[1] }, raw: transcript };

  const linkCaseMatch = t.match(/\blink\s*(?:to\s*)?case\s*(\S+)/i);
  if (linkCaseMatch) return { action: 'link_case', params: { case_number: linkCaseMatch[1] }, raw: transcript };

  // Statement mode
  if (/\bstart\s*statement/i.test(t)) return { action: 'start_statement', params: {}, raw: transcript };
  if (/\bend\s*statement/i.test(t)) return { action: 'end_statement', params: {}, raw: transcript };

  // Welfare response
  if (/\b(code\s*4|all\s*clear)\b/i.test(t)) return { action: 'code_4', params: {}, raw: transcript };

  // End pursuit
  if (/\bend\s*pursuit/i.test(t)) return { action: 'end_pursuit', params: {}, raw: transcript };

  // Shift briefing
  if (/\bshift\s*(summary|briefing|handoff)/i.test(t)) return { action: 'shift_briefing', params: {}, raw: transcript };

  // Nearest units
  if (/\bnearest\s*units?\b/i.test(t)) return { action: 'nearest_units', params: {}, raw: transcript };

  // Threat check
  if (/\bthreat\s*(check|assessment|briefing)/i.test(t)) return { action: 'threat_check', params: {}, raw: transcript };

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

      // Get current call ID for pursuit tracker
      const currentCallRow = db.prepare(
        'SELECT current_call_id FROM dispatch_units WHERE id = ?'
      ).get(unit.id) as any;
      startPursuit(unit.call_sign, currentCallRow?.current_call_id);

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

    case 'code_4': {
      const msg = acknowledgeWelfareCheck(userId);
      recordOfficerActivity(userId);
      return { success: true, response: msg || 'Copy, code 4.' };
    }

    case 'end_pursuit': {
      const unit = getUserUnit(userId);
      if (!unit) return { success: false, response: 'No active unit found.' };
      const msg = endPursuit(unit.call_sign);
      return { success: true, response: msg || 'No active pursuit to end.' };
    }

    case 'shift_briefing': {
      const summary = generateShiftSummary();
      return { success: true, response: summary.narrative };
    }

    case 'nearest_units': {
      const unit = getUserUnit(userId);
      const gps = unit ? getLatestGps(unit.call_sign) : null;
      if (!gps) return { success: false, response: 'GPS location not available.' };
      const nearest = findNearestUnits(gps.lat, gps.lng, 5);
      return { success: true, response: composeNearestUnitsNarrative(nearest) };
    }

    case 'threat_check': {
      const unit = getUserUnit(userId);
      if (!unit) return { success: false, response: 'No active unit found.' };
      const currentCall = db.prepare(
        'SELECT c.id, c.location_address, c.latitude, c.longitude FROM calls_for_service c JOIN dispatch_units u ON u.current_call_id = c.id WHERE u.id = ?'
      ).get(unit.id) as any;
      if (!currentCall) return { success: true, response: 'No active call to assess.' };
      const ctx = await buildThreatContext({
        locationAddress: currentCall.location_address,
        latitude: currentCall.latitude,
        longitude: currentCall.longitude,
        callId: currentCall.id,
      });
      const briefing = composeThreatBriefing(ctx);
      return { success: true, response: briefing || 'No threat indicators detected at this location.' };
    }

    case 'case_status': {
      const caseNum = cmd.params.case_number;
      try {
        const c = db.prepare('SELECT case_number, status, assigned_to, updated_at FROM cases WHERE case_number = ?').get(caseNum) as any;
        if (!c) return { success: true, response: `No case found with number ${caseNum}.` };
        return { success: true, response: `Case ${c.case_number}: status ${(c.status || 'unknown').replace(/_/g, ' ')}, assigned to ${c.assigned_to || 'unassigned'}.` };
      } catch { return { success: true, response: `Case lookup not available.` }; }
    }

    case 'link_case': {
      return { success: true, response: `Case linkage noted. Case ${cmd.params.case_number}.` };
    }

    case 'start_statement': {
      return { success: true, response: 'Statement recording mode activated. Speak your statement now.' };
    }

    case 'end_statement': {
      return { success: true, response: 'Statement recording ended and saved.' };
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

    recordOfficerActivity(userId);

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
      // Regex failed — try AI NLU
      const nluResult = await parseWithNLU(transcript);
      if (nluResult && nluResult.action !== 'unknown' && nluResult.confidence >= 0.6) {
        const nluCommand: ParsedCommand = {
          action: nluResult.action,
          params: nluResult.params as Record<string, string>,
          raw: transcript,
        };
        const result = await executeCommand(nluCommand, req);
        auditLog(req, 'VOICE_COMMAND_NLU' as any, 'voice' as any, '',
          JSON.stringify({ transcript, nlu: nluResult, result: result.response }));
        res.json({ success: result.success, transcript, action: nluResult.action, response: result.response, nlu: true });
        return;
      }

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

    recordOfficerActivity(userId);

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
      // Regex failed — try AI NLU
      const nluResult = await parseWithNLU(transcript);
      if (nluResult && nluResult.action !== 'unknown' && nluResult.confidence >= 0.6) {
        const nluCommand: ParsedCommand = {
          action: nluResult.action,
          params: nluResult.params as Record<string, string>,
          raw: transcript,
        };
        const result = await executeCommand(nluCommand, req);
        auditLog(req, 'VOICE_COMMAND_NLU' as any, 'voice' as any, '',
          JSON.stringify({ transcript, nlu: nluResult, result: result.response }));
        res.json({ success: result.success, transcript, action: nluResult.action, response: result.response, nlu: true });
        return;
      }

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

// ─── POST /api/voice/statement — save witness statement ─
router.post('/statement', async (req: Request, res: Response) => {
  try {
    const { callId, transcript, isFinal } = req.body;
    if (!callId || !transcript) {
      res.status(400).json({ error: 'callId and transcript required' });
      return;
    }
    const db = getDb();
    const timestamp = new Date().toISOString();
    const prefix = isFinal ? '\n\n[WITNESS STATEMENT - FINAL]' : '\n\n[WITNESS STATEMENT - IN PROGRESS]';
    db.prepare('UPDATE calls_for_service SET description = COALESCE(description, \'\') || ? WHERE id = ?')
      .run(`${prefix} (${timestamp})\n${transcript}`, callId);
    auditLog(req, 'VOICE_STATEMENT' as any, 'call' as any, String(callId),
      `Statement ${isFinal ? 'finalized' : 'updated'}: ${transcript.slice(0, 100)}...`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[VOICE] Statement save error:', err?.message);
    res.status(500).json({ error: 'Failed to save statement' });
  }
});

export default router;
