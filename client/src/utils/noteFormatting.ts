// Single source of truth for the lightweight markdown-marker grammar used by
// dispatch notes across THREE consumers: the editor (NoteComposer), the browser
// renderer (DispatchPage.renderFormattedText), and the PDF renderer
// (pdfGenerator.addFormattedText). Pure + dependency-free so it is unit-testable
// and cannot drift between consumers.

/** Spaces per nesting level. A line indented 2 spaces is depth 1, 4 spaces depth 2. */
export const INDENT_UNIT = 2;

// Inline emphasis. Order matters: the 2-char markers (**, ~~, __) precede the
// 1-char italic (*) so bold/strike/underline win and `*` never matches inside `**`.
// Capture groups: 1=whole, 2=bold, 3=strike, 4=underline, 5=italic.
export const INLINE_MARK_REGEX = /(\*\*(.+?)\*\*|~~(.+?)~~|__(.+?)__|\*(.+?)\*)/g;

export interface InlineToken {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

/** Split one line into styled runs. Always returns at least one token. */
export function tokenizeInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = new RegExp(INLINE_MARK_REGEX.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    if (m[2] !== undefined) tokens.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) tokens.push({ text: m[3], strike: true });
    else if (m[4] !== undefined) tokens.push({ text: m[4], underline: true });
    else if (m[5] !== undefined) tokens.push({ text: m[5], italic: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  return tokens.length ? tokens : [{ text: line }];
}

export type LineKind = 'bullet' | 'ordered' | 'plain';

export interface ClassifiedLine {
  kind: LineKind;
  depth: number;
  content: string; // list-marker prefix stripped; inline markers preserved
}

const BULLET_RE = /^(\s*)-\s+(.*)$/;
const ORDERED_RE = /^(\s*)\d+\.\s+(.*)$/;

/** Classify a single hard line as a bullet, ordered item, or plain text. */
export function classifyLine(line: string): ClassifiedLine {
  let m = line.match(ORDERED_RE);
  if (m) return { kind: 'ordered', depth: Math.floor(m[1].length / INDENT_UNIT), content: m[2] };
  m = line.match(BULLET_RE);
  if (m) return { kind: 'bullet', depth: Math.floor(m[1].length / INDENT_UNIT), content: m[2] };
  const lead = (line.match(/^(\s*)/)?.[1].length) ?? 0;
  return { kind: 'plain', depth: Math.floor(lead / INDENT_UNIT), content: line.replace(/^\s+/, '') };
}

export interface RenderLine {
  kind: LineKind;
  depth: number;
  marker: string; // '•' for bullet, '1.1' for ordered, '' for plain
  content: string;
}

/**
 * Classify every line of `text` and compute outline numbers for ordered items.
 * Numbering is a dotted chain by depth (1, 1.1, 1.1.1). The counter stack resets
 * on a top-level (depth-0) plain line — which is also how dispatch notes are
 * joined for the PDF ("[ts] author: ..."), so numbering never bleeds across notes.
 */
export function computeListLines(text: string): RenderLine[] {
  const out: RenderLine[] = [];
  const counters: number[] = [];
  for (const raw of (text ?? '').split('\n')) {
    const { kind, depth, content } = classifyLine(raw);
    if (kind === 'ordered') {
      counters.length = depth + 1;
      counters[depth] = (counters[depth] ?? 0) + 1;
      const marker = counters.slice(0, depth + 1).filter((v) => v > 0).join('.');
      out.push({ kind, depth, marker, content });
    } else if (kind === 'bullet') {
      out.push({ kind, depth, marker: '•', content });
    } else {
      if (depth === 0) counters.length = 0;
      out.push({ kind, depth, marker: '', content });
    }
  }
  return out;
}

/**
 * Remove residual/unmatched emphasis markers from a PLAIN text run (a run that
 * the formatter has already determined carries no matched pair). Mirrors the
 * serve-intake "safety net" strips, but applied per-segment so matched pairs
 * elsewhere on the line survive.
 */
export function stripStrayMarkers(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/~~/g, '')
    .replace(/__/g, '')
    .replace(/\*(?=\w)/g, '')
    .replace(/(?<=\w)\*/g, '');
}
