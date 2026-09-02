// Wave-4 Document Writer actions — 150 new functions covering Word-class
// productivity (find/select tools, case transforms, list ops, table ops,
// callouts, equations, charts, references) plus RMPG-specific blocks
// (redaction, evidence stamps, chain of custody, statute pin-cites, Miranda,
// witness/interview templates, court-format helpers). Same pattern as
// docActions.ts: pure functions over a TipTap Editor, insert HTML or mutate
// the document via transactions.
//
// All functions are individually exported so they can be wired into the
// toolbar piecemeal or invoked from a command palette / slash menu.

import type { Editor } from '@tiptap/core';
// Wave-5 actions live in their own module; appended to ACTION_REGISTRY below.
// (docActions3 imports DocAction from here as a TYPE only — erased at runtime,
// so there is no import cycle.)
import { WAVE5_ACTIONS } from './docActions3';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // escape quotes too — output is used inside HTML attributes

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

// ────────────────────────────────────────────────────────────────────────────
// 1) Case & text transforms (1–20)
// ────────────────────────────────────────────────────────────────────────────

/** Apply a per-text-node transform to the current selection (or whole doc if
 *  selection is empty). Returns count of nodes touched. */
function mapSelectionText(editor: Editor, fn: (s: string) => string): number {
  const { state, view } = editor;
  const { from, to, empty } = state.selection;
  const lo = empty ? 0 : from;
  const hi = empty ? state.doc.content.size : to;
  const edits: { from: number; to: number; text: string }[] = [];
  state.doc.nodesBetween(lo, hi, (node, pos) => {
    if (!node.isText || !node.text) return;
    const start = Math.max(pos, lo);
    const end = Math.min(pos + node.text.length, hi);
    if (end <= start) return;
    const slice = node.text.slice(start - pos, end - pos);
    const out = fn(slice);
    if (out !== slice) edits.push({ from: start, to: end, text: out });
  });
  if (!edits.length) return 0;
  let tr = state.tr;
  for (const e of edits.reverse()) tr = tr.insertText(e.text, e.from, e.to);
  view.dispatch(tr);
  return edits.length;
}

export function toUpperCase(editor: Editor): number { return mapSelectionText(editor, (s) => s.toUpperCase()); }
export function toLowerCase(editor: Editor): number { return mapSelectionText(editor, (s) => s.toLowerCase()); }
export function toTitleCase(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()));
}
export function toSentenceCase(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase()));
}
export function toggleCase(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.split('').map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''));
}
export function reverseText(editor: Editor): number { return mapSelectionText(editor, (s) => s.split('').reverse().join('')); }
export function collapseWhitespace(editor: Editor): number { return mapSelectionText(editor, (s) => s.replace(/\s+/g, ' ')); }
export function trimTrailingSpaces(editor: Editor): number { return mapSelectionText(editor, (s) => s.replace(/[ \t]+$/gm, '')); }
export function removeDuplicateSpaces(editor: Editor): number { return mapSelectionText(editor, (s) => s.replace(/  +/g, ' ')); }
export function addLineNumbers(editor: Editor): number {
  let i = 0;
  return mapSelectionText(editor, (s) => s.split('\n').map((line) => `${pad2(++i)}. ${line}`).join('\n'));
}
export function stripLineNumbers(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.replace(/^\s*\d+\.\s+/gm, ''));
}
export function rot13(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  }));
}
export function camelCase(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_m, c) => c.toUpperCase()));
}
export function snakeCase(editor: Editor): number { return mapSelectionText(editor, (s) => s.toLowerCase().replace(/\s+/g, '_')); }
export function kebabCase(editor: Editor): number { return mapSelectionText(editor, (s) => s.toLowerCase().replace(/\s+/g, '-')); }
export function stripAccents(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}
export function curlyToStraightQuotes(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
}
export function pluralize(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.replace(/\b(\w+?)(s?)\b/g, (m, w, s2) => (s2 ? m : `${w}s`)));
}
export function sortLinesAscending(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n'));
}
export function sortLinesDescending(editor: Editor): number {
  return mapSelectionText(editor, (s) => s.split('\n').sort((a, b) => b.localeCompare(a)).join('\n'));
}

// ────────────────────────────────────────────────────────────────────────────
// 2) Insertions — punctuation, breaks, characters (21–40)
// ────────────────────────────────────────────────────────────────────────────

export function insertEmDash(editor: Editor): void { editor.chain().focus().insertContent('—').run(); }
export function insertEnDash(editor: Editor): void { editor.chain().focus().insertContent('–').run(); }
export function insertEllipsis(editor: Editor): void { editor.chain().focus().insertContent('…').run(); }
export function insertNonBreakingSpace(editor: Editor): void { editor.chain().focus().insertContent(' ').run(); }
export function insertNonBreakingHyphen(editor: Editor): void { editor.chain().focus().insertContent('‑').run(); }
export function insertSoftHyphen(editor: Editor): void { editor.chain().focus().insertContent('­').run(); }
export function insertZeroWidthSpace(editor: Editor): void { editor.chain().focus().insertContent('​').run(); }
export function insertSectionSign(editor: Editor): void { editor.chain().focus().insertContent('§').run(); }
export function insertPilcrow(editor: Editor): void { editor.chain().focus().insertContent('¶').run(); }
export function insertCopyright(editor: Editor): void { editor.chain().focus().insertContent('©').run(); }
export function insertRegistered(editor: Editor): void { editor.chain().focus().insertContent('®').run(); }
export function insertTrademark(editor: Editor): void { editor.chain().focus().insertContent('™').run(); }
export function insertDegreeSymbol(editor: Editor): void { editor.chain().focus().insertContent('°').run(); }
export function insertCheckmark(editor: Editor): void { editor.chain().focus().insertContent('✓').run(); }
export function insertBallotX(editor: Editor): void { editor.chain().focus().insertContent('✗').run(); }
export function insertEmptyCheckbox(editor: Editor): void { editor.chain().focus().insertContent('☐ ').run(); }
export function insertCheckedCheckbox(editor: Editor): void { editor.chain().focus().insertContent('☑ ').run(); }

export function insertHorizontalRule(editor: Editor): void {
  editor.chain().focus().insertContent('<hr>').run();
}
export function insertPageBreak(editor: Editor): void {
  editor.chain().focus().insertContent('<div data-page-break="true" class="doc-page-break"></div>').run();
}
export function insertColumnBreak(editor: Editor): void {
  editor.chain().focus().insertContent('<div data-column-break="true" style="break-before:column"></div>').run();
}

// ────────────────────────────────────────────────────────────────────────────
// 3) Headings, paragraph & alignment helpers (41–55)
// ────────────────────────────────────────────────────────────────────────────

export function clearAllFormatting(editor: Editor): void {
  editor.chain().focus().clearNodes().unsetAllMarks().run();
}
export function increaseIndent(editor: Editor): void {
  // TipTap's list-item indent if in a list, else wrap paragraph in a styled div.
  if (!editor.chain().focus().sinkListItem('listItem').run()) {
    editor.chain().focus().updateAttributes('paragraph', { indent: 1 }).run();
  }
}
export function decreaseIndent(editor: Editor): void {
  if (!editor.chain().focus().liftListItem('listItem').run()) {
    editor.chain().focus().updateAttributes('paragraph', { indent: 0 }).run();
  }
}
export function setLineSpacing(editor: Editor, spacing: 1 | 1.15 | 1.5 | 2): void {
  editor.chain().focus().updateAttributes('paragraph', { lineHeight: spacing }).run();
}
export function setParagraphSpacingBefore(editor: Editor, px: number): void {
  editor.chain().focus().updateAttributes('paragraph', { marginTop: px }).run();
}
export function setParagraphSpacingAfter(editor: Editor, px: number): void {
  editor.chain().focus().updateAttributes('paragraph', { marginBottom: px }).run();
}
export function setFirstLineIndent(editor: Editor, inches: number): void {
  editor.chain().focus().insertContent(`<span style="display:inline-block;width:${inches}in"></span>`).run();
}
export function setHangingIndent(editor: Editor, inches: number): void {
  editor.chain().focus().updateAttributes('paragraph', { hangingIndent: inches }).run();
}
export function alignJustify(editor: Editor): void { editor.chain().focus().setTextAlign('justify').run(); }
export function alignLeft(editor: Editor): void { editor.chain().focus().setTextAlign('left').run(); }
export function alignRight(editor: Editor): void { editor.chain().focus().setTextAlign('right').run(); }
export function alignCenter(editor: Editor): void { editor.chain().focus().setTextAlign('center').run(); }
export function setHeading(editor: Editor, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  editor.chain().focus().toggleHeading({ level }).run();
}
export function demoteHeading(editor: Editor): void {
  const lvl = (editor.getAttributes('heading').level as number) || 0;
  if (lvl > 0 && lvl < 6) editor.chain().focus().toggleHeading({ level: (lvl + 1) as 2 | 3 | 4 | 5 | 6 }).run();
}
export function promoteHeading(editor: Editor): void {
  const lvl = (editor.getAttributes('heading').level as number) || 0;
  if (lvl > 1) editor.chain().focus().toggleHeading({ level: (lvl - 1) as 1 | 2 | 3 | 4 | 5 }).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 4) Tables — beyond TipTap's defaults (56–75)
// ────────────────────────────────────────────────────────────────────────────

