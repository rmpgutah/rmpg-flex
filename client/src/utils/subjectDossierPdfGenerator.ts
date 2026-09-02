// ============================================================
// RMPG Flex — Process Server Subject File Full Dossier PDF Generator
// Generates a comprehensive, printable dossier packet for a subject file
// including Subject Identity, Service Addresses, Case Details, Hiring Party,
// Full Attempt History, OSINT Intelligence, Skip Traces, QR Scans, and Activity.
// ============================================================

import jsPDF from 'jspdf';
import {
  openAutoSection,
  closeAutoSection,
  addFieldPair,
  addTableWithShading,
  addWrappedText,
  addPageFooter,
  checkPageBreak,
  fetchPdfBranding,
  setActiveBranding,
  loadPdfAssets,
  setActiveFormKey,
  setActiveCaseNumber,
  setActiveSectionStyle,
  sanitizePdfText,
  finalizePoliceReport,
  stampGenerationTime,
} from './pdfGenerator';
import {
  SPACING, FONT, COLOR,
  getContentWidth, getFullFieldWidth,
  getLeftX, getRightColumnX, getHalfFieldWidth,
  getProportionalColumns, getCapHeight,
} from './pdfTokens';
import { drawNibrsHeader } from './pdfFormHelpers';
import { registerArialFont } from './pdf/fonts/registerArial';
import { toDisplayLabel, formatEnumValue } from './formatters';
import { safeDateStr, localToday } from './dateUtils';
import type { ServeJob, ServeAttempt, ServeSkipTrace } from '../types';

export interface SubjectDossierData {
  job: ServeJob;
  attempts: ServeAttempt[];
  skipTraces?: ServeSkipTrace[];
  comments?: Array<{
    id: number;
    author_name: string;
    author_role: string;
    body: string;
    created_at: string;
    is_system: number;
  }>;
  qrScans?: Array<{
    id: number;
    job_ref: string;
    scanned_at: string;
    ip_address: string | null;
    geo_city: string | null;
    geo_region: string | null;
    geo_country: string | null;
    device_type: string | null;
    platform: string | null;
  }>;
  osintResult?: {
    match_tier?: string;
    sources?: Array<{ source: string; ok: boolean; records: any[] }>;
    records?: Array<{
      names?: string[];
      dobs?: string[];
      addresses?: Array<{ street?: string; city?: string; state?: string; zip?: string }>;
      flags?: string[];
    }>;
  } | null;
}

