// ============================================================
// RMPG Flex — Evidence Chain of Custody (Spillman Flex Standard)
// 10 evidence & property features: chain of custody tracking,
// evidence barcoding, property room management, evidence audit
// trail, digital evidence hashing, evidence disposition workflow,
// lab submission tracking, evidence search log, property release
// authorization, and purge eligibility calculation.
// ============================================================

/* ── FEATURE 41: Chain of Custody Tracking ─────────────────
   Spillman Flex maintains an unbroken chain of custody for
   every piece of evidence from collection to disposition. */
export interface CustodyEntry {
  id: string;
  evidenceId: string;
  timestamp: Date;
  action: 'collected' | 'transferred' | 'checked_out' | 'checked_in' | 'lab_submitted' | 'lab_returned' | 'disposed' | 'released' | 'destroyed';
  fromPerson: string;
  toPerson: string | null;
  fromLocation: string;
  toLocation: string | null;
  reason: string;
  signatureRef: string | null;
}

export interface EvidenceItem {
  id: string;
  caseNumber: string;
  itemNumber: string;
  barcode: string;
  description: string;
  category: 'firearm' | 'narcotic' | 'document' | 'electronic' | 'biological' | 'trace' | 'currency' | 'vehicle' | 'clothing' | 'tool' | 'other';
  collectedBy: string;
  collectedAt: Date;
  location: string;
  storageLocation: string;
  condition: string;
  quantity: number;
  unit: string;
  packaging: string;
  status: 'in_custody' | 'checked_out' | 'lab' | 'court' | 'released' | 'disposed' | 'destroyed';
  custodyChain: CustodyEntry[];
  digitalHash: string | null;
  notes: string;
}

export function validateChainOfCustody(item: EvidenceItem): { valid: boolean; gaps: string[]; warnings: string[] } {
  const gaps: string[] = [];
  const warnings: string[] = [];
  const chain = item.custodyChain.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (chain.length === 0) {
    gaps.push('No custody entries — chain of custody is empty');
    return { valid: false, gaps, warnings };
  }

  // First entry must be 'collected'
  if (chain[0].action !== 'collected') {
    gaps.push('Chain does not start with collection');
  }

  // Check for time gaps > 24 hours between transfers
  for (let i = 1; i < chain.length; i++) {
    const gap = (chain[i].timestamp.getTime() - chain[i - 1].timestamp.getTime()) / 3600000;
    if (gap > 24) {
      warnings.push(`Gap of ${Math.round(gap)} hours between ${chain[i - 1].action} and ${chain[i].action}`);
    }
  }

  // Every transfer must have a recipient
  const transferActions = ['transferred', 'checked_out', 'lab_submitted'];
  for (const entry of chain) {
    if (transferActions.includes(entry.action) && !entry.toPerson) {
      gaps.push(`Transfer entry (${entry.action}) missing recipient`);
    }
  }

  return { valid: gaps.length === 0, gaps, warnings };
}

/* ── FEATURE 42: Evidence Barcode Generator ────────────────
   Spillman Flex uses barcoded labels for evidence tracking.
   Generates a unique barcode format per department standard. */
export function generateEvidenceBarcode(
  year: number,
  caseNumber: string,
  itemSequence: number
): string {
  const yr = String(year).slice(-2);
  const caseNum = caseNumber.replace(/\D/g, '').slice(-6).padStart(6, '0');
  const seq = String(itemSequence).padStart(4, '0');
  return `EVD${yr}-${caseNum}-${seq}`;
}

export function parseEvidenceBarcode(barcode: string): { year: number; caseNumber: string; sequence: number } | null {
  const match = barcode.match(/^EVD(\d{2})-(\d{6})-(\d{4})$/);
  if (!match) return null;
  return {
    year: 2000 + parseInt(match[1]),
    caseNumber: match[2],
    sequence: parseInt(match[3]),
  };
}

/* ── FEATURE 43: Property Room Management ──────────────────
   Spillman Flex tracks evidence storage locations with
   bin/shelf/row identifiers for efficient retrieval. */
export interface StorageLocation {
  id: string;
  room: string;
  aisle: string;
  shelf: string;
  bin: string;
  category: string;
  capacity: number;
  occupied: number;
  temperature: 'ambient' | 'refrigerated' | 'frozen';
  restricted: boolean;
  notes: string;
}

export function assignStorageLocation(
  item: EvidenceItem,
  availableLocations: StorageLocation[]
): StorageLocation | null {
  // Match by category first
  const categoryMatch = availableLocations.filter(l => l.category === item.category && l.occupied < l.capacity && !l.restricted);
  if (categoryMatch.length > 0) return categoryMatch[0];

  // Fallback to any available location
  const anyMatch = availableLocations.filter(l => l.occupied < l.capacity && !l.restricted);
  return anyMatch.length > 0 ? anyMatch[0] : null;
}

