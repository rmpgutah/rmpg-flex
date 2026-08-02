// Evidence-grade PDF export for driver performance — hand-rolled PDF writer.
//
// WHY NOT jsPDF / pdf-lib: neither is a Worker dependency (see root
// package.json). Every existing PDF path in this Worker either proxies to
// the PDF_TOOLS container (qpdf — encrypts an EXISTING pdf, does not author
// one; src/routes/pdfTools.ts) or receives an already-built PDF from the
// BROWSER and relays/signs/emails it (src/routes/pdfEngine.ts,
// src/routes/serveReceipt.ts). The comment at serveReceipt.ts:857-967 is
// explicit: "jsPDF is the only [generator] ... the Worker cannot rasterize
// one." There is no server-side PDF *generator* seam to reuse. Rather than
// add a new dependency (disallowed by the task brief), this module writes
// the PDF byte structure directly: header, a handful of indirect objects
// (Catalog / Pages / Page / Font / Content stream), xref table, trailer.
// Text + simple rectangles only, standard Helvetica fonts (no embedding) —
// well within what raw PDF syntax expresses reliably by hand.
//
// Literal hex color values below are CORRECT per CLAUDE.md — PDF generators
// take literal color arguments and are excluded from the theme-token rule.

import { MIN_EXPOSURE_MILES, SCORING_ENABLED } from './score';
import { SPEED_THRESHOLDS } from './speedEvents';
import type { ScoreResult } from './score';
import { log } from '../logger';

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

type RGB = [number, number, number];

const BLACK: RGB = [0, 0, 0];
const GRAY: RGB = [0.35, 0.35, 0.35];
const WARN: RGB = [0.72, 0.42, 0.02]; // amber-ish, literal hex-equivalent RGB

export interface DriverPerformanceSummary {
  officer_id: number;
  officer_name: string | null;
  badge_number: string | null;
  miles_driven: number;
  drive_minutes: number;
  trip_count: number;
  event_count: number;
  events: {
    speed_high: number;
    speed_very_high: number;
    speed_extreme: number;
  };
  /** GPS breadcrumb samples behind the counts above. 0 with miles > 0 = dead feed. */
  breadcrumb_samples?: number;
  severity?: { critical: number; high: number; moderate: number; low: number };
  /** Events on a unit this officer drove that could not be tied to a driver. */
  unattributed_events?: number;
  cost: { fuel: number; fuel_gallons: number; maintenance: number };
  result: ScoreResult;
}

export interface RenderDriverPerformancePdfParams {
  summary: DriverPerformanceSummary;
  window: { from: string; to: string };
  /** The version that produced the score PRINTED here — not whatever the last stored snapshot happened to carry. */
  scoreVersion: string;
  /** Distinct score_version values across the window's stored snapshots. More than one is disclosed on the page. */
  storedVersions?: string[];
  generatedAt: string;
  organization: string;
}

const BAND_LABEL: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_attention: 'Needs Attention',
  at_risk: 'At Risk',
};

function fmt(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Windows-1252 (WinAnsiEncoding) mapping for the small set of non-ASCII
// characters this module actually emits (em dash, curly quotes, ellipsis).
// Anything else outside ASCII falls back to '?' rather than corrupting the
// byte stream — this is a hand-written PDF, not a general text shaper.
const WIN_ANSI_MAP: Record<number, number> = {
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
  0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85,
};

/**
 * ⚠️ The `?` fallback SILENTLY RENAMES A PERSON. An officer named Nguyễn
 * printed as "Nguy?n" on a document that may be read by an insurer or opposing
 * counsel, with nothing anywhere saying a character had been substituted — a
 * confident wrong name on an evidence record, which is the exact failure class
 * this whole feature is built against.
 *
 * The substitution is still made (a raw non-WinAnsi byte would corrupt the PDF
 * stream), but it is now REPORTED: `onFallback` fires per substituted
 * character so the caller can log it and stamp a disclosure on the page.
 */
function toWinAnsiBytes(str: string, onFallback?: (cp: number) => void): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x28 || cp === 0x29 || cp === 0x5c) { out.push(0x5c, cp); continue; } // ( ) \
    if (cp < 128) { out.push(cp); continue; }
    // Windows-1252 (WinAnsiEncoding) matches Unicode directly for 0xA0-0xFF
    // (Latin-1 supplement, e.g. the middle dot U+00B7 used as a separator).
    if (cp >= 0xa0 && cp <= 0xff) { out.push(cp); continue; }
    const mapped = WIN_ANSI_MAP[cp];
    if (mapped !== undefined) { out.push(mapped); continue; }
    onFallback?.(cp);
    out.push(0x3f);
  }
  return out;
}

function asciiBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function pdfLiteral(str: string, onFallback?: (cp: number) => void): Uint8Array {
  return Uint8Array.from([0x28, ...toWinAnsiBytes(str, onFallback), 0x29]);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  gap?: number;
}

class PdfPage {
  ops: Uint8Array[] = [];
  y = PAGE_HEIGHT - MARGIN;
}

class SimplePdfBuilder {
  private pages: PdfPage[] = [];
  private cur!: PdfPage;
  /** Code points that could not be represented in WinAnsiEncoding and were printed as '?'. */
  readonly substitutedCodePoints = new Set<number>();

  constructor() { this.newPage(); }

  /** True when at least one character on this document was replaced by '?'. */
  get hasSubstitutions(): boolean { return this.substitutedCodePoints.size > 0; }

  private newPage() {
    this.cur = new PdfPage();
    this.pages.push(this.cur);
  }

  private ensureSpace(height: number) {
    if (this.cur.y - height < MARGIN) this.newPage();
  }

  private drawLineAt(y: number, str: string, opts: TextOpts) {
    const size = opts.size ?? 10;
    const font = opts.bold ? 'F2' : 'F1';
    const [r, g, b] = opts.color ?? BLACK;
    const pre = `BT /${font} ${size} Tf ${r} ${g} ${b} rg ${MARGIN} ${y.toFixed(2)} Td `;
    const literal = pdfLiteral(str, (cp) => this.substitutedCodePoints.add(cp));
    this.cur.ops.push(asciiBytes(pre), literal, asciiBytes(' Tj ET\n'));
  }

  text(str: string, opts: TextOpts = {}) {
    const size = opts.size ?? 10;
    const lineHeight = size * 1.4;
    this.ensureSpace(lineHeight);
    this.cur.y -= lineHeight;
    this.drawLineAt(this.cur.y, str, opts);
    if (opts.gap) this.spacer(opts.gap);
  }

