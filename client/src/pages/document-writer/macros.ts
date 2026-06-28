// Keyboard / formatting macro recorder for the Document Writer.
//
// Records a short sequence of formatting commands the user invokes, then
// replays them onto the current selection. Pure command names mapped to TipTap
// chains — no eval, no new deps. The last recorded macro is persisted to
// localStorage so it survives a reload.

import type { Editor } from '@tiptap/react';

export type MacroStep =
  | 'bold' | 'italic' | 'underline' | 'strike'
  | 'superscript' | 'subscript' | 'code'
  | 'highlight' | 'clearMarks'
  | 'h1' | 'h2' | 'h3' | 'paragraph'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify'
  | 'bulletList' | 'orderedList' | 'blockquote';

export interface MacroDef {
  steps: MacroStep[];
  savedAt: string;
}

const MACRO_KEY = 'rmpg_writer_macro';

/** Human labels for the macro step palette / chip display. */
export const MACRO_STEP_LABELS: Record<MacroStep, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough',
  superscript: 'Superscript', subscript: 'Subscript', code: 'Inline code',
  highlight: 'Highlight', clearMarks: 'Clear marks',
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', paragraph: 'Normal text',
  alignLeft: 'Align left', alignCenter: 'Center', alignRight: 'Align right', alignJustify: 'Justify',
  bulletList: 'Bullet list', orderedList: 'Numbered list', blockquote: 'Quote',
};

/** Apply a single macro step to the editor. */
export function runMacroStep(editor: Editor, step: MacroStep): void {
  const c = editor.chain().focus();
  switch (step) {
    case 'bold': c.toggleBold().run(); break;
    case 'italic': c.toggleItalic().run(); break;
    case 'underline': c.toggleUnderline().run(); break;
    case 'strike': c.toggleStrike().run(); break;
    case 'superscript': c.toggleSuperscript().run(); break;
    case 'subscript': c.toggleSubscript().run(); break;
    case 'code': c.toggleCode().run(); break;
    case 'highlight': c.toggleHighlight().run(); break;
    case 'clearMarks': c.unsetAllMarks().run(); break;
    case 'h1': c.toggleHeading({ level: 1 }).run(); break;
    case 'h2': c.toggleHeading({ level: 2 }).run(); break;
    case 'h3': c.toggleHeading({ level: 3 }).run(); break;
    case 'paragraph': c.setParagraph().run(); break;
    case 'alignLeft': c.setTextAlign('left').run(); break;
    case 'alignCenter': c.setTextAlign('center').run(); break;
    case 'alignRight': c.setTextAlign('right').run(); break;
    case 'alignJustify': c.setTextAlign('justify').run(); break;
    case 'bulletList': c.toggleBulletList().run(); break;
    case 'orderedList': c.toggleOrderedList().run(); break;
    case 'blockquote': c.toggleBlockquote().run(); break;
  }
}

/** Replay a whole macro (each step in order) onto the current selection. */
export function runMacro(editor: Editor, steps: MacroStep[]): void {
  for (const step of steps) runMacroStep(editor, step);
}

export function saveMacro(steps: MacroStep[]): void {
  if (steps.length === 0) { clearSavedMacro(); return; }
  try {
    localStorage.setItem(MACRO_KEY, JSON.stringify({ steps, savedAt: new Date().toISOString() } as MacroDef));
  } catch { /* quota */ }
}

export function loadMacro(): MacroDef | null {
  try {
    const raw = localStorage.getItem(MACRO_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as MacroDef;
    if (Array.isArray(data?.steps)) return data;
  } catch { /* noop */ }
  return null;
}

export function clearSavedMacro(): void {
  try { localStorage.removeItem(MACRO_KEY); } catch { /* noop */ }
}
