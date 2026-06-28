// ============================================================
// RMPG Flex — Enhanced Serve Intake utilities
// ============================================================
// Cloudflare Workers + D1 only. Imports from ./db for helpers.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst } from './db';

// ── Type definitions ────────────────────────────────────────

export interface Charge {
  statute: string;
  description?: string;
  count?: number;
}

export interface BatchDocument {
  id: string;
  text: string;
  ocrConfidence: number;
}

export interface ServeInstruction {
  queueId: number;
  address: string;
  lat: number | null;
  lng: number | null;
  defendant: { name: string; dob: string | null; aliases: string[] };
  specialInstructions: string;
  timeRestrictions: string;
  documentType: string;
  photoUrl: string | null;
}

export interface DuplicateMatch {
  queueId: number;
  caseNumber: string;
  defendantName: string;
  address: string;
  similarityScore: number;
  matchType: 'exact' | 'fuzzy_name' | 'fuzzy_address' | 'partial';
}

export interface DefendantMatch {
  source: 'persons' | 'serve_queue';
  id: number;
  name: string;
  dob: string | null;
  address: string | null;
  caseNumbers: string[];
  similarityScore: number;
}

export interface ChargeValidation {
  statute: string;
  count?: number;
  valid: boolean;
  recognized: boolean;
  descriptionMatch: 'match' | 'mismatch' | 'no_data' | 'partial';
  statuteDescription: string | null;
  offenseLevel: string | null;
  category: string | null;
}

export interface CourtDateConflict {
  queueId: number;
  caseNumber: string | null;
  defendantName: string | null;
  officerId: number | null;
  courtDate: string;
  documentType: string | null;
  status: string;
  conflictType: 'same_defendant' | 'same_officer';
}

export interface DocumentClassification {
  type: string;
  confidence: number;
  keywords: string[];
}

export interface BatchScanResult {
  id: string;
  classification: DocumentClassification;
  keyFields: Record<string, string>;
  validationErrors: string[];
  success: boolean;
}

export interface BatchSummary {
  total: number;
  successful: number;
  failed: number;
  typeDistribution: Record<string, number>;
}

// ── Levenshtein distance ────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1].toLowerCase() === a[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

function nameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / maxLen);
}

function normalizeAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  return addr
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|place|pl|way|circle|cir)\b/g, '')
    .replace(/\b(north|south|east|west|n|s|e|w)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressSimilarity(a: string | null, b: string | null): number {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / maxLen);
}

// ── 1. crossReferenceDefendant ──────────────────────────────

