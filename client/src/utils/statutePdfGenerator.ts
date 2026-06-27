// ============================================================
// RMPG Flex — Utah Law Book PDF generator
// ------------------------------------------------------------
// "Document printing internally from the system": turns one statute (or a whole
// chapter) into a clean, paginated legal document. The statutory text is laid
// out with the SAME (1)(a)(i) outline the on-screen reader uses (shared
// parseOutline), and each section carries its plain-language ("basic language")
// summary so the printed page mirrors the reading experience.
//
// Built on jsPDF + the repo's PDF conventions (letter / pt, Spillman black
// headers, gold accents, Times body / Helvetica chrome). Mirrors the
// buildXDoc()/generateXPdf() split used by the other generators so it can also
// run headless in tests.
// ============================================================
import jsPDF from 'jspdf';
import { parseOutline } from './statuteOutline';
import type { StatuteResult } from '../components/StatuteLookup';
import { registerArialFont } from './pdf/fonts/registerArial';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 34;

const GOLD: [number, number, number] = [0x9a, 0x6f, 0x0f];
const BLACK: [number, number, number] = [0, 0, 0];
const GRAY: [number, number, number] = [90, 90, 90];
const LIGHT_GRAY: [number, number, number] = [120, 120, 120];
const BOX_BG: [number, number, number] = [244, 241, 232]; // warm parchment tint
const RULE: [number, number, number] = [200, 200, 200];

const CATEGORY_LABELS: Record<string, string> = {
  criminal: 'Criminal Code', fraud: 'Fraud', procedure: 'Criminal Procedure', vehicle: 'Motor Vehicle & Traffic',
  controlled: 'Controlled Substances', public_safety: 'Public Safety', juvenile: 'Juvenile Justice',
  wildlife: 'Wildlife Resources', alcohol: 'Alcoholic Beverage Control', protective: 'Protective Orders',
  licensing: 'Security / PI / Process Server',
};
const LEVEL_LABELS: Record<string, string> = {
  capital_felony: 'Capital Felony', first_degree_felony: 'First Degree Felony',
  second_degree_felony: 'Second Degree Felony', third_degree_felony: 'Third Degree Felony',
  class_a_misdemeanor: 'Class A Misdemeanor', class_b_misdemeanor: 'Class B Misdemeanor',
  class_c_misdemeanor: 'Class C Misdemeanor', infraction: 'Infraction',
};

interface Ctx { doc: jsPDF; y: number; docTitle: string; }

function setColor(doc: jsPDF, c: [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]); }

// Page-1 masthead — Spillman black band.
function drawMasthead(ctx: Ctx, subtitle?: string) {
  const { doc } = ctx;
  doc.setFillColor(BLACK[0], BLACK[1], BLACK[2]);
  doc.rect(0, 0, PAGE_W, 64, 'F');
  doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.rect(0, 64, PAGE_W, 2.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text('UTAH LAW BOOK', MARGIN, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.setTextColor(212, 160, 23);
  doc.text('ROCKY MOUNTAIN PROTECTIVE GROUP · RMPG FLEX', MARGIN, 44);
  doc.setTextColor(190, 190, 190); doc.setFontSize(7.5);
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' });
  doc.text(`Generated ${stamp} MT`, PAGE_W - MARGIN, 30, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  doc.text(ctx.docTitle, PAGE_W - MARGIN, 48, { align: 'right' });
  ctx.y = 84;
  if (subtitle) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(doc, GRAY);
    doc.text(subtitle, MARGIN, ctx.y);
    ctx.y += 14;
  }
}

function drawContinuation(ctx: Ctx) {
  const { doc } = ctx;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); setColor(doc, LIGHT_GRAY);
  doc.text(`UTAH LAW BOOK — ${ctx.docTitle} (continued)`, MARGIN, 40);
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]); doc.setLineWidth(0.5);
  doc.line(MARGIN, 46, PAGE_W - MARGIN, 46);
  ctx.y = 60;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y + needed > FOOTER_Y - 6) {
    ctx.doc.addPage();
    drawContinuation(ctx);
  }
}

