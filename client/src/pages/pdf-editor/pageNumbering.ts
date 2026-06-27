// Pure page-number / page-label formatting helpers.
//
// Kept in their own module (no pdf-lib / pdfjs imports) so they're cheap to
// unit-test and reusable by both save.ts and the PageLabelsDialog preview
// without dragging the whole save pipeline (and its heavy PDF deps) into the
// import graph.

import type { PageNumbersConfig, PageLabelRule } from './types';

function toRoman(n: number): string {
  if (n <= 0) return String(n);
  const table: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let out = '';
  let rem = n;
  for (const [v, s] of table) { while (rem >= v) { out += s; rem -= v; } }
  return out;
}

function toAlpha(n: number): string {
  // 1→a, 26→z, 27→aa (spreadsheet-column style).
  let out = '';
  let rem = n;
  while (rem > 0) { const m = (rem - 1) % 26; out = String.fromCharCode(97 + m) + out; rem = Math.floor((rem - 1) / 26); }
  return out || 'a';
}

/** Format a 1-based ordinal in the requested numbering style. */
export function formatPageNumber(n: number, style: PageNumbersConfig['style'] | PageLabelRule['style'] = 'decimal'): string {
  switch (style) {
    case 'roman': return toRoman(n);
    case 'Roman': return toRoman(n).toUpperCase();
    case 'alpha': return toAlpha(n);
    case 'Alpha': return toAlpha(n).toUpperCase();
    default: return String(n);
  }
}

/** Resolve the custom page label for a 1-indexed visual page, applying the
 *  matching rule (last rule wins on overlap). Returns the plain decimal page
 *  number when no rule covers the page. */
export function resolvePageLabel(rules: PageLabelRule[] | undefined, visualPage: number): string {
  if (!rules || rules.length === 0) return String(visualPage);
  let label = String(visualPage);
  for (const r of rules) {
    const lo = Math.min(r.from, r.to);
    const hi = Math.max(r.from, r.to);
    if (visualPage >= lo && visualPage <= hi) {
      const ordinal = (r.start || 1) + (visualPage - lo);
      label = `${r.prefix ?? ''}${formatPageNumber(ordinal, r.style)}`;
    }
  }
  return label;
}
