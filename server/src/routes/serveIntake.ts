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
import { checkBankruptcy } from '../utils/bankruptcyCheck';
import {
  parseAllDocuments,
  buildNotesNarrative,
  computeDiligenceSchedule,
  classifyEntityType,
  addressConfidence,
  type ParseOutput,
} from '../utils/serveIntakeHelpers';
import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { join, resolve as pathResolve } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import multer from 'multer';
import { createReadStream } from 'fs';
const execFileAsync = promisify(execFile);

// ── OCR fallback: pdftoppm → tesseract, page by page ─────────
// TODO: apt install tesseract-ocr poppler-utils on VPS.
// pdftoppm is already installed (poppler-utils); tesseract is NOT yet on
// VPS as of 2026-04-22. Until it's installed, the catch() paths silently
// return whatever (possibly empty) pdftotext output we already have, so
// the feature is inert rather than throwing.
async function ocrFallback(tmpPdf: string): Promise<string> {
  const ocrDir = mkdtempSync(join(tmpdir(), 'serve-ocr-'));
  try {
    // PDF → 300dpi PNGs, one per page: page-1.png, page-2.png, ...
    await execFileAsync('/usr/bin/pdftoppm', ['-r', '300', '-png', tmpPdf, join(ocrDir, 'page')]);
    const pages = readdirSync(ocrDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.png'))
      .sort();
    const texts: string[] = [];
    for (const p of pages) {
      try {
        const { stdout } = await execFileAsync(
          '/usr/bin/tesseract',
          [join(ocrDir, p), '-', '--psm', '1'],
          { maxBuffer: 20 * 1024 * 1024 },
        );
        texts.push(stdout);
      } catch {
        // Per-page OCR failure (or tesseract missing) — skip but keep trying.
      }
    }
    return texts.join('\n\n');
  } catch {
    // pdftoppm itself failed (rare — it is a hard dep already installed)
    return '';
  } finally {
    try { rmSync(ocrDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const UPLOAD_ROOT = process.env.RMPG_UPLOADS_DIR || pathResolve(process.cwd(), 'uploads');
const intakeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files accepted') as any, false);
  },
});

async function pdfBufferToText(buf: Buffer): Promise<string> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'serve-intake-mp-'));
  const tmpPdf = join(tmpDir, 'input.pdf');
  writeFileSync(tmpPdf, buf);
  try {
    let text = '';
    try {
      const { stdout } = await execFileAsync('/usr/bin/pdftotext', ['-layout', tmpPdf, '-']);
      text = stdout;
    } catch {
      try {
        const { stdout } = await execFileAsync('/usr/bin/pdftotext', [tmpPdf, '-']);
        text = stdout;
      } catch { /* fall through to OCR */ }
    }
    if (!text || text.trim().length < 50) {
      const ocr = await ocrFallback(tmpPdf);
      if (ocr.trim().length > text.trim().length) text = ocr;
    }
    return text;
  } finally {
    try { unlinkSync(tmpPdf); } catch {}
    try { unlinkSync(tmpDir); } catch {}
  }
}

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
      let text = '';
      try {
        const { stdout } = await execFileAsync('/usr/bin/pdftotext', ['-layout', tmpPdf, '-']);
        text = stdout;
      } catch {
        try {
          const { stdout } = await execFileAsync('/usr/bin/pdftotext', [tmpPdf, '-']);
          text = stdout;
        } catch { /* fall through to OCR */ }
      }
      // OCR fallback for scanned PDFs: if pdftotext returned near-nothing,
      // try pdftoppm + tesseract (see ocrFallback above).
      try {
        if (!text || text.trim().length < 50) {
          const ocr = await ocrFallback(tmpPdf);
          if (ocr.trim().length > text.trim().length) text = ocr;
        }
      } catch { /* best-effort */ }
      res.json({ text, length: text.length });
      try { unlinkSync(tmpPdf); } catch { /* ignore */ }
      try { unlinkSync(tmpDir); } catch { /* ignore */ }
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
  // Match on name + DOB AND entity_type so an organization-entity plaintiff
  // can't collide with an individual of a similar name, and vice versa.
  // Pre-2026-04-21 this only matched name+DOB, which could collapse a
  // plaintiff/attorney pair down to one persons row when they shared a name.
  const existing = db.prepare(
    "SELECT id FROM persons WHERE first_name = ? AND last_name = ? AND (dob IS NULL OR dob = '' OR ? = '' OR dob = ?) AND (entity_type = ? OR entity_type IS NULL OR entity_type = '') LIMIT 1"
  ).get(info.first, info.last, info.dob || '', info.dob || '', info.entityType) as any;
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

