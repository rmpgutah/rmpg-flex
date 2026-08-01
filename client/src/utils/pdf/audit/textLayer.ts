import type { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// The legacy build's text extraction path needs no canvas — only
// rasterization does. That is what makes this assertion runnable in
// plain Node under vitest, and therefore usable as a CI gate.

export interface PlaceholderLeak {
  page: number;
  token: string;
  context: string;
}

// Word-bounded so "Annulled" does not match "null" and "undefinedness"
// does not match "undefined". `[object Object]` is bracket-delimited so
// it needs its own alternative rather than a \b guard.
export const PLACEHOLDER_LEAK_PATTERN =
  /\[object Object\]|\bInvalid Date\b|\bundefined\b|\bNaN\b|\bnull\b/g;

export async function extractPdfText(doc: jsPDF): Promise<string[]> {
  const data = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: { str?: string }) => item.str ?? '').join(' '));
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
