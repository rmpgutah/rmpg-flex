// ============================================================
// documentIntake — public API
// ============================================================
// Single entry point for the document intake pipeline:
//   extractFromText(text)  — when caller already has OCR'd text
//   extractFromPdf(buffer) — full pipeline (pdftotext + OCR fallback)
//
// Both return a DocumentExtraction envelope with structured
// fields the clerk UI can review and commit. NEVER writes to
// the DB — that's the upstream caller's job, gated by review.

import { execFile } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { applyAnchors, rollupConfidence } from './applyAnchors';
import {
  isOcrmypdfAvailable, getPageCount, shouldRunOcr, runOcrFallback,
} from '../serveIntakeOcr';
import { detectCourtForm } from '../courtFormDetector';
import { courtWarrantExtractor } from './extractors/courtWarrant';
import { courtSummonsExtractor } from './extractors/courtSummons';
import { fiCardExtractor } from './extractors/fiCard';
import { witnessStatementExtractor } from './extractors/witnessStatement';
import { infoFormExtractor } from './extractors/infoForm';
import { servemanagerJobExtractor } from './extractors/servemanagerJob';
import {
  courtOrderExtractor, trespassOrderExtractor,
  evidenceLogExtractor, investigationReportExtractor,
} from './extractors/stubs';
import { discoverEntities } from './genericDiscovery';
import type {
  DocumentExtractor, DocumentExtraction, DocumentKind, ExtractedField,
} from './types';

const execFileAsync = promisify(execFile);

// Order matters: more-specific kinds first so a "warrant + bond"
// doc isn't classified as "court_order" by the order detector's
// "ORDER" keyword. servemanager_job sits ahead of generic info_form
// because its layout markers (JOB / CLIENT / SERVER triplet) are
// strictly more specific.
const REGISTRY: DocumentExtractor[] = [
  courtWarrantExtractor,
  courtSummonsExtractor,
  trespassOrderExtractor,
  fiCardExtractor,
  witnessStatementExtractor,
  evidenceLogExtractor,
  investigationReportExtractor,
  servemanagerJobExtractor,
  infoFormExtractor,
  courtOrderExtractor,
];

export function listRegisteredKinds(): Array<{ kind: DocumentKind; tier: 'implemented' | 'stub'; anchorCount: number }> {
  return REGISTRY.map((e) => ({ kind: e.kind, tier: e.tier, anchorCount: e.anchors.length }));
}

/**
 * Map a courtFormDetector category to one of our registered kinds.
 * Returns null when the category has no direct destination (the
 * caller falls back to its existing logic).
 */
function courtCategoryToKind(category: string): DocumentKind | null {
  switch (category) {
    case 'summons':                   return 'court_summons';
    case 'complaint':                 return 'court_complaint';
    case 'subpoena':                  return 'court_subpoena';
    case 'protective_order':
    case 'restraining_order_temporary': return 'protective_order';
    case 'order':
    case 'order_to_show_cause':
    case 'judgment':
    case 'decree':                    return 'court_order';
    case 'writ':                      return 'court_warrant'; // writ of arrest closest match
    default:                          return null;
  }
}

/**
 * Pick the highest-scoring extractor. Threshold of 0.4 keeps us
 * from classifying generic policy documents as one of our types
 * just because a single keyword matched.
 *
 * If our own detectors come up empty (kind=unknown), we consult
 * courtFormDetector — a 600-line battle-tested classifier that
 * recognises 22 court-form categories — and bridge its output
 * to a registered kind when one exists. This is the "hyper
 * advanced learning" hook: no anchor calibration needed for the
 * dozens of court-form patterns courtFormDetector already knows.
 */
export function detectKind(text: string): { kind: DocumentKind; score: number } {
  let best: { extractor: DocumentExtractor; score: number } | null = null;
  for (const ex of REGISTRY) {
    const score = ex.detect(text);
    if (!best || score > best.score) best = { extractor: ex, score };
  }
  if (best && best.score >= 0.4) return { kind: best.extractor.kind, score: best.score };

  // Bridge: ask the court detector. Only trust >= 30 confidence
  // (the same threshold the existing serve-intake router uses).
  const courtDet = detectCourtForm(text);
  if (courtDet.isCourtDocument && courtDet.confidence >= 30) {
    const bridged = courtCategoryToKind(courtDet.category);
    if (bridged) return { kind: bridged, score: courtDet.confidence / 100 };
  }

  return { kind: 'unknown', score: best?.score ?? 0 };
}