// ── Core intake logic (shared by /intake and /intake-multipart) ───────────
interface DoIntakeOpts {
  fieldSheet: string;
  infoSheet: string;
  courtDocket: string;
  saveAttachments?: (callId: number, caseId: number) => Promise<number[]>;
}

async function doIntake(
  req: Request,
  { fieldSheet, infoSheet, courtDocket, saveAttachments }: DoIntakeOpts,
): Promise<{ status: number; body: any }> {
  const log = getLogger(req);
  const warnings: string[] = [];
  try {
    const db = getDb();
    const userId = req.user!.userId as number;
    const now = localNow();

    const parsed: ParseOutput = parseAllDocuments({ fieldSheet, infoSheet, courtDocket });

    if (!parsed.defendant.last) {
      return { status: 400, body: { error: 'Could not extract defendant/recipient name from documents' } };
    }

    // ── Address confidence cross-check (field sheet vs docket) ──
    const addrConf = addressConfidence(parsed.address, parsed.complaintResidence || '');
    if (addrConf > 0 && addrConf < 80 && parsed.complaintResidence) {
      warnings.push(`Address mismatch (confidence ${addrConf}%): FieldSheet="${parsed.address}", Docket="${parsed.complaintResidence}". Verify defendant residence.`);
    }

    // ── Vendor lookup via fingerprint (clients table) ────────
    let vendorClient: any = null;
    if (parsed.vendorFingerprint) {
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
      warnings.push(`Vendor fingerprint "${parsed.vendorFingerprint}" not found in clients; using client_id=1 fallback`);
    }

    // ── Bankruptcy pre-check (CourtListener) ────────────────────
    // Inert unless courtlistener_api_token is set in system_config.
    // Per ICU rules, an open BK case means the officer must NOT serve if
    // the subject presents a BK case number at the door — we warn only.
    try {
      const bk = await checkBankruptcy(parsed.defendant.first, parsed.defendant.last);
      if (bk.found && bk.cases.length > 0) {
        const caseList = bk.cases.map(c => `${c.caseNumber || '?'} (${c.filed || '?'}, ${c.court || '?'})`).join('; ');
        warnings.push(
          `POSSIBLE BK: ${parsed.defendant.last}, ${parsed.defendant.first} has ${bk.cases.length} BK case(s) on record: ${caseList}. ` +
          `Per ICU rules, DO NOT serve if subject presents BK case #. Officer must verify at the door.`,
        );
      }
    } catch (err: any) {
      log.warn({ err }, 'bankruptcy check failed (non-fatal)');
    }
    const clientId: number = vendorClient?.id ?? 1;
    const callerName: string = vendorClient?.name || 'Process Service Client';
    const callerPhone: string = vendorClient?.caller_phone || '';
    const billingCode: string | null = vendorClient?.billing_code || null;
    const requestorEmail: string | null = vendorClient?.requestor_email || null;
    // CALLER ADDRESS is the physical origin address of the call — meaningless
    // for electronic job intake. Leave blank rather than stamping the vendor's
    // letterhead address, which misleads dispatchers into thinking the call
    // originated from that location.
    const callerAddress: string | null = null;

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

    // ── Property (lastname-residence name) ───────────────────
    let propertyId: number | null = null;
    if (parsed.address) {
      const ap = parsed.addressParts;
      // Use the street address itself as the property name (e.g. "2361 E 3395 S").
      // Previously suffixed "<LAST> Residence" which was redundant with address.
      const streetOnly = (parsed.address.split(',')[0] || '').trim();
      const propName = streetOnly || parsed.address;
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

    // ── Geocode + beat lookup ───────────────────────────────
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (parsed.address) {
      try {
        const geo = await geocodeAddress(parsed.address);
        if (geo) { latitude = geo.latitude; longitude = geo.longitude; }
        else {
          warnings.push('Geocoding returned no result');
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
              LEFT JOIN dispatch_zones dz ON dz.id = db2.zone_id
              LEFT JOIN dispatch_sectors ds ON ds.id = dz.sector_id
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
            if (beatCode && (!sectorCode || !zoneCode)) {
              warnings.push(`Partial geography match: beat=${beatCode} but no parent zone/sector. Dispatch geography tables may be incomplete for this beat.`);
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
        const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover,pressure_msl,visibility&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/Denver`;
        const wxResp = await fetch(wxUrl);
        if (wxResp.ok) {
          const wx: any = await wxResp.json();
          const c = wx.current || {};
          const wxCodes: Record<number, string> = {
            0: 'CLEAR', 1: 'MAINLY CLEAR', 2: 'PARTLY CLOUDY', 3: 'OVERCAST',
            45: 'FOGGY', 48: 'FREEZING FOG', 51: 'LIGHT DRIZZLE', 53: 'MODERATE DRIZZLE',
            55: 'DENSE DRIZZLE', 56: 'LIGHT FREEZING DRIZZLE', 57: 'DENSE FREEZING DRIZZLE',
            61: 'LIGHT RAIN', 63: 'MODERATE RAIN', 65: 'HEAVY RAIN',
            66: 'LIGHT FREEZING RAIN', 67: 'HEAVY FREEZING RAIN',
            71: 'LIGHT SNOW', 73: 'MODERATE SNOW', 75: 'HEAVY SNOW', 77: 'SNOW GRAINS',
            80: 'LIGHT RAIN SHOWERS', 81: 'MODERATE RAIN SHOWERS', 82: 'VIOLENT RAIN SHOWERS',
            85: 'LIGHT SNOW SHOWERS', 86: 'HEAVY SNOW SHOWERS',
            95: 'THUNDERSTORM', 96: 'THUNDERSTORM W/ LIGHT HAIL', 99: 'THUNDERSTORM W/ HEAVY HAIL',
          };
          const windDirCompass = (deg: number) => {
            const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
            return dirs[Math.round(deg / 22.5) % 16];
          };
          const desc = wxCodes[c.weather_code] ?? 'UNKNOWN';
          const parts: string[] = [desc];
          if (typeof c.temperature_2m === 'number') {
            const t = Math.round(c.temperature_2m);
            const feelsLike = typeof c.apparent_temperature === 'number' ? Math.round(c.apparent_temperature) : null;
            parts.push(feelsLike !== null && Math.abs(feelsLike - t) >= 2 ? `${t}°F (feels ${feelsLike}°F)` : `${t}°F`);
          }
          if (typeof c.wind_speed_10m === 'number') {
            const w = Math.round(c.wind_speed_10m);
            const dir = typeof c.wind_direction_10m === 'number' ? ` ${windDirCompass(c.wind_direction_10m)}` : '';
            const gust = typeof c.wind_gusts_10m === 'number' && c.wind_gusts_10m - c.wind_speed_10m >= 5 ? ` gust ${Math.round(c.wind_gusts_10m)}` : '';
            parts.push(`Wind ${w} mph${dir}${gust}`);
          }
          if (typeof c.relative_humidity_2m === 'number') parts.push(`Humidity ${c.relative_humidity_2m}%`);
          if (typeof c.cloud_cover === 'number') parts.push(`Clouds ${c.cloud_cover}%`);
          if (typeof c.precipitation === 'number' && c.precipitation > 0) parts.push(`Precip ${c.precipitation.toFixed(2)}in`);
          if (typeof c.visibility === 'number') {
            const visMi = c.visibility / 1609.34;
            // Open-meteo reports raw atmospheric max-range values that can exceed
            // human-useful visibility. Cap display at "99+" and suppress anything
            // clearly nonsensical (>150mi).
            if (visMi > 0 && visMi < 150) parts.push(`Vis ${visMi >= 99 ? '99+' : visMi.toFixed(1)}mi`);
          }
          // Sea-level (MSL) pressure is the convention shown by consumer weather
          // apps. Surface pressure at SLC's ~4200ft elevation reads ~25inHg which
          // misleads readers. Use pressure_msl for ~29-30inHg like everywhere else.
          if (typeof c.pressure_msl === 'number') parts.push(`Pressure ${(c.pressure_msl * 0.02953).toFixed(2)}inHg`);
          // One field per line so the CFS PDF can render each value on its own row.
          weatherConditions = parts.join('\n');
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
    const schedule = dueDateObj ? computeDiligenceSchedule(dueDateObj, new Date()) : [];
    if (parsed.dueDate && schedule.length === 0) warnings.push('Diligence schedule empty (due date may be in the past)');

    const daysRemaining = dueDateObj ? Math.max(0, Math.ceil((dueDateObj.getTime() - Date.now()) / 86_400_000)) : 0;

    // ── Priority auto-bump based on due-date tightness ───────
    const dueMs = parsed.dueDate
      ? (() => { const [mm, dd, yyyy] = parsed.dueDate.split('/'); return new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T23:59:59-06:00`).getTime(); })()
      : 0;
    const hoursUntilDue = dueMs > 0 ? (dueMs - Date.now()) / 3_600_000 : Infinity;
    let priority: 'P2' | 'P3' | 'P4' = 'P4';
    let priorityScore = 4;
    if (hoursUntilDue < 3) { priority = 'P2'; priorityScore = 2; }
    else if (hoursUntilDue < 24) { priority = 'P3'; priorityScore = 3; }
    if (priorityScore < 4) warnings.push(`Rush intake: ${hoursUntilDue.toFixed(1)}h until due. Priority bumped to ${priority}.`);

    // ── Barcode cross-check ─────────────────────────────────
    if (parsed.docketBarcodeJobNumber && parsed.clientJobNumber && parsed.docketBarcodeJobNumber !== parsed.clientJobNumber) {
      warnings.push(`Barcode mismatch: docket barcode=${parsed.docketBarcodeJobNumber}, field-sheet=${parsed.clientJobNumber}. Verify PDFs belong to same job.`);
    }

    // ── Civil case ───────────────────────────────────────────
    const caseNumber = nextCaseNumber(db);

    // ── Duplicate-intake detection (warn only, don't block) ──
    const caseCourtNum = parsed.courtCaseNumber || parsed.clientJobNumber || null;
    if (caseCourtNum) {
      const dupCase = db.prepare(`
        SELECT id, case_number, created_at
        FROM cases
        WHERE court_case_number = ?
          AND datetime(created_at) > datetime('now','-90 days')
        LIMIT 1
      `).get(caseCourtNum) as any;
      if (dupCase) {
        warnings.push(`Duplicate job: case #${caseCourtNum} was already intaken on ${dupCase.created_at} (case_id=${dupCase.id}). Creating new case anyway.`);
      }
      const dupServe = db.prepare(`
        SELECT id, created_at
        FROM serve_queue
        WHERE case_number = ?
          AND datetime(created_at) > datetime('now','-90 days')
        LIMIT 1
      `).get(caseCourtNum) as any;
      if (dupServe) {
        warnings.push(`Duplicate job: serve_queue entry for case #${caseCourtNum} was created on ${dupServe.created_at} (serve_queue_id=${dupServe.id}). Creating new entry anyway.`);
      }
    }

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

    // ── CFS fullName (used downstream + prior-serve lookup) ────
    const fullName = `${parsed.defendant.first}${parsed.defendant.middle ? ' ' + parsed.defendant.middle : ''} ${parsed.defendant.last}`.trim();

    // ── Prior-serve history lookup (last 12 months) ─────────
    const priorServes = db.prepare(`
      SELECT sq.id, sq.created_at, sq.status, sq.recipient_name, sq.recipient_address,
             cfs.call_number, cfs.case_number
      FROM serve_queue sq
      LEFT JOIN calls_for_service cfs ON cfs.id = sq.call_id
      WHERE (
        (LOWER(sq.recipient_name) = LOWER(?) AND LENGTH(sq.recipient_name) > 3)
        OR (sq.recipient_address = ? AND LENGTH(sq.recipient_address) > 10)
      )
      AND datetime(sq.created_at) > datetime('now','-1 year')
      ORDER BY sq.created_at DESC
      LIMIT 10
    `).all(fullName, parsed.address || '') as any[];

    if (priorServes.length > 0) {
      warnings.push(`Prior-serve history: ${priorServes.length} prior serve(s) in last year for this defendant or address. Review before dispatch.`);
    }

    const priorServesOut = priorServes.map(ps => {
      const nameMatch = (ps.recipient_name || '').toLowerCase() === fullName.toLowerCase();
      const addrMatch = ps.recipient_address === parsed.address;
      const match_type = nameMatch && addrMatch ? 'both' : nameMatch ? 'name' : 'address';
      return {
        id: ps.id,
        call_number: ps.call_number,
        created_at: ps.created_at,
        status: ps.status,
        match_type,
      };
    });

    // ── Notes narrative (8 entries) + wrap with id/author/timestamp
    const augmentedJobActivity = [
      ...parsed.jobActivity,
      ...priorServes.map(ps => ({
        when: String(ps.created_at || '').slice(0, 16),
        action: `PRIOR SERVE (${ps.status || 'unknown'})`,
        detail: `${ps.recipient_name} at ${ps.recipient_address} — call ${ps.call_number || 'n/a'}`,
      })),
    ];

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
      recommendedAttempts: schedule.map((s, idx) => ({
        label: `${s.date.toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' })} ${s.window}`,
        weekend: s.weekend,
      })),
      jobActivity: augmentedJobActivity,
      instructionsVerbatim: parsed.instructions,
      timestamp: now,
    });
    const tsBase = Date.now();
    const notesWrapped = narrative.map((n, i) => ({
      id: String(tsBase + i),
      author: 'Serve Intake',
      text: n.text,
      timestamp: now,
    }));
    const notesJson = JSON.stringify(notesWrapped);

    // ── CFS call ─────────────────────────────────────────────
    const callNumber = nextCallNumber(db);
    const subjectDesc = `${fullName}${parsed.defendant.dob ? ', DOB ' + parsed.defendant.dob : ''}`;
    const descLines: string[] = [];
    descLines.push(`SERVE ${parsed.primaryDoc || 'DOCUMENTS'} TO ${fullName.toUpperCase()}`);
    if (parsed.address) descLines.push(`AT ${parsed.address.toUpperCase()}`);
    if (parsed.dueDate) descLines.push(`DUE: ${parsed.dueDate}`);
    if (parsed.instructions) {
      const trimmed = parsed.instructions.length > 400 ? parsed.instructions.slice(0, 400) + '...' : parsed.instructions;
      descLines.push(`INSTRUCTIONS: ${trimmed}`);
    }
    if (parsed.serviceWindows) descLines.push(`SERVICE WINDOWS: ${parsed.serviceWindows}`);
    const description = descLines.join('\n');

    const tagSet: string[] = ['civil_process', 'process_service'];
    if (parsed.bilingual) tagSet.push('bilingual');
    if (parsed.primaryDoc) tagSet.push(parsed.primaryDoc.toLowerCase());
    if (priorityScore < 4) tagSet.push('rush');
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
      callNumber, parsed.courtCaseNumber || parsed.clientJobNumber || null, 'pso_client_request', priority, priorityScore, 'pending',
      callerName, callerPhone || null, 'client', callerAddress || null,
      parsed.address || 'Unknown', parsed.addressParts.building || null, parsed.addressParts.floor || null, parsed.addressParts.suite || null, null,
      propertyId, latitude, longitude,
      weatherConditions || null, lightingConditions || null, 'STANDARD',
      sectorCode || null, zoneCode || null, beatCode || null, beatCode || null, dispatchCode || null,
      sectorName || null, zoneName || null, beatName || null,
      description, notesJson, 'intake', userId, now,
      subjectDesc, 'N/A',
      1, 1, 'STATIONARY',
      callerName, callerPhone || null, requestorEmail,
      parsed.serviceType, billingCode, parsed.jobNumber || null,
      0, parsed.serviceWindows || null, pso72hrDeadline,
      parsed.primaryDoc || null, fullName, parsed.address || null,
      0, clientId, parsed.jobNumber || null, caseId,
      parsed.primaryDoc || 'DOCUMENTS', 'email', tagsJson,
      now, now,
    );
    const callId = Number(callResult.lastInsertRowid);

    // ── call_persons links ──────────────────────────────────
    // Using plain INSERT (not OR IGNORE) so a silent duplicate-suppression
    // can't drop rows unnoticed. If two parties happen to resolve to the same
    // persons.id via upsertPerson (e.g. an org-named attorney colliding with
    // the plaintiff org), we still want 3 link rows with distinct roles —
    // the schema has no UNIQUE constraint on (call_id, person_id) so that
    // is safe. Track inserts so we can warn when we persisted fewer than the
    // parties we parsed.
    // NOTE: call_persons.role has a CHECK constraint allowing only
    //   'suspect','victim','witness','reporting_party','involved','other'
    // Previously we inserted 'subject' / 'complainant' which violated the
    // check and dropped rows (surfaced only as a warning). Map to valid
    // roles: defendant -> 'involved', plaintiff -> 'other' (civil process,
    // 'victim' is semantically wrong), attorney -> 'reporting_party'.
    let callPersonsInserted = 0;
    const insertLink = db.prepare('INSERT INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)');
    const tryLink = (personId: number | null, role: string) => {
      if (!personId) return;
      try {
        insertLink.run(callId, personId, role, userId, now);
        callPersonsInserted++;
      } catch (err) {
        log.warn({ err, role, personId }, 'call_persons insert failed');
        warnings.push(`call_persons insert failed for role=${role}`);
      }
    };
    tryLink(defendantId, 'involved');
    tryLink(plaintiffId, 'other');
    tryLink(attorneyId, 'reporting_party');
    const expectedCallPersons = 1 + (plaintiffId ? 1 : 0) + (attorneyId ? 1 : 0);
    if (callPersonsInserted < expectedCallPersons) {
      warnings.push(`Expected ${expectedCallPersons} call_persons rows, inserted ${callPersonsInserted}`);
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

    // ── Save original PDFs as call_attachments (multipart path only) ──
    let attachmentIds: number[] = [];
    if (saveAttachments) {
      try {
        attachmentIds = await saveAttachments(callId, caseId);
      } catch (err) {
        log.warn({ err }, 'saveAttachments callback failed');
        warnings.push('Failed to persist one or more source PDFs');
      }
    }

    if (parsed.additionalDefendants.length > 0) {
      warnings.push(`Multi-defendant docket: ${parsed.additionalDefendants.length} additional party(ies) detected: ${parsed.additionalDefendants.join(', ')}. Upload separately to create jobs for them.`);
    }

    return { status: 200, body: {
      success: true,
      attachment_ids: attachmentIds,
      additional_defendants: parsed.additionalDefendants,
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
      client_id: clientId,
      latitude, longitude,
      sector_code: sectorCode || null,
      zone_code: zoneCode || null,
      beat_code: beatCode || null,
      weather: weatherConditions || null,
      lighting: lightingConditions || null,
      address_confidence: addrConf,
      prior_serves: priorServesOut,
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
    } };
  } catch (err: any) {
    log.error({ err }, 'serve intake failed');
    return { status: 500, body: { error: 'Intake processing failed: ' + (err?.message || 'Unknown error') } };
  }
}

