import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, safeStr } from '../worker-middleware/d1Helpers';
import { localNow } from '../worker-middleware/timeUtils';

function detectDocType(text: string): 'court_docket' | 'field_sheet' | 'info_page' | 'unknown' {
  if (/SUMMONS|COMPLAINT|Attorney for Plaintiff|JUDICIAL DISTRICT COURT/i.test(text)) return 'court_docket';
  if (/Party to Serve|Instructions\s*\n.*Sub-serve|Date & Time.*Description of Service/i.test(text)) return 'field_sheet';
  if (/^JOB\b/im.test(text) || /Service Attempts|Recipient:|Job Activity|Af\s*fi\s*davits/i.test(text)) return 'info_page';
  return 'unknown';
}

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
    new RegExp(`${label}\\s+([^\\n]+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

function extractFieldLines(text: string, label: string, numLines = 5): string[] {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(label.toLowerCase())) {
      const results: string[] = [];
      for (let j = 0; j < numLines && i + j < lines.length; j++) {
        const trimmed = lines[i + j].trim();
        if (trimmed) results.push(trimmed);
      }
      return results;
    }
  }
  return [];
}

function parseCourtDocket(text: string): any {
  const isUtah = /UTAH|THIRD DISTRICT|SALT LAKE/i.test(text) || /^\d{5}-\d{6}$/m.test(text);
  const caseNum = extractField(text, 'Case Number') || extractField(text, 'Case No') || extractField(text, 'Docket No') || extractField(text, 'Civil No');
  let plaintiff = extractField(text, 'Plaintiff') || extractField(text, 'Plaintiff\\(s\\)') || extractField(text, 'Petitioner');
  let defendant = extractField(text, 'Defendant') || extractField(text, 'Defendant\\(s\\)') || extractField(text, 'Respondent');
  if (!plaintiff && !defendant) {
    const lines = text.split('\n');
    const caseLineIdx = lines.findIndex(l => /plaintiff|defendant/i.test(l));
    if (caseLineIdx >= 0) {
      const line = lines[caseLineIdx];
      if (line.toLowerCase().includes('plaintiff')) {
        plaintiff = line.replace(/Plaintiff:?\s*/i, '').trim();
        defendant = lines[caseLineIdx + 1]?.replace(/Defendant:?\s*/i, '').trim() || '';
      } else if (line.toLowerCase().includes('defendant')) {
        defendant = line.replace(/Defendant:?\s*/i, '').trim();
        plaintiff = lines[caseLineIdx + 1]?.replace(/Plaintiff:?\s*/i, '').trim() || '';
      }
    }
  }
  const plaintiffAtty = extractField(text, 'Attorney for Plaintiff') || extractField(text, 'Attorney for Petitioner');
  const courtDateStr = extractField(text, 'Hearing Date') || extractField(text, 'Trial Date') || extractField(text, 'Return Date');
  const filingDate = extractField(text, 'Filing Date') || extractField(text, 'Filed');
  return { document_type: 'court_docket', case_number: caseNum, plaintiff, defendant, plaintiff_attorney: plaintiffAtty, court_date: courtDateStr, filing_date: filingDate, jurisdiction: isUtah ? 'Utah State Courts' : '' };
}

function parseFieldSheet(text: string): any {
  const partyToServe = extractFieldLines(text, 'Party to Serve', 3);
  const instructions = extractBetween(text, 'Instructions:', 'Defendant:').trim() ||
    extractBetween(text, 'Instructions:', 'CASE INFORMATION').trim() ||
    extractBetween(text, 'Instructions:', 'Court Docket').trim();
  const defendantName = extractField(text, 'Defendant');
  const plaintiffName = extractField(text, 'Plaintiff');
  const caseNum = extractField(text, 'Case #') || extractField(text, 'Case Number') || extractField(text, 'Case No');

  const addressLines: string[] = [];
  for (let i = 0; i < partyToServe.length; i++) {
    if (/\d{3,5}\s+[A-Za-z]/.test(partyToServe[i])) addressLines.push(partyToServe[i]);
  }
  const address = addressLines.join(', ') || partyToServe.join(', ');
  const stateZipMatch = address.match(/([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
  const cityStateMatch = address.match(/([A-Za-z\s.]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);

  return {
    document_type: 'field_sheet',
    party_to_serve: partyToServe.join('; '),
    defendant_name: defendantName || partyToServe[0] || '',
    plaintiff_name: plaintiffName,
    case_number: caseNum,
    address,
    city: cityStateMatch?.[1]?.trim() || '',
    state: stateZipMatch?.[1] || cityStateMatch?.[2] || '',
    zip: stateZipMatch?.[2] || cityStateMatch?.[3] || '',
    instructions,
  };
}

function parseInfoPage(text: string): any {
  const jobMatch = text.match(/JOB\s*[:\s]*(\d+)/i);
  const jobNumber = jobMatch?.[1] || '';
  const recipient = extractField(text, 'Recipient');
  const clientArea = extractBetween(text, 'CLIENT', 'SERVER').trim();
  const serverArea = extractBetween(text, 'SERVER', 'JOB ACTIVITY').trim() || extractBetween(text, 'SERVER', 'AFFIDAVITS').trim() || extractBetween(text, 'SERVER', 'Af\\s*fi\\s*davits').trim();
  const serviceAttempts = extractBetween(text, 'Service Attempts', 'JOB ACTIVITY').trim() || extractBetween(text, 'Service Attempts', 'Af\\s*fi\\s*davits').trim();

  let clientName = '', serverName = '';
  if (clientArea) {
    const lines = clientArea.split('\n').map((l: string) => l.trim()).filter(Boolean);
    clientName = lines[0] || '';
  }
  if (serverArea) {
    const lines = serverArea.split('\n').map((l: string) => l.trim()).filter(Boolean);
    serverName = lines[0] || '';
  }

  return {
    document_type: 'info_page',
    job_number: jobNumber,
    recipient,
    client_name: clientName,
    server_name: serverName,
    client_area: clientArea,
    server_area: serverArea,
    service_attempts: serviceAttempts,
  };
}

export function mountServeIntakeRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // POST /api/serve-intake/extract-text
  api.post('/extract-text', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    try {
      const contentType = c.req.header('content-type') || '';
      let text = '';

      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.parseBody();
        const file = formData['file'] || formData['document'] || formData['pdf'];
        if (file && typeof file !== 'string') {
          const buf = await (file as File).arrayBuffer();
          const bytes = new Uint8Array(buf);
          if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
            // PDF uploaded but we don't have pdftotext in Workers
            return c.json({ text: '', length: 0, warning: 'PDF text extraction requires desktop application. Plain text content accepted.' });
          }
          text = new TextDecoder().decode(buf);
        }
      } else if (contentType.includes('application/json')) {
        const body = await c.req.json();
        text = body.text || body.content || '';
      } else {
        const buf = await c.req.arrayBuffer();
        text = new TextDecoder().decode(buf);
      }

      if (text.length < 100) {
        return c.json({ text: '', length: 0 });
      }

      return c.json({ text, length: text.length });
    } catch (err: any) {
      return c.json({ error: 'Text extraction failed', text: '' }, 500);
    }
  });

  // POST /api/serve-intake/intake
  api.post('/intake', requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const user = c.get('user');
      const now = localNow();

      const { documents, client_id } = await c.req.json();
      if (!documents || !Array.isArray(documents) || documents.length === 0) {
        return c.json({ error: 'documents array required with at least one document' }, 400);
      }

      let fieldSheetText = '';
      let courtDocketText = '';

      for (const doc of documents) {
        const { type, text } = doc;
        if (type === 'field_sheet') fieldSheetText += text + '\n';
        else if (type === 'court_docket') courtDocketText += text + '\n';
      }

      let combinedText = [fieldSheetText, courtDocketText].filter(Boolean).join('\n');
      if (!combinedText) combinedText = documents.map((d: any) => d.text).join('\n');

      if (!combinedText || combinedText.length < 50) {
        return c.json({ error: 'Insufficient document text. Please upload clearer scans.' }, 400);
      }

      const docType = detectDocType(combinedText);
      let parsed: any;
      switch (docType) {
        case 'court_docket': parsed = parseCourtDocket(combinedText); break;
        case 'field_sheet': parsed = parseFieldSheet(combinedText); break;
        case 'info_page': parsed = parseInfoPage(combinedText); break;
        default: {
          const courtParsed = parseCourtDocket(combinedText);
          const fieldParsed = parseFieldSheet(combinedText);
          if (courtParsed.case_number && (courtParsed.plaintiff || courtParsed.defendant)) {
            parsed = { ...courtParsed, doc_type: 'court_docket' };
          } else {
            parsed = { ...fieldParsed, doc_type: 'field_sheet', document_type: 'field_sheet' };
          }
        }
      }

      let plaintiffName = parsed.plaintiff || parsed.plaintiff_name || '';
      let defendantName = parsed.defendant || parsed.defendant_name || '';
      const isUtah = parsed.jurisdiction?.includes('Utah') ||
        /UTAH|SALT LAKE|THIRD DISTRICT/i.test(combinedText);

      const defendantAddress = parsed.address || '';
      const defendantCity = parsed.city || '';
      const defendantState = parsed.state || '';
      const defendantZip = parsed.zip || '';
      const caseNumber = parsed.case_number || '';

      // Ensure persons exist
      const persons: any[] = [];
      if (defendantName) {
        const existing = await db.prepare('SELECT id FROM persons WHERE full_name = ?').get(defendantName) as any;
        if (existing) {
          persons.push({ id: existing.id, role: 'defendant' });
        } else {
          const nameParts = defendantName.split(/\s+/);
          const res = await db.prepare(
            'INSERT INTO persons (first_name, last_name, full_name, address, city, state, zip_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(nameParts[0] || '', nameParts.slice(1).join(' ') || '', defendantName,
            defendantAddress || null, defendantCity || null, defendantState || null, defendantZip || null, now, now);
          persons.push({ id: Number(res.meta.last_row_id), role: 'defendant' });
        }
      }
      if (plaintiffName) {
        const existing = await db.prepare('SELECT id FROM persons WHERE full_name = ?').get(plaintiffName) as any;
        if (existing) {
          persons.push({ id: existing.id, role: 'plaintiff' });
        } else {
          const nameParts = plaintiffName.split(/\s+/);
          const res = await db.prepare(
            'INSERT INTO persons (first_name, last_name, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          ).run(nameParts[0] || '', nameParts.slice(1).join(' ') || '', plaintiffName, now, now);
          persons.push({ id: Number(res.meta.last_row_id), role: 'plaintiff' });
        }
      }

      // Create serve_queue entry
      const serveResult = await db.prepare(`
        INSERT INTO serve_queue (client_id, case_number, defendant_name, plaintiff_name,
          defendant_address, defendant_city, defendant_state, defendant_zip,
          instructions, document_text, parsed_data, status, assigned_officer_id,
          created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        client_id || null, caseNumber, defendantName, plaintiffName,
        defendantAddress || null, defendantCity || null, defendantState || null, defendantZip || null,
        parsed.instructions || null, combinedText.substring(0, 10000), JSON.stringify(parsed),
        null, user.userId, now, now
      );
      const serveId = Number(serveResult.meta.last_row_id);

      // Link persons
      for (const p of persons) {
        await db.prepare(
          'INSERT INTO serve_queue_persons (serve_queue_id, person_id, role, created_at) VALUES (?, ?, ?, ?)'
        ).run(serveId, p.id, p.role, now);
      }

      return c.json({
        success: true, id: serveId, parsed,
        persons: persons.map(p => ({ id: p.id, role: p.role })),
      }, 201);
    } catch (err: any) {
      return c.json({ error: 'Intake processing failed', code: 'INTAKE_PROCESSING_FAILED' }, 500);
    }
  });

  app.route('/api/serve-intake', api);
}
