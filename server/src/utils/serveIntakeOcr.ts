// ============================================================
// RMPG Flex — Serve Intake OCR fallback
// ============================================================
// When pdftotext yields too little text from an uploaded PDF,
// the document is almost certainly a scan (image-only PDF).
// We run ocrmypdf — a free local wrapper around Tesseract 5
// that adds an invisible text layer to the PDF without
// touching the original raster image. The existing pdftotext
// pipeline then works unchanged.
//
// Cost: $0 (CPU only). Same dep-probe pattern as qpdf.
// VPS install: apt install -y ocrmypdf tesseract-ocr
// ============================================================

import { execFile } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let ocrmypdfAvailable: boolean | null = null;
let tesseractAvailable: boolean | null = null;

export async function isOcrmypdfAvailable(): Promise<boolean> {
  if (ocrmypdfAvailable !== null) return ocrmypdfAvailable;
  try {
    await execFileAsync('ocrmypdf', ['--version'], { timeout: 3000 });
    ocrmypdfAvailable = true;
  } catch {
    ocrmypdfAvailable = false;
  }
  return ocrmypdfAvailable;
}

export async function isTesseractAvailable(): Promise<boolean> {
  if (tesseractAvailable !== null) return tesseractAvailable;
  try {
    await execFileAsync('tesseract', ['--version'], { timeout: 3000 });
    tesseractAvailable = true;
  } catch {
    tesseractAvailable = false;
  }
  return tesseractAvailable;
}

