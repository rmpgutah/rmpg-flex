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

import { MIN_EXPOSURE_MILES } from './score';
import type { ScoreResult } from './score';

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
    forward_collision: number;
    lane_departure: number;
    close_following: number;
    harsh_brake: number;
    harsh_accel: number;
    speeding: number;
  };
  cost: { fuel: number; fuel_gallons: number; maintenance: number };
  result: ScoreResult;
}

export interface RenderDriverPerformancePdfParams {
  summary: DriverPerformanceSummary;
  window: { from: string; to: string };
  scoreVersion: string;
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

function toWinAnsiBytes(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x28 || cp === 0x29 || cp === 0x5c) { out.push(0x5c, cp); continue; } // ( ) \
    if (cp < 128) { out.push(cp); continue; }
    // Windows-1252 (WinAnsiEncoding) matches Unicode directly for 0xA0-0xFF
    // (Latin-1 supplement, e.g. the middle dot U+00B7 used as a separator).
    if (cp >= 0xa0 && cp <= 0xff) { out.push(cp); continue; }
    out.push(WIN_ANSI_MAP[cp] ?? 0x3f);
  }
  return out;
}

function asciiBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function pdfLiteral(str: string): Uint8Array {
  return Uint8Array.from([0x28, ...toWinAnsiBytes(str), 0x29]);
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

  constructor() { this.newPage(); }

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
    this.cur.ops.push(asciiBytes(pre), pdfLiteral(str), asciiBytes(' Tj ET\n'));
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
    const totalObjs = firstContentObj + pageCount * 2; // highest obj number
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
  const { summary, window, scoreVersion, generatedAt, organization } = params;
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
    pdf.wrapText(
      `Reason: this officer drove ${fmt(result.milesDriven, 1)} miles in the window, below the ` +
      `${MIN_EXPOSURE_MILES}-mile minimum required to compute a score. No band, rate, or ` +
      `confidence is shown because none was computed.`,
      { size: 10, gap: 10 },
    );
  }

  // 4. Event breakdown by type
  pdf.text('Event breakdown', { bold: true, size: 12, gap: 3 });
  const rows: [string, number][] = [
    ['Forward collision warning', summary.events.forward_collision],
    ['Lane departure', summary.events.lane_departure],
    ['Close following', summary.events.close_following],
    ['Harsh brake', summary.events.harsh_brake],
    ['Harsh acceleration', summary.events.harsh_accel],
    ['Speeding', summary.events.speeding],
  ];
  for (const [label, count] of rows) pdf.text(`${label}: ${count}`, { size: 10 });
  pdf.text(`Total events: ${summary.event_count}`, { size: 10, bold: true, gap: 10 });

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
        'Attribution for the majority of these events was inferred from vehicle assignment ' +
        'history rather than recorded at capture. Treat as a lead to investigate, not a finding.',
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
  pdf.wrapText(
    'Generated from immutable daily snapshots. Reproducible for this window under this score version.',
    { size: 8, color: GRAY },
  );

  return pdf.build();
}
