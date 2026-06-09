// Structured document actions for the Document Writer — TOC, foot/endnotes,
// bookmarks, cross-references, cover page, dynamic fields, and statistics.
// Each takes a TipTap editor and uses insertContent/HTML so the result lives in
// the saved document. Kept out of the toolbar component so they're unit-testable.

import type { Editor } from '@tiptap/react';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Collect headings (h1–h4) in document order for TOC / cross-reference pickers. */
export function collectHeadings(editor: Editor): { level: number; text: string; pos: number }[] {
  const out: { level: number; text: string; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
  });
  return out;
}

/** Generate / refresh a Table of Contents from the document's headings (feature 38). */
export function insertTableOfContents(editor: Editor): void {
  const headings = collectHeadings(editor).filter((h) => h.text.trim());
  if (headings.length === 0) {
    window.alert('Add some headings (H1–H4) first — the table of contents is built from them.');
    return;
  }
  const rows = headings
    .map((h) => `<p style="margin:2px 0; padding-left:${(h.level - 1) * 18}px">${esc(h.text)}</p>`)
    .join('');
  const toc = `<h2>Table of Contents</h2>${rows}<hr>`;
  editor.chain().focus().insertContentAt(0, toc).run();
}

/** Insert a footnote: a superscript ref at the cursor + a numbered note at the
 *  end of the document (feature 44). Endnotes (45) share the mechanism under an
 *  "Endnotes" heading. */
function insertNote(editor: Editor, kind: 'Footnotes' | 'Endnotes'): void {
  const html = editor.getHTML();
  const marker = kind === 'Footnotes' ? 'data-footnote' : 'data-endnote';
  const existing = (html.match(new RegExp(marker, 'g')) || []).length;
  const n = existing + 1;
  const text = window.prompt(`${kind.slice(0, -1)} ${n} text:`);
  if (text == null) return;
  editor.chain().focus()
    .insertContent(`<sup ${marker}="${n}">[${n}]</sup>`)
    .run();
  // Append the note to (or create) the notes section at the end of the doc.
  const noteLine = `<p ${marker}-text="${n}"><sup>[${n}]</sup> ${esc(text)}</p>`;
  const endPos = editor.state.doc.content.size;
  if (!html.includes(`>${kind}</h3>`)) {
    editor.chain().focus().insertContentAt(endPos, `<hr><h3>${kind}</h3>${noteLine}`).run();
  } else {
    editor.chain().focus().insertContentAt(endPos, noteLine).run();
  }
}

export function insertFootnote(editor: Editor): void { insertNote(editor, 'Footnotes'); }
export function insertEndnote(editor: Editor): void { insertNote(editor, 'Endnotes'); }

/** Insert a named bookmark anchor at the cursor (feature 47). */
export function insertBookmark(editor: Editor): void {
  const name = window.prompt('Bookmark name:');
  if (!name) return;
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  editor.chain().focus().insertContent(`<a id="bm-${id}" data-bookmark="${esc(name)}">⚑</a>`).run();
}

/** Insert a cross-reference link to a heading or bookmark (feature 46). */
export function insertCrossReference(editor: Editor): void {
  const headings = collectHeadings(editor).filter((h) => h.text.trim());
  if (headings.length === 0) {
    window.alert('No headings to reference yet.');
    return;
  }
  const list = headings.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
  const pick = window.prompt(`Cross-reference which heading?\n${list}\n\nEnter number:`);
  const idx = pick ? parseInt(pick, 10) - 1 : -1;
  if (idx < 0 || idx >= headings.length) return;
  const target = headings[idx];
  const id = target.text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  editor.chain().focus().insertContent(`<a href="#${id}" data-xref="1">${esc(target.text)}</a>`).run();
}

/** Insert a cover-page template above the current content (feature 39). */
export function insertCoverPage(editor: Editor, title: string, author: string): void {
  const date = new Date().toLocaleDateString();
  const cover =
    `<div data-cover-page="1" style="text-align:center; padding-top:200px">` +
    `<h1 style="font-size:34px">${esc(title || 'Document Title')}</h1>` +
    `<p style="font-size:16px; margin-top:24px">Prepared by ${esc(author || 'Author')}</p>` +
    `<p style="font-size:13px; opacity:0.7">${date}</p>` +
    `</div><div data-page-break="true" class="doc-page-break"></div>`;
  editor.chain().focus().insertContentAt(0, cover).run();
}

/** Insert a dynamic field token resolved at print time (features 34/35 helpers). */
export function insertField(editor: Editor, kind: 'page' | 'date' | 'author', author?: string): void {
  if (kind === 'date') {
    editor.chain().focus().insertContent(new Date().toLocaleDateString()).run();
  } else if (kind === 'author') {
    editor.chain().focus().insertContent(esc(author || 'Author')).run();
  } else {
    // Page-number field is a placeholder span the print routine fills per page.
    editor.chain().focus().insertContent('<span data-field="page">#</span>').run();
  }
}

