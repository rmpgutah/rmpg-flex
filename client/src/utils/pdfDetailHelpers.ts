// ============================================================
// RMPG Flex — PDF Detail Helpers (Phase E)
//
// New visual primitives that layer on top of the v1 generator
// toolkit:
//   - Quick-reference banner       (subject ID strip below header)
//   - Cross-reference badge bar    (linked-record counts as chips)
//   - Severity meter               (visual gauge for risk/priority/score)
//   - Empty-state row              ("(no records on file)" placeholder)
//   - Last-updated provenance line (one-line audit footer above sigs)
//
// These compose with `openAutoSection`/`closeAutoSection` from
// pdfGenerator.ts. Callers stay in control of section structure;
// these helpers just add the polish.
// ============================================================

import jsPDF from 'jspdf';
import {
  COLOR, BORDER, SPACING, LAYOUT, PDF_VALUE_FONT,
  getContentWidth,
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
  const bannerH = 8;
  const accentW = BORDER.ACCENT_SECTION;

  // Gold accent strip + light tinted background — distinct from
  // the dark section headers so the banner doesn't get confused
  // with section #1.
  doc.setFillColor(COLOR.ACCENT_GOLD[0], COLOR.ACCENT_GOLD[1], COLOR.ACCENT_GOLD[2]);
  doc.rect(margin, startY, accentW, bannerH, 'F');
  doc.setFillColor(COLOR.BG_SECTION_TINT[0], COLOR.BG_SECTION_TINT[1], COLOR.BG_SECTION_TINT[2]);
  doc.rect(margin + accentW, startY, cw - accentW, bannerH, 'F');
  doc.setDrawColor(COLOR.BORDER_SECTION[0], COLOR.BORDER_SECTION[1], COLOR.BORDER_SECTION[2]);
  doc.setLineWidth(BORDER.SECTION_OUTER);
  doc.rect(margin + accentW, startY, cw - accentW, bannerH);

  // Primary text — large, bold, dark
  const textX = margin + accentW + SPACING.CONTENT_INSET + 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(sanitizePdfText(cfg.primary || ''), textX, startY + 5.5);

  // Secondary identifier — small, muted, right of center
  if (cfg.secondary) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.TEXT_SECONDARY);
    doc.text(
      sanitizePdfText(cfg.secondary),
      textX + cw * 0.5,
      startY + 5.5,
    );
  }

  // Pill — top right
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
    const pillY = startY + (bannerH - 4) / 2;
    doc.setFillColor(pillBg[0], pillBg[1], pillBg[2]);
    doc.roundedRect(pillX, pillY, labelW, 4, 0.5, 0.5, 'F');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(cfg.pill.label, pillX + labelW / 2, pillY + 2.8, { align: 'center' });
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
  const barH = 5;
  const labelX = margin + 4;
  const labelY = startY + 3.5;

  // Subtle background tint behind the chip row
  doc.setFillColor(COLOR.BG_SECTION_TINT[0], COLOR.BG_SECTION_TINT[1], COLOR.BG_SECTION_TINT[2]);
  doc.rect(margin, startY, cw, barH, 'F');
  doc.setDrawColor(...COLOR.BORDER_FIELD_RULE);
  doc.setLineWidth(BORDER.FIELD);
  doc.line(margin, startY + barH, margin + cw, startY + barH);

  // Chip layout: each chip is `count LABEL` separated by " · "
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
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
    doc.setFillColor(chipColor[0], chipColor[1], chipColor[2]);
    doc.roundedRect(cursorX, startY + 1, countW, 3, 0.3, 0.3, 'F');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(countText, cursorX + countW / 2, labelY, { align: 'center' });
    cursorX += countW + 1.5;

    // Label
    doc.setTextColor(...COLOR.TEXT_PRIMARY);
    doc.text(b.label.toUpperCase(), cursorX, labelY);
    cursorX += doc.getTextWidth(b.label.toUpperCase());

    // Separator
    if (i < visible.length - 1) {
      doc.setTextColor(...COLOR.TEXT_TERTIARY);
      doc.text(' · ', cursorX, labelY);
      cursorX += doc.getTextWidth(' · ');
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
  const barH = 2.8;
  const labelH = 3.2;

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
  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.text(`${v} / 100`, x + width, y + 2, { align: 'right' });

  // Bar background + fill
  const barY = y + labelH;
  doc.setFillColor(COLOR.BORDER_FIELD_RULE[0], COLOR.BORDER_FIELD_RULE[1], COLOR.BORDER_FIELD_RULE[2]);
  doc.rect(x, barY, width, barH, 'F');
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.rect(x, barY, width * (v / 100), barH, 'F');
  doc.setDrawColor(...COLOR.BORDER_OUTER);
  doc.setLineWidth(BORDER.FIELD);
  doc.rect(x, barY, width, barH);

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
  doc.setFontSize(7);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text(`(${sanitizePdfText(message)})`, x, y + 3);
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

  doc.setFont(PDF_VALUE_FONT, 'normal');
  doc.setFontSize(6);
  doc.setTextColor(...COLOR.TEXT_TERTIARY);
  doc.text(sanitizePdfText(line), margin + cw, startY + 3, { align: 'right' });

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  return startY + 4;
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

