// ============================================================
// RMPG Flex — Process Service Intake (Advanced OCR Pipeline)
// Multi-document correlation engine that creates fully linked
// Person, Property, Vehicle, Evidence, Dispatch Call, and
// Serve Queue records from uploaded court documents.
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
import {
  detectDocType, extractVehicle, extractPhoneNumbers,
  extractSSN, extractDLNumber, correlateFields,
  calculateDocumentConfidence, normalizeDate,
} from '../utils/ocrEngine';
import type { CorrelatedField } from '../utils/ocrEngine';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

const router = Router();
router.use(authenticateToken);

// ── Helpers ─────────────────────────────────────────────────

function safeStr(v: any): string { return (v == null) ? '' : String(v); }

// ── POST /extract-text — Extract text from PDF (pdftotext) ──

router.post('/extract-text', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks);
      if (body.length < 100) { res.json({ text: '', length: 0 }); return; }

      const tmpDir = mkdtempSync(join(tmpdir(), 'serve-intake-'));
      const tmpPdf = join(tmpDir, 'input.pdf');
      writeFileSync(tmpPdf, body);

      try {
        const { stdout } = await execFileAsync('/usr/bin/pdftotext', ['-layout', tmpPdf, '-']);
        res.json({ text: stdout, length: stdout.length });
      } catch {
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

// ── POST /get-vehicle-info — Extract vehicle info from text ──

router.post('/get-vehicle-info', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text) { res.json({ vehicle: null }); return; }
    const vehicle = extractVehicle(text);
    res.json({ vehicle });
  } catch (err: any) {
    res.status(500).json({ error: 'Vehicle extraction failed' });
  }
});

// ── POST /intake — Full OCR + Multi-Document Intake Pipeline ─

