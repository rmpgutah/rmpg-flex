// ============================================================
// RMPG Flex — PDF Detail Helpers (Phase E + 75-improvement pass)
//
// Visual primitives that layer on top of the v1 generator toolkit:
//   - Quick-reference banner       (subject ID strip below header)
//   - Cross-reference badge bar    (linked-record counts as chips)
//   - Severity meter               (visual gauge for risk/priority/score)
//   - Empty-state row              ("(no records on file)" placeholder)
//   - Last-updated provenance line (one-line audit footer above sigs)
//   - Double-rule section divider  (major-break visual separator)
//   - Data summary strip           (compact key-value highlight row)
//   - Status indicator dot         (inline colored status marker)
//   - Page-edge label              (rotated "ORIGINAL" / "COPY" marker)
//   - Compact info box             (bordered callout for key details)
//
// These compose with `openAutoSection`/`closeAutoSection` from
// pdfGenerator.ts. Callers stay in control of section structure;
// these helpers just add the polish.
// ============================================================

import jsPDF from 'jspdf';
import {
  COLOR, BORDER, SPACING, LAYOUT, FONT, PDF_VALUE_FONT,
  getContentWidth, getRemainingPageHeight,
} from './pdfTokens';
import { sanitizePdfText } from './pdfGenerator';

// ── Quick-reference banner ──────────────────────────────
//
// A 7mm-tall strip immediately below the form header showing
// the most important "what is this PDF about?" identifier in
// large text. Operators scanning a paper file can find the
// right document in 0.5s instead of reading three rows.

export interface QuickRefBannerConfig {
  /** Big primary text — subject name, plate, citation #, etc. */
  primary: string;
  /** Smaller right-hand identifier — DOB, VIN, statute, etc. */
  secondary?: string;
  /** Optional risk/status pill on the right side. */
  pill?: { label: string; tone: 'high' | 'elevated' | 'standard' | 'inactive' };
}

export function addQuickReferenceBanner(
  doc: jsPDF,
  cfg: QuickRefBannerConfig,
  startY: number,
): number {
  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);
  // [Improvement 51] Banner height uses token instead of hardcoded 8mm
  const bannerH = SPACING.QUICK_REF_H;
  const accentW = BORDER.ACCENT_SECTION;

  // Dark slate banner with white text
  doc.setFillColor(COLOR.ACCENT_GOLD[0], COLOR.ACCENT_GOLD[1], COLOR.ACCENT_GOLD[2]);
  doc.rect(margin, startY, accentW, bannerH, 'F');
  doc.setFillColor(COLOR.BG_SECTION_HDR[0], COLOR.BG_SECTION_HDR[1], COLOR.BG_SECTION_HDR[2]);
  doc.rect(margin + accentW, startY, cw - accentW, bannerH, 'F');

  // [Improvement 52] Bottom border on banner for crisp definition
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.line(margin, startY + bannerH, margin + cw, startY + bannerH);

  // Primary text — large, bold, white on dark
  const textX = margin + accentW + SPACING.CONTENT_INSET + 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_QUICK_REF_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  // [Improvement 53] Vertically centered primary text using cap-height math
  const primaryCapH = FONT.SIZE_QUICK_REF_PRIMARY * 0.35;
  const primaryTextY = startY + (bannerH + primaryCapH) / 2;
  doc.text(sanitizePdfText(cfg.primary || ''), textX, primaryTextY);

  // Pre-compute pill geometry so the secondary text can be width-clipped
  let pillLeftEdge = margin + cw;
  if (cfg.pill && cfg.pill.label) {
    const pillBg: [number, number, number] = cfg.pill.tone === 'high'
      ? [180, 25, 25]
      : cfg.pill.tone === 'elevated'
        ? [200, 130, 20]
        : cfg.pill.tone === 'inactive'
          ? [110, 110, 110]
          : [60, 120, 70];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const labelW = doc.getTextWidth(cfg.pill.label) + 4;
    const pillX = margin + cw - labelW - 2;
    pillLeftEdge = pillX;
    // [Improvement 54] Pill vertically centered in banner
    const pillH = 4.2;
    const pillY = startY + (bannerH - pillH) / 2;
    doc.setFillColor(pillBg[0], pillBg[1], pillBg[2]);
    doc.roundedRect(pillX, pillY, labelW, pillH, 0.5, 0.5, 'F');
    // [Improvement 55] Pill outline for definition on photocopies
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(BORDER.PILL_OUTLINE);
    doc.roundedRect(pillX, pillY, labelW, pillH, 0.5, 0.5);
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    const pillCapH = 7 * 0.35;
    doc.text(cfg.pill.label, pillX + labelW / 2, pillY + (pillH + pillCapH) / 2, { align: 'center' });
  }

  // Secondary identifier — small, muted, clipped to avoid pill overlap
  if (cfg.secondary) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(FONT.SIZE_QUICK_REF_SECONDARY);
    doc.setTextColor(200, 200, 200);
    const secondaryX = textX + cw * 0.5;
    const maxSecondaryW = Math.max(20, pillLeftEdge - secondaryX - 2);
    const lines = doc.splitTextToSize(sanitizePdfText(cfg.secondary), maxSecondaryW) as string[];
    doc.text(lines[0] || '', secondaryX, primaryTextY);
  }

  // Reset state
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return startY + bannerH + SPACING.MD;
}