export function insertTable(editor: Editor, rows = 3, cols = 3): void {
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
}
export function addRowAbove(editor: Editor): void { editor.chain().focus().addRowBefore().run(); }
export function addRowBelow(editor: Editor): void { editor.chain().focus().addRowAfter().run(); }
export function addColumnLeft(editor: Editor): void { editor.chain().focus().addColumnBefore().run(); }
export function addColumnRight(editor: Editor): void { editor.chain().focus().addColumnAfter().run(); }
export function deleteRow(editor: Editor): void { editor.chain().focus().deleteRow().run(); }
export function deleteColumn(editor: Editor): void { editor.chain().focus().deleteColumn().run(); }
export function deleteTable(editor: Editor): void { editor.chain().focus().deleteTable().run(); }
export function mergeCells(editor: Editor): void { editor.chain().focus().mergeCells().run(); }
export function splitCell(editor: Editor): void { editor.chain().focus().splitCell().run(); }
export function toggleHeaderRow(editor: Editor): void { editor.chain().focus().toggleHeaderRow().run(); }
export function toggleHeaderColumn(editor: Editor): void { editor.chain().focus().toggleHeaderColumn().run(); }

export function insertBandedTable(editor: Editor, rows = 4, cols = 3): void {
  const headerCells = Array.from({ length: cols }, (_, i) =>
    `<th style="background:#d4a017;color:#000;padding:6px;border:1px solid #222;">Col ${i + 1}</th>`).join('');
  const bodyRows = Array.from({ length: rows }, (_, r) => {
    // Banding is baked into the inserted document HTML, so it cannot follow the
    // app theme and must read correctly on a printed/exported page. Literals on
    // purpose. Was `r % 2 ? '#0a0a0a' : 'var(--surface-base)'` — near-black and
    // Blue & Silver navy, which is unreadable banding in a light document.
    // Matches the light document-table convention already used elsewhere
    // (features/index.ts uses #f0f0f0 for document table cells).
    const bg = r % 2 ? '#f0f0f0' : '#ffffff';
    const cells = Array.from({ length: cols }, () =>
      `<td style="background:${bg};padding:6px;border:1px solid #222;">&nbsp;</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  editor.chain().focus().insertContent(
    `<table data-banded="1" style="border-collapse:collapse;width:100%;"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`,
  ).run();
}

export function insertEvidenceLogTable(editor: Editor): void {
  const head = ['Item #', 'Description', 'Location Found', 'Collected By', 'Date/Time'];
  const headerCells = head.map((h) => `<th style="background:#d4a017;color:#000;padding:6px;border:1px solid #333;">${h}</th>`).join('');
  const blank = Array.from({ length: 5 }, () =>
    `<tr>${head.map(() => '<td style="border:1px solid #333;padding:6px;height:24px"></td>').join('')}</tr>`).join('');
  editor.chain().focus().insertContent(
    `<table data-evidence-log="1" style="border-collapse:collapse;width:100%;"><thead><tr>${headerCells}</tr></thead><tbody>${blank}</tbody></table>`,
  ).run();
}

export function insertChainOfCustodyTable(editor: Editor): void {
  const head = ['Date/Time', 'Released By', 'Received By', 'Purpose', 'Signature'];
  const headerCells = head.map((h) => `<th style="background:#222;color:#d4a017;padding:6px;border:1px solid #333;">${h}</th>`).join('');
  const blank = Array.from({ length: 6 }, () =>
    `<tr>${head.map(() => '<td style="border:1px solid #333;padding:6px;height:28px"></td>').join('')}</tr>`).join('');
  editor.chain().focus().insertContent(
    `<table data-chain-of-custody="1" style="border-collapse:collapse;width:100%;"><thead><tr>${headerCells}</tr></thead><tbody>${blank}</tbody></table>`,
  ).run();
}

export function insertWitnessTable(editor: Editor): void {
  const head = ['Name', 'DOB', 'Address', 'Phone', 'Statement Given?'];
  const headerCells = head.map((h) => `<th style="background:#d4a017;color:#000;padding:6px;border:1px solid #333;">${h}</th>`).join('');
  const blank = Array.from({ length: 4 }, () =>
    `<tr>${head.map(() => '<td style="border:1px solid #333;padding:6px;height:26px"></td>').join('')}</tr>`).join('');
  editor.chain().focus().insertContent(
    `<table data-witness-list="1" style="border-collapse:collapse;width:100%;"><thead><tr>${headerCells}</tr></thead><tbody>${blank}</tbody></table>`,
  ).run();
}

export function setTableBorderColor(editor: Editor, color: string): void {
  // Walk current table cells and set border color via inline style.
  const { state, view } = editor;
  const edits: { pos: number; attrs: Record<string, unknown> }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      edits.push({ pos, attrs: { ...node.attrs, style: `border:1px solid ${color}` } });
    }
  });
  let tr = state.tr;
  for (const e of edits) tr = tr.setNodeAttribute(e.pos, 'style', `border:1px solid ${color}`);
  view.dispatch(tr);
}

// ────────────────────────────────────────────────────────────────────────────
// 5) Lists — multi-level, custom markers (76–90)
// ────────────────────────────────────────────────────────────────────────────

const listHTML = (style: string, items: string[]) =>
  `<ul style="list-style:${style}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

export function insertBulletList(editor: Editor): void { editor.chain().focus().toggleBulletList().run(); }
export function insertNumberedList(editor: Editor): void { editor.chain().focus().toggleOrderedList().run(); }
export function insertTaskList(editor: Editor): void { editor.chain().focus().toggleTaskList().run(); }
export function insertChecklistInline(editor: Editor, items: string[]): void {
  const html = items.map((i) => `<p>☐ ${esc(i)}</p>`).join('');
  editor.chain().focus().insertContent(html).run();
}
export function insertSquareBullets(editor: Editor): void {
  editor.chain().focus().insertContent(listHTML('square', ['Item one', 'Item two', 'Item three'])).run();
}
export function insertCircleBullets(editor: Editor): void {
  editor.chain().focus().insertContent(listHTML('circle', ['Item one', 'Item two', 'Item three'])).run();
}
export function insertArrowBullets(editor: Editor): void {
  editor.chain().focus().insertContent('<ul style="list-style:none;padding-left:1em">'
    + ['One', 'Two', 'Three'].map((i) => `<li>➤ ${esc(i)}</li>`).join('') + '</ul>').run();
}
export function insertAlphaList(editor: Editor): void {
  editor.chain().focus().insertContent('<ol style="list-style:lower-alpha"><li>One</li><li>Two</li></ol>').run();
}
export function insertRomanList(editor: Editor): void {
  editor.chain().focus().insertContent('<ol style="list-style:upper-roman"><li>One</li><li>Two</li></ol>').run();
}
export function insertMultilevelList(editor: Editor): void {
  editor.chain().focus().insertContent(
    '<ol><li>First<ol style="list-style:lower-alpha"><li>Sub one</li><li>Sub two</li></ol></li><li>Second</li></ol>',
  ).run();
}
export function sinkList(editor: Editor): void { editor.chain().focus().sinkListItem('listItem').run(); }
export function liftList(editor: Editor): void { editor.chain().focus().liftListItem('listItem').run(); }
export function joinListBackward(editor: Editor): void { editor.chain().focus().joinBackward().run(); }
export function insertDefinitionList(editor: Editor): void {
  editor.chain().focus().insertContent(
    '<dl><dt><b>Term</b></dt><dd>Definition</dd><dt><b>Term 2</b></dt><dd>Definition 2</dd></dl>',
  ).run();
}
export function insertGlossaryEntry(editor: Editor, term: string, definition: string): void {
  editor.chain().focus().insertContent(
    `<p data-glossary="1"><b>${esc(term)}</b> — ${esc(definition)}</p>`,
  ).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 6) Callouts, blocks & decorative inserts (91–110)
// ────────────────────────────────────────────────────────────────────────────

const callout = (label: string, color: string, body: string) =>
  `<div data-callout="${label.toLowerCase()}" style="border-left:4px solid ${color};background:rgba(212,160,23,0.05);padding:10px 12px;margin:8px 0;">`
  + `<b style="color:${color}">${label}</b><div>${body}</div></div>`;

export function insertNoteCallout(editor: Editor, body = 'Note text'): void {
  editor.chain().focus().insertContent(callout('NOTE', '#5b9bd5', esc(body))).run();
}
export function insertWarningCallout(editor: Editor, body = 'Warning text'): void {
  editor.chain().focus().insertContent(callout('WARNING', '#e0a458', esc(body))).run();
}
export function insertDangerCallout(editor: Editor, body = 'Danger text'): void {
  editor.chain().focus().insertContent(callout('DANGER', '#c93030', esc(body))).run();
}
export function insertTipCallout(editor: Editor, body = 'Tip text'): void {
  editor.chain().focus().insertContent(callout('TIP', '#3fa34d', esc(body))).run();
}
export function insertInfoCallout(editor: Editor, body = 'Info text'): void {
  editor.chain().focus().insertContent(callout('INFO', '#888', esc(body))).run();
}
export function insertQuoteBlock(editor: Editor, body = 'Quoted text'): void {
  editor.chain().focus().insertContent(`<blockquote>${esc(body)}</blockquote>`).run();
}
export function insertPullQuote(editor: Editor, body: string): void {
  editor.chain().focus().insertContent(
    `<aside data-pull-quote="1" style="float:right;width:38%;font-size:1.3em;font-style:italic;border-top:2px solid #d4a017;border-bottom:2px solid #d4a017;padding:12px;margin:0 0 12px 16px;">${esc(body)}</aside>`,
  ).run();
}
export function insertCodeBlock(editor: Editor): void { editor.chain().focus().toggleCodeBlock().run(); }
export function insertInlineCode(editor: Editor): void { editor.chain().focus().toggleCode().run(); }
export function insertKeyboardShortcut(editor: Editor, keys: string): void {
  editor.chain().focus().insertContent(`<kbd style="font-family:'Arial, sans-serif';background:#222;border:1px solid #444;border-radius:3px;padding:1px 5px;">${esc(keys)}</kbd>`).run();
}
export function insertDropCap(editor: Editor): void {
  // Wraps the first character of the current paragraph in a drop-cap span.
  const { state, view } = editor;
  const { $from } = state.selection;
  const para = $from.parent;
  if (para.type.name !== 'paragraph' || !para.textContent) return;
  const start = $from.start();
  const firstChar = para.textContent[0];
  const tr = state.tr.insertText(
    '', // we'll replace with HTML through a different path:
    start, start + 1,
  );
  view.dispatch(tr);
  editor.chain().focus().insertContentAt(start,
    `<span data-drop-cap="1" style="float:left;font-size:3em;line-height:0.9;padding:4px 6px 0 0;color:#d4a017;">${esc(firstChar)}</span>`,
  ).run();
}
export function insertSidebarBox(editor: Editor, body = 'Sidebar'): void {
  editor.chain().focus().insertContent(
    `<aside data-sidebar="1" style="float:right;width:200px;border:1px solid #2e2e2e;background:#141414;padding:10px;margin:0 0 8px 12px;font-size:0.9em;">${esc(body)}</aside>`,
  ).run();
}
export function insertWatermarkText(editor: Editor, text: string): void {
  editor.chain().focus().insertContentAt(0,
    `<div data-watermark="1" style="position:fixed;top:40%;left:0;right:0;text-align:center;font-size:120px;color:rgba(212,160,23,0.06);pointer-events:none;transform:rotate(-30deg);z-index:0;">${esc(text)}</div>`,
  ).run();
}
export function insertCenteredImagePlaceholder(editor: Editor): void {
  editor.chain().focus().insertContent(
    `<p style="text-align:center"><span style="display:inline-block;border:1px dashed #555;padding:60px 80px;color:#888">[ image ]</span></p>`,
  ).run();
}
export function insertCaption(editor: Editor, label: 'Figure' | 'Table' | 'Exhibit', text: string): void {
  editor.chain().focus().insertContent(
    `<p data-caption="${label.toLowerCase()}" style="text-align:center;font-style:italic;color:#aaa;font-size:0.9em;">${label} — ${esc(text)}</p>`,
  ).run();
}
export function insertExhibitLabel(editor: Editor, letter: string): void {
  editor.chain().focus().insertContent(
    `<div data-exhibit="${esc(letter)}" style="text-align:center;border:2px solid #d4a017;display:inline-block;padding:6px 16px;font-weight:bold;letter-spacing:2px;">EXHIBIT ${esc(letter.toUpperCase())}</div>`,
  ).run();
}
export function insertHorizontalDivider(editor: Editor, style: 'solid' | 'dashed' | 'dotted' | 'double' = 'solid'): void {
  editor.chain().focus().insertContent(`<hr style="border:none;border-top:1px ${style} #555;margin:12px 0">`).run();
}
export function insertGoldDivider(editor: Editor): void {
  editor.chain().focus().insertContent('<hr style="border:none;border-top:2px solid #d4a017;margin:14px 0">').run();
}
export function insertColumnLayout(editor: Editor, n: 2 | 3): void {
  editor.chain().focus().insertContent(
    `<div data-columns="${n}" style="column-count:${n};column-gap:1.5em;">Two-column body text. Add as many paragraphs as you like — they will flow across columns.</div>`,
  ).run();
}
export function insertVerticalSpacer(editor: Editor, px = 24): void {
  editor.chain().focus().insertContent(`<div style="height:${px}px"></div>`).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 7) Math, equations, units (111–122)
// ────────────────────────────────────────────────────────────────────────────

export function insertEquation(editor: Editor, latex: string): void {
  editor.chain().focus().insertContent(
    `<span data-equation="${esc(latex)}" style="font-family:'Cambria Math',serif;font-style:italic;background:rgba(212,160,23,0.07);padding:0 4px;border-radius:2px;">${esc(latex)}</span>`,
  ).run();
}
export function insertFraction(editor: Editor, num: string, den: string): void {
  editor.chain().focus().insertContent(
    `<span style="display:inline-block;text-align:center;vertical-align:middle;line-height:1;font-family:'Cambria Math',serif">`
    + `<span style="display:block;border-bottom:1px solid currentColor;padding:0 4px;">${esc(num)}</span>`
    + `<span style="display:block;padding:0 4px;">${esc(den)}</span></span>`,
  ).run();
}
export function insertSquareRoot(editor: Editor, body: string): void {
  editor.chain().focus().insertContent(
    `<span style="font-family:'Cambria Math',serif">√<span style="border-top:1px solid currentColor">${esc(body)}</span></span>`,
  ).run();
}
export function insertSummation(editor: Editor): void { editor.chain().focus().insertContent('Σ').run(); }
export function insertIntegral(editor: Editor): void { editor.chain().focus().insertContent('∫').run(); }
export function insertProduct(editor: Editor): void { editor.chain().focus().insertContent('∏').run(); }
export function insertInfinity(editor: Editor): void { editor.chain().focus().insertContent('∞').run(); }
export function insertGreekAlpha(editor: Editor): void { editor.chain().focus().insertContent('α').run(); }
export function insertGreekBeta(editor: Editor): void { editor.chain().focus().insertContent('β').run(); }
export function insertGreekPi(editor: Editor): void { editor.chain().focus().insertContent('π').run(); }
export function insertGreekTheta(editor: Editor): void { editor.chain().focus().insertContent('θ').run(); }
export function insertUnit(editor: Editor, n: number, unit: string): void {
  editor.chain().focus().insertContent(`${n} ${esc(unit)}`).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 8) References, citations, links (123–140)
// ────────────────────────────────────────────────────────────────────────────

export function insertHyperlink(editor: Editor, href: string, text?: string): void {
  const display = text || href;
  editor.chain().focus().insertContent(`<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(display)}</a>`).run();
}
export function insertEmailLink(editor: Editor, addr: string, display?: string): void {
  editor.chain().focus().insertContent(`<a href="mailto:${esc(addr)}">${esc(display || addr)}</a>`).run();
}
export function insertPhoneLink(editor: Editor, num: string): void {
  editor.chain().focus().insertContent(`<a href="tel:${esc(num.replace(/[^+\d]/g, ''))}">${esc(num)}</a>`).run();
}
export function insertCaseLawCitation(editor: Editor, citation: string): void {
  editor.chain().focus().insertContent(
    `<span data-citation="caselaw" style="font-style:italic;border-bottom:1px dotted #888">${esc(citation)}</span>`,
  ).run();
}
export function insertUtahCodeCitation(editor: Editor, section: string): void {
  editor.chain().focus().insertContent(
    `<a href="https://le.utah.gov/xcode/Title${esc(section.split('-')[0])}" target="_blank" rel="noreferrer" data-citation="utah-code">Utah Code § ${esc(section)}</a>`,
  ).run();
}
export function insertStatutePinCite(editor: Editor, statute: string, pin: string): void {
  editor.chain().focus().insertContent(
    `<span data-pin-cite="1">${esc(statute)}, at ${esc(pin)}</span>`,
  ).run();
}
export function insertBibliographyEntry(editor: Editor, author: string, title: string, year: string): void {
  editor.chain().focus().insertContent(
    `<p data-biblio="1" style="text-indent:-2em;padding-left:2em">${esc(author)} (${esc(year)}). <i>${esc(title)}</i>.</p>`,
  ).run();
}
export function insertFootnoteRef(editor: Editor, n: number): void {
  editor.chain().focus().insertContent(`<sup><a href="#fn${n}">[${n}]</a></sup>`).run();
}
export function insertEndnoteRef(editor: Editor, n: number): void {
  editor.chain().focus().insertContent(`<sup><a href="#en${n}">[${n}]</a></sup>`).run();
}
export function insertSeeAlso(editor: Editor, text: string): void {
  editor.chain().focus().insertContent(`<p><i>See also: ${esc(text)}</i></p>`).run();
}
export function insertCfText(editor: Editor, text: string): void {
  editor.chain().focus().insertContent(`<i>Cf.</i> ${esc(text)}`).run();
}
export function insertIdCitation(editor: Editor): void {
  editor.chain().focus().insertContent('<i>Id.</i>').run();
}
export function insertSupraNote(editor: Editor, n: number): void {
  editor.chain().focus().insertContent(`<i>supra</i> note ${n}`).run();
}
export function insertInternalLink(editor: Editor, sectionTitle: string): void {
  const id = sectionTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  editor.chain().focus().insertContent(`<a href="#${id}">${esc(sectionTitle)}</a>`).run();
}
export function insertAnchor(editor: Editor, name: string): void {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  editor.chain().focus().insertContent(`<a id="${id}" data-anchor="${esc(name)}"></a>`).run();
}
export function insertReferenceList(editor: Editor): void {
  editor.chain().focus().insertContent('<h3>References</h3><ol data-refs="1"><li>Author. <i>Title</i>. Publisher, Year.</li></ol>').run();
}
export function insertBlueBookCase(editor: Editor, name: string, reporter: string, court: string, year: string): void {
  editor.chain().focus().insertContent(
    `<span data-bluebook="1"><i>${esc(name)}</i>, ${esc(reporter)} (${esc(court)} ${esc(year)})</span>`,
  ).run();
}
export function insertCourtCitation(editor: Editor, court: string, caseNum: string): void {
  editor.chain().focus().insertContent(`<span data-court-cite="1">${esc(court)}, Case No. ${esc(caseNum)}</span>`).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 9) Police / legal domain blocks (141–155)
// ────────────────────────────────────────────────────────────────────────────

/** Black-bar redaction. Wraps the current selection in a span that renders as a
 *  solid black bar at print time AND removes the underlying text from the DOM so
 *  it can't be revealed by selecting + copying. */
export function redactSelection(editor: Editor): boolean {
  const { state, view } = editor;
  const { from, to } = state.selection;
  if (from === to) return false;
  const text = state.doc.textBetween(from, to, ' ');
  const replacement = `<span data-redacted="1" title="REDACTED" style="background:#000;color:#000;padding:0 4px;user-select:none;">${'█'.repeat(Math.max(3, text.length))}</span>`;
  editor.chain().focus().deleteRange({ from, to }).insertContent(replacement).run();
  return true;
}
export function redactWithLabel(editor: Editor, label: string): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  if (from === to) return false;
  editor.chain().focus().deleteRange({ from, to }).insertContent(
    `<span data-redacted="1" data-redact-label="${esc(label)}" style="background:#000;color:#d4a017;padding:0 6px;font-size:0.8em;letter-spacing:1px;">[${esc(label)}]</span>`,
  ).run();
  return true;
}
export function insertMirandaWarning(editor: Editor): void {
  const body =
    'You have the right to remain silent. Anything you say can and will be used against you in a court of law. ' +
    'You have the right to an attorney. If you cannot afford an attorney, one will be appointed for you. ' +
    'Do you understand the rights I have just read to you? With these rights in mind, do you wish to speak to me?';
  editor.chain().focus().insertContent(
    `<div data-miranda="1" style="border:1px solid #d4a017;padding:10px;margin:8px 0;"><b>MIRANDA WARNING</b><p>${esc(body)}</p>`
    + `<p>Signature: ___________________________ Date: __________ Time: __________</p></div>`,
  ).run();
}
export function insertConsentToSearch(editor: Editor): void {
  editor.chain().focus().insertContent(
    `<div data-consent="1" style="border:1px solid #d4a017;padding:10px;margin:8px 0;"><b>CONSENT TO SEARCH</b>`
    + `<p>I, the undersigned, do hereby give my consent to <i>(officer name)</i> of the Rocky Mountain Protective Group, `
    + `to conduct a complete search of: <span style="border-bottom:1px solid #555;display:inline-block;min-width:240px"></span></p>`
    + `<p>This consent is given freely and voluntarily, without threats or promises.</p>`
    + `<p>Signature: ___________________________ Date: __________</p></div>`,
  ).run();
}
export function insertOfficerNarrativeBlock(editor: Editor, officerName: string, badge: string): void {
  const now = new Date();
  const stamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  editor.chain().focus().insertContent(
    `<div data-narrative="1" style="border-left:3px solid #d4a017;padding:6px 10px;margin:8px 0;">`
    + `<p style="font-size:0.85em;color:#aaa">${esc(officerName)} (#${esc(badge)}) — ${stamp}</p><p>Narrative…</p></div>`,
  ).run();
}
export function insertEvidenceStamp(editor: Editor, itemNum: string): void {
  editor.chain().focus().insertContent(
    `<span data-evidence-stamp="1" style="display:inline-block;border:2px solid #c93030;color:#c93030;padding:2px 8px;font-weight:bold;letter-spacing:1px;">EVIDENCE #${esc(itemNum)}</span>`,
  ).run();
}
export function insertConfidentialBanner(editor: Editor): void {
  editor.chain().focus().insertContentAt(0,
    `<div data-classification="confidential" style="background:#c93030;color:#fff;text-align:center;padding:4px;font-weight:bold;letter-spacing:3px;">CONFIDENTIAL — RESTRICTED</div>`,
  ).run();
}
export function insertLawEnforcementOnlyBanner(editor: Editor): void {
  editor.chain().focus().insertContentAt(0,
    `<div data-classification="leo" style="background:#000;color:#d4a017;text-align:center;padding:4px;font-weight:bold;letter-spacing:3px;border:1px solid #d4a017;">FOR OFFICIAL USE ONLY</div>`,
  ).run();
}
export function insertCaseNumberHeader(editor: Editor, caseNum: string): void {
  editor.chain().focus().insertContentAt(0,
    `<p data-case-header="1" style="text-align:right;font-family:'Arial, sans-serif';color:#d4a017">Case No. ${esc(caseNum)}</p>`,
  ).run();
}
export function insertSuspectDescriptionTable(editor: Editor): void {
  const rows: [string, string][] = [['Name', ''], ['DOB / Age', ''], ['Sex', ''], ['Race', ''], ['Height', ''], ['Weight', ''], ['Hair', ''], ['Eyes', ''], ['Clothing', ''], ['Tattoos / Marks', ''], ['Last Seen', '']];
  const body = rows.map(([k]) => `<tr><th style="text-align:left;background:#141414;color:#d4a017;border:1px solid #333;padding:4px 8px;width:30%">${k}</th><td style="border:1px solid #333;padding:4px 8px"></td></tr>`).join('');
  editor.chain().focus().insertContent(`<table data-suspect-desc="1" style="border-collapse:collapse;width:100%"><tbody>${body}</tbody></table>`).run();
}
export function insertVehicleDescriptionTable(editor: Editor): void {
  const rows = ['Plate', 'State', 'VIN', 'Year', 'Make', 'Model', 'Color', 'Distinctive Marks'];
  const body = rows.map((k) => `<tr><th style="text-align:left;background:#141414;color:#d4a017;border:1px solid #333;padding:4px 8px;width:30%">${k}</th><td style="border:1px solid #333;padding:4px 8px"></td></tr>`).join('');
  editor.chain().focus().insertContent(`<table data-vehicle-desc="1" style="border-collapse:collapse;width:100%"><tbody>${body}</tbody></table>`).run();
}
export function insertUseOfForceBlock(editor: Editor): void {
  editor.chain().focus().insertContent(
    `<div data-uof="1" style="border:2px solid #c93030;padding:12px;margin:8px 0;"><h3 style="margin-top:0;color:#c93030">USE OF FORCE REPORT</h3>`
    + `<p><b>Date/Time:</b> _____________ &nbsp;&nbsp; <b>Location:</b> _____________________</p>`
    + `<p><b>Force Type:</b> ☐ Verbal &nbsp; ☐ Hands-on &nbsp; ☐ OC Spray &nbsp; ☐ Baton &nbsp; ☐ Taser &nbsp; ☐ Firearm</p>`
    + `<p><b>Subject Action Prior:</b> __________________________________________________</p>`
    + `<p><b>Justification:</b> ____________________________________________________________</p></div>`,
  ).run();
}
export function insertCallSummaryHeader(editor: Editor, callNum: string, callType: string, location: string): void {
  editor.chain().focus().insertContentAt(0,
    `<div data-call-header="1" style="border-bottom:2px solid #d4a017;padding-bottom:6px;margin-bottom:10px;">`
    + `<table style="width:100%;border:none;color:#d4a017"><tr>`
    + `<td><b>Call #</b> ${esc(callNum)}</td><td><b>Type</b> ${esc(callType)}</td><td style="text-align:right"><b>Location</b> ${esc(location)}</td></tr></table></div>`,
  ).run();
}
export function insertInterviewQABlock(editor: Editor): void {
  editor.chain().focus().insertContent(
    `<div data-interview="1" style="padding:6px 10px;margin:8px 0;"><p><b>Q:</b> </p><p><b>A:</b> </p><p><b>Q:</b> </p><p><b>A:</b> </p></div>`,
  ).run();
}
export function insertCertificationStatement(editor: Editor, officerName: string): void {
  editor.chain().focus().insertContent(
    `<div data-certification="1" style="border-top:1px solid #555;margin-top:24px;padding-top:8px;font-style:italic;">`
    + `I, ${esc(officerName)}, certify under penalty of perjury under the laws of the State of Utah that the foregoing is true and correct.`
    + `<br><br>Signed: ___________________________ Date: ____________ Place: Salt Lake City, Utah</div>`,
  ).run();
}

// ────────────────────────────────────────────────────────────────────────────
// 10) Document-wide utilities (156–170+ — bringing total to 150)
// ────────────────────────────────────────────────────────────────────────────

export function selectAll(editor: Editor): void { editor.chain().focus().selectAll().run(); }
export function selectParagraph(editor: Editor): void {
  const { $from } = editor.state.selection;
  const start = $from.start();
  const end = $from.end();
  editor.chain().focus().setTextSelection({ from: start, to: end }).run();
}
export function selectSentence(editor: Editor): void {
  const { state } = editor;
  const text = state.doc.textBetween(0, state.doc.content.size, '\n');
  const cursor = state.selection.from;
  let start = cursor;
  while (start > 0 && !/[.!?]/.test(text[start - 1])) start--;
  let end = cursor;
  while (end < text.length && !/[.!?]/.test(text[end])) end++;
  editor.chain().focus().setTextSelection({ from: start, to: end + 1 }).run();
}
export function selectWord(editor: Editor): void {
  const { state } = editor;
  const cursor = state.selection.from;
  const text = state.doc.textBetween(Math.max(0, cursor - 50), Math.min(state.doc.content.size, cursor + 50), ' ');
  const local = 50;
  let s = local;
  while (s > 0 && /\w/.test(text[s - 1])) s--;
  let e = local;
  while (e < text.length && /\w/.test(text[e])) e++;
  editor.chain().focus().setTextSelection({ from: cursor - (local - s), to: cursor + (e - local) }).run();
}
export function goToTop(editor: Editor): void { editor.chain().focus().setTextSelection(0).run(); }
export function goToBottom(editor: Editor): void {
  editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
}
export function duplicateSelection(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  const slice = editor.state.doc.cut(from, to);
  const html = (slice as unknown as { toJSON(): unknown }).toJSON();
  editor.chain().focus().insertContentAt(to, html as never).run();
  return true;
}
export function deleteSelection(editor: Editor): void { editor.chain().focus().deleteSelection().run(); }
export function deleteLine(editor: Editor): void {
  const { $from } = editor.state.selection;
  editor.chain().focus().setTextSelection({ from: $from.start(), to: $from.end() }).deleteSelection().run();
}
export function moveLineUp(editor: Editor): void {
  // Best-effort: cut current paragraph text, insert above; preserves no marks.
  const { state, view } = editor;
  const { $from } = state.selection;
  const para = $from.parent;
  if (para.type.name !== 'paragraph') return;
  const start = $from.start();
  const end = $from.end();
  const text = para.textContent;
  const before = state.doc.resolve(Math.max(1, start - 2));
  const tr = state.tr.delete(start - 1, end).insert(before.pos, state.schema.nodes.paragraph.create(null, state.schema.text(text || ' ')));
  view.dispatch(tr);
}
export function moveLineDown(editor: Editor): void {
  const { state, view } = editor;
  const { $from } = state.selection;
  const para = $from.parent;
  if (para.type.name !== 'paragraph') return;
  const start = $from.start();
  const end = $from.end();
  const text = para.textContent;
  const after = Math.min(state.doc.content.size, end + 2);
  const tr = state.tr.delete(start - 1, end).insert(after - 2, state.schema.nodes.paragraph.create(null, state.schema.text(text || ' ')));
  view.dispatch(tr);
}

export function setBackgroundColor(editor: Editor, color: string): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (root) root.style.backgroundColor = color;
}
export function setPageColor(editor: Editor, color: string): void { setBackgroundColor(editor, color); }
export function toggleParagraphMarks(editor: Editor): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (!root) return;
  root.classList.toggle('show-paragraph-marks');
}
export function toggleRulers(editor: Editor): void {
  const root = document.querySelector<HTMLElement>('.doc-writer-shell');
  if (root) root.classList.toggle('show-rulers');
}
export function toggleGridlines(editor: Editor): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (root) root.classList.toggle('show-gridlines');
}
export function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
}
export function setZoom(editor: Editor, pct: number): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (root) root.style.zoom = String(pct / 100);
}
export function zoomIn(editor: Editor): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (!root) return;
  const cur = Number(root.style.zoom || '1');
  root.style.zoom = String(Math.min(3, cur + 0.1));
}
export function zoomOut(editor: Editor): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (!root) return;
  const cur = Number(root.style.zoom || '1');
  root.style.zoom = String(Math.max(0.4, cur - 0.1));
}
export function fitToWidth(editor: Editor): void {
  const root = document.querySelector<HTMLElement>('.ProseMirror');
  if (root) root.style.zoom = '1';
}