// ── JSON intake (text-only; backward-compatible) ───────────────
router.post('/intake', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (req: Request, res: Response) => {
  const { documents } = req.body;
  if (!documents || !Array.isArray(documents) || documents.length === 0) {
    res.status(400).json({ error: 'documents array required with at least one document' });
    return;
  }
  let fieldSheet = '';
  let courtDocket = '';
  let infoSheet = '';
  for (const d of documents) {
    const txt = (d?.text || '') as string;
    if (!txt) continue;
    let kind = d.type as string | undefined;
    if (!kind || kind === 'unknown') kind = detectDocType(txt);
    if (kind === 'court_filing') kind = 'court_docket';
    if (kind === 'info_page') kind = 'info_sheet';
    if (kind === 'field_sheet' && !fieldSheet) fieldSheet = txt;
    else if (kind === 'court_docket' && !courtDocket) courtDocket = txt;
    else if (kind === 'info_sheet' && !infoSheet) infoSheet = txt;
    else {
      if (!fieldSheet) fieldSheet = txt;
      else if (!courtDocket) courtDocket = txt;
      else if (!infoSheet) infoSheet = txt;
    }
  }
  const { status, body } = await doIntake(req, { fieldSheet, infoSheet, courtDocket });
  res.status(status).json(body);
});