export async function crossReferenceDefendant(
  db: D1Database,
  defendantName: string,
  dob?: string | null,
): Promise<DefendantMatch[]> {
  const matches: DefendantMatch[] = [];
  const nameLower = defendantName.toLowerCase().trim();

  // Search persons table
  const personRows = await query<{
    id: number;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    dob: string | null;
    address: string | null;
  }>(
    db,
    `SELECT id, first_name, middle_name, last_name, dob, address
     FROM persons
     WHERE LOWER(first_name) = ? OR LOWER(last_name) = ? OR
           LOWER(first_name || ' ' || last_name) LIKE ?
     LIMIT 20`,
    nameLower.split(' ')[0] || nameLower,
    nameLower.split(' ').slice(-1)[0] || nameLower,
    `%${nameLower}%`,
  );

  for (const p of personRows) {
    const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
    const sim = nameSimilarity(defendantName, fullName);
    if (sim < 0.5) continue;

    let dobBoost = 0;
    if (dob && p.dob) {
      const dobMatch = normalizeDobMatch(dob, p.dob);
      dobBoost = dobMatch ? 0.2 : -0.1;
    }

    // Fetch case numbers from serve_queue
    const cases = await query<{ case_number: string | null }>(
      db,
      `SELECT DISTINCT case_number FROM serve_queue
       WHERE recipient_person_id = ? AND case_number IS NOT NULL
       LIMIT 10`,
      p.id,
    );

    matches.push({
      source: 'persons',
      id: p.id,
      name: fullName,
      dob: p.dob,
      address: p.address,
      caseNumbers: cases.map((c) => c.case_number!).filter(Boolean),
      similarityScore: Math.min(1, Math.max(0, sim + dobBoost)),
    });
  }

  // Search serve_queue for defendant_name column
  const queueRows = await query<{
    id: number;
    defendant_name: string | null;
    recipient_name: string | null;
    case_number: string | null;
    recipient_address: string | null;
    court_date: string | null;
  }>(
    db,
    `SELECT id, defendant_name, recipient_name, case_number, recipient_address, court_date
     FROM serve_queue
     WHERE LOWER(defendant_name) LIKE ? OR LOWER(recipient_name) LIKE ?
     LIMIT 20`,
    `%${nameLower}%`,
    `%${nameLower}%`,
  );

  const seenIds = new Set(matches.map((m) => `persons_${m.id}`));
  for (const q of queueRows) {
    const qName = q.defendant_name || q.recipient_name || '';
    const key = `queue_${q.id}`;
    if (seenIds.has(key)) continue;
    seenIds.add(key);

    const sim = nameSimilarity(defendantName, qName);
    if (sim < 0.5) continue;

    let dobBoost = 0;
    if (dob) {
      // Try to get DOB from linked person
      if (q.id) {
        const linkedPerson = await queryFirst<{ dob: string | null }>(
          db,
          `SELECT p.dob FROM persons p
           JOIN serve_queue sq ON sq.recipient_person_id = p.id
           WHERE sq.id = ? LIMIT 1`,
          q.id,
        );
        if (linkedPerson?.dob) {
          dobBoost = normalizeDobMatch(dob, linkedPerson.dob) ? 0.2 : -0.1;
        }
      }
    }

    matches.push({
      source: 'serve_queue',
      id: q.id,
      name: qName,
      dob: null,
      address: q.recipient_address,
      caseNumbers: q.case_number ? [q.case_number] : [],
      similarityScore: Math.min(1, Math.max(0, sim + dobBoost)),
    });
  }

  matches.sort((a, b) => b.similarityScore - a.similarityScore);
  return matches;
}