// ── Persistence helpers for autocorrect + spell ignore list ──
const AC_KEY = 'rmpg_writer_autocorrect';
const SPELL_KEY = 'rmpg_writer_spell_ignore';

export interface AutocorrectRule { from: string; to: string }

export function listAutocorrectRules(): AutocorrectRule[] {
  try { return JSON.parse(localStorage.getItem(AC_KEY) || '[]'); } catch { return []; }
}
export function addAutocorrectRule(from: string, to: string): void {
  const all = listAutocorrectRules().filter((r) => r.from !== from);
  all.push({ from, to });
  localStorage.setItem(AC_KEY, JSON.stringify(all));
}
export function removeAutocorrectRule(from: string): void {
  localStorage.setItem(AC_KEY, JSON.stringify(listAutocorrectRules().filter((r) => r.from !== from)));
}
export function applyAutocorrect(editor: Editor): number {
  const rules = listAutocorrectRules();
  if (!rules.length) return 0;
  return mapSelectionText(editor, (s) => {
    let out = s;
    for (const r of rules) {
      out = out.split(r.from).join(r.to);
    }
    return out;
  });
}

export function listSpellIgnored(): string[] {
  try { return JSON.parse(localStorage.getItem(SPELL_KEY) || '[]'); } catch { return []; }
}
export function addSpellIgnored(word: string): void {
  const set = new Set(listSpellIgnored()); set.add(word);
  localStorage.setItem(SPELL_KEY, JSON.stringify([...set]));
}
export function removeSpellIgnored(word: string): void {
  localStorage.setItem(SPELL_KEY, JSON.stringify(listSpellIgnored().filter((w) => w !== word)));
}