/** Insert a margin note / annotation as a floated aside (feature 43). */
export function insertMarginNote(editor: Editor): void {
  const text = window.prompt('Margin note:');
  if (!text) return;
  editor.chain().focus().insertContent(
    `<aside data-margin-note="1" style="float:right; width:150px; margin:0 0 8px 12px; ` +
    `font-size:9pt; border-left:2px solid #d4a017; padding-left:8px; opacity:0.85">${esc(text)}</aside>`,
  ).run();
}

/** Insert a tab stop (feature 25) as a fixed-width inline spacer. */
export function insertTabStop(editor: Editor): void {
  editor.chain().focus().insertContent('<span data-tab style="display:inline-block; width:0.5in"></span>').run();
}

/** Insert the current date, time, or combined date-time as literal text at the
 *  cursor. Uses America/Denver-friendly locale formatting via the browser. */
export function insertDateTime(editor: Editor, kind: 'date' | 'time' | 'datetime'): void {
  const now = new Date();
  let out: string;
  if (kind === 'date') out = now.toLocaleDateString();
  else if (kind === 'time') out = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  else out = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  editor.chain().focus().insertContent(esc(out)).run();
}

/** Insert an auto-numbered section heading. The number is derived from how many
 *  H2 headings already exist so consecutive inserts read 1., 2., 3., … (feature
 *  18 — section heading shortcuts). */
export function insertSectionHeading(editor: Editor, level: 1 | 2 | 3 = 2): void {
  const existing = collectHeadings(editor).filter((h) => h.level === level && /^\d+[.)]/.test(h.text.trim())).length;
  const n = existing + 1;
  const label = window.prompt('Section title:', 'Section') || 'Section';
  editor.chain().focus().insertContent(`<h${level}>${n}. ${esc(label)}</h${level}><p></p>`).run();
}

export interface DocStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  pages: number;
  readingMinutes: number;
  avgWordsPerSentence: number;
}

/** Compute live document statistics (feature 50). */
export function computeStats(editor: Editor): DocStats {
  const text = editor.state.doc.textContent;
  const words = (text.trim().match(/\S+/g) || []).length;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;
  const sentences = (text.match(/[.!?]+(\s|$)/g) || []).length;
  let paragraphs = 0;
  editor.state.doc.descendants((n) => { if (n.type.name === 'paragraph' && n.textContent.trim()) paragraphs++; });
  return {
    words,
    characters,
    charactersNoSpaces,
    sentences,
    paragraphs,
    pages: Math.max(1, Math.ceil(words / 500)),
    readingMinutes: Math.max(1, Math.round(words / 200)),
    avgWordsPerSentence: sentences > 0 ? Math.round((words / sentences) * 10) / 10 : 0,
  };
}

// ── Template save/load (features 48/49) — persisted in localStorage ──
const TPL_KEY = 'rmpg_writer_templates';

export interface SavedTemplate { name: string; html: string; savedAt: string }

export function listSavedTemplates(): SavedTemplate[] {
  try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch { return []; }
}

export function saveTemplate(name: string, html: string): void {
  const all = listSavedTemplates().filter((t) => t.name !== name);
  all.push({ name, html, savedAt: new Date().toISOString() });
  localStorage.setItem(TPL_KEY, JSON.stringify(all));
}

export function deleteTemplate(name: string): void {
  localStorage.setItem(TPL_KEY, JSON.stringify(listSavedTemplates().filter((t) => t.name !== name)));
}

// ── Wave-2 additions ──────────────────────────────────────────────────────

/** Build a Table of Contents from the document's headings and insert it at the
 *  current cursor position (companion to insertTableOfContents which forces top). */
export function insertTableOfContentsAtCursor(editor: Editor): void {
  const headings = collectHeadings(editor).filter((h) => h.text.trim());
  if (headings.length === 0) {
    window.alert('Add some headings (H1–H4) first — the table of contents is built from them.');
    return;
  }
  const rows = headings
    .map((h) => `<p style="margin:2px 0; padding-left:${(h.level - 1) * 18}px">${esc(h.text)}</p>`)
    .join('');
  const toc = `<h2>Table of Contents</h2>${rows}<hr>`;
  editor.chain().focus().insertContent(toc).run();
}

/** Insert a formatted signature block (line + name + date) at the cursor.
 *  `role` labels the signer (e.g. "Officer", "Witness"). */
export function insertSignatureLine(editor: Editor, role: string, name?: string): void {
  const block =
    `<table data-signature-block="1" style="width:100%;border:none;margin-top:40px;">` +
    `<tr>` +
    `<td style="width:60%;border-bottom:1px solid #333;padding-top:32px;">${name ? esc(name) : '&nbsp;'}</td>` +
    `<td style="width:10%;">&nbsp;</td>` +
    `<td style="width:30%;border-bottom:1px solid #333;padding-top:32px;">&nbsp;</td>` +
    `</tr>` +
    `<tr>` +
    `<td style="font-size:10px;color:#666;">${esc(role)} Signature</td>` +
    `<td>&nbsp;</td>` +
    `<td style="font-size:10px;color:#666;">Date</td>` +
    `</tr>` +
    `</table>`;
  editor.chain().focus().insertContent(block).run();
}