// ── Multipart intake: accepts original PDF files, extracts text, persists originals ──
router.post(
  '/intake-multipart',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  intakeUpload.fields([
    { name: 'field_sheet', maxCount: 1 },
    { name: 'court_docket', maxCount: 1 },
    { name: 'info_sheet', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    const log = getLogger(req);
    try {
      const userId = req.user!.userId as number;
      const filesMap = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const getBuf = (k: string): Buffer | null => (filesMap[k]?.[0]?.buffer || null);
      const getFile = (k: string): Express.Multer.File | null => (filesMap[k]?.[0] || null);
      const fsBuf = getBuf('field_sheet');
      const cdBuf = getBuf('court_docket');
      const isBuf = getBuf('info_sheet');
      if (!fsBuf && !cdBuf && !isBuf) {
        res.status(400).json({ error: 'At least one PDF file required (field_sheet, court_docket, info_sheet)' });
        return;
      }
      const [fieldSheet, courtDocket, infoSheet] = await Promise.all([
        fsBuf ? pdfBufferToText(fsBuf) : Promise.resolve(''),
        cdBuf ? pdfBufferToText(cdBuf) : Promise.resolve(''),
        isBuf ? pdfBufferToText(isBuf) : Promise.resolve(''),
      ]);

      // Deferred attachment writer — called once we know callId/caseId and callNumber
      const saveAttachments = async (callId: number, caseId: number): Promise<number[]> => {
        const db = getDb();
        const row = db.prepare('SELECT call_number FROM calls_for_service WHERE id = ?').get(callId) as any;
        const callNumber = (row?.call_number || `call_${callId}`).replace(/[^A-Za-z0-9_-]/g, '_');
        const destDir = join(UPLOAD_ROOT, 'serve-intake', callNumber);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const ids: number[] = [];
        const entries: Array<[string, Express.Multer.File | null]> = [
          ['field_sheet', getFile('field_sheet')],
          ['court_docket', getFile('court_docket')],
          ['info_sheet', getFile('info_sheet')],
        ];
        for (const [docType, f] of entries) {
          if (!f) continue;
          const filename = `${docType}.pdf`;
          const absPath = join(destDir, filename);
          writeFileSync(absPath, f.buffer);
          // Store relative to CWD so sendFile can resolve it consistently
          const relPath = pathResolve(absPath).replace(pathResolve(process.cwd()) + '/', '');
          const result = db.prepare(`
            INSERT INTO call_attachments (
              call_id, case_id, filename, relative_path, doc_type, mime_type, byte_size, uploaded_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            callId, caseId,
            f.originalname || filename,
            relPath,
            docType,
            f.mimetype || 'application/pdf',
            f.size || f.buffer.length,
            userId,
          );
          ids.push(Number(result.lastInsertRowid));
        }
        return ids;
      };

      const { status, body } = await doIntake(req, { fieldSheet, infoSheet, courtDocket, saveAttachments });
      res.status(status).json(body);
    } catch (err: any) {
      log.error({ err }, 'intake-multipart failed');
      res.status(500).json({ error: 'Multipart intake failed: ' + (err?.message || 'Unknown error') });
    }
  },
);

// ── Download an attachment ────────────────────────────────────────────────
router.get(
  '/calls/:callId/attachments/:attachmentId/download',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const db = getDb();
      const callId = parseInt(String(req.params.callId), 10);
      const attId = parseInt(String(req.params.attachmentId), 10);
      if (!callId || !attId) { res.status(400).json({ error: 'invalid id' }); return; }
      const att = db.prepare('SELECT * FROM call_attachments WHERE id = ? AND call_id = ?').get(attId, callId) as any;
      if (!att) { res.status(404).json({ error: 'not found' }); return; }
      const abs = pathResolve(process.cwd(), att.relative_path);
      // Guard against path traversal — the persisted relative_path should always resolve under UPLOAD_ROOT
      const expectedRoot = pathResolve(UPLOAD_ROOT);
      if (!abs.startsWith(expectedRoot) && !abs.startsWith(pathResolve(process.cwd(), 'uploads'))) {
        res.status(403).json({ error: 'forbidden path' });
        return;
      }
      if (!existsSync(abs)) { res.status(404).json({ error: 'file missing on disk' }); return; }
      res.setHeader('Content-Type', att.mime_type || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${att.filename}"`);
      createReadStream(abs).pipe(res);
    } catch (err: any) {
      getLogger(req).error({ err }, 'attachment download failed');
      res.status(500).json({ error: 'download failed' });
    }
  },
);

export default router;