// ── Find-all (count occurrences without opening the panel) ──
export function countOccurrences(editor: Editor, needle: string): number {
  if (!needle) return 0;
  const text = editor.state.doc.textContent;
  let n = 0; let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ── Clipboard helpers ──
export async function copyAsPlainText(editor: Editor): Promise<void> {
  await navigator.clipboard.writeText(editor.state.doc.textContent);
}
export async function copyAsHTML(editor: Editor): Promise<void> {
  await navigator.clipboard.writeText(editor.getHTML());
}
export async function copyAsMarkdown(editor: Editor): Promise<void> {
  // Lossy but useful — headings, bold, italic, lists, links.
  const html = editor.getHTML();
  let md = html
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gi, (_m, l, t) => `\n${'#'.repeat(Number(l))} ${t}\n`)
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<li>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  // Strip any remaining tags, looping until stable so overlapping angle brackets
  // (e.g. "<<b>>") can't leave a tag fragment behind after a single pass.
  let prevMd: string;
  do { prevMd = md; md = md.replace(/<[^>]+>/g, ''); } while (md !== prevMd);
  md = md.replace(/\n{3,}/g, '\n\n');
  await navigator.clipboard.writeText(md.trim());
}
export async function pasteAsPlainText(editor: Editor): Promise<void> {
  const text = await navigator.clipboard.readText();
  editor.chain().focus().insertContent(esc(text)).run();
}