// ── Cross-reference badge bar ───────────────────────────
//
// A single-row strip of chips showing linked-record counts:
//   [ 5 WARRANTS · 3 INCIDENTS · 12 CALLS · 1 TRESPASS ]
// Renders only chips with non-zero counts so the bar adapts
// to whatever is actually linked. Empty data → no row drawn,
// returns startY unchanged.

export interface CrossRefBadge {
  label: string;
  count: number;
  /** Tone overrides default coloring — 'risk' uses red. */
  tone?: 'risk' | 'standard';
}

export function addCrossRefBadgeBar(
  doc: jsPDF,
  badges: CrossRefBadge[],
  startY: number,
): number {
  const visible = badges.filter(b => b.count > 0);
  if (visible.length === 0) return startY;

  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);
  // [Improvement 56] Badge bar uses token height
  const barH = SPACING.CROSS_REF_BAR_H;
  const labelX = margin + 4;
  // [Improvement 57] Vertically centered text using cap-height
  const capH = FONT.SIZE_CROSS_REF_CHIP * 0.35;
  const labelY = startY + (barH + capH) / 2;

  // Subtle background tint behind the chip row
  doc.setFillColor(COLOR.BG_SECTION_TINT[0], COLOR.BG_SECTION_TINT[1], COLOR.BG_SECTION_TINT[2]);
  doc.rect(margin, startY, cw, barH, 'F');
  // [Improvement 58] Double-line border: top and bottom rules for
  // badge bar definition (replacing single bottom line)
  doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
  doc.setLineWidth(BORDER.TABLE_ROW);
  doc.line(margin, startY, margin + cw, startY);
  doc.line(margin, startY + barH, margin + cw, startY + barH);

  // Chip layout
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_CROSS_REF_CHIP);
  let cursorX = labelX;

  // Leading "LINKED:" header
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  const headerLabel = 'LINKED:';
  doc.text(headerLabel, cursorX, labelY);
  cursorX += doc.getTextWidth(headerLabel) + 2;

  for (let i = 0; i < visible.length; i++) {
    const b = visible[i];
    const chipColor: [number, number, number] = b.tone === 'risk'
      ? [180, 25, 25]
      : [COLOR.BG_SECTION_HDR[0], COLOR.BG_SECTION_HDR[1], COLOR.BG_SECTION_HDR[2]];

    // Count chip — small filled rectangle with white number
    const countText = String(b.count);
    const countW = doc.getTextWidth(countText) + 3;
    // [Improvement 59] Taller count chips with rounded corners
    const chipH = 3.5;
    const chipY = startY + (barH - chipH) / 2;
    doc.setFillColor(chipColor[0], chipColor[1], chipColor[2]);
    doc.roundedRect(cursorX, chipY, countW, chipH, 0.4, 0.4, 'F');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    const chipCapH = FONT.SIZE_CROSS_REF_CHIP * 0.35;
    doc.text(countText, cursorX + countW / 2, chipY + (chipH + chipCapH) / 2, { align: 'center' });
    cursorX += countW + 1.5;

    // Label
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(b.label.toUpperCase(), cursorX, labelY);
    cursorX += doc.getTextWidth(b.label.toUpperCase());

    // [Improvement 60] Separator dot slightly larger for visibility
    if (i < visible.length - 1) {
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text('  ·  ', cursorX, labelY);
      cursorX += doc.getTextWidth('  ·  ');
    }
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return startY + barH + SPACING.MD;
}