/* ── FEATURE 44: Evidence Audit Trail ──────────────────────
   Spillman Flex logs every access, view, and modification of
   evidence records for audit compliance. */
export interface EvidenceAuditEntry {
  id: string;
  evidenceId: string;
  timestamp: Date;
  userId: string;
  action: 'viewed' | 'created' | 'updated' | 'transferred' | 'disposed' | 'exported' | 'printed';
  details: string;
  ipAddress: string | null;
}

export function logEvidenceAudit(
  evidenceId: string,
  userId: string,
  action: EvidenceAuditEntry['action'],
  details: string
): EvidenceAuditEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    evidenceId,
    timestamp: new Date(),
    userId,
    action,
    details,
    ipAddress: null,
  };
}

/* ── FEATURE 45: Digital Evidence Integrity ────────────────
   Spillman Flex generates and verifies SHA-256 hashes for all
   digital evidence files to ensure integrity. */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function verifyFileIntegrity(
  originalHash: string,
  currentHash: string
): { intact: boolean; message: string } {
  if (originalHash === currentHash) {
    return { intact: true, message: 'File integrity verified — hash matches original' };
  }
  return { intact: false, message: 'WARNING: File hash mismatch — evidence may have been tampered with or corrupted' };
}

/* ── FEATURE 46: Evidence Disposition Workflow ─────────────
   Spillman Flex provides a structured workflow for evidence
   disposition: retention review, DA approval, release/destroy. */
export type DispositionAction = 'retain' | 'release_to_owner' | 'release_to_attorney' | 'donate' | 'destroy' | 'convert_to_department' | 'auction';

export interface DispositionRequest {
  evidenceId: string;
  requestedBy: string;
  requestedAt: Date;
  action: DispositionAction;
  justification: string;
  daApproval: boolean;
  daApprovedBy: string | null;
  daApprovedAt: Date | null;
  supervisorApproval: boolean;
  supervisorApprovedBy: string | null;
  supervisorApprovedAt: Date | null;
  status: 'pending' | 'da_review' | 'supervisor_review' | 'approved' | 'denied' | 'completed';
  completedAt: Date | null;
  completedBy: string | null;
}

export const DISPOSITION_RETENTION: Record<string, number> = {
  homicide: 99,         // years (indefinite)
  felony_violent: 30,
  felony_property: 10,
  misdemeanor: 5,
  traffic: 2,
  infraction: 1,
  juvenile: 5,          // or until age 21, whichever is longer
  narcotic: 5,
  firearm: 99,
  dna: 99,
  unsolved: 99,         // until solved or statute of limitations expires
};

export function checkDispositionEligibility(
  item: EvidenceItem,
  caseType: string,
  caseClosedDate: Date | null,
  hasAppeal: boolean
): { eligible: boolean; retentionYears: number; releaseDate: Date | null; blockers: string[] } {
  const blockers: string[] = [];
  const retentionYears = DISPOSITION_RETENTION[caseType] || 5;

  if (!caseClosedDate) {
    blockers.push('Case is still open — evidence must be retained');
  }

  if (hasAppeal) {
    blockers.push('Case has active appeal — evidence must be retained until appeal resolved');
  }

  if (item.status === 'checked_out' || item.status === 'lab' || item.status === 'court') {
    blockers.push(`Evidence currently ${item.status.replace(/_/g, ' ')} — cannot dispose`);
  }

  let releaseDate: Date | null = null;
  if (caseClosedDate) {
    releaseDate = new Date(caseClosedDate);
    releaseDate.setFullYear(releaseDate.getFullYear() + retentionYears);
  }

  return {
    eligible: blockers.length === 0 && !!releaseDate && releaseDate <= new Date(),
    retentionYears,
    releaseDate,
    blockers,
  };
}

/* ── FEATURE 47: Lab Submission Tracking ───────────────────
   Spillman Flex tracks forensic lab submissions with
   submission forms, chain of custody, and results tracking. */
export interface LabSubmission {
  id: string;
  evidenceIds: string[];
  labName: string;
  labCaseNumber: string;
  submittedBy: string;
  submittedAt: Date;
  requestedTests: string[];
  priority: 'routine' | 'expedited' | 'stat';
  status: 'preparing' | 'submitted' | 'in_progress' | 'completed' | 'returned';
  resultsSummary: string | null;
  resultsReceivedAt: Date | null;
  estimatedCompletion: Date | null;
  notes: string;
}

