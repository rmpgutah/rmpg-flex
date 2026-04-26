// ============================================================
// RMPG Flex — Process Service Intake
// Parses uploaded PDF documents (Court Docket, Field Sheet,
// Information Sheet) and fans out into persons, properties,
// cases, calls_for_service, call_persons, record_links,
// serve_queue, and serve_attempts.
// All extraction lives in utils/serveIntakeHelpers.ts.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { broadcastDispatchUpdate } from '../utils/websocket';
import { geocodeAddress } from '../utils/geocode';
import { identifyBeat } from '../utils/geofence';
import {
  parseAllDocuments,
  parseAddressParts,
  buildNotesNarrative,
  computeDiligenceSchedule,
  classifyEntityType,
  type ParseOutput,
} from '../utils/serveIntakeHelpers';
import { buildEnrichment } from '../utils/serveIntakeEnrichment';
import { synthesizeCaseSynopsis } from '../utils/caseSynopsis';
import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const router = Router();
router.use(authenticateToken);

// ── Auto-detect document kind by content ─────────────────────
function detectDocType(text: string): 'court_docket' | 'field_sheet' | 'info_sheet' | 'unknown' {
  if (/SUMMONS|COMPLAINT|Attorney for Plaintiff|JUDICIAL DISTRICT COURT/i.test(text)) return 'court_docket';
  if (/Party to Serve|Instructions\s*\n[\s\S]*?Sub-serve|Date & Time.*Description of Service/i.test(text)) return 'field_sheet';
  if (/^JOB\b/im.test(text) || /Service Attempts|Recipient:|Job Activity|Af\s*fi\s*davits/i.test(text)) return 'info_sheet';
  return 'unknown';
}

function getLogger(req: Request): { warn: (...a: any[]) => void; error: (...a: any[]) => void; info: (...a: any[]) => void } {
  return (req as any).log || { warn: console.warn.bind(console), error: console.error.bind(console), info: console.info.bind(console) };
}

function utcOffsetHoursForZone(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(date).find(p => p.type === 'timeZoneName')?.value ?? '';
  const m = part.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const minutes = parseInt(m[3] || '0', 10);
  return sign * (hours + minutes / 60);
}

// ── PDF binary → text (pdftotext) ───────────────────────────
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
      // Try both pdftotext modes and pick the one with more useful content
      let layoutText = '';
      let rawText = '';
      try {
        const r1 = await execFileAsync('/usr/bin/pdftotext', ['-layout', tmpPdf, '-']);
        layoutText = r1.stdout || '';
      } catch { /* layout mode failed */ }
      try {
        const r2 = await execFileAsync('/usr/bin/pdftotext', [tmpPdf, '-']);
        rawText = r2.stdout || '';
      } catch { /* raw mode failed */ }

      // Pick the better result:
      // - Layout mode preserves column structure (good for ICU field sheets)
      // - Raw mode avoids column bleed (good for court dockets)
      // - Use layout if it has structured labels, otherwise use the longer one
      const hasStructuredLabels = /Party to Serve|Instructions|Documents|Plaintiff|Defendant/i.test(layoutText);
      const text = hasStructuredLabels ? layoutText : (layoutText.length >= rawText.length ? layoutText : rawText);
      // Cleanup temp files
      try { unlinkSync(tmpPdf); } catch { /* ignore */ }
      try { require('fs').rmdirSync(tmpDir); } catch { /* ignore */ }
      res.json({ text, length: text.length });
    } catch {
      res.status(500).json({ error: 'Text extraction failed', text: '' });
    }
  });
});