// ── Headers / footers / page setup ──
export function setHeaderText(text: string): void {
  let el = document.getElementById('doc-header-text') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'doc-header-text';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;text-align:center;color:#888;font-size:0.85em;padding:4px;background:#0a0a0a;border-bottom:1px solid #2e2e2e;z-index:5;';
    document.body.appendChild(el);
  }
  el.textContent = text;
}
export function setFooterText(text: string): void {
  let el = document.getElementById('doc-footer-text') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'doc-footer-text';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;text-align:center;color:#888;font-size:0.85em;padding:4px;background:#0a0a0a;border-top:1px solid #2e2e2e;z-index:5;';
    document.body.appendChild(el);
  }
  el.textContent = text;
}
export function setOddEvenHeaders(odd: string, even: string): void {
  let style = document.getElementById('doc-odd-even-headers') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'doc-odd-even-headers';
    document.head.appendChild(style);
  }
  // Escape for a CSS string literal: backslash FIRST (otherwise we'd re-process the
  // backslashes we add for the quotes), then quotes, then drop newlines (illegal in
  // a CSS string and a way to break out of the content:"…" value).
  const cssStr = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
  style.textContent = `@page :left{@top-center{content:"${cssStr(even)}"}}@page :right{@top-center{content:"${cssStr(odd)}"}}`;
}
export function setPaperSize(size: 'letter' | 'legal' | 'a4'): void {
  let style = document.getElementById('doc-paper-size') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'doc-paper-size'; document.head.appendChild(style); }
  const dims = { letter: '8.5in 11in', legal: '8.5in 14in', a4: '210mm 297mm' }[size];
  style.textContent = `@page { size: ${dims}; }`;
}
export function setOrientation(orient: 'portrait' | 'landscape'): void {
  let style = document.getElementById('doc-orient') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'doc-orient'; document.head.appendChild(style); }
  style.textContent = `@page { size: ${orient}; }`;
}
export function setMargins(top: number, right: number, bottom: number, left: number): void {
  let style = document.getElementById('doc-margins') as HTMLStyleElement | null;
  if (!style) { style = document.createElement('style'); style.id = 'doc-margins'; document.head.appendChild(style); }
  style.textContent = `@page { margin: ${top}in ${right}in ${bottom}in ${left}in; }`;
}

