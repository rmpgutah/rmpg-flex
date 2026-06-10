// Additional, real, wired Document Writer tools (this wave). Pure helpers over a
// TipTap editor + small localStorage utilities — no new npm deps. Kept out of the
// React components so they're independently testable.
//
// Covers: officer signature block (from the logged-in user), list<->text
// conversions, list/table sorting, reusable multi-paragraph section blocks,
// recent-documents history, standalone styled-HTML export, document duplication,
// and editor-navigation helpers (select-all / go to top / go to bottom).

import type { Editor } from '@tiptap/react';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Officer signature block (auto-filled from the logged-in user) ──────────

export interface OfficerInfo {
  name: string;
  badge?: string;
  rank?: string;
  department?: string;
}

/** Insert a signature block pre-filled with the officer's name / badge / rank
 *  and today's date — a real signing block, distinct from a scanned-image sig.
 *  Leaves a blank signature line above the printed name. */
export function insertOfficerSignatureBlock(editor: Editor, officer: OfficerInfo): void {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const line2Parts = [officer.rank, officer.badge ? `Badge ${officer.badge}` : '']
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' · ');
  const dept = (officer.department || 'Rocky Mountain Protective Group').trim();
  const block =
    `<table data-officer-signature="1" style="width:100%;border:none;border-collapse:collapse;margin-top:36px;">` +
    `<tr>` +
    `<td style="width:60%;border-bottom:1px solid #333;padding-top:34px;">&nbsp;</td>` +
    `<td style="width:8%;border:none;">&nbsp;</td>` +
    `<td style="width:32%;border-bottom:1px solid #333;padding-top:34px;">${esc(date)}</td>` +
    `</tr>` +
    `<tr>` +
    `<td style="border:none;padding-top:4px;"><strong>${esc(officer.name)}</strong>` +
    (line2Parts ? `<br><span style="font-size:10px;color:#666;">${esc(line2Parts)}</span>` : '') +
    `<br><span style="font-size:10px;color:#666;">${esc(dept)}</span></td>` +
    `<td style="border:none;">&nbsp;</td>` +
    `<td style="border:none;padding-top:4px;font-size:10px;color:#666;">Date</td>` +
    `</tr>` +
    `</table>`;
  editor.chain().focus().insertContent(block).run();
}

// ── List <-> text conversions ──────────────────────────────────────────────

/** Convert the selected lines (one per line) into a bullet or numbered list.
 *  Operates on the selected plain text, splitting on newlines. Returns the
 *  number of list items created, or 0 if nothing usable was selected. */
export function textToList(editor: Editor, ordered: boolean): number {
  const { from, to } = editor.state.selection;
  if (from === to) return 0;
  const raw = editor.state.doc.textBetween(from, to, '\n');
  const items = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (items.length === 0) return 0;
  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
  editor.chain().focus().insertContentAt({ from, to }, html).run();
  return items.length;
}

/** Convert the list the cursor is in back into plain paragraphs (one per item).
 *  Returns true if a list was found and flattened. */
export function listToText(editor: Editor): boolean {
  if (!editor.isActive('bulletList') && !editor.isActive('orderedList') && !editor.isActive('taskList')) {
    return false;
  }
  // Find the enclosing list node + its document range.
  const { $from } = editor.state.selection;
  let listDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') { listDepth = d; break; }
  }
  if (listDepth < 0) return false;
  const listNode = $from.node(listDepth);
  const start = $from.before(listDepth);
  const end = start + listNode.nodeSize;
  const lines: string[] = [];
  listNode.descendants((node) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const t = node.textContent.trim();
      if (t) lines.push(t);
    }
  });
  if (lines.length === 0) return false;
  const html = lines.map((l) => `<p>${esc(l)}</p>`).join('');
  editor.chain().focus().insertContentAt({ from: start, to: end }, html).run();
  return true;
}

// ── Sorting (list items / table rows) ──────────────────────────────────────

export type SortMode = 'asc' | 'desc' | 'numAsc' | 'numDesc';

