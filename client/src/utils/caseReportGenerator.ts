// Full investigative case-report PDF (v3 — RMPG design system).
// Phase 4 content is preserved intact; header / footer / watermark are
// upgraded to match the PS-2xx form standard via shared pdfFormHelpers
// and pdfGenerator. Unit switched to 'mm' (letter = 215.9 × 279.4 mm)
// so all design-system layout helpers work without coordinate conversion.
import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { formatActivity, type CaseActivityRow } from './caseActivity';
import { drawNibrsHeader } from './pdfFormHelpers';
import {
  addConfidentialWatermark,
  addPageFooter,
  setActiveSectionStyle,
  setGenerationTimestamp,
} from './pdfGenerator';
import { LAYOUT } from './pdfTokens';
import { loadSealBase64 } from './pdfAssets';

export interface CaseReportData {
  caseRow: Record<string, any>;
  calls?: any[]; incidents?: any[]; persons?: any[]; vehicles?: any[];
  properties?: any[]; evidence?: any[]; warrants?: any[]; citations?: any[];
  tasks?: any[]; notes?: any[]; related?: any[]; activity?: CaseActivityRow[];
}

export interface ReportSection { key: string; title: string; count: number }

/**
 * Pure: the ordered list of record sections that have content. Used to drive
 * the PDF body and unit-tested independently of jsPDF (which needs a canvas).
 * Empty sections are omitted so the packet has no filler pages.
 */
export function buildCaseReportSections(data: CaseReportData): ReportSection[] {
  const defs: { key: keyof CaseReportData; title: string }[] = [
    { key: 'calls',      title: 'Linked Calls for Service' },
    { key: 'incidents',  title: 'Linked Incidents' },
    { key: 'persons',    title: 'Persons' },
    { key: 'vehicles',   title: 'Vehicles' },
    { key: 'properties', title: 'Property' },
    { key: 'evidence',   title: 'Evidence' },
    { key: 'warrants',   title: 'Warrants' },
    { key: 'citations',  title: 'Citations' },
    { key: 'tasks',      title: 'Investigative Tasks' },
    { key: 'notes',      title: 'Case Notes' },
    { key: 'related',    title: 'Related Cases' },
    { key: 'activity',   title: 'Activity Log' },
  ];
  return defs
    .map((d) => ({
      key: String(d.key),
      title: d.title,
      count: Array.isArray(data[d.key]) ? (data[d.key] as any[]).length : 0,
    }))
    .filter((s) => s.count > 0);
}

const safe = (v: unknown, dash = '—'): string => {
  if (v === null || v === undefined || v === '') return dash;
  return String(v);
};
const safeDate = (v: unknown): string => {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
};