// Wrapped paragraph with per-line page breaks. Returns nothing; advances ctx.y.
function writeParagraph(
  ctx: Ctx, text: string,
  opts: { x: number; width: number; size: number; font: 'times' | 'helvetica'; style?: string; color?: [number, number, number]; lineH?: number; hangX?: number; marker?: string; markerColor?: [number, number, number] },
) {
  const { doc } = ctx;
  const lineH = opts.lineH ?? opts.size * 1.32;
  doc.setFont(opts.font, opts.style || 'normal'); doc.setFontSize(opts.size);
  const firstX = opts.hangX ?? opts.x;
  const firstW = opts.width - (firstX - opts.x);
  // Wrap: first line may be narrower (room for a hanging marker), rest full.
  const lines = doc.splitTextToSize(text, opts.width) as string[];
  // Re-wrap the first line to firstW if a marker eats into it.
  let rendered = lines;
  if (firstX !== opts.x && lines.length) {
    const firstLine = doc.splitTextToSize(text, firstW) as string[];
    const head = firstLine[0];
    const rest = text.slice(head.length).trimStart();
    rendered = rest ? [head, ...(doc.splitTextToSize(rest, opts.width) as string[])] : [head];
  }
  rendered.forEach((line, i) => {
    ensureSpace(ctx, lineH);
    const lx = i === 0 ? firstX : opts.x;
    if (i === 0 && opts.marker) {
      doc.setFont(opts.font, 'bold'); setColor(doc, opts.markerColor || GOLD);
      doc.text(opts.marker, opts.x, ctx.y);
      doc.setFont(opts.font, opts.style || 'normal');
    }
    setColor(doc, opts.color || BLACK);
    doc.text(line, lx, ctx.y);
    ctx.y += lineH;
  });
}

function drawPlainLanguageBox(ctx: Ctx, section: StatuteResult) {
  if (!section.plain_summary) return;
  const { doc } = ctx;
  const innerX = MARGIN + 12;
  const innerW = CONTENT_W - 20;
  // Measure height: label + summary lines + bullets.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const summaryLines = doc.splitTextToSize(section.plain_summary, innerW) as string[];
  const bullets = Array.isArray(section.plain_elements) ? section.plain_elements : [];
  doc.setFontSize(8.5);
  const bulletLines = bullets.map((b) => doc.splitTextToSize(`•  ${b}`, innerW - 6) as string[]);
  const h = 16 + summaryLines.length * 12 + 2 + bulletLines.reduce((a, l) => a + l.length * 11, 0) + 10;
  ensureSpace(ctx, h + 6);

  const top = ctx.y;
  doc.setFillColor(BOX_BG[0], BOX_BG[1], BOX_BG[2]);
  doc.rect(MARGIN, top, CONTENT_W, h, 'F');
  doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.rect(MARGIN, top, 3, h, 'F'); // gold left rule

  ctx.y = top + 12;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); setColor(doc, GOLD);
  doc.text('PLAIN LANGUAGE  ·  AI SUMMARY (REFERENCE AID, NOT LEGAL ADVICE)', innerX, ctx.y);
  ctx.y += 11;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); setColor(doc, [40, 40, 40]);
  summaryLines.forEach((l) => { doc.text(l, innerX, ctx.y); ctx.y += 12; });
  if (bullets.length) {
    ctx.y += 1;
    doc.setFontSize(8.5); setColor(doc, [60, 60, 60]);
    bulletLines.forEach((lines) => lines.forEach((l, i) => { doc.text(l, innerX + (i ? 8 : 0), ctx.y); ctx.y += 11; }));
  }
  ctx.y = top + h + 10;
}

