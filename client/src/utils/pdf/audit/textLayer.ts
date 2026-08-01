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
