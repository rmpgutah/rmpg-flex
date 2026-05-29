// ============================================================
// RMPG Flex — Record PDF Generator Extensions
//
// Four additional record types that were missing from the
// original v1 generator (recordPdfGenerator.ts):
//   - case            Case file with cover + linked appendices
//   - field_interview Field interview contact card
//   - court_event     Court appearance subpoena / summary
//   - jail_booking    Jail booking sheet with charges
//
// Kept in a separate module so the original 5,000-line file
// stays focused on the 9 long-shipped types. The main
// `generateRecordPdf` switch dispatches to these by importing.
// ============================================================

import jsPDF from 'jspdf';
import { parseTimestamp } from './dateUtils';
import {
  openAutoSection, closeAutoSection, addFieldPair,
  addStackedSignatures, addTableWithShading, addNarrativeSection,
  checkPageBreak, setActiveCaseNumber,
} from './pdfGenerator';
import { drawCautionFlagStrip, type CautionFlag } from './pdfFormHelpers';
import {
  SPACING, PDF_VALUE_FONT, getContentWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth, getFullFieldWidth,
  LAYOUT,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import {
  addQuickReferenceBanner, addLinkedRecordsStrip, addSeverityMeter,
  type QuickRefBannerConfig,
} from './pdfDetailHelpers';

// ── Data Interfaces ──────────────────────────────────────

export interface CasePdfData {
  id?: number;
  case_number: string;
  title: string;
  case_type?: string;
  status?: string;
  priority?: string;
  lead_investigator_name?: string;
  assigned_officer_names?: string[];
  solvability_score?: number;
  summary?: string;
  narrative?: string;
  disposition?: string;
  disposition_date?: string;
  opened_date?: string;
  due_date?: string;
  closed_date?: string;
  // Joined appendices (caller provides; missing arrays render as empty)
  linked_persons?: Array<{ id: number; first_name?: string; last_name?: string; date_of_birth?: string; relationship?: string }>;
  linked_incidents?: Array<{ id: number; incident_number: string; incident_type?: string; status?: string; created_at?: string }>;
  linked_evidence?: Array<{ id: number; item_number?: string; description?: string; status?: string; collected_at?: string }>;
  linked_citations?: Array<{ id: number; citation_number: string; type?: string; status?: string; violation_date?: string }>;
  linked_warrants?: Array<{ id: number; warrant_number: string; type?: string; status?: string; charge_description?: string }>;
}

export interface FieldInterviewPdfData {
  id?: number;
  fi_number: string;
  status?: string;
  // Subject
  subject_first_name?: string;
  subject_last_name?: string;
  subject_dob?: string;
  subject_gender?: string;
  subject_race?: string;
  subject_height?: string;
  subject_weight?: string;
  subject_hair?: string;
  subject_eye?: string;
  subject_clothing?: string;
  subject_description?: string;
  // Contact
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  contact_reason: string;
  contact_type?: string;
  action_taken?: string;
  // Vehicle observed
  vehicle_plate?: string;
  vehicle_description?: string;
  // Officer + narrative
  officer_name?: string;
  badge_number?: string;
  narrative?: string;
  associated_call_id?: string;
  associated_incident_id?: string;
  created_at?: string;
}

export interface CourtEventPdfData {
  id?: number;
  event_number: string;
  event_type: string;
  status?: string;
  event_date: string;
  event_time?: string;
  // Court info
  court_name?: string;
  courtroom?: string;
  judge_name?: string;
  court_case_number?: string;
  // Parties
  defendant_name?: string;
  prosecutor?: string;
  defense_attorney?: string;
  officers_required?: string[];
  // Linked records
  citation_number?: string;
  incident_number?: string;
  case_number?: string;
  // Outcome (if concluded)
  outcome?: string;
  sentence?: string;
  fine_amount?: number | null;
  notes?: string;
  created_at?: string;
}

export interface JailBookingPdfData {
  id?: number;
  source_id?: string;
  source_name?: string;
  // Subject
  full_name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  date_of_birth?: string;
  // Booking
  booking_date?: string;
  charges?: string;          // free-text from JailBase or comma-separated
  county?: string;
  status?: string;
  mugshot_url?: string;
  details_url?: string;
  // Optional pre-parsed charges table (newline-separated → rows)
  charge_lines?: string[];
}

// ── Generators ───────────────────────────────────────────

export async function generateCaseReport(doc: jsPDF, data: CasePdfData): Promise<void> {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.case_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'INVESTIGATIVE CASE FILE',
    formNumber: 'FORM PS-301',
    caseNumber: data.case_number,
    caseNumberLabel: 'CASE NUMBER',
  });

  // Quick-reference banner — case# + title + status pill
  {
    const status = String(data.status || 'open').toLowerCase();
    const pill: QuickRefBannerConfig['pill'] = status === 'open'
      ? { label: 'OPEN', tone: 'elevated' }
      : status === 'closed' || status === 'cleared' || status === 'archived'
        ? { label: status.toUpperCase(), tone: 'inactive' }
        : status === 'cold' || status === 'suspended'
          ? { label: status.toUpperCase(), tone: 'standard' }
          : { label: status.toUpperCase(), tone: 'standard' };
    y = addQuickReferenceBanner(doc, {
      primary: data.case_number,
      secondary: [data.case_type?.toUpperCase(), data.title].filter(Boolean).join(' · '),
      pill,
    }, y);
  }

  // Cross-reference badge bar — counts of linked records, with the
  // helper's standard tone rules (active warrants → risk red).
  y = addLinkedRecordsStrip(doc, {
    warrants: data.linked_warrants,
    incidents: data.linked_incidents,
    citations: data.linked_citations,
  }, y);

  // Solvability meter — visual gauge for the 0-100 score (inverted:
  // higher score = greener, since high solvability is good).
  if (typeof data.solvability_score === 'number') {
    const x = LAYOUT.PAGE_MARGIN + 4;
    const w = doc.internal.pageSize.getWidth() - 2 * (LAYOUT.PAGE_MARGIN + 4);
    y = addSeverityMeter(doc, {
      label: 'SOLVABILITY SCORE',
      value: data.solvability_score,
      invert: true,
    }, x, y, w);
  }

  // ── Case Overview ─────────────────────────────────────
  y = checkPageBreak(doc, y, 25);
  { const sec = openAutoSection(doc, 'Case Overview', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Case Number', data.case_number, lx, y, hfw);
    const r1b = addFieldPair(doc, 'Status', (data.status || 'OPEN').toUpperCase(), rx, y, hfw);
    y = Math.max(r1a, r1b);
    y = addFieldPair(doc, 'Title', data.title || '', lx, y, ffw);
    const r3a = addFieldPair(doc, 'Case Type', (data.case_type || 'general').toUpperCase(), lx, y, hfw);
    const r3b = addFieldPair(doc, 'Priority', (data.priority || 'normal').toUpperCase(), rx, y, hfw);
    y = Math.max(r3a, r3b);
    if (data.solvability_score != null) {
      y = addFieldPair(doc, 'Solvability Score', `${data.solvability_score}/100`, lx, y, hfw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Timeline ──────────────────────────────────────────
  y = checkPageBreak(doc, y, 18);
  { const sec = openAutoSection(doc, 'Timeline', y); y = sec.contentY;
    const tw = ffw / 3;
    const t1 = addFieldPair(doc, 'Opened', formatDate(data.opened_date), lx, y, tw);
    const t2 = addFieldPair(doc, 'Due Date', formatDate(data.due_date), lx + tw, y, tw);
    const t3 = addFieldPair(doc, 'Closed', formatDate(data.closed_date), lx + tw * 2, y, tw);
    y = Math.max(t1, t2, t3);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Investigation Team ────────────────────────────────
  if (data.lead_investigator_name || (data.assigned_officer_names && data.assigned_officer_names.length > 0)) {
    y = checkPageBreak(doc, y, 18);
    const sec = openAutoSection(doc, 'Investigation Team', y); y = sec.contentY;
    if (data.lead_investigator_name) {
      y = addFieldPair(doc, 'Lead Investigator', data.lead_investigator_name, lx, y, ffw);
    }
    if (data.assigned_officer_names && data.assigned_officer_names.length > 0) {
      y = addFieldPair(doc, 'Assigned Officers', data.assigned_officer_names.join(', '), lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Summary ───────────────────────────────────────────
  if (data.summary) {
    y = addNarrativeSection(doc, 'Case Summary', data.summary, y, data.priority);
  }

  // ── Narrative ─────────────────────────────────────────
  if (data.narrative) {
    y = addNarrativeSection(doc, 'Investigative Narrative', data.narrative, y, data.priority);
  }

  // ── Linked Persons ────────────────────────────────────
  if (data.linked_persons && data.linked_persons.length > 0) {
    y = renderLinkedTable(doc, y, 'Linked Persons',
      ['NAME', 'DOB', 'RELATIONSHIP'],
      [40, 18, 26],
      data.linked_persons.map(p => [
        `${p.last_name || ''}, ${p.first_name || ''}`.trim(),
        formatDate(p.date_of_birth),
        p.relationship || '',
      ]),
    );
  }

  // ── Linked Incidents ──────────────────────────────────
  if (data.linked_incidents && data.linked_incidents.length > 0) {
    y = renderLinkedTable(doc, y, 'Linked Incidents',
      ['INCIDENT #', 'TYPE', 'STATUS', 'DATE'],
      [22, 30, 14, 18],
      data.linked_incidents.map(i => [
        i.incident_number || '',
        i.incident_type || '',
        i.status || '',
        formatDate(i.created_at),
      ]),
    );
  }

  // ── Linked Evidence ───────────────────────────────────
  if (data.linked_evidence && data.linked_evidence.length > 0) {
    y = renderLinkedTable(doc, y, 'Linked Evidence',
      ['ITEM #', 'DESCRIPTION', 'STATUS', 'COLLECTED'],
      [16, 38, 14, 18],
      data.linked_evidence.map(e => [
        e.item_number || '',
        e.description || '',
        e.status || '',
        formatDate(e.collected_at),
      ]),
    );
  }

  // ── Linked Citations ──────────────────────────────────
  if (data.linked_citations && data.linked_citations.length > 0) {
    y = renderLinkedTable(doc, y, 'Linked Citations',
      ['CITATION #', 'TYPE', 'STATUS', 'VIOLATION DATE'],
      [22, 22, 14, 18],
      data.linked_citations.map(c => [
        c.citation_number || '',
        c.type || '',
        c.status || '',
        formatDate(c.violation_date),
      ]),
    );
  }

  // ── Linked Warrants ───────────────────────────────────
  if (data.linked_warrants && data.linked_warrants.length > 0) {
    y = renderLinkedTable(doc, y, 'Linked Warrants',
      ['WARRANT #', 'TYPE', 'STATUS', 'CHARGE'],
      [20, 16, 12, 36],
      data.linked_warrants.map(w => [
        w.warrant_number || '',
        w.type || '',
        w.status || '',
        w.charge_description || '',
      ]),
    );
  }

  // ── Disposition ───────────────────────────────────────
  if (data.disposition) {
    y = checkPageBreak(doc, y, 16);
    const sec = openAutoSection(doc, 'Disposition', y); y = sec.contentY;
    const dr1a = addFieldPair(doc, 'Outcome', data.disposition, lx, y, hfw);
    const dr1b = addFieldPair(doc, 'Disposition Date', formatDate(data.disposition_date), rx, y, hfw);
    y = Math.max(dr1a, dr1b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Signature ─────────────────────────────────────────
  y = addStackedSignatures(doc, 'Lead Investigator', '', y, undefined, undefined, data.priority);

  void ffw; // referenced inside conditionals only; silence lint
}

export async function generateFieldInterviewReport(doc: jsPDF, data: FieldInterviewPdfData): Promise<void> {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.fi_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'FIELD INTERVIEW CARD',
    formNumber: 'FORM PS-401',
    caseNumber: data.fi_number,
    caseNumberLabel: 'FI NUMBER',
  });

  // Quick-reference banner — fi# + subject + reason pill
  {
    const subj = [data.subject_last_name, data.subject_first_name]
      .filter(Boolean).join(', ').toUpperCase() || 'UNIDENTIFIED SUBJECT';
    const reason = (data.contact_reason || '').toLowerCase();
    const pill: QuickRefBannerConfig['pill'] | undefined = reason === 'suspicious_activity' || reason === 'investigative_stop'
      ? { label: reason.replace(/_/g, ' ').toUpperCase(), tone: 'elevated' }
      : reason
        ? { label: reason.replace(/_/g, ' ').toUpperCase(), tone: 'standard' }
        : undefined;
    y = addQuickReferenceBanner(doc, {
      primary: data.fi_number,
      secondary: subj,
      pill,
    }, y);
  }

  // ── Subject Information ───────────────────────────────
  y = checkPageBreak(doc, y, 28);
  { const sec = openAutoSection(doc, 'Subject Information', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Last Name', data.subject_last_name || '', lx, y, hfw);
    const r1b = addFieldPair(doc, 'First Name', data.subject_first_name || '', rx, y, hfw);
    y = Math.max(r1a, r1b);
    const tw = ffw / 4;
    const r2a = addFieldPair(doc, 'DOB', formatDate(data.subject_dob), lx, y, tw);
    const r2b = addFieldPair(doc, 'Sex', data.subject_gender || '', lx + tw, y, tw);
    const r2c = addFieldPair(doc, 'Race', data.subject_race || '', lx + tw * 2, y, tw);
    const r2d = addFieldPair(doc, 'Status', (data.status || '').toUpperCase(), lx + tw * 3, y, tw);
    y = Math.max(r2a, r2b, r2c, r2d);
    const r3a = addFieldPair(doc, 'Height', data.subject_height || '', lx, y, tw);
    const r3b = addFieldPair(doc, 'Weight', data.subject_weight || '', lx + tw, y, tw);
    const r3c = addFieldPair(doc, 'Hair', data.subject_hair || '', lx + tw * 2, y, tw);
    const r3d = addFieldPair(doc, 'Eyes', data.subject_eye || '', lx + tw * 3, y, tw);
    y = Math.max(r3a, r3b, r3c, r3d);
    if (data.subject_clothing) {
      y = addFieldPair(doc, 'Clothing Description', data.subject_clothing, lx, y, ffw);
    }
    if (data.subject_description) {
      y = addFieldPair(doc, 'Other Identifiers', data.subject_description, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Contact ───────────────────────────────────────────
  y = checkPageBreak(doc, y, 24);
  { const sec = openAutoSection(doc, 'Contact', y); y = sec.contentY;
    y = addFieldPair(doc, 'Location', data.location || '', lx, y, ffw);
    if (data.latitude != null || data.longitude != null) {
      const r2a = addFieldPair(doc, 'Latitude', data.latitude != null ? String(data.latitude) : '', lx, y, hfw);
      const r2b = addFieldPair(doc, 'Longitude', data.longitude != null ? String(data.longitude) : '', rx, y, hfw);
      y = Math.max(r2a, r2b);
    }
    const tw = ffw / 3;
    const r3a = addFieldPair(doc, 'Reason', (data.contact_reason || 'OTHER').toUpperCase(), lx, y, tw);
    const r3b = addFieldPair(doc, 'Type', (data.contact_type || 'FIELD').toUpperCase(), lx + tw, y, tw);
    const r3c = addFieldPair(doc, 'Action Taken', (data.action_taken || 'NONE').toUpperCase(), lx + tw * 2, y, tw);
    y = Math.max(r3a, r3b, r3c);
    if (data.associated_call_id || data.associated_incident_id) {
      const r4a = addFieldPair(doc, 'Associated Call', data.associated_call_id || '', lx, y, hfw);
      const r4b = addFieldPair(doc, 'Associated Incident', data.associated_incident_id || '', rx, y, hfw);
      y = Math.max(r4a, r4b);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Vehicle (if observed) ─────────────────────────────
  if (data.vehicle_plate || data.vehicle_description) {
    y = checkPageBreak(doc, y, 12);
    const sec = openAutoSection(doc, 'Vehicle Observed', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Plate', data.vehicle_plate || '', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Description', data.vehicle_description || '', rx, y, hfw);
    y = Math.max(r1a, r1b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Narrative ─────────────────────────────────────────
  if (data.narrative) {
    y = addNarrativeSection(doc, 'Officer Narrative', data.narrative, y);
  }

  // ── Officer + Signature ───────────────────────────────
  y = addStackedSignatures(doc, 'Interviewing Officer', '', y);
}

export async function generateCourtEventReport(doc: jsPDF, data: CourtEventPdfData): Promise<void> {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  setActiveCaseNumber(data.event_number);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: data.event_type === 'subpoena' ? 'COURT SUBPOENA' : 'COURT EVENT NOTICE',
    formNumber: 'FORM PS-501',
    caseNumber: data.event_number,
    caseNumberLabel: 'EVENT NUMBER',
  });

  // Quick-reference banner — event# + hearing date + status pill
  {
    const status = String(data.status || 'scheduled').toLowerCase();
    const pill: QuickRefBannerConfig['pill'] = status === 'concluded'
      ? { label: 'CONCLUDED', tone: 'inactive' }
      : status === 'continued' || status === 'rescheduled'
        ? { label: status.toUpperCase(), tone: 'elevated' }
        : status === 'failure_to_appear' || status === 'fta'
          ? { label: 'FAILURE TO APPEAR', tone: 'high' }
          : { label: 'SCHEDULED', tone: 'standard' };
    const dateStr = data.event_date ? `${data.event_date}${data.event_time ? ' ' + data.event_time : ''}` : '';
    y = addQuickReferenceBanner(doc, {
      primary: data.event_number,
      secondary: [data.event_type?.toUpperCase(), dateStr, data.defendant_name].filter(Boolean).join(' · '),
      pill,
    }, y);
  }

  // ── Hearing Schedule ──────────────────────────────────
  y = checkPageBreak(doc, y, 24);
  { const sec = openAutoSection(doc, 'Hearing Schedule', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Event Type', (data.event_type || '').toUpperCase(), lx, y, hfw);
    const r1b = addFieldPair(doc, 'Status', (data.status || 'SCHEDULED').toUpperCase(), rx, y, hfw);
    y = Math.max(r1a, r1b);
    const r2a = addFieldPair(doc, 'Date', formatDate(data.event_date), lx, y, hfw);
    const r2b = addFieldPair(doc, 'Time', data.event_time || '', rx, y, hfw);
    y = Math.max(r2a, r2b);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Court Information ─────────────────────────────────
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Court Information', y); y = sec.contentY;
    y = addFieldPair(doc, 'Court Name', data.court_name || '', lx, y, ffw);
    const r2a = addFieldPair(doc, 'Courtroom', data.courtroom || '', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Court Case #', data.court_case_number || '', rx, y, hfw);
    y = Math.max(r2a, r2b);
    if (data.judge_name) {
      y = addFieldPair(doc, 'Judge', data.judge_name, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Parties ───────────────────────────────────────────
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Parties', y); y = sec.contentY;
    y = addFieldPair(doc, 'Defendant', data.defendant_name || '', lx, y, ffw);
    const r2a = addFieldPair(doc, 'Prosecutor', data.prosecutor || '', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Defense Attorney', data.defense_attorney || '', rx, y, hfw);
    y = Math.max(r2a, r2b);
    if (data.officers_required && data.officers_required.length > 0) {
      y = addFieldPair(doc, 'Officers Required', data.officers_required.join(', '), lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Linked Records ────────────────────────────────────
  if (data.citation_number || data.incident_number || data.case_number) {
    y = checkPageBreak(doc, y, 16);
    const sec = openAutoSection(doc, 'Linked Records', y); y = sec.contentY;
    const tw = ffw / 3;
    const r1a = addFieldPair(doc, 'Citation #', data.citation_number || '', lx, y, tw);
    const r1b = addFieldPair(doc, 'Incident #', data.incident_number || '', lx + tw, y, tw);
    const r1c = addFieldPair(doc, 'Case #', data.case_number || '', lx + tw * 2, y, tw);
    y = Math.max(r1a, r1b, r1c);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Outcome (if concluded) ────────────────────────────
  if (data.outcome || data.sentence || data.fine_amount != null) {
    y = checkPageBreak(doc, y, 22);
    const sec = openAutoSection(doc, 'Outcome', y); y = sec.contentY;
    if (data.outcome) {
      y = addFieldPair(doc, 'Outcome', data.outcome, lx, y, ffw);
    }
    if (data.sentence) {
      y = addFieldPair(doc, 'Sentence', data.sentence, lx, y, ffw);
    }
    if (data.fine_amount != null) {
      y = addFieldPair(doc, 'Fine Amount', `$${Number(data.fine_amount).toFixed(2)}`, lx, y, hfw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Notes ─────────────────────────────────────────────
  if (data.notes) {
    y = addNarrativeSection(doc, 'Court Notes', data.notes, y);
  }

  // ── Issuing officer signature ─────────────────────────
  y = addStackedSignatures(doc, 'Issuing Officer', '', y);
}

export async function generateJailBookingReport(doc: jsPDF, data: JailBookingPdfData): Promise<void> {
  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);

  const subjectId = data.id ? `JB-${data.id}` : (data.source_id || 'JAIL-BOOKING');
  setActiveCaseNumber(subjectId);
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'JAIL BOOKING SHEET',
    formNumber: 'FORM PS-601',
    caseNumber: subjectId,
    caseNumberLabel: 'BOOKING ID',
  });

  // Quick-reference banner — name + booking date + custody status pill
  {
    const status = String(data.status || 'in_custody').toLowerCase();
    const pill: QuickRefBannerConfig['pill'] = status === 'in_custody'
      ? { label: 'IN CUSTODY', tone: 'high' }
      : status === 'released' || status === 'bonded'
        ? { label: status.toUpperCase(), tone: 'inactive' }
        : status === 'transferred'
          ? { label: 'TRANSFERRED', tone: 'elevated' }
          : { label: status.toUpperCase(), tone: 'standard' };
    const dob = data.date_of_birth ? `DOB ${data.date_of_birth}` : '';
    const bookedOn = data.booking_date ? `BOOKED ${data.booking_date}` : '';
    y = addQuickReferenceBanner(doc, {
      primary: (data.full_name || 'UNKNOWN SUBJECT').toUpperCase(),
      secondary: [dob, bookedOn, data.county].filter(Boolean).join(' · '),
      pill,
    }, y);
  }

  // Caution-flag strip — synthesize from charges text. Felonies and
  // armed/violent indicators get high-tone chips so the booking
  // sheet's first-glance read is dominated by safety-critical info.
  {
    const flags: CautionFlag[] = [];
    const allCharges = (data.charge_lines && data.charge_lines.length > 0
      ? data.charge_lines.join(' ; ')
      : (data.charges || '')).toUpperCase();
    if (/FELONY|FEL\b/.test(allCharges)) flags.push({ label: 'FELONY CHARGES', kind: 'violent' });
    if (/ASSAULT|BATTERY|HOMICIDE|MURDER/.test(allCharges)) flags.push({ label: 'VIOLENT CHARGES', kind: 'violent' });
    if (/WEAPON|FIREARM|GUN|KNIFE/.test(allCharges)) flags.push({ label: 'WEAPONS CHARGES', kind: 'armed' });
    if (/DRUG|NARCOTIC|CONTROLLED|POSSESS/.test(allCharges)) flags.push({ label: 'DRUG CHARGES', kind: 'default' });
    if (/ESCAPE|FLEE|RESIST/.test(allCharges)) flags.push({ label: 'FLIGHT RISK', kind: 'warrant' });
    if (flags.length > 0) {
      y = drawCautionFlagStrip(doc, flags, y);
    }
  }

  // ── Subject Identification ────────────────────────────
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Subject Identification', y); y = sec.contentY;
    y = addFieldPair(doc, 'Full Name', data.full_name || '', lx, y, ffw);
    const tw = ffw / 3;
    const r2a = addFieldPair(doc, 'Last Name', data.last_name || '', lx, y, tw);
    const r2b = addFieldPair(doc, 'First Name', data.first_name || '', lx + tw, y, tw);
    const r2c = addFieldPair(doc, 'Middle', data.middle_name || '', lx + tw * 2, y, tw);
    y = Math.max(r2a, r2b, r2c);
    y = addFieldPair(doc, 'Date of Birth', formatDate(data.date_of_birth), lx, y, hfw);
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Booking Details ───────────────────────────────────
  y = checkPageBreak(doc, y, 22);
  { const sec = openAutoSection(doc, 'Booking Details', y); y = sec.contentY;
    const r1a = addFieldPair(doc, 'Booking Date', formatDate(data.booking_date), lx, y, hfw);
    const r1b = addFieldPair(doc, 'Status', (data.status || 'ACTIVE').toUpperCase(), rx, y, hfw);
    y = Math.max(r1a, r1b);
    const r2a = addFieldPair(doc, 'County', data.county || '', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Source', data.source_name || '', rx, y, hfw);
    y = Math.max(r2a, r2b);
    if (data.source_id) {
      y = addFieldPair(doc, 'Source ID', data.source_id, lx, y, hfw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Charges ───────────────────────────────────────────
  // Prefer pre-parsed `charge_lines` array; fall back to parsing
  // the free-text `charges` field on commas/newlines.
  const chargeRows: string[][] = [];
  if (data.charge_lines && data.charge_lines.length > 0) {
    for (let i = 0; i < data.charge_lines.length; i++) {
      chargeRows.push([String(i + 1), data.charge_lines[i]]);
    }
  } else if (data.charges) {
    const lines = String(data.charges)
      .split(/\r?\n|;|,(?=\s)/)
      .map(s => s.trim())
      .filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      chargeRows.push([String(i + 1), lines[i]]);
    }
  }
  if (chargeRows.length > 0) {
    y = renderLinkedTable(doc, y, 'Charges',
      ['#', 'CHARGE'],
      [6, 78],
      chargeRows,
    );
  }

  // ── External References ───────────────────────────────
  if (data.mugshot_url || data.details_url) {
    y = checkPageBreak(doc, y, 16);
    const sec = openAutoSection(doc, 'External References', y); y = sec.contentY;
    if (data.mugshot_url) {
      y = addFieldPair(doc, 'Mugshot URL', data.mugshot_url, lx, y, ffw);
    }
    if (data.details_url) {
      y = addFieldPair(doc, 'Details URL', data.details_url, lx, y, ffw);
    }
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Custody chain signature line ──────────────────────
  y = addStackedSignatures(doc, 'Booking Officer', '', y);
}

// ── Shared helper for linked-record tables ───────────────

function renderLinkedTable(
  doc: jsPDF,
  startY: number,
  title: string,
  headers: string[],
  colRatios: number[],
  rows: string[][],
): number {
  let y = checkPageBreak(doc, startY, 20);
  const sec = openAutoSection(doc, title, y); y = sec.contentY;

  const cw = getContentWidth(doc);
  const startX = LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET;
  const totalRatio = colRatios.reduce((a, b) => a + b, 0) || 1;
  const colPositions = colRatios.map((_, i) => {
    const offset = colRatios.slice(0, i).reduce((a, b) => a + b, 0);
    return startX + (offset / totalRatio) * (cw - 2 * SPACING.CONTENT_INSET);
  });
  const tableHeaders = headers.map((label, i) => ({ label, x: colPositions[i] }));

  y = addTableWithShading(doc, tableHeaders, rows, y, colPositions);
  y += SPACING.MD;
  return closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // parseTimestamp reads naive server strings as UTC; display in Mountain Time.
  const d = parseTimestamp(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Denver' });
}