function drawSection(ctx: Ctx, section: StatuteResult, withRule: boolean) {
  const { doc } = ctx;
  ensureSpace(ctx, 40);

  // Heading: citation (gold) + catchline (black), both Times bold.
  doc.setFont('times', 'bold'); doc.setFontSize(13);
  setColor(doc, GOLD);
  doc.text(section.citation, MARGIN, ctx.y);
  const cw = doc.getTextWidth(section.citation);
  setColor(doc, BLACK);
  const titleLines = doc.splitTextToSize(section.short_title, CONTENT_W - cw - 10) as string[];
  doc.text(titleLines[0] || '', MARGIN + cw + 8, ctx.y);
  ctx.y += 16;
  for (let i = 1; i < titleLines.length; i++) { ensureSpace(ctx, 16); doc.text(titleLines[i], MARGIN, ctx.y); ctx.y += 16; }

  // Meta line.
  const meta: string[] = [];
  meta.push(CATEGORY_LABELS[section.category] || section.category);
  if (section.code_type === 'rule') meta.push('Administrative Rule');
  if (section.offense_level) meta.push(LEVEL_LABELS[section.offense_level] || section.offense_level);
  if (section.subcategory) meta.push(section.subcategory);
  if (section.effective_date) meta.push(`Effective ${section.effective_date}`);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); setColor(doc, GRAY);
  const metaLines = doc.splitTextToSize(meta.join('   ·   '), CONTENT_W) as string[];
  metaLines.forEach((l) => { ensureSpace(ctx, 11); doc.text(l, MARGIN, ctx.y); ctx.y += 11; });
  ctx.y += 4;

  // Plain-language box.
  drawPlainLanguageBox(ctx, section);

  // Statutory text — same outline as the reader.
  const segs = parseOutline(section.description || '');
  if (!segs.length) {
    writeParagraph(ctx, 'No text on file for this section.', { x: MARGIN, width: CONTENT_W, size: 10, font: 'times', style: 'italic', color: LIGHT_GRAY });
  }
  for (const seg of segs) {
    const indent = seg.depth * 18;
    const x = MARGIN + indent + (seg.marker ? 0 : 0);
    const textX = MARGIN + indent + (seg.marker ? doc.getTextWidth(seg.marker) + 4 : 0);
    if (seg.marker) {
      doc.setFont('times', 'bold'); doc.setFontSize(10);
    }
    writeParagraph(ctx, seg.text, {
      x: MARGIN + indent, width: CONTENT_W - indent, size: 10, font: 'times',
      hangX: textX, marker: seg.marker || undefined,
    });
    ctx.y += 1.5;
  }

  // Source.
  if (section.source_url) {
    ensureSpace(ctx, 14);
    ctx.y += 2;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); setColor(doc, GOLD);
    doc.text(`Source: ${section.source_url}`, MARGIN, ctx.y);
    ctx.y += 12;
  }

  if (withRule) {
    ensureSpace(ctx, 16);
    ctx.y += 4;
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]); doc.setLineWidth(0.5);
    doc.line(MARGIN, ctx.y, PAGE_W - MARGIN, ctx.y);
    ctx.y += 14;
  }
}

function applyFooters(doc: jsPDF) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]); doc.setLineWidth(0.5);
    doc.line(MARGIN, FOOTER_Y - 6, PAGE_W - MARGIN, FOOTER_Y - 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); setColor(doc, LIGHT_GRAY);
    doc.text('Verbatim text from le.utah.gov · Plain-language summaries are AI-generated reference aids, not legal advice.', MARGIN, FOOTER_Y + 4);
    doc.text(`Page ${p} of ${total}`, PAGE_W - MARGIN, FOOTER_Y + 4, { align: 'right' });
  }
}

export interface StatutePdfOptions {
  docTitle: string;
  subtitle?: string;
  sections: StatuteResult[];
  fileName?: string;
}

/** Build the jsPDF doc (headless-friendly). */
export function buildStatuteDoc(opts: StatutePdfOptions): jsPDF {
  const doc = new jsPDF({ format: 'letter', unit: 'pt' });
  registerArialFont(doc); // Arial-only output (overrides helvetica/times/courier)
  const ctx: Ctx = { doc, y: 0, docTitle: opts.docTitle };
  drawMasthead(ctx, opts.subtitle);
  opts.sections.forEach((s, i) => drawSection(ctx, s, i < opts.sections.length - 1));
  applyFooters(doc);
  return doc;
}

/** Build + save (browser download). */
export function generateStatutePdf(opts: StatutePdfOptions): void {
  const doc = buildStatuteDoc(opts);
  const safe = (opts.fileName || opts.docTitle).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  doc.save(`${safe || 'utah-law-book'}.pdf`);
}

/** Print a single statute section. */
export function printStatuteSection(section: StatuteResult): void {
  generateStatutePdf({
    docTitle: section.citation,
    subtitle: section.short_title,
    sections: [section],
    fileName: `RMPG-Statute-${section.citation}`,
  });
}

/** Print a whole chapter (list of sections). */
export function printStatuteChapter(titleCode: string, chapterCode: string, name: string, sections: StatuteResult[]): void {
  generateStatutePdf({
    docTitle: `${titleCode}-${chapterCode} · ${name}`,
    subtitle: `${sections.length} section${sections.length === 1 ? '' : 's'}`,
    sections,
    fileName: `RMPG-LawBook-${titleCode}-${chapterCode}`,
  });
}
