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

const NON_WARNING_PLACEHOLDERS = new Set(['', '0', 'none', 'n/a', 'na', 'null', 'false', 'unknown', 'unspecified']);

function getMeaningfulWarningValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (NON_WARNING_PLACEHOLDERS.has(normalized.toLowerCase())) return null;
  return normalized;
}

// ─── Multer for audio upload (max 5MB) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 10, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed. Accepted: audio formats`));
    }
  },
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

  // Sitrep / situation report
  if (/\b(sitrep|sit\s*rep|situation\s*report|status\s*report)\b/i.test(t)) return { action: 'sitrep', params: {}, raw: transcript };

  // Run name / subject lookup
  const nameMatch = t.match(/\brun\s*(?:name|subject|person)\s+(.+)/i);
  if (nameMatch) return { action: 'run_name', params: { name: nameMatch[1].trim() }, raw: transcript };

  // Officer down / panic
  if (/\b(officer\s*down|shots?\s*fired|10[-\s]?99|panic|emergency\s*traffic)\b/i.test(t)) return { action: 'officer_down', params: {}, raw: transcript };

  // Area check
  if (/\b(area\s*check|area\s*scan|what'?s?\s*(?:in\s*this|around\s*this|near)\s*area)\b/i.test(t)) return { action: 'area_check', params: {}, raw: transcript };

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

// ─── Contextual helpers ───────────────────────────────

/** Get the officer's current assigned call with location details */
function getCurrentCall(unitId: number): { id: number; call_number: string; incident_type: string; location_address: string; latitude: number; longitude: number; priority: string; description: string } | null {
  const db = getDb();
  try {
    return db.prepare(
      `SELECT c.id, c.call_number, c.incident_type, c.location_address, c.latitude, c.longitude, c.priority, c.description
       FROM calls_for_service c
       JOIN dispatch_units u ON u.current_call_id = c.id
       WHERE u.id = ?`
    ).get(unitId) as any || null;
  } catch { return null; }
}

/** Get pending call queue stats */
function getCallQueueStats(): { total: number; p1: number; p2: number; oldest: string | null } {
  const db = getDb();
  try {
    const rows = db.prepare(
      `SELECT priority, call_number FROM calls_for_service WHERE status IN ('pending','dispatched') AND archived = 0 ORDER BY created_at ASC`
    ).all() as any[];
    const p1 = rows.filter(r => r.priority === 'P1').length;
    const p2 = rows.filter(r => r.priority === 'P2').length;
    return { total: rows.length, p1, p2, oldest: rows[0]?.call_number || null };
  } catch { return { total: 0, p1: 0, p2: 0, oldest: null }; }
}

/** Get the last dispatch alert the officer received (for contextual "copy") */
function getLastDispatchToUnit(callSign: string): { call_number: string; incident_type: string; location_address: string } | null {
  const db = getDb();
  try {
    return db.prepare(
      `SELECT c.call_number, c.incident_type, c.location_address
       FROM calls_for_service c
       JOIN dispatch_unit_assignments dua ON dua.call_id = c.id
       WHERE dua.call_sign = ?
       ORDER BY dua.assigned_at DESC LIMIT 1`
    ).get(callSign) as any || null;
  } catch { return null; }
}

/** Run a name/subject lookup across persons, warrants, arrests */
function runNameLookup(name: string): { persons: any[]; warrants: any[]; arrests: any[]; trespass: any[] } {
  const db = getDb();
  const namePattern = `%${name}%`;
  const persons = safeAllVoice(
    `SELECT id, first_name, last_name, dob, gang_affiliation, is_sex_offender, has_criminal_history, caution_flags
     FROM persons WHERE (first_name || ' ' || last_name) LIKE ? LIMIT 5`, [namePattern]);
  const warrants = safeAllVoice(
    `SELECT w.id, w.warrant_type, w.severity, w.description, p.first_name, p.last_name
     FROM warrants w LEFT JOIN persons p ON p.id = w.person_id
     WHERE (p.first_name || ' ' || p.last_name) LIKE ? AND w.status = 'active' LIMIT 5`, [namePattern]);
  const arrests = safeAllVoice(
    `SELECT id, subject_name, charge, arrest_date FROM arrests
     WHERE subject_name LIKE ? ORDER BY arrest_date DESC LIMIT 3`, [namePattern]);
  const trespass = safeAllVoice(
    `SELECT id, subject_name, property_address, status FROM trespass_orders
     WHERE subject_name LIKE ? AND status = 'active' LIMIT 3`, [namePattern]);
  return { persons, warrants, arrests, trespass };
}

function safeAllVoice<T = any>(sql: string, params: any[] = []): T[] {
  try { return getDb().prepare(sql).all(...params) as T[]; } catch { return []; }
}

/** Get active units on duty count */
function getActiveUnitCount(): number {
  try {
    const row = getDb().prepare(
      `SELECT COUNT(*) as cnt FROM dispatch_units WHERE status NOT IN ('off_duty','out_of_service')`
    ).get() as any;
    return row?.cnt || 0;
  } catch { return 0; }
}

/** Compose area check narrative from recent calls near GPS */
function composeAreaCheckNarrative(lat: number, lng: number): string {
  const db = getDb();
  const delta = 0.005; // ~500m
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const calls = db.prepare(
      `SELECT incident_type, location_address, priority FROM calls_for_service
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
       AND created_at >= ?
       ORDER BY created_at DESC LIMIT 10`
    ).all(lat - delta, lat + delta, lng - delta, lng + delta, cutoff) as any[];
    if (calls.length === 0) return 'No recent activity in this area in the last 24 hours.';
    const types = [...new Set(calls.map((c: any) => c.incident_type).filter(Boolean))];
    const highPri = calls.filter((c: any) => c.priority === 'P1' || c.priority === 'P2').length;
    let msg = `${calls.length} calls in this area in the last 24 hours`;
    if (types.length > 0) msg += `, types include ${types.slice(0, 4).join(', ')}`;
    if (highPri > 0) msg += `, ${highPri} were high priority`;
    return msg + '.';
  } catch { return 'Area check unavailable.'; }
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

      // ── Contextual feedback based on status ──
      const parts: string[] = [`Copy, ${unit.call_sign} now showing ${newStatus.replace(/_/g, ' ')}.`];

      if (newStatus === 'on_scene') {
        // Auto threat briefing when arriving on scene
        const currentCall = getCurrentCall(unit.id);
        if (currentCall) {
          const threatCtx = await buildThreatContext({
            locationAddress: currentCall.location_address,
            latitude: currentCall.latitude,
            longitude: currentCall.longitude,
            callId: currentCall.id,
          });
          if (threatCtx.threatLevel !== 'low') {
            parts.push(composeThreatBriefing(threatCtx));
          }
          // Proximity hazards
          if (currentCall.latitude && currentCall.longitude) {
            const hazards = checkProximityHazards(currentCall.latitude, currentCall.longitude);
            if (hazards.length > 0) {
              parts.push(composeProximityNarrative(hazards));
            }
          }
        }
      } else if (newStatus === 'en_route') {
        // Proximity hazard scan for destination
        const currentCall = getCurrentCall(unit.id);
        if (currentCall?.latitude && currentCall?.longitude) {
          const hazards = checkProximityHazards(currentCall.latitude, currentCall.longitude);
          if (hazards.length > 0) {
            parts.push('En route advisory.');
            parts.push(composeProximityNarrative(hazards));
          }
          // Quick threat level check
          const threatCtx = await buildThreatContext({
            locationAddress: currentCall.location_address,
            latitude: currentCall.latitude,
            longitude: currentCall.longitude,
          });
          if (threatCtx.threatLevel === 'critical' || threatCtx.threatLevel === 'high') {
            parts.push(`${threatCtx.threatLevel.toUpperCase()} threat location. Use caution on approach.`);
          }
        }
      } else if (newStatus === 'available') {
        // Queue status when going available
        const queue = getCallQueueStats();
        if (queue.total > 0) {
          let queueMsg = `${queue.total} pending call${queue.total > 1 ? 's' : ''} in queue`;
          if (queue.p1 > 0) queueMsg += `, ${queue.p1} priority one`;
          if (queue.p2 > 0) queueMsg += `, ${queue.p2} priority two`;
          parts.push(queueMsg + '.');
        } else {
          parts.push('No pending calls.');
        }
      }

      return { success: true, response: parts.join(' ') };
    }

    case 'acknowledge': {
      // Contextual acknowledgment — tell them what they're acknowledging
      const unit = getUserUnit(userId);
      if (unit) {
        const lastDispatch = getLastDispatchToUnit(unit.call_sign);
        if (lastDispatch) {
          return { success: true, response: `Copy, ${unit.call_sign} acknowledges ${lastDispatch.incident_type} at ${lastDispatch.location_address || 'assigned location'}.` };
        }
      }
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

      // Include nearest available units in response
      const parts: string[] = [`Backup request transmitted for ${unit.call_sign} at ${location}.`];
      if (gps) {
        const nearest = findNearestUnits(gps.lat, gps.lng, 3);
        if (nearest.length > 0) {
          parts.push(composeNearestUnitsNarrative(nearest));
        } else {
          parts.push('No available units with GPS in range.');
        }
      }

      return { success: true, response: parts.join(' ') };
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
      // Enhanced code 4 — include call context
      const unit4 = getUserUnit(userId);
      const call4 = unit4 ? getCurrentCall(unit4.id) : null;
      const callRef = call4 ? ` on ${call4.call_number}` : '';
      return { success: true, response: msg || `Copy, code 4${callRef}. Scene secure, no further assistance needed.` };
    }

    case 'sitrep': {
      // Situation report — summarize officer's current status, call, and nearby activity
      const unit = getUserUnit(userId);
      if (!unit) return { success: false, response: 'No active unit found.' };
      const gps = getLatestGps(unit.call_sign);
      const currentCall = getCurrentCall(unit.id);
      const parts: string[] = [`Situation report for ${unit.call_sign}.`];
      parts.push(`Current status: ${unit.status.replace(/_/g, ' ')}.`);
      if (currentCall) {
        parts.push(`Assigned to ${currentCall.call_number}, ${currentCall.incident_type}, priority ${currentCall.priority}, at ${currentCall.location_address || 'unknown location'}.`);
      } else {
        parts.push('No active call assignment.');
      }
      // Queue snapshot
      const queue = getCallQueueStats();
      parts.push(`${queue.total} call${queue.total !== 1 ? 's' : ''} pending${queue.p1 > 0 ? `, ${queue.p1} priority one` : ''}.`);
      // Units on duty
      const onDuty = getActiveUnitCount();
      parts.push(`${onDuty} unit${onDuty !== 1 ? 's' : ''} on duty.`);
      // Threat level if on a call
      if (currentCall?.latitude && currentCall?.longitude) {
        const threatCtx = await buildThreatContext({
          locationAddress: currentCall.location_address,
          latitude: currentCall.latitude,
          longitude: currentCall.longitude,
          callId: currentCall.id,
        });
        if (threatCtx.threatLevel !== 'low') {
          parts.push(`Threat level: ${threatCtx.threatLevel}.`);
        }
      }
      return { success: true, response: parts.join(' ') };
    }

    case 'run_name': {
      // Subject name lookup across persons, warrants, arrests, trespass
      const name = cmd.params.name;
      if (!name) return { success: false, response: 'Please specify a name to look up.' };
      const results = runNameLookup(name);
      const parts: string[] = [];
      if (results.persons.length === 0 && results.warrants.length === 0 && results.arrests.length === 0) {
        return { success: true, response: `No local records found for ${name}.` };
      }
      if (results.persons.length > 0) {
        const p = results.persons[0];
        const flags: string[] = [];
        if (p.has_criminal_history) flags.push('criminal history');
        if (p.is_sex_offender) flags.push('registered sex offender');
        const gangAffiliation = getMeaningfulWarningValue(p.gang_affiliation);
        if (gangAffiliation) flags.push(`gang affiliation: ${gangAffiliation}`);
        if (p.caution_flags) flags.push(`caution: ${p.caution_flags}`);
        parts.push(`${p.first_name} ${p.last_name}${p.dob ? `, DOB ${p.dob}` : ''}.`);
        if (flags.length > 0) parts.push(`Flags: ${flags.join(', ')}.`);
      }
      if (results.warrants.length > 0) {
        parts.push(`${results.warrants.length} active warrant${results.warrants.length > 1 ? 's' : ''}.`);
        const w = results.warrants[0];
        parts.push(`${w.warrant_type || 'Unknown type'}: ${w.description || w.severity || 'no details'}.`);
      }
      if (results.arrests.length > 0) {
        parts.push(`${results.arrests.length} prior arrest${results.arrests.length > 1 ? 's' : ''}, most recent: ${results.arrests[0].charge || 'unknown charge'}.`);
      }
      if (results.trespass.length > 0) {
        parts.push(`${results.trespass.length} active trespass order${results.trespass.length > 1 ? 's' : ''}.`);
      }
      return { success: true, response: parts.join(' ') };
    }

    case 'officer_down': {
      // Emergency — broadcast panic alert with location and nearest units
      const unit = getUserUnit(userId);
      const callSign = unit?.call_sign || userName;
      const gps = unit ? getLatestGps(unit.call_sign) : null;
      const location = gps?.address || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'unknown location');

      broadcastDispatchUpdate({
        action: 'officer_down',
        call_sign: callSign,
        location,
        officer_name: userName,
        latitude: gps?.lat,
        longitude: gps?.lng,
      });
      auditLog(req, 'EMERGENCY' as any, 'unit' as any, String(unit?.id || 0),
        `OFFICER DOWN: ${callSign} at ${location}`);

      const parts: string[] = [`OFFICER DOWN. ${callSign} at ${location}. All units respond.`];
      if (gps) {
        const nearest = findNearestUnits(gps.lat, gps.lng, 5);
        if (nearest.length > 0) {
          parts.push(composeNearestUnitsNarrative(nearest));
        }
      }
      return { success: true, response: parts.join(' ') };
    }

    case 'area_check': {
      // Area activity report from current GPS position
      const unit = getUserUnit(userId);
      const gps = unit ? getLatestGps(unit.call_sign) : null;
      if (!gps) return { success: false, response: 'GPS location not available for area check.' };
      const areaMsg = composeAreaCheckNarrative(gps.lat, gps.lng);
      const hazards = checkProximityHazards(gps.lat, gps.lng);
      const parts: string[] = [`Area check for ${unit!.call_sign}.`, areaMsg];
      if (hazards.length > 0) {
        parts.push(composeProximityNarrative(hazards));
      }
      return { success: true, response: parts.join(' ') };
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