// ── Severity / risk meter ───────────────────────────────
//
// Visual gauge showing a 0-100 score (or 0-N normalized) with
// a tinted-fill bar and a label. Used for warrant priority,
// case solvability, vehicle stolen confidence, etc.

export function addSeverityMeter(
  doc: jsPDF,
  cfg: {
    label: string;
    value: number;        // 0..100
    /** Optional override of color thresholds. Defaults: 0-33 green, 34-66 amber, 67-100 red. */
    invert?: boolean;     // if true, high = green (e.g. solvability score)
  },
  x: number,
  y: number,
  width: number,
): number {
  const v = Math.max(0, Math.min(100, cfg.value));
  // [Improvement 61] Taller meter bar for better visibility
  const barH = 3.2;
  const labelH = 3.5;

  // Threshold-driven color
  let fill: [number, number, number];
  if (cfg.invert) {
    fill = v >= 67 ? [60, 120, 70] : v >= 34 ? [200, 130, 20] : [180, 25, 25];
  } else {
    fill = v >= 67 ? [180, 25, 25] : v >= 34 ? [200, 130, 20] : [60, 120, 70];
  }

  // Label + numeric value above the bar
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  doc.text(cfg.label.toUpperCase(), x, y + 2);
  // [Improvement 62] Value shown as percentage for clarity
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(`${v}%`, x + width, y + 2, { align: 'right' });

  // [Improvement 63] Bar with rounded ends for modern look
  const barY = y + labelH;
  // Track background
  doc.setFillColor(COLOR.BORDER_FIELD_RULE[0], COLOR.BORDER_FIELD_RULE[1], COLOR.BORDER_FIELD_RULE[2]);
  doc.roundedRect(x, barY, width, barH, barH / 2, barH / 2, 'F');
  // Fill bar — clamp minimum visible width
  const fillW = Math.max(barH, width * (v / 100));
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.roundedRect(x, barY, fillW, barH, barH / 2, barH / 2, 'F');
  // [Improvement 64] Subtle outline around the full bar track
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(0.15);
  doc.roundedRect(x, barY, width, barH, barH / 2, barH / 2);

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return barY + barH + SPACING.SM;
}

// ── Empty-state row ─────────────────────────────────────
//
// Renders "(NO RECORDS ON FILE)" as italic muted text inside
// the current section content area. Returns the new Y so the
// section closer renders its bottom rule cleanly.

export function addEmptyStateRow(
  doc: jsPDF,
  message: string,
  x: number,
  y: number,
): number {
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.SIZE_EMPTY_STATE);
  doc.setTextColor(...COLOR.TEXT_PLACEHOLDER);
  // [Improvement 65] Em-dash prefix for visual anchoring of empty state
  doc.text(`— ${sanitizePdfText(message).toUpperCase()} —`, x, y + 3);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + 5;
}

// ── Last-updated / provenance line ──────────────────────
//
// One-line audit-trail placement immediately above the
// signature block. "Last updated: 2026-04-12 14:23 by S.NESBITT
// (badge 142)". When updated_at is absent, falls back to
// created_at; when both absent, renders nothing.

export function addProvenanceLine(
  doc: jsPDF,
  cfg: {
    createdAt?: string;
    updatedAt?: string;
    createdByName?: string;
    updatedByName?: string;
  },
  startY: number,
): number {
  const ts = cfg.updatedAt || cfg.createdAt;
  if (!ts) return startY;

  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);
  const verb = cfg.updatedAt ? 'Last updated' : 'Created';
  const who = cfg.updatedByName || cfg.createdByName;

  let line = `${verb}: ${formatTimestamp(ts)}`;
  if (who) line += ` by ${who.toUpperCase()}`;

  // [Improvement 66] Provenance line with subtle divider above
  doc.setDrawColor(...COLOR.DIVIDER_RULE);
  doc.setLineWidth(0.15);
  doc.line(margin + cw * 0.5, startY + 0.5, margin + cw, startY + 0.5);

  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(FONT.SIZE_PROVENANCE);
  doc.setTextColor(...COLOR.TEXT_CAPTION);
  doc.text(sanitizePdfText(line), margin + cw, startY + 3.5, { align: 'right' });

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return startY + 5;
}

