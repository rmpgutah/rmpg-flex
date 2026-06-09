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
