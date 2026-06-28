// Final-wave Document Writer feature helpers. Pure functions over a TipTap
// editor + small Web-platform utilities — no new npm deps. Kept separate from
// the React components so they stay independently testable.
//
// Covers: auto-numbered figure/table/exhibit captions, vertical spacer blocks,
// page-setup presets, export-of-selection-only, and clear-document.

import type { Editor } from '@tiptap/react';
import { DOMSerializer } from '@tiptap/pm/model';
import type { DocSettings, PageSize } from './types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // escape quotes too — output is used inside HTML attributes

// ── Auto-numbered captions (Figure 1, Table 2, Exhibit A…) ──────────────────

export type CaptionKind = 'Figure' | 'Table' | 'Exhibit';

/** Scan the document for existing captions of a kind and return the next number
 *  to use. Figures/Tables use 1,2,3…; Exhibits use A,B,C… (letters). */
export function nextCaptionLabel(editor: Editor, kind: CaptionKind): string {
  const text = editor.getText();
  if (kind === 'Exhibit') {
    let max = 0;
    for (const m of text.matchAll(/\bExhibit\s+([A-Z])\b/g)) {
      max = Math.max(max, m[1].charCodeAt(0) - 64); // A=1
    }
    const next = Math.min(max + 1, 26);
    return String.fromCharCode(64 + next);
  }
  const re = new RegExp(`\\b${kind}\\s+(\\d+)\\b`, 'g');
  let max = 0;
  for (const m of text.matchAll(re)) max = Math.max(max, parseInt(m[1], 10) || 0);
  return String(max + 1);
}

/** Insert an auto-numbered caption paragraph at the cursor. The number is
 *  derived by scanning existing captions so it stays sequential. */
export function insertNumberedCaption(editor: Editor, kind: CaptionKind, text: string): string {
  const label = nextCaptionLabel(editor, kind);
  const body = text.trim();
  const html =
    `<p class="doc-caption" data-caption-kind="${kind.toLowerCase()}">` +
    `<strong>${kind} ${esc(label)}.</strong>${body ? ` ${esc(body)}` : ''}</p>`;
  editor.chain().focus().insertContent(html).run();
  return label;
}

// ── Vertical spacer block ───────────────────────────────────────────────────

/** Insert a fixed-height empty spacer block (real vertical whitespace that
 *  survives export, distinct from blank paragraphs that collapse). */
export function insertSpacer(editor: Editor, px: number): void {
  const h = Math.max(2, Math.min(600, Math.round(px)));
  editor
    .chain()
    .focus()
    .insertContent(`<div class="doc-spacer" style="height:${h}px" data-spacer="${h}">&nbsp;</div><p></p>`)
    .run();
}

// ── Page-setup presets ──────────────────────────────────────────────────────

export interface PagePreset {
  id: string;
  label: string;
  size: PageSize;
  orientation: 'portrait' | 'landscape';
}

/** One-click page geometry presets that drive DocSettings.page. */
export const PAGE_PRESETS: PagePreset[] = [
  { id: 'letter-p', label: 'Letter — Portrait', size: 'letter', orientation: 'portrait' },
  { id: 'letter-l', label: 'Letter — Landscape', size: 'letter', orientation: 'landscape' },
  { id: 'legal-p', label: 'Legal — Portrait', size: 'legal', orientation: 'portrait' },
  { id: 'legal-l', label: 'Legal — Landscape', size: 'legal', orientation: 'landscape' },
  { id: 'a4-p', label: 'A4 — Portrait', size: 'a4', orientation: 'portrait' },
  { id: 'a4-l', label: 'A4 — Landscape', size: 'a4', orientation: 'landscape' },
];

/** Apply a preset to a DocSettings object (returns the next settings). */
export function applyPagePreset(settings: DocSettings, preset: PagePreset): DocSettings {
  return { ...settings, page: { ...settings.page, size: preset.size, orientation: preset.orientation } };
}

/** True if the given preset matches the current page geometry. */
export function isActivePreset(settings: DocSettings, preset: PagePreset): boolean {
  return settings.page.size === preset.size && settings.page.orientation === preset.orientation;
}

// ── Margin presets ───────────────────────────────────────────────────────────
// Margins are stored in CSS px at 96dpi (1in = 96px), matching PageSetup.margins
// and the print @page rule. Values below are inches × 96. "Custom" carries no
// margins object — selecting it leaves the current numbers untouched so the
// per-side inputs act as the manual editor.