// ── Linked-records strip helper ─────────────────────────
//
// Convenience wrapper that builds badge entries from the
// shared *PdfData shape (`warrants`, `incidents`, `calls`, ...)
// — usable from any record generator that has these arrays
// hanging off it.

export function addLinkedRecordsStrip(
  doc: jsPDF,
  data: any,
  startY: number,
): number {
  const badges: CrossRefBadge[] = [];
  if (Array.isArray(data?.warrants) && data.warrants.length > 0) {
    badges.push({
      label: 'warrants',
      count: data.warrants.length,
      tone: data.warrants.some((w: any) => w.status === 'active') ? 'risk' : 'standard',
    });
  }
  if (Array.isArray(data?.incidents) && data.incidents.length > 0) {
    badges.push({ label: 'incidents', count: data.incidents.length });
  }
  if (Array.isArray(data?.calls) && data.calls.length > 0) {
    badges.push({ label: 'calls', count: data.calls.length });
  }
  if (Array.isArray(data?.citations) && data.citations.length > 0) {
    badges.push({ label: 'citations', count: data.citations.length });
  }
  if (Array.isArray(data?.criminal_records) && data.criminal_records.length > 0) {
    badges.push({
      label: 'arrests',
      count: data.criminal_records.length,
      tone: 'risk',
    });
  }
  if (Array.isArray(data?.linked_vehicles) && data.linked_vehicles.length > 0) {
    badges.push({ label: 'vehicles', count: data.linked_vehicles.length });
  }
  if (Array.isArray(data?.linked_properties) && data.linked_properties.length > 0) {
    badges.push({ label: 'properties', count: data.linked_properties.length });
  }
  if (Array.isArray(data?.trespass_orders) && data.trespass_orders.length > 0) {
    badges.push({ label: 'trespasses', count: data.trespass_orders.length, tone: 'risk' });
  }
  return addCrossRefBadgeBar(doc, badges, startY);
}

// ── Helpers ─────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return iso;
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// ── New Visual Helpers (75-improvement pass, 2026-05-09) ────

// [Improvement 67] Double-rule section divider — heavyweight visual
// break between major document areas (e.g. between Incident Overview
// and Persons Involved sections). Two thin parallel lines with a gap
// between them, optionally with a centered label.

export function addDoubleRuleDivider(
  doc: jsPDF,
  startY: number,
  label?: string,
): number {
  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);

  doc.setDrawColor(...COLOR.BORDER_DOUBLE_RULE);
  doc.setLineWidth(BORDER.DOUBLE_RULE);
  doc.line(margin, startY, margin + cw, startY);
  doc.line(margin, startY + BORDER.DOUBLE_RULE_GAP, margin + cw, startY + BORDER.DOUBLE_RULE_GAP);

  if (label) {
    // Center label between the two rules
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(FONT.SIZE_DIVIDER_LABEL);
    doc.setTextColor(...COLOR.TEXT_CAPTION);
    const labelW = doc.getTextWidth(label.toUpperCase()) + 4;
    const labelX = margin + (cw - labelW) / 2;
    // White-out behind label text
    doc.setFillColor(255, 255, 255);
    doc.rect(labelX, startY - 0.3, labelW, BORDER.DOUBLE_RULE_GAP + 0.6, 'F');
    doc.text(label.toUpperCase(), margin + cw / 2, startY + BORDER.DOUBLE_RULE_GAP / 2 + 0.8, { align: 'center' });
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.setFont(PDF_VALUE_FONT, 'normal');
  }

  return startY + BORDER.DOUBLE_RULE_GAP + SPACING.DOUBLE_RULE_GAP;
}

// [Improvement 68] Data summary strip — compact horizontal row of
// key-value pairs rendered as label:value chips in a tinted bar.
// Used for at-a-glance data summaries (e.g. "CALLS: 12  ARRESTS: 3
// WARRANTS: 1  TOTAL CONTACTS: 47").