  wrapText(str: string, opts: TextOpts = {}) {
    const size = opts.size ?? 10;
    const maxChars = Math.max(20, Math.floor(CONTENT_WIDTH / (size * 0.5)));
    const words = str.split(' ');
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > maxChars && line) {
        this.text(line, opts);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) this.text(line, { ...opts, gap: opts.gap });
  }

  spacer(h: number) {
    this.ensureSpace(h);
    this.cur.y -= h;
  }

  hr(color: RGB = [0.6, 0.6, 0.6]) {
    this.ensureSpace(10);
    const [r, g, b] = color;
    this.cur.ops.push(asciiBytes(
      `${r} ${g} ${b} RG 0.75 w ${MARGIN} ${this.cur.y.toFixed(2)} m ${(PAGE_WIDTH - MARGIN)} ${this.cur.y.toFixed(2)} l S\n`,
    ));
    this.cur.y -= 10;
  }

  /** A visually separate, bordered/filled block — used for the cost summary. */
  box(title: string, lines: string[]) {
    const titleSize = 10.5;
    const bodySize = 10;
    const lineHeight = bodySize * 1.4;
    const pad = 10;
    const h = pad * 2 + titleSize * 1.4 + lineHeight * lines.length;
    this.ensureSpace(h + 10);
    const topY = this.cur.y;
    const boxY0 = topY - h;
    this.cur.ops.push(asciiBytes(
      `0.92 0.92 0.92 rg ${MARGIN} ${boxY0.toFixed(2)} ${CONTENT_WIDTH} ${h.toFixed(2)} re f\n` +
      `0.45 0.45 0.45 RG 0.75 w ${MARGIN} ${boxY0.toFixed(2)} ${CONTENT_WIDTH} ${h.toFixed(2)} re S\n`,
    ));
    let ty = topY - pad - titleSize;
    this.drawLineAt(ty, title, { bold: true, size: titleSize });
    ty -= titleSize * 0.4;
    for (const l of lines) {
      ty -= lineHeight;
      this.drawLineAt(ty, l, { size: bodySize });
    }
    this.cur.y = boxY0 - 10;
  }

  build(): Uint8Array {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let cursor = 0;
    const push = (bytes: Uint8Array) => { chunks.push(bytes); cursor += bytes.length; };
    const pushObj = (num: number, body: Uint8Array) => {
      offsets[num] = cursor;
      push(asciiBytes(`${num} 0 obj\n`));
      push(body);
      push(asciiBytes('\nendobj\n'));
    };

    push(asciiBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

    const pageCount = this.pages.length;
    const firstContentObj = 5;
    const kids: string[] = [];
    for (let i = 0; i < pageCount; i++) kids.push(`${firstContentObj + i * 2} 0 R`);

    // 1: Catalog, 2: Pages, 3: Font F1, 4: Font F2
    pushObj(1, asciiBytes('<< /Type /Catalog /Pages 2 0 R >>'));
    pushObj(2, asciiBytes(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`));
    pushObj(3, asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    pushObj(4, asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

    for (let i = 0; i < pageCount; i++) {
      const pageObjNum = firstContentObj + i * 2;
      const contentObjNum = pageObjNum + 1;
      pushObj(pageObjNum, asciiBytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum} 0 R >>`,
      ));
      const content = concatBytes(this.pages[i].ops);
      const streamBody = concatBytes([
        asciiBytes(`<< /Length ${content.length} >>\nstream\n`),
        content,
        asciiBytes('endstream'),
      ]);
      pushObj(contentObjNum, streamBody);
    }

    const xrefOffset = cursor;
    // Highest object number actually written. Objects run 1..4 (Catalog, Pages,
    // F1, F2) then a Page+Content PAIR per page starting at `firstContentObj`
    // (=5), so the last object is 4 + pageCount*2 — NOT 5 + pageCount*2. The
    // off-by-one declared one object more than existed in both the xref
    // subsection header and /Size, leaving a phantom entry pointing at offset 0
    // that strict PDF validators reject.
    const totalObjs = firstContentObj - 1 + pageCount * 2;
    let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= totalObjs; n++) {
      const off = offsets[n] ?? 0;
      xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    push(asciiBytes(xref));
    push(asciiBytes(
      `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    ));

    return concatBytes(chunks);
  }
}

export async function renderDriverPerformancePdf(
  params: RenderDriverPerformancePdfParams,
): Promise<Uint8Array> {
  // ⚠️ Belt-and-suspenders. The route's `callContextGate` already refuses
  // this call while scoring is gated (src/routes/driverPerformance.ts), so
  // in the live request path this branch never fires — but this function
  // authors an evidence-grade document that may outlive the code that calls
  // it, and it must never be able to print a scored PDF while
  // SCORING_ENABLED is false regardless of what future caller reaches it.
  if (!SCORING_ENABLED) {
    throw new Error(
      'renderDriverPerformancePdf: scoring is gated (awaiting_call_context) — refusing to render a ' +
      'scored document. Callers must check the callContextGate response before invoking this.',
    );
  }
  const { summary, window, scoreVersion, storedVersions, generatedAt, organization } = params;
  const pdf = new SimplePdfBuilder();

  // 1. Header
  pdf.text(`${organization} — Driver Performance Record`, { bold: true, size: 16, gap: 10 });

  // 2. Officer name/badge + reporting window
  pdf.text(
    `${summary.officer_name ?? 'Unknown officer'} · Badge ${summary.badge_number ?? 'N/A'}`,
    { size: 11, bold: true },
  );
  pdf.text(`Reporting window: ${window.from} to ${window.to}`, { size: 10, gap: 10 });

  // 3. Score/band/rate — ALWAYS with miles driven adjacent, or the explicit
  // unscored explanation. Never a bare score, never a band/rate/confidence
  // when the officer fell below MIN_EXPOSURE_MILES.
  pdf.text('Score & Exposure', { bold: true, size: 12, gap: 3 });
  const result = summary.result;
  if (result.status === 'scored') {
    pdf.text(
      `Score: ${fmt(result.score, 1)} (${BAND_LABEL[result.band] ?? result.band})`,
      { size: 12, bold: true },
    );
    pdf.text(
      `Weighted rate: ${fmt(result.weightedRatePer100Miles, 2)} weighted events per 100 miles`,
      { size: 10 },
    );
    pdf.text(`Miles driven this window: ${fmt(result.milesDriven, 1)} mi`, { size: 10, gap: 10 });
  } else {
    pdf.text('No score computed for this window.', { bold: true, size: 11, color: WARN });
    // The two unscored reasons mean OPPOSITE things about the officer and must
    // never share a sentence. Below the floor is about the officer's exposure;
    // a dead feed is about OUR instrumentation, and printing the mileage excuse
    // for a monitoring outage would quietly blame the wrong party.
    if (result.reason === 'no_breadcrumb_samples') {
      pdf.wrapText(
        `Reason: this officer drove ${fmt(result.milesDriven, 1)} miles in the window, but the ` +
        'position-reporting feed recorded NO GPS samples for that driving. Driving behavior was ' +
        'therefore not observed at all. This is a gap in monitoring, not a finding about this ' +
        "officer's driving, and must not be read as either good or bad performance.",
        { size: 10, color: WARN, gap: 10 },
      );
    } else {
      pdf.wrapText(
        `Reason: this officer drove ${fmt(result.milesDriven, 1)} miles in the window, below the ` +
        `${MIN_EXPOSURE_MILES}-mile minimum required to compute a score. No band, rate, or ` +
        `confidence is shown because none was computed.`,
        { size: 10, gap: 10 },
      );
    }
  }

  // 4. Event breakdown by type
  pdf.text('Event breakdown', { bold: true, size: 12, gap: 3 });
  const rows: [string, number][] = [
    // Labels are DERIVED from SPEED_THRESHOLDS, never restated as literals.
    // A retune that left "70+ mph" printed beside counts produced at an 85 mph
    // floor would put a false, specific, quotable claim about a named officer
    // onto an evidence document.
    [`Sustained speed ${SPEED_THRESHOLDS.high}+ mph`, summary.events.speed_high],
    [`Sustained speed ${SPEED_THRESHOLDS.veryHigh}+ mph`, summary.events.speed_very_high],
    [`Sustained speed ${SPEED_THRESHOLDS.extreme}+ mph`, summary.events.speed_extreme],
  ];
  for (const [label, count] of rows) pdf.text(`${label}: ${count}`, { size: 10 });
  pdf.text(`Total events: ${summary.event_count}`, { size: 10, bold: true, gap: 10 });
  // The counts above are only as meaningful as the observation volume behind
  // them. Printing the sample count next to them is what stops a reader from
  // taking "0 events" from a silent feed as evidence of clean driving.
  pdf.wrapText(
    `Each event is one SUSTAINED run above the stated speed (a continuous stretch counts once, ` +
    `tiered by its peak), derived from ${summary.breadcrumb_samples ?? 0} GPS position sample(s) ` +
    'recorded in this window. Harsh braking and harsh acceleration are deliberately NOT reported: ' +
    'the sampling interval is too coarse to distinguish them from ordinary slowing.',
    { size: 9, color: GRAY, gap: 10 },
  );

  // 4b. Severity breakdown — written by the nightly rollup since day one and
  // required by the spec, but never surfaced anywhere until now.
  if (summary.severity) {
    pdf.text('Severity breakdown', { bold: true, size: 12, gap: 3 });
    pdf.text(`Critical: ${summary.severity.critical}`, { size: 10 });
    pdf.text(`High: ${summary.severity.high}`, { size: 10 });
    pdf.text(`Moderate: ${summary.severity.moderate}`, { size: 10 });
    pdf.text(`Low: ${summary.severity.low}`, { size: 10, gap: 10 });
  }

  // 4c. Unattributed events — the doubt. Printed on its own, in warning color,
  // adjacent to the totals above so no reader can take "Total events: 0" as
  // proof of clean driving when events exist that no driver could be tied to.
  const unattributed = summary.unattributed_events ?? 0;
  if (unattributed > 0) {
    pdf.text('Events that could not be attributed to a driver', { bold: true, size: 12, gap: 3 });
    pdf.text(`Unattributed events: ${unattributed}`, { size: 11, bold: true, color: WARN });
    pdf.wrapText(
      `${unattributed} driving event(s) were recorded on a vehicle this officer drove during this ` +
      'window, but could not be tied to any specific driver (missing or ambiguous assignment ' +
      'records, or an event type this system does not recognize). They are NOT counted in the ' +
      'event totals above and are NOT reflected in the score. Their existence means the counts ' +
      'above are a floor, not a complete record: this window is not evidence of clean driving.',
      { size: 10, color: WARN, gap: 10 },
    );
  }

  // 5. Cost summary — visually separate block, exact required label.
  pdf.box('Cost attribution — not a factor in the safety score', [
    `Fuel cost: $${fmt(summary.cost.fuel, 2)} (${fmt(summary.cost.fuel_gallons, 1)} gal)`,
    `Maintenance cost: $${fmt(summary.cost.maintenance, 2)}`,
    `Total cost: $${fmt(summary.cost.fuel + summary.cost.maintenance, 2)}`,
  ]);

  // 6. Attribution confidence — only meaningful, and only printed, when scored.
  pdf.text('Attribution confidence', { bold: true, size: 12, gap: 3 });
  if (result.status === 'scored') {
    pdf.text(
      `Confidence: ${result.confidence === 'inferred' ? 'Inferred' : 'Recorded'}`,
      { size: 10, gap: result.confidence === 'inferred' ? 4 : 10 },
    );
    if (result.confidence === 'inferred') {
      pdf.wrapText(
        'Attribution for these events was inferred from vehicle assignment history rather than ' +
        'recorded at capture, and/or events exist on this officer\'s vehicles that could not be ' +
        'tied to any driver. Treat as a lead to investigate, not a finding.',
        { size: 10, color: WARN, gap: 10 },
      );
    }
  } else {
    pdf.text('Not applicable — no score was computed for this window.', { size: 10, gap: 10 });
  }

  // 7. Footer: score_version, generation timestamp, reproducibility statement.
  pdf.hr();
  pdf.text(`Score version: ${scoreVersion}`, { size: 8, color: GRAY });
  pdf.text(`Generated: ${generatedAt}`, { size: 8, color: GRAY });

  // I4 — the version above is the one that produced the score printed on this
  // page. If the stored daily snapshots behind it were not all computed under
  // that single version, say so rather than letting the footer's
  // reproducibility claim stand unqualified.
  const distinctStored = [...new Set((storedVersions ?? []).filter(Boolean))];
  const mixed = distinctStored.length > 1
    || (distinctStored.length === 1 && distinctStored[0] !== scoreVersion);
  if (mixed) {
    pdf.wrapText(
      `NOTICE: the score above was computed under ${scoreVersion}, but the stored daily ` +
      `snapshots covering this window carry ${distinctStored.length > 1 ? 'multiple score versions' : 'a different score version'} ` +
      `(${distinctStored.join(', ')}). The days behind this total were not all computed the same ` +
      'way. Reproducibility is limited to the version stamped above.',
      { size: 8, color: WARN },
    );
  } else {
    pdf.wrapText(
      'Generated from immutable daily snapshots. Reproducible for this window under this score version.',
      { size: 8, color: GRAY },
    );
  }

  // Character-substitution disclosure. Written LAST so it covers every string
  // placed on the document above it — including the officer's own name.
  if (pdf.hasSubstitutions) {
    const codes = [...pdf.substitutedCodePoints]
      .sort((a, b) => a - b)
      .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    log.warn('driver-performance PDF substituted unrepresentable characters', {
      officerId: summary.officer_id,
      window: `${window.from}..${window.to}`,
      codePoints: codes,
    });
    pdf.wrapText(
      `NOTICE: this document uses WinAnsi (Windows-1252) encoding and could not represent ` +
      `${codes.length} distinct character(s) (${codes.join(', ')}); each was printed as "?". ` +
      'Any name or text containing "?" may be rendered incorrectly here — verify against the ' +
      'system of record before relying on the spelling.',
      { size: 8, color: WARN },
    );
  }

  return pdf.build();
}
