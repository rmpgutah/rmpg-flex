// ============================================================
// RMPG Flex — PDF Dossier Appendix Renderer
//
// Renders the cross-reference appendix that turns a person or
// vehicle PDF into a complete court packet. Sections are drawn
// in RISK-FIRST order (warrants first, then trespasses, then
// arrests, then operational contacts) so an officer scanning
// the appendix encounters threat info before chronology.
//
// Caller pattern: the React page invoking the PDF download
// fetches `/api/records/persons/:id/dossier` (or vehicles),
// stuffs the result into `data._dossier`, and calls
// `downloadRecordPdf`. The generator detects `_dossier` and
// invokes the appropriate renderer here.
//
// `_dossier` is in NON_CANONICAL_FIELDS (see pdfIntegrity.ts)
// so it does NOT affect the payload hash — the hash binds to
// the source record only, not to whichever appendix snapshot
// was attached at print-time.
// ============================================================

import jsPDF from 'jspdf';
import { parseTimestamp } from './dateUtils';
import {
  openAutoSection, closeAutoSection, addTableWithShading, checkPageBreak,
} from './pdfGenerator';
import { LAYOUT, SPACING, COLOR, BORDER, PDF_VALUE_FONT, getContentWidth } from './pdfTokens';

// ── Dossier shapes (mirror server/src/utils/personDossier.ts + vehicleDossier.ts) ─

export interface PersonDossierData {
  person?: any;
  warrants?: { count: number; rows: any[]; activeCount: number };
  trespassOrders?: { count: number; rows: any[]; activeCount: number };
  arrests?: { count: number; rows: any[]; mostRecent: string | null };
  incidents?: { count: number; rows: any[] };
  calls?: { count: number; rows: any[] };
  citations?: { count: number; rows: any[]; unpaidCount: number };
  fieldInterviews?: { count: number; rows: any[] };
  summary?: {
    riskLevel: 'high' | 'elevated' | 'standard';
    activeWarrants: number;
    activeTrespasses: number;
    totalContacts: number;
  };
}

export interface VehicleDossierData {
  vehicle?: any;
  owner?: any | null;
  incidents?: { count: number; rows: any[] };
  calls?: { count: number; rows: any[] };
  citations?: { count: number; rows: any[]; unpaidCount: number };
  fieldInterviews?: { count: number; rows: any[] };
  summary?: {
    riskLevel: 'high' | 'elevated' | 'standard';
    totalContacts: number;
    flagged: boolean;
  };
}

// ── Risk-first section ordering ───────────────────────────

type PersonSectionKey =
  | 'warrants' | 'trespassOrders' | 'arrests'
  | 'incidents' | 'calls' | 'citations' | 'fieldInterviews';

const PERSON_SECTION_ORDER: PersonSectionKey[] = [
  'warrants',
  'trespassOrders',
  'arrests',
  'incidents',
  'calls',
  'citations',
  'fieldInterviews',
];

const PERSON_SECTION_TITLES: Record<PersonSectionKey, string> = {
  warrants:        'WARRANTS',
  trespassOrders:  'TRESPASS ORDERS',
  arrests:         'ARREST RECORDS',
  incidents:       'INCIDENTS',
  calls:           'DISPATCH CALLS',
  citations:       'CITATIONS',
  fieldInterviews: 'FIELD INTERVIEWS',
};

type VehicleSectionKey = 'incidents' | 'calls' | 'citations' | 'fieldInterviews';

const VEHICLE_SECTION_ORDER: VehicleSectionKey[] = [
  'incidents',
  'calls',
  'citations',
  'fieldInterviews',
];

const VEHICLE_SECTION_TITLES: Record<VehicleSectionKey, string> = {
  incidents:       'INCIDENTS',
  calls:           'DISPATCH CALLS',
  citations:       'CITATIONS',
  fieldInterviews: 'FIELD INTERVIEWS',
};

// ── Public renderers ──────────────────────────────────────

export function renderPersonDossierAppendix(
  doc: jsPDF,
  dossier: PersonDossierData,
  startY: number,
): number {
  let y = startY;

  // Force a new page so the appendix starts cleanly — ensures
  // the cover sheet on the front of the PDF doesn't share a
  // page with the dossier opener.
  doc.addPage();
  y = LAYOUT.PAGE_MARGIN + SPACING.MD;

  y = drawDossierCover(doc, {
    title: 'CROSS-REFERENCE DOSSIER',
    subtitle: 'Aggregated record history at print-time',
    riskLevel: dossier.summary?.riskLevel || 'standard',
    summaryLines: buildPersonSummaryLines(dossier),
  }, y);

  for (const key of PERSON_SECTION_ORDER) {
    const section = (dossier as any)[key];
    if (!section || !Array.isArray(section.rows) || section.rows.length === 0) continue;
    const title = `${PERSON_SECTION_TITLES[key]} (${section.count})`;
    y = renderPersonSection(doc, key, title, section.rows, y);
  }

  return y;
}