export interface MarginPreset {
  id: 'narrow' | 'standard' | 'legal' | 'formal' | 'custom';
  label: string;
  /** Margins in px @96dpi; omitted for "custom" (keep current values). */
  margins?: { top: number; right: number; bottom: number; left: number };
}

const IN = 96; // px per inch at 96dpi

export const MARGIN_PRESETS: MarginPreset[] = [
  { id: 'narrow', label: 'Narrow', margins: { top: 0.5 * IN, right: 0.5 * IN, bottom: 0.5 * IN, left: 0.5 * IN } },
  { id: 'standard', label: 'Standard', margins: { top: 1 * IN, right: 1 * IN, bottom: 1 * IN, left: 1 * IN } },
  // Legal filings/pleadings: 1in top/bottom/right, wider 1.5in binding edge.
  { id: 'legal', label: 'Legal', margins: { top: 1 * IN, right: 1 * IN, bottom: 1 * IN, left: 1.5 * IN } },
  // Formal letterhead: deeper 1.5in top to clear the masthead, 1.25in sides.
  { id: 'formal', label: 'Formal', margins: { top: 1.5 * IN, right: 1.25 * IN, bottom: 1 * IN, left: 1.25 * IN } },
  { id: 'custom', label: 'Custom' },
];

/** Apply a margin preset (no-op for "custom"). Returns next settings. */
export function applyMarginPreset(settings: DocSettings, preset: MarginPreset): DocSettings {
  if (!preset.margins) return settings;
  return { ...settings, page: { ...settings.page, margins: { ...preset.margins } } };
}

/** Id of the preset matching the current margins, or 'custom' if none match. */
export function activeMarginPresetId(settings: DocSettings): MarginPreset['id'] {
  const m = settings.page.margins;
  const hit = MARGIN_PRESETS.find(
    (p) => p.margins &&
      p.margins.top === m.top && p.margins.right === m.right &&
      p.margins.bottom === m.bottom && p.margins.left === m.left,
  );
  return hit ? hit.id : 'custom';
}

// ── Document format presets (LE/court named bundles) ───────────────────────
// Each preset bundles page geometry + margins + document flags into a single
// named archetype. Applying a preset overwrites only the fields it specifies.

export interface DocumentFormatPreset {
  id: string;
  label: string;
  description: string;
  page: { size: PageSize; orientation: 'portrait' | 'landscape' };
  margins: { top: number; right: number; bottom: number; left: number };
  letterhead?: boolean;
  lineNumbers?: boolean;
  footer?: { enabled: boolean; text: string; showDate: boolean; showAuthor: boolean };
}

export const DOCUMENT_FORMAT_PRESETS: DocumentFormatPreset[] = [
  {
    id: 'le-field-report',
    label: 'LE Field Report',
    description: 'Standard narrative report — letter, 0.75in margins, no letterhead, line numbers for review',
    page: { size: 'letter', orientation: 'portrait' },
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    letterhead: false,
    lineNumbers: true,
  },
  {
    id: 'court-filing',
    label: 'Court Filing',
    description: 'Legal-size paper, 1.5in left binding margin, double-spaced — standard pleading format',
    page: { size: 'legal', orientation: 'portrait' },
    margins: { top: 96, right: 96, bottom: 96, left: 144 },
    letterhead: false,
    lineNumbers: true,
  },
  {
    id: 'warrant-affidavit',
    label: 'Warrant / Affidavit',
    description: 'Letter paper, formal 1.5in top margin for judicial signature block, line numbers',
    page: { size: 'letter', orientation: 'portrait' },
    margins: { top: 144, right: 96, bottom: 96, left: 96 },
    letterhead: false,
    lineNumbers: true,
  },
  {
    id: 'evidence-report',
    label: 'Evidence Report',
    description: 'Letter, standard 1in margins, agency letterhead, officer/date footer',
    page: { size: 'letter', orientation: 'portrait' },
    margins: { top: 96, right: 96, bottom: 96, left: 96 },
    letterhead: true,
    lineNumbers: false,
    footer: { enabled: true, text: 'EVIDENCE REPORT — RMPG', showDate: true, showAuthor: true },
  },
  {
    id: 'official-memo',
    label: 'Official Memo / Letter',
    description: 'Letter, formal 1.5in top for letterhead masthead, 1.25in sides, agency header',
    page: { size: 'letter', orientation: 'portrait' },
    margins: { top: 144, right: 120, bottom: 96, left: 120 },
    letterhead: true,
    lineNumbers: false,
  },
];

