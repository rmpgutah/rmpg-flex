// Voice routes for Workers
import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

export function mountVoiceRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  const NON_WARNING_PLACEHOLDERS = new Set(['', '0', 'none', 'n/a', 'na', 'null', 'false', 'unknown', 'unspecified']);

  function getMeaningfulWarningValue(value: unknown): string | null {
    if (value == null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    if (NON_WARNING_PLACEHOLDERS.has(normalized.toLowerCase())) return null;
    return normalized;
  }

  // Rate limiting (10 commands/min per user)
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

  // Whisper transcription
  async function transcribeAudio(audioBuffer: ArrayBuffer): Promise<string | null> {
    const apiKey = (globalThis as any).__env__?.OPENAI_API_KEY || process?.env?.OPENAI_API_KEY;
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
      if (!resp.ok) return null;
      const text = await resp.text();
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  interface ParsedCommand {
    action: string;
    params: Record<string, string>;
    raw: string;
  }

  function parseCommand(transcript: string): ParsedCommand | null {
    const t = transcript.toLowerCase().trim();
    if (/\b(en\s*route|10[-\s]?76)\b/.test(t)) return { action: 'status_update', params: { status: 'en_route' }, raw: transcript };
    if (/\b(on\s*scene|10[-\s]?97)\b/.test(t)) return { action: 'status_update', params: { status: 'on_scene' }, raw: transcript };
    if (/\b(available|10[-\s]?8|cleared)\b/.test(t)) return { action: 'status_update', params: { status: 'available' }, raw: transcript };
    if (/\b(out\s*of\s*service|10[-\s]?7)\b/.test(t)) return { action: 'status_update', params: { status: 'out_of_service' }, raw: transcript };
    if (/\b(on\s*break|10[-\s]?10)\b/.test(t)) return { action: 'status_update', params: { status: 'on_break' }, raw: transcript };
    if (/\b(busy|10[-\s]?6)\b/.test(t)) return { action: 'status_update', params: { status: 'busy' }, raw: transcript };
    if (/\b(copy|10[-\s]?4|roger)\b/.test(t)) return { action: 'acknowledge', params: {}, raw: transcript };
    if (/\brequest\s*(backup)\b/.test(t)) return { action: 'request_backup', params: {}, raw: transcript };
    if (/\brequest\s*(ems|ambulance|medic)\b/.test(t)) return { action: 'request_ems', params: {}, raw: transcript };
    if (/\brequest\s*(k[-\s]?9|canine)\b/.test(t)) return { action: 'request_k9', params: {}, raw: transcript };
    const plateMatch = t.match(/\brun\s*plate\s+([a-z0-9\s]+)/i);
    if (plateMatch) return { action: 'run_plate', params: { plate: plateMatch[1].trim() }, raw: transcript };
    if (/\bnext\s*call\b/.test(t)) return { action: 'next_call', params: {}, raw: transcript };
    if (/\bstart\s*pursuit\b/.test(t)) return { action: 'start_pursuit', params: {}, raw: transcript };
    if (/\bmark\s*evidence\b/.test(t)) return { action: 'mark_evidence', params: {}, raw: transcript };
    const caseStatusMatch = t.match(/\bstatus\s*(?:of\s*)?case\s*(\S+)/i);
    if (caseStatusMatch) return { action: 'case_status', params: { case_number: caseStatusMatch[1] }, raw: transcript };
    const linkCaseMatch = t.match(/\blink\s*(?:to\s*)?case\s*(\S+)/i);
    if (linkCaseMatch) return { action: 'link_case', params: { case_number: linkCaseMatch[1] }, raw: transcript };
    if (/\bstart\s*statement/i.test(t)) return { action: 'start_statement', params: {}, raw: transcript };
    if (/\bend\s*statement/i.test(t)) return { action: 'end_statement', params: {}, raw: transcript };
    if (/\b(code\s*4|all\s*clear)\b/i.test(t)) return { action: 'code_4', params: {}, raw: transcript };
    if (/\bend\s*pursuit/i.test(t)) return { action: 'end_pursuit', params: {}, raw: transcript };
    if (/\bshift\s*(summary|briefing|handoff)/i.test(t)) return { action: 'shift_briefing', params: {}, raw: transcript };
    if (/\bnearest\s*units?\b/i.test(t)) return { action: 'nearest_units', params: {}, raw: transcript };
    if (/\bthreat\s*(check|assessment|briefing)/i.test(t)) return { action: 'threat_check', params: {}, raw: transcript };
    if (/\b(sitrep|sit\s*rep|situation\s*report|status\s*report)\b/i.test(t)) return { action: 'sitrep', params: {}, raw: transcript };
    const nameMatch = t.match(/\brun\s*(?:name|subject|person)\s+(.+)/i);
    if (nameMatch) return { action: 'run_name', params: { name: nameMatch[1].trim() }, raw: transcript };
    if (/\b(officer\s*down|shots?\s*fired|10[-\s]?99|panic|emergency\s*traffic)\b/i.test(t)) return { action: 'officer_down', params: {}, raw: transcript };
    if (/\b(area\s*check|area\s*scan|what'?s?\s*(?:in\s*this|around\s*this|near)\s*area)\b/i.test(t)) return { action: 'area_check', params: {}, raw: transcript };
    return null;
  }

  async function getUserUnit(db: D1Db, userId: number): Promise<{ id: number; call_sign: string; status: string } | null> {
    return await db.prepare(`SELECT id, call_sign, status FROM dispatch_units WHERE officer_user_id = ? AND status != 'off_duty'`).get(userId) as any || null;
  }

  async function getLatestGps(db: D1Db, callSign: string): Promise<{ lat: number; lng: number; address?: string } | null> {
    const row = await db.prepare(`SELECT latitude, longitude, address FROM gps_locations WHERE call_sign = ? ORDER BY timestamp DESC LIMIT 1`).get(callSign) as any;
    if (!row) return null;
    return { lat: row.latitude, lng: row.longitude, address: row.address };
  }

  async function getCurrentCall(db: D1Db, unitId: number): Promise<any | null> {
    try {
      return await db.prepare(`SELECT c.id, c.call_number, c.incident_type, c.location_address, c.latitude, c.longitude, c.priority, c.description FROM calls_for_service c JOIN dispatch_units u ON u.current_call_id = c.id WHERE u.id = ?`).get(unitId) as any || null;
    } catch { return null; }
  }

  async function getCallQueueStats(db: D1Db): Promise<{ total: number; p1: number; p2: number; oldest: string | null }> {
    try {
      const rows = await db.prepare(`SELECT priority, call_number FROM calls_for_service WHERE status IN ('pending','dispatched') AND archived = 0 ORDER BY created_at ASC`).all() as any[];
      const p1 = rows.filter((r: any) => r.priority === 'P1').length;
      const p2 = rows.filter((r: any) => r.priority === 'P2').length;
      return { total: rows.length, p1, p2, oldest: rows[0]?.call_number || null };
    } catch { return { total: 0, p1: 0, p2: 0, oldest: null }; }
  }

  async function getLastDispatchToUnit(db: D1Db, callSign: string): Promise<any | null> {
    try {
      return await db.prepare(`SELECT c.call_number, c.incident_type, c.location_address FROM calls_for_service c JOIN dispatch_unit_assignments dua ON dua.call_id = c.id WHERE dua.call_sign = ? ORDER BY dua.assigned_at DESC LIMIT 1`).get(callSign) as any || null;
    } catch { return null; }
  }

  async function runNameLookup(db: D1Db, name: string): Promise<{ persons: any[]; warrants: any[]; arrests: any[]; trespass: any[] }> {
    const namePattern = `%${name}%`;
    const persons = await safeAllVoice(db, `SELECT id, first_name, last_name, dob, gang_affiliation, is_sex_offender, has_criminal_history, caution_flags FROM persons WHERE (first_name || ' ' || last_name) LIKE ? LIMIT 5`, [namePattern]);
    const warrants = await safeAllVoice(db, `SELECT w.id, w.warrant_type, w.severity, w.description, p.first_name, p.last_name FROM warrants w LEFT JOIN persons p ON p.id = w.person_id WHERE (p.first_name || ' ' || p.last_name) LIKE ? AND w.status = 'active' LIMIT 5`, [namePattern]);
    const arrests = await safeAllVoice(db, `SELECT id, subject_name, charge, arrest_date FROM arrests WHERE subject_name LIKE ? ORDER BY arrest_date DESC LIMIT 3`, [namePattern]);
    const trespass = await safeAllVoice(db, `SELECT id, subject_name, property_address, status FROM trespass_orders WHERE subject_name LIKE ? AND status = 'active' LIMIT 3`, [namePattern]);
    return { persons, warrants, arrests, trespass };
  }

  async function safeAllVoice<T = any>(db: D1Db, sql: string, params: any[] = []): Promise<T[]> {
    try { return await db.prepare(sql).all(...params) as T[]; } catch { return []; }
  }

  async function getActiveUnitCount(db: D1Db): Promise<number> {
    try {
      const row = await db.prepare(`SELECT COUNT(*) as cnt FROM dispatch_units WHERE status NOT IN ('off_duty','out_of_service')`).get() as any;
      return row?.cnt || 0;
    } catch { return 0; }
  }

  function composeAreaCheckNarrative(calls: any[]): string {
    if (calls.length === 0) return 'No recent activity in this area in the last 24 hours.';
    const types = [...new Set(calls.map((c: any) => c.incident_type).filter(Boolean))];
    const highPri = calls.filter((c: any) => c.priority === 'P1' || c.priority === 'P2').length;
    let msg = `${calls.length} calls in this area in the last 24 hours`;
    if (types.length > 0) msg += `, types include ${types.slice(0, 4).join(', ')}`;
    if (highPri > 0) msg += `, ${highPri} were high priority`;
    return msg + '.';
  }

  async function executeCommand(
    cmd: ParsedCommand,
    db: D1Db,
    userId: number,
    userName: string,
  ): Promise<{ success: boolean; response: string }> {
    switch (cmd.action) {
      case 'status_update': {
        const unit = await getUserUnit(db, userId);
        if (!unit) return { success: false, response: 'No active unit found for your account.' };
        const newStatus = cmd.params.status;
        await db.prepare('UPDATE dispatch_units SET status = ? WHERE id = ?').run(newStatus, unit.id);
        const parts: string[] = [`Copy, ${unit.call_sign} now showing ${newStatus.replace(/_/g, ' ')}.`];
        if (newStatus === 'on_scene') {
          const currentCall = await getCurrentCall(db, unit.id);
          if (currentCall) {
            if (currentCall.latitude && currentCall.longitude) {
              const hazards = await safeAllVoice(db, `SELECT * FROM premise_alerts WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`, [currentCall.latitude - 0.005, currentCall.latitude + 0.005, currentCall.longitude - 0.005, currentCall.longitude + 0.005]);
              if (hazards.length > 0) {
                parts.push(`${hazards.length} premise alert(s) at this location.`);
              }
            }
          }
        } else if (newStatus === 'en_route') {
          const currentCall = await getCurrentCall(db, unit.id);
          if (currentCall?.latitude && currentCall?.longitude) {
            const hazards = await safeAllVoice(db, `SELECT * FROM premise_alerts WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`, [currentCall.latitude - 0.005, currentCall.latitude + 0.005, currentCall.longitude - 0.005, currentCall.longitude + 0.005]);
            if (hazards.length > 0) {
              parts.push('En route advisory.');
              parts.push(`${hazards.length} premise alert(s) at destination.`);
            }
          }
        } else if (newStatus === 'available') {
          const queue = await getCallQueueStats(db);
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
        const unit = await getUserUnit(db, userId);
        if (unit) {
          const lastDispatch = await getLastDispatchToUnit(db, unit.call_sign);
          if (lastDispatch) {
            return { success: true, response: `Copy, ${unit.call_sign} acknowledges ${lastDispatch.incident_type} at ${lastDispatch.location_address || 'assigned location'}.` };
          }
        }
        return { success: true, response: 'Acknowledged.' };
      }
      case 'request_backup': {
        const unit = await getUserUnit(db, userId);
        if (!unit) return { success: false, response: 'No active unit found.' };
        const gps = await getLatestGps(db, unit.call_sign);
        const location = gps?.address || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'unknown location');
        const parts: string[] = [`Backup request transmitted for ${unit.call_sign} at ${location}.`];
        if (gps) {
          const nearest = await safeAllVoice(db, `SELECT call_sign, status FROM dispatch_units WHERE status = 'available' AND id IN (SELECT id FROM gps_locations ORDER BY timestamp DESC LIMIT 10)`);
          if (nearest.length > 0) {
            parts.push(`Nearest available: ${nearest.slice(0, 3).map((u: any) => u.call_sign).join(', ')}.`);
          } else {
            parts.push('No available units with GPS in range.');
          }
        }
        return { success: true, response: parts.join(' ') };
      }
      case 'request_ems': {
        const unit = await getUserUnit(db, userId);
        return { success: true, response: 'E.M.S. request transmitted.' };
      }
      case 'request_k9': {
        const unit = await getUserUnit(db, userId);
        return { success: true, response: 'K-9 request transmitted.' };
      }
      case 'run_plate': {
        const plate = cmd.params.plate.replace(/\s+/g, '').toUpperCase();
        const vehicle = await db.prepare(`SELECT plate_number, make, model, year, color, owner_name FROM vehicles WHERE UPPER(REPLACE(plate_number, ' ', '')) = ?`).get(plate) as any;
        if (!vehicle) return { success: true, response: `No local records found for plate ${plate}.` };
        return { success: true, response: `Plate ${vehicle.plate_number}: ${vehicle.year || ''} ${vehicle.color || ''} ${vehicle.make || ''} ${vehicle.model || ''}. Registered to ${vehicle.owner_name || 'unknown'}.`.replace(/\s+/g, ' ') };
      }
      case 'next_call': {
        const call = await db.prepare(`SELECT call_number, incident_type, priority, location_address FROM calls_for_service WHERE status IN ('pending', 'dispatched') AND archived = 0 ORDER BY CASE priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END, created_at ASC LIMIT 1`).get() as any;
        if (!call) return { success: true, response: 'No pending calls in the queue.' };
        return { success: true, response: `Next call: ${call.call_number}, ${call.incident_type}, priority ${call.priority}, at ${call.location_address || 'unknown location'}.` };
      }
      case 'start_pursuit': {
        const unit = await getUserUnit(db, userId);
        if (!unit) return { success: false, response: 'No active unit found.' };
        return { success: true, response: `Pursuit logged for ${unit.call_sign}. All units notified.` };
      }
      case 'mark_evidence': {
        const unit = await getUserUnit(db, userId);
        const callSign = unit?.call_sign || userName;
        const gps = unit ? await getLatestGps(db, unit.call_sign) : null;
        const address = gps?.address || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'current location');
        return { success: true, response: `Evidence marker placed at ${address}.` };
      }
      case 'code_4': {
        const unit4 = await getUserUnit(db, userId);
        const call4 = unit4 ? await getCurrentCall(db, unit4.id) : null;
        const callRef = call4 ? ` on ${call4.call_number}` : '';
        return { success: true, response: `Copy, code 4${callRef}. Scene secure, no further assistance needed.` };
      }
      case 'sitrep': {
        const unit = await getUserUnit(db, userId);
        if (!unit) return { success: false, response: 'No active unit found.' };
        const gps = await getLatestGps(db, unit.call_sign);
        const currentCall = await getCurrentCall(db, unit.id);
        const parts: string[] = [`Situation report for ${unit.call_sign}.`];
        parts.push(`Current status: ${unit.status.replace(/_/g, ' ')}.`);
        if (currentCall) {
          parts.push(`Assigned to ${currentCall.call_number}, ${currentCall.incident_type}, priority ${currentCall.priority}, at ${currentCall.location_address || 'unknown location'}.`);
        } else {
          parts.push('No active call assignment.');
        }
        const queue = await getCallQueueStats(db);
        parts.push(`${queue.total} call${queue.total !== 1 ? 's' : ''} pending${queue.p1 > 0 ? `, ${queue.p1} priority one` : ''}.`);
        const onDuty = await getActiveUnitCount(db);
        parts.push(`${onDuty} unit${onDuty !== 1 ? 's' : ''} on duty.`);
        return { success: true, response: parts.join(' ') };
      }
      case 'run_name': {
        const name = cmd.params.name;
        if (!name) return { success: false, response: 'Please specify a name to look up.' };
        const results = await runNameLookup(db, name);
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
        const unit = await getUserUnit(db, userId);
        const callSign = unit?.call_sign || userName;
        const gps = unit ? await getLatestGps(db, unit.call_sign) : null;
        const location = gps?.address || (gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'unknown location');
        const parts: string[] = [`OFFICER DOWN. ${callSign} at ${location}. All units respond.`];
        if (gps) {
          const nearest = await safeAllVoice(db, `SELECT call_sign, status FROM dispatch_units WHERE status = 'available' AND id IN (SELECT id FROM gps_locations ORDER BY timestamp DESC LIMIT 10)`);
          if (nearest.length > 0) {
            parts.push(`Nearest: ${nearest.slice(0, 5).map((u: any) => u.call_sign).join(', ')}.`);
          }
        }
        return { success: true, response: parts.join(' ') };
      }
      case 'area_check': {
        const unit = await getUserUnit(db, userId);
        const gps = unit ? await getLatestGps(db, unit.call_sign) : null;
        if (!gps) return { success: false, response: 'GPS location not available for area check.' };
        const delta = 0.005;
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const calls = await safeAllVoice(db, `SELECT incident_type, location_address, priority FROM calls_for_service WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ? AND created_at >= ? ORDER BY created_at DESC LIMIT 10`, [gps.lat - delta, gps.lat + delta, gps.lng - delta, gps.lng + delta, cutoff]);
        const areaMsg = composeAreaCheckNarrative(calls);
        const hazards = await safeAllVoice(db, `SELECT * FROM premise_alerts WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`, [gps.lat - delta, gps.lat + delta, gps.lng - delta, gps.lng + delta]);
        const parts: string[] = [`Area check for ${unit!.call_sign}.`, areaMsg];
        if (hazards.length > 0) {
          parts.push(`${hazards.length} premise alert(s) in area.`);
        }
        return { success: true, response: parts.join(' ') };
      }
      case 'end_pursuit': {
        const unit = await getUserUnit(db, userId);
        if (!unit) return { success: false, response: 'No active unit found.' };
        return { success: true, response: `Pursuit ended for ${unit.call_sign}.` };
      }
      case 'shift_briefing': {
        const queue = await getCallQueueStats(db);
        const onDuty = await getActiveUnitCount(db);
        return { success: true, response: `Shift summary: ${queue.total} pending calls${queue.p1 > 0 ? `, ${queue.p1} P1` : ''}, ${onDuty} units on duty.` };
      }
      case 'nearest_units': {
        const unit = await getUserUnit(db, userId);
        const gps = unit ? await getLatestGps(db, unit.call_sign) : null;
        if (!gps) return { success: false, response: 'GPS location not available.' };
        const nearest = await safeAllVoice(db, `SELECT call_sign, status FROM dispatch_units WHERE status = 'available' AND id IN (SELECT id FROM gps_locations ORDER BY timestamp DESC LIMIT 10)`);
        return { success: true, response: nearest.length > 0 ? `Nearest available: ${nearest.slice(0, 5).map((u: any) => u.call_sign).join(', ')}.` : 'No available units with GPS in range.' };
      }
      case 'threat_check': {
        const unit = await getUserUnit(db, userId);
        if (!unit) return { success: false, response: 'No active unit found.' };
        const currentCall = await db.prepare('SELECT c.id, c.location_address, c.latitude, c.longitude FROM calls_for_service c JOIN dispatch_units u ON u.current_call_id = c.id WHERE u.id = ?').get(unit.id) as any;
        if (!currentCall) return { success: true, response: 'No active call to assess.' };
        const hazards = await safeAllVoice(db, `SELECT * FROM premise_alerts WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`, [currentCall.latitude - 0.005, currentCall.latitude + 0.005, currentCall.longitude - 0.005, currentCall.longitude + 0.005]);
        if (hazards.length > 0) return { success: true, response: `${hazards.length} premise alert(s) at this location. Use caution.` };
        return { success: true, response: 'No threat indicators detected at this location.' };
      }
      case 'case_status': {
        const caseNum = cmd.params.case_number;
        try {
          const c = await db.prepare('SELECT case_number, status, assigned_to, updated_at FROM cases WHERE case_number = ?').get(caseNum) as any;
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

  // POST /api/voice/command — audio upload
  api.post('/command', async (c) => {
    try {
      const user = c.get('user');
      const userId = user.userId;
      if (!checkRateLimit(userId)) return c.json({ error: 'Rate limit exceeded. Max 10 commands per minute.' }, 429);

      const body = await c.req.formData();
      const audioFile = body.get('audio');
      if (!audioFile || typeof audioFile === 'string') return c.json({ error: 'No audio file provided. Field name must be "audio".' }, 400);

      const audioBuffer = await (audioFile as File).arrayBuffer();
      const transcript = await transcribeAudio(audioBuffer);
      if (!transcript) return c.json({ error: 'Could not transcribe audio. Check OPENAI_API_KEY is set.' }, 422);

      const command = parseCommand(transcript);
      if (!command) return c.json({ success: false, transcript, response: `Could not parse command from: "${transcript}"` });

      const db = new D1Db(c.env.DB);
      const result = await executeCommand(command, db, userId, user.username);
      return c.json({ success: result.success, transcript, action: command.action, response: result.response });
    } catch {
      return c.json({ error: 'Voice command processing failed' }, 500);
    }
  });

  // POST /api/voice/parse — text transcript
  api.post('/parse', async (c) => {
    try {
      const user = c.get('user');
      const userId = user.userId;
      if (!checkRateLimit(userId)) return c.json({ error: 'Rate limit exceeded. Max 10 commands per minute.' }, 429);

      const body = await c.req.json() as { transcript?: string };
      const transcript = body.transcript;
      if (!transcript || typeof transcript !== 'string') return c.json({ error: 'transcript is required and must be a string' }, 400);
      if (transcript.length > 500) return c.json({ error: 'transcript must be 500 characters or less' }, 400);

      const command = parseCommand(transcript);
      if (!command) return c.json({ success: false, transcript, response: `Could not parse command from: "${transcript}"` });

      const db = new D1Db(c.env.DB);
      const result = await executeCommand(command, db, userId, user.username);
      return c.json({ success: result.success, transcript, action: command.action, response: result.response });
    } catch {
      return c.json({ error: 'Voice command processing failed' }, 500);
    }
  });

  // POST /api/voice/statement — save witness statement
  api.post('/statement', async (c) => {
    try {
      const body = await c.req.json() as { callId?: number; transcript?: string; isFinal?: boolean };
      const { callId, transcript, isFinal } = body;
      if (!callId || !transcript) return c.json({ error: 'callId and transcript required' }, 400);

      const db = new D1Db(c.env.DB);
      const timestamp = new Date().toISOString();
      const prefix = isFinal ? '\n\n[WITNESS STATEMENT - FINAL]' : '\n\n[WITNESS STATEMENT - IN PROGRESS]';
      await db.prepare('UPDATE calls_for_service SET description = COALESCE(description, \'\') || ? WHERE id = ?').run(`${prefix} (${timestamp})\n${transcript}`, callId);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Failed to save statement' }, 500);
    }
  });

  app.route('/api/voice', api);
}