export function renderVehicleDossierAppendix(
  doc: jsPDF,
  dossier: VehicleDossierData,
  startY: number,
): number {
  let y = startY;

  doc.addPage();
  y = LAYOUT.PAGE_MARGIN + SPACING.MD;

  y = drawDossierCover(doc, {
    title: 'CROSS-REFERENCE DOSSIER',
    subtitle: 'Aggregated vehicle history at print-time',
    riskLevel: dossier.summary?.riskLevel || 'standard',
    summaryLines: buildVehicleSummaryLines(dossier),
  }, y);

  for (const key of VEHICLE_SECTION_ORDER) {
    const section = (dossier as any)[key];
    if (!section || !Array.isArray(section.rows) || section.rows.length === 0) continue;
    const title = `${VEHICLE_SECTION_TITLES[key]} (${section.count})`;
    y = renderVehicleSection(doc, key, title, section.rows, y);
  }

  return y;
}

// ── Cover panel (banner with risk level) ─────────────────

function drawDossierCover(
  doc: jsPDF,
  cfg: {
    title: string;
    subtitle: string;
    riskLevel: 'high' | 'elevated' | 'standard';
    summaryLines: string[];
  },
  y: number,
): number {
  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);

  // Banner bar (10mm tall) — dark with gold accent strip.
  // Risk level overrides the banner background:
  //   HIGH      → red
  //   ELEVATED  → amber
  //   STANDARD  → dark charcoal
  const bannerH = 10;
  const accentW = BORDER.ACCENT_SECTION;
  const bgColor: [number, number, number] = cfg.riskLevel === 'high'
    ? [180, 25, 25]
    : cfg.riskLevel === 'elevated'
      ? [200, 130, 20]
      : [COLOR.BG_SECTION_HDR[0], COLOR.BG_SECTION_HDR[1], COLOR.BG_SECTION_HDR[2]];

  doc.setFillColor(COLOR.ACCENT_GOLD[0], COLOR.ACCENT_GOLD[1], COLOR.ACCENT_GOLD[2]);
  doc.rect(margin, y, accentW, bannerH, 'F');
  doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
  doc.rect(margin + accentW, y, cw - accentW, bannerH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(cfg.title, margin + accentW + SPACING.CONTENT_INSET + 2, y + 5.5);

  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(cfg.subtitle, margin + accentW + SPACING.CONTENT_INSET + 2, y + 8.8);

  // Risk badge (top-right of banner)
  const riskLabel = `RISK: ${cfg.riskLevel.toUpperCase()}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const labelW = doc.getTextWidth(riskLabel) + 4;
  doc.setFillColor(...COLOR.TEXT_INVERTED);
  doc.setTextColor(bgColor[0], bgColor[1], bgColor[2]);
  doc.roundedRect(
    margin + cw - labelW - 2,
    y + (bannerH - 4) / 2,
    labelW,
    4,
    0.5, 0.5,
    'F',
  );
  doc.text(
    riskLabel,
    margin + cw - labelW / 2 - 2,
    y + bannerH / 2 + 1,
    { align: 'center' },
  );

  y += bannerH + SPACING.MD;

  // Summary block — bullet lines with section counts
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  for (const line of cfg.summaryLines) {
    doc.text(`* ${line}`, margin + 4, y);
    y += 4;
  }
  y += SPACING.MD;

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return y;
}

function buildPersonSummaryLines(d: PersonDossierData): string[] {
  // Always emit one line per category — including zero counts — so the
  // dossier reads "we checked and found N" rather than ambiguously
  // omitting categories that returned empty. The "(none on file)"
  // wording is preferred over a missing line for legal defensibility.
  const lines: string[] = [];
  const w = d.warrants?.count ?? 0;
  lines.push(w === 0
    ? 'Warrants: none on file'
    : `Warrants: ${d.warrants?.activeCount ?? 0} active of ${w} on record`);
  const t = d.trespassOrders?.count ?? 0;
  lines.push(t === 0
    ? 'Trespass orders: none on file'
    : `Trespass orders: ${d.trespassOrders?.activeCount ?? 0} active of ${t}`);
  const a = d.arrests?.count ?? 0;
  if (a === 0) {
    lines.push('Arrests: none on file');
  } else {
    const recent = d.arrests?.mostRecent ? ` — most recent ${formatDate(d.arrests.mostRecent)}` : '';
    lines.push(`Arrests: ${a} on record${recent}`);
  }
  if (d.summary) {
    lines.push(`Operational contacts: ${d.summary.totalContacts}`);
  }
  return lines;
}

function buildVehicleSummaryLines(d: VehicleDossierData): string[] {
  const lines: string[] = [];
  if (d.summary?.flagged) {
    lines.push('Vehicle is flagged in records (stolen / wanted)');
  }
  lines.push(d.incidents?.count
    ? `Incidents: ${d.incidents.count} involving this vehicle`
    : 'Incidents: none on file');
  lines.push(d.calls?.count
    ? `Dispatch calls: ${d.calls.count} related to this vehicle`
    : 'Dispatch calls: none on file');
  if ((d.citations?.count ?? 0) > 0) {
    lines.push(`Citations: ${d.citations!.count} — ${d.citations!.unpaidCount} unpaid/contested`);
  } else {
    lines.push('Citations: none on file');
  }
  if (d.fieldInterviews?.count) {
    lines.push(`${d.fieldInterviews.count} field interview(s) observing this vehicle`);
  }
  if (lines.length === 0) lines.push('No cross-referenced records found.');
  return lines;
}

// ── Per-section table rendering ──────────────────────────

function renderPersonSection(
  doc: jsPDF,
  key: PersonSectionKey,
  title: string,
  rows: any[],
  y: number,
): number {
  y = checkPageBreak(doc, y, 30);
  const sec = openAutoSection(doc, title, y);
  y = sec.contentY;

  const cw = getContentWidth(doc);
  const startX = LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET;

  const config = PERSON_TABLE_CONFIG[key];
  const colPositions = config.colRatios.map((_, i) => {
    const ratioSum = config.colRatios.reduce((a, b) => a + b, 0);
    const offset = config.colRatios.slice(0, i).reduce((a, b) => a + b, 0);
    return startX + (offset / ratioSum) * (cw - 2 * SPACING.CONTENT_INSET);
  });
  const headers = config.headers.map((label, i) => ({ label, x: colPositions[i] }));
  const tableRows = rows.map(config.toRow);

  y = addTableWithShading(doc, headers, tableRows, y, colPositions);
  y += SPACING.MD;
  return closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
}

function renderVehicleSection(
  doc: jsPDF,
  key: VehicleSectionKey,
  title: string,
  rows: any[],
  y: number,
): number {
  y = checkPageBreak(doc, y, 30);
  const sec = openAutoSection(doc, title, y);
  y = sec.contentY;

  const cw = getContentWidth(doc);
  const startX = LAYOUT.PAGE_MARGIN + SPACING.CONTENT_INSET;

  const config = VEHICLE_TABLE_CONFIG[key];
  const colPositions = config.colRatios.map((_, i) => {
    const ratioSum = config.colRatios.reduce((a, b) => a + b, 0);
    const offset = config.colRatios.slice(0, i).reduce((a, b) => a + b, 0);
    return startX + (offset / ratioSum) * (cw - 2 * SPACING.CONTENT_INSET);
  });
  const headers = config.headers.map((label, i) => ({ label, x: colPositions[i] }));
  const tableRows = rows.map(config.toRow);

  y = addTableWithShading(doc, headers, tableRows, y, colPositions);
  y += SPACING.MD;
  return closeAutoSection(doc, sec.sectionY, y, undefined, sec.sectionPage);
}

// ── Table column configurations per section ──────────────
// colRatios are proportional widths summing to anything (renderer
// normalizes); headers/toRow must match in length.

interface TableConfig {
  headers: string[];
  colRatios: number[];
  toRow: (r: any) => string[];
}

const PERSON_TABLE_CONFIG: Record<PersonSectionKey, TableConfig> = {
  warrants: {
    headers: ['WARRANT #', 'TYPE', 'STATUS', 'CHARGE', 'OFFENSE LEVEL', 'ISSUED'],
    colRatios: [16, 12, 10, 30, 14, 14],
    toRow: r => [
      r.warrant_number || '',
      r.type || '',
      r.status || '',
      r.charge_description || '',
      r.offense_level || '',
      formatDate(r.date_issued),
    ],
  },
  trespassOrders: {
    headers: ['ORDER #', 'TYPE', 'STATUS', 'LOCATION / PROPERTY', 'EFFECTIVE', 'EXPIRES'],
    colRatios: [16, 14, 10, 30, 12, 12],
    toRow: r => [
      r.order_number || '',
      r.order_type || '',
      r.status || '',
      r.property_name || r.location || '',
      formatDate(r.effective_date),
      formatDate(r.expiration_date),
    ],
  },
  arrests: {
    headers: ['NAME ON BOOKING', 'BOOKING DATE', 'COUNTY', 'STATUS', 'CHARGES'],
    colRatios: [22, 14, 12, 12, 36],
    toRow: r => [
      r.full_name || '',
      formatDate(r.booking_date),
      r.county || '',
      r.status || '',
      r.charges || '',
    ],
  },
  incidents: {
    headers: ['INCIDENT #', 'TYPE', 'PRIORITY', 'STATUS', 'ROLE', 'DATE'],
    colRatios: [16, 22, 10, 12, 14, 14],
    toRow: r => [
      r.incident_number || '',
      r.incident_type || '',
      String(r.priority ?? ''),
      r.status || '',
      r.role || '',
      formatDate(r.created_at),
    ],
  },
  calls: {
    headers: ['CALL #', 'TYPE', 'PRIORITY', 'STATUS', 'LOCATION', 'DATE'],
    colRatios: [14, 18, 10, 12, 28, 14],
    toRow: r => [
      r.call_number || '',
      r.incident_type || '',
      String(r.priority ?? ''),
      r.status || '',
      r.location || '',
      formatDate(r.created_at),
    ],
  },
  citations: {
    headers: ['CITATION #', 'TYPE', 'STATUS', 'STATUTE', 'VIOLATION', 'FINE', 'DATE'],
    colRatios: [14, 12, 10, 14, 28, 8, 12],
    toRow: r => [
      r.citation_number || '',
      r.type || '',
      r.status || '',
      r.statute_citation || '',
      r.violation_description || '',
      r.fine_amount != null ? `$${Number(r.fine_amount).toFixed(2)}` : '',
      formatDate(r.violation_date),
    ],
  },
  fieldInterviews: {
    headers: ['FI #', 'LOCATION', 'REASON', 'TYPE', 'OFFICER', 'DATE'],
    colRatios: [14, 28, 14, 10, 18, 14],
    toRow: r => [
      r.fi_number || '',
      r.location || '',
      r.contact_reason || '',
      r.contact_type || '',
      r.officer_name || '',
      formatDate(r.created_at),
    ],
  },
};

const VEHICLE_TABLE_CONFIG: Record<VehicleSectionKey, TableConfig> = {
  incidents: {
    headers: ['INCIDENT #', 'TYPE', 'PRIORITY', 'STATUS', 'ROLE', 'DATE'],
    colRatios: [16, 22, 10, 12, 14, 14],
    toRow: r => [
      r.incident_number || '',
      r.incident_type || '',
      String(r.priority ?? ''),
      r.status || '',
      r.role || '',
      formatDate(r.created_at),
    ],
  },
  calls: {
    headers: ['CALL #', 'TYPE', 'PRIORITY', 'STATUS', 'LOCATION', 'DATE'],
    colRatios: [14, 18, 10, 12, 28, 14],
    toRow: r => [
      r.call_number || '',
      r.incident_type || '',
      String(r.priority ?? ''),
      r.status || '',
      r.location || '',
      formatDate(r.created_at),
    ],
  },
  citations: {
    headers: ['CITATION #', 'TYPE', 'STATUS', 'STATUTE', 'VIOLATION', 'FINE', 'DATE'],
    colRatios: [14, 12, 10, 14, 28, 8, 12],
    toRow: r => [
      r.citation_number || '',
      r.type || '',
      r.status || '',
      r.statute_citation || '',
      r.violation_description || '',
      r.fine_amount != null ? `$${Number(r.fine_amount).toFixed(2)}` : '',
      formatDate(r.violation_date),
    ],
  },
  fieldInterviews: {
    headers: ['FI #', 'LOCATION', 'PLATE OBSERVED', 'OFFICER', 'DATE'],
    colRatios: [14, 30, 16, 22, 14],
    toRow: r => [
      r.fi_number || '',
      r.location || '',
      r.vehicle_plate || '',
      r.officer_name || '',
      formatDate(r.created_at),
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = parseTimestamp(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()}`;
}

