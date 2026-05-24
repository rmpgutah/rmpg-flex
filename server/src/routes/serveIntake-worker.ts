import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db } from '../worker-middleware/d1Helpers';
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
    new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
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

function parseNameField(text: string): { first: string; middle: string; last: string } {
  const nameStr = extractField(text, 'Party to Serve') || extractField(text, 'Recipient') || extractField(text, 'Defendant');
  if (!nameStr) return { first: '', middle: '', last: '' };
  const parts = nameStr.replace(/,.*$/, '').replace(/ an individual/i, '').trim().split(/\s+/);
  if (parts.length >= 3) return { first: parts[0], middle: parts.slice(1, -1).join(' '), last: parts[parts.length - 1] };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  return { first: nameStr, middle: '', last: '' };
}

function extractNameString(text: string): string {
  return extractField(text, 'Party to Serve') || extractField(text, 'Recipient') || extractField(text, 'Defendant') || '';
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
  const m = text.match(/^Address\s*\n\s*(.+(?:,\s*[A-Z]{2}\s*\d{5}).*)$/im);
  if (m) return m[1].trim();
  const addrLine = text.match(/(\d+\s+[A-Za-z].*?,\s*[A-Za-z ]+,\s*[A-Z]{2}\s*\d{5}[^)\n]*)/);
  if (addrLine) return addrLine[1].trim();
  return extractField(text, 'Address') || '';
}