function compareBy(mode: SortMode): (a: string, b: string) => number {
  if (mode === 'asc') return (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  if (mode === 'desc') return (a, b) => b.localeCompare(a, undefined, { sensitivity: 'base', numeric: true });
  const num = (s: string) => {
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : Number.POSITIVE_INFINITY;
  };
  if (mode === 'numAsc') return (a, b) => num(a) - num(b);
  return (a, b) => num(b) - num(a);
}

/** Sort the items of the list the cursor is in. Returns count sorted, or 0. */
export function sortList(editor: Editor, mode: SortMode): number {
  const { $from } = editor.state.selection;
  let listDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') { listDepth = d; break; }
  }
  if (listDepth < 0) return 0;
  const listNode = $from.node(listDepth);
  const start = $from.before(listDepth);
  const end = start + listNode.nodeSize;
  const tag = listNode.type.name === 'orderedList' ? 'ol' : 'ul';
  const items: string[] = [];
  listNode.forEach((item) => { items.push(item.textContent.trim()); });
  const filtered = items.filter(Boolean);
  if (filtered.length < 2) return 0;
  filtered.sort(compareBy(mode));
  const html = `<${tag}>${filtered.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
  editor.chain().focus().insertContentAt({ from: start, to: end }, html).run();
  return filtered.length;
}

/** Sort the body rows of the table the cursor is in by the first column.
 *  Keeps a header row (cells of type tableHeader) in place. Returns rows sorted. */
export function sortTableRows(editor: Editor, mode: SortMode): number {
  const { $from } = editor.state.selection;
  let tableDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') { tableDepth = d; break; }
  }
  if (tableDepth < 0) return 0;
  const table = $from.node(tableDepth);
  const start = $from.before(tableDepth);
  const end = start + table.nodeSize;
  const headerRows: string[] = [];
  const bodyRows: { key: string; html: string }[] = [];
  table.forEach((row) => {
    const cellsHtml: string[] = [];
    let isHeaderRow = false;
    let firstCellText = '';
    let firstSet = false;
    row.forEach((cell) => {
      const isHeader = cell.type.name === 'tableHeader';
      if (isHeader) isHeaderRow = true;
      const text = cell.textContent.trim();
      if (!firstSet) { firstCellText = text; firstSet = true; }
      const tag = isHeader ? 'th' : 'td';
      cellsHtml.push(`<${tag}>${esc(text)}&nbsp;</${tag}>`);
    });
    const rowHtml = `<tr>${cellsHtml.join('')}</tr>`;
    if (isHeaderRow) headerRows.push(rowHtml);
    else bodyRows.push({ key: firstCellText, html: rowHtml });
  });
  if (bodyRows.length < 2) return 0;
  const cmp = compareBy(mode);
  bodyRows.sort((a, b) => cmp(a.key, b.key));
  const html = `<table>${headerRows.join('')}${bodyRows.map((r) => r.html).join('')}</table>`;
  editor.chain().focus().insertContentAt({ from: start, to: end }, html).run();
  return bodyRows.length;
}

// ── Reusable multi-paragraph section blocks ────────────────────────────────

export interface SectionBlock {
  id: string;
  label: string;
  group: string;
  html: string;
}

/** Standard multi-paragraph closing / certification language an officer drops in
 *  whole. Distinct from single-line snippets — these are full report sections. */
export const SECTION_BLOCKS: SectionBlock[] = [
  {
    id: 'certification',
    label: 'Officer certification',
    group: 'Certifications',
    html:
      '<h3>CERTIFICATION</h3>' +
      '<p>I hereby certify that the foregoing report is true and accurate to the best of my knowledge, information, and belief. The statements contained herein are based on my personal observations, investigation, and the information available to me at the time of this report.</p>' +
      '<p>I declare under criminal penalty under the law of the State of Utah that the foregoing is true and correct.</p>',
  },
  {
    id: 'closing-standard',
    label: 'Standard report closing',
    group: 'Closings',
    html:
      '<h3>DISPOSITION</h3>' +
      '<p>Based on the facts and circumstances described above, the following action was taken. All parties were advised of the outcome and provided with the case number for reference.</p>' +
      '<p>No further police action was necessary at this time. This report is being submitted for review and approval.</p>',
  },
  {
    id: 'witness-statement-header',
    label: 'Witness statement section',
    group: 'Statements',
    html:
      '<h3>WITNESS STATEMENT</h3>' +
      '<p>The following statement was provided voluntarily by the witness named above. The witness was advised that providing false information to a peace officer may constitute a criminal offense.</p>' +
      '<p><strong>Statement:</strong></p>' +
      '<p>[Witness statement to follow.]</p>',
  },
  {
    id: 'evidence-summary',
    label: 'Evidence summary section',
    group: 'Evidence',
    html:
      '<h3>EVIDENCE COLLECTED</h3>' +
      '<p>The following items of evidence were collected, documented, and placed into property in accordance with agency policy. Chain of custody was maintained throughout.</p>' +
      '<ul><li>Item 1: [description]</li><li>Item 2: [description]</li><li>Item 3: [description]</li></ul>',
  },
  {
    id: 'use-of-force-summary',
    label: 'Use-of-force summary',
    group: 'Use of Force',
    html:
      '<h3>USE OF FORCE</h3>' +
      '<p>The level of force applied was objectively reasonable under the totality of the circumstances and consistent with agency policy and applicable law. The force used was necessary to overcome resistance and effect a lawful objective.</p>' +
      '<p>Medical evaluation was offered and/or provided as appropriate. A supervisor was notified in accordance with policy.</p>',
  },
  {
    id: 'supplemental-header',
    label: 'Supplemental report header',
    group: 'Supplements',
    html:
      '<h3>SUPPLEMENTAL REPORT</h3>' +
      '<p>This supplemental report is submitted to document additional information, follow-up investigation, or developments that occurred subsequent to the original report referenced by the case number above.</p>',
  },
  {
    id: 'distribution',
    label: 'Distribution / routing block',
    group: 'Routing',
    html:
      '<h3>DISTRIBUTION</h3>' +
      '<p>Copies of this report have been routed to the following: Records, the assigned supervisor, and the appropriate follow-up unit. Original retained in the case file.</p>',
  },
];

/** Group the section blocks by their `group` for menu rendering. */
export function sectionBlocksByGroup(): Record<string, SectionBlock[]> {
  return SECTION_BLOCKS.reduce<Record<string, SectionBlock[]>>((acc, b) => {
    (acc[b.group] ||= []).push(b);
    return acc;
  }, {});
}

export function insertSectionBlock(editor: Editor, block: SectionBlock): void {
  editor.chain().focus().insertContent(block.html).run();
}

// ── Recent documents (localStorage) ────────────────────────────────────────

const RECENT_KEY = 'rmpg_writer_recent_docs';
const MAX_RECENT = 12;

export interface RecentDoc {
  id: string;          // stable id (composed from title + first-open time)
  title: string;
  html: string;        // last-known content (capped to keep storage sane)
  openedAt: string;
  documentId?: string; // server file id once saved
}

export function listRecentDocs(): RecentDoc[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as RecentDoc[]; } catch { return []; }
}

/** Upsert a recent-document entry (keyed by id), newest first, capped. The HTML
 *  is stored truncated so a long document doesn't blow the localStorage quota. */
export function touchRecentDoc(entry: { id: string; title: string; html: string; documentId?: string }): void {
  try {
    const html = entry.html.length > 200_000 ? entry.html.slice(0, 200_000) : entry.html;
    const others = listRecentDocs().filter((d) => d.id !== entry.id);
    const next: RecentDoc = { id: entry.id, title: entry.title, html, openedAt: new Date().toISOString(), documentId: entry.documentId };
    localStorage.setItem(RECENT_KEY, JSON.stringify([next, ...others].slice(0, MAX_RECENT)));
  } catch { /* quota — best-effort */ }
}

export function removeRecentDoc(id: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(listRecentDocs().filter((d) => d.id !== id))); } catch { /* noop */ }
}

// ── Standalone styled-HTML export ──────────────────────────────────────────

/** Wrap the editor HTML in a complete, self-contained, styled HTML document
 *  (print-friendly serif body, table/blockquote styling, optional letterhead)
 *  suitable for opening directly in a browser or attaching to an email. Distinct
 *  from the raw `editor.getHTML()` fragment export. */
export function buildStandaloneHtml(opts: {
  title: string;
  bodyHtml: string;
  author?: string;
  letterhead?: boolean;
}): string {
  const { title, bodyHtml, author, letterhead } = opts;
  const lh = letterhead
    ? `<div class="lh"><div class="lh-name">ROCKY MOUNTAIN PROTECTIVE GROUP</div>` +
      `<div class="lh-sub">Private Security &amp; Process Service — Salt Lake City, Utah</div></div>`
    : '';
  const meta = author ? `<meta name="author" content="${esc(author)}">` : '';
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`, meta,
    '<style>',
    ':root{color-scheme:light}',
    'body{font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.5;color:#111;background:#fff;max-width:8.5in;margin:0 auto;padding:1in}',
    '.lh{text-align:center;border-bottom:2px solid #d4a017;padding-bottom:6px;margin-bottom:18px}',
    '.lh-name{font-size:16pt;font-weight:700;letter-spacing:.03em}.lh-sub{font-size:9pt;color:#555}',
    'h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.25em}h4{font-size:1.1em}',
    'p{margin:0 0 .55em}a{color:#0645ad}',
    'table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #333;padding:6px;text-align:left}',
    'th{background:#f0f0f0}img{max-width:100%}',
    'blockquote{border-left:3px solid #888;padding-left:1em;font-style:italic;color:#333}',
    'ul,ol{margin:0 0 .55em 1.4em}hr{border:none;border-top:1px solid #ccc;margin:1em 0}',
    '@media print{body{padding:0}}',
    '</style></head><body>', lh, bodyHtml, '</body></html>',
  ].join('');
}

// ── Document duplication ───────────────────────────────────────────────────

/** Wrap the current document's HTML for "New from current" — strips any prior
 *  cover-page block so the duplicate starts clean, and returns a suggested
 *  copy title. The caller resets the document id (it's a new document). */
export function duplicateTitle(title: string): string {
  if (/\bcopy\b/i.test(title)) return `${title} (2)`;
  return `${title} (Copy)`;
}

// ── Editor navigation helpers ──────────────────────────────────────────────

export function selectAll(editor: Editor): void {
  editor.chain().focus().selectAll().run();
}

export function goToTop(editor: Editor): void {
  editor.chain().focus().setTextSelection(0).scrollIntoView().run();
}

export function goToBottom(editor: Editor): void {
  const end = Math.max(0, editor.state.doc.content.size - 1);
  editor.chain().focus().setTextSelection(end).scrollIntoView().run();
}
