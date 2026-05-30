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
import { parseTimestamp } from './dateUtils';
import {
  COLOR, BORDER, SPACING, LAYOUT, PDF_VALUE_FONT,
  getContentWidth,
} from './pdfTokens';
import { sanitizePdfText } from './pdfGenerator';
import type { BadgeTone, PostureLevel } from '../components/records/recordVisuals';

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

  // Dark slate banner with white text (2026-05-05 darker-shading
  // pass). The accent strip stays gray (ACCENT_GOLD token, now
  // dark-charcoal value); the banner body is the deep section-header
  // color so the primary identifier reads bold-white against a strong
  // dark base — the visual signature of a real police-form subheader.
  doc.setFillColor(COLOR.ACCENT_GOLD[0], COLOR.ACCENT_GOLD[1], COLOR.ACCENT_GOLD[2]);
  doc.rect(margin, startY, accentW, bannerH, 'F');
  doc.setFillColor(COLOR.BG_SECTION_HDR[0], COLOR.BG_SECTION_HDR[1], COLOR.BG_SECTION_HDR[2]);
  doc.rect(margin + accentW, startY, cw - accentW, bannerH, 'F');

  // Primary text — large, bold, white on dark
  const textX = margin + accentW + SPACING.CONTENT_INSET + 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLOR.TEXT_INVERTED);
  doc.text(sanitizePdfText(cfg.primary || ''), textX, startY + 5.5);

  // Pre-compute pill geometry so the secondary text can be width-clipped
  // to avoid running underneath the pill. Previously secondary text was
  // drawn unbounded from `textX + cw*0.5` onward, and on calls with a
  // long address (e.g. "1421 EAST FORT UNION BLVD, COTTONWOOD HEIGHTS,
  // UT 84121, USA") the address ran straight under the PRI pill on the
  // right edge — visible 2026-05-04. Compute pill bounds first; if a
  // pill is present, clip the secondary text to end before its left
  // edge with a 2mm gap.
  let pillLeftEdge = margin + cw;  // sentinel: no pill → use full width
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
    const pillY = startY + (bannerH - 4) / 2;
    doc.setFillColor(pillBg[0], pillBg[1], pillBg[2]);
    doc.roundedRect(pillX, pillY, labelW, 4, 0.5, 0.5, 'F');
    doc.setTextColor(...COLOR.TEXT_INVERTED);
    doc.text(cfg.pill.label, pillX + labelW / 2, pillY + 2.8, { align: 'center' });
  }

  // Secondary identifier — small, muted, right of center, clipped to
  // not overlap the pill on the right edge. Light-gray text sits on
  // the dark banner body so it reads as muted-white rather than
  // black-on-cream (which the previous palette emitted).
  if (cfg.secondary) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    const secondaryX = textX + cw * 0.5;
    const maxSecondaryW = Math.max(20, pillLeftEdge - secondaryX - 2);
    const lines = doc.splitTextToSize(sanitizePdfText(cfg.secondary), maxSecondaryW) as string[];
    doc.text(lines[0] || '', secondaryX, startY + 5.5);
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

// ── Threat-posture band (print mirror of the screen RecordHero) ──
//
// #794 introduced a dynamic threat-posture layer (recordVisuals.ts:
// recordPosture()) that rolls a record's many flags into one dominant
// critical/high/caution/clear treatment, rendered on-screen as the
// RecordHero threat bar. This band is the PRINT equivalent: it takes the
// SAME posture object so the paper report and the live panel can never
// disagree on how loud a record reads. Only the colors differ — screen
// glows are translucent rgba (built for the pure-black CAD surface) and
// wash out on white paper, so each tone maps to a saturated, ink-safe RGB.

/** Tone → print-safe RGB. Saturated equivalents of the BADGE_TONES screen
 *  palette, tuned to read against white paper (the screen rgba glows are
 *  far too light to print). Keep the hue families aligned with
 *  recordVisuals.BADGE_TONES so screen↔print stay visually coherent. */
export const POSTURE_PRINT_RGB: Record<BadgeTone, [number, number, number]> = {
  red:    [176, 28, 28],   // critical — armed / wanted / officer-safety
  orange: [196, 104, 16],  // high — felony / supervision / pursuit
  amber:  [183, 121, 12],  // caution — generic flag
  gold:   [150, 110, 16],  // notable-but-mild
  purple: [122, 70, 180],  // behavioral / mental-health
  pink:   [188, 50, 120],  // medical / self-harm
  blue:   [96, 104, 118],  // informational (neutral per zero-blue rule)
  teal:   [22, 130, 120],  // status-good-but-watch
  green:  [42, 120, 60],   // cleared / verified / positive
  gray:   [120, 120, 120], // neutral default
};

export interface ThreatPostureBandConfig {
  level: PostureLevel;
  tone: BadgeTone;
  /** Big posture label — OFFICER SAFETY / HIGH RISK / CAUTION / NO ACTIVE ALERTS. */
  label: string;
  /** Short context line beneath the label (e.g. "PRI P1 - DOMESTIC VIOLENCE"). */
  context?: string;
  /** Contributing flag labels rendered as small outlined chips on the right. */
  flags?: string[];
}

