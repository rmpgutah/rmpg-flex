// ============================================================
// RMPG Flex — Process Service Intake
// Parses uploaded PDF documents (Court Filing, Field Sheet,
// Information Page) and auto-creates Person, Property, and
// CFS dispatch call records with linkage.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { broadcastDispatchUpdate } from '../utils/websocket';
import { geocodeAddress } from '../utils/geocode';
import { identifyBeat } from '../utils/geofence';
import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const router = Router();
router.use(authenticateToken);

// ── Auto-Detect Document Type by Content ─────────────────────

function detectDocType(text: string): 'court_docket' | 'field_sheet' | 'info_page' | 'unknown' {
  // Court Docket: contains SUMMONS, Plaintiff/Defendant, Attorney for Plaintiff
  if (/SUMMONS|COMPLAINT|Attorney for Plaintiff|JUDICIAL DISTRICT COURT/i.test(text)) return 'court_docket';
  // Field Sheet: contains Party to Serve, Instructions, Address + city/state/zip on separate line
  if (/Party to Serve|Instructions\s*\n.*Sub-serve|Date & Time.*Description of Service/i.test(text)) return 'field_sheet';
  // Info Page: contains JOB number header, CLIENT/SERVER columns, Service Attempts, Recipient
  if (/^JOB\b|Service Attempts|Recipient:|Job Activity|Af\s*fi\s*davits/im.test(text)) return 'info_page';
  return 'unknown';
}

// ── Text Extraction Helpers ──────────────────────────────────

function extractBetween(text: string, before: string, after: string): string {
  const startIdx = text.indexOf(before);
  if (startIdx === -1) return '';
  const start = startIdx + before.length;
  const endIdx = after ? text.indexOf(after, start) : text.length;
  return (endIdx === -1 ? text.substring(start) : text.substring(start, endIdx)).trim();
}

function extractField(text: string, label: string): string {
  const patterns = [
    new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i'),
    new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return '';
}

function extractName(text: string): { first: string; middle: string; last: string } {
  // Try "Party to Serve: Muhammad A Nawaz" or "Recipient: Muhammad A Nawaz"
  const nameStr = extractField(text, 'Party to Serve') || extractField(text, 'Recipient') || extractField(text, 'Defendant');
  if (!nameStr) return { first: '', middle: '', last: '' };
  const parts = nameStr.replace(/,.*$/, '').replace(/an individual/i, '').trim().split(/\s+/);
  if (parts.length >= 3) return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: nameStr, middle: '', last: '' };
}

