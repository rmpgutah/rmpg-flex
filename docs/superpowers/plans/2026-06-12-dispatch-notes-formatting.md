# Dispatch Notes Formatting — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the PDF print bug that drops bold/italic/underline from dispatch notes, add strikeout + bullet + outline-numbered lists end-to-end, and make saved notes re-editable by their author with a shared formatting editor.

**Architecture:** A single pure grammar module (`noteFormatting.ts`) is the source of truth for the lightweight markdown-marker syntax. The PDF renderer (`pdfGenerator.ts`) and the browser renderer (`DispatchPage.tsx`) both consume it. The print bug is an order-of-operations fix: `sanitizePdfText` is taught a `preserveMarkers` mode so it stops stripping the very markers the formatter needs. Re-editable notes reuse a new `NoteComposer` component and a Worker change that stamps `author_username` and relaxes the edit gate to author-or-admin.

**Tech Stack:** TypeScript, React 18, Vite, vitest, jsPDF, Hono (Cloudflare Worker), Cloudflare D1.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `client/src/utils/noteFormatting.ts` | **New.** Pure grammar: inline tokenizer, line classifier, outline numbering, stray-marker stripper. |
| `client/src/utils/noteFormatting.test.ts` | **New.** Vitest unit tests for the module. |
| `client/src/utils/pdfGenerator.ts` | Fix `sanitizePdfText` ordering; rewrite `addFormattedText` for strike + lists; fix `addNarrativeSection` double-sanitize. |
| `client/src/pages/dispatch/components/NoteComposer.tsx` | **New.** Toolbar (B/I/U/S/•/1.) + textarea + Tab/Enter/shortcut behaviors. Reused by add + edit. |
| `client/src/pages/dispatch/DispatchPage.tsx` | Block-aware `renderFormattedText`; swap add + edit boxes to `NoteComposer`; author-edit gate. |
| `src/routes/dispatch/extensions.ts` | Stamp `author_username` on note create; relax `PUT /:id/notes/:noteId` to author-or-admin. |
| `client/public/sw.js` | Bump `CACHE_NAME` v913 → v914. |

**Verification commands (used throughout):**
- Worker typecheck: `npm run typecheck`
- Client typecheck: `cd client && npx tsc --noEmit`
- Client unit tests: `cd client && npx vitest run src/utils/noteFormatting.test.ts`
- Full client tests: `cd client && npx vitest run`
- Client build: `cd client && npx vite build`

---

## Task 1: Shared grammar module `noteFormatting.ts` (TDD)

**Files:**
- Create: `client/src/utils/noteFormatting.ts`
- Test: `client/src/utils/noteFormatting.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `client/src/utils/noteFormatting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  tokenizeInline,
  classifyLine,
  computeListLines,
  stripStrayMarkers,
  INDENT_UNIT,
} from './noteFormatting';

describe('tokenizeInline', () => {
  it('returns a single plain token for unmarked text', () => {
    expect(tokenizeInline('hello world')).toEqual([{ text: 'hello world' }]);
  });
  it('parses bold, italic, underline, strike', () => {
    expect(tokenizeInline('**b**')).toEqual([{ text: 'b', bold: true }]);
    expect(tokenizeInline('*i*')).toEqual([{ text: 'i', italic: true }]);
    expect(tokenizeInline('__u__')).toEqual([{ text: 'u', underline: true }]);
    expect(tokenizeInline('~~s~~')).toEqual([{ text: 's', strike: true }]);
  });
  it('keeps plain text around marks', () => {
    expect(tokenizeInline('a **b** c')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' c' },
    ]);
  });
  it('does not treat ** as italic *', () => {
    expect(tokenizeInline('**x**')).toEqual([{ text: 'x', bold: true }]);
  });
});

describe('classifyLine', () => {
  it('detects bullets by leading dash', () => {
    expect(classifyLine('- item')).toMatchObject({ kind: 'bullet', depth: 0, content: 'item' });
  });
  it('detects ordered items by N.', () => {
    expect(classifyLine('1. item')).toMatchObject({ kind: 'ordered', depth: 0, content: 'item' });
  });
  it('computes depth from indentation (2 spaces per level)', () => {
    expect(classifyLine('    - deep')).toMatchObject({ kind: 'bullet', depth: 2, content: 'deep' });
  });
  it('classifies non-list text as plain', () => {
    expect(classifyLine('just text')).toMatchObject({ kind: 'plain', depth: 0 });
  });
  it('exposes INDENT_UNIT as 2', () => {
    expect(INDENT_UNIT).toBe(2);
  });
});