function normalizeDobMatch(a: string, b: string): boolean {
  const na = a.replace(/[^0-9]/g, '');
  const nb = b.replace(/[^0-9]/g, '');
  if (na.length === 8 && nb.length === 8) return na === nb;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ── 2. validateCharges ─────────────────────────────────────

export async function validateCharges(
  db: D1Database,
  charges: Charge[],
): Promise<ChargeValidation[]> {
  const results: ChargeValidation[] = [];

  for (const charge of charges) {
    const statute = charge.statute.trim();
    // Look up the statute in utah_statutes
    const statuteRow = await queryFirst<{
      id: number;
      citation: string;
      short_title: string;
      description: string | null;
      offense_level: string | null;
      category: string | null;
      is_active: number;
    }>(
      db,
      `SELECT id, citation, short_title, description, offense_level, category, is_active
       FROM utah_statutes
       WHERE citation = ? OR citation = ?
       LIMIT 1`,
      statute,
      statute.toUpperCase(),
    );

    if (!statuteRow) {
      // Try partial match on citation
      const partial = await queryFirst<{
        citation: string;
        short_title: string;
        description: string | null;
        offense_level: string | null;
        category: string | null;
      }>(
        db,
        `SELECT citation, short_title, description, offense_level, category
         FROM utah_statutes
         WHERE citation LIKE ? OR citation LIKE ?
         LIMIT 1`,
        `%${statute}%`,
        `%${statute.toUpperCase()}%`,
      );

      if (!partial) {
        results.push({
          statute,
          count: charge.count,
          valid: false,
          recognized: false,
          descriptionMatch: 'no_data',
          statuteDescription: null,
          offenseLevel: null,
          category: null,
        });
        continue;
      }

      // Partial match found — validate description if provided
      const descMatch = charge.description
        ? fuzzyDescriptionMatch(charge.description, partial.short_title, partial.description)
        : 'no_data';

      results.push({
        statute,
        count: charge.count,
        valid: true,
        recognized: true,
        descriptionMatch: descMatch,
        statuteDescription: partial.short_title,
        offenseLevel: partial.offense_level,
        category: partial.category,
      });
      continue;
    }

    // Exact match found
    const descMatch = charge.description
      ? fuzzyDescriptionMatch(charge.description, statuteRow.short_title, statuteRow.description)
      : 'no_data';

    results.push({
      statute,
      count: charge.count,
      valid: statuteRow.is_active === 1,
      recognized: true,
      descriptionMatch: descMatch,
      statuteDescription: statuteRow.short_title,
      offenseLevel: statuteRow.offense_level,
      category: statuteRow.category,
    });
  }

  return results;
}

function fuzzyDescriptionMatch(
  provided: string,
  shortTitle: string,
  fullDescription: string | null,
): 'match' | 'mismatch' | 'partial' | 'no_data' {
  if (!provided) return 'no_data';
  const pLower = provided.toLowerCase().trim();
  const tLower = shortTitle.toLowerCase().trim();

  if (pLower === tLower || tLower.includes(pLower) || pLower.includes(tLower)) {
    return 'match';
  }

  // Check word overlap
  const pWords = new Set(pLower.split(/\s+/));
  const tWords = new Set(tLower.split(/\s+/));
  let overlap = 0;
  for (const w of pWords) {
    if (tWords.has(w) && w.length > 2) overlap++;
  }
  if (overlap >= 2) return 'match';
  if (overlap === 1) return 'partial';

  // Check against full description
  if (fullDescription) {
    const fLower = fullDescription.toLowerCase();
    if (fLower.includes(pLower) || pLower.includes(fLower.slice(0, 50))) {
      return 'partial';
    }
  }

  return 'mismatch';
}

// ── 3. detectCourtDateConflicts ─────────────────────────────

export async function detectCourtDateConflicts(
  db: D1Database,
  courtDate: string,
  defendantId?: number,
): Promise<CourtDateConflict[]> {
  const conflicts: CourtDateConflict[] = [];
  const normalizedDate = courtDate.trim().slice(0, 10);

  // Check for defendant conflicts
  if (defendantId) {
    const defendantConflicts = await query<{
      id: number;
      case_number: string | null;
      defendant_name: string | null;
      officer_id: number | null;
      court_date: string | null;
      document_type: string | null;
      status: string;
    }>(
      db,
      `SELECT id, case_number, defendant_name, officer_id, court_date, document_type, status
       FROM serve_queue
       WHERE recipient_person_id = ? AND court_date IS NOT NULL AND status NOT IN ('served', 'cancelled', 'failed')
       LIMIT 20`,
      defendantId,
    );

    for (const row of defendantConflicts) {
      if (row.court_date && normalizeDateOnly(row.court_date) === normalizedDate) {
        conflicts.push({
          queueId: row.id,
          caseNumber: row.case_number,
          defendantName: row.defendant_name,
          officerId: row.officer_id,
          courtDate: row.court_date,
          documentType: row.document_type,
          status: row.status,
          conflictType: 'same_defendant',
        });
      }
    }
  }

  // Check for officer conflicts on the same date
  // Find officers who have active serves on the same court date
  const officerConflicts = await query<{
    id: number;
    case_number: string | null;
    defendant_name: string | null;
    officer_id: number | null;
    court_date: string | null;
    document_type: string | null;
    status: string;
  }>(
    db,
    `SELECT id, case_number, defendant_name, officer_id, court_date, document_type, status
     FROM serve_queue
     WHERE court_date IS NOT NULL AND officer_id IS NOT NULL AND status NOT IN ('served', 'cancelled', 'failed')
     LIMIT 50`,
  );

  const officerDateMap = new Map<number, typeof officerConflicts>();
  for (const row of officerConflicts) {
    if (!row.officer_id || !row.court_date) continue;
    if (normalizeDateOnly(row.court_date) !== normalizedDate) continue;
    if (defendantId && row.id in conflicts.map((c) => c.queueId)) continue;

    const existing = officerDateMap.get(row.officer_id) || [];
    existing.push(row);
    officerDateMap.set(row.officer_id, existing);
  }

  for (const [, rows] of officerDateMap) {
    if (rows.length >= 2) {
      for (const row of rows) {
        if (!conflicts.some((c) => c.queueId === row.id)) {
          conflicts.push({
            queueId: row.id,
            caseNumber: row.case_number,
            defendantName: row.defendant_name,
            officerId: row.officer_id,
            courtDate: row.court_date!,
            documentType: row.document_type,
            status: row.status,
            conflictType: 'same_officer',
          });
        }
      }
    }
  }

  return conflicts;
}

function normalizeDateOnly(dateStr: string): string {
  const d = dateStr.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parts = d.split(/[\/\-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4) return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
    if (c.length === 4) return `${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }
  return d;
}

// ── 4. classifyDocumentType ─────────────────────────────────

const DOC_TYPE_PATTERNS: Array<{ type: string; keywords: RegExp[]; weight: number }> = [
  {
    type: 'summons',
    keywords: [/\bsummons\b/i, /\bnotice to appear\b/i, /\bnotice of hearing\b/i, /\bplaintiff\b.*\bdefendant\b/i],
    weight: 1.0,
  },
  {
    type: 'complaint',
    keywords: [/\bcomplaint\b/i, /\bcause of action\b/i, /\bpetition\b/i, /\brelief sought\b/i, /\bprayer for relief\b/i],
    weight: 1.0,
  },
  {
    type: 'subpoena',
    keywords: [/\bsubpoena\b/i, /\bduces tecum\b/i, /\bwitness fee\b/i, /\byou are commanded\b/i, /\btestify\b/i],
    weight: 1.2,
  },
  {
    type: 'warrant',
    keywords: [/\bwarrant\b/i, /\bbench warrant\b/i, /\barrest warrant\b/i, /\bfailure to appear\b/i, /\bFTA\b/i, /\bbond\b.*\bbail\b/i],
    weight: 1.5,
  },
  {
    type: 'order_to_show_cause',
    keywords: [/\border to show cause\b/i, /\bshow cause\b/i, /\bOSC\b/, /\bwhy.*should not\b/i],
    weight: 1.1,
  },
  {
    type: 'protection_order',
    keywords: [/\bprotective order\b/i, /\brestraining order\b/i, /\border of protection\b/i, /\bstalking injunction\b/i, /\bno contact\b/i, /\bdomestic violence\b/i],
    weight: 1.3,
  },
  {
    type: 'eviction',
    keywords: [/\bevict/i, /\bunlawful detainer\b/i, /\bforcible entry\b/i, /\bnotice to quit\b/i, /\bnotice to vacate\b/i, /\bpay or quit\b/i],
    weight: 1.2,
  },
];

export function classifyDocumentType(
  text: string,
  confidence: number,
): DocumentClassification {
  const lowerText = text.toLowerCase();
  const scores: Array<{ type: string; score: number; keywords: string[] }> = [];

  for (const pattern of DOC_TYPE_PATTERNS) {
    const matchedKeywords: string[] = [];
    let hits = 0;
    for (const kw of pattern.keywords) {
      if (kw.test(text)) {
        hits++;
        const kwStr = kw.source.replace(/\\b/g, '').replace(/\\s\+/g, ' ');
        matchedKeywords.push(kwStr);
      }
    }
    if (hits > 0) {
      scores.push({
        type: pattern.type,
        score: (hits / pattern.keywords.length) * pattern.weight,
        keywords: matchedKeywords,
      });
    }
  }

  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0 || scores[0].score < 0.2) {
    return { type: 'other', confidence: Math.min(confidence, 0.3), keywords: [] };
  }

  const top = scores[0];
  const runnerUpScore = scores[1]?.score ?? 0;
  const classConfidence = Math.min(
    1,
    top.score * 0.6 + confidence * 0.3 + Math.max(0, top.score - runnerUpScore) * 0.1,
  );

  return {
    type: top.type,
    confidence: Number(classConfidence.toFixed(3)),
    keywords: top.keywords,
  };
}

// ── 5. batchScanDocuments ───────────────────────────────────

export async function batchScanDocuments(
  db: D1Database,
  documents: BatchDocument[],
): Promise<{ results: BatchScanResult[]; summary: BatchSummary }> {
  const results: BatchScanResult[] = [];
  const typeDistribution: Record<string, number> = {};

  for (const doc of documents) {
    try {
      const classification = classifyDocumentType(doc.text, doc.ocrConfidence);
      typeDistribution[classification.type] = (typeDistribution[classification.type] || 0) + 1;

      const keyFields = extractKeyFields(doc.text, classification.type);
      const validationErrors = validateKeyFields(keyFields, classification.type);

      results.push({
        id: doc.id,
        classification,
        keyFields,
        validationErrors,
        success: true,
      });
    } catch {
      results.push({
        id: doc.id,
        classification: { type: 'other', confidence: 0, keywords: [] },
        keyFields: {},
        validationErrors: ['Failed to process document'],
        success: false,
      });
    }
  }

  return {
    results,
    summary: {
      total: documents.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      typeDistribution,
    },
  };
}

function extractKeyFields(text: string, docType: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = text.split('\n');

  // Common patterns
  const caseNo = text.match(/(?:case|docket|cause)\s*(?:no|number|#)[:\s]*([A-Z0-9\-]+)/i);
  if (caseNo) fields.case_number = caseNo[1].trim();

  const courtDate = text.match(/(?:court|hearing|appearance)\s*(?:date|day)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (courtDate) fields.court_date = courtDate[1].trim();

  const deadline = text.match(/(?:deadline|serve\s*by|service\s*(?:deadline|by))[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (deadline) fields.deadline = deadline[1].trim();

  const defendant = text.match(/(?:defendant|respondent|served)\s*[:\s]*([A-Z][A-Za-z\s\-']+(?:,\s*[A-Z][A-Za-z\-']+)?)/i);
  if (defendant) fields.defendant_name = defendant[1].trim();

  const plaintiff = text.match(/(?:plaintiff|petitioner|complainant)\s*[:\s]*([A-Z][A-Za-z\s\-']+(?:,\s*[A-Z][A-Za-z\-']+)?)/i);
  if (plaintiff) fields.plaintiff_name = plaintiff[1].trim();

  const court = text.match(/(?:court|division)\s*[:\s]*([A-Z][A-Za-z\s\-']+(?:court)[A-Za-z\s\-']*)/i);
  if (court) fields.court_name = court[1].trim();

  // Type-specific fields
  if (docType === 'warrant') {
    const bond = text.match(/(?:bond|bail)\s*(?:amount)?[:\s]*\$?([\d,]+)/i);
    if (bond) fields.bond_amount = `$${bond[1].trim()}`;

    const warrantType = text.match(/(?:bench\s*warrant|arrest\s*warrant|capias)/i);
    if (warrantType) fields.warrant_type = warrantType[0].trim();
  }

  if (docType === 'subpoena') {
    const witnessFee = text.match(/(?:witness\s*fee)[:\s]*\$?([\d,]+)/i);
    if (witnessFee) fields.witness_fee = `$${witnessFee[1].trim()}`;
  }

  if (docType === 'protection_order') {
    const protectedParty = text.match(/(?:protected\s*party|protected\s*person)[:\s]*([A-Z][A-Za-z\s\-']+)/i);
    if (protectedParty) fields.protected_party = protectedParty[1].trim();
  }

  return fields;
}

function validateKeyFields(fields: Record<string, string>, docType: string): string[] {
  const errors: string[] = [];
  if (!fields.case_number) errors.push('Missing case number');
  if (!fields.defendant_name && !fields.plaintiff_name) errors.push('Missing party names');
  if (docType === 'warrant' && !fields.bond_amount) errors.push('Missing bond amount for warrant');
  return errors;
}

// ── 6. generateServeInstructions ────────────────────────────

export async function generateServeInstructions(
  db: D1Database,
  queueId: number,
): Promise<ServeInstruction | null> {
  const job = await queryFirst<{
    id: number;
    recipient_name: string | null;
    recipient_address: string | null;
    recipient_lat: number | null;
    recipient_lng: number | null;
    document_type: string | null;
    service_instructions: string | null;
    notes: string | null;
    priority: string | null;
    recipient_person_id: number | null;
    court_date: string | null;
    time_window: string | null;
  }>(
    db,
    `SELECT id, recipient_name, recipient_address, recipient_lat, recipient_lng,
            document_type, service_instructions, notes, priority,
            recipient_person_id, court_date, time_window
     FROM serve_queue WHERE id = ?`,
    queueId,
  );

  if (!job) return null;

  // Get defendant info
  let defendantName = job.recipient_name || 'Unknown';
  let dob: string | null = null;
  let aliases: string[] = [];

  if (job.recipient_person_id) {
    const person = await queryFirst<{
      first_name: string;
      middle_name: string | null;
      last_name: string;
      dob: string | null;
      address: string | null;
      notes: string | null;
    }>(
      db,
      `SELECT first_name, middle_name, last_name, dob, address, notes
       FROM persons WHERE id = ?`,
      job.recipient_person_id,
    );
    if (person) {
      defendantName = [person.first_name, person.middle_name, person.last_name]
        .filter(Boolean).join(' ');
      dob = person.dob;
    }
  }

  // Check for aliases in serve_queue_persons
  if (job.recipient_person_id) {
    const aliasRows = await query<{ alias_name: string }>(
      db,
      `SELECT alias_name FROM serve_queue_persons
       WHERE person_id = ? AND alias_name IS NOT NULL
       LIMIT 5`,
      job.recipient_person_id,
    );
    aliases = aliasRows.map((a) => a.alias_name).filter(Boolean);
  }

  // Build time restrictions
  let timeRestrictions = 'Standard hours (07:00–20:30)';
  if (job.time_window) {
    timeRestrictions = `Client window: ${job.time_window}`;
  } else if (job.document_type === 'eviction') {
    timeRestrictions = 'Business hours only (09:00–17:00)';
  } else if (job.priority === 'urgent') {
    timeRestrictions = 'Immediate — all hours allowed';
  }

  // Build special instructions
  const specialParts: string[] = [];
  if (job.service_instructions) specialParts.push(job.service_instructions);
  if (job.court_date) specialParts.push(`Court date: ${job.court_date} — serve with sufficient lead time`);
  if (job.priority === 'urgent') specialParts.push('URGENT — attempt immediately');
  if (job.priority === 'rush') specialParts.push('RUSH — prioritize this serve');

  // Check for location notes
  const locationNote = await queryFirst<{ note_text: string }>(
    db,
    `SELECT note_text FROM serve_location_notes
     WHERE address LIKE ? OR person_name LIKE ?
     LIMIT 1`,
    `%${job.recipient_address || ''}%`,
    `%${defendantName}%`,
  );
  if (locationNote) specialParts.push(`Location note: ${locationNote.note_text}`);

  // Check for photo
  const photo = await queryFirst<{ file_url: string }>(
    db,
    `SELECT file_url FROM field_photos
     WHERE call_id IN (
       SELECT call_id FROM serve_queue WHERE id = ?
     ) AND file_url IS NOT NULL
     LIMIT 1`,
    queueId,
  );

  return {
    queueId,
    address: job.recipient_address || 'Unknown address',
    lat: job.recipient_lat,
    lng: job.recipient_lng,
    defendant: { name: defendantName, dob, aliases },
    specialInstructions: specialParts.join('\n') || 'No special instructions',
    timeRestrictions,
    documentType: job.document_type || 'civil_paper',
    photoUrl: photo?.file_url ?? null,
  };
}

// ── 7. calculateAttemptPriority ─────────────────────────────

export async function calculateAttemptPriority(
  db: D1Database,
  queueId: number,
): Promise<{ priority: number; breakdown: Record<string, number> }> {
  const job = await queryFirst<{
    id: number;
    priority: string | null;
    document_type: string | null;
    created_at: string | null;
    deadline: string | null;
    attempt_count: number | null;
    officer_id: number | null;
    recipient_lat: number | null;
    recipient_lng: number | null;
    time_window: string | null;
  }>(
    db,
    `SELECT id, priority, document_type, created_at, deadline, attempt_count,
            officer_id, recipient_lat, recipient_lng, time_window
     FROM serve_queue WHERE id = ?`,
    queueId,
  );

  if (!job) return { priority: 0, breakdown: {} };

  const breakdown: Record<string, number> = {};

  // Days pending (older = higher, max 30 points)
  const daysPending = job.created_at
    ? Math.floor((Date.now() - new Date(job.created_at).getTime()) / 86_400_000)
    : 0;
  const pendingScore = Math.min(30, daysPending * 2);
  breakdown.days_pending = pendingScore;

  // Document type weight (warrants are critical)
  let docTypeScore = 5;
  switch (job.document_type) {
    case 'warrant': docTypeScore = 25; break;
    case 'subpoena': docTypeScore = 15; break;
    case 'protection_order': docTypeScore = 20; break;
    case 'eviction': docTypeScore = 12; break;
    case 'summons': docTypeScore = 10; break;
    case 'order_to_show_cause': docTypeScore = 18; break;
    case 'complaint': docTypeScore = 8; break;
  }
  breakdown.document_type = docTypeScore;

  // Deadline proximity (closer = higher, max 20 points)
  let deadlineScore = 0;
  if (job.deadline) {
    const daysUntilDeadline = Math.ceil(
      (new Date(job.deadline).getTime() - Date.now()) / 86_400_000,
    );
    if (daysUntilDeadline <= 0) deadlineScore = 20;
    else if (daysUntilDeadline <= 3) deadlineScore = 18;
    else if (daysUntilDeadline <= 7) deadlineScore = 12;
    else if (daysUntilDeadline <= 14) deadlineScore = 6;
  }
  breakdown.deadline_proximity = deadlineScore;

  // Business hours restriction (business hours only = harder to serve, +5)
  let timeRestrictionScore = 0;
  if (job.time_window) {
    timeRestrictionScore = 5;
  }
  breakdown.time_restriction = timeRestrictionScore;

  // Geographic difficulty (+5 if no coords, +3 if rural area)
  let geoScore = 0;
  if (!job.recipient_lat || !job.recipient_lng) geoScore = 5;
  else if (isRuralArea(job.recipient_lat, job.recipient_lng)) geoScore = 3;
  breakdown.geographic_difficulty = geoScore;

  // Server availability (higher if unassigned)
  let availabilityScore = 0;
  if (!job.officer_id) availabilityScore = 8;
  else {
    const officerLoad = await queryFirst<{ open_count: number }>(
      db,
      `SELECT COUNT(*) as open_count FROM serve_queue
       WHERE officer_id = ? AND status IN ('pending', 'assigned', 'in_progress', 'attempted')`,
      job.officer_id,
    );
    if (officerLoad && officerLoad.open_count > 5) availabilityScore = 3;
  }
  breakdown.server_availability = availabilityScore;

  // Attempt history (more attempts = higher priority, max 10)
  const attemptScore = Math.min(10, (job.attempt_count || 0) * 2);
  breakdown.attempt_history = attemptScore;

  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return { priority: total, breakdown };
}

function isRuralArea(lat: number, lng: number): boolean {
  // Rough heuristic: Salt Lake City metro bounds
  const slcBounds = { minLat: 40.45, maxLat: 41.0, minLng: -112.2, maxLng: -111.7 };
  return lat < slcBounds.minLat || lat > slcBounds.maxLat ||
         lng < slcBounds.minLng || lng > slcBounds.maxLng;
}

// ── 8. detectDuplicates ─────────────────────────────────────

export async function detectDuplicates(
  db: D1Database,
  caseNumber: string,
  defendantName: string,
  address: string,
): Promise<DuplicateMatch[]> {
  const duplicates: DuplicateMatch[] = [];

  const candidates = await query<{
    id: number;
    case_number: string | null;
    recipient_name: string | null;
    recipient_address: string | null;
    status: string;
  }>(
    db,
    `SELECT id, case_number, recipient_name, recipient_address, status
     FROM serve_queue
     WHERE status NOT IN ('served', 'cancelled', 'failed')
     LIMIT 50`,
  );

  for (const c of candidates) {
    let score = 0;
    let matchType: DuplicateMatch['matchType'] = 'partial';

    // Case number exact match (strongest signal)
    const caseMatch = c.case_number && caseNumber &&
      c.case_number.trim().toLowerCase() === caseNumber.trim().toLowerCase();
    if (caseMatch) score += 0.5;

    // Name similarity
    const nameSim = c.recipient_name
      ? nameSimilarity(defendantName, c.recipient_name)
      : 0;
    if (nameSim > 0.7) score += 0.3;
    else if (nameSim > 0.5) score += 0.15;

    // Address similarity
    const addrSim = addressSimilarity(c.recipient_address, address);
    if (addrSim > 0.8) score += 0.2;
    else if (addrSim > 0.6) score += 0.1;

    // Determine match type
    if (caseMatch && nameSim > 0.8) matchType = 'exact';
    else if (nameSim > 0.7 && !caseMatch) matchType = 'fuzzy_name';
    else if (addrSim > 0.7 && nameSim < 0.5) matchType = 'fuzzy_address';

    if (score >= 0.4) {
      duplicates.push({
        queueId: c.id,
        caseNumber: c.case_number || '',
        defendantName: c.recipient_name || '',
        address: c.recipient_address || '',
        similarityScore: Math.min(1, score),
        matchType,
      });
    }
  }

  duplicates.sort((a, b) => b.similarityScore - a.similarityScore);
  return duplicates;
}