export async function generateSubjectDossierPdf(data: SubjectDossierData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  registerArialFont(doc);

  await loadPdfAssets();
  const branding = await fetchPdfBranding();
  setActiveBranding(branding);
  setActiveSectionStyle('light');
  setActiveFormKey('DOSSIER-PS-400');
  setActiveCaseNumber(data.job.case_number || `JOB-${data.job.id}`);
  stampGenerationTime();

  const lx = getLeftX();
  const rx = getRightColumnX(doc);
  const hfw = getHalfFieldWidth(doc);
  const ffw = getFullFieldWidth(doc);
  const qw = Math.floor(hfw / 2);

  const headerRef = `JOB-${data.job.id}`;
  let y = drawNibrsHeader(doc, {
    stateIdentifier: 'STATE OF UTAH',
    agencyName: 'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle: 'SUBJECT FILE DOSSIER / COMPREHENSIVE CASE RECORD',
    caseNumber: headerRef,
    caseNumberLabel: 'AGENCY JOB #',
    formNumber: 'FORM PS-400',
  });

  // ── Section 1: Subject Identity & Master Status ───────────
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, '1. Subject Identity & Case Status', y);
    y = sec.contentY;

    const r1a = addFieldPair(doc, 'Full Name', data.job.recipient_name, lx, y, hfw);
    const r1b = addFieldPair(doc, 'Case Status', toDisplayLabel(data.job.status || 'N/A').toUpperCase(), rx, y, qw);
    const r1c = addFieldPair(doc, 'Priority', toDisplayLabel(data.job.priority || 'N/A').toUpperCase(), rx + qw + SPACING.SM, y, qw);
    y = Math.max(r1a, r1b, r1c);

    const r2a = addFieldPair(doc, 'Date of Birth', data.job.recipient_dob ? safeDateStr(data.job.recipient_dob) : 'Unknown', lx, y, qw);
    const r2b = addFieldPair(doc, 'Urgency Tier', toDisplayLabel(data.job.urgency_tier || 'standard').toUpperCase(), lx + qw + SPACING.SM, y, qw);
    const r2c = addFieldPair(doc, 'Recipient Type', toDisplayLabel(data.job.recipient_type || 'individual').toUpperCase(), rx, y, hfw);
    y = Math.max(r2a, r2b, r2c);

    const r3a = addFieldPair(doc, 'Phone', data.job.recipient_phone || 'None listed', lx, y, hfw);
    const r3b = addFieldPair(doc, 'Email', data.job.recipient_email || 'None listed', rx, y, hfw);
    y = Math.max(r3a, r3b);

    if (data.job.recipient_employer) {
      y = addFieldPair(doc, 'Employer', data.job.recipient_employer, lx, y, ffw);
      if (data.job.recipient_employer_address) {
        y = addFieldPair(doc, 'Employer Address', data.job.recipient_employer_address, lx, y, ffw);
      }
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 2: Service Location & Building Access ──────────
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, '2. Service Address & Location Intelligence', y);
    y = sec.contentY;

    const fullAddr = [data.job.recipient_address, data.job.recipient_address_2, data.job.recipient_city, data.job.recipient_state, data.job.recipient_zip]
      .filter(Boolean).join(', ');
    y = addFieldPair(doc, 'Service Address', fullAddr || 'N/A', lx, y, ffw);

    const r1a = addFieldPair(doc, 'GPS Coordinates', (data.job.recipient_lat != null && data.job.recipient_lng != null)
      ? `${Number(data.job.recipient_lat).toFixed(5)}, ${Number(data.job.recipient_lng).toFixed(5)}`
      : 'Unmapped', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Geocode Source', data.job.geocode_source ? toDisplayLabel(data.job.geocode_source) : 'Standard', rx, y, hfw);
    y = Math.max(r1a, r1b);

    if (data.job.contact_restrictions) {
      y = addFieldPair(doc, 'Contact Restrictions', data.job.contact_restrictions, lx, y, ffw);
    }
    if (data.job.building_access_notes) {
      y = addFieldPair(doc, 'Building Access / Security Notes', data.job.building_access_notes, lx, y, ffw);
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 3: Legal Case & Retaining Party ────────────────
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, '3. Legal Case & Retaining Party', y);
    y = sec.contentY;

    const r1a = addFieldPair(doc, 'Document Type', data.job.document_type || 'Legal Documents', lx, y, hfw);
    const r1b = addFieldPair(doc, 'Court Case Number', data.job.case_number || 'N/A', rx, y, hfw);
    y = Math.max(r1a, r1b);

    const r2a = addFieldPair(doc, 'Court Name', data.job.court_name || 'N/A', lx, y, hfw);
    const r2b = addFieldPair(doc, 'Jurisdiction', data.job.jurisdiction || 'N/A', rx, y, hfw);
    y = Math.max(r2a, r2b);

    const r3a = addFieldPair(doc, 'Plaintiff', data.job.plaintiff_name || 'N/A', lx, y, hfw);
    const r3b = addFieldPair(doc, 'Defendant', data.job.defendant_name || 'N/A', rx, y, hfw);
    y = Math.max(r3a, r3b);

    const r4a = addFieldPair(doc, 'Hiring Client / Firm', data.job.client_name || 'N/A', lx, y, hfw);
    const r4b = addFieldPair(doc, 'Attorney of Record', data.job.attorney_name || 'N/A', rx, y, hfw);
    y = Math.max(r4a, r4b);

    if (data.job.service_instructions) {
      y = addFieldPair(doc, 'Special Service Instructions', data.job.service_instructions, lx, y, ffw);
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 4: Process Server Attempt History ─────────────
  y = checkPageBreak(doc, y, 30);
  {
    const attemptsList = data.attempts || [];
    const sec = openAutoSection(doc, `4. Complete Service Attempt History (${attemptsList.length} recorded)`, y);
    y = sec.contentY;

    if (attemptsList.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(FONT.SIZE_FIELD_VALUE ?? 9);
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('No attempts logged on this subject file.', lx, y + getCapHeight(FONT.SIZE_FIELD_VALUE ?? 9));
      y += SPACING.LG;
    } else {
      const cols = getProportionalColumns(doc, [0.5, 1.4, 1.2, 1.8, 1.6, 2.5]);
      const headers = [
        { label: '#', x: cols[0] },
        { label: 'DATE/TIME', x: cols[1] },
        { label: 'TYPE', x: cols[2] },
        { label: 'RESULT', x: cols[3] },
        { label: 'OFFICER', x: cols[4] },
        { label: 'NOTES / DISPOSITION', x: cols[5] },
      ];
      const rows = attemptsList.map((a, i) => {
        const ts = a.attempt_at || a.created_at || '';
        const dtStr = ts ? safeDateStr(ts) : '—';
        return [
          String(a.attempt_number ?? i + 1),
          sanitizePdfText(dtStr),
          sanitizePdfText(toDisplayLabel(a.attempt_type || 'personal')),
          sanitizePdfText(a.disposition_code || a.result || 'Attempted'),
          sanitizePdfText(a.officer_name || 'Officer'),
          sanitizePdfText(a.notes || '—'),
        ];
      });
      y = addTableWithShading(doc, headers, rows, y, cols);
      y += SPACING.SM;
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 5: Open-Source Intelligence & Skip Tracing ────
  y = checkPageBreak(doc, y, 25);
  {
    const sec = openAutoSection(doc, '5. Intelligence & Skip Trace Results', y);
    y = sec.contentY;

    const stList = data.skipTraces || [];
    if (stList.length > 0) {
      y = addFieldPair(doc, 'Skip Traces Performed', `${stList.length} search record(s) on file`, lx, y, ffw);
      const cols = getProportionalColumns(doc, [1.5, 2.0, 1.5, 4.0]);
      const headers = [
        { label: 'DATE', x: cols[0] },
        { label: 'SEARCH TYPE', x: cols[1] },
        { label: 'RESULTS', x: cols[2] },
        { label: 'IDENTIFIED ADDRESSES', x: cols[3] },
      ];
      const rows = stList.map(st => [
        sanitizePdfText(st.created_at ? safeDateStr(st.created_at) : '—'),
        sanitizePdfText((st.search_type || 'Skip Trace').toUpperCase()),
        `${(st.addresses_found || []).length} found`,
        sanitizePdfText(Array.isArray(st.addresses_found) ? st.addresses_found.map((a: any) => typeof a === 'string' ? a : a.address || '').filter(Boolean).join('; ') : '—'),
      ]);
      y = addTableWithShading(doc, headers, rows, y, cols);
      y += SPACING.SM;
    } else {
      y = addFieldPair(doc, 'Skip Traces', 'No external skip traces logged', lx, y, hfw);
    }

    const scans = data.qrScans || [];
    if (scans.length > 0) {
      y += SPACING.SM;
      y = addFieldPair(doc, 'Door Notice QR Scans', `${scans.length} scan event(s) recorded from subject/resident device`, lx, y, ffw);
      const cols = getProportionalColumns(doc, [1.8, 2.2, 2.5, 2.5]);
      const headers = [
        { label: 'TIMESTAMP', x: cols[0] },
        { label: 'IP ADDRESS', x: cols[1] },
        { label: 'LOCATION', x: cols[2] },
        { label: 'DEVICE / PLATFORM', x: cols[3] },
      ];
      const rows = scans.map(s => [
        sanitizePdfText(s.scanned_at ? safeDateStr(s.scanned_at) : '—'),
        sanitizePdfText(s.ip_address || 'Unknown'),
        sanitizePdfText([s.geo_city, s.geo_region, s.geo_country].filter(Boolean).join(', ') || 'N/A'),
        sanitizePdfText([s.device_type, s.platform].filter(Boolean).join(' / ') || 'Unknown'),
      ]);
      y = addTableWithShading(doc, headers, rows, y, cols);
      y += SPACING.SM;
    }

    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // ── Section 6: Activity Log & File Chronology ─────────────
  if (data.comments && data.comments.length > 0) {
    y = checkPageBreak(doc, y, 25);
    const sec = openAutoSection(doc, `6. File Activity & Internal Notes (${data.comments.length})`, y);
    y = sec.contentY;

    const cols = getProportionalColumns(doc, [1.6, 2.0, 5.4]);
    const headers = [
      { label: 'DATE', x: cols[0] },
      { label: 'AUTHOR', x: cols[1] },
      { label: 'ENTRY NOTE', x: cols[2] },
    ];
    const rows = data.comments.map(c => [
      sanitizePdfText(safeDateStr(c.created_at)),
      sanitizePdfText(`${c.author_name} (${c.author_role})`),
      sanitizePdfText(c.body),
    ]);
    y = addTableWithShading(doc, headers, rows, y, cols);
    y += SPACING.SM;
    y = closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
  }

  // Add page footers
  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addPageFooter(doc, i, totalPages, 'subject_file_dossier');
  }

  finalizePoliceReport(doc, {
    barcode: {
      formMetadata: {
        form: 'DOSSIER-PS-400',
        caseNumber: data.job.case_number || `JOB-${data.job.id}`,
        agency: 'RMPG',
        agencyOri: 'UT0180100',
        reportDate: localToday(),
        officer: 'Records Division',
        badge: 'RMPG-FLEX',
      },
    },
  });

  return doc;
}