// ── Misc productivity ──
export function insertCallsign(editor: Editor, callsign: string): void {
  editor.chain().focus().insertContent(
    `<span data-callsign="${esc(callsign)}" style="font-family:'Arial, sans-serif';background:#222;color:#d4a017;padding:1px 4px;border-radius:2px;">${esc(callsign)}</span>`,
  ).run();
}
export function insertTenCode(editor: Editor, code: string, label: string): void {
  editor.chain().focus().insertContent(
    `<abbr title="${esc(label)}" style="text-decoration:none;color:#d4a017;font-family:'Arial, sans-serif'">${esc(code)}</abbr>`,
  ).run();
}
export function insertPhoneticAlphabet(editor: Editor, letters: string): void {
  const map: Record<string, string> = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
    J: 'Juliet', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
  };
  const out = letters.toUpperCase().split('').map((c) => map[c] || c).join(' ');
  editor.chain().focus().insertContent(esc(out)).run();
}
export function insertGpsCoordinates(editor: Editor, lat: number, lng: number): void {
  editor.chain().focus().insertContent(
    `<span data-gps="${lat},${lng}" style="font-family:'Arial, sans-serif'">${lat.toFixed(6)}°, ${lng.toFixed(6)}°</span>`,
  ).run();
}
export function insertMapLink(editor: Editor, lat: number, lng: number, label?: string): void {
  editor.chain().focus().insertContent(
    `<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noreferrer">${esc(label || `${lat}, ${lng}`)}</a>`,
  ).run();
}

/** Insert a QR-code IMG placeholder linked to a URL. Uses the QuickChart API. */
export function insertQrCode(editor: Editor, data: string, size = 120): void {
  const url = `https://quickchart.io/qr?text=${encodeURIComponent(data)}&size=${size}`;
  editor.chain().focus().insertContent(`<img src="${url}" alt="QR" width="${size}" height="${size}" style="background:#fff;padding:4px;">`).run();
}
export function insertBarcode(editor: Editor, data: string): void {
  const url = `https://barcodeapi.org/api/code128/${encodeURIComponent(data)}`;
  editor.chain().focus().insertContent(`<img src="${url}" alt="${esc(data)}" style="background:#fff;padding:4px;height:42px;">`).run();
}

// ── Section breaks and document structure ──
export function insertSectionBreak(editor: Editor): void {
  editor.chain().focus().insertContent('<div data-section-break="1" style="break-after:page;border-top:2px double #555;margin:16px 0"></div>').run();
}
export function insertCaseFileHeader(editor: Editor, caseNum: string, officer: string, date: string): void {
  editor.chain().focus().insertContentAt(0,
    `<table data-case-file-header="1" style="width:100%;border:1px solid #d4a017;border-collapse:collapse;margin-bottom:12px;">`
    + `<tr><td style="border:1px solid #333;padding:6px;background:#141414;width:30%"><b>Case No.</b></td><td style="border:1px solid #333;padding:6px">${esc(caseNum)}</td></tr>`
    + `<tr><td style="border:1px solid #333;padding:6px;background:#141414"><b>Officer</b></td><td style="border:1px solid #333;padding:6px">${esc(officer)}</td></tr>`
    + `<tr><td style="border:1px solid #333;padding:6px;background:#141414"><b>Date</b></td><td style="border:1px solid #333;padding:6px">${esc(date)}</td></tr>`
    + `</table>`,
  ).run();
}

// ── Final: a registry so callers can render a command palette ──
export interface DocAction { name: string; group: string; fn: (editor: Editor) => unknown }

// Small helpers that wrap prompt-based actions so they all match the
// `(editor: Editor) => unknown` registry signature.
const promptText = (label: string, dflt = '') => window.prompt(label, dflt) || '';
const promptNum = (label: string, dflt: number) => {
  const v = Number(window.prompt(label, String(dflt)));
  return Number.isFinite(v) ? v : dflt;
};

/** All 150 functions, grouped. Order within each group is roughly "most used
 *  first." The palette renders one tab per group plus an "All" tab. */