function getExtractor(kind: DocumentKind): DocumentExtractor | null {
  return REGISTRY.find((e) => e.kind === kind) ?? null;
}

const PREVIEW_CAP = 50_000;

export interface ExtractFromTextOptions {
  /** Force a specific extractor instead of using the detector. */
  forceKind?: DocumentKind;
  /** Hint from caller if pdftotext / OCR was already run. Used only for the result envelope. */
  pageCount?: number;
  usedOcr?: boolean;
}

export function extractFromText(text: string, opts: ExtractFromTextOptions = {}): DocumentExtraction {
  const detected = opts.forceKind && opts.forceKind !== 'unknown'
    ? { kind: opts.forceKind, score: 1 }
    : detectKind(text);

  const extractor = getExtractor(detected.kind);
  let fields: ExtractedField[] = [];
  let kind: DocumentKind = detected.kind;
  let tier: 'implemented' | 'stub' = 'stub';

  if (extractor) {
    fields = extractor.extract ? extractor.extract(text) : applyAnchors(text, extractor.anchors);
    tier = extractor.tier;
  } else {
    kind = 'unknown';
  }

  // Generic discovery layer — if the kind-specific extractor came
  // up empty (no anchor matched anything), append entity-level
  // candidates so the clerk has SOMETHING to review. The
  // candidates carry low confidence (capped at 0.5) so the UI
  // colors them yellow/red and the clerk knows to verify each one.
  // We also run discovery for kind='unknown' so first-encounter
  // documents always produce useful output instead of a blank
  // "0 fields extracted" screen.
  const anyMatched = fields.some((f) => f.confidence > 0);
  if (!anyMatched) {
    const discovered = discoverEntities(text);
    fields = [...fields, ...discovered];
  }

  // Surface court-detector outputs even for non-court kinds so
  // downstream UIs can show "this looked like a UT 3rd District
  // form" hints.
  const courtDet = detectCourtForm(text);

  return {
    kind,
    tier,
    fields,
    confidence: rollupConfidence(fields),
    pageCount: opts.pageCount ?? 0,
    usedOcr: opts.usedOcr ?? false,
    rawTextPreview: text.length > PREVIEW_CAP ? text.slice(0, PREVIEW_CAP) : text,
    courtCategory: courtDet.isCourtDocument ? courtDet.category : null,
    state: courtDet.state,
  };
}

/**
 * Full pipeline: PDF buffer → pdftotext → (optional) OCR fallback
 * → text → extractFromText. Designed to mirror the serveIntake
 * pipeline so behaviour is consistent across the app.
 */
export async function extractFromPdf(
  pdfBuffer: Buffer, opts: ExtractFromTextOptions = {},
): Promise<DocumentExtraction> {
  const dir = mkdtempSync(join(tmpdir(), 'doc-intake-'));
  const inPath = join(dir, 'in.pdf');
  let textPath = '';
  let usedOcr = false;
  let pageCount = 0;
  try {
    writeFileSync(inPath, pdfBuffer);
    pageCount = await getPageCount(inPath);
    textPath = join(dir, 'in.txt');
    // pdftotext: -layout preserves the column layout that anchors
    // rely on (label on left, value on right). -enc UTF-8 keeps
    // unicode names intact.
    try {
      await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', inPath, textPath], { timeout: 30_000 });
    } catch {
      // pdftotext failure is recoverable via OCR — the original
      // serveIntakeOcr falls through the same way.
    }
    let text = '';
    try { text = readFileSync(textPath, 'utf8'); } catch { /* no text yet */ }

    if (shouldRunOcr(text, pageCount) && await isOcrmypdfAvailable()) {
      try {
        const ocrPdf = await runOcrFallback(pdfBuffer);
        // Re-run pdftotext on the OCR'd PDF to harvest the now-
        // present text layer.
        const ocrIn = join(dir, 'ocr.pdf');
        writeFileSync(ocrIn, ocrPdf);
        await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', ocrIn, textPath], { timeout: 30_000 });
        const ocrText = readFileSync(textPath, 'utf8');
        if (ocrText.trim().length > text.trim().length) {
          text = ocrText;
          usedOcr = true;
        }
        try { unlinkSync(ocrIn); } catch { /* ignore */ }
      } catch {
        // OCR failure → keep the original (possibly empty) text.
      }
    }

    return extractFromText(text, { ...opts, pageCount, usedOcr });
  } finally {
    try { unlinkSync(inPath); } catch { /* ignore */ }
    try { if (textPath) unlinkSync(textPath); } catch { /* ignore */ }
    try { rmdirSync(dir); } catch { /* ignore */ }
  }
}