// pdfinfo gives us page count for the OCR-trigger heuristic without
// opening the PDF in another library. Returns 0 if pdfinfo fails.
export async function getPageCount(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/pdfinfo', [pdfPath], { timeout: 5000 });
    const m = stdout.match(/^Pages:\s+(\d+)/m);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// USER-CONTRIBUTED DECISION POINT
// ─────────────────────────────────────────────────────────────
// shouldRunOcr decides whether to spend ~5-15s/page running
// ocrmypdf on a freshly-uploaded PDF.
//
// Trade-offs to weigh:
//
//  • Too eager (e.g. trigger when text < 100 chars):
//    Wastes CPU re-OCR'ing born-digital PDFs that legitimately
//    have very sparse text (e.g. a one-page exhibit cover, a
//    signature page, a cover sheet with just a case number).
//    Adds 5-15s latency per page on the upload path. The user
//    sees a spinner where there'd otherwise be none.
//
//  • Too lazy (e.g. only trigger when text === ''):
//    Misses the most common real-world case — a scanned packet
//    with a single page that has stray digital text (a
//    timestamp watermark, a fax header, a page-number stamp).
//    pdftotext returns those few chars, the heuristic says
//    "fine, born-digital", and the intake form stays blank.
//
//  • The middle path is per-page-density:
//    avgCharsPerPage = text.length / pageCount.
//    A typical born-digital court docket has 1500-4000
//    chars/page. A scan has 0-50 chars/page (only stray digital
//    elements). The valley between those distributions is wide,
//    so a threshold of 200 chars/page reliably separates them.
//    But your real intake corpus may differ — RMPG's serve
//    packets in particular bundle scanned exhibits with
//    born-digital cover sheets, which can pull the average
//    above the threshold even when half the pages need OCR.
//
//  • Other signals you may want to consider:
//    - pageCount === 0 (pdfinfo failed) — fail safe by NOT
//      OCR'ing, since OCR on a malformed PDF will also fail.
//    - text.length === 0 with pageCount > 0 — unambiguous scan,
//      OCR always.
//    - Per-page text density (would require a separate
//      pdftotext -f N -l N invocation per page; expensive).
//
// Return true to trigger ocrmypdf, false to keep the original
// pdftotext output.
//
// Decision rule (implemented 2026-05-05, replaces the original
// "empty text only" stub). Three cases:
//
//   1. pageCount === 0  → pdfinfo failed; don't OCR a malformed PDF.
//   2. text empty       → unambiguous scan; OCR always.
//   3. text present but <200 chars/page → mixed content; OCR catches
//      the scanned exhibits a born-digital cover-sheet hides.
//
// 200 chars/page is the threshold the comment block above describes:
// born-digital documents typically run >2000 chars/page; scans have
// 0-50; the 10× gap makes 200 a safe boundary that doesn't false-
// positive on cover-page-only documents.
//
// For mixed documents (born-digital + scanned pages), callers
// should prefer shouldRunOcrPerPage() which checks each page
// individually (up to 20 pages). This function remains as a
// fast synchronous check; shouldRunOcrPerPage is async.
// ─────────────────────────────────────────────────────────────
export function shouldRunOcr(extractedText: string, pageCount: number): boolean {
  if (pageCount === 0) return false;
  const textLen = extractedText.trim().length;
  if (textLen === 0) return true;
  const charsPerPage = textLen / pageCount;
  return charsPerPage < 200;
}

// Per-page OCR decision: runs pdftotext on each page individually
// (up to 20 pages) to detect sparse pages that need OCR even when
// the document-wide average is above threshold.
const SPARSE_PAGE_THRESHOLD = 100;
const MAX_PER_PAGE_CHECK = 20;

export interface PerPageOcrResult {
  shouldOcr: boolean;
  sparsePages: number[];
  totalChars: number[];
}

export async function shouldRunOcrPerPage(
  pdfPath: string,
  pageCount: number,
): Promise<PerPageOcrResult> {
  const effectiveCount = Math.min(pageCount, MAX_PER_PAGE_CHECK);
  const totalChars: number[] = [];
  const sparsePages: number[] = [];

  for (let page = 1; page <= effectiveCount; page++) {
    try {
      const { stdout } = await execFileAsync(
        'pdftotext',
        ['-f', String(page), '-l', String(page), pdfPath, '-'],
        { timeout: 10_000 },
      );
      const charCount = stdout.trim().length;
      totalChars.push(charCount);
      if (charCount < SPARSE_PAGE_THRESHOLD) {
        sparsePages.push(page);
      }
    } catch {
      // If pdftotext fails on a page, treat it as sparse
      totalChars.push(0);
      sparsePages.push(page);
    }
  }

  return {
    shouldOcr: sparsePages.length > 0,
    sparsePages,
    totalChars,
  };
}

// Run ocrmypdf on a PDF buffer and return the OCR'd PDF bytes.
// Throws on failure — callers should fall back to the original
// pdftotext output rather than failing the whole upload.
//
// Flag rationale:
//   --skip-text   : don't re-OCR pages that already have text
//                   (preserves born-digital fidelity in mixed PDFs)
//   --rotate-pages: auto-correct upside-down or sideways scans
//   --deskew      : straighten slightly-tilted scans
//   --quiet       : keep stderr clean for our logger
//   --output-type pdf : faster than pdfa; we don't need archival
//   --jobs 2      : modest parallelism; VPS is shared
//
// Timeout is generous (90s) because ocrmypdf can take 5-15s
// per page on slow scans. A 6-page packet ≈ 60s worst case.
// Hard cap on input size — refuse to write attacker-controlled bytes of
// unbounded size to disk before invoking ocrmypdf (CodeQL js/http-to-file-access).
const MAX_OCR_INPUT_BYTES = 100 * 1024 * 1024;

function assertIsPdfBufferForOcr(input: Buffer): void {
  if (!Buffer.isBuffer(input)) throw new Error('runOcrFallback: input must be a Buffer');
  if (input.length === 0 || input.length > MAX_OCR_INPUT_BYTES) {
    throw new Error(`runOcrFallback: input size out of range (0 < n <= ${MAX_OCR_INPUT_BYTES})`);
  }
  // PDFs begin with "%PDF-" (0x25 0x50 0x44 0x46 0x2D).
  if (input.length < 5
    || input[0] !== 0x25 || input[1] !== 0x50 || input[2] !== 0x44
    || input[3] !== 0x46 || input[4] !== 0x2D) {
    throw new Error('runOcrFallback: input does not begin with %PDF- header');
  }
}

export async function runOcrFallback(pdfBuffer: Buffer): Promise<Buffer> {
  assertIsPdfBufferForOcr(pdfBuffer);
  if (!(await isOcrmypdfAvailable())) {
    throw Object.assign(new Error('ocrmypdf is not installed on this server'), {
      code: 'OCRMYPDF_MISSING',
    });
  }

  const dir = mkdtempSync(join(tmpdir(), 'serve-intake-ocr-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');

  try {
    writeFileSync(inPath, pdfBuffer);
    await execFileAsync(
      'ocrmypdf',
      [
        '--skip-text',
        '--rotate-pages',
        '--deskew',
        '--quiet',
        '--output-type', 'pdf',
        '--jobs', '2',
        inPath,
        outPath,
      ],
      { timeout: 90_000 },
    );
    return readFileSync(outPath);
  } finally {
    try { unlinkSync(inPath); } catch { /* ignore */ }
    try { unlinkSync(outPath); } catch { /* ignore */ }
    try { rmdirSync(dir); } catch { /* ignore */ }
  }
}