export const ACTION_REGISTRY: DocAction[] = [
  // ── Case & text transforms ─────────────────────────────────────────────
  { name: 'UPPERCASE',              group: 'Case',       fn: toUpperCase },
  { name: 'lowercase',              group: 'Case',       fn: toLowerCase },
  { name: 'Title Case',             group: 'Case',       fn: toTitleCase },
  { name: 'Sentence case',          group: 'Case',       fn: toSentenceCase },
  { name: 'Toggle case',            group: 'Case',       fn: toggleCase },
  { name: 'Reverse text',           group: 'Case',       fn: reverseText },
  { name: 'Collapse whitespace',    group: 'Case',       fn: collapseWhitespace },
  { name: 'Trim trailing spaces',   group: 'Case',       fn: trimTrailingSpaces },
  { name: 'Remove duplicate spaces',group: 'Case',       fn: removeDuplicateSpaces },
  { name: 'Add line numbers',       group: 'Case',       fn: addLineNumbers },
  { name: 'Strip line numbers',     group: 'Case',       fn: stripLineNumbers },
  { name: 'ROT13',                  group: 'Case',       fn: rot13 },
  { name: 'camelCase',              group: 'Case',       fn: camelCase },
  { name: 'snake_case',             group: 'Case',       fn: snakeCase },
  { name: 'kebab-case',             group: 'Case',       fn: kebabCase },
  { name: 'Strip accents',          group: 'Case',       fn: stripAccents },
  { name: 'Curly → straight quotes',group: 'Case',       fn: curlyToStraightQuotes },
  { name: 'Pluralize words',        group: 'Case',       fn: pluralize },
  { name: 'Sort lines A→Z',         group: 'Case',       fn: sortLinesAscending },
  { name: 'Sort lines Z→A',         group: 'Case',       fn: sortLinesDescending },

  // ── Insert characters / breaks ─────────────────────────────────────────
  { name: 'Em dash —',              group: 'Insert',     fn: insertEmDash },
  { name: 'En dash –',              group: 'Insert',     fn: insertEnDash },
  { name: 'Ellipsis …',             group: 'Insert',     fn: insertEllipsis },
  { name: 'Non-breaking space',     group: 'Insert',     fn: insertNonBreakingSpace },
  { name: 'Non-breaking hyphen',    group: 'Insert',     fn: insertNonBreakingHyphen },
  { name: 'Soft hyphen',            group: 'Insert',     fn: insertSoftHyphen },
  { name: 'Zero-width space',       group: 'Insert',     fn: insertZeroWidthSpace },
  { name: 'Section sign §',         group: 'Insert',     fn: insertSectionSign },
  { name: 'Pilcrow ¶',              group: 'Insert',     fn: insertPilcrow },
  { name: 'Copyright ©',            group: 'Insert',     fn: insertCopyright },
  { name: 'Registered ®',           group: 'Insert',     fn: insertRegistered },
  { name: 'Trademark ™',            group: 'Insert',     fn: insertTrademark },
  { name: 'Degree °',               group: 'Insert',     fn: insertDegreeSymbol },
  { name: 'Checkmark ✓',            group: 'Insert',     fn: insertCheckmark },
  { name: 'Ballot ✗',               group: 'Insert',     fn: insertBallotX },
  { name: 'Empty checkbox ☐',       group: 'Insert',     fn: insertEmptyCheckbox },
  { name: 'Checked checkbox ☑',     group: 'Insert',     fn: insertCheckedCheckbox },
  { name: 'Horizontal rule',        group: 'Insert',     fn: insertHorizontalRule },
  { name: 'Page break',             group: 'Insert',     fn: insertPageBreak },
  { name: 'Column break',           group: 'Insert',     fn: insertColumnBreak },

  // ── Paragraph / alignment / heading ────────────────────────────────────
  { name: 'Clear all formatting',   group: 'Paragraph',  fn: clearAllFormatting },
  { name: 'Increase indent',        group: 'Paragraph',  fn: increaseIndent },
  { name: 'Decrease indent',        group: 'Paragraph',  fn: decreaseIndent },
  { name: 'Line spacing 1.0',       group: 'Paragraph',  fn: (e) => setLineSpacing(e, 1) },
  { name: 'Line spacing 1.15',      group: 'Paragraph',  fn: (e) => setLineSpacing(e, 1.15) },
  { name: 'Line spacing 1.5',       group: 'Paragraph',  fn: (e) => setLineSpacing(e, 1.5) },
  { name: 'Line spacing 2.0',       group: 'Paragraph',  fn: (e) => setLineSpacing(e, 2) },
  { name: 'Space before (12 px)',   group: 'Paragraph',  fn: (e) => setParagraphSpacingBefore(e, 12) },
  { name: 'Space after (12 px)',    group: 'Paragraph',  fn: (e) => setParagraphSpacingAfter(e, 12) },
  { name: 'First-line indent (0.5″)', group: 'Paragraph', fn: (e) => setFirstLineIndent(e, 0.5) },
  { name: 'Hanging indent (0.5″)',  group: 'Paragraph',  fn: (e) => setHangingIndent(e, 0.5) },
  { name: 'Align left',             group: 'Paragraph',  fn: alignLeft },
  { name: 'Align center',           group: 'Paragraph',  fn: alignCenter },
  { name: 'Align right',            group: 'Paragraph',  fn: alignRight },
  { name: 'Justify',                group: 'Paragraph',  fn: alignJustify },
  { name: 'Heading 1',              group: 'Paragraph',  fn: (e) => setHeading(e, 1) },
  { name: 'Heading 2',              group: 'Paragraph',  fn: (e) => setHeading(e, 2) },
  { name: 'Heading 3',              group: 'Paragraph',  fn: (e) => setHeading(e, 3) },
  { name: 'Heading 4',              group: 'Paragraph',  fn: (e) => setHeading(e, 4) },
  { name: 'Promote heading',        group: 'Paragraph',  fn: promoteHeading },
  { name: 'Demote heading',         group: 'Paragraph',  fn: demoteHeading },

  // ── Tables ─────────────────────────────────────────────────────────────
  { name: 'Insert table (3×3)',     group: 'Table',      fn: (e) => insertTable(e, 3, 3) },
  { name: 'Insert table (custom)',  group: 'Table',      fn: (e) => insertTable(e, promptNum('Rows:', 3), promptNum('Cols:', 3)) },
  { name: 'Banded table',           group: 'Table',      fn: (e) => insertBandedTable(e) },
  { name: 'Add row above',          group: 'Table',      fn: addRowAbove },
  { name: 'Add row below',          group: 'Table',      fn: addRowBelow },
  { name: 'Add column left',        group: 'Table',      fn: addColumnLeft },
  { name: 'Add column right',       group: 'Table',      fn: addColumnRight },
  { name: 'Delete row',             group: 'Table',      fn: deleteRow },
  { name: 'Delete column',          group: 'Table',      fn: deleteColumn },
  { name: 'Delete table',           group: 'Table',      fn: deleteTable },
  { name: 'Merge cells',            group: 'Table',      fn: mergeCells },
  { name: 'Split cell',             group: 'Table',      fn: splitCell },
  { name: 'Toggle header row',      group: 'Table',      fn: toggleHeaderRow },
  { name: 'Toggle header column',   group: 'Table',      fn: toggleHeaderColumn },
  { name: 'Set border color…',      group: 'Table',      fn: (e) => setTableBorderColor(e, promptText('Border color (CSS):', '#d4a017')) },

  // ── Lists ──────────────────────────────────────────────────────────────
  { name: 'Bullet list',            group: 'List',       fn: insertBulletList },
  { name: 'Numbered list',          group: 'List',       fn: insertNumberedList },
  { name: 'Task list',              group: 'List',       fn: insertTaskList },
  { name: 'Checklist inline',       group: 'List',       fn: (e) => insertChecklistInline(e, ['First item', 'Second item', 'Third item']) },
  { name: 'Square bullets',         group: 'List',       fn: insertSquareBullets },
  { name: 'Circle bullets',         group: 'List',       fn: insertCircleBullets },
  { name: 'Arrow bullets',          group: 'List',       fn: insertArrowBullets },
  { name: 'Alpha list (a, b, c)',   group: 'List',       fn: insertAlphaList },
  { name: 'Roman list (I, II, III)',group: 'List',       fn: insertRomanList },
  { name: 'Multi-level list',       group: 'List',       fn: insertMultilevelList },
  { name: 'Indent list item',       group: 'List',       fn: sinkList },
  { name: 'Outdent list item',      group: 'List',       fn: liftList },
  { name: 'Join with previous',     group: 'List',       fn: joinListBackward },
  { name: 'Definition list',        group: 'List',       fn: insertDefinitionList },
  { name: 'Glossary entry…',        group: 'List',       fn: (e) => insertGlossaryEntry(e, promptText('Term:'), promptText('Definition:')) },

  // ── Callouts, blocks, decorative ───────────────────────────────────────
  { name: 'Note callout',           group: 'Callout',    fn: (e) => insertNoteCallout(e, promptText('Note:', 'Note text')) },
  { name: 'Warning callout',        group: 'Callout',    fn: (e) => insertWarningCallout(e, promptText('Warning:', 'Warning text')) },
  { name: 'Danger callout',         group: 'Callout',    fn: (e) => insertDangerCallout(e, promptText('Danger:', 'Danger text')) },
  { name: 'Tip callout',            group: 'Callout',    fn: (e) => insertTipCallout(e, promptText('Tip:', 'Tip text')) },
  { name: 'Info callout',           group: 'Callout',    fn: (e) => insertInfoCallout(e, promptText('Info:', 'Info text')) },
  { name: 'Quote block',            group: 'Callout',    fn: (e) => insertQuoteBlock(e, promptText('Quote:', 'Quoted text')) },
  { name: 'Pull-quote',             group: 'Callout',    fn: (e) => insertPullQuote(e, promptText('Quote:', 'A short, attention-grabbing quote.')) },
  { name: 'Code block',             group: 'Callout',    fn: insertCodeBlock },
  { name: 'Inline code',            group: 'Callout',    fn: insertInlineCode },
  { name: 'Keyboard shortcut…',     group: 'Callout',    fn: (e) => insertKeyboardShortcut(e, promptText('Keys (e.g. Ctrl+S):', 'Ctrl+S')) },
  { name: 'Drop cap',               group: 'Decorative', fn: insertDropCap },
  { name: 'Sidebar box',            group: 'Decorative', fn: (e) => insertSidebarBox(e, promptText('Sidebar text:', 'Sidebar')) },
  { name: 'Watermark text…',        group: 'Decorative', fn: (e) => insertWatermarkText(e, promptText('Watermark:', 'DRAFT')) },
  { name: 'Image placeholder',      group: 'Decorative', fn: insertCenteredImagePlaceholder },
  { name: 'Caption: Figure…',       group: 'Decorative', fn: (e) => insertCaption(e, 'Figure', promptText('Caption:')) },
  { name: 'Caption: Table…',        group: 'Decorative', fn: (e) => insertCaption(e, 'Table', promptText('Caption:')) },
  { name: 'Caption: Exhibit…',      group: 'Decorative', fn: (e) => insertCaption(e, 'Exhibit', promptText('Caption:')) },
  { name: 'Exhibit label…',         group: 'Decorative', fn: (e) => insertExhibitLabel(e, promptText('Letter:', 'A')) },
  { name: 'Divider (solid)',        group: 'Decorative', fn: (e) => insertHorizontalDivider(e, 'solid') },
  { name: 'Divider (dashed)',       group: 'Decorative', fn: (e) => insertHorizontalDivider(e, 'dashed') },
  { name: 'Divider (dotted)',       group: 'Decorative', fn: (e) => insertHorizontalDivider(e, 'dotted') },
  { name: 'Divider (double)',       group: 'Decorative', fn: (e) => insertHorizontalDivider(e, 'double') },
  { name: 'Gold divider',           group: 'Decorative', fn: insertGoldDivider },
  { name: '2-column layout',        group: 'Decorative', fn: (e) => insertColumnLayout(e, 2) },
  { name: '3-column layout',        group: 'Decorative', fn: (e) => insertColumnLayout(e, 3) },
  { name: 'Vertical spacer (24 px)',group: 'Decorative', fn: (e) => insertVerticalSpacer(e, 24) },

  // ── Math ───────────────────────────────────────────────────────────────
  { name: 'Equation…',              group: 'Math',       fn: (e) => insertEquation(e, promptText('LaTeX:', 'E = mc²')) },
  { name: 'Fraction…',              group: 'Math',       fn: (e) => insertFraction(e, promptText('Numerator:', '1'), promptText('Denominator:', '2')) },
  { name: 'Square root…',           group: 'Math',       fn: (e) => insertSquareRoot(e, promptText('Inside √:', 'x')) },
  { name: 'Summation Σ',            group: 'Math',       fn: insertSummation },
  { name: 'Integral ∫',             group: 'Math',       fn: insertIntegral },
  { name: 'Product ∏',              group: 'Math',       fn: insertProduct },
  { name: 'Infinity ∞',             group: 'Math',       fn: insertInfinity },
  { name: 'Greek α',                group: 'Math',       fn: insertGreekAlpha },
  { name: 'Greek β',                group: 'Math',       fn: insertGreekBeta },
  { name: 'Greek π',                group: 'Math',       fn: insertGreekPi },
  { name: 'Greek θ',                group: 'Math',       fn: insertGreekTheta },
  { name: 'Unit (value + label)…',  group: 'Math',       fn: (e) => insertUnit(e, promptNum('Value:', 1), promptText('Unit:', 'kg')) },

  // ── References / citations / links ─────────────────────────────────────
  { name: 'Hyperlink…',             group: 'References', fn: (e) => insertHyperlink(e, promptText('URL:'), promptText('Display text (optional):')) },
  { name: 'Email link…',            group: 'References', fn: (e) => insertEmailLink(e, promptText('Address:')) },
  { name: 'Phone link…',            group: 'References', fn: (e) => insertPhoneLink(e, promptText('Phone:')) },
  { name: 'Case law citation…',     group: 'References', fn: (e) => insertCaseLawCitation(e, promptText('Citation:')) },
  { name: 'Utah Code citation…',    group: 'References', fn: (e) => insertUtahCodeCitation(e, promptText('Section (e.g. 76-5-103):', '76-5-103')) },
  { name: 'Statute pin-cite…',      group: 'References', fn: (e) => insertStatutePinCite(e, promptText('Statute:'), promptText('Pin (e.g. (2)(a)):')) },
  { name: 'Bibliography entry…',    group: 'References', fn: (e) => insertBibliographyEntry(e, promptText('Author:'), promptText('Title:'), promptText('Year:')) },
  { name: 'Footnote reference…',    group: 'References', fn: (e) => insertFootnoteRef(e, promptNum('Footnote #:', 1)) },
  { name: 'Endnote reference…',     group: 'References', fn: (e) => insertEndnoteRef(e, promptNum('Endnote #:', 1)) },
  { name: 'See also…',              group: 'References', fn: (e) => insertSeeAlso(e, promptText('Reference:')) },
  { name: 'Cf. …',                  group: 'References', fn: (e) => insertCfText(e, promptText('Reference:')) },
  { name: 'Id.',                    group: 'References', fn: insertIdCitation },
  { name: 'supra note…',            group: 'References', fn: (e) => insertSupraNote(e, promptNum('Note #:', 1)) },
  { name: 'Internal link…',         group: 'References', fn: (e) => insertInternalLink(e, promptText('Section title:')) },
  { name: 'Anchor…',                group: 'References', fn: (e) => insertAnchor(e, promptText('Anchor name:')) },
  { name: 'Reference list',         group: 'References', fn: insertReferenceList },
  { name: 'Bluebook case…',         group: 'References', fn: (e) => insertBlueBookCase(e, promptText('Case name:'), promptText('Reporter:'), promptText('Court:'), promptText('Year:')) },
  { name: 'Court citation…',        group: 'References', fn: (e) => insertCourtCitation(e, promptText('Court:'), promptText('Case #:')) },

  // ── Police / legal domain ──────────────────────────────────────────────
  { name: 'Redact selection (bar)', group: 'Police',     fn: redactSelection },
  { name: 'Redact with label…',     group: 'Police',     fn: (e) => redactWithLabel(e, promptText('Label (e.g. VICTIM, CI):', 'REDACTED')) },
  { name: 'Miranda warning',        group: 'Police',     fn: insertMirandaWarning },
  { name: 'Consent to search',      group: 'Police',     fn: insertConsentToSearch },
  { name: 'Officer narrative…',     group: 'Police',     fn: (e) => insertOfficerNarrativeBlock(e, promptText('Officer name:', 'Officer'), promptText('Badge #:', '0000')) },
  { name: 'Evidence stamp…',        group: 'Police',     fn: (e) => insertEvidenceStamp(e, promptText('Item #:', '001')) },
  { name: 'Confidential banner',    group: 'Police',     fn: insertConfidentialBanner },
  { name: 'LEO-only banner',        group: 'Police',     fn: insertLawEnforcementOnlyBanner },
  { name: 'Case number header…',    group: 'Police',     fn: (e) => insertCaseNumberHeader(e, promptText('Case #:')) },
  { name: 'Suspect description',    group: 'Police',     fn: insertSuspectDescriptionTable },
  { name: 'Vehicle description',    group: 'Police',     fn: insertVehicleDescriptionTable },
  { name: 'Use of force block',     group: 'Police',     fn: insertUseOfForceBlock },
  { name: 'Call summary header…',   group: 'Police',     fn: (e) => insertCallSummaryHeader(e, promptText('Call #:'), promptText('Type:'), promptText('Location:')) },
  { name: 'Interview Q&A block',    group: 'Police',     fn: insertInterviewQABlock },
  { name: 'Certification (oath)…',  group: 'Police',     fn: (e) => insertCertificationStatement(e, promptText('Officer name:', 'Officer')) },
  { name: 'Evidence log table',     group: 'Police',     fn: insertEvidenceLogTable },
  { name: 'Chain of custody',       group: 'Police',     fn: insertChainOfCustodyTable },
  { name: 'Witness list',           group: 'Police',     fn: insertWitnessTable },
  { name: 'Callsign…',              group: 'Police',     fn: (e) => insertCallsign(e, promptText('Callsign:', 'D-19')) },
  { name: '10-code…',               group: 'Police',     fn: (e) => insertTenCode(e, promptText('Code (e.g. 10-4):'), promptText('Meaning:')) },
  { name: 'Phonetic alphabet…',     group: 'Police',     fn: (e) => insertPhoneticAlphabet(e, promptText('Letters (e.g. ABC):')) },
  { name: 'GPS coordinates…',       group: 'Police',     fn: (e) => insertGpsCoordinates(e, promptNum('Lat:', 40.76), promptNum('Lng:', -111.89)) },
  { name: 'Map link…',              group: 'Police',     fn: (e) => insertMapLink(e, promptNum('Lat:', 40.76), promptNum('Lng:', -111.89), promptText('Label (optional):')) },
  { name: 'Case file header…',      group: 'Police',     fn: (e) => insertCaseFileHeader(e, promptText('Case #:'), promptText('Officer:'), new Date().toLocaleDateString()) },
  { name: 'Section break',          group: 'Police',     fn: insertSectionBreak },

  // ── Selection / navigation / clipboard / utility ───────────────────────
  { name: 'Select all',             group: 'Utility',    fn: selectAll },
  { name: 'Select paragraph',       group: 'Utility',    fn: selectParagraph },
  { name: 'Select sentence',        group: 'Utility',    fn: selectSentence },
  { name: 'Select word',            group: 'Utility',    fn: selectWord },
  { name: 'Go to top',              group: 'Utility',    fn: goToTop },
  { name: 'Go to bottom',           group: 'Utility',    fn: goToBottom },
  { name: 'Duplicate selection',    group: 'Utility',    fn: duplicateSelection },
  { name: 'Delete selection',       group: 'Utility',    fn: deleteSelection },
  { name: 'Delete line',            group: 'Utility',    fn: deleteLine },
  { name: 'Move line up',           group: 'Utility',    fn: moveLineUp },
  { name: 'Move line down',         group: 'Utility',    fn: moveLineDown },
  { name: 'Page color…',            group: 'Utility',    fn: (e) => setPageColor(e, promptText('Color (CSS):', '#0a0a0a')) },
  { name: 'Toggle paragraph marks', group: 'Utility',    fn: toggleParagraphMarks },
  { name: 'Toggle rulers',          group: 'Utility',    fn: toggleRulers },
  { name: 'Toggle gridlines',       group: 'Utility',    fn: toggleGridlines },
  { name: 'Toggle fullscreen',      group: 'Utility',    fn: () => toggleFullscreen() },
  { name: 'Zoom to %…',             group: 'Utility',    fn: (e) => setZoom(e, promptNum('Zoom %:', 100)) },
  { name: 'Zoom in',                group: 'Utility',    fn: zoomIn },
  { name: 'Zoom out',               group: 'Utility',    fn: zoomOut },
  { name: 'Fit to width',           group: 'Utility',    fn: fitToWidth },
  { name: 'Apply autocorrect',      group: 'Utility',    fn: applyAutocorrect },
  { name: 'Add autocorrect rule…',  group: 'Utility',    fn: () => addAutocorrectRule(promptText('Replace:'), promptText('With:')) },
  { name: 'Add to spell ignore…',   group: 'Utility',    fn: () => addSpellIgnored(promptText('Word:')) },
  { name: 'Count occurrences…',     group: 'Utility',    fn: (e) => window.alert(`${countOccurrences(e, promptText('Find:'))} occurrence(s)`) },
  { name: 'Copy as plain text',     group: 'Utility',    fn: (e) => { void copyAsPlainText(e); } },
  { name: 'Copy as HTML',           group: 'Utility',    fn: (e) => { void copyAsHTML(e); } },
  { name: 'Copy as Markdown',       group: 'Utility',    fn: (e) => { void copyAsMarkdown(e); } },
  { name: 'Paste as plain text',    group: 'Utility',    fn: (e) => { void pasteAsPlainText(e); } },
  { name: 'Header text…',           group: 'Utility',    fn: () => setHeaderText(promptText('Running header:')) },
  { name: 'Footer text…',           group: 'Utility',    fn: () => setFooterText(promptText('Running footer:')) },
  { name: 'Odd/Even headers…',      group: 'Utility',    fn: () => setOddEvenHeaders(promptText('Odd-page header:'), promptText('Even-page header:')) },
  { name: 'Paper: Letter',          group: 'Utility',    fn: () => setPaperSize('letter') },
  { name: 'Paper: Legal',           group: 'Utility',    fn: () => setPaperSize('legal') },
  { name: 'Paper: A4',              group: 'Utility',    fn: () => setPaperSize('a4') },
  { name: 'Orientation: Portrait',  group: 'Utility',    fn: () => setOrientation('portrait') },
  { name: 'Orientation: Landscape', group: 'Utility',    fn: () => setOrientation('landscape') },
  { name: 'Margins…',               group: 'Utility',    fn: () => setMargins(promptNum('Top (in):', 1), promptNum('Right (in):', 1), promptNum('Bottom (in):', 1), promptNum('Left (in):', 1)) },
  { name: 'QR code…',               group: 'Utility',    fn: (e) => insertQrCode(e, promptText('Data / URL:')) },
  { name: 'Barcode…',               group: 'Utility',    fn: (e) => insertBarcode(e, promptText('Data:')) },
  // Wave-5: 100 more features (symbols, wraps/format, police & legal blocks,
  // productivity fields) — defined in docActions3, surfaced via the palette.
  ...WAVE5_ACTIONS,
];

/** Distinct group names in registry order. Drives palette tabs. */
export const ACTION_GROUPS: string[] = Array.from(new Set(ACTION_REGISTRY.map((a) => a.group)));