export function calculateLabEta(
  submission: LabSubmission,
  averageProcessingDays: Record<string, number>
): Date {
  const totalDays = submission.requestedTests.reduce((sum, test) => sum + (averageProcessingDays[test] || 30), 0);
  const multiplier = submission.priority === 'stat' ? 0.3 : submission.priority === 'expedited' ? 0.6 : 1.0;
  const eta = new Date(submission.submittedAt);
  eta.setDate(eta.getDate() + Math.round(totalDays * multiplier));
  return eta;
}

/* ── FEATURE 48: Evidence Search Log ───────────────────────
   Spillman Flex logs all evidence searches for discovery
   compliance and audit purposes. */
export interface EvidenceSearch {
  id: string;
  searchedBy: string;
  searchedAt: Date;
  query: string;
  filters: Record<string, string>;
  resultCount: number;
  resultsExported: boolean;
  searchPurpose: string;
}

export function logEvidenceSearch(
  userId: string,
  query: string,
  filters: Record<string, string>,
  resultCount: number,
  purpose: string
): EvidenceSearch {
  return {
    id: `search-${Date.now()}`,
    searchedBy: userId,
    searchedAt: new Date(),
    query,
    filters,
    resultCount,
    resultsExported: false,
    searchPurpose: purpose,
  };
}

/* ── FEATURE 49: Property Release Authorization ────────────
   Spillman Flex requires authorization before releasing
   property to owners, attorneys, or other parties. */
export interface ReleaseAuthorization {
  id: string;
  evidenceId: string;
  releaseTo: string;
  releaseToType: 'owner' | 'attorney' | 'insurance' | 'other_agency' | 'other';
  releaseToId: string | null;  // DL or ID number
  authorizedBy: string;
  authorizedAt: Date;
  releaseConditions: string[];
  identificationVerified: boolean;
  signatureObtained: boolean;
  photoIdCaptured: boolean;
  status: 'pending' | 'authorized' | 'released' | 'denied';
  releasedAt: Date | null;
  releasedBy: string | null;
}

export function validateReleaseAuthorization(auth: ReleaseAuthorization): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!auth.releaseTo) missing.push('Release recipient name required');
  if (!auth.releaseToId) missing.push('Recipient photo ID required');
  if (!auth.identificationVerified) missing.push('Photo ID must be verified');
  if (!auth.signatureObtained) missing.push('Release signature required');
  if (!auth.authorizedBy) missing.push('Authorizing officer required');

  return { valid: missing.length === 0, missing };
}

/* ── FEATURE 50: Evidence Purge Eligibility ────────────────
   Spillman Flex calculates when evidence is eligible for
   purging based on case status and retention schedules. */
export interface PurgeEligibility {
  evidenceId: string;
  caseNumber: string;
  caseStatus: string;
  collectionDate: Date;
  retentionYears: number;
  retentionExpires: Date;
  eligibleNow: boolean;
  requiresDAApproval: boolean;
  requiresNotification: boolean;
  purgeMethod: 'destroy' | 'auction' | 'donate' | 'convert' | 'return';
  notifications: string[];
}

export function calculatePurgeEligibility(
  item: EvidenceItem,
  caseType: string,
  caseClosedDate: Date | null,
  statutoryMinimum: number
): PurgeEligibility {
  const retentionYears = DISPOSITION_RETENTION[caseType] || statutoryMinimum;
  const retentionExpires = new Date(item.collectedAt);
  retentionExpires.setFullYear(retentionExpires.getFullYear() + retentionYears);

  const eligibleNow = !!caseClosedDate && retentionExpires <= new Date();

  let purgeMethod: PurgeEligibility['purgeMethod'] = 'destroy';
  if (item.category === 'firearm') purgeMethod = 'destroy';
  else if (item.category === 'currency') purgeMethod = 'convert';
  else if (item.category === 'vehicle') purgeMethod = 'auction';
  else if (item.category === 'clothing' || item.category === 'tool') purgeMethod = 'donate';

  const notifications: string[] = [];
  if (eligibleNow) {
    if (item.category === 'firearm') notifications.push('Firearm destruction requires court order');
    if (item.category === 'narcotic') notifications.push('Narcotics destruction requires DEA-compliant witness');
    if (item.category === 'currency') notifications.push('Currency must be deposited per department policy');
  }

  return {
    evidenceId: item.id,
    caseNumber: item.caseNumber,
    caseStatus: caseClosedDate ? 'closed' : 'open',
    collectionDate: item.collectedAt,
    retentionYears,
    retentionExpires,
    eligibleNow,
    requiresDAApproval: retentionYears >= 10,
    requiresNotification: item.category === 'firearm' || item.category === 'narcotic',
    purgeMethod,
    notifications,
  };
}