export interface SummaryItem {
  label: string;
  value: string;
  /** Bold the value for emphasis */
  bold?: boolean;
}

export function addDataSummaryStrip(
  doc: jsPDF,
  items: SummaryItem[],
  startY: number,
): number {
  if (!items || items.length === 0) return startY;

  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);
  const stripH = 5.5;

  // Tinted background
  doc.setFillColor(COLOR.BG_SECTION_TINT[0], COLOR.BG_SECTION_TINT[1], COLOR.BG_SECTION_TINT[2]);
  doc.rect(margin, startY, cw, stripH, 'F');
  // Top and bottom rules
  doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
  doc.setLineWidth(0.15);
  doc.line(margin, startY, margin + cw, startY);
  doc.line(margin, startY + stripH, margin + cw, startY + stripH);

  // Layout items evenly across the strip
  const itemW = cw / items.length;
  const capH = 6.5 * 0.35;
  const textY = startY + (stripH + capH) / 2;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const x = margin + i * itemW + 3;

    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    const labelText = sanitizePdfText(item.label).toUpperCase() + ':';
    doc.text(labelText, x, textY);

    // Value
    const labelW = doc.getTextWidth(labelText) + 1.5;
    doc.setFont(PDF_VALUE_FONT, item.bold ? 'bold' : 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(sanitizePdfText(item.value).toUpperCase(), x + labelW, textY);

    // Separator between items
    if (i < items.length - 1) {
      doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
      doc.setLineWidth(0.15);
      doc.line(margin + (i + 1) * itemW, startY + 1, margin + (i + 1) * itemW, startY + stripH - 1);
    }
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return startY + stripH + SPACING.MD;
}

// [Improvement 69] Status indicator dot — inline colored circle with
// label text, used for showing record status (ACTIVE, CLEARED, PENDING)
// within field grids without a full flag badge.

export function addStatusDot(
  doc: jsPDF,
  status: string,
  x: number,
  y: number,
): { endX: number; endY: number } {
  const statusText = sanitizePdfText(status || '').toUpperCase();
  const dotR = 1.2;

  // Color based on status keyword
  let dotColor: [number, number, number] = [100, 100, 100]; // gray default
  if (/ACTIVE|OPEN|IN.?PROGRESS|DISPATCHED|ON.?SCENE/.test(statusText)) {
    dotColor = [40, 140, 60];   // green
  } else if (/CLEARED|CLOSED|COMPLETE|SERVED|RESOLVED/.test(statusText)) {
    dotColor = [80, 80, 90];    // dark gray
  } else if (/PENDING|QUEUED|WAITING|REVIEW/.test(statusText)) {
    dotColor = [200, 150, 30];  // amber
  } else if (/CANCELLED|VOID|EXPIRED|REJECTED/.test(statusText)) {
    dotColor = [180, 30, 30];   // red
  }

  // Draw filled circle
  doc.setFillColor(dotColor[0], dotColor[1], dotColor[2]);
  doc.circle(x + dotR, y - dotR + 0.3, dotR, 'F');

  // Status text
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  const textX = x + dotR * 2 + 1.5;
  doc.text(statusText, textX, y);

  const endX = textX + doc.getTextWidth(statusText) + 2;
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return { endX, endY: y };
}

// [Improvement 70] Page-edge label — rotated text marker along the
// right edge of the page (e.g. "ORIGINAL", "COPY 1", "FILE COPY").
// Applied once per page; typically called in the footer renderer.

export function addPageEdgeLabel(
  doc: jsPDF,
  label: string,
  pageNum?: number,
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_PAGE_LABEL);
  doc.setTextColor(...COLOR.TEXT_PLACEHOLDER);

  // Rotated text along right edge, centered vertically
  const textX = pageW - 3;
  const textY = pageH / 2;
  doc.text(
    sanitizePdfText(label).toUpperCase(),
    textX,
    textY,
    { align: 'center', angle: 90 },
  );

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  void pageNum; // reserved for future multi-copy numbering
}

// [Improvement 71] Compact info box — bordered callout box with a
// title and 1-3 lines of key detail text. Used for highlighting
// critical information (court date, bond amount, expiration date)
// without a full section header.

