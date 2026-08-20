import type { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// The legacy build's text extraction path needs no canvas — only
// rasterization does. That is what makes this assertion runnable in
// plain Node under vitest, and therefore usable as a CI gate.

// This module runs in BOTH plain Node (CI text-layer assertions, via
// vitest) and the browser (the /__pdf-gallery page, via PdfGalleryPage.tsx
// calling extractPdfText for the placeholder-leak panel). It used to have
// no worker configuration of its own: it relied on renderToCanvas.ts —
// which, until a 2026-07-31 review, imported this *same* legacy specifier —
// mutating the shared `GlobalWorkerOptions` as an accidental side effect.
// When renderToCanvas.ts was switched to the standard `pdfjs-dist` build
// (for rasterization-fidelity reasons — the gallery must render with the
// same build the app ships, which text extraction has no reason to share),
// that side effect vanished and this module broke standalone in the
// browser with "No GlobalWorkerOptions.workerSrc specified". vitest never
// caught it because pdfjs falls back to a fake, in-process worker under
// Node when no browser Worker constructor exists, which is the CORRECT
// behavior there — a real asset URL doesn't resolve under Node anyway.
// So the guard below must only assign a browser asset URL when actually
// running in a browser-like environment, must never fire under Node, and
// must never clobber a workerSrc some other module already set. Removing
// or "simplifying" this guard will silently reintroduce the exact bug
// above the next time some other file stops importing the legacy build.
//
// The decision itself is pulled out as `shouldConfigureWorkerSrc` and
// exported so a test can drive it directly with fake inputs. Testing it
// through the REAL `pdfjs.GlobalWorkerOptions` object end-to-end doesn't
// work: pdfjs-dist's own `PDFWorker` static initializer treats ANY run
// under a real Node `process` global — including vitest's jsdom
// environment, which does not remove `process` — as "Node mode" and
// pre-seeds `GlobalWorkerOptions.workerSrc` with its own internal default
// before this guard ever runs. That masks whether OUR guard fired at all,
// the same masking this whole bug already lived behind once.
export function shouldConfigureWorkerSrc(
  hasBrowserWindow: boolean,
  existingWorkerSrc: string | undefined,
): boolean {
  return hasBrowserWindow && !existingWorkerSrc;
}

if (shouldConfigureWorkerSrc(typeof window !== 'undefined', pdfjs.GlobalWorkerOptions.workerSrc)) {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface PlaceholderLeak {
  page: number;
  token: string;
  context: string;
}

// Matches placeholders while excluding legitimate words and handling adjacent tokens.
// General pattern: tokens must not be preceded/followed by letters. Catches concatenated
// placeholders like "undefinednull" and "NaNundefined" via lookbehind/lookahead.
// `Invalid Date` uses \s+ for multi-item splits from PDF rendering. `[object Object]`
// is bracket-delimited and needs its own alternative.
//
// SPECIAL CASE: "null and void" legal boilerplate exclusion.
// "null and void" is standard legal text in trespass orders, court notices, and process
// documents — exactly the highest-criticality forms this gate protects. A correctly-
// rendered legal order would fail the gate on its own legal text (false positive on the
// documents we care most about). Bare `null` in data fields remains a genuine defect we
// must catch. Excluding the bounded idiom preserves both: legal text passes, data nulls
// fail. The idiom check is case-insensitive via character classes ([aA][nN][dD]) without
// reintroducing /i flag globally (which would resurrect false positives on "Nan" as a
// person's name in police records).
//
// WARNING: This pattern has the /g flag and is stateful (lastIndex). Direct callers
// using `.test()` or `.exec()` without resetting lastIndex get non-deterministic results.
// Use `findPlaceholderLeaks()` (which resets per page) instead of calling this pattern directly.
export const PLACEHOLDER_LEAK_PATTERN =
  /(?<=undefined)null|(?<=null)undefined|(?<=NaN)undefined|(?<=undefined)NaN|(?<=NaN)null|(?<=null)NaN|undefined(?=NaN)|undefined(?=null)|NaN(?=undefined)|NaN(?=null)|null(?=undefined)|null(?=NaN)|(?<![a-zA-Z])undefined(?![a-zA-Z])|(?<![a-zA-Z])null(?!\s+[aA][nN][dD]\s+[vV][oO][iI][dD])(?![a-zA-Z])|(?<![a-zA-Z])NaN(?![a-zA-Z])|Invalid\s+Date|\[object Object\]/g;

// Type guard: filter pdfjs TextItem (has str) from TextMarkedContent (does not).
// pdfjs.getTextContent().items is a union; marked-content entries must be
// filtered out BEFORE the join to avoid spurious spaces when marked-content
// boundaries separate tokens (e.g., "Invalid" and "Date" split by a marker).
export function isTextItem(item: unknown): item is { str: string } {
  return typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).str === 'string';
}

// Extract text from PDF items, filtering out marked-content entries.
// Returns a space-joined string of text items only (no empty-string blanks for markers).
export function extractTextFromItems(items: unknown[]): string {
  return items
    .filter(isTextItem)
    .map((item) => item.str)
    .join(' ');
}

export async function extractPdfText(doc: jsPDF): Promise<string[]> {
  const data = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(extractTextFromItems(content.items));
  }
  return pages;
}

const CONTEXT_RADIUS = 40;

export function findPlaceholderLeaks(pages: string[]): PlaceholderLeak[] {
  const leaks: PlaceholderLeak[] = [];
  pages.forEach((text, index) => {
    // Fresh lastIndex per page — the pattern is global and stateful.
    PLACEHOLDER_LEAK_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = PLACEHOLDER_LEAK_PATTERN.exec(text);
    while (match !== null) {
      leaks.push({
        page: index + 1,
        token: match[0],
        context: text
          .slice(Math.max(0, match.index - CONTEXT_RADIUS), match.index + match[0].length + CONTEXT_RADIUS)
          .trim(),
      });
      match = PLACEHOLDER_LEAK_PATTERN.exec(text);
    }
  });
  return leaks;
}

export async function expectNoPlaceholderLeaks(doc: jsPDF): Promise<void> {
  const leaks = findPlaceholderLeaks(await extractPdfText(doc));
  if (leaks.length === 0) return;
  const report = leaks
    .map((l) => `  page ${l.page}: "${l.token}" in "…${l.context}…"`)
    .join('\n');
  throw new Error(`PDF text layer contains ${leaks.length} placeholder leak(s):\n${report}`);
}
