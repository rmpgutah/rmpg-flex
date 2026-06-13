// Full investigative case-report PDF (v2 Phase 4). Arial-only per project
// rule (registerArialFont remaps helvetica/times/courier). All value
// formatting is null/NaN-guarded — past PDF audits showed sentinel values
// crash toFixed/locale calls.
import jsPDF from 'jspdf';
import { registerArialFont } from './pdf/fonts/registerArial';
import { formatActivity, type CaseActivityRow } from './caseActivity';

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
    { key: 'calls', title: 'Linked Calls for Service' },
    { key: 'incidents', title: 'Linked Incidents' },
    { key: 'persons', title: 'Persons' },
    { key: 'vehicles', title: 'Vehicles' },
    { key: 'properties', title: 'Property' },
    { key: 'evidence', title: 'Evidence' },
    { key: 'warrants', title: 'Warrants' },
    { key: 'citations', title: 'Citations' },
    { key: 'tasks', title: 'Investigative Tasks' },
    { key: 'notes', title: 'Case Notes' },
    { key: 'related', title: 'Related Cases' },
    { key: 'activity', title: 'Activity Log' },
  ];
  return defs
    .map((d) => ({ key: String(d.key), title: d.title, count: Array.isArray(data[d.key]) ? (data[d.key] as any[]).length : 0 }))
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

export function generateCaseReportPdf(data: CaseReportData): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  registerArialFont(doc); // Arial-only output

  const M = 48;                       // margin
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const RIGHT = W - M;
  let y = M;

  const ensure = (need: number) => {
    if (y + need > H - M) { doc.addPage(); y = M; }
  };
  const rule = () => { doc.setDrawColor(180); doc.setLineWidth(0.5); doc.line(M, y, RIGHT, y); y += 10; };

  const heading = (label: string) => {
    ensure(28);
    y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20);
    doc.text(label.toUpperCase(), M, y);
    y += 6; rule();
  };
  const para = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60);
    const lines = doc.splitTextToSize(value || '—', RIGHT - M - 90);
    ensure(lines.length * 12 + 4);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(110);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(40);
    doc.text(lines, M + 90, y);
    y += lines.length * 12 + 4;
  };
  const bullet = (text: string) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(45);
    const lines = doc.splitTextToSize(text, RIGHT - M - 12);
    ensure(lines.length * 11 + 2);
    doc.text('•', M, y);
    doc.text(lines, M + 12, y);
    y += lines.length * 11 + 2;
  };

  const c = data.caseRow || {};

  // ── Cover ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15);
  doc.text('INVESTIGATIVE CASE REPORT', M, y); y += 20;
  doc.setFontSize(12); doc.setTextColor(40);
  doc.text(`${safe(c.case_number)} — ${safe(c.title)}`, M, y); y += 8; rule();

  para('Status', safe(c.status).replace(/_/g, ' ').toUpperCase());
  para('Priority', safe(c.priority).toUpperCase());
  para('Type', safe(c.case_type).replace(/_/g, ' '));
  para('Lead Investigator', safe(c.lead_investigator_name));
  para('Opened', safeDate(c.opened_date));
  if (c.closed_date) para('Closed', safeDate(c.closed_date));
  if (c.disposition) para('Disposition', safe(c.disposition));
  para('Generated', new Date().toLocaleString());

  // ── Summary / narrative ──
  if (c.summary || c.narrative) {
    heading('Summary');
    if (c.summary) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40); const l = doc.splitTextToSize(String(c.summary), RIGHT - M); ensure(l.length * 12); doc.text(l, M, y); y += l.length * 12 + 6; }
    if (c.narrative) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40); const l = doc.splitTextToSize(String(c.narrative), RIGHT - M); ensure(l.length * 12); doc.text(l, M, y); y += l.length * 12 + 6; }
  }

  // ── Solvability ──
  if (c.solvability_score != null && Number.isFinite(Number(c.solvability_score))) {
    heading('Solvability');
    para('Score', `${Number(c.solvability_score)}/100`);
    let factors: Record<string, boolean> = {};
    try { factors = c.solvability_factors ? (typeof c.solvability_factors === 'string' ? JSON.parse(c.solvability_factors) : c.solvability_factors) : {}; } catch { /* ignore */ }
    const present = Object.entries(factors).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
    if (present.length) para('Factors', present.join(', '));
  }

  // ── Record sections ──
  const rowText = (label: string, parts: (string | number | null | undefined)[]) => {
    const line = parts.map((p) => (p === null || p === undefined || p === '' ? '' : String(p))).filter(Boolean).join('  ·  ');
    bullet(line || label);
  };

  for (const section of buildCaseReportSections(data)) {
    heading(`${section.title} (${section.count})`);
    const rows = (data as any)[section.key] as any[];
    for (const r of rows) {
      switch (section.key) {
        case 'calls': rowText('Call', [r.call_number || r.case_number, r.incident_type || r.call_type, r.status, safeDate(r.created_at)]); break;
        case 'incidents': rowText('Incident', [r.incident_number, r.incident_type, r.status, safeDate(r.created_at)]); break;
        case 'persons': rowText('Person', [`${safe(r.last_name, '')} ${safe(r.first_name, '')}`.trim(), r.role, r.date_of_birth, r.phone]); break;
        case 'vehicles': rowText('Vehicle', [r.plate_number, [r.year, r.make, r.model].filter(Boolean).join(' '), r.color, r.vin]); break;
        case 'properties': rowText('Property', [r.description, r.property_type, r.serial_number, r.status]); break;
        case 'evidence': rowText('Evidence', [r.evidence_number, r.description, r.evidence_type, r.status]); break;
        case 'warrants': rowText('Warrant', [r.warrant_number, r.subject_name, r.charge_description, r.status]); break;
        case 'citations': rowText('Citation', [r.citation_number, r.violation, r.violator_name, r.status]); break;
        case 'tasks': rowText('Task', [r.title, (r.status || '').replace(/_/g, ' '), r.priority, r.assignee_name, r.due_date ? `due ${r.due_date}` : '']); break;
        case 'notes': { const who = r.author_name ? `${r.author_name} — ` : ''; rowText('Note', [`${who}${safe(r.content, '')}`]); break; }
        case 'related': rowText('Related', [r.case_number, r.title, (r.link_type || 'related'), r.status]); break;
        case 'activity': { const f = formatActivity(r.action, r.detail); rowText('Activity', [safeDate(r.created_at), r.actor_name || 'System', f.label]); break; }
        default: break;
      }
    }
  }

  // Footer page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(`${safe(c.case_number)}  —  Page ${p} of ${pages}`, M, H - 24);
    doc.text('CONFIDENTIAL — Law Enforcement Sensitive', RIGHT, H - 24, { align: 'right' });
  }
  return doc;
}

/** Generate + trigger download. */
export function downloadCaseReport(data: CaseReportData): void {
  const doc = generateCaseReportPdf(data);
  const num = safe(data.caseRow?.case_number, 'case').replace(/[^\w-]/g, '_');
  doc.save(`case_report_${num}.pdf`);
}