/** Deep-merge a document format preset into the current DocSettings. Only the
 *  fields declared in the preset are overwritten; everything else stays intact. */
export function applyDocumentFormatPreset(settings: DocSettings, preset: DocumentFormatPreset): DocSettings {
  const next = { ...settings, page: { ...settings.page } };
  next.page.size = preset.page.size;
  next.page.orientation = preset.page.orientation;
  next.page.margins = { ...preset.margins };
  if (preset.letterhead !== undefined) next.letterhead = preset.letterhead;
  if (preset.lineNumbers !== undefined) next.lineNumbers = preset.lineNumbers;
  if (preset.footer !== undefined) next.footer = { ...preset.footer };
  return next;
}

// ── Export selection only ───────────────────────────────────────────────────

/** The current selection as plain text + an HTML fragment, or null if nothing
 *  is selected. Used for "export / copy selection only". Serializes via the
 *  editor schema's DOMSerializer for faithful HTML. */
export function getSelectionExport(editor: Editor): { text: string; html: string } | null {
  const { from, to, empty } = editor.state.selection;
  if (empty || from === to) return null;
  const text = editor.state.doc.textBetween(from, to, '\n').trim();
  if (!text) return null;
  let html = '';
  try {
    const slice = editor.state.selection.content();
    const serializer = DOMSerializer.fromSchema(editor.schema);
    const domFragment = serializer.serializeFragment(slice.content);
    const container = document.createElement('div');
    container.appendChild(domFragment);
    html = container.innerHTML;
  } catch {
    html = '';
  }
  if (!html) html = text.split('\n').map((l) => `<p>${esc(l)}</p>`).join('');
  return { text, html };
}

// ── Outline section move (drag-reorder headings + their content) ────────────

export interface OutlineSection {
  index: number;
  level: number;
  text: string;
  /** Doc position of the heading node. */
  from: number;
  /** Doc position where this section ends (start of the next same-or-higher
   *  heading, or end of doc). */
  to: number;
}

/** Build the list of top-level (by relative depth) outline sections. Each
 *  section spans from its heading to the next heading of the same-or-higher
 *  level, so moving it carries its sub-content along. */
export function collectSections(editor: Editor): OutlineSection[] {
  const heads: { level: number; text: string; from: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      heads.push({ level: node.attrs.level as number, text: node.textContent, from: pos });
    }
    return true;
  });
  const docEnd = editor.state.doc.content.size;
  return heads.map((h, i) => {
    // Section ends at the next heading whose level is <= this heading's level.
    let to = docEnd;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { to = heads[j].from; break; }
    }
    return { index: i, level: h.level, text: h.text, from: h.from, to };
  });
}

/** Move the section at `index` up or down by swapping it with its adjacent
 *  sibling section. Returns true on success. Operates on serialized HTML of the
 *  two ranges to keep ProseMirror positions valid. */
export function moveSection(editor: Editor, index: number, dir: 'up' | 'down'): boolean {
  const sections = collectSections(editor);
  if (sections.length < 2) return false;
  const a = sections[index];
  const bIndex = dir === 'up' ? index - 1 : index + 1;
  if (!a || bIndex < 0 || bIndex >= sections.length) return false;
  const b = sections[bIndex];

  const serializer = DOMSerializer.fromSchema(editor.schema);
  const htmlOf = (from: number, to: number): string => {
    const slice = editor.state.doc.slice(from, to);
    const frag = serializer.serializeFragment(slice.content);
    const div = document.createElement('div');
    div.appendChild(frag);
    return div.innerHTML;
  };

  // Determine the earlier (first) and later (second) range in document order.
  const first = a.from < b.from ? a : b;
  const second = a.from < b.from ? b : a;
  const firstHtml = htmlOf(first.from, first.to);
  const secondHtml = htmlOf(second.from, second.to);

  // Replace the whole [first.from, second.to] span with second+first swapped.
  const combined = secondHtml + firstHtml;
  editor.chain().focus().insertContentAt({ from: first.from, to: second.to }, combined).run();
  return true;
}

// ── Clear document ──────────────────────────────────────────────────────────

/** Replace the whole document with a single empty paragraph (a fresh blank).
 *  The caller is responsible for any confirmation prompt. */
export function clearDocument(editor: Editor): void {
  editor.chain().focus().setContent('<p></p>').run();
}