router.post('/intake', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const now = localNow();

    const { documents, client_id } = req.body;
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'documents array required with at least one document' });
      return;
    }

    // ── Step 1: Create intake batch ──
    const batchResult = db.prepare(`
      INSERT INTO serve_intake_batches (user_id, client_id, status, total_documents, created_at)
      VALUES (?, ?, 'processing', ?, ?)
    `).run(userId, client_id || null, documents.length, now);
    const batchId = batchResult.lastInsertRowid as number;

    const docRows: Array<{ id: number; type: string; text: string }> = [];

    // ── Step 2: Process each document ──
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const rawText = doc.text || '';
      const docType = doc.type !== 'unknown' ? doc.type : detectDocType(rawText);

      const docInsert = db.prepare(`
        INSERT INTO serve_intake_documents (
          batch_id, original_name, mime_type, file_size_bytes,
          document_type, ocr_engine, extracted_text, ocr_confidence,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batchId, doc.filename || `document_${i + 1}`, doc.mime_type || 'text/plain',
        rawText.length, docType, 'multidocument',
        rawText.substring(0, 50000), 0, 'extracted', now,
      );

      const docId = docInsert.lastInsertRowid as number;
      docRows.push({ id: docId, type: docType, text: rawText });
    }

    // ── Step 3: Multi-document correlation ──
    const correlatedFields = correlateFields(
      docRows.map((r, idx) => ({ type: r.type, text: r.text, index: idx }))
    );
    const overallConfidence = calculateDocumentConfidence(correlatedFields);

    // Update document confidence
    for (const row of docRows) {
      db.prepare('UPDATE serve_intake_documents SET ocr_confidence = ? WHERE id = ?')
        .run(overallConfidence, row.id);
    }

    // Helper to get best correlated value
    const getField = (key: string): string => {
      const f = correlatedFields[key];
      return f?.value || '';
    };

    // ── Step 4: Split name into parts ──
    const firstName = getField('first_name');
    const lastName = getField('last_name');
    const middleName = getField('middle_name');
    const fullName = getField('full_name') || `${firstName}${middleName ? ' ' + middleName : ''} ${lastName}`.trim();

    // Resolve name from all available sources
    let defFirst = firstName;
    let defLast = lastName;
    let defMiddle = middleName;

    if (!defFirst && !defLast) {
      const defendant = getField('defendant');
      if (defendant) {
        const parts = defendant.replace(/,.*$/, '').replace(/an individual/i, '').trim().split(/\s+/);
        defFirst = parts[0] || '';
        defLast = parts[parts.length - 1] || '';
        defMiddle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
      }
    }

    if (!defLast) {
      res.status(400).json({ error: 'Could not extract defendant/recipient name from documents' });
      return;
    }

    const address = getField('address');
    const city = getField('city');
    const state = getField('state') || 'UT';
    const zipCode = getField('zip_code');
    const dob = getField('dob');
    const plaintiff = getField('plaintiff');
    const court = getField('court');
    const caseNumber = getField('case_number');
    const jobNumber = getField('job_number');
    const attorneyName = getField('attorney_name');
    const attorneyPhone = getField('attorney_phone');
    const attorneyEmail = getField('attorney_email');
    const attorneyBar = getField('attorney_bar_number');
    const instructions = getField('instructions');
    const dueDate = getField('due_date');
    const fee = getField('fee');
    const docTypeCourt = getField('document_type_court') || 'summons';
    const phoneNumbers = getField('phone_numbers');
    const ssn = getField('ssn');
    const dlNumber = getField('dl_number');

    // Vehicle data
    const vehiclePlate = getField('vehicle_plate');
    const vehicleVin = getField('vehicle_vin');
    const vehicleMake = getField('vehicle_make');
    const vehicleModel = getField('vehicle_model');
    const vehicleYear = getField('vehicle_year');
    const vehicleColor = getField('vehicle_color');
    const hasVehicle = !!(vehiclePlate || vehicleVin);

    // ── Step 5: Geocode address ──
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (address) {
      try {
        const geo = await geocodeAddress(address);
        if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
      } catch {}
    }

    // Geography resolution
    let sectionId = '', zoneId = '', beatId = '', zoneBeat = '', dispatchCode = '';
    if (latitude && longitude) {
      try {
        const beat = identifyBeat(latitude, longitude);
        if (beat) {
          beatId = beat.beat_id || beat.district_letter || '';
          zoneId = beat.city_code || '';
          sectionId = beat.district_letter || '';
          zoneBeat = beat.beat_code || '';
          const district = db.prepare(`
            SELECT db2.beat_code, dz.zone_code, ds.sector_code
            FROM dispatch_beats db2
            JOIN dispatch_zones dz ON dz.id = db2.zone_id
            JOIN dispatch_sectors ds ON ds.id = dz.sector_id
            WHERE db2.beat_code = ? LIMIT 1
          `).get(beat.beat_code) as any;
          if (district) {
            sectionId = district.sector_code || sectionId;
            zoneId = district.zone_code || zoneId;
            beatId = district.beat_code || beatId;
            dispatchCode = district.beat_code || '';
          }
        }
      } catch {}
    }

    // ── Step 6: Weather + lighting for the address ──
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
      } catch {}

      const hour = new Date().getHours();
      if (hour >= 6 && hour < 8) lightingConditions = 'Dawn';
      else if (hour >= 8 && hour < 17) lightingConditions = 'Daylight';
      else if (hour >= 17 && hour < 19) lightingConditions = 'Dusk';
      else lightingConditions = 'Dark';
    }

    // ── Step 7: Create PERSON record(s) ──
    const createdPersons: Array<{ id: number; role: string; first_name: string; last_name: string }> = [];

    // 7a: Defendant/Recipient
    let personId: number;
    const existing = db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1')
      .get(defFirst, defLast) as any;

    if (existing) {
      personId = existing.id;
      if (dob) db.prepare('UPDATE persons SET dob = COALESCE(NULLIF(dob, \'\'), ?) WHERE id = ?').run(normalizeDate(dob), personId);
      if (address) db.prepare('UPDATE persons SET address = COALESCE(NULLIF(address, \'\'), ?) WHERE id = ?').run(address, personId);
      if (phoneNumbers) db.prepare('UPDATE persons SET phone = COALESCE(NULLIF(phone, \'\'), ?) WHERE id = ?').run(phoneNumbers.split(';')[0], personId);
      if (dlNumber) db.prepare("UPDATE persons SET dl_number = COALESCE(NULLIF(dl_number, ''), ?) WHERE id = ?").run(dlNumber, personId);
    } else {
      const result = db.prepare(`INSERT INTO persons (first_name, last_name, middle_name, dob, address, phone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(defFirst, defLast, defMiddle || null, normalizeDate(dob) || null, address || null,
          phoneNumbers?.split(';')[0] || null, now, now);
      personId = result.lastInsertRowid as number;
    }
    createdPersons.push({ id: personId, role: 'defendant', first_name: defFirst, last_name: defLast });

    // 7b: Plaintiff (if found and different from defendant)
    let plaintiffPersonId: number | null = null;
    if (plaintiff && !plaintiff.toLowerCase().includes(defFirst.toLowerCase())) {
      const pParts = plaintiff.replace(/,.*$/, '').replace(/an individual/i, '').trim().split(/\s+/);
      const pFirst = pParts[0] || '';
      const pLast = pParts[pParts.length - 1] || '';
      const pMiddle = pParts.length > 2 ? pParts.slice(1, -1).join(' ') : '';

      if (pFirst && pLast) {
        const existingPl = db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1').get(pFirst, pLast) as any;
        if (existingPl) {
          plaintiffPersonId = existingPl.id;
        } else {
          const plResult = db.prepare('INSERT INTO persons (first_name, last_name, middle_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(pFirst, pLast, pMiddle || null, now, now);
          plaintiffPersonId = plResult.lastInsertRowid as number;
        }
        createdPersons.push({ id: plaintiffPersonId!, role: 'plaintiff', first_name: pFirst, last_name: pLast });
      }
    }

    // 7c: Attorney as person record
    let attorneyPersonId: number | null = null;
    if (attorneyName) {
      const aParts = attorneyName.split(/\s+/);
      const aFirst = aParts[0] || '';
      const aLast = aParts[aParts.length - 1] || '';
      if (aFirst && aLast) {
        const existingAtty = db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1').get(aFirst, aLast) as any;
        if (existingAtty) {
          attorneyPersonId = existingAtty.id;
        } else {
          const attyResult = db.prepare('INSERT INTO persons (first_name, last_name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(aFirst, aLast, `Attorney — ${attorneyBar ? `Bar#${attorneyBar}` : ''}`, now, now);
          attorneyPersonId = attyResult.lastInsertRowid as number;
        }
        createdPersons.push({ id: attorneyPersonId!, role: 'attorney', first_name: aFirst, last_name: aLast });
      }
    }

    // ── Step 8: Create PROPERTY record ──
    let propertyId: number | null = null;
    if (address) {
      const existingProp = db.prepare('SELECT id FROM properties WHERE address = ? LIMIT 1').get(address) as any;
      if (existingProp) {
        propertyId = existingProp.id;
      } else {
        const addrMatch = address.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/);
        const propCity = addrMatch ? addrMatch[1].trim() : city || '';
        const propState = addrMatch ? addrMatch[2] : state || 'UT';
        const propZip = addrMatch ? addrMatch[3] : zipCode || '';
        const result = db.prepare(`INSERT INTO properties (client_id, name, address, city, state, zip, property_type, latitude, longitude, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            client_id || 1, `${address.split(',')[0]} — ${defLast} Service Address`,
            address, propCity, propState, propZip, 'residential',
            latitude, longitude, now, now
          );
        propertyId = result.lastInsertRowid as number;
      }

      // Link person <-> property
      if (propertyId) {
        try {
          db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run('person', personId, 'property', propertyId, 'resident', userId);
        } catch {}
      }
    }

    // ── Step 9: Create VEHICLE record (if plate/VIN found) ──
    let vehicleId: number | null = null;
    if (hasVehicle) {
      // Check for existing vehicle by VIN or plate
      let existingVeh: any = null;
      if (vehicleVin) {
        existingVeh = db.prepare('SELECT id FROM vehicles_records WHERE vin = ? LIMIT 1').get(vehicleVin) as any;
      }
      if (!existingVeh && vehiclePlate) {
        existingVeh = db.prepare('SELECT id FROM vehicles_records WHERE plate_number = ? LIMIT 1').get(vehiclePlate) as any;
      }

      if (existingVeh) {
        vehicleId = existingVeh.id;
      } else {
        const vehResult = db.prepare(`INSERT INTO vehicles_records (plate_number, state, make, model, year, color, vin, owner_person_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            vehiclePlate || null, null, vehicleMake || null, vehicleModel || null,
            vehicleYear ? parseInt(vehicleYear, 10) || null : null,
            vehicleColor || null, vehicleVin || null,
            personId || null, now
          );
        vehicleId = vehResult.lastInsertRowid as number;
      }

      // Link person <-> vehicle
      if (vehicleId) {
        try {
          db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run('person', personId, 'vehicle', vehicleId, 'owner', userId);
        } catch {}
      }
    }

    // ── Step 10: Create DISPATCH CALL ──
    const year = new Date().getFullYear().toString().slice(-2);
    const lastCall = db.prepare("SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1")
      .get(`${year}-CFS%`) as any;
    let seq = 1;
    if (lastCall) {
      const m = lastCall.call_number.match(/CFS(\d+)/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    const callNumber = `${year}-CFS${String(seq).padStart(5, '0')}`;

    const callerName = attorneyName || plaintiff?.replace(/\n/g, ' ').trim() || 'Process Service Client';
    const callerPhone = attorneyPhone || '';

    // Build description
    const processType = /subpoena/i.test(docTypeCourt) ? 'subpoena'
      : /complaint/i.test(docTypeCourt) ? 'complaint'
      : /eviction|unlawful detainer/i.test(docTypeCourt) ? 'eviction'
      : /restraining|protective/i.test(docTypeCourt) ? 'restraining_order'
      : 'summons';

    const descLines: string[] = [];
    const docTypeUpper = docTypeCourt.toUpperCase() || 'DOCUMENTS';
    descLines.push(`SERVE ${docTypeUpper} TO ${fullName.toUpperCase()}`);
    if (address) descLines.push(`AT ${address.toUpperCase()}`);
    if (dueDate) descLines.push(`DUE: ${dueDate}`);
    if (instructions) {
      const cleaned = instructions.replace(/\r\n/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
      descLines.push(`INSTRUCTIONS: ${cleaned.length > 400 ? cleaned.slice(0, 400) + '...' : cleaned}`);
    }
    const descParts = descLines.join('\n');

    // Build notes as structured JSON
    const noteEntries: Array<{ id: string; author: string; text: string; timestamp: string }> = [];
    const caseParts: string[] = [];
    if (plaintiff) caseParts.push(`Plaintiff: ${plaintiff.replace(/\n/g, ' ').trim()}`);
    if (court) caseParts.push(`Court: ${court}`);
    if (caseNumber) caseParts.push(`Case #${caseNumber}`);
    if (attorneyName) caseParts.push(`Attorney: ${attorneyName}${attorneyBar ? ` Bar#${attorneyBar}` : ''}`);
    if (attorneyPhone) caseParts.push(`Attorney Tel: ${attorneyPhone}`);
    if (attorneyEmail) caseParts.push(`Attorney Email: ${attorneyEmail}`);
    if (hasVehicle) {
      const vehDesc = [vehicleYear, vehicleMake, vehicleModel, vehicleColor, `Plate:${vehiclePlate}`, `VIN:${vehicleVin}`].filter(Boolean).join(' ');
      caseParts.push(`Vehicle: ${vehDesc}`);
    }
    if (ssn) caseParts.push(`SSN: ${ssn}`);
    if (dlNumber) caseParts.push(`DL#: ${dlNumber}`);

    if (caseParts.length > 0) {
      noteEntries.push({ id: String(Date.now()), author: 'Serve Intake', text: caseParts.join('. '), timestamp: now });
    }
    if (instructions && instructions.length > 50) {
      noteEntries.push({ id: String(Date.now() + 1), author: 'Serve Intake', text: `Service Instructions: ${instructions}`, timestamp: now });
    }
    if (phoneNumbers && phoneNumbers.length > 0) {
      noteEntries.push({ id: String(Date.now() + 2), author: 'Serve Intake', text: `Phone numbers found in documents: ${phoneNumbers}`, timestamp: now });
    }
    const notesParts = noteEntries.length > 0 ? JSON.stringify(noteEntries) : null;

    const subjectDesc = `${fullName}${dob ? ', DOB ' + normalizeDate(dob) : ''}`;

    const callResult = db.prepare(`
      INSERT INTO calls_for_service (
        call_number, case_number, incident_type, priority, status,
        caller_name, caller_phone, caller_relationship,
        location_address, property_id, latitude, longitude,
        weather_conditions, lighting_conditions,
        sector_id, zone_id, beat_id, zone_beat, dispatch_code,
        description, notes, source, dispatcher_id,
        subject_description,
        pso_requestor_name, pso_requestor_phone, pso_requestor_email,
        pso_service_type, pso_billing_code, pso_authorization,
        pso_attempt_number,
        process_service_type, process_served_to, process_served_address,
        process_attempts, client_id, contract_id,
        secondary_type, contact_method,
        tags,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?,
        ?, ?
      )
    `).run(
      callNumber, caseNumber || null, 'pso_client_request', 'P4', 'pending',
      callerName, callerPhone, 'client',
      address || 'Unknown', propertyId, latitude, longitude,
      weatherConditions || null, lightingConditions || null,
      sectionId || null, zoneId || null, beatId || null, zoneBeat || null, dispatchCode || null,
      descParts, notesParts, 'intake', userId,
      subjectDesc,
      attorneyName || callerName, attorneyPhone || null, attorneyEmail || null,
      'process_service', fee || null, jobNumber || null,
      1,
      processType, fullName, address || null,
      0, client_id || 1, jobNumber || null,
      docTypeUpper, 'email',
      JSON.stringify(['serve_intake', `batch:${batchId}`]),
      now, now
    );
    const callId = callResult.lastInsertRowid as number;

    // ── Step 11: Create EVIDENCE records for documents ──
    const createdEvidenceIds: number[] = [];
    try {
      // Use the dispatch call as the incident holder for evidence
      for (let i = 0; i < docRows.length; i++) {
        const evResult = db.prepare(`
          INSERT INTO evidence (incident_id, description, evidence_type, status, collected_by, created_at)
          VALUES (?, ?, ?, 'in_storage', ?, ?)
        `).run(
          callId,
          `Serve Intake Document — ${docRows[i].type} (batch ${batchId}, doc ${docRows[i].id})`,
          'document', userId, now,
        );
        const evId = evResult.lastInsertRowid as number;
        createdEvidenceIds.push(evId);

        // Link evidence -> person
        try {
          db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run('evidence', evId, 'person', personId, 'associated_document', userId);
        } catch {}

        // Update document record with evidence ID
        db.prepare('UPDATE serve_intake_documents SET evidence_id = ? WHERE id = ?').run(evId, docRows[i].id);
      }
    } catch (evErr: any) {
      logger.warn({ err: evErr, batchId }, 'Evidence creation failed (non-fatal)');
    }

    // ── Step 12: Link everything ──

    // Person <-> Call
    try {
      db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(callId, personId, 'involved',
          `Defendant/Recipient — Intake batch ${batchId}`, userId, now);
    } catch {}

    if (plaintiffPersonId) {
      try {
        db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(callId, plaintiffPersonId, 'reporter',
            `Plaintiff — Intake batch ${batchId}`, userId, now);
      } catch {}
    }

    if (attorneyPersonId) {
      try {
        db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(callId, attorneyPersonId, 'attorney',
            `Attorney for Plaintiff — Intake batch ${batchId}`, userId, now);
      } catch {}
    }

    // Vehicle <-> Call
    if (vehicleId) {
      try {
        db.prepare('INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(callId, vehicleId, 'involved',
            `Vehicle associated with defendant — Intake batch ${batchId}`, userId, now);
      } catch {}
    }

    // Person <-> Person links (defendant <-> plaintiff, etc.)
    if (plaintiffPersonId) {
      try {
        db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .run('person', plaintiffPersonId, 'person', personId, 'plaintiff_vs_defendant', userId);
      } catch {}
    }

    // Evidence <-> Call
    for (const evId of createdEvidenceIds) {
      try {
        db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)')
          .run('evidence', evId, 'property', propertyId || 0, 'served_at_property', userId);
      } catch {}
      try {
        db.prepare('INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run('person', personId, 'evidence', evId, 'subject_of_document', userId, fullName);
      } catch {}
    }

    // ── Step 13: Create SERVE QUEUE entry ──
    let serveQueueId: number | null = null;
    try {
      const addrCapped = address ? String(address).slice(0, 1000) : null;
      const addrMatch = addrCapped ? addrCapped.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/) : null;

      const windowLabels: string[] = [];
      if (/6AM-9AM|6am.*9am/i.test(instructions)) windowLabels.push('6AM-9AM');
      if (/9AM-6PM|9am.*6pm/i.test(instructions)) windowLabels.push('9AM-6PM');
      if (/6PM-9PM|6pm.*9pm/i.test(instructions)) windowLabels.push('6PM-9PM');
      if (/weekend/i.test(instructions)) windowLabels.push('Weekend');
      const serviceWindows = windowLabels.join(', ');

      const sqResult = db.prepare(`
        INSERT INTO serve_queue (
          call_id, recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
          recipient_lat, recipient_lng, document_type, case_number, court_name,
          client_name, attorney_name, priority, deadline, service_instructions, notes,
          sm_job_id, status, created_at, updated_at,
          recipient_person_id, property_id, intake_batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId, fullName, address || null,
        addrMatch ? addrMatch[1].trim() : city || null,
        addrMatch ? addrMatch[2] : state || 'UT',
        addrMatch ? addrMatch[3] : zipCode || null,
        latitude, longitude,
        processType, caseNumber || null, court || null,
        plaintiff?.replace(/\n/g, ' ').trim() || null, attorneyName || null,
        'normal', dueDate || null, instructions || null, caseParts.join('. ') || null,
        jobNumber || null, 'pending', now, now,
        personId, propertyId, batchId,
      );
      serveQueueId = sqResult.lastInsertRowid as number;
    } catch (sqErr: any) {
      logger.error({ err: sqErr, batchId }, 'Serve queue creation error (non-fatal)');
    }

    // ── Step 14: Update batch with results ──
    const docIds = docRows.map(r => r.id);
    db.prepare(`
      UPDATE serve_intake_batches SET
        status = 'completed',
        persons_created = ?,
        properties_created = ?,
        vehicles_created = ?,
        dispatch_call_id = ?,
        serve_queue_id = ?,
        batch_result = ?
      WHERE id = ?
    `).run(
      createdPersons.length,
      propertyId ? 1 : 0,
      vehicleId ? 1 : 0,
      callId, serveQueueId,
      JSON.stringify({
        person_ids: createdPersons.map(p => p.id),
        property_id: propertyId,
        vehicle_id: vehicleId,
        evidence_ids: createdEvidenceIds,
        document_ids: docIds,
      }),
      batchId,
    );

    // Update serve queue document IDs
    if (serveQueueId) {
      db.prepare('UPDATE serve_queue SET intake_document_ids = ? WHERE id = ?')
        .run(JSON.stringify(docIds), serveQueueId);
    }

    auditLog(req, 'SERVE_INTAKE', 'serve_intake_batches', batchId, JSON.stringify({
      person_ids: createdPersons.map(p => p.id),
      property_id: propertyId,
      vehicle_id: vehicleId,
      evidence_ids: createdEvidenceIds,
      call_id: callId,
      serve_queue_id: serveQueueId,
    }));

    broadcastDispatchUpdate({ action: 'call_created', call: { id: callId, call_number: callNumber, incident_type: 'pso_client_request' } });

    res.json({
      success: true,
      batch_id: batchId,
      person_id: personId,
      persons: createdPersons,
      property_id: propertyId,
      vehicle_id: vehicleId,
      evidence_ids: createdEvidenceIds,
      call_id: callId,
      call_number: callNumber,
      serve_queue_id: serveQueueId,
      latitude, longitude,
      confidence: overallConfidence,
      weather: weatherConditions || null,
      lighting: lightingConditions || null,
      correlated_fields: Object.fromEntries(
        Object.entries(correlatedFields).map(([k, v]) => [k, { value: v.value, confidence: v.confidence, source: v.source }])
      ),
      extracted: {
        name: { first: defFirst, middle: defMiddle, last: defLast },
        fullName,
        dob: normalizeDate(dob) || '',
        address, city, state: state || 'UT', zip: zipCode || '',
        plaintiff, court, docs: docTypeCourt,
        instructions, jobNumber, caseNumber, dueDate,
        attorney: { name: attorneyName, phone: attorneyPhone, email: attorneyEmail, bar: attorneyBar },
        fee, phoneNumbers, ssn, dlNumber,
        processType,
        vehicle: hasVehicle ? { plate: vehiclePlate, vin: vehicleVin, make: vehicleMake, model: vehicleModel, year: vehicleYear, color: vehicleColor } : null,
      },
    });
  } catch (err: any) {
    logger.error({ err }, 'Serve intake pipeline error');
    res.status(500).json({ error: 'Intake processing failed: ' + (err?.message || 'Unknown error') });
  }
});

export default router;