export function addCompactInfoBox(
  doc: jsPDF,
  cfg: {
    title: string;
    lines: string[];
    tone?: 'neutral' | 'warning' | 'critical';
  },
  x: number,
  y: number,
  width: number,
): number {
  const titleH = 4;
  const lineH = 3.5;
  const totalH = titleH + cfg.lines.length * lineH + 2;

  // Background tint based on tone
  const bgColor: [number, number, number] = cfg.tone === 'critical'
    ? [255, 245, 245]
    : cfg.tone === 'warning'
      ? [255, 250, 235]
      : [248, 248, 252];
  const borderColor: [number, number, number] = cfg.tone === 'critical'
    ? [200, 60, 60]
    : cfg.tone === 'warning'
      ? [200, 150, 40]
      : [...COLOR.BORDER_SECTION] as [number, number, number];

  doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
  doc.rect(x, y, width, totalH, 'F');
  doc.setDrawColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.setLineWidth(BORDER.FIELD);
  doc.rect(x, y, width, totalH);
  // Left accent strip
  doc.setFillColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.rect(x, y, 1.5, totalH, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT.SIZE_FIELD_LABEL);
  doc.setTextColor(borderColor[0], borderColor[1], borderColor[2]);
  doc.text(sanitizePdfText(cfg.title).toUpperCase(), x + 4, y + 3);

  // Lines
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  let lineY = y + titleH + 2;
  for (const line of cfg.lines) {
    doc.text(sanitizePdfText(line).toUpperCase(), x + 4, lineY);
    lineY += lineH;
  }

  doc.setDrawColor(...COLOR.TEXT_PRIMARY);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + totalH + SPACING.MD;
}

// [Improvement 72] Image caption — renders a centered caption below
// an embedded image with the filename and dimensions.

export function addImageCaption(
  doc: jsPDF,
  caption: string,
  x: number,
  y: number,
  width: number,
): number {
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(FONT.SIZE_IMAGE_CAPTION);
  doc.setTextColor(...COLOR.TEXT_CAPTION);
  doc.text(sanitizePdfText(caption).toUpperCase(), x + width / 2, y + 2.5, { align: 'center' });
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return y + 4;
}

// [Improvement 73] Section count badge — small count indicator that
// appears in the section header bar showing how many items are in
// the section (e.g. "PERSONS INVOLVED (3)").

export function formatSectionTitle(title: string, count?: number): string {
  if (count == null || count <= 0) return title;
  return `${title} (${count})`;
}

// [Improvement 74] Inline key-value pair — renders "LABEL: VALUE" on
// a single line without a field box, used for compact metadata rows
// that don't need full field-pair treatment.

export function addInlineKeyValue(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(...COLOR.TEXT_SECONDARY);
  const labelText = sanitizePdfText(label).toUpperCase() + ':';
  doc.text(labelText, x, y);

  const labelW = doc.getTextWidth(labelText) + 1.5;
  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(value || 'N/A').toUpperCase(), x + labelW, y);

  doc.setFont(PDF_VALUE_FONT, 'normal');
  return y + 3.5;
}

// [Improvement 75] VOID watermark — distinct from CONFIDENTIAL and DRAFT,
// uses red X pattern for voided documents (citations, warrants).

export function addVoidWatermark(doc: jsPDF): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.saveGraphicsState();
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.10 }));
  doc.setFont(PDF_VALUE_FONT, 'bold');
  doc.setTextColor(COLOR.WATERMARK_VOID[0], COLOR.WATERMARK_VOID[1], COLOR.WATERMARK_VOID[2]);

  const cx = pageWidth / 2;
  const cy = pageHeight / 2;

  // Large "VOID" text
  doc.setFontSize(80);
  doc.text('VOID', cx, cy, { align: 'center', angle: 45 });

  // Diagonal cross lines
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.setDrawColor(COLOR.WATERMARK_VOID[0], COLOR.WATERMARK_VOID[1], COLOR.WATERMARK_VOID[2]);
  doc.setLineWidth(2);
  doc.line(15, 15, pageWidth - 15, pageHeight - 15);
  doc.line(pageWidth - 15, 15, 15, pageHeight - 15);

  doc.restoreGraphicsState();
  // @ts-expect-error jsPDF GState
  doc.setGState(new doc.GState({ opacity: 1.0 }));
}