// ── Helpers shared by the intake route ──────────────────────
function upsertPerson(
  db: ReturnType<typeof getDb>,
  userId: number,
  now: string,
  info: { first: string; middle: string; last: string; dob?: string; address?: string; phone?: string; email?: string; role: string; entityType: 'individual' | 'organization'; bar?: string; firm?: string },
): number {
  const existing = db.prepare(
    'SELECT id FROM persons WHERE first_name = ? AND last_name = ? AND (dob IS NULL OR dob = \'\' OR ? = \'\' OR dob = ?) LIMIT 1'
  ).get(info.first, info.last, info.dob || '', info.dob || '') as any;
  if (existing) {
    if (info.dob) db.prepare("UPDATE persons SET dob = COALESCE(NULLIF(dob,''), ?) WHERE id = ?").run(info.dob, existing.id);
    if (info.address) db.prepare("UPDATE persons SET address = COALESCE(NULLIF(address,''), ?) WHERE id = ?").run(info.address, existing.id);
    if (info.phone) db.prepare("UPDATE persons SET phone = COALESCE(NULLIF(phone,''), ?) WHERE id = ?").run(info.phone, existing.id);
    if (info.email) db.prepare("UPDATE persons SET email = COALESCE(NULLIF(email,''), ?) WHERE id = ?").run(info.email, existing.id);
    if (info.role) db.prepare("UPDATE persons SET role_tag = COALESCE(NULLIF(role_tag,''), ?), entity_type = COALESCE(NULLIF(entity_type,''), ?) WHERE id = ?")
      .run(info.role, info.entityType, existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO persons (
      first_name, middle_name, last_name, dob, address,
      phone, email, role_tag, entity_type, bar_number, firm_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    info.first, info.middle || null, info.last, info.dob || null, info.address || null,
    info.phone || null, info.email || null, info.role, info.entityType, info.bar || null, info.firm || null,
    now, now,
  );
  return Number(result.lastInsertRowid);
}

function nextCallNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear().toString().slice(-2);
  const last = db.prepare("SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`${year}-CFS%`) as any;
  let seq = 1;
  if (last) {
    const m = String(last.call_number).match(/CFS(\d+)/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${year}-CFS${String(seq).padStart(5, '0')}`;
}

function nextCaseNumber(db: ReturnType<typeof getDb>): string {
  const year = new Date().getFullYear().toString().slice(-2);
  const last = db.prepare("SELECT case_number FROM cases WHERE case_number LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`CV-${year}-%`) as any;
  let seq = 1;
  if (last) {
    const m = String(last.case_number).match(/CV-\d{2}-(\d+)/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `CV-${year}-${String(seq).padStart(5, '0')}`;
}

// ── Parse-only preview (no record creation) ─────────────────
// Returns extracted data for review/editing before committing to DB.
// Client calls this first, lets user correct mistakes, then POSTs /intake with overrides.
router.post('/parse', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  try {
    const { documents } = req.body;
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'documents array required' });
      return;
    }

    // Multiple court dockets are common (Summons + Complaint + Exhibits).
    // Concatenate all court_docket texts so the parser sees the full packet.
    let fieldSheet = '';
    const courtDocketParts: string[] = [];
    let infoSheet = '';
    for (const d of documents) {
      const txt = (d?.text || '') as string;
      if (!txt) continue;
      let kind = d.type as string | undefined;
      if (!kind || kind === 'unknown') kind = detectDocType(txt);
      if (kind === 'court_filing') kind = 'court_docket';
      if (kind === 'info_page') kind = 'info_sheet';
      if (kind === 'field_sheet') { if (!fieldSheet) fieldSheet = txt; }
      else if (kind === 'court_docket') { courtDocketParts.push(txt); }
      else if (kind === 'info_sheet') { if (!infoSheet) infoSheet = txt; }
      else {
        if (!fieldSheet) fieldSheet = txt;
        else if (courtDocketParts.length === 0) courtDocketParts.push(txt);
        else if (!infoSheet) infoSheet = txt;
        else courtDocketParts.push(txt); // additional unknown docs → treat as court material
      }
    }
    const courtDocket = courtDocketParts.join('\n\n--- DOCUMENT SEPARATOR ---\n\n');

    const parsed = parseAllDocuments({ fieldSheet, infoSheet, courtDocket });

    // Check for duplicate defendant
    const db = getDb();
    let duplicateWarning: string | null = null;
    if (parsed.defendant.last) {
      const existing = db.prepare(
        "SELECT id, first_name, last_name FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1"
      ).get(parsed.defendant.first, parsed.defendant.last) as any;
      if (existing) {
        duplicateWarning = `Person "${existing.first_name} ${existing.last_name}" already exists (ID: ${existing.id}). Record will be updated, not duplicated.`;
      }
    }

    // Check for active serve on same address
    let activeServeWarning: string | null = null;
    if (parsed.address) {
      const activeSQ = db.prepare(
        "SELECT id, recipient_name FROM serve_queue WHERE recipient_address = ? AND status IN ('pending', 'in_progress') LIMIT 1"
      ).get(parsed.address) as any;
      if (activeSQ) {
        activeServeWarning = `Active serve already exists at this address for "${activeSQ.recipient_name}" (Queue #${activeSQ.id}).`;
      }
    }

    // Geocode during parse so the review step can show/fix coordinates
    let geocodeResult: { latitude: number; longitude: number } | null = null;
    let geocodeWarning: string | null = null;
    if (parsed.address) {
      try {
        const geo = await geocodeAddress(parsed.address);
        if (geo) {
          geocodeResult = { latitude: geo.latitude, longitude: geo.longitude };
        } else {
          geocodeWarning = `Geocoding returned no result for "${parsed.address}" — please verify the address or enter coordinates manually.`;
        }
      } catch {
        geocodeWarning = `Geocoding failed for "${parsed.address}" — enter coordinates manually if map placement is needed.`;
      }
    }

    // ── Confidence scoring — rate extraction quality per field ──
    const confidence: Record<string, { score: number; source: string }> = {};
    const rate = (field: string, value: string | undefined | null, preferredSource: string, fallbackSource?: string) => {
      if (!value) { confidence[field] = { score: 0, source: 'not found' }; return; }
      // Higher score = more likely correct
      if (preferredSource === 'field_sheet') confidence[field] = { score: 95, source: 'Field Sheet (structured)' };
      else if (preferredSource === 'info_sheet') confidence[field] = { score: 85, source: 'Info Sheet (labeled)' };
      else if (preferredSource === 'court_docket') confidence[field] = { score: 80, source: 'Court Docket (pattern)' };
      else if (preferredSource === 'scanner') confidence[field] = { score: 60, source: 'Universal Scanner (fallback)' };
      else confidence[field] = { score: 70, source: fallbackSource || 'extracted' };
    };

    rate('defendant', parsed.defendant.first || parsed.defendant.last, fieldSheet && /Party to Serve/i.test(fieldSheet) ? 'field_sheet' : infoSheet && /Recipient/i.test(infoSheet) ? 'info_sheet' : 'court_docket');
    rate('address', parsed.address, fieldSheet && parsed.address && fieldSheet.includes(parsed.address.split(',')[0]) ? 'field_sheet' : 'scanner');
    rate('plaintiff', parsed.plaintiff, fieldSheet && /Plaintiff/i.test(fieldSheet) && parsed.plaintiff ? 'field_sheet' : infoSheet && /Plaintiff/i.test(infoSheet) ? 'info_sheet' : 'court_docket');
    rate('court', parsed.court, fieldSheet && /Court/i.test(fieldSheet) && parsed.court ? 'field_sheet' : 'court_docket');
    rate('courtCaseNumber', parsed.courtCaseNumber, fieldSheet && /Case/i.test(fieldSheet) ? 'field_sheet' : 'court_docket');
    rate('attorney', parsed.attorney.name, parsed.attorney.barNumber ? 'court_docket' : parsed.attorney.name ? 'scanner' : '');
    rate('dueDate', parsed.dueDate, fieldSheet && /Due/i.test(fieldSheet) ? 'field_sheet' : 'info_sheet');
    rate('instructions', parsed.instructions, fieldSheet && /Instructions/i.test(fieldSheet) ? 'field_sheet' : 'scanner');
    rate('documents', parsed.documents, fieldSheet && /Documents/i.test(fieldSheet) ? 'field_sheet' : 'info_sheet');
    rate('jobNumber', parsed.jobNumber, fieldSheet && /Job/i.test(fieldSheet) ? 'field_sheet' : 'info_sheet');

    // Overall confidence = average of all non-zero scores
    const scores = Object.values(confidence).filter(c => c.score > 0).map(c => c.score);
    const overallConfidence = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    res.json({
      parsed,
      confidence,
      overallConfidence,
      detectedTypes: {
        fieldSheet: !!fieldSheet,
        courtDocket: courtDocketParts.length > 0,
        courtDocketCount: courtDocketParts.length,
        infoSheet: !!infoSheet,
      },
      geocode: geocodeResult,
      warnings: [duplicateWarning, activeServeWarning, geocodeWarning].filter(Boolean),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Parse failed: ' + (err?.message || 'Unknown error') });
  }
});

// ── Main intake ──────────────────────────────────────────────
router.post('/intake', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  const log = getLogger(req);
  const warnings: string[] = [];
  try {
    const db = getDb();
    const userId = req.user!.userId as number;
    const now = localNow();

    const { documents, overrides } = req.body;
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'documents array required with at least one document' });
      return;
    }
    // overrides: optional user corrections from the review step
    // { defendant?: {first,middle,last,dob}, address?, plaintiff?, dueDate?, instructions? }

    // Bin documents by type — multiple court dockets are concatenated
    let fieldSheet = '';
    const courtDocketParts: string[] = [];
    let infoSheet = '';
    for (const d of documents) {
      const txt = (d?.text || '') as string;
      if (!txt) continue;
      let kind = d.type as string | undefined;
      if (!kind || kind === 'unknown') kind = detectDocType(txt);
      if (kind === 'court_filing') kind = 'court_docket';
      if (kind === 'info_page') kind = 'info_sheet';
      if (kind === 'field_sheet') { if (!fieldSheet) fieldSheet = txt; }
      else if (kind === 'court_docket') { courtDocketParts.push(txt); }
      else if (kind === 'info_sheet') { if (!infoSheet) infoSheet = txt; }
      else {
        if (!fieldSheet) fieldSheet = txt;
        else if (courtDocketParts.length === 0) courtDocketParts.push(txt);
        else if (!infoSheet) infoSheet = txt;
        else courtDocketParts.push(txt);
      }
    }
    const courtDocket = courtDocketParts.join('\n\n--- DOCUMENT SEPARATOR ---\n\n');

    const parsed: ParseOutput = parseAllDocuments({ fieldSheet, infoSheet, courtDocket });

    // Apply ALL user overrides from review step
    if (overrides) {
      if (overrides.defendant) {
        if (overrides.defendant.first) parsed.defendant.first = overrides.defendant.first;
        if (overrides.defendant.middle !== undefined) parsed.defendant.middle = overrides.defendant.middle;
        if (overrides.defendant.last) parsed.defendant.last = overrides.defendant.last;
        if (overrides.defendant.dob) parsed.defendant.dob = overrides.defendant.dob;
      }
      if (overrides.address) {
        (parsed as any).address = overrides.address;
        (parsed as any).addressParts = parseAddressParts(overrides.address);
      }
      if (overrides.plaintiff !== undefined) parsed.plaintiff = overrides.plaintiff;
      if (overrides.dueDate !== undefined) (parsed as any).dueDate = overrides.dueDate;
      if (overrides.instructions !== undefined) parsed.instructions = overrides.instructions;
      if (overrides.court !== undefined) parsed.court = overrides.court;
      if (overrides.courtAddress !== undefined) parsed.courtAddress = overrides.courtAddress;
      if (overrides.county !== undefined) (parsed as any).county = overrides.county;
      if (overrides.courtCaseNumber !== undefined) parsed.courtCaseNumber = overrides.courtCaseNumber;
      if (overrides.jobNumber !== undefined) parsed.jobNumber = overrides.jobNumber;
      if (overrides.clientJobNumber !== undefined) parsed.clientJobNumber = overrides.clientJobNumber;
      if (overrides.documents !== undefined) (parsed as any).documents = overrides.documents;
      if (overrides.serviceType !== undefined) (parsed as any).serviceType = overrides.serviceType;
      if (overrides.serviceWindows !== undefined) (parsed as any).serviceWindows = overrides.serviceWindows;
      if (overrides.signedDate !== undefined) parsed.signedDate = overrides.signedDate;
      if (overrides.responseDeadlineDays !== undefined) parsed.responseDeadlineDays = parseInt(overrides.responseDeadlineDays, 10) || 21;
      if (overrides.clerkPhone !== undefined) parsed.clerkPhone = overrides.clerkPhone;
      if (overrides.documentPages !== undefined) parsed.documentPages = parseInt(overrides.documentPages, 10) || 0;
      if (overrides.bilingual !== undefined) parsed.bilingual = !!overrides.bilingual;
      if (overrides.attorney) {
        if (overrides.attorney.name !== undefined) parsed.attorney.name = overrides.attorney.name;
        if (overrides.attorney.firm !== undefined) parsed.attorney.firm = overrides.attorney.firm;
        if (overrides.attorney.barNumber !== undefined) parsed.attorney.barNumber = overrides.attorney.barNumber;
        if (overrides.attorney.tel !== undefined) parsed.attorney.tel = overrides.attorney.tel;
        if (overrides.attorney.email !== undefined) parsed.attorney.email = overrides.attorney.email;
        if (overrides.attorney.fax !== undefined) parsed.attorney.fax = overrides.attorney.fax;
      }
    }

    if (!parsed.defendant.last) {
      res.status(400).json({ error: 'Could not extract defendant/recipient name from documents' });
      return;
    }

    // ── Client lookup (user-selected > vendor fingerprint > name match > fallback)
    let vendorClient: any = null;
    // If user explicitly selected a client in the review step, use that
    if (overrides?.client_id) {
      vendorClient = db.prepare(
        "SELECT id, name, billing_code, requestor_email, caller_phone, address FROM clients WHERE id = ? LIMIT 1"
      ).get(overrides.client_id);
    }
    // Otherwise auto-detect from document fingerprint
    if (!vendorClient && parsed.vendorFingerprint) {
      vendorClient = db.prepare(
        "SELECT id, name, billing_code, requestor_email, caller_phone, address FROM clients WHERE vendor_fingerprint = ? LIMIT 1"
      ).get(parsed.vendorFingerprint);
    }
    if (!vendorClient) {
      vendorClient = db.prepare(
        "SELECT id, name, billing_code, requestor_email, caller_phone, address FROM clients WHERE LOWER(name) LIKE LOWER(?) LIMIT 1"
      ).get('%ICU Investigations%');
    }
    if (!vendorClient) {
      warnings.push(`No client matched — using fallback (client_id=1)`);
    }
    const clientId: number = vendorClient?.id ?? 1;
    const callerName: string = vendorClient?.name || 'Process Service Client';
    const callerPhone: string = vendorClient?.caller_phone || '';
    const billingCode: string | null = vendorClient?.billing_code || null;
    const requestorEmail: string | null = vendorClient?.requestor_email || null;
    const callerAddress: string = vendorClient?.address || '';

    // ── Persons: defendant (subject), plaintiff (complainant), attorney (reporting_party)
    const defendantId = upsertPerson(db, userId, now, {
      first: parsed.defendant.first,
      middle: parsed.defendant.middle,
      last: parsed.defendant.last,
      dob: parsed.defendant.dob,
      address: parsed.address,
      role: 'defendant',
      entityType: classifyEntityType(`${parsed.defendant.first} ${parsed.defendant.last}`),
    });

    let plaintiffId: number | null = null;
    if (parsed.plaintiff) {
      const pEntity = classifyEntityType(parsed.plaintiff);
      if (pEntity === 'organization') {
        plaintiffId = upsertPerson(db, userId, now, {
          first: parsed.plaintiff.slice(0, 120),
          middle: '',
          last: '(Organization)',
          role: 'plaintiff',
          entityType: 'organization',
        });
      } else {
        const parts = parsed.plaintiff.trim().split(/\s+/);
        plaintiffId = upsertPerson(db, userId, now, {
          first: parts[0] || parsed.plaintiff,
          middle: parts.length >= 3 ? parts.slice(1, -1).join(' ') : '',
          last: parts.length >= 2 ? parts[parts.length - 1] : '',
          role: 'plaintiff',
          entityType: 'individual',
        });
      }
    }

    let attorneyId: number | null = null;
    if (parsed.attorney.name) {
      const aParts = parsed.attorney.name.trim().split(/\s+/);
      attorneyId = upsertPerson(db, userId, now, {
        first: aParts[0] || parsed.attorney.name,
        middle: aParts.length >= 3 ? aParts.slice(1, -1).join(' ') : '',
        last: aParts.length >= 2 ? aParts[aParts.length - 1] : '',
        phone: parsed.attorney.tel,
        email: parsed.attorney.email,
        role: 'attorney',
        entityType: 'individual',
        bar: parsed.attorney.barNumber,
        firm: parsed.attorney.firm,
      });
    }

    // ── Property (named by street address, not defendant name) ──
    let propertyId: number | null = null;
    if (parsed.address) {
      const ap = parsed.addressParts;
      // Use the street address as property name (e.g. "5245 SOUTH COLLEGE DRIVE")
      // NOT "Lastname Residence — Building#" which is meaningless for dispatch
      const streetPart = (parsed.address.split(',')[0] || '').trim().toUpperCase();
      const propName = streetPart || `${ap.building} ${ap.street}`.trim() || parsed.address;
      const existingProp = db.prepare('SELECT id FROM properties WHERE address = ? LIMIT 1').get(parsed.address) as any;
      if (existingProp) {
        propertyId = existingProp.id;
      } else {
        const pr = db.prepare(`
          INSERT INTO properties (
            client_id, name, address, city, state, zip, property_type, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          clientId, propName, parsed.address,
          ap.city || null, ap.state || 'UT', ap.zip || null,
          'residential', now, now,
        );
        propertyId = Number(pr.lastInsertRowid);
      }
      // Link defendant → property (resident)
      try {
        db.prepare(`
          INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('person', defendantId, 'property', propertyId, 'resident', userId);
      } catch (err) {
        log.warn({ err }, 'record_links person→property failed');
      }
    }

    // ── Geocode + beat lookup (user override takes priority) ──
    let latitude: number | null = overrides?.latitude != null ? parseFloat(overrides.latitude) || null : null;
    let longitude: number | null = overrides?.longitude != null ? parseFloat(overrides.longitude) || null : null;
    // Only geocode if user didn't manually provide coordinates
    if (!latitude && !longitude && parsed.address) {
      try {
        const geo = await geocodeAddress(parsed.address);
        if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
        else {
          warnings.push('Geocoding returned no result — map placement may be inaccurate');
          log.warn({ address: parsed.address }, 'geocodeAddress returned null');
        }
      } catch (err) {
        warnings.push('Geocoding failed');
        log.warn({ err, address: parsed.address }, 'geocodeAddress threw');
      }
    }

    if (propertyId && latitude && longitude) {
      db.prepare('UPDATE properties SET latitude = ?, longitude = ? WHERE id = ? AND latitude IS NULL')
        .run(latitude, longitude, propertyId);
    }

    let sectorCode = '', zoneCode = '', beatCode = '', dispatchCode = '';
    let sectorName = '', zoneName = '', beatName = '';
    if (latitude && longitude) {
      try {
        const beat = identifyBeat(latitude, longitude);
        if (beat) {
          beatCode = (beat as any).beat_code || '';
          try {
            const district = db.prepare(`
              SELECT db2.beat_code, db2.name AS beat_name,
                     dz.zone_code, dz.name AS zone_name,
                     ds.sector_code, ds.name AS sector_name
              FROM dispatch_beats db2
              JOIN dispatch_zones dz ON dz.id = db2.zone_id
              JOIN dispatch_sectors ds ON ds.id = dz.sector_id
              WHERE db2.beat_code = ? LIMIT 1
            `).get(beatCode) as any;
            if (district) {
              sectorCode = district.sector_code || '';
              zoneCode = district.zone_code || '';
              beatCode = district.beat_code || beatCode;
              sectorName = district.sector_name || '';
              zoneName = district.zone_name || '';
              beatName = district.beat_name || '';
              dispatchCode = district.beat_code || '';
            }
          } catch (err) {
            log.warn({ err, beatCode }, 'dispatch geography join failed');
          }
        } else {
          warnings.push('No beat match for coordinates');
        }
      } catch (err) {
        warnings.push('Beat identification failed');
        log.warn({ err, latitude, longitude }, 'identifyBeat threw');
      }
    }

    // ── Weather + lighting ──────────────────────────────────
    let weatherConditions = '';
    let lightingConditions = '';
    if (latitude && longitude) {
      try {
        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/Denver`;
        const wxResp = await fetch(wxUrl);
        if (wxResp.ok) {
          const wx: any = await wxResp.json();
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
        } else {
          warnings.push('Weather API returned non-OK');
        }
      } catch (err) {
        warnings.push('Weather fetch failed');
        log.warn({ err }, 'open-meteo fetch failed');
      }
      const hour = new Date().getHours();
      if (hour >= 6 && hour < 8) lightingConditions = 'Dawn';
      else if (hour >= 8 && hour < 17) lightingConditions = 'Daylight';
      else if (hour >= 17 && hour < 19) lightingConditions = 'Dusk';
      else lightingConditions = 'Dark';
    }

    // ── Diligence schedule (3 attempts) ─────────────────────
    let dueDateObj: Date | null = null;
    if (parsed.dueDate) {
      const m = parsed.dueDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) dueDateObj = new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10), 23, 59, 59);
    }
    const utahOffsetHours = utcOffsetHoursForZone(new Date(), 'America/Denver');
    const schedule = dueDateObj ? computeDiligenceSchedule(dueDateObj, new Date(), utahOffsetHours) : [];
    if (parsed.dueDate && schedule.length === 0) warnings.push('Diligence schedule empty (due date may be in the past)');

    const daysRemaining = dueDateObj ? Math.max(0, Math.ceil((dueDateObj.getTime() - Date.now()) / 86_400_000)) : 0;

    // ── Civil case ───────────────────────────────────────────
    const caseNumber = nextCaseNumber(db);
    const linkedPersonsArr = [defendantId, plaintiffId, attorneyId].filter((x): x is number => x != null);
    const caseTitle = `${parsed.plaintiff || 'Plaintiff'} v. ${parsed.defendant.first} ${parsed.defendant.last}`.slice(0, 200);
    const caseResult = db.prepare(`
      INSERT INTO cases (
        case_number, title, case_type, status, priority,
        plaintiff_person_id, defendant_person_id, attorney_person_id,
        court_case_number, linked_persons,
        signed_filed_date, response_deadline_days,
        due_date, summary, narrative,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      caseNumber, caseTitle, 'civil_process', 'open', 'normal',
      plaintiffId, defendantId, attorneyId,
      parsed.courtCaseNumber || parsed.clientJobNumber || null,
      JSON.stringify(linkedPersonsArr),
      parsed.signedDate || null, parsed.responseDeadlineDays || null,
      parsed.dueDate || null,
      `${parsed.serviceType}: ${parsed.documents}`.slice(0, 500),
      parsed.instructions || '',
      userId, now, now,
    );
    const caseId = Number(caseResult.lastInsertRowid);

    // ── Intake enrichment — adds prior-contact intelligence, risk flags,
    // address history, adjacent serves, structured diligence tracker, and
    // closest-unit suggestion to the dispatch record. Best-effort: each
    // sub-query catches its own errors and degrades gracefully.
    const enrichment = buildEnrichment({
      db,
      defendant: { first: parsed.defendant.first, middle: parsed.defendant.middle, last: parsed.defendant.last, dob: parsed.defendant.dob },
      address: parsed.address,
      latitude,
      longitude,
      defendantPersonId: defendantId,
      dueDate: parsed.dueDate || null,
      serviceWindowsLabel: parsed.serviceWindows || '',
    });

    // ── Auto-synopsis: plain-English brief of what the case is, so the
    // PSO understands the document at a glance without reading the PDF.
    const synopsis = synthesizeCaseSynopsis({
      courtDocket,
      plaintiff: parsed.plaintiff,
      defendantFirst: parsed.defendant.first,
      defendantLast: parsed.defendant.last,
      primaryDoc: parsed.primaryDoc,
      documents: parsed.documents,
      responseDeadlineDays: parsed.responseDeadlineDays,
      court: parsed.court,
    });

    // ── Notes narrative — 3 consolidated notes:
    //   1. 🚨 OFFICER BRIEFING (alert + 3-day diligence plan + door approach)
    //   2. 📂 CASE PACKET (case + court + attorney + auto-synopsis)
    //   3. 👤 SUBJECT & ADDRESS DOSSIER (enrichment + verbatim instructions + activity)
    const narrative = buildNotesNarrative({
      plaintiff: parsed.plaintiff,
      orderingClientRule: parsed.orderingClientRule,
      clientJobNumber: parsed.clientJobNumber,
      documents: parsed.documents,
      documentPages: parsed.documentPages,
      bilingual: parsed.bilingual,
      signedDate: parsed.signedDate,
      responseDeadlineDays: parsed.responseDeadlineDays,
      court: parsed.court,
      courtAddress: parsed.courtAddress,
      clerkPhone: parsed.clerkPhone,
      attorney: parsed.attorney,
      serviceRulesSummary: parsed.serviceRulesSummary,
      serviceWindows: parsed.serviceWindows,
      dueDate: parsed.dueDate,
      daysRemaining,
      recommendedAttempts: schedule.map((s) => ({
        label: `${s.date.toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' })} ${s.window}`,
        weekend: s.weekend,
      })),
      jobActivity: parsed.jobActivity,
      instructionsVerbatim: parsed.instructions,
      timestamp: now,
      caseSynopsisText: synopsis.fullText,
      enrichmentText: enrichment.narrativeSection,
    });
    const tsBase = Date.now();
    const notesWrapped = narrative.map((n, i) => ({
      id: String(tsBase + i),
      author: 'Serve Intake',
      text: n.text,
      timestamp: now,
    }));
    // Append additional dispatcher notes if provided
    if (overrides?.additionalNotes) {
      notesWrapped.push({
        id: String(tsBase + notesWrapped.length),
        author: 'Dispatcher',
        text: `DISPATCHER NOTE -- ${overrides.additionalNotes}`,
        timestamp: now,
      });
    }
    const notesJson = JSON.stringify(notesWrapped);

    // ── CFS call ─────────────────────────────────────────────
    const callNumber = nextCallNumber(db);
    const fullName = `${parsed.defendant.first}${parsed.defendant.middle ? ' ' + parsed.defendant.middle : ''} ${parsed.defendant.last}`.trim();
    const subjectDesc = [
      fullName,
      parsed.defendant.dob ? `DOB ${parsed.defendant.dob}` : null,
      parsed.address ? `AT ${parsed.address}` : null,
    ].filter(Boolean).join(', ');
    // ── Structured description (consistent format regardless of source docs) ──
    const descLines: string[] = [];
    descLines.push(`SERVE ${parsed.primaryDoc || 'DOCUMENTS'} TO ${fullName.toUpperCase()}`);
    descLines.push(`AT ${(parsed.address || 'ADDRESS UNKNOWN').toUpperCase()}`);
    descLines.push(`CASE: ${parsed.courtCaseNumber || parsed.clientJobNumber || 'N/A'} | PLAINTIFF: ${(parsed.plaintiff || 'N/A').toUpperCase()}`);
    descLines.push(`DUE: ${parsed.dueDate || 'NO DEADLINE'} | TYPE: ${parsed.serviceType || 'PROCESS SERVICE'}`);
    if (parsed.instructions) {
      const trimmed = parsed.instructions.length > 300 ? parsed.instructions.slice(0, 300) + '...' : parsed.instructions;
      descLines.push(`INSTRUCTIONS: ${trimmed}`);
    }
    if (parsed.serviceWindows) descLines.push(`WINDOWS: ${parsed.serviceWindows}`);
    if (parsed.attorney.name) descLines.push(`ATTORNEY: ${parsed.attorney.name.toUpperCase()}${parsed.attorney.tel ? ' | ' + parsed.attorney.tel : ''}`);
    // Surface high-impact enrichment flags at the top of the description so they appear
    // on the call list row preview without expanding the notes.
    const descFlags: string[] = [];
    if (enrichment.flags.activeTrespassOrder) descFlags.push('TRESPASS ORDER');
    if (enrichment.flags.premiseAlertActive) descFlags.push('PREMISE ALERT');
    if (enrichment.flags.officerSafetyCaution) descFlags.push('OFFICER SAFETY');
    if (enrichment.knownVehicles.length > 0) descFlags.push(`${enrichment.knownVehicles.length} KNOWN VEH`);
    if (enrichment.existingOpenCase) descFlags.push(`OPEN CASE ${enrichment.existingOpenCase.case_number}`);
    if (descFlags.length > 0) descLines.push(`⚑ ${descFlags.join(' · ')}`);
    const description = descLines.join('\n');

    const tagSet: string[] = ['civil_process', 'process_service'];
    if (parsed.bilingual) tagSet.push('bilingual');
    if (parsed.primaryDoc) tagSet.push(parsed.primaryDoc.toLowerCase());
    const tagsJson = JSON.stringify(tagSet);

    const pso72hrDeadline = parsed.dueDate
      ? (() => { const [mm, dd, yyyy] = parsed.dueDate.split('/'); return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} 23:59:59`; })()
      : null;

    const callResult = db.prepare(`
      INSERT INTO calls_for_service (
        call_number, case_number, incident_type, priority, priority_score, status,
        caller_name, caller_phone, caller_relationship, caller_address,
        location_address, location_building, location_floor, location_room, cross_street,
        property_id, latitude, longitude,
        weather_conditions, lighting_conditions, scene_safety,
        sector_id, zone_id, beat_id, zone_beat, dispatch_code,
        sector_name, zone_name, beat_name,
        description, notes, source, dispatcher_id, received_at,
        subject_description, vehicle_description,
        num_subjects, num_victims, direction_of_travel,
        pso_requestor_name, pso_requestor_phone, pso_requestor_email,
        pso_service_type, pso_billing_code, pso_authorization,
        pso_attempt_number, pso_service_windows, pso_72hr_deadline,
        process_service_type, process_served_to, process_served_address,
        process_attempts, client_id, contract_id, case_id,
        secondary_type, contact_method, tags,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `).run(
      callNumber, parsed.courtCaseNumber || parsed.clientJobNumber || null, 'pso_client_request',
      overrides?.priority || 'P4', ({'P1':1,'P2':2,'P3':3,'P4':4} as any)[overrides?.priority || 'P4'] || 4, 'pending',
      callerName, callerPhone || null, 'client', callerAddress || null,
      parsed.address || 'Unknown', parsed.addressParts.building || null, parsed.addressParts.floor || null, parsed.addressParts.suite || enrichment.unitNumber || null, null,
      propertyId, latitude, longitude,
      weatherConditions || null, lightingConditions || null, 'STANDARD',
      sectorCode || null, zoneCode || null, beatCode || null, beatCode || null, dispatchCode || null,
      sectorName || null, zoneName || null, beatName || null,
      description, notesJson, 'intake', userId, now,
      subjectDesc, 'N/A',
      1, 1, 'STATIONARY',
      callerName, callerPhone || null, requestorEmail,
      parsed.serviceType, billingCode, parsed.jobNumber || null,
      0, JSON.stringify(enrichment.serviceWindows), pso72hrDeadline,
      parsed.primaryDoc || null, fullName, parsed.address || null,
      0, clientId, parsed.jobNumber || null, caseId,
      parsed.primaryDoc || 'DOCUMENTS', 'email', tagsJson,
      now, now,
    );
    const callId = Number(callResult.lastInsertRowid);

    // ── Apply enrichment-derived safety flags + repeat-location marker.
    // Done as a follow-up UPDATE rather than expanding the giant INSERT
    // signature (74-column INSERT, gotcha #24 in CLAUDE.md).
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (enrichment.flags.officerSafetyCaution) { sets.push('officer_safety_caution = ?'); vals.push(1); }
      if (enrichment.flags.weaponsInvolved) { sets.push('weapons_involved = ?'); vals.push('FLAGGED'); }
      if (enrichment.flags.secondaryType) { sets.push('secondary_type = ?'); vals.push(enrichment.flags.secondaryType); }
      if (sets.length > 0) {
        vals.push(callId);
        db.prepare(`UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
    } catch (err) {
      log.warn({ err }, 'enrichment flags update failed');
    }

    // ── call_persons links ──────────────────────────────────
    try {
      db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(callId, defendantId, 'subject', userId, now);
      if (plaintiffId) {
        db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(callId, plaintiffId, 'complainant', userId, now);
      }
      if (attorneyId) {
        db.prepare('INSERT OR IGNORE INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(callId, attorneyId, 'reporting_party', userId, now);
      }
    } catch (err) {
      log.warn({ err }, 'call_persons insert failed');
    }

    // ── serve_queue ─────────────────────────────────────────
    let serveQueueId: number | null = null;
    try {
      const sqResult = db.prepare(`
        INSERT INTO serve_queue (
          call_id, recipient_name, recipient_person_id,
          recipient_address, recipient_city, recipient_state, recipient_zip,
          recipient_lat, recipient_lng,
          property_id,
          document_type, case_number, court_name, jurisdiction,
          client_name, attorney_name, priority, deadline,
          max_attempts, service_instructions, notes,
          sm_job_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId, fullName, defendantId,
        parsed.address || null, parsed.addressParts.city || null, parsed.addressParts.state || 'UT', parsed.addressParts.zip || null,
        latitude, longitude,
        propertyId,
        parsed.primaryDoc || 'DOCUMENTS', parsed.courtCaseNumber || parsed.clientJobNumber || null,
        parsed.court || null, parsed.county || null,
        callerName, parsed.attorney.name || null, 'normal', parsed.dueDate || null,
        3, parsed.instructions || null, parsed.serviceRulesSummary || null,
        parsed.jobNumber ? parseInt(parsed.jobNumber, 10) || null : null, 'pending', now, now,
      );
      serveQueueId = Number(sqResult.lastInsertRowid);
    } catch (err) {
      log.warn({ err }, 'serve_queue insert failed');
      warnings.push('serve_queue insert failed');
    }

    // ── serve_attempts (pre-planned) ────────────────────────
    const attemptIds: number[] = [];
    if (serveQueueId) {
      for (let i = 0; i < schedule.length; i++) {
        const slot = schedule[i];
        try {
          const plannedAt = slot.date.toISOString().replace('T', ' ').replace(/\..+$/, '');
          const r = db.prepare(`
            INSERT INTO serve_attempts (
              serve_queue_id, attempt_number, attempt_at, planned_at, window, status, result,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            serveQueueId, i + 1, plannedAt, plannedAt, slot.window, 'planned', null,
            now,
          );
          attemptIds.push(Number(r.lastInsertRowid));
        } catch (err) {
          log.warn({ err, slotIdx: i }, 'serve_attempts insert failed');
        }
      }
    }

    // ── Audit + broadcast ───────────────────────────────────
    auditLog(req, 'SERVE_INTAKE', 'calls_for_service', callId, JSON.stringify({
      defendant_id: defendantId, plaintiff_id: plaintiffId, attorney_id: attorneyId,
      property_id: propertyId, case_id: caseId, serve_queue_id: serveQueueId,
      serve_attempt_ids: attemptIds, job_number: parsed.jobNumber,
    }));
    broadcastDispatchUpdate({ action: 'call_created', call: { id: callId, call_number: callNumber, incident_type: 'pso_client_request' } });

    // ── Auto-create document folder: Year > Month > "JobNumber - DefendantLast" ──
    let documentFolderId: number | null = null;
    try {
      const { ensureIntakeFolderPath } = await import('./documentFolders');
      documentFolderId = ensureIntakeFolderPath(db, userId, parsed.jobNumber, parsed.defendant.last, now);
      // Link any files already attached to this call into the folder
      if (documentFolderId) {
        db.prepare('UPDATE attachments SET folder_id = ? WHERE entity_type = ? AND entity_id = ? AND folder_id IS NULL')
          .run(documentFolderId, 'call', callId);
        db.prepare('UPDATE attachments SET folder_id = ? WHERE entity_type = ? AND entity_id = ? AND folder_id IS NULL')
          .run(documentFolderId, 'case', caseId);
      }
    } catch (err) {
      log.warn({ err }, 'document folder creation failed (non-fatal)');
    }

    res.json({
      success: true,
      call_id: callId,
      call_number: callNumber,
      case_id: caseId,
      case_number: caseNumber,
      defendant_person_id: defendantId,
      plaintiff_person_id: plaintiffId,
      attorney_person_id: attorneyId,
      property_id: propertyId,
      serve_queue_id: serveQueueId,
      serve_attempt_ids: attemptIds,
      document_folder_id: documentFolderId,
      client_id: clientId,
      latitude, longitude,
      sector_code: sectorCode || null,
      zone_code: zoneCode || null,
      beat_code: beatCode || null,
      weather: weatherConditions || null,
      lighting: lightingConditions || null,
      warnings,
      extracted: {
        defendant: parsed.defendant,
        address: parsed.address,
        plaintiff: parsed.plaintiff,
        court: parsed.court,
        documents: parsed.documents,
        primaryDoc: parsed.primaryDoc,
        serviceType: parsed.serviceType,
        jobNumber: parsed.jobNumber,
        clientJobNumber: parsed.clientJobNumber,
        dueDate: parsed.dueDate,
        attorney: {
          name: parsed.attorney.name,
          firm: parsed.attorney.firm,
          barNumber: parsed.attorney.barNumber,
          tel: parsed.attorney.tel,
          email: parsed.attorney.email,
        },
      },
    });
  } catch (err: any) {
    const log = getLogger(req);
    log.error({ err }, 'serve intake failed');
    res.status(500).json({ error: 'Intake processing failed: ' + (err?.message || 'Unknown error') });
  }
});

export default router;