/** Insert a styled fillable blank ("[________]") at the cursor for forms. */
export function insertFillableField(editor: Editor, width = 120): void {
  editor.chain().focus().insertContent(
    `<span data-fillable="1" style="display:inline-block;min-width:${width}px;` +
    `border-bottom:1px solid #555;">&nbsp;</span>`,
  ).run();
}

/** Special characters grouped for the character-map picker. */
export const SPECIAL_CHARS: { group: string; chars: string[] }[] = [
  { group: 'Legal', chars: ['§', '¶', '©', '®', '™', '†', '‡', '№', '✓', '✗', '☐', '☑', '★'] },
  { group: 'Punctuation', chars: ['•', '–', '—', '…', '‹', '›', '«', '»', '“', '”', '‘', '’', '·'] },
  { group: 'Math / Units', chars: ['°', '±', '×', '÷', '½', '¼', '¾', '⅓', '≈', '≤', '≥', '≠', '′', '″'] },
  { group: 'Arrows', chars: ['→', '←', '↑', '↓', '↔', '⇒', '⇐', '⤷', '➤', '⌖'] },
  { group: 'Currency', chars: ['$', '¢', '£', '€', '¥'] },
];

/** Insert a single special character at the cursor. */
export function insertSpecialChar(editor: Editor, char: string): void {
  editor.chain().focus().insertContent(char).run();
}

/** Apply smart-quote / em-dash typography to the ENTIRE document, in place.
 *  Walks each text node so inline formatting and structure are preserved (no
 *  innerHTML round-trip). Returns the number of substitutions made. */
export function applySmartQuotes(editor: Editor): number {
  const { state, view } = editor;
  // Collect all text-node edits first, then apply them in REVERSE document order
  // so each replacement can't shift the positions of the ones still to come.
  const edits: { from: number; to: number; text: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const original = node.text;
    let s = original;
    // Double quotes: opening after whitespace/start/open-bracket, else closing.
    s = s.replace(/(^|[\s([{<])"/g, '$1“').replace(/"/g, '”');
    // Single quotes / apostrophes.
    s = s.replace(/(^|[\s([{<])'/g, '$1‘').replace(/'/g, '’');
    // Dashes + ellipsis.
    s = s.replace(/--/g, '—').replace(/\.\.\./g, '…');
    if (s !== original) edits.push({ from: pos, to: pos + original.length, text: s });
  });
  if (edits.length === 0) return 0;
  let tr = state.tr;
  for (const e of edits.reverse()) tr = tr.insertText(e.text, e.from, e.to);
  view.dispatch(tr);
  return edits.length;
}

/** Apply sequential outline numbering (1, 1.1, 1.1.1 …) to every heading in the
 *  document, in place, based on heading level. Strips any prior auto-number
 *  prefix first so it's idempotent. Returns headings numbered. */
export function applyOutlineNumbering(editor: Editor): number {
  const { state, view } = editor;
  const counters = [0, 0, 0, 0]; // h1..h4
  // Compute numbering FORWARD (counters depend on order), collect edits, apply
  // them in REVERSE so position math stays correct across length changes.
  const targets: { pos: number; level: number; text: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      targets.push({ pos, level: node.attrs.level as number, text: node.textContent });
    }
  });
  const edits: { from: number; to: number; text: string }[] = [];
  for (const t of targets) {
    const lvl = Math.min(Math.max(t.level, 1), 4);
    counters[lvl - 1] += 1;
    for (let i = lvl; i < 4; i++) counters[i] = 0;
    const prefix = counters.slice(0, lvl).join('.');
    // Strip an existing "1.2.3 " or "1. " auto-prefix so re-runs stay idempotent.
    const stripped = t.text.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, '');
    const start = t.pos + 1; // heading text starts one position after the node
    if (t.text.length > 0) edits.push({ from: start, to: start + t.text.length, text: `${prefix} ${stripped}` });
    else edits.push({ from: start, to: start, text: `${prefix} ` });
  }
  if (edits.length === 0) return 0;
  let tr = state.tr;
  for (const e of edits.reverse()) tr = tr.insertText(e.text, e.from, e.to);
  view.dispatch(tr);
  return edits.length;
}

/** Remove auto outline numbering prefixes from all headings. */
export function clearOutlineNumbering(editor: Editor): number {
  const { state, view } = editor;
  const edits: { from: number; to: number; text: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    const text = node.textContent;
    const stripped = text.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, '');
    if (stripped !== text) {
      const start = pos + 1;
      edits.push({ from: start, to: start + text.length, text: stripped });
    }
  });
  if (edits.length === 0) return 0;
  let tr = state.tr;
  for (const e of edits.reverse()) tr = tr.insertText(e.text, e.from, e.to);
  view.dispatch(tr);
  return edits.length;
}

// ── Word-goal persistence ──
const GOAL_KEY = 'rmpg_writer_word_goal';

export function getWordGoal(): number {
  const v = Number(localStorage.getItem(GOAL_KEY) || '0');
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function setWordGoal(goal: number): void {
  try {
    if (goal > 0) localStorage.setItem(GOAL_KEY, String(Math.round(goal)));
    else localStorage.removeItem(GOAL_KEY);
  } catch { /* noop */ }
}
