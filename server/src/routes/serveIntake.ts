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

const router = Router();
router.use(authenticateToken);

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

    // Merge all document text
    const allText = documents.map((d: any) => d.text || '').join('\n\n');

    // Extract structured data
    const name = extractName(allText);
    const dob = extractDOB(allText);
    const address = extractAddress(allText);
    const plaintiff = extractPlaintiff(allText);
    const court = extractCourt(allText);
    const docs = extractDocuments(allText);
    const instructions = extractInstructions(allText);
    const jobNumber = extractJobNumber(allText);
    const caseNumber = extractCaseNumber(allText);
    const dueDate = extractDueDate(allText);
    const attorney = extractAttorney(allText);
    const fee = extractFee(allText);

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

    // 3. Create CFS dispatch call
    const descParts = [
      `SERVE: ${name.first} ${name.middle ? name.middle + ' ' : ''}${name.last}`,
      dob ? `DOB ${dob}` : '',
      instructions || '',
      plaintiff ? `CASE: ${plaintiff.replace(/\n/g, ' ').trim()} v. ${name.last}` : '',
      court ? `COURT: ${court}` : '',
      docs ? `DOCS: ${docs}` : '',
      jobNumber ? `JOB #${jobNumber}${caseNumber ? ` (${caseNumber})` : ''}` : '',
      attorney.name ? `ATT: ${attorney.name}${attorney.bar ? ` Bar#${attorney.bar}` : ''}${attorney.phone ? `, ${attorney.phone}` : ''}` : '',
      dueDate ? `DUE: ${dueDate}` : '',
    ].filter(Boolean).join('. ');

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
        caller_name, caller_phone, caller_relationship,
        location_address, property_id,
        description, source, dispatcher_id,
        pso_requestor_name, pso_requestor_phone, pso_requestor_email,
        pso_service_type, pso_billing_code, pso_authorization,
        process_service_type, process_served_to, process_served_address,
        process_attempts, client_id,
        created_at, updated_at
      ) VALUES (?, 'PSO Client Request', 'P4', 'pending', ?, ?, 'client', ?, ?, ?, 'phone', ?,
        ?, ?, ?, 'process_service', ?, ?,
        'summons', ?, ?, 0, ?, ?, ?)
    `).run(
      callNumber,
      'ICU Investigations, LLC', '(435) 986-1200',
      address || 'Unknown', propertyId,
      descParts, userId,
      attorney.name || null, attorney.phone || null, attorney.email || null,
      fee || null, `${jobNumber}-${caseNumber}`,
      `${name.first} ${name.middle ? name.middle + ' ' : ''}${name.last}`, address || null,
      client_id || 1, now, now
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
      extracted: { name, dob, address, plaintiff, court, docs, instructions, jobNumber, caseNumber, dueDate, attorney, fee },
    });
  } catch (err: any) {
    console.error('[ServeIntake] Error:', err?.message);
    res.status(500).json({ error: 'Intake processing failed: ' + (err?.message || 'Unknown error') });
  }
});

export default router;