describe('computeListLines outline numbering', () => {
  it('numbers nested ordered items as a dotted chain', () => {
    const text = ['1. a', '  1. b', '    1. c', '  1. d', '1. e'].join('\n');
    const markers = computeListLines(text).map((l) => l.marker);
    expect(markers).toEqual(['1', '1.1', '1.1.1', '1.2', '2']);
  });
  it('renders bullets with a dot marker and leaves ordered counters intact', () => {
    const text = ['1. a', '  - note', '1. b'].join('\n');
    const lines = computeListLines(text);
    expect(lines.map((l) => l.marker)).toEqual(['1', '•', '2']);
  });
  it('resets numbering after a top-level plain line', () => {
    const text = ['1. a', 'plain break', '1. b'].join('\n');
    expect(computeListLines(text).map((l) => l.marker)).toEqual(['1', '', '1']);
  });
});

describe('stripStrayMarkers', () => {
  it('removes unmatched emphasis markers', () => {
    expect(stripStrayMarkers('**oops and __x')).toBe('oops and x');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd client && npx vitest run src/utils/noteFormatting.test.ts`
Expected: FAIL — `Failed to resolve import "./noteFormatting"`.

- [ ] **Step 3: Implement the module**

Create `client/src/utils/noteFormatting.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd client && npx vitest run src/utils/noteFormatting.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/noteFormatting.ts client/src/utils/noteFormatting.test.ts
git commit -m "feat(notes): shared note-formatting grammar module + tests"
```

---

## Task 2: Fix the print bug — `sanitizePdfText` preserveMarkers + `addNarrativeSection`

**Files:**
- Modify: `client/src/utils/pdfGenerator.ts` (`sanitizePdfText` ~lines 245-347; `addNarrativeSection` sanitize call ~line 1833)
- Test: `client/src/utils/pdfGenerator.sanitize.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/pdfGenerator.sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sanitizePdfText } from './pdfGenerator';

describe('sanitizePdfText', () => {
  it('strips emphasis markers by default (legacy callers unchanged)', () => {
    expect(sanitizePdfText('**bold** text')).toBe('BOLD TEXT');
  });
  it('preserves matched emphasis markers when preserveMarkers is set', () => {
    expect(sanitizePdfText('**bold**', { preserveMarkers: true })).toBe('**BOLD**');
    expect(sanitizePdfText('~~s~~', { preserveMarkers: true })).toBe('~~S~~');
  });
  it('still decodes entities and uppercases in preserveMarkers mode', () => {
    expect(sanitizePdfText('a &amp; **b**', { preserveMarkers: true })).toBe('A & **B**');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && npx vitest run src/utils/pdfGenerator.sanitize.test.ts`
Expected: FAIL — `sanitizePdfText` rejects the 2nd arg / strips markers in preserve mode.

> If this step errors on *import* (jsPDF failing to load under jsdom): the existing 272-test suite imports client utils freely, so import should succeed. If it genuinely cannot, delete this test file and rely on Task 3's visual PDF verification instead — do not block.

- [ ] **Step 3: Add `preserveMarkers` by restructuring `sanitizePdfText` (minimal, do NOT retype the Unicode chain)**

The current function is a single `return text.replace(...).replace(...)…toUpperCase();` chain. Make exactly these changes; leave every `\uXXXX` Unicode-normalization `.replace(...)` line **byte-for-byte as it already exists** in the file:

(a) Change the signature:
```ts
export function sanitizePdfText(text: string): string {
```
to:
```ts
export function sanitizePdfText(text: string, opts: { preserveMarkers?: boolean } = {}): string {
```

(b) The chain starts `return text` then the multi-line HTML-entity `.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (_m, ent) => { … })`. Change the chain start so the entity-decode result lands in a local:
```ts
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (_m, ent) => {
```
becomes:
```ts
  let s = text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (_m, ent) => {
```
(only `return text` → `let s = text`; the entity-decode body is unchanged.)

(c) Immediately after the entity-decode `.replace(...)` closes (the `})` line) and BEFORE the first marker strip `.replace(/\*\*/g, '')`, terminate that statement and open the conditional. The current five marker-strip lines (with their interleaved comments) are:
```ts
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/_\((.*?)\)_/g, '($1)')
    .replace(/\*(?=\w)/g, '')
    .replace(/(?<=\w)\*/g, '')
```
Wrap exactly those five into a guard, turning the `}) .replace(/\*\*/g, '')…` seam into:
```ts
    });
  // Marker stripping is the serve-intake "unmatched marker" safety net. It is
  // destructive to matched pairs, so skip it when the caller will render markup
  // downstream (addFormattedText); stray markers are removed per plain-segment
  // via stripStrayMarkers instead.
  if (!opts.preserveMarkers) {
    s = s
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .replace(/_\((.*?)\)_/g, '($1)')
      .replace(/\*(?=\w)/g, '')
      .replace(/(?<=\w)\*/g, '');
  }
  s = s
    .replace(/\bSTATEDON\b/g, 'STATED ON')
```
i.e. the chain that previously flowed `… (?<=\w)\* ''` → `.replace(/\bSTATEDON\b/…)` now resumes as a new `s = s.replace(/\bSTATEDON\b/…)` statement. Everything from `\bSTATEDON\b` through the final `.toUpperCase()` stays on the `s = s.…` chain unchanged.

(d) The chain ends `.toUpperCase();`. Add a return on the next line:
```ts
    .toUpperCase();
  return s;
}
```

Net effect: identical output for existing callers (`preserveMarkers` defaults false); when `{ preserveMarkers: true }`, the five marker strips are skipped and `**`/`__`/`*`/`~~` survive.

- [ ] **Step 4: Fix `addNarrativeSection`'s pre-sanitize**

In `addNarrativeSection` (~line 1833) change:
```ts
  const text = sanitizePdfText(rawText);
```
to:
```ts
  const text = sanitizePdfText(rawText, { preserveMarkers: true });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd client && npx vitest run src/utils/pdfGenerator.sanitize.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
cd client && npx tsc --noEmit && cd ..
git add client/src/utils/pdfGenerator.ts client/src/utils/pdfGenerator.sanitize.test.ts
git commit -m "fix(pdf): stop sanitizePdfText from stripping markers before the formatter (preserveMarkers)"
```

---

## Task 3: Rewrite `addFormattedText` for strike + bullet/outline lists

**Files:**
- Modify: `client/src/utils/pdfGenerator.ts` (`addFormattedText` ~lines 1689-1818; add import at top)

This task replaces the whole `addFormattedText` function body (safest — no anchor drift) and adds bullets/outline lists + strikeout. The numbering logic itself is already tested in Task 1 (`computeListLines`); here it is consumed.

- [ ] **Step 1: Add the import**

Near the other imports at the top of `client/src/utils/pdfGenerator.ts`, add:
```ts
import { classifyLine, stripStrayMarkers } from './noteFormatting';
```

- [ ] **Step 2: Replace the `addFormattedText` function**

Replace the entire existing `export function addFormattedText(...) { ... }` (the doc comment above it may stay) with:

```ts
export function addFormattedText(doc: jsPDF, rawText: string, x: number, y: number, maxWidth: number, fontSize: number = FONT.SIZE_FIELD_VALUE, onPageBreak?: (newY: number) => number): number {
  if (!rawText) return y;
  const text = sanitizePdfText(rawText, { preserveMarkers: true });
  const lineH = getPdfTextLineHeight(fontSize, true);
  const paragraphGap = SPACING.MD;
  const safeMaxWidth = maxWidth - 2; // 2mm safety margin against right-edge clipping
  const INDENT_MM = 5;   // horizontal indent per nesting level
  const GUTTER_MM = 5;   // minimum space reserved for the bullet/number marker
  const BULLET_R = 0.5;  // filled-circle bullet radius (mm)

  // Word-based wrap — jsPDF splitTextToSize breaks mid-word with Courier.
  const wordWrap = (str: string, maxW: number): string[] => {
    const words = str.split(/(\s+)/);
    const result: string[] = [];
    let currentLine = '';
    for (const word of words) {
      if (!word) continue;
      const testLine = currentLine + word;
      const testWidth = doc.getTextWidth(testLine.trimEnd());
      if (testWidth > maxW && currentLine.trim().length > 0) {
        result.push(currentLine.trimEnd());
        currentLine = word.trimStart();
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.trim()) result.push(currentLine.trimEnd());
    return result.length > 0 ? result : [str];
  };

  let lastPage = doc.getNumberOfPages();
  const stripMarkers = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, '$1')
     .replace(/~~(.+?)~~/g, '$1')
     .replace(/__(.+?)__/g, '$1')
     .replace(/\*(.+?)\*/g, '$1');

  // Outline numbering state, persisted across the whole block. Reset by a
  // depth-0 plain line (also how notes are joined), so numbering never bleeds.
  const counters: number[] = [];
  const orderedMarker = (depth: number): string => {
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    return counters.slice(0, depth + 1).filter((v) => v > 0).join('.');
  };

  const paragraphs = text.split(/\n\n+/);
  for (let p = 0; p < paragraphs.length; p++) {
    if (p > 0) y += paragraphGap;
    if (!paragraphs[p].trim()) continue;

    const hardLines = paragraphs[p].split(/\n/);
    for (let hlIdx = 0; hlIdx < hardLines.length; hlIdx++) {
      const hardLine = hardLines[hlIdx];
      if (!hardLine.trim()) continue;

      // Classify for list rendering. content keeps inline markers intact.
      const cl = classifyLine(hardLine);
      let marker = '';
      if (cl.kind === 'ordered') marker = orderedMarker(cl.depth);
      else if (cl.kind === 'bullet') marker = '•';
      else if (cl.depth === 0) counters.length = 0; // top-level plain -> reset

      const isList = cl.kind === 'ordered' || cl.kind === 'bullet';
      const lineText = isList ? cl.content : hardLine;
      const indentMm = isList ? cl.depth * INDENT_MM : 0;

      // Reserve gutter wide enough for the number string (deep chains widen).
      doc.setFont(PDF_VALUE_FONT, 'normal'); doc.setFontSize(fontSize);
      const gutterMm = !isList ? 0
        : cl.kind === 'ordered' ? Math.max(GUTTER_MM, doc.getTextWidth(`${marker}.`) + 1.5)
        : GUTTER_MM;
      const contentX = x + indentMm + gutterMm;
      const availWidth = safeMaxWidth - indentMm - gutterMm;

      const hasBold = /\*\*/.test(lineText);
      doc.setFont(PDF_VALUE_FONT, hasBold ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      const stripped = stripMarkers(lineText);
      const wrappedLines = wordWrap(stripped, availWidth);
      doc.setFont(PDF_VALUE_FONT, 'normal');

      let charIdx = 0;
      for (let wli = 0; wli < wrappedLines.length; wli++) {
        const wrappedLine = wrappedLines[wli];
        y = checkPageBreak(doc, y, lineH + SPACING.SM);
        const curPage = doc.getNumberOfPages();
        if (curPage !== lastPage) { lastPage = curPage; if (onPageBreak) y = onPageBreak(y); }

        // Draw the list marker on the first wrapped line only.
        if (isList && wli === 0) {
          doc.setFont(PDF_VALUE_FONT, 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
          if (cl.kind === 'bullet') {
            doc.setFillColor(...COLOR.TEXT_PRIMARY);
            doc.circle(x + indentMm + 1.2, y - lineH * 0.28, BULLET_R, 'F');
          } else {
            doc.text(`${marker}.`, x + indentMm, y);
          }
        }

        // Map the stripped wrapped line back onto the marker-laden source so we
        // know which slice of lineText this visual line covers.
        const lineLen = wrappedLine.length;
        while (charIdx < lineText.length && lineText[charIdx] === ' ' && wli > 0) charIdx++;
        const segStart = charIdx;
        let visibleCount = 0;
        let i = charIdx;
        while (visibleCount < lineLen && i < lineText.length) {
          if (lineText.slice(i, i + 2) === '**') { const e = lineText.indexOf('**', i + 2); if (e !== -1) { visibleCount += e - i - 2; i = e + 2; continue; } }
          if (lineText.slice(i, i + 2) === '~~') { const e = lineText.indexOf('~~', i + 2); if (e !== -1) { visibleCount += e - i - 2; i = e + 2; continue; } }
          if (lineText.slice(i, i + 2) === '__') { const e = lineText.indexOf('__', i + 2); if (e !== -1) { visibleCount += e - i - 2; i = e + 2; continue; } }
          if (lineText[i] === '*' && (i + 1 >= lineText.length || lineText[i + 1] !== '*')) {
            const e = lineText.indexOf('*', i + 1);
            if (e !== -1 && (e + 1 >= lineText.length || lineText[e + 1] !== '*')) { visibleCount += e - i - 1; i = e + 1; continue; }
          }
          visibleCount++; i++;
        }
        const lineSeg = lineText.slice(segStart, i);
        charIdx = i;

        // Render the slice with inline formatting.
        let cursorX = contentX;
        const segRegex = /(\*\*(.+?)\*\*|~~(.+?)~~|__(.+?)__|\*(.+?)\*)/g;
        let lastIdx = 0;
        let segMatch: RegExpExecArray | null;
        while ((segMatch = segRegex.exec(lineSeg)) !== null) {
          if (segMatch.index > lastIdx) {
            const plain = stripStrayMarkers(lineSeg.slice(lastIdx, segMatch.index));
            doc.setFont(PDF_VALUE_FONT, 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(plain, cursorX, y); cursorX += doc.getTextWidth(plain);
          }
          if (segMatch[2] !== undefined) {            // BOLD
            doc.setFont(PDF_VALUE_FONT, 'bold'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[2], cursorX, y); cursorX += doc.getTextWidth(segMatch[2]);
          } else if (segMatch[3] !== undefined) {     // STRIKE
            doc.setFont(PDF_VALUE_FONT, 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[3], cursorX, y);
            const tw = doc.getTextWidth(segMatch[3]);
            doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(0.2);
            doc.line(cursorX, y - lineH * 0.28, cursorX + tw, y - lineH * 0.28);
            cursorX += tw;
          } else if (segMatch[4] !== undefined) {     // UNDERLINE
            doc.setFont(PDF_VALUE_FONT, 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[4], cursorX, y);
            const tw = doc.getTextWidth(segMatch[4]);
            doc.setDrawColor(...COLOR.TEXT_PRIMARY); doc.setLineWidth(0.2);
            doc.line(cursorX, y + 0.8, cursorX + tw, y + 0.8);
            cursorX += tw;
          } else if (segMatch[5] !== undefined) {     // ITALIC (existing bolditalic look)
            doc.setFont(PDF_VALUE_FONT, 'bolditalic'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
            doc.text(segMatch[5], cursorX, y); cursorX += doc.getTextWidth(segMatch[5]);
          }
          lastIdx = segMatch.index + segMatch[0].length;
        }
        if (lastIdx < lineSeg.length) {
          const plain = stripStrayMarkers(lineSeg.slice(lastIdx));
          doc.setFont(PDF_VALUE_FONT, 'normal'); doc.setFontSize(fontSize); doc.setTextColor(...COLOR.TEXT_PRIMARY);
          doc.text(plain, cursorX, y);
        }
        y += lineH;
      }
      while (charIdx < lineText.length && lineText[charIdx] === ' ') charIdx++;
    }
  }
  doc.setFont(PDF_VALUE_FONT, 'normal');
  return y;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If TS flags an unused symbol, ensure no stray references to the old locals (`isLastLine`, `hasMarkers`) remain — they are intentionally gone.

- [ ] **Step 4: Visual verification (PDF)**

The jsPDF draw path is not unit-testable in jsdom (documented canvas limit). Verify by generating a real PDF:
1. `cd client && npx vite build` (must succeed).
2. In a browser logged into the app, open a call, add a note containing every feature:
   ```
   **BOLD** *italic* __underline__ ~~strike~~
   1. first
     1. nested
       1. deep
     1. second nested
   - bullet a
   - bullet b
   ```
   Generate the call/incident PDF (the "Build call notes from dispatch notes" path in IncidentsPage). Confirm: bold/italic/underline render, strikeout shows a line through the text, bullets show filled dots, ordered items show 1 / 1.1 / 1.1.1 / 1.2, indentation steps right by level.
3. Spot-check one existing narrative report (an incident with `**` in its narrative) to confirm the regression fix shows formatting, and that serve-intake notes with a lone `**` still render clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/pdfGenerator.ts
git commit -m "feat(pdf): render strikeout + bullet/outline-numbered lists in addFormattedText"
```

---

## Task 4: Block-aware browser renderer `renderFormattedText`

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (`renderFormattedText` ~lines 1707-1733; add import)

- [ ] **Step 1: Add the import**

With the other DispatchPage imports, add:
```ts
import { computeListLines, tokenizeInline } from '../../utils/noteFormatting';
```

- [ ] **Step 2: Replace `renderFormattedText`**

Replace the existing `const renderFormattedText = useCallback((text: string) => { ... }, []);` block with (note: `renderInline` returns `string | JSX.Element` per token — no explicit `React.ReactNode` annotation, so no `React` namespace dependency):

```tsx
  // Render one line's inline marks. Strings are returned as-is (no key needed);
  // styled runs become keyed spans.
  const renderInline = useCallback((text: string, keyBase: string) =>
    tokenizeInline(text).map((t, i) => {
      const cls = [
        t.bold && 'font-bold',
        t.italic && 'italic',
        t.underline && 'underline',
        t.strike && 'line-through',
      ].filter(Boolean).join(' ');
      return cls
        ? <span key={`${keyBase}-${i}`} className={cls}>{t.text}</span>
        : t.text;
    }), []);

  // Render note text: inline marks for single-line notes; a block of indented
  // rows (bullets / outline numbers) when the note contains list lines.
  const renderFormattedText = useCallback((text: string) => {
    if (!text) return text;
    const lines = computeListLines(text);
    const hasList = lines.some((l) => l.kind !== 'plain');
    if (!hasList) return renderInline(text, 'inl');
    return (
      <span className="block">
        {lines.map((l, idx) => (
          <span key={idx} className="flex items-start" style={{ paddingLeft: `${l.depth * 1.1}em` }}>
            {l.kind !== 'plain' && (
              <span className="inline-block shrink-0 text-[#9ca3af] mr-1" style={{ minWidth: '1.4em' }}>
                {l.kind === 'ordered' ? `${l.marker}.` : '•'}
              </span>
            )}
            <span className="flex-1 min-w-0">{renderInline(l.content, `l${idx}`)}</span>
          </span>
        ))}
      </span>
    );
  }, [renderInline]);
```

- [ ] **Step 3: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual verification (browser)**

`cd client && npm run dev`, open a call, view a note containing `**b** *i* __u__ ~~s~~` and a nested list. Confirm inline marks render, single-line notes stay compact, lists show dots/outline numbers with indentation, and the `(edited)` badge still reads correctly after a note.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(notes): block-aware browser renderer (strike + bullet/outline lists)"
```

---

## Task 5: `NoteComposer` component (toolbar + Tab/Enter behaviors)

**Files:**
- Create: `client/src/pages/dispatch/components/NoteComposer.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/pages/dispatch/components/NoteComposer.tsx`:

```tsx
import { useRef, useCallback } from 'react';
import { classifyLine, INDENT_UNIT } from '../../../utils/noteFormatting';

interface NoteComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;        // fired on Shift+Enter
  autoFocus?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}

const INDENT = ' '.repeat(INDENT_UNIT);

export default function NoteComposer({
  value, onChange, onSubmit, autoFocus, rows = 2,
  placeholder = 'Add note...', maxLength = 4000,
}: NoteComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Apply a new value + caret position, restoring focus/selection next frame.
  const apply = useCallback((next: string, selStart: number, selEnd = selStart) => {
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }, [onChange]);

  // Wrap the current selection (or insert an empty marker pair at the caret).
  const wrap = useCallback((marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e);
    if (sel) {
      apply(value.slice(0, s) + marker + sel + marker + value.slice(e), s + marker.length, e + marker.length);
    } else {
      apply(value.slice(0, s) + marker + marker + value.slice(s), s + marker.length);
    }
  }, [value, apply]);

  // Bounds of the line containing `pos`.
  const lineBounds = (pos: number) => {
    const start = value.lastIndexOf('\n', pos - 1) + 1;
    const nl = value.indexOf('\n', pos);
    const end = nl === -1 ? value.length : nl;
    return { start, end };
  };

  // Prefix the caret's line with a list marker.
  const prefixLine = useCallback((prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const { start } = lineBounds(el.selectionStart);
    apply(value.slice(0, start) + prefix + value.slice(start), el.selectionStart + prefix.length);
  }, [value, apply]);

  const handleKeyDown = useCallback((ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = ev.currentTarget;
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === 'b') { ev.preventDefault(); return wrap('**'); }
    if (mod && ev.key.toLowerCase() === 'i') { ev.preventDefault(); return wrap('*'); }
    if (mod && ev.key.toLowerCase() === 'u') { ev.preventDefault(); return wrap('__'); }
    if (mod && ev.shiftKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); return wrap('~~'); }

    if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); onSubmit?.(); return; }

    if (ev.key === 'Tab') {
      ev.preventDefault();
      const { start } = lineBounds(el.selectionStart);
      if (ev.shiftKey) {
        const lead = value.slice(start).match(/^ {1,2}/)?.[0] ?? '';
        if (lead) apply(value.slice(0, start) + value.slice(start + lead.length), Math.max(start, el.selectionStart - lead.length));
      } else {
        apply(value.slice(0, start) + INDENT + value.slice(start), el.selectionStart + INDENT.length);
      }
      return;
    }

    if (ev.key === 'Enter' && !ev.shiftKey) {
      const { start, end } = lineBounds(el.selectionStart);
      const cl = classifyLine(value.slice(start, end));
      if (cl.kind !== 'plain') {
        ev.preventDefault();
        const indent = ' '.repeat(cl.depth * INDENT_UNIT);
        if (!cl.content.trim()) {
          // Empty list item -> exit the list (drop this line).
          apply(value.slice(0, start) + value.slice(end), start);
        } else {
          const next = cl.kind === 'bullet' ? '- ' : '1. ';
          const ins = `\n${indent}${next}`;
          const s = el.selectionStart;
          apply(value.slice(0, s) + ins + value.slice(el.selectionEnd), s + ins.length);
        }
      }
    }
  }, [value, apply, wrap, onSubmit]);

  const btn = 'w-6 h-5 flex items-center justify-center text-[10px] text-[#9ca3af] hover:text-white hover:bg-[#88888830] border border-[#2b2b2b] rounded-sm transition-all duration-100 active:bg-[#88888850]';

  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        <button type="button" title="Bold (Ctrl+B)" className={`${btn} font-black`} onClick={() => wrap('**')}>B</button>
        <button type="button" title="Italic (Ctrl+I)" className={`${btn} italic font-semibold`} onClick={() => wrap('*')}>I</button>
        <button type="button" title="Underline (Ctrl+U)" className={`${btn} underline`} onClick={() => wrap('__')}>U</button>
        <button type="button" title="Strikeout (Ctrl+Shift+S)" className={`${btn} line-through`} onClick={() => wrap('~~')}>S</button>
        <span className="w-px h-3 bg-[#2b2b2b] mx-0.5" />
        <button type="button" title="Bullet list" className={btn} onClick={() => prefixLine('- ')}>&bull;</button>
        <button type="button" title="Numbered list" className={btn} onClick={() => prefixLine('1. ')}>1.</button>
        <span className="text-[8px] text-[#545454] ml-2 font-mono select-none">Tab to indent · Shift+Enter to submit</span>
      </div>
      <textarea
        ref={ref}
        className="input-dark w-full text-xs resize-none"
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/dispatch/components/NoteComposer.tsx
git commit -m "feat(notes): NoteComposer — reusable formatting toolbar + Tab/Enter list editing"
```

---

## Task 6: Wire `NoteComposer` into the "add note" box

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (add-note toolbar+textarea+Add button ~lines 5762-5788; remove dead `wrapNoteSelection` ~1735-1761 and `noteTextareaRef` ~318)

- [ ] **Step 1: Import NoteComposer**

With the DispatchPage imports add:
```ts
import NoteComposer from './components/NoteComposer';
```

- [ ] **Step 2: Replace the add-note toolbar + textarea + Add button**

The current structure inside `<div className="flex-shrink-0">` is: a `{/* Formatting toolbar */}` div (B/I/U buttons), then a `<div className="flex gap-2">` wrapper containing the `<textarea ref={noteTextareaRef} …>` and the `<button onClick={handleAddNote}>Add</button>`, then the broadcast section.

Replace that whole block — from the `{/* Formatting toolbar */}` comment through the `</div>` that closes `<div className="flex gap-2">` (i.e. toolbar + textarea + Add button, ~lines 5762-5788) — with:

```tsx
                    <NoteComposer
                      value={newNote}
                      onChange={setNewNote}
                      onSubmit={handleAddNote}
                    />
                    <div className="flex justify-end mt-1">
                      <button type="button" onClick={handleAddNote} className="toolbar-btn toolbar-btn-primary" disabled={!newNote.trim()}>
                        Add
                      </button>
                    </div>
```

Leave the surrounding `<div className="flex-shrink-0">` and the broadcast `<div>` (the `selectedCall.assigned_units` block) intact below this.

- [ ] **Step 3: Remove the now-dead `wrapNoteSelection` and `noteTextareaRef`**

- Delete the `const wrapNoteSelection = useCallback(...)` block (~lines 1735-1761).
- Delete `const noteTextareaRef = useRef<HTMLTextAreaElement>(null);` (~line 318).

Verify nothing else references them:
```bash
grep -n "wrapNoteSelection\|noteTextareaRef" client/src/pages/dispatch/DispatchPage.tsx
```
Expected: no output.

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. (An "unused" error here means a reference was missed — re-run the grep above.)

- [ ] **Step 5: Visual verification**

`cd client && npm run dev`: in a call, the add-note box shows the B/I/U/S/•/1. toolbar. Select text + click B → wraps in `**`. Click "1." → prefixes `1. `. Tab on a list line → indents; Enter → continues the list; Enter on an empty item → exits. Shift+Enter → adds the note.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(notes): use NoteComposer for the add-note box; drop dead wrapNoteSelection"
```

---

## Task 7: Worker — stamp `author_username`; relax edit gate to author-or-admin

**Files:**
- Modify: `src/routes/dispatch/extensions.ts` (POST `/:id/notes` ~line 1579; POST `/:id/broadcast-note` ~line 1541; PUT `/:id/notes/:noteId` ~lines 1591-1620)

- [ ] **Step 1: Stamp `author_username` on note create**

In `POST /:id/notes` (~line 1564), add a user lookup after `const db = getDb(c.env);`:
```ts
    const user = c.get('user') as { username?: string } | undefined;
```
Then change the `notes.push(...)` line (~1579) from:
```ts
    notes.push({ id: `n-${Date.now()}`, author: String(body.author || 'Dispatch').slice(0, 120), text, timestamp: now });
```
to:
```ts
    notes.push({ id: `n-${Date.now()}`, author: String(body.author || 'Dispatch').slice(0, 120), author_username: user?.username || null, text, timestamp: now });
```

In `POST /:id/broadcast-note` (~line 1523), add the same `const user = ...` line after `const db = getDb(c.env);` and change the push (~1541) to include `author_username`:
```ts
    notes.push({ id: `bn-${Date.now()}`, author: 'DISPATCH BROADCAST', author_username: user?.username || null, text: message, timestamp: now, broadcast: true });
```

- [ ] **Step 2: Relax the PUT edit gate to author-or-admin**

Change the route declaration (~line 1591) from:
```ts
callActions.put('/:id/notes/:noteId', requireRole(...ADMIN_ROLES), async (c) => {
```
to:
```ts
callActions.put('/:id/notes/:noteId', requireRole(...WRITE_ROLES), async (c) => {
```

Widen the existing `user` declaration (~line 1594) to include `role`:
```ts
    const user = c.get('user') as { username?: string; role?: string } | undefined;
```

After the note is located (just after the `if (idx === -1) ...` line ~1608), add the ownership check before building the update:
```ts
    const isAdmin = ADMIN_ROLES.includes(user?.role || '');
    const isOwner = !!notes[idx].author_username && notes[idx].author_username === user?.username;
    if (!isAdmin && !isOwner) {
      return c.json({ error: 'You can only edit your own notes', code: 'NOTE_FORBIDDEN' }, 403);
    }
```

(`DELETE /:id/notes/:noteId` is intentionally left at `ADMIN_ROLES` — no change.)

- [ ] **Step 3: Typecheck (Worker)**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dispatch/extensions.ts
git commit -m "feat(notes): stamp author_username; allow note authors (not just admins) to edit their own notes"
```

---

## Task 8: Edit mode uses `NoteComposer` + author-edit client gate

**Files:**
- Modify: `client/src/pages/dispatch/DispatchPage.tsx` (ownership helper near line 259; edit-mode textarea ~line 5739; edit-button gate ~line 5748)

- [ ] **Step 1: Add an ownership helper**

After `const isAdminOrManager = ...` (~line 259), add:
```ts
  const canEditNote = useCallback((note: { author_username?: string | null }) =>
    isAdminOrManager || (!!note.author_username && note.author_username === user?.username),
  [isAdminOrManager, user?.username]);
```

- [ ] **Step 2: Replace the edit-mode textarea with NoteComposer**

Change the editing branch (~line 5739) from:
```tsx
                            <textarea className="input-dark text-xs w-full" rows={2} value={editingNoteText} onChange={(e) => setEditingNoteText(e.target.value)} autoFocus />
```
to:
```tsx
                            <NoteComposer
                              value={editingNoteText}
                              onChange={setEditingNoteText}
                              onSubmit={() => handleEditNote(note.id, editingNoteText)}
                              autoFocus
                            />
```

- [ ] **Step 3: Gate the Edit button by ownership (keep Delete admin-only)**

The action cluster is currently wrapped in `{isAdminOrManager && ( <div ...> <Edit button/> <Delete button/> </div> )}` (~line 5748). Replace that wrapper + its two buttons with:
```tsx
                            {(canEditNote(note) || isAdminOrManager) && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 shrink-0">
                                {canEditNote(note) && (
                                  <button type="button" aria-label="Edit note" className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#888888] hover:text-[#a0a0a0] transition-colors" title="Edit note" onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text || ''); }}><Pencil className="w-3 h-3" /></button>
                                )}
                                {isAdminOrManager && (
                                  <button type="button" aria-label="Delete note" className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#888888] hover:text-[#ef4444] transition-colors" title="Delete note" onClick={() => handleDeleteNote(note.id)}><Trash2 className="w-3 h-3" /></button>
                                )}
                              </div>
                            )}
```

- [ ] **Step 4: Typecheck**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Visual verification**

`cd client && npm run dev`: open a call where the current (non-admin) user authored a note → Edit appears, opens in the rich NoteComposer with formatting intact; re-save works. As admin → can edit/delete any. As a different non-admin on someone else's note → no Edit button. Cross-check that editing another user's note via the API returns `NOTE_FORBIDDEN` (403).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/dispatch/DispatchPage.tsx
git commit -m "feat(notes): re-editable note entries — author-or-admin edit via NoteComposer"
```

---

## Task 9: Bump service worker cache + full verification

**Files:**
- Modify: `client/public/sw.js` (line 605)

- [ ] **Step 1: Bump CACHE_NAME**

Change line 605 from:
```js
const CACHE_NAME = 'rmpg-flex-v913';
```
to:
```js
const CACHE_NAME = 'rmpg-flex-v914';
```

- [ ] **Step 2: Full verification gate**

Run each and confirm success:
```bash
npm run typecheck                       # Worker types
cd client && npx tsc --noEmit           # Client types
npx vitest run                          # Full client suite (272 existing + new noteFormatting/sanitize tests)
npx vite build                          # Client production build
cd ..
```
Expected: all pass; the new tests appear in the vitest count.

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "chore(sw): bump cache to v914 for dispatch notes formatting"
```

---

## Done criteria

- Bold/italic/underline appear in generated PDFs (every `addFormattedText`/`addNarrativeSection` path).
- Strikeout works in the editor, browser, and PDF.
- Bullets and outline-numbered (1 / 1.1 / 1.1.1) lists work in the editor, browser, and PDF, with Tab/Shift+Tab nesting and Enter continue/exit.
- A note author (not just admins) can reopen their note in the rich editor and re-save; delete stays admin-only; another user's note returns 403.
- All typechecks, the full vitest suite, and the client build pass; SW cache bumped.
- Ship as a feature-branch PR per project convention (pr-tests.yml gates; merge triggers deploy.yml). Apply nothing to live D1 (no migration in Phase 1).
```