/**
 * Draw the posture band: a tinted full-width strip with a colored left
 * accent, the dominant posture label in tone color, an optional context
 * line, and right-aligned chips for the contributing flags. Mirrors the
 * RecordHero threat bar so a printed Call report carries the same
 * at-a-glance danger read as the on-screen record panel.
 *
 * Always renders (callers decide whether a 'clear' posture is worth the
 * vertical space). Returns the new Y.
 */
export function drawThreatPostureBand(
  doc: jsPDF,
  cfg: ThreatPostureBandConfig,
  startY: number,
): number {
  const margin = LAYOUT.PAGE_MARGIN;
  const cw = getContentWidth(doc);
  const rgb = POSTURE_PRINT_RGB[cfg.tone] ?? POSTURE_PRINT_RGB.gray;
  const bandH = 8;
  const accentW = BORDER.ACCENT_SECTION;

  // Severity-adaptive treatment. critical/high get a SOLID loud band with
  // white text — this is the "do not miss" register that replaces the old
  // standalone red CAUTION strip. caution/clear get a faint tonal wash so the
  // form isn't a christmas tree for low-severity calls (the tactical-CAD
  // theme prizes restraint — one loud signal beats ten medium ones).
  const solid = cfg.level === 'critical' || cfg.level === 'high';

  if (solid) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(margin, startY, cw, bandH, 'F');
  } else {
    const tint: [number, number, number] = [
      Math.round(rgb[0] * 0.12 + 255 * 0.88),
      Math.round(rgb[1] * 0.12 + 255 * 0.88),
      Math.round(rgb[2] * 0.12 + 255 * 0.88),
    ];
    doc.setFillColor(tint[0], tint[1], tint[2]);
    doc.rect(margin, startY, cw, bandH, 'F');
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(margin, startY, accentW, bandH, 'F');
  }
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(0.3);
  doc.rect(margin, startY, cw, bandH);

  // Text colors flip for the solid treatment.
  const miniColor: readonly [number, number, number] = solid ? [235, 225, 225] : COLOR.TEXT_TERTIARY;
  const labelColor: readonly [number, number, number] = solid ? COLOR.TEXT_INVERTED : rgb;
  const ctxColor: readonly [number, number, number] = solid ? [240, 235, 235] : COLOR.TEXT_SECONDARY;

  // ── Left block: mini-label + big posture word + context line ──
  const tx = margin + accentW + 2.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(miniColor[0], miniColor[1], miniColor[2]);
  doc.text('THREAT POSTURE', tx, startY + 2.6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(labelColor[0], labelColor[1], labelColor[2]);
  const labelText = sanitizePdfText(cfg.label || '');
  doc.text(labelText, tx, startY + 6.4);
  const labelW = doc.getTextWidth(labelText);

  if (cfg.context) {
    doc.setFont(PDF_VALUE_FONT, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(ctxColor[0], ctxColor[1], ctxColor[2]);
    doc.text(sanitizePdfText(cfg.context), tx + labelW + 3, startY + 6.4);
  }

  // ── Right block: contributing-flag chips, packed right-to-left so the
  //    most-severe (first) chip sits nearest the posture word. Capped so a
  //    flag-heavy call doesn't overrun the left label. ──
  if (cfg.flags && cfg.flags.length > 0) {
    const chipY = startY + (bandH - 3.6) / 2;
    const chipH = 3.6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    let edge = margin + cw - 2;               // right inner edge
    const minLeft = tx + labelW + (cfg.context ? 40 : 6); // don't crowd label
    let shown = 0;
    for (const raw of cfg.flags) {
      const chipLabel = sanitizePdfText(raw);
      const chipW = doc.getTextWidth(chipLabel) + 4;
      if (edge - chipW < minLeft) {
        const remaining = cfg.flags.length - shown;
        if (remaining > 0) {
          const moreText = `+${remaining}`;
          const moreW = doc.getTextWidth(moreText) + 3;
          doc.setTextColor(miniColor[0], miniColor[1], miniColor[2]);
          doc.text(moreText, edge - moreW / 2, chipY + 2.5, { align: 'center' });
        }
        break;
      }
      const chipX = edge - chipW;
      if (solid) {
        // White-outline chips on the solid band.
        doc.setDrawColor(...COLOR.TEXT_INVERTED);
        doc.setLineWidth(0.25);
        doc.roundedRect(chipX, chipY, chipW, chipH, 0.4, 0.4, 'D');
        doc.setTextColor(...COLOR.TEXT_INVERTED);
      } else {
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.25);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(chipX, chipY, chipW, chipH, 0.4, 0.4, 'FD');
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      }
      doc.text(chipLabel, chipX + chipW / 2, chipY + 2.5, { align: 'center' });
      edge = chipX - 1.5;
      shown++;
    }
  }

  doc.setTextColor(...COLOR.TEXT_PRIMARY);
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return startY + bandH + SPACING.MD;
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
  // parseTimestamp reads naive server strings as UTC (Date.parse treats them as
  // device-local → wrong instant); display pinned to Mountain Time.
  const d = parseTimestamp(iso);
  if (isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Denver' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Denver' });
  return `${date} ${time}`;
}