export async function generateCaseReportPdf(data: CaseReportData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  registerArialFont(doc);

  // Layout constants (all in mm — matches pdfTokens design system)
  const M = LAYOUT.PAGE_MARGIN;                       // 10 mm
  const W = doc.internal.pageSize.getWidth();          // 215.9 mm
  const H = doc.internal.pageSize.getHeight();         // 279.4 mm
  const RIGHT = W - M;                                 // 205.9 mm
  const BOTTOM = H - M - LAYOUT.FOOTER_HEIGHT - 2;    // ~260 mm — footer buffer

  // ── Layout helpers (close over mutable `y`) ──────────────────

  // `y` is declared below after the async header draw. The helpers are defined
  // here so they reference the same `y` binding that gets set after the header.
  // They must not be called before `y` is initialised.

  // eslint-disable-next-line prefer-const
  let y = 0; // placeholder — set to drawNibrsHeader's return value below

  const ensure = (need: number) => {
    if (y + need > BOTTOM) { doc.addPage(); y = M + 4; }
  };
  const rule = () => {
    doc.setDrawColor(180); doc.setLineWidth(0.2);
    doc.line(M, y, RIGHT, y); y += 3.5;
  };
  const heading = (label: string) => {
    ensure(10);
    y += 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(label.toUpperCase(), M, y);
    y += 2; rule();
  };
  const para = (label: string, value: string) => {
    // label column width ~32 mm (≈90 pt in the old pt-unit generator)
    const lines = doc.splitTextToSize(value || '—', RIGHT - M - 32);
    ensure(lines.length * 4.2 + 1.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(40);
    doc.text(lines, M + 32, y);
    y += lines.length * 4.2 + 1.5;
  };
  const pdfSafe = (s: string) => s.replace(/→/g, '->').replace(/←/g, '<-').replace(/[^\x00-\xFF]/g, '?');
  const bullet = (text: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(45);
    const lines = doc.splitTextToSize(text, RIGHT - M - 4.2);
    ensure(lines.length * 3.9 + 0.7);
    doc.text('•', M, y);
    doc.text(lines, M + 4.2, y);
    y += lines.length * 3.9 + 0.7;
  };

  const c = data.caseRow || {};

  // ── RMPG Agency Header (matches PS-2xx design system) ────────

  const sealBase64 = await loadSealBase64();
  setActiveSectionStyle('light'); // government-letterhead style (black on white)
  const genTs = new Date().toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  setGenerationTimestamp(genTs);

  y = drawNibrsHeader(doc, {
    stateIdentifier:  'STATE OF UTAH',
    agencyName:       'ROCKY MOUNTAIN PROTECTIVE GROUP',
    formTitle:        'INVESTIGATIVE CASE REPORT',
    formNumber:       'FORM CR',
    caseNumber:       safe(c.case_number, ''),
    caseNumberLabel:  'CASE NUMBER',
    reportDate:       new Date().toLocaleDateString(),
    sealBase64:       sealBase64 || null,
  });
  y += 3; // breathing room below header band

  // ── Cover fields ─────────────────────────────────────────────

  para('Status',           safe(c.status, '').replace(/_/g, ' ').toUpperCase());
  para('Priority',         safe(c.priority, '').toUpperCase());
  para('Type',             safe(c.case_type, '').replace(/_/g, ' '));
  para('Lead Investigator', safe(c.lead_investigator_name));
  para('Opened',           safeDate(c.opened_date));
  if (c.closed_date)  para('Closed',      safeDate(c.closed_date));
  if (c.disposition)  para('Disposition', safe(c.disposition));
  para('Generated', genTs);

  // ── Summary / Narrative ──────────────────────────────────────

  if (c.summary || c.narrative) {
    heading('Summary');
    for (const key of ['summary', 'narrative'] as const) {
      if (c[key]) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40);
        const l = doc.splitTextToSize(String(c[key]), RIGHT - M);
        ensure(l.length * 4.2);
        doc.text(l, M, y); y += l.length * 4.2 + 2;
      }
    }
  }

  // ── Solvability ──────────────────────────────────────────────

  if (c.solvability_score != null && Number.isFinite(Number(c.solvability_score))) {
    heading('Solvability');
    para('Score', `${Number(c.solvability_score)}/100`);
    let factors: Record<string, boolean> = {};
    try {
      factors = c.solvability_factors
        ? (typeof c.solvability_factors === 'string' ? JSON.parse(c.solvability_factors) : c.solvability_factors)
        : {};
    } catch { /* ignore */ }
    const present = Object.entries(factors).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
    if (present.length) para('Factors', present.join(', '));
  }

  // ── Record sections ──────────────────────────────────────────

  const rowText = (label: string, parts: (string | number | null | undefined)[]) => {
    const line = parts
      .map((p) => (p === null || p === undefined || p === '' ? '' : String(p)))
      .filter(Boolean)
      .join('  ·  ');
    bullet(line || label);
  };

  for (const section of buildCaseReportSections(data)) {
    heading(`${section.title} (${section.count})`);
    const rows = (data as any)[section.key] as any[];
    for (const r of rows) {
      switch (section.key) {
        case 'calls':
          rowText('Call', [r.call_number || r.case_number, r.incident_type || r.call_type, r.status, safeDate(r.created_at)]);
          break;
        case 'incidents':
          rowText('Incident', [r.incident_number, r.incident_type, r.status, safeDate(r.created_at)]);
          break;
        case 'persons':
          rowText('Person', [`${safe(r.last_name, '')} ${safe(r.first_name, '')}`.trim(), r.role, r.date_of_birth, r.phone]);
          break;
        case 'vehicles':
          rowText('Vehicle', [r.plate_number, [r.year, r.make, r.model].filter(Boolean).join(' '), r.color, r.vin]);
          break;
        case 'properties':
          rowText('Property', [r.description, r.property_type, r.serial_number, r.status]);
          break;
        case 'evidence':
          rowText('Evidence', [r.evidence_number, r.description, r.evidence_type, r.status]);
          break;
        case 'warrants':
          rowText('Warrant', [r.warrant_number, r.subject_name, r.charge_description, r.status]);
          break;
        case 'citations':
          rowText('Citation', [r.citation_number, r.violation, r.violator_name, r.status]);
          break;
        case 'tasks':
          rowText('Task', [r.title, (r.status || '').replace(/_/g, ' '), r.priority, r.assignee_name, r.due_date ? `due ${r.due_date}` : '']);
          break;
        case 'notes': {
          const who = r.author_name ? `${r.author_name} — ` : '';
          rowText('Note', [`${who}${safe(r.content, '')}`]);
          break;
        }
        case 'related':
          rowText('Related', [r.case_number, r.title, (r.link_type || 'related'), r.status]);
          break;
        case 'activity': {
          const f = formatActivity(r.action, r.detail);
          rowText('Activity', [safeDate(r.created_at), r.actor_name || 'System', f.label]);
          break;
        }
        default:
          break;
      }
    }
  }

  // ── Footer + watermark on every page ─────────────────────────
  // addPageFooter: FORM CR key is used verbatim (passes /^FORM\s/ test).
  // addConfidentialWatermark: pages 2+ only (page 1 header already establishes identity).

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (p > 1) addConfidentialWatermark(doc);
    addPageFooter(doc, p, pages, 'FORM CR');
  }

  return doc;
}

/** Generate + trigger browser download. */
export async function downloadCaseReport(data: CaseReportData): Promise<void> {
  const doc = await generateCaseReportPdf(data);
  const num = safe(data.caseRow?.case_number, 'case').replace(/[^\w-]/g, '_');
  doc.save(`case_report_${num}.pdf`);
}