function extractAddressParts(text: string): { address: string; city: string; state: string; zip: string } {
  const addr = extractAddress(text);
  if (!addr) return { address: '', city: '', state: '', zip: '' };
  const m = addr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/);
  if (m) return { address: addr, city: m[1].trim(), state: m[2], zip: m[3] };
  const sm = addr.match(/([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
  if (sm) return { address: addr, city: '', state: sm[1], zip: sm[2] };
  return { address: addr, city: '', state: '', zip: '' };
}

function extractPlaintiff(text: string): string {
  return extractBetween(text, 'Plaintiff', 'Defendant') || extractField(text, 'Plaintiff') || '';
}

function extractCourt(text: string): string {
  const m = text.match(/(THIRD|FIRST|SECOND|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+JUDICIAL\s+DISTRICT\s+COURT[^,\n]*/i);
  if (m) return m[0].trim();
  const m2 = text.match(/([A-Za-z]+)\s+(JUSTICE|JUDICIAL|MUNICIPAL|DISTRICT)\s+COURT/i);
  if (m2) return m2[0].trim();
  return '';
}

function extractDocuments(text: string): string {
  return extractField(text, 'Documents') || '';
}

function extractInstructions(text: string): string {
  const m = text.match(/Instructions\s*\n([\s\S]*?)(?:\n\n|\nMuhammad|\nAddress|\n[A-Z][a-z]+ [A-Z])/i);
  return m ? m[1].replace(/\n/g, ' ').trim() : '';
}

function extractServeInstructions(text: string): string {
  const m = text.match(/Instructions\s*\n([\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n)/i);
  if (m) return m[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const sub = text.match(/(Sub-serve[\s\S]*?)(?:\n\s*\n\s*Address|\n\s*\n\s*\n)/i);
  if (sub) return sub[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

function extractJobNumber(text: string): string {
  const m = text.match(/(?:Job|JOB)[:\s#]*(\d+)/);
  return m ? m[1] : '';
}

function extractCaseNumber(text: string): string {
  const m = text.match(/\((\d{5,})\)/);
  if (m) return m[1];
  return extractField(text, 'Case #') || extractField(text, 'Case Number') || extractField(text, 'Case No') || '';
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

function extractClientAddress(text: string): string {
  const m = text.match(/ICU Investigations.*?\n([\d]+ .*?\n.*?\d{5})/i);
  if (m) return m[1].replace(/\n/g, ', ').trim();
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
  const clerk = text.match(/call the clerk.*?at\s*\((\d{3})\)\s*(\d{3}[-.]?\d{4})/i);
  if (clerk) parts.push(`Court Clerk: (${clerk[1]}) ${clerk[2]}`);
  const courtAddr = text.match(/(\d+ South State St.*?\d{5})/i);
  if (courtAddr) parts.push(`Court Address: ${courtAddr[1]}`);
  return parts.join('. ');
}

function generateCaseNarrative(fields: {
  fullName: string; dob: string; address: string; city: string; state: string; zip: string;
  plaintiff: string; court: string; caseNumber: string; jobNumber: string;
  attorney: { name: string; phone: string; email: string; bar: string };
  docs: string; instructions: string; dueDate: string; fee: string;
  serviceWindows: string; clientAddress: string; allText: string;
}): string {
  const p = fields;
  const parts: string[] = [];

  // Opening — identifies the subject and what's being served
  let opening = `This is a process service intake for ${p.fullName || 'the defendant/recipient'}`;
  if (p.dob) opening += ` (DOB: ${p.dob})`;
  if (p.address) opening += ` at ${p.address}${p.city ? ', ' + p.city : ''}${p.state ? ', ' + p.state : ''}${p.zip ? ' ' + p.zip : ''}`;
  opening += '.';
  parts.push(opening);

  // Document purpose — what was filed and by whom
  const docPurpose: string[] = [];
  if (p.docs) {
    docPurpose.push(`The document${p.docs.includes('&') ? 's' : ''} to be served ${p.docs.includes('&') ? 'are' : 'is'} ${p.docs.toLowerCase()}`);
  } else {
    docPurpose.push('Court documents are to be served');
  }
  if (p.court) docPurpose.push(`filed in ${p.court}`);
  if (p.caseNumber) docPurpose.push(`under case number ${p.caseNumber}`);
  if (p.plaintiff) {
    const cleaned = p.plaintiff.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    docPurpose.push(`with ${cleaned} named as the plaintiff/petitioner`);
  }
  docPurpose[docPurpose.length - 1] = docPurpose[docPurpose.length - 1] + '.';
  parts.push(docPurpose.join(' '));

  // Attorney and court details
  if (p.attorney.name || p.court) {
    const attyParts: string[] = ['Legal representation is noted'];
    if (p.attorney.name) {
      attyParts.push(`as ${p.attorney.name}${p.attorney.bar ? ` (Bar#${p.attorney.bar})` : ''} represents the plaintiff`);
      if (p.attorney.phone) attyParts.push(`and can be reached at ${p.attorney.phone}`);
      if (p.attorney.email) attyParts.push(`or via email at ${p.attorney.email}`);
    }
    if (p.court && /district/i.test(p.court)) {
      attyParts.push(`. The matter is venued in ${p.court}`);
    }
    const courtClerk = p.allText.match(/call the clerk.*?at\s*\((\d{3})\)\s*(\d{3}[-.]?\d{4})/i);
    if (courtClerk) attyParts.push(`(Court Clerk: (${courtClerk[1]}) ${courtClerk[2]})`);
    const courtAddr = p.allText.match(/(\d+ South State St.*?\d{5})/i);
    if (courtAddr) attyParts.push(`— ${courtAddr[1]}`);
    parts.push(attyParts.join(' ') + '.');
  }

  // Service parameters — deadlines, windows, fees
  const svcParts: string[] = ['Service parameters are as follows:'];
  if (p.dueDate) svcParts.push(`this matter must be served by ${p.dueDate}`);
  if (p.serviceWindows) svcParts.push(`with service windows of ${p.serviceWindows.toLowerCase()}`);
  if (p.fee) svcParts.push(`and the service fee is ${p.fee}`);
  if (svcParts.length > 1) {
    let s = svcParts.join(' ');
    if (s.endsWith(',')) s = s.slice(0, -1);
    parts.push(s + '.');
  }

  // Service instructions
  if (p.instructions && p.instructions.length > 15) {
    const cleaned = p.instructions.replace(/\s+/g, ' ').trim();
    parts.push(`Service instructions provided with this matter: ${cleaned}`);
  }

  // Job reference
  if (p.jobNumber) {
    parts.push(`This intake is associated with job number ${p.jobNumber}${p.clientAddress ? `, originating from ${p.clientAddress}` : ''}.`);
  }

  return parts.join('\n\n');
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
            return c.json({ text: '', length: 0 });
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

      // Merge all document text — the extraction functions work on combined text
      const allText = documents.map((d: any) => d.text || '').filter(Boolean).join('\n\n');
      if (!allText || allText.length < 50) {
        return c.json({ error: 'Insufficient document text. Please upload clearer scans.' }, 400);
      }

      // Extract ALL fields using proven Express version extraction functions
      const name = parseNameField(allText);
      const fullName = `${name.first}${name.middle ? ' ' + name.middle : ''} ${name.last}`;
      const dob = extractDOB(allText);
      const addrParts = extractAddressParts(allText);
      const plaintiff = extractPlaintiff(allText);
      const court = extractCourt(allText);
      const docs = extractDocuments(allText);
      const instructions = extractServeInstructions(allText) || extractInstructions(allText);
      const jobNumber = extractJobNumber(allText);
      const caseNumber = extractCaseNumber(allText);
      const dueDate = extractDueDate(allText);
      const attorney = extractAttorney(allText);
      const fee = extractFee(allText);
      const serviceWindows = extractServiceWindows(allText);
      const caseNotes = extractCaseNotes(allText);
      const clientAddress = extractClientAddress(allText);

      // ── 1. Ensure person exists ──
      const persons: any[] = [];
      if (name.first) {
        const existing = await db.prepare('SELECT id FROM persons WHERE first_name = ? AND last_name = ? LIMIT 1').get(name.first, name.last) as any;
        if (existing) {
          persons.push({ id: existing.id, role: 'defendant' });
        } else {
          const res = await db.prepare(
            'INSERT INTO persons (first_name, last_name, dob, address, created_at) VALUES (?, ?, ?, ?, ?)'
          ).run(name.first, name.last, dob || null, addrParts.address || null, now);
          persons.push({ id: Number(res.meta.last_row_id), role: 'defendant' });
        }
      }

      // ── 2. Create Property if address extracted ──
      let propertyId: number | null = null;
      if (addrParts.address) {
        const existingProp = await db.prepare('SELECT id FROM properties WHERE address = ? LIMIT 1').get(addrParts.address) as any;
        if (existingProp) {
          propertyId = existingProp.id;
        } else {
          const propName = `${addrParts.address.split(',')[0] || addrParts.address} — ${name.last || 'Unknown'} Residence`;
          const propRes = await db.prepare(
            'INSERT INTO properties (client_id, name, address, property_type, created_at) VALUES (?, ?, ?, ?, ?)'
          ).run(client_id || 1, propName, addrParts.address, 'residential', now);
          propertyId = Number(propRes.meta.last_row_id);
        }
        // Link person to property (non-fatal — record_links may not exist in D1)
        if (propertyId && persons.length > 0) {
          try {
            await db.prepare(
              'INSERT OR IGNORE INTO record_links (source_type, source_id, target_type, target_id, relationship, created_by) VALUES (?, ?, ?, ?, ?, ?)'
            ).run('person', persons[0].id, 'property', propertyId, 'resident', user.userId);
          } catch (_) { /* table may not exist in D1 */ }
        }
      }

      // ── 3. Generate call number ──
      const year = new Date().getFullYear().toString().slice(-2);
      const lastCall = await db.prepare("SELECT call_number FROM calls_for_service WHERE call_number LIKE ? ORDER BY id DESC LIMIT 1").get(`${year}-CFS%`) as any;
      let seq = 1;
      if (lastCall) {
        const m = (lastCall as any).call_number.match(/CFS(\d+)/);
        if (m) seq = parseInt(m[1], 10) + 1;
      }
      const callNumber = `${year}-CFS${String(seq).padStart(5, '0')}`;

      // ── 4. Determine process service type ──
      const processType = /complaint/i.test(docs) ? 'complaint'
        : /subpoena/i.test(docs) ? 'subpoena'
        : /eviction|unlawful detainer/i.test(docs) ? 'eviction'
        : /restraining|protective/i.test(docs) ? 'restraining_order'
        : 'summons';
      const callerName = attorney.name || plaintiff.replace(/\n/g, ' ').trim() || 'Process Service Client';
      const callerPhone = attorney.phone || '';
      const subjectDesc = `${fullName}${dob ? ', DOB ' + dob : ''}`;
      const docType = detectDocType(allText);
      const docTypeLabel = docType === 'court_docket' ? 'court_docket'
        : docType === 'field_sheet' ? 'field_sheet'
        : 'unknown';

      // ── 5. Build structured dispatch description (for D1 which lacks addCol columns) ──
      const descLines: string[] = [];
      descLines.push(`SERVE ${(docs || 'DOCUMENTS').toUpperCase()} TO ${fullName.toUpperCase()}`);
      if (addrParts.address) descLines.push(`AT ${addrParts.address.toUpperCase()}`);
      if (dueDate) descLines.push(`DUE: ${dueDate}`);
      if (caseNumber) descLines.push(`CASE: ${caseNumber}`);
      if (jobNumber) descLines.push(`JOB: ${jobNumber}`);
      if (plaintiff) descLines.push(`PLAINTIFF: ${plaintiff.replace(/\n/g, ' ').trim().toUpperCase()}`);
      if (court) descLines.push(`COURT: ${court}`);
      descLines.push(`TYPE: ${processType.toUpperCase()}`);
      if (subjectDesc) descLines.push(`SUBJECT: ${subjectDesc}`);
      if (clientAddress) descLines.push(`CLIENT ADDR: ${clientAddress}`);
      if (instructions) {
        const cleaned = instructions.replace(/\r\n/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        descLines.push(`INSTRUCTIONS: ${cleaned.length > 500 ? cleaned.slice(0, 500) + '...' : cleaned}`);
      }
      if (serviceWindows) descLines.push(`WINDOWS: ${serviceWindows}`);
      const description = descLines.join('\n');

      // ── 6. Build rich system notes ──
      const noteId = () => String(Date.now() + Math.floor(Math.random() * 1000));
      const noteEntries: Array<{ id: string; author: string; text: string; timestamp: string }> = [];

      // Case overview note
      const overviewParts = [
        fullName ? `Defendant/Recipient: ${fullName}` : null,
        dob ? `DOB: ${dob}` : null,
        addrParts.address ? `Address: ${addrParts.address}` : null,
        plaintiff ? `Plaintiff: ${plaintiff.replace(/\n/g, ' ').trim()}` : null,
        court ? `Court: ${court}` : null,
        caseNumber ? `Case #: ${caseNumber}` : null,
        jobNumber ? `Job #: ${jobNumber}` : null,
        attorney.name ? `Attorney: ${attorney.name}${attorney.bar ? ` (Bar#${attorney.bar})` : ''}` : null,
        attorney.phone ? `Attorney Phone: ${attorney.phone}` : null,
        attorney.email ? `Attorney Email: ${attorney.email}` : null,
        dueDate ? `Serve By: ${dueDate}` : null,
        fee ? `Fee: ${fee}` : null,
      ].filter(Boolean);
      if (overviewParts.length > 0) {
        noteEntries.push({ id: noteId(), author: 'Serve Intake', text: '═══ CASE OVERVIEW ═══\n' + overviewParts.join('\n'), timestamp: now });
      }

      // Court Docket details
      const docketDetails: string[] = [];
      if (plaintiff) docketDetails.push(`Plaintiff: ${plaintiff.replace(/\n/g, ' ').trim()}`);
      if (court) docketDetails.push(`Court: ${court}`);
      if (caseNumber) docketDetails.push(`Case Number: ${caseNumber}`);
      if (attorney.name) docketDetails.push(`Attorney for Plaintiff: ${attorney.name}`);
      if (attorney.bar) docketDetails.push(`Bar Number: ${attorney.bar}`);
      if (attorney.phone) docketDetails.push(`Attorney Phone: ${attorney.phone}`);
      if (attorney.email) docketDetails.push(`Attorney Email: ${attorney.email}`);
      if (dueDate) docketDetails.push(`Hearing/Return Date: ${dueDate}`);
      const clerk = allText.match(/call the clerk.*?at\s*\((\d{3})\)\s*(\d{3}[-.]?\d{4})/i);
      if (clerk) docketDetails.push(`Court Clerk: (${clerk[1]}) ${clerk[2]}`);
      const courtAddr = allText.match(/(\d+ South State St.*?\d{5})/i);
      if (courtAddr) docketDetails.push(`Court Address: ${courtAddr[1]}`);
      if (docketDetails.length > 0) {
        noteEntries.push({ id: noteId(), author: 'Serve Intake', text: '═══ COURT DOCKET DETAILS ═══\n' + docketDetails.join('\n'), timestamp: now });
      }

      // Service Instructions note
      if (instructions && instructions.length > 20) {
        noteEntries.push({ id: noteId(), author: 'Serve Intake', text: `═══ SERVICE INSTRUCTIONS ═══\n${instructions}`, timestamp: now });
      }

      // Service Windows note
      if (serviceWindows) {
        noteEntries.push({ id: noteId(), author: 'Serve Intake', text: `═══ SERVICE WINDOWS ═══\n${serviceWindows}`, timestamp: now });
      }

      // Case Notes (extracted from document text)
      if (caseNotes) {
        noteEntries.push({ id: noteId(), author: 'Serve Intake', text: `═══ CASE NOTES ═══\n${caseNotes}`, timestamp: now });
      }

      // Document list note
      const docTypes = documents.map((d: any, i: number) => `  ${i + 1}. ${d.type || 'unknown'}${d.text ? ` (${d.text.length} chars)` : ''}`).join('\n');
      noteEntries.push({ id: noteId(), author: 'Serve Intake', text: `═══ DOCUMENTS PROCESSED ═══\n${docTypes}`, timestamp: now });

      // Narrative Report — detailed prose summary
      const narrativeReport = generateCaseNarrative({
        fullName, dob, address: addrParts.address, city: addrParts.city,
        state: addrParts.state, zip: addrParts.zip,
        plaintiff, court, caseNumber, jobNumber,
        attorney, docs, instructions, dueDate, fee,
        serviceWindows, clientAddress, allText,
      });
      noteEntries.push({ id: noteId(), author: 'Serve Intake', text: `═══ INTAKE NARRATIVE REPORT ═══\n${narrativeReport}`, timestamp: now });

      const notesJson = noteEntries.length > 0 ? JSON.stringify(noteEntries) : null;

      // ── 7. Create dispatch call with property reference ──
      // NOTE: Only using D1 base columns — addCol columns (pso_*, process_*, etc.)
      // don't exist in the D1 production schema. Extra data is embedded in description.
      const callResult = await db.prepare(`
        INSERT INTO calls_for_service (
          call_number, incident_type, priority, status,
          caller_name, caller_phone, caller_relationship,
          location_address, property_id, latitude, longitude,
          description, notes, source, dispatcher_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callNumber, 'pso_client_request', 'P4', 'pending',
        callerName, callerPhone, 'client',
        addrParts.address || 'Unknown', propertyId, null, null,
        description, notesJson, 'intake', user.userId,
        now
      );
      const callId = Number(callResult.meta.last_row_id);

      // ── 8. Link person to call (non-fatal — call_persons may not exist in D1) ──
      if (persons.length > 0) {
        try {
          await db.prepare(
            'INSERT INTO call_persons (call_id, person_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)'
          ).run(callId, persons[0].id, 'defendant', user.userId, now);
        } catch (_) { /* table may not exist in D1 */ }
      }

      // ── 9. Create serve_queue entry linked to call with full document text ──
      const serveResult = await db.prepare(`
        INSERT INTO serve_queue (call_id, client_id, case_number, recipient_name,
          recipient_address, recipient_city, recipient_state, recipient_zip,
          document_type, court_name, client_name, attorney_name, priority,
          deadline, service_instructions, notes, officer_id, sm_job_id,
          status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        callId, client_id || null, caseNumber || null, fullName || null,
        addrParts.address || null, addrParts.city || null, addrParts.state || null, addrParts.zip || null,
        docTypeLabel, court || null, plaintiff || null, attorney.name || null,
        'normal', dueDate || null, instructions || null, allText.substring(0, 500000) || null,
        null, jobNumber || null, 'pending', now, now
      );
      const serveId = Number(serveResult.meta.last_row_id);

      // ── 10. Return response ──
      return c.json({
        success: true,
        person_id: persons[0]?.id || null,
        property_id: propertyId,
        call_id: callId,
        call_number: callNumber,
        serve_queue_id: serveId,
        latitude: null,
        longitude: null,
        weather: null,
        lighting: null,
        persons: persons.map(p => ({ id: p.id, role: p.role })),
        extracted: {
          name,
          dob,
          address: addrParts.address,
          plaintiff,
          court,
          docs,
          instructions,
          jobNumber,
          caseNumber,
          dueDate,
          attorney,
          fee,
          serviceWindows,
          clientAddress,
          narrativeReport,
        },
      }, 201);
    } catch (err: any) {
      return c.json({
        error: 'Intake processing failed',
        code: 'INTAKE_PROCESSING_FAILED',
        detail: err instanceof Error ? err.message : String(err),
      }, 500);
    }
  });

  app.route('/api/serve-intake', api);
}