function extractDOB(text: string): string {
  const m = text.match(/DOB[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i) || text.match(/DOB[:\s]*(\d{4}-\d{2}-\d{2})/i);
  if (!m) return '';
  const d = m[1];
  if (d.includes('/')) {
    const [mm, dd, yyyy] = d.split('/');
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return d;
}

function extractAddress(text: string): string {
  // Field Sheet format: "Address" on one line, actual address on next line
  const m = text.match(/^Address\s*\n\s*(.+(?:,\s*[A-Z]{2}\s*\d{5}).*)$/im);
  if (m) return m[1].trim();
  // Also try: line containing street number + city + state + zip
  const addrLine = text.match(/(\d+\s+[A-Za-z].*?,\s*[A-Za-z ]+,\s*[A-Z]{2}\s*\d{5}[^)\n]*)/);
  if (addrLine) return addrLine[1].trim();
  return extractField(text, 'Address') || '';
}

function extractPlaintiff(text: string): string {
  return extractBetween(text, 'Plaintiff', 'Defendant') || extractField(text, 'Plaintiff') || '';
}

function extractCourt(text: string): string {
  const m = text.match(/(THIRD|FIRST|SECOND|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*/i);
  return m ? m[0].trim() : '';
}

function extractDocuments(text: string): string {
  return extractField(text, 'Documents') || '';
}

function extractInstructions(text: string): string {
  const m = text.match(/Instructions\s*\n([\s\S]*?)(?:\n\n|\nMuhammad|\nAddress|\n[A-Z][a-z]+ [A-Z])/i);
  return m ? m[1].replace(/\n/g, ' ').trim() : '';
}

function extractJobNumber(text: string): string {
  const m = text.match(/(?:Job|JOB)[:\s#]*(\d+)/);
  return m ? m[1] : '';
}

function extractCaseNumber(text: string): string {
  const m = text.match(/\((\d{5,})\)/);
  return m ? m[1] : '';
}

function extractDueDate(text: string): string {
  const m = text.match(/Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i) || text.match(/Due[:\s]*([A-Z][a-z]+ \d{1,2}, \d{4})/i);
  return m ? m[1] : '';
}

function extractAttorney(text: string): { name: string; phone: string; email: string; bar: string } {
  const name = extractField(text, 'Attorney for Plaintiff') || '';
  const phone = (text.match(/Tel[:\s]*([\(\d\)\-\s]+)/i) || [])[1]?.trim() || '';
  const email = (text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i) || [])[1] || '';
  const bar = (text.match(/Bar#?\s*(\d+)/i) || [])[1] || '';
  return { name, phone, email, bar };
}

function extractFee(text: string): string {
  return extractField(text, 'Fee') || '';
}

function extractServiceWindows(text: string): string {
  const windows: string[] = [];
  if (/6AM-9AM|6am.*9am/i.test(text)) windows.push('6AM-9AM');
  if (/9AM-6PM|9am.*6pm/i.test(text)) windows.push('9AM-6PM');
  if (/6PM-9PM|6pm.*9pm/i.test(text)) windows.push('6PM-9PM');
  if (/weekend/i.test(text)) windows.push('Weekend required');
  return windows.join(', ');
}

function extractServeInstructions(text: string): string {
  // Get ONLY the serve instructions — not the case details
  const m = text.match(/Instructions\s*\n([\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n)/i);
  if (m) return m[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  // Fallback: look for Sub-serve pattern
  const sub = text.match(/(Sub-serve[\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n)/i);
  if (sub) return sub[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

function extractCaseNotes(text: string): string {
  const parts: string[] = [];
  const plaintiff = extractPlaintiff(text);
  if (plaintiff) parts.push(`Plaintiff: ${plaintiff.replace(/\n/g, ' ').trim()}`);
  const court = extractCourt(text);
  if (court) parts.push(`Court: ${court}`);
  const docs = extractDocuments(text);
  if (docs) parts.push(`Documents: ${docs}`);
  const caseNum = extractCaseNumber(text);
  if (caseNum) parts.push(`Case #${caseNum}`);
  const attorney = extractAttorney(text);
  if (attorney.name) parts.push(`Attorney: ${attorney.name}${attorney.bar ? ` Bar#${attorney.bar}` : ''}`);
  if (attorney.phone) parts.push(`Attorney Tel: ${attorney.phone}`);
  if (attorney.email) parts.push(`Attorney Email: ${attorney.email}`);
  // Court clerk info
  const clerk = text.match(/call the clerk.*?at\s*\((\d{3})\)\s*(\d{3}[-.]?\d{4})/i);
  if (clerk) parts.push(`Court Clerk: (${clerk[1]}) ${clerk[2]}`);
  // Court address
  const courtAddr = text.match(/(\d+ South State St.*?\d{5})/i);
  if (courtAddr) parts.push(`Court Address: ${courtAddr[1]}`);
  return parts.join('. ');
}

function extractClientAddress(text: string): string {
  // ICU Investigations address from Field Sheet header
  const m = text.match(/ICU Investigations.*?\n([\d]+ .*?\n.*?\d{5})/i);
  if (m) return m[1].replace(/\n/g, ', ').trim();
  return '';
}

// ── PDF Text Extraction ──────────────────────────────────────

router.post('/extract-text', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  // Collect raw body (PDF binary from multipart/form-data or raw)
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks);
      if (body.length < 100) { res.json({ text: '', length: 0 }); return; }

      // Save to temp file and run pdftotext
      const tmpDir = mkdtempSync(join(tmpdir(), 'serve-intake-'));
      const tmpPdf = join(tmpDir, 'input.pdf');
      writeFileSync(tmpPdf, body);

      try {
        const { stdout } = await execFileAsync('/usr/bin/pdftotext', ['-layout', tmpPdf, '-']);
        res.json({ text: stdout, length: stdout.length });
      } catch {
        // Fallback: try without -layout
        try {
          const { stdout } = await execFileAsync('/usr/bin/pdftotext', [tmpPdf, '-']);
          res.json({ text: stdout, length: stdout.length });
        } catch {
          res.json({ text: '', length: 0 });
        }
      } finally {
        try { unlinkSync(tmpPdf); } catch {}
        try { unlinkSync(tmpDir); } catch {}
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Text extraction failed', text: '' });
    }
  });
});

// ── Main Intake Endpoint ─────────────────────────────────────

router.post('/intake', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const now = localNow();

    // Expect { documents: [{ type: 'court_filing'|'field_sheet'|'info_page', text: string }] }
    const { documents, client_id } = req.body;
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'documents array required with at least one document' });
      return;
    }

    // Auto-detect document types by scanning content
    let fieldSheetText = '';
    let courtDocketText = '';
    let infoPageText = '';
    for (const d of documents) {
      const txt = d.text || '';
      const detected = d.type !== 'unknown' ? d.type : detectDocType(txt);
      if (detected === 'field_sheet' || (!fieldSheetText && detectDocType(txt) === 'field_sheet')) fieldSheetText = txt;
      else if (detected === 'court_docket' || (!courtDocketText && detectDocType(txt) === 'court_docket')) courtDocketText = txt;
      else if (detected === 'info_page' || (!infoPageText && detectDocType(txt) === 'info_page')) infoPageText = txt;
      else {
        // Unknown doc — merge into whichever is empty
        if (!fieldSheetText) fieldSheetText = txt;
        else if (!courtDocketText) courtDocketText = txt;
        else if (!infoPageText) infoPageText = txt;
      }
    }
    const allText = [fieldSheetText, courtDocketText, infoPageText].filter(Boolean).join('\n\n');

    // Extract from specific document sources with fallback to allText
    // Name: Field Sheet (Party to Serve) > Info Page (Recipient) > Court Docket (Defendant)
    const name = extractName(fieldSheetText) || extractName(infoPageText) || extractName(courtDocketText) || extractName(allText);
    // DOB: Field Sheet (Other: DOB) > Info Page (DOB:)
    const dob = extractDOB(fieldSheetText) || extractDOB(infoPageText) || extractDOB(allText);
    // Address: Field Sheet (Address line below label) — primary source
    const address = extractAddress(fieldSheetText) || extractAddress(infoPageText) || extractAddress(allText);
    // Plaintiff: Court Docket (before "Plaintiff,") > Field Sheet (Plaintiff field)
    const plaintiff = extractPlaintiff(courtDocketText) || extractPlaintiff(fieldSheetText) || extractPlaintiff(allText);
    // Court: Court Docket (JUDICIAL DISTRICT COURT) > Field Sheet (Court field)
    const court = extractCourt(courtDocketText) || extractCourt(fieldSheetText) || extractCourt(allText);
    // Documents: Field Sheet (Documents field) > Info Page
    const docs = extractDocuments(fieldSheetText) || extractDocuments(infoPageText) || extractDocuments(allText);
    // Instructions: Field Sheet (Instructions section)
    const instructions = extractServeInstructions(fieldSheetText) || extractInstructions(fieldSheetText) || extractServeInstructions(allText);
    // Job#: Field Sheet header > Info Page JOB
    const jobNumber = extractJobNumber(fieldSheetText) || extractJobNumber(infoPageText) || extractJobNumber(allText);
    // Case#: Court Docket (parenthetical) > Info Page
    const caseNumber = extractCaseNumber(courtDocketText) || extractCaseNumber(infoPageText) || extractCaseNumber(allText);
    // Due date: Field Sheet (Due:) > Info Page
    const dueDate = extractDueDate(fieldSheetText) || extractDueDate(infoPageText) || extractDueDate(allText);
    // Attorney: Court Docket header (name, phone, email, bar#)
    const attorney = extractAttorney(courtDocketText) || extractAttorney(allText);
    // Fee: Field Sheet
    const fee = extractFee(fieldSheetText) || extractFee(infoPageText) || extractFee(allText);

    if (!name.last) {
      res.status(400).json({ error: 'Could not extract defendant/recipient name from documents' });
      return;
    }

    // 1. Create or find Person
    let personId: number;
    const existing = db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1').get(name.first, name.last) as any;
    if (existing) {
      personId = existing.id;
      // Update with any new info
      if (dob) db.prepare('UPDATE persons SET dob = COALESCE(NULLIF(dob, \'\'), ?) WHERE id = ?').run(dob, personId);
      if (address) db.prepare('UPDATE persons SET address = COALESCE(NULLIF(address, \'\'), ?) WHERE id = ?').run(address, personId);
    } else {
      const result = db.prepare('INSERT INTO persons (first_name, last_name, middle_name, dob, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(name.first, name.last, name.middle, dob || null, address || null, now, now);
      personId = result.lastInsertRowid as number;
    }

    // 2. Create Property if address provided
    let propertyId: number | null = null;
    if (address) {
      const existingProp = db.prepare('SELECT id FROM properties WHERE address = ? LIMIT 1').get(address) as any;
      if (existingProp) {
        propertyId = existingProp.id;
      } else {
        // Parse city/state/zip from address
        const addrMatch = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/);
        const city = addrMatch ? addrMatch[1].trim() : '';
        const state = addrMatch ? addrMatch[2] : 'UT';
        const zip = addrMatch ? addrMatch[3] : '';
        const result = db.prepare('INSERT INTO properties (client_id, name, address, city, state, zip, property_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          client_id || 1, `${address.split(',')[0]} — ${name.last} Residence`, address, city, state, zip, 'residential', now, now
        );
        propertyId = result.lastInsertRowid as number;
      }

      // Link person to property
      try {
        db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)').run('person', personId, 'property', propertyId, 'resident', userId);
      } catch { /* already linked */ }
    }

    // 3. Geocode the address for map display
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (address) {
      try {
        const geo = await geocodeAddress(address);
        if (geo) { latitude = geo.lat; longitude = geo.lng; }
      } catch { /* geocode failed — continue without coords */ }
    }

    // Update property with coordinates
    if (propertyId && latitude && longitude) {
      db.prepare('UPDATE properties SET latitude = ?, longitude = ? WHERE id = ? AND latitude IS NULL').run(latitude, longitude, propertyId);
    }

    // 3b. Auto-resolve Section/Zone/Beat from coordinates
    let sectionId = '', zoneId = '', beatId = '', zoneBeat = '', dispatchCode = '';
    if (latitude && longitude) {
      try {
        const beat = identifyBeat(latitude, longitude);
        if (beat) {
          beatId = beat.beat_id || beat.district_letter || '';
          zoneId = beat.city_code || '';
          sectionId = beat.district_letter || '';
          zoneBeat = beat.beat_code || '';
          // Lookup dispatch district for full names
          const district = db.prepare('SELECT * FROM dispatch_districts WHERE zone_id = ? AND beat_id = ? LIMIT 1').get(zoneId, beatId) as any;
          if (district) {
            sectionId = district.section_id || sectionId;
            dispatchCode = district.dispatch_code || '';
          }
        }
      } catch { /* geofence not configured */ }
    }

    // 4. Fetch current weather for service location
    let weatherConditions = '';
    let lightingConditions = '';
    if (latitude && longitude) {
      try {
        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Denver`;
        const wxResp = await fetch(wxUrl);
        if (wxResp.ok) {
          const wx = await wxResp.json();
          const c = wx.current || {};
          const wxCodes: Record<number, string> = {
            0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
            45: 'Foggy', 48: 'Depositing rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
            55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
            66: 'Light freezing rain', 67: 'Heavy freezing rain', 71: 'Slight snow', 73: 'Moderate snow',
            75: 'Heavy snow', 77: 'Snow grains', 80: 'Slight rain showers', 81: 'Moderate rain showers',
            82: 'Violent rain showers', 85: 'Slight snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
          };
          const desc = wxCodes[c.weather_code] || 'Unknown';
          const temp = c.temperature_2m ? `${Math.round(c.temperature_2m)}°F` : '';
          const wind = c.wind_speed_10m ? `${Math.round(c.wind_speed_10m)} mph` : '';
          const humidity = c.relative_humidity_2m ? `${c.relative_humidity_2m}%` : '';
          weatherConditions = [desc, temp, wind ? `Wind ${wind}` : '', humidity ? `Humidity ${humidity}` : ''].filter(Boolean).join(', ');
        }
      } catch { /* weather fetch failed */ }

      // Determine lighting based on time of day
      const hour = new Date().getHours();
      if (hour >= 6 && hour < 8) lightingConditions = 'Dawn';
      else if (hour >= 8 && hour < 17) lightingConditions = 'Daylight';
      else if (hour >= 17 && hour < 19) lightingConditions = 'Dusk';
      else lightingConditions = 'Dark';
    }

    // 5. Build separated description (instructions only) and notes (case details)
    const serviceWindows = extractServiceWindows(allText);
    const caseNotes = extractCaseNotes(courtDocketText || allText);
    const clientAddress = extractClientAddress(fieldSheetText || allText);
    const fullName = `${name.first}${name.middle ? ' ' + name.middle : ''} ${name.last}`;
    const subjectDesc = `${fullName}${dob ? ', DOB ' + dob : ''}`;

    // description = serve instructions ONLY (what the officer needs to do)
    const descParts = instructions || 'Serve documents to subject at listed address.';

    // notes = case reference details (court, plaintiff, attorney, documents)
    const notesParts = caseNotes || '';

    // Auto-generate call number
    const year = new Date().getFullYear().toString().slice(-2);
    const lastCall = db.prepare("SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1").get(`${year}-CFS%`) as any;
    let seq = 1;
    if (lastCall) {
      const m = lastCall.call_number.match(/CFS(\d+)/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    const callNumber = `${year}-CFS${String(seq).padStart(5, '0')}`;

    const callResult = db.prepare(`
      INSERT INTO calls_for_service (
        call_number, incident_type, priority, status,
        caller_name, caller_phone, caller_relationship, caller_address,
        location_address, property_id, latitude, longitude,
        weather_conditions, lighting_conditions,
        section_id, zone_id, beat_id, zone_beat, dispatch_code,
        description, notes, source, dispatcher_id,
        subject_description,
        pso_requestor_name, pso_requestor_phone, pso_requestor_email,
        pso_service_type, pso_billing_code, pso_authorization,
        pso_attempt_number, pso_service_windows,
        process_service_type, process_served_to, process_served_address,
        process_attempts, client_id, contract_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `).run(
      callNumber, 'PSO Client Request', 'P4', 'pending',
      'ICU Investigations, LLC', '(435) 986-1200', 'client', clientAddress || null,
      address || 'Unknown', propertyId, latitude, longitude,
      weatherConditions || null, lightingConditions || null,
      sectionId || null, zoneId || null, beatId || null, zoneBeat || null, dispatchCode || null,
      descParts, notesParts || null, 'phone', userId,
      subjectDesc,
      attorney.name || null, attorney.phone || null, attorney.email || null,
      'process_service', fee || null, jobNumber || null,
      1, serviceWindows || null,
      'summons', fullName, address || null,
      0, client_id || 1, jobNumber || null,
      now, now
    );
    const callId = callResult.lastInsertRowid as number;

    // Link person to call
    try {
      db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)').run(callId, personId, 'involved', userId, now);
    } catch { /* already linked */ }

    auditLog(req, 'SERVE_INTAKE', 'calls_for_service', callId, null, { person_id: personId, property_id: propertyId, job_number: jobNumber });

    broadcastDispatchUpdate({ action: 'call_created', call: { id: callId, call_number: callNumber, incident_type: 'PSO Client Request' } });

    res.json({
      success: true,
      person_id: personId,
      property_id: propertyId,
      call_id: callId,
      call_number: callNumber,
      latitude, longitude,
      weather: weatherConditions || null,
      lighting: lightingConditions || null,
      extracted: { name, dob, address, plaintiff, court, docs, instructions, jobNumber, caseNumber, dueDate, attorney, fee },
    });
  } catch (err: any) {
    console.error('[ServeIntake] Error:', err?.message);
    res.status(500).json({ error: 'Intake processing failed: ' + (err?.message || 'Unknown error') });
  }
});

export default router;
