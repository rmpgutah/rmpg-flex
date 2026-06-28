// ============================================================
// RMPG Flex — OCR Engine (Tesseract.js)
// ============================================================
// Client-side OCR for digitizing paper documents, evidence
// photos, handwritten field interview cards, and paper citations.
// Runs entirely in-browser via WebAssembly — no cloud API needed.
// ============================================================

import Tesseract from 'tesseract.js';

// ── Types ─────────────────────────────────────────────────

export interface OcrResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
  lines: Array<{
    text: string;
    confidence: number;
  }>;
}

export interface OcrProgress {
  status: string;
  progress: number; // 0 to 1
}

// ── Core functions ────────────────────────────────────────

/**
 * Perform OCR on an image file, blob, or URL.
 * Returns extracted text with confidence scores and word bounding boxes.
 */
export async function recognizeText(
  image: File | Blob | string,
  options: {
    language?: string;
    onProgress?: (progress: OcrProgress) => void;
  } = {}
): Promise<OcrResult> {
  const { language = 'eng', onProgress } = options;

  const result = await Tesseract.recognize(image, language, {
    logger: onProgress
      ? (m: { status: string; progress: number }) => {
          onProgress({ status: m.status, progress: m.progress });
        }
      : undefined,
  });

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    words: ((result.data as any).words || []).map((w: any) => ({
      text: w.text,
      confidence: w.confidence,
      bbox: w.bbox,
    })),
    lines: ((result.data as any).lines || []).map((l: any) => ({
      text: l.text,
      confidence: l.confidence,
    })),
  };
}

/**
 * Extract text from multiple images (batch OCR).
 * Useful for multi-page scanned documents.
 */
export async function recognizeBatch(
  images: Array<File | Blob | string>,
  options: {
    language?: string;
    onProgress?: (index: number, progress: OcrProgress) => void;
  } = {}
): Promise<OcrResult[]> {
  const results: OcrResult[] = [];

  for (let i = 0; i < images.length; i++) {
    const result = await recognizeText(images[i], {
      language: options.language,
      onProgress: options.onProgress
        ? (p) => options.onProgress!(i, p)
        : undefined,
    });
    results.push(result);
  }

  return results;
}

/**
 * Quick text extraction (returns just the text string).
 * Convenience wrapper for simple use cases.
 */
export async function extractText(image: File | Blob | string): Promise<string> {
  const result = await recognizeText(image);
  return result.text.trim();
}

/**
 * Check if OCR is likely to produce good results for an image.
 * Returns a quality assessment based on image dimensions.
 */
export function assessImageQuality(
  width: number,
  height: number
): { quality: 'good' | 'fair' | 'poor'; recommendation: string } {
  const pixels = width * height;
  const minDim = Math.min(width, height);

  if (pixels > 2_000_000 && minDim > 500) {
    return { quality: 'good', recommendation: 'Image resolution is sufficient for OCR.' };
  }
  if (pixels > 500_000 && minDim > 300) {
    return { quality: 'fair', recommendation: 'Results may be imprecise. Consider using a higher resolution scan.' };
  }
  return { quality: 'poor', recommendation: 'Image resolution is too low for reliable OCR. Re-scan at 300+ DPI.' };
}
